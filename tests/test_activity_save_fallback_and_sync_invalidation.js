// Dylon: "I got a message saying storage full after uploading my run for today ? and now my run data
// is gone." Confirmed only today's run was missing (not his whole history), and Cloud Sync is signed
// in on this device. Root cause: this device's accumulated activity history had grown past what the
// normal 1000-point-per-activity compaction (saveActivitiesList) could fit in localStorage, so today's
// newly-added run stayed correct in memory for that session but never actually reached disk -- the
// next reload came back with the pre-failure copy, missing it.
//
// Two-part fix: (1) saveActivitiesList() now retries once, before giving up, with every activity's
// stream squeezed down to the much smaller STREAM_MAX_POINTS_FALLBACK -- real headroom without the
// person needing to manually delete anything first. (2) If even that retry fails, the save genuinely
// didn't reach disk -- but Cloud Sync's own push (syncPush(), queued a few seconds later by
// noteLocalEdit()) reads the live in-memory ACTIVITIES directly, not this failed local save, so the
// cloud copy can still end up correct. SYNCK gets invalidated (removed, not just blanked -- see
// safeRemove()'s own note on why blanking would silently break its callers' fallback defaults) so the
// next time this device checks in, it can't assume it's already in sync with the cloud -- a real
// mismatch surfaces as an explicit conflict prompt instead of the local copy quietly staying broken
// forever.
//
// ACTIVITIES now persists to IndexedDB by default (see idbSetActivities/initActivitiesStorage in
// index.html), with everything described above demoted to the backstop path used only when
// IndexedDB itself is unavailable or its write fails. This file deliberately does NOT wire a fake
// IndexedDB into its jsdom windows (window.indexedDB stays undefined, same as a browser without
// IndexedDB support), so every saveActivitiesList() call below exercises that backstop path
// specifically -- see test_activities_indexeddb_migration.js for the primary IndexedDB path.
// saveActivitiesList() now kicks off persistence asynchronously rather than blocking synchronously,
// so a short wait() is needed between a save and reading its result back.
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

function fakeStream(points) {
  const t=[],lat=[],lon=[],alt=[],distM=[],hr=[],cadence=[],power=[],vertOsc=[],vertRatio=[],strideLen=[],temp=[];
  for (let i=0;i<points;i++){
    t.push(i); lat.push(45+i*0.0001); lon.push(-73-i*0.0001); alt.push(100+i%20);
    distM.push(i*3.2); hr.push(120+(i%40)); cadence.push(170); power.push(250);
    vertOsc.push(8); vertRatio.push(6); strideLen.push(1.1); temp.push(22);
  }
  return {t,lat,lon,alt,distM,hr,cadence,power,vertOsc,vertRatio,strideLen,temp};
}

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
  win.eval(`window.renderAll = function(){};`);

  // ---- Test 1: safeRemove actually deletes the key (not just blanks it), so a later
  // safeGet(k, someDefault) correctly falls back to that default rather than getting back ''. ----
  win.eval(`localStorage.setItem('__probe','some value'); safeRemove('__probe');`);
  const t1 = win.eval(`localStorage.getItem('__probe')===null && safeGet('__probe','my-default')==='my-default'`);
  console.log('Test 1 (safeRemove deletes the key so safeGet falls back to its caller-provided default):', t1?'PASS':'FAIL');

  // ---- Test 2: a dataset just over STREAM_MAX_POINTS-compaction's own quota, but small enough to
  // fit after the new STREAM_MAX_POINTS_FALLBACK retry, now saves successfully -- no toast, no lost
  // data -- where the pre-fix code would have failed outright and shown the storage-full warning. ----
  win.eval(`
    window.__toasts=[];
    window.showToast=(m)=>{ window.__toasts.push(m); };
    ACTIVITIES=[];
    for(let i=0;i<250;i++){
      ACTIVITIES.push(normalizeActivityRecord({type:'run',role:'unplanned',date:'2027-01-01',
        distanceKm:8,durationSec:1000,title:'Run '+i,stream:${JSON.stringify(fakeStream(1000))}}));
    }
    saveActivitiesList();
  `);
  await wait(50);
  const t2saved = win.eval(`JSON.parse(localStorage.getItem('b5_activities')).length`);
  const t2toasts = win.eval(`__toasts`);
  const t2 = t2saved===250 && t2toasts.length===0;
  console.log('Test 2 (a save that would have failed pre-fix now succeeds via the fallback retry -- no data lost, no toast):',
    t2?'PASS':'FAIL', { t2saved, t2toasts });

  // ---- Test 3: the persisted (fallback-compacted) copy actually got squeezed down to
  // STREAM_MAX_POINTS_FALLBACK, not just re-saved at the normal cap. ----
  const t3 = win.eval(`JSON.parse(localStorage.getItem('b5_activities'))[0].stream.t.length <= STREAM_MAX_POINTS_FALLBACK`);
  console.log('Test 3 (the fallback save actually compacted streams down to STREAM_MAX_POINTS_FALLBACK):', t3?'PASS':'FAIL');

  // ---- Test 4: SYNCK is left untouched by a save that succeeds (via either the normal path or the
  // fallback retry) -- invalidation is specifically for the "genuinely could not save at all" case. ----
  win.eval(`safeSet('b5_last_sync','2027-01-01T00:00:00.000Z');`);
  win.eval(`saveActivitiesList();`); // re-save the same (now-fitting) 250 activities -- should succeed again
  await wait(50);
  const t4 = win.eval(`safeGet('b5_last_sync',null)==='2027-01-01T00:00:00.000Z'`);
  console.log('Test 4 (SYNCK is untouched when the save succeeds, even via the fallback retry):', t4?'PASS':'FAIL');

  // ---- Test 5: a dataset that STILL doesn't fit even after the fallback retry (Test 6 of
  // test_activity_storage_quota.js covers the toast side of this) also invalidates SYNCK, so this
  // device stops assuming it's in sync with the cloud until a real check confirms it. ----
  win.eval(`
    window.__toasts=[];
    window.showToast=(m)=>{ window.__toasts.push(m); };
    safeSet('b5_last_sync','2027-01-01T00:00:00.000Z');
    ACTIVITIES=[];
    for(let i=0;i<1500;i++){
      ACTIVITIES.push(normalizeActivityRecord({type:'run',role:'unplanned',date:'2027-01-01',
        distanceKm:8,durationSec:1000,title:'Run '+i,stream:${JSON.stringify(fakeStream(1000))}}));
    }
    saveActivitiesList();
  `);
  await wait(50);
  const t5toasts = win.eval(`__toasts`);
  const t5syncCleared = win.eval(`localStorage.getItem('b5_last_sync')===null`);
  const t5 = t5toasts.length===1 && t5syncCleared;
  console.log('Test 5 (a save that fails even after the fallback retry invalidates SYNCK, not just shows a toast):',
    t5?'PASS':'FAIL', { t5toasts, t5syncCleared });

  // ---- Test 6: after that SYNCK invalidation, hasUnsyncedLocalChanges() correctly reports true --
  // this device can no longer assume it's already up to date with whatever the cloud has. ----
  const t6 = win.eval(`hasUnsyncedLocalChanges()`);
  console.log('Test 6 (hasUnsyncedLocalChanges() is true after SYNCK invalidation, so a real sync check will happen):', t6?'PASS':'FAIL');

  await wait(200);
  win.close();
})();
