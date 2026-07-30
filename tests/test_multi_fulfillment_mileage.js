// Regression test for the "km logged doesn't calculate correctly" bug -- Dylon re-imported a training
// block via the new multi-file import feature, splitting real watch data for a single day into several
// separate files (e.g. a pre-run warm-up walk, the actual run, a strides file, a cool-down walk). Each
// file that genuinely represented the session's own effort got auto-linked with role:'fulfillment' --
// but loggedDist()/sessionDurationSec() both used ACTIVITIES.find(), which only ever grabs the FIRST
// fulfillment-role Activity for a session and silently drops the rest. Worst case observed: a long-run
// session's warm-up walk (1.1km) got matched first, so the actual 8.15km run was dropped entirely from
// the block's "km logged" total. Dylon: "the total mileage (km logged) still doesnt calculate correctly."
// Fix (v0.34.4): both functions now sum every fulfillment-role Activity for a session instead of taking
// the first.
//
// v0.34.9 update: summing "every fulfillment-role Activity" turned out to be too broad -- it also summed
// a warm-up/cool-down WALK's own distance straight into the run session's total, inflating Activity
// Trends' Run figures with real ground covered that wasn't actually running. Dylon caught this himself
// against his own hand-logged data: "so i found the error, some walks were added as activity and not as
// extras is there some way we can ensure that this dont happen." Fixed via activityIsNativeToSession() --
// a fulfilling Activity now only sums into its session's own number when its own type is native to that
// session's type (or generically unclassified as 'workout' -- see that function's own comment). The
// sLong fixture below was updated to use two separate RUN-typed files (still proving the "sums more than
// one, not just find()'s first" fix) instead of a warm-up walk + run, and a new Test 1b demonstrates the
// walk-exclusion fix directly.
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

  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2027-06-01',endDate:'2027-08-01',sessions:[
      {id:'sLong',wk:1,ty:'long',date:'2027-06-05',ph:'dur',ti:'Long Run',full:'2027 Block Durability W1D5: Long Run'},
      {id:'sEasy',wk:1,ty:'easy',date:'2027-06-06',ph:'dur',ti:'Easy Run',full:'2027 Block Durability W1D6: Easy Run'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; STATUS={}; NOTES={}; RACES_LIST=[];
    ACTIVITIES=[];
    // sLong: a warm-up walk (v0.34.9: no longer summed into the run's own total -- see Test 1b), plus
    // the long run split across two real RUN-typed files (e.g. a GPS reconnect after losing signal) --
    // still proves "sums more than one fulfillment Activity, not just find()'s first" without the walk
    // muddying the run-specific total.
    addActivity({type:'walk',role:'fulfillment',linkedSessionId:'sLong',date:'2027-06-05',distanceKm:1.1,durationSec:600,title:'Warm-Up'});
    addActivity({type:'run',role:'fulfillment',linkedSessionId:'sLong',date:'2027-06-05',distanceKm:8.15,durationSec:2800,title:'Long Run Part 1'});
    addActivity({type:'run',role:'fulfillment',linkedSessionId:'sLong',date:'2027-06-05',distanceKm:0.9,durationSec:320,title:'Long Run Part 2 (GPS reconnect)'});
    // sEasy: main run + strides, both fulfillment, plus an accessory cool-down walk that should NOT
    // be summed in (accessory activities are warm-up/cool-down, not part of the prescribed distance).
    addActivity({type:'run',role:'fulfillment',linkedSessionId:'sEasy',date:'2027-06-06',distanceKm:5.16,durationSec:1900,title:'Easy Run'});
    addActivity({type:'run',role:'fulfillment',linkedSessionId:'sEasy',date:'2027-06-06',distanceKm:0.75,durationSec:400,title:'Strides'});
    addActivity({type:'walk',role:'accessory',linkedSessionId:'sEasy',date:'2027-06-06',distanceKm:1.14,durationSec:500,title:'Cool-Down Walk'});
  `);

  // Test 1: loggedDist sums BOTH real-run fulfillment activities for sLong (8.15 + 0.9 = 9.05), not just
  // the first one .find() used to grab -- and, since v0.34.9, excludes the warm-up walk entirely even
  // though it's also role:'fulfillment' (see Test 1b).
  const t1 = win.eval(`loggedDist('sLong')`);
  console.log('Test 1 (loggedDist sums multiple RUN-typed fulfillment Activities, not just the first):',
    Math.abs(t1 - 9.05) < 0.001 ? 'PASS' : `FAIL (got ${t1}, expected 9.05)`);

  // Test 1b: v0.34.9 -- the warm-up walk linked as sLong's fulfillment does NOT inflate the run's own
  // distance (confirmed above, sLong totals 9.05 not 10.15), but its own 1.1km still shows up under the
  // Walk trend for the same week, alongside sEasy's accessory cool-down walk (1.14km) -- both walks,
  // regardless of role, land in the Walk total (1.1 + 1.14 = 2.24) -- Dylon: "ensure that walks (warm up
  // or cool down)... get added to their designated activity type even if it is attached to a planned
  // session."
  const t1bWalk = win.eval(`weekMetricTotal(1,'walk').total`);
  console.log("Test 1b (the warm-up walk's own km still counts under the Walk trend, not the Run one):",
    Math.abs(t1bWalk - 2.24) < 0.001 ? 'PASS' : `FAIL (got ${t1bWalk}, expected 2.24)`);

  // Test 2: loggedDist sums the run + strides fulfillment pair for sEasy, but excludes the
  // accessory cool-down walk (5.16 + 0.75 = 5.91, not +1.14).
  const t2 = win.eval(`loggedDist('sEasy')`);
  console.log('Test 2 (loggedDist sums fulfillment Activities but excludes accessory ones):',
    Math.abs(t2 - 5.91) < 0.001 ? 'PASS' : `FAIL (got ${t2}, expected 5.91)`);

  // Test 3: sessionDurationSec has the identical bug/fix -- sums both RUN-typed fulfillment durations for
  // sLong (2800 + 320 = 3120s), excluding the warm-up walk's 600s the same way Test 1 excludes its km.
  const t3 = win.eval(`sessionDurationSec('sLong')`);
  console.log('Test 3 (sessionDurationSec sums multiple RUN-typed fulfillment Activities\' durations):',
    t3 === 3120 ? 'PASS' : `FAIL (got ${t3}, expected 3120)`);

  // Test 4: cumulativeActualKm/weekActualKm (the block-wide "km logged" stat-grid figure) reflects the
  // summed totals once both sessions are marked done -- this is the actual number Dylon saw wrong on
  // the Progress tab. (9.05 + 5.91, run-only -- the warm-up walk's 1.1km is correctly excluded here too,
  // since this stat is explicitly run-plan-specific.)
  win.eval(`STATUS['sLong']='done'; STATUS['sEasy']='done';`);
  const t4 = win.eval(`cumulativeActualKm()`);
  console.log('Test 4 (cumulativeActualKm reflects the corrected per-session sums):',
    Math.abs(t4 - (9.05 + 5.91)) < 0.001 ? 'PASS' : `FAIL (got ${t4}, expected ${9.05+5.91})`);

  // Test 5: a session fulfilled by exactly one Activity (the common case) is unaffected by the fix --
  // no regression for the normal single-file-import path.
  win.eval(`
    BLOCKS[0].sessions.push({id:'sSingle',wk:1,ty:'easy',date:'2027-06-07',ph:'dur',ti:'Single Run'});
    DATA=BLOCKS[0].sessions;
    addActivity({type:'run',role:'fulfillment',linkedSessionId:'sSingle',date:'2027-06-07',distanceKm:4.2,durationSec:1500,title:'Single Run'});
  `);
  const t5dist = win.eval(`loggedDist('sSingle')`);
  const t5dur = win.eval(`sessionDurationSec('sSingle')`);
  console.log('Test 5 (single-fulfillment session unaffected by the fix):',
    (t5dist === 4.2 && t5dur === 1500) ? 'PASS' : `FAIL (got dist=${t5dist}, dur=${t5dur})`);

  // Test 6: a session with no fulfillment Activity at all still returns null (unlogged), not 0 --
  // preserves the existing "no data yet" vs "logged zero" distinction.
  win.eval(`BLOCKS[0].sessions.push({id:'sNone',wk:1,ty:'easy',date:'2027-06-08',ph:'dur',ti:'Unlogged Run'}); DATA=BLOCKS[0].sessions;`);
  const t6dist = win.eval(`loggedDist('sNone')`);
  const t6dur = win.eval(`sessionDurationSec('sNone')`);
  console.log('Test 6 (session with no fulfillment Activity still returns null, not 0):',
    (t6dist === null && t6dur === null) ? 'PASS' : `FAIL (got dist=${t6dist}, dur=${t6dur})`);
})();
