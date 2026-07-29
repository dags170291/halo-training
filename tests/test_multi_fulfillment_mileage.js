// Regression test for the "km logged doesn't calculate correctly" bug -- Dylon re-imported a training
// block via the new multi-file import feature, splitting real watch data for a single day into several
// separate files (e.g. a pre-run warm-up walk, the actual run, a strides file, a cool-down walk). Each
// file that genuinely represented the session's own effort got auto-linked with role:'fulfillment' --
// but loggedDist()/sessionDurationSec() both used ACTIVITIES.find(), which only ever grabs the FIRST
// fulfillment-role Activity for a session and silently drops the rest. Worst case observed: a long-run
// session's warm-up walk (1.1km) got matched first, so the actual 8.15km run was dropped entirely from
// the block's "km logged" total. Dylon: "the total mileage (km logged) still doesnt calculate correctly."
// Fix: both functions now sum every fulfillment-role Activity for a session instead of taking the first.
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
    // sLong: warm-up walk happens to be first in array order, then the real run -- both real,
    // both fulfillment (mirrors what multi-file import produced for Dylon's long run).
    addActivity({type:'walk',role:'fulfillment',linkedSessionId:'sLong',date:'2027-06-05',distanceKm:1.1,durationSec:600,title:'Warm-Up'});
    addActivity({type:'run',role:'fulfillment',linkedSessionId:'sLong',date:'2027-06-05',distanceKm:8.15,durationSec:2800,title:'Long Run'});
    // sEasy: main run + strides, both fulfillment, plus an accessory cool-down walk that should NOT
    // be summed in (accessory activities are warm-up/cool-down, not part of the prescribed distance).
    addActivity({type:'run',role:'fulfillment',linkedSessionId:'sEasy',date:'2027-06-06',distanceKm:5.16,durationSec:1900,title:'Easy Run'});
    addActivity({type:'run',role:'fulfillment',linkedSessionId:'sEasy',date:'2027-06-06',distanceKm:0.75,durationSec:400,title:'Strides'});
    addActivity({type:'walk',role:'accessory',linkedSessionId:'sEasy',date:'2027-06-06',distanceKm:1.14,durationSec:500,title:'Cool-Down Walk'});
  `);

  // Test 1: loggedDist sums BOTH fulfillment activities for sLong (walk + run), not just the first
  // (the walk) that .find() used to grab -- this was the worst-case symptom, a real 8.15km run silently
  // vanishing from the block total because a 1.1km warm-up walk got matched first.
  const t1 = win.eval(`loggedDist('sLong')`);
  console.log('Test 1 (loggedDist sums multiple fulfillment Activities, not just the first):',
    Math.abs(t1 - 9.25) < 0.001 ? 'PASS' : `FAIL (got ${t1}, expected 9.25)`);

  // Test 2: loggedDist sums the run + strides fulfillment pair for sEasy, but excludes the
  // accessory cool-down walk (5.16 + 0.75 = 5.91, not +1.14).
  const t2 = win.eval(`loggedDist('sEasy')`);
  console.log('Test 2 (loggedDist sums fulfillment Activities but excludes accessory ones):',
    Math.abs(t2 - 5.91) < 0.001 ? 'PASS' : `FAIL (got ${t2}, expected 5.91)`);

  // Test 3: sessionDurationSec has the identical bug/fix -- sums both fulfillment durations for sLong
  // (600 + 2800 = 3400s) instead of only the first Activity's duration.
  const t3 = win.eval(`sessionDurationSec('sLong')`);
  console.log('Test 3 (sessionDurationSec sums multiple fulfillment Activities\' durations):',
    t3 === 3400 ? 'PASS' : `FAIL (got ${t3}, expected 3400)`);

  // Test 4: cumulativeActualKm/weekActualKm (the block-wide "km logged" stat-grid figure) reflects the
  // summed totals once both sessions are marked done -- this is the actual number Dylon saw wrong on
  // the Progress tab.
  win.eval(`STATUS['sLong']='done'; STATUS['sEasy']='done';`);
  const t4 = win.eval(`cumulativeActualKm()`);
  console.log('Test 4 (cumulativeActualKm reflects the corrected per-session sums):',
    Math.abs(t4 - (9.25 + 5.91)) < 0.001 ? 'PASS' : `FAIL (got ${t4}, expected ${9.25+5.91})`);

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
