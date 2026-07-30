// Regression test for a real reported bug. Dylon, with real numbers that didn't reconcile: "week 1 my
// total run was 28.1 Km and week 2 is 20.3 but my total km logged is 53.1 doesnt seem correct."
// Root cause: loggedDist() (which drives cumulativeActualKm(), the "km logged / N planned" stat) and
// sessionDurationSec() (which drives totalLoggedTimeSec(), "Total time logged") both checked a
// session's own hand-typed NOTES value (n.dist / n.duration) FIRST, only falling back to a linked
// fulfilling Activity's real value if the hand-typed field was empty. But sessionMetric() -- which
// drives the weekly Activity Trends chart (Weekly Volume) -- does the opposite: once ANY fulfilling
// Activity is linked to a session, it defers to the activity's own value entirely and ignores the
// session's hand-typed NOTES completely, regardless of whether NOTES still has an old value sitting in
// it. So a session that kept a stale/original hand-typed distance around from before it got a real
// fulfilling Activity linked (a completely normal, common sequence: log an estimate, later import the
// real GPS file and link it) reported two different numbers depending on which code path read it --
// the "km logged" stat clung to the stale hand-typed figure, the weekly trend chart used the accurate
// one -- diverging for a reason that had nothing to do with their real, intentional difference in
// SCOPE (plan-linked-only vs. everything logged this week). Fix: loggedDist()/sessionDurationSec() now
// check for a fulfilling Activity FIRST, matching sessionMetric()'s own priority, and only fall back to
// the session's hand-typed NOTES value when no fulfilling Activity is linked at all.
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
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-19',endDate:'2026-09-27',mileagePlan:{1:20,2:20},sessions:[
      {id:'w1s1',wk:1,d:'D1',ty:'easy',date:'2026-07-20',wd:'Mon',ti:'Easy Run',full:'Easy Run',det:'',dist:'5K'},
      {id:'w1s2',wk:1,d:'D2',ty:'easy',date:'2026-07-22',wd:'Wed',ti:'Easy Run',full:'Easy Run',det:'',dist:'5K'}
    ]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-19'; BLOCK_END='2026-09-27';
    STATUS={w1s1:'done',w1s2:'done'};
    // w1s1 kept a stale hand-typed 5km distance/28min duration from before it got a real fulfilling
    // Activity linked -- the activity's own real numbers (6.2km/32min) are the accurate ones.
    NOTES={w1s1:{dist:'5',duration:'28:00'},w1s2:{dist:'5',duration:'27:00'}};
    ACTIVITIES=[{id:'a1',type:'run',date:'2026-07-20',distanceKm:6.2,durationSec:1920,linkedSessionId:'w1s1',role:'fulfillment'}];
    EXTRALOGS=[];
  `);

  // ---- Test 1: loggedDist() now returns the fulfilling Activity's real distance (6.2), not the
  // stale hand-typed 5km -- the exact asymmetry behind the reported bug. ----
  const t1 = win.eval(`loggedDist('w1s1')`);
  console.log("Test 1 (loggedDist prefers a fulfilling Activity's real distance over stale hand-typed NOTES.dist):",
    t1===6.2 ? 'PASS' : 'FAIL', { t1 });

  // ---- Test 2: sessionDurationSec() now returns the fulfilling Activity's real duration (1920s =
  // 32:00), not the stale hand-typed 28:00. ----
  const t2 = win.eval(`sessionDurationSec('w1s1')`);
  console.log("Test 2 (sessionDurationSec prefers a fulfilling Activity's real duration over stale hand-typed NOTES.duration):",
    t2===1920 ? 'PASS' : 'FAIL', { t2 });

  // ---- Test 3: cumulativeActualKm() (the "km logged" stat) now reflects the same real activity
  // distance (6.2 + 5 = 11.2), matching what sessionMetric()/the weekly trend chart already counted
  // for this same week -- the two numbers reconcile now. ----
  const t3Cumulative = win.eval(`cumulativeActualKm()`);
  const t3TrendWeek1 = win.eval(`weekMetricTotal(1,'run').total`);
  console.log("Test 3 (cumulativeActualKm now matches the weekly Run trend total for the same week -- the reported \"doesn't add up\" bug):",
    (t3Cumulative===11.2 && t3TrendWeek1===11.2 && t3Cumulative===t3TrendWeek1) ? 'PASS' : 'FAIL',
    { t3Cumulative, t3TrendWeek1 });

  // ---- Test 4: a session with NO fulfilling Activity still falls back to its own hand-typed
  // NOTES.dist exactly as before -- this fix only changes the priority WHEN a fulfilling Activity
  // exists, it doesn't remove the hand-typed fallback entirely. ----
  const t4 = win.eval(`loggedDist('w1s2')`);
  console.log('Test 4 (a session with no fulfilling Activity still falls back to its own hand-typed NOTES.dist):',
    t4===5 ? 'PASS' : 'FAIL', { t4 });

  // ---- Test 5: same fallback check for sessionDurationSec on the unfulfilled session. ----
  const t5 = win.eval(`sessionDurationSec('w1s2')`);
  console.log('Test 5 (a session with no fulfilling Activity still falls back to its own hand-typed NOTES.duration):',
    t5===1620 ? 'PASS' : 'FAIL', { t5 });

  // ---- Test 6: a session with NO hand-typed NOTES at all, fulfilled purely by a linked Activity,
  // still correctly reports that activity's real numbers (regression check for the original bug this
  // fallback chain was built for -- not the one being fixed here). ----
  win.eval(`
    BLOCKS[0].sessions.push({id:'w1s3',wk:1,d:'D3',ty:'easy',date:'2026-07-24',wd:'Fri',ti:'Easy Run',full:'Easy Run',det:'',dist:'5K'});
    STATUS.w1s3='done'; NOTES.w1s3={};
    ACTIVITIES.push({id:'a2',type:'run',date:'2026-07-24',distanceKm:4.5,durationSec:1500,linkedSessionId:'w1s3',role:'fulfillment'});
  `);
  const t6Dist = win.eval(`loggedDist('w1s3')`);
  const t6Dur = win.eval(`sessionDurationSec('w1s3')`);
  console.log("Test 6 (a session with no hand-typed NOTES at all still reports its fulfilling Activity's real numbers):",
    (t6Dist===4.5 && t6Dur===1500) ? 'PASS' : 'FAIL', { t6Dist, t6Dur });

  // ---- Test 7: multiple fulfilling Activities on the same session still SUM together, not just the
  // first -- regression check that the earlier "only counted the first fulfillment Activity" fix
  // (test_multi_fulfillment_mileage.js) wasn't disturbed by reordering the priority check. ----
  win.eval(`
    BLOCKS[0].sessions.push({id:'w1s4',wk:1,d:'D4',ty:'easy',date:'2026-07-25',wd:'Sat',ti:'Easy Run',full:'Easy Run',det:'',dist:'8K'});
    STATUS.w1s4='done'; NOTES.w1s4={dist:'3'};
    ACTIVITIES.push({id:'a3',type:'run',date:'2026-07-25',distanceKm:2.0,durationSec:600,linkedSessionId:'w1s4',role:'fulfillment'});
    ACTIVITIES.push({id:'a4',type:'run',date:'2026-07-25',distanceKm:5.5,durationSec:1650,linkedSessionId:'w1s4',role:'fulfillment'});
  `);
  const t7 = win.eval(`loggedDist('w1s4')`);
  console.log('Test 7 (multiple fulfilling Activities on the same session still sum together, not just the first):',
    t7===7.5 ? 'PASS' : 'FAIL', { t7 });

  await wait(200);
  win.close();
})();
