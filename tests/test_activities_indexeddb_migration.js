// Regression/feature test for the ACTIVITIES IndexedDB migration. Dylon: "What i think is happening
// is that the app actually stores the files i upload when i only require it to load the data from the
// files and take the information not store it. Maybe i am wrong but this will be a huge issue" --
// investigation confirmed the raw uploaded file is never stored (only its filename), but the full
// parsed per-second stream (t/lat/lon/alt/distM/hr/cadence/power/vertOsc/vertRatio/strideLen/temp) IS
// stored, and legitimately needs to be (route map, splits, GAP, best-efforts, HR/pace zone
// breakdowns all read it). That's the real mechanism behind "storage full" (see
// test_activity_storage_quota.js / test_activity_save_fallback_and_sync_invalidation.js) --
// localStorage's ~5MB-per-origin ceiling was always going to be outgrown eventually by a real,
// accumulating training history. This moves ACTIVITIES' persistence backend to IndexedDB (typically
// hundreds of MB+, tied to available disk) while keeping ACTIVITIES itself a plain synchronous
// in-memory array every existing read site throughout the app keeps working against unchanged.
//
// Covers: a fresh install initializing cleanly with nothing in IndexedDB or localStorage; a one-time
// migration of a pre-existing localStorage copy into IndexedDB (with the old key only cleared after
// the migration is confirmed to have landed); normal save/load round-trips through IndexedDB; and the
// localStorage-fallback path some other test files already cover in more depth for when IndexedDB
// itself isn't available.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('/tmp/node_modules/jsdom');
const fakeIndexedDB = require('/tmp/node_modules/fake-indexeddb');

const html = fs.readFileSync(path.join(__dirname, '..', 'halotraining-app', 'index.html'), 'utf8');

function makeWindow(opts) {
  opts = opts || {};
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
      if (opts.withIndexedDB !== false) {
        win.indexedDB = fakeIndexedDB.indexedDB;
        win.IDBKeyRange = fakeIndexedDB.IDBKeyRange;
      }
      if (opts.seed) Object.keys(opts.seed).forEach(k => { try { win.localStorage.setItem(k, opts.seed[k]); } catch(e){} });
    }
  });
  return dom.window;
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
process.on('uncaughtException', (e) => { console.log('UNCAUGHT:', e && e.stack || e); });
process.on('unhandledRejection', (e) => { console.log('UNHANDLED REJECTION:', e && e.stack || e); });

(async () => {
  // ---- Test 1: a brand-new device -- nothing in IndexedDB, nothing in localStorage -- ends up with
  // an empty ACTIVITIES array rather than crashing or hanging, and ACTIVITIES_IDB_READY flips true. ----
  {
    const win = makeWindow();
    await wait(400);
    win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
    win.eval(`window.renderAll = function(){};`);
    const ready = win.eval(`ACTIVITIES_IDB_READY`);
    const count = win.eval(`ACTIVITIES.length`);
    console.log('Test 1 (fresh install: ACTIVITIES starts empty, ACTIVITIES_IDB_READY is true after boot):',
      (ready === true && count === 0) ? 'PASS' : `FAIL (ready=${ready}, count=${count})`);
    win.close();
  }

  // ---- Test 2: a device with an existing legacy localStorage copy (from before this migration
  // existed) but nothing in IndexedDB yet -- the legacy data is loaded into ACTIVITIES AND migrated
  // into IndexedDB, and the old localStorage key is cleared afterward since the migration verified. ----
  {
    const legacyActivities = [
      { id:'legacy-1', type:'run', role:'unplanned', date:'2026-05-01', distanceKm:5, title:'Legacy Run 1' },
      { id:'legacy-2', type:'walk', role:'unplanned', date:'2026-05-02', distanceKm:3, title:'Legacy Run 2' }
    ];
    const win = makeWindow({ seed: { b5_activities: JSON.stringify(legacyActivities) } });
    await wait(400);
    win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
    win.eval(`window.renderAll = function(){};`);
    const inMemoryCount = win.eval(`ACTIVITIES.length`);
    const inMemoryIds = JSON.parse(win.eval(`JSON.stringify(ACTIVITIES.map(a=>a.id))`));
    const idbCopy = await win.eval(`idbGetActivities()`);
    const legacyKeyCleared = win.eval(`localStorage.getItem('b5_activities')===null`);
    const t2 = inMemoryCount===2 && inMemoryIds.includes('legacy-1') && inMemoryIds.includes('legacy-2') &&
      idbCopy && idbCopy.length===2 && legacyKeyCleared;
    console.log('Test 2 (a pre-existing localStorage copy migrates into IndexedDB and the old key is cleared):',
      t2?'PASS':'FAIL', { inMemoryCount, inMemoryIds, idbCopyLen: idbCopy && idbCopy.length, legacyKeyCleared });
    win.close();
  }

  // ---- Test 3: normal save/load round-trip -- save through the real app boot, simulate a reload with
  // a FRESH window pointed at the SAME underlying fake-indexeddb databases (fake-indexeddb persists
  // across separate require()'d windows within one process, same as real IndexedDB persists across a
  // real page reload), and confirm the activity comes back. ----
  {
    const winA = makeWindow();
    await wait(400);
    winA.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
    winA.eval(`window.renderAll = function(){};`);
    winA.eval(`
      ACTIVITIES=[normalizeActivityRecord({type:'run',role:'unplanned',date:'2026-08-01',distanceKm:10,title:'Round Trip Run'})];
      saveActivitiesList(true);
    `);
    await wait(100);
    winA.close();

    const winB = makeWindow();
    await wait(400);
    winB.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
    winB.eval(`window.renderAll = function(){};`);
    const t3Count = winB.eval(`ACTIVITIES.length`);
    const t3Title = winB.eval(`ACTIVITIES[0] && ACTIVITIES[0].title`);
    console.log('Test 3 (a save in one session is readable by a fresh session against the same IndexedDB):',
      (t3Count===1 && t3Title==='Round Trip Run') ? 'PASS' : `FAIL (count=${t3Count}, title=${t3Title})`);
    winB.close();
  }

  // ---- Test 4: IndexedDB genuinely unavailable on this device (window.indexedDB left undefined,
  // same as a very old browser) -- initActivitiesStorage() falls back to whatever legacy localStorage
  // has, rather than throwing or ending up permanently empty. ----
  {
    const legacyActivities = [
      { id:'noidb-1', type:'run', role:'unplanned', date:'2026-06-01', distanceKm:6, title:'No-IDB Run' }
    ];
    const win = makeWindow({ withIndexedDB:false, seed: { b5_activities: JSON.stringify(legacyActivities) } });
    await wait(400);
    win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
    win.eval(`window.renderAll = function(){};`);
    const count = win.eval(`ACTIVITIES.length`);
    const title = win.eval(`ACTIVITIES[0] && ACTIVITIES[0].title`);
    console.log('Test 4 (IndexedDB unavailable: falls back to the existing localStorage copy instead of coming up empty):',
      (count===1 && title==='No-IDB Run') ? 'PASS' : `FAIL (count=${count}, title=${title})`);
    win.close();
  }

  // ---- Test 5: a save made while IndexedDB is unavailable leaves the legacy AK key populated (the
  // signal initActivitiesStorage uses to know it's the freshest copy) rather than silently losing the
  // save or leaving stale/ambiguous state behind. ----
  {
    const win = makeWindow({ withIndexedDB:false });
    await wait(400);
    win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
    win.eval(`window.renderAll = function(){};`);
    win.eval(`
      ACTIVITIES=[normalizeActivityRecord({type:'run',role:'unplanned',date:'2026-06-05',distanceKm:4,title:'Fallback Save'})];
      saveActivitiesList(true);
    `);
    await wait(100);
    const persisted = win.eval(`JSON.parse(localStorage.getItem('b5_activities')||'[]')`);
    console.log('Test 5 (a save with IndexedDB unavailable still lands in the localStorage fallback):',
      (persisted.length===1 && persisted[0].title==='Fallback Save') ? 'PASS' : `FAIL (${JSON.stringify(persisted)})`);
    win.close();
  }

  process.exit(0);
})();
