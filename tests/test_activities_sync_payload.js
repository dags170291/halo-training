// Regression test for a real data-loss bug: buildSyncPayload()/applySyncPayload() -- the one shared
// function backing both the file-based backup/restore flow AND cloud sync push/pull -- never included
// ACTIVITIES (imported/synced watch files, Phase 0 of ANALYTICS_ROADMAP.md) at all. A backup exported
// and restored on another device, or a fresh device pulling from cloud sync, would come back with
// every session status/note/block/race intact but zero imported activities -- silently, with no error.
// ACTIVITIES also persists to its own localStorage key (saveActivitiesList(), the AK constant) rather
// than through saveState() like everything else, which is exactly why it was easy to leave out of both
// functions and why applySyncPayload's fix needs its own explicit save call, not just an in-memory
// assignment.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('/tmp/node_modules/jsdom');

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

  // ---- Test 1: buildSyncPayload() includes an "activities" key matching ACTIVITIES ----
  const payloadHasActivities = win.eval(`
    (function(){
      const payload = buildSyncPayload();
      return Array.isArray(payload.activities) && payload.activities.length===1 && payload.activities[0].distanceKm===8.2;
    })()
  `);
  console.log('Test 1 (buildSyncPayload includes ACTIVITIES, not just status/notes/blocks):',
    payloadHasActivities===true ? 'PASS' : 'FAIL', { payloadHasActivities });

  // ---- Test 2: simulate restoring on a fresh device -- ACTIVITIES and its own localStorage key (AK)
  // both start empty, applySyncPayload() with a real backup payload should bring the activity back in
  // memory AND persist it, not just set the in-memory variable for this one session ----
  const restoreResult = win.eval(`
    (function(){
      const payload = buildSyncPayload();
      ACTIVITIES = [];
      localStorage.removeItem('b5_activities');
      applySyncPayload(payload);
      const persisted = JSON.parse(localStorage.getItem('b5_activities') || '[]');
      return {
        inMemoryCount: ACTIVITIES.length,
        inMemoryTitle: ACTIVITIES[0] && ACTIVITIES[0].title,
        persistedCount: persisted.length,
        persistedTitle: persisted[0] && persisted[0].title
      };
    })()
  `);
  console.log('Test 2 (applySyncPayload restores ACTIVITIES both in memory and to its own localStorage key):', {
    restoreResult,
    result: (restoreResult.inMemoryCount===1 && restoreResult.inMemoryTitle==='Morning Run' &&
             restoreResult.persistedCount===1 && restoreResult.persistedTitle==='Morning Run') ? 'PASS' : 'FAIL'
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
