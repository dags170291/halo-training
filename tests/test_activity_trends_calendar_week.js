// Regression test for a real reported bug. Dylon: "in the activity trends i see my mobility that i
// upload dont get included. let's be clear activity trends is supposed to give data for all actities
// entering the app whether it is part of the training block or not." Root cause: weekMetricTotal()/
// weekDurationTotal() (and their day-by-day breakdown renderers) bucketed standalone EXTRALOGS/
// ACTIVITIES entries by weekForDate() -- which finds the nearest PLANNED session by date-diff. A
// standalone activity logged on a day with no nearby planned session in ITS OWN calendar week can get
// nearest-matched into an ADJACENT week instead (a real, reproducible bug: a week with a sparse plan
// can have its own late-week dates sit closer to next week's first session than to anything in its own
// week). The activity wasn't dropped -- it just silently landed in the wrong week's total, which reads
// identically to "not included" when checking the week you actually expect it in. Fix: a new
// trendCalWeek() buckets these by pure Monday-Sunday calendar-week math instead, with no dependency on
// nearby planned sessions at all. This test proves the exact scenario: a standalone Sunday activity that
// the OLD weekForDate() logic would have nearest-matched into the following week. (Note: this fixture's
// BLOCK_START, 2026-07-20, happens to already be a Monday, so it doesn't distinguish plain Monday
// bucketing from the "first Monday on-or-after BLOCK_START" refinement -- see
// test_activity_trends_block_start_anchor.js for the v0.34.6 fix covering a BLOCK_START that ISN'T a
// Monday, i.e. a real prep day before training actually starts.)
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

  // Week 1: Mon 2026-07-20 - Sun 2026-07-26 (one session, Wed 07-22). Week 2: Mon 2026-07-27 - Sun
  // 2026-08-02 (one session, Wed 07-29). A standalone mobility activity logged Sunday 2026-07-26 (the
  // LAST day of week 1) is 4 days from week1's own Wed session but only 3 days from week2's Wed
  // session -- the old nearest-session weekForDate() would misattribute it to week 2.
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-20',endDate:'2026-08-30',mileagePlan:{1:20,2:20},sessions:[
      {id:'w1s1',wk:1,d:'D1',ty:'easy',date:'2026-07-22',wd:'Wed',ti:'Easy Run',full:'Easy Run',det:'',dist:'5K'},
      {id:'w2s1',wk:2,d:'D1',ty:'easy',date:'2026-07-29',wd:'Wed',ti:'Easy Run',full:'Easy Run',det:'',dist:'5K'}
    ]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-20'; BLOCK_END='2026-08-30';
    STATUS={w1s1:'done',w2s1:'done'}; NOTES={w1s1:{dist:'5'},w2s1:{dist:'5'}};
    ACTIVITIES=[{id:'a1',type:'mobility',date:'2026-07-26',durationSec:1800,linkedSessionId:null,role:'unplanned'}];
    EXTRALOGS=[];
  `);

  // ---- Test 1: confirms the old bug would have existed -- weekForDate() (still used elsewhere, e.g.
  // Today's "coming up this week") nearest-matches the Sunday date to week 2, not week 1. ----
  const t1 = win.eval(`weekForDate('2026-07-26')`);
  console.log('Test 1 (weekForDate itself still nearest-matches the boundary date to week 2 -- confirms the old bug pattern is real):',
    t1===2 ? 'PASS' : 'FAIL', { t1 });

  // ---- Test 2: trendCalWeek(), the new Activity Trends-specific bucketing, correctly puts the same
  // date in week 1 -- pure calendar math, not nearest-session. ----
  const t2 = win.eval(`trendCalWeek('2026-07-26')`);
  console.log('Test 2 (trendCalWeek correctly buckets the same date into week 1 via calendar math):',
    t2===1 ? 'PASS' : 'FAIL', { t2 });

  // ---- Test 3: allWeeklyTotals('mob') now shows the mobility activity in week 1's total, not week 2's
  // -- the actual, reported "my mobility... dont get included" bug (in the week you'd expect it). ----
  const t3 = win.eval(`allWeeklyTotals('mob')`);
  console.log("Test 3 (Mobility trend total lands in week 1, matching the activity's real date, not week 2):",
    (t3[0]===1 && t3[1]===0) ? 'PASS' : 'FAIL', { t3 });

  // ---- Test 4: the week-1 day-by-day breakdown (what you see when you tap that week's dot) includes
  // the mobility activity's real date; week 2's breakdown does not. ----
  const wk1Breakdown = win.eval(`renderTrendDayRows(1,'mob')`);
  const wk2Breakdown = win.eval(`renderTrendDayRows(2,'mob')`);
  const t4Wk1HasIt = /Jul 26/.test(wk1Breakdown);
  const t4Wk2LacksIt = !/Jul 26/.test(wk2Breakdown);
  console.log('Test 4 (week 1 breakdown shows the mobility activity; week 2 breakdown does not):',
    (t4Wk1HasIt && t4Wk2LacksIt) ? 'PASS' : 'FAIL', { t4Wk1HasIt, t4Wk2LacksIt });

  // ---- Test 5: same fix applies to the Time view -- weekDurationTotal/renderTrendDurationDayRows use
  // trendCalWeek() too, so the activity's 30-minute duration lands in week 1's Time total, not week 2's.
  const durTotals = win.eval(`allWeeklyDurationHours('mob')`);
  const wk1DurBreakdown = win.eval(`renderTrendDurationDayRows(1,'mob')`);
  console.log('Test 5 (Time view: mobility duration lands in week 1, and its breakdown shows the real date):',
    (Math.abs(durTotals[0]-0.5)<0.001 && durTotals[1]===0 && /Jul 26/.test(wk1DurBreakdown)) ? 'PASS' : 'FAIL',
    { durTotals, wk1DurBreakdown });

  // ---- Test 6: a 'workout'-typed activity (the inferActivityType() fallback for a file with no GPS
  // and no recognizable sport string) is still correctly invisible to the Mobility trend specifically
  // -- this fix corrects WEEK attribution, it doesn't reinterpret an unrelated/ambiguous type as
  // Mobility. Confirms the scope of this fix is precise, not a blanket "count everything as mobility."
  win.eval(`ACTIVITIES=[{id:'a2',type:'workout',date:'2026-07-22',durationSec:1800,linkedSessionId:null,role:'unplanned'}];`);
  const t6 = win.eval(`allWeeklyTotals('mob')`);
  console.log("Test 6 (a 'workout'-typed activity, not explicitly Mobility, still doesn't count toward the Mobility trend):",
    (t6[0]===0 && t6[1]===0) ? 'PASS' : 'FAIL', { t6 });

  await wait(200);
  win.close();
})();
