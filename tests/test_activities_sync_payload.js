// Regression test for a real data-loss bug: buildSyncPayload()/applySyncPayload() -- the one shared
// function backing both the file-based backup/restore flow AND cloud sync push/pull -- never included
// ACTIVITIES (imported/synced watch files, Phase 0 of ANALYTICS_ROADMAP.md) at all. A backup exported
// and restored on another device, or a fresh device pulling from cloud sync, would come back with
// every session status/note/block/race intact but zero imported activities -- silently, with no error.
// ACTIVITIES now persists to IndexedDB (see idbSetActivities/initActivitiesStorage in index.html)
// rather than a plain localStorage key, which is exactly why it was easy to leave out of both
// buildSyncPayload/applySyncPayload and why applySyncPayload's fix needs its own explicit save call,
// not just an in-memory assignment.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('/tmp/node_modules/jsdom');
const fakeIndexedDB = require('/tmp/node_modules/fake-indexeddb');

const html = fs.readFileSync(path.join(__dirname, '..', 'halotraining-app', 'index.html'), 'utf8');

function makeWindow() {
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.requestAnimationFrame = (cb) => setTimeout(cb, 0);
      win.cancelAnimationFrame = (id) => clearTimeout(id);
      win.scrollTo = () => {};
      win.Element.prototype.scrollIntoView = () => {};
      win.Element.prototype.scrollBy = () => {};
      win.matchMedia = () => ({ matches: true, addListener(){}, removeListener(){} });
      // jsdom has no native IndexedDB -- polyfill it so saveActivitiesList()/applySyncPayload() exercise
      // the real production persistence path instead of always falling through to the localStorage
      // backstop (see test_activity_storage_quota.js for that fallback path specifically).
      win.indexedDB = fakeIndexedDB.indexedDB;
      win.IDBKeyRange = fakeIndexedDB.IDBKeyRange;
    }
  });
  return dom.window;
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
  win.eval(`window.renderAll = function(){};`);

  win.eval(`
    ACTIVITIES=[normalizeActivityRecord({type:'run', role:'unplanned', date:'2026-07-15', distanceKm:8.2, durationSec:2400, title:'Morning Run'})];
    saveActivitiesList();
  `);
  await wait(50);

  // ---- Test 1: buildSyncPayload() includes an "activities" key matching ACTIVITIES ----
  const payloadHasActivities = win.eval(`
    (function(){
      const payload = buildSyncPayload();
      return Array.isArray(payload.activities) && payload.activities.length===1 && payload.activities[0].distanceKm===8.2;
    })()
  `);
  console.log('Test 1 (buildSyncPayload includes ACTIVITIES, not just status/notes/blocks):',
    payloadHasActivities===true ? 'PASS' : 'FAIL', { payloadHasActivities });

  // ---- Test 2: simulate restoring on a fresh device -- ACTIVITIES starts empty (both in memory and
  // in IndexedDB), applySyncPayload() with a real backup payload should bring the activity back in
  // memory AND persist it, not just set the in-memory variable for this one session ----
  win.eval(`
    window.__t2payload = buildSyncPayload();
    ACTIVITIES = [];
    localStorage.removeItem('b5_activities');
  `);
  await win.eval(`idbSetActivities([])`); // clear IndexedDB too, mirroring a genuinely fresh device
  win.eval(`applySyncPayload(window.__t2payload);`);
  await wait(50);
  const restoreInMemory = win.eval(`({count: ACTIVITIES.length, title: ACTIVITIES[0] && ACTIVITIES[0].title})`);
  const restorePersisted = await win.eval(`idbGetActivities().then(list => ({count: (list||[]).length, title: list && list[0] && list[0].title}))`);
  console.log('Test 2 (applySyncPayload restores ACTIVITIES both in memory and to IndexedDB):', {
    restoreInMemory, restorePersisted,
    result: (restoreInMemory.count===1 && restoreInMemory.title==='Morning Run' &&
             restorePersisted.count===1 && restorePersisted.title==='Morning Run') ? 'PASS' : 'FAIL'
  });

  // ---- Test 3: an old-format backup with no "activities" key at all (from before this fix) leaves
  // whatever activities already exist on this device alone, rather than wiping them to empty --
  // same "don't destroy real local data with an absent field" pattern blocks/seasons already follow ----
  const oldBackupResult = win.eval(`
    (function(){
      ACTIVITIES=[normalizeActivityRecord({type:'walk', role:'unplanned', date:'2026-07-20', distanceKm:3.1, title:'Evening Walk'})];
      saveActivitiesList();
      const oldStyleBackup = {status:{}, notes:{}, profile:{}, extralogs:[], shoes:[]}; // no "activities" key
      applySyncPayload(oldStyleBackup);
      return {count: ACTIVITIES.length, title: ACTIVITIES[0] && ACTIVITIES[0].title};
    })()
  `);
  console.log('Test 3 (a pre-fix backup with no activities key leaves existing local activities untouched):', {
    oldBackupResult,
    result: (oldBackupResult.count===1 && oldBackupResult.title==='Evening Walk') ? 'PASS' : 'FAIL'
  });

  await wait(200);
  win.close();
})();
