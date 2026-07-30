// Regression test for a real reported bug. Dylon: "i have 2 strength sessions marked off but 1 only
// recorded i also have several post run mobility but those dont get loaded in and perhaps these
// sessions should be measured by total time for the week." Root cause, confirmed with a direct
// reproduction before this fix: sessionMetric()/weekDurationTotal() used to bail out entirely for a
// session once ANY fulfilling Activity was linked, trusting a SEPARATE loop in weekMetricTotal()/
// weekDurationTotal() to re-add that session's number by matching the fulfilling Activity's own `.type`
// field against the trend type being computed. That second match is fragile: an imported/logged
// Activity's `.type` is often something generic like 'workout' (inferActivityType()'s own fallback for
// a file with no GPS and no recognizable sport string -- exactly what an ambiguous strength/mobility
// file looks like), which doesn't match ANY trend type -- so a session with a real fulfilling Activity
// attached could silently drop out of Activity Trends entirely, even though loggedDist()/
// sessionDurationSec() (used elsewhere, and now here too) already correctly pull that Activity's real
// numbers with zero dependency on its own `.type` field. Fix: a session's own contribution always comes
// from sessionMetric()/sessionDurationSec() now (regardless of whether/how a fulfilling Activity is
// typed), and the Activities loop only independently adds non-fulfillment (accessory/standalone)
// Activities, so nothing is ever double-counted.
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

  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-20',endDate:'2026-09-27',mileagePlan:{1:20},sessions:[
      {id:'w1str1',wk:1,d:'D1',ty:'str',date:'2026-07-21',wd:'Tue',ti:'Strength',full:'Strength',det:'',dist:''},
      {id:'w1str2',wk:1,d:'D2',ty:'str',date:'2026-07-24',wd:'Fri',ti:'Strength',full:'Strength',det:'',dist:''}
    ]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-20'; BLOCK_END='2026-09-27';
    STATUS={w1str1:'done',w1str2:'done'}; NOTES={};
    ACTIVITIES=[]; EXTRALOGS=[];
  `);

  // ---- Test 1: 2 strength sessions marked done, neither linked to any Activity -- the real bug
  // report's exact starting point. Both should count. ----
  const t1 = win.eval(`weekMetricTotal(1,'str').total`);
  console.log('Test 1 (2 done strength sessions with no linked Activity both count):', t1===2 ? 'PASS' : 'FAIL', { t1 });

  // ---- Test 2: the exact bug -- session 2 gets a fulfilling Activity typed 'workout' (a totally
  // plausible real-world value: inferActivityType()'s own fallback for a file with no GPS/sport-string
  // match). Before the fix this silently dropped session 2 entirely (total: 1). ----
  win.eval(`ACTIVITIES=[{id:'a1',type:'workout',date:'2026-07-24',durationSec:2400,linkedSessionId:'w1str2',role:'fulfillment'}];`);
  const t2Vol = win.eval(`weekMetricTotal(1,'str').total`);
  const t2Dur = win.eval(`weekDurationTotal(1,'str').total`);
  console.log("Test 2 (a fulfilling Activity typed 'workout' no longer drops that session from Volume or Time):",
    (t2Vol===2 && t2Dur===2400) ? 'PASS' : 'FAIL', { t2Vol, t2Dur });

  // ---- Test 3: no double-counting -- when the fulfilling Activity IS correctly typed 'strength', the
  // session still counts exactly once (not twice via both the session loop and the Activities loop). ----
  win.eval(`ACTIVITIES=[{id:'a1',type:'strength',date:'2026-07-24',durationSec:2400,linkedSessionId:'w1str2',role:'fulfillment'}];`);
  const t3Vol = win.eval(`weekMetricTotal(1,'str').total`);
  const t3Dur = win.eval(`weekDurationTotal(1,'str').total`);
  console.log('Test 3 (a correctly-typed fulfilling Activity still counts its session exactly once, not twice):',
    (t3Vol===2 && t3Dur===2400) ? 'PASS' : 'FAIL', { t3Vol, t3Dur });

  // ---- Test 4: the run distance version of the same bug -- a run session fulfilled by an Activity
  // typed 'workout' (mismatched) used to lose its distance entirely; now loggedDist() (which doesn't
  // care about the Activity's own .type) supplies it directly via sessionMetric(). ----
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-20',endDate:'2026-09-27',mileagePlan:{1:20},sessions:[
      {id:'w1run',wk:1,d:'D1',ty:'easy',date:'2026-07-21',wd:'Tue',ti:'Easy Run',full:'Easy Run',det:'',dist:'5K'}
    ]}];
    DATA=BLOCKS[0].sessions;
    STATUS={w1run:'done'}; NOTES={};
    ACTIVITIES=[{id:'a2',type:'workout',date:'2026-07-21',distanceKm:6.2,durationSec:1800,linkedSessionId:'w1run',role:'fulfillment'}];
  `);
  const t4 = win.eval(`weekMetricTotal(1,'run').total`);
  console.log("Test 4 (a run session fulfilled by a 'workout'-typed Activity still reports its real distance):",
    t4===6.2 ? 'PASS' : 'FAIL', { t4 });

  // ---- Test 5: no double-count for run either -- a correctly-typed 'run' fulfilling Activity still
  // counts once (6.2km), not twice (12.4km). ----
  win.eval(`ACTIVITIES=[{id:'a2',type:'run',date:'2026-07-21',distanceKm:6.2,durationSec:1800,linkedSessionId:'w1run',role:'fulfillment'}];`);
  const t5 = win.eval(`weekMetricTotal(1,'run').total`);
  console.log('Test 5 (no double-counting for run with a correctly-typed fulfilling Activity):',
    t5===6.2 ? 'PASS' : 'FAIL', { t5 });

  // ---- Test 6: multi-fulfillment run (separate Easy Run + Strides files on the same session) still
  // sums together -- regression check against the earlier multi-fulfillment fix, unaffected by this
  // one. ----
  win.eval(`
    ACTIVITIES=[
      {id:'a3',type:'run',date:'2026-07-21',distanceKm:5,durationSec:1500,linkedSessionId:'w1run',role:'fulfillment'},
      {id:'a4',type:'run',date:'2026-07-21',distanceKm:0.5,durationSec:200,linkedSessionId:'w1run',role:'fulfillment'}
    ];
  `);
  const t6 = win.eval(`weekMetricTotal(1,'run').total`);
  console.log('Test 6 (multi-fulfillment run activities still sum together):', t6===5.5 ? 'PASS' : 'FAIL', { t6 });

  // ---- Test 7: post-run mobility attached as an ACCESSORY to a run session (a genuinely different
  // real-world activity from the run itself, e.g. Strava's own "add to activity" style workflow) still
  // counts toward Mobility's own Volume and Time, unaffected by the fulfillment-role filter (accessory
  // activities were never the source of the bug, and must stay included). ----
  win.eval(`
    STATUS={w1run:'done'}; NOTES={};
    ACTIVITIES=[{id:'a5',type:'mobility',date:'2026-07-21',durationSec:900,linkedSessionId:'w1run',role:'accessory'}];
  `);
  const t7Vol = win.eval(`weekMetricTotal(1,'mob').total`);
  const t7Dur = win.eval(`weekDurationTotal(1,'mob').total`);
  console.log('Test 7 (post-run mobility attached as an accessory still counts toward Mobility Volume and Time):',
    (t7Vol===1 && t7Dur===900) ? 'PASS' : 'FAIL', { t7Vol, t7Dur });

  // ---- Test 8: renderTrendDayRows/renderTrendDurationDayRows (the day-by-day breakdown, not just the
  // weekly total) reflect the same fix -- the mismatched-type strength session shows up in both. ----
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-20',endDate:'2026-09-27',mileagePlan:{1:20},sessions:[
      {id:'w1str1',wk:1,d:'D1',ty:'str',date:'2026-07-21',wd:'Tue',ti:'Strength',full:'Strength',det:'',dist:''},
      {id:'w1str2',wk:1,d:'D2',ty:'str',date:'2026-07-24',wd:'Fri',ti:'Strength',full:'Strength',det:'',dist:''}
    ]}];
    DATA=BLOCKS[0].sessions;
    STATUS={w1str1:'done',w1str2:'done'}; NOTES={};
    ACTIVITIES=[{id:'a1',type:'workout',date:'2026-07-24',durationSec:2400,linkedSessionId:'w1str2',role:'fulfillment'}];
  `);
  const volRows = win.eval(`renderTrendDayRows(1,'str')`);
  const durRows = win.eval(`renderTrendDurationDayRows(1,'str')`);
  const t8VolHasBoth = /Jul 21/.test(volRows) && /Jul 24/.test(volRows);
  const t8DurHasBoth = /Jul 21/.test(durRows) === false && /Jul 24/.test(durRows); // session 1 has no duration logged, only session 2 does
  console.log('Test 8 (day-by-day breakdown for both Volume and Time reflects the fix too):',
    (t8VolHasBoth && t8DurHasBoth) ? 'PASS' : 'FAIL', { volRows, durRows });

  await wait(200);
  win.close();
})();
