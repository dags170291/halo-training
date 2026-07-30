// Regression test for a real feature request. Dylon: "strava has time in activity I will like a
// graph that shows time per activity (Run, walk, Strength, and Mobility)." This adds a Time view to
// the existing Activity Trends card: Run gets a 4th subtab ("Time") alongside its existing Weekly
// Volume/Pace vs HR/Pace by Distance tabs (via CURR_RUN_SUBTAB==='time'), while Walk/Strength/Mobility
// -- which have no subtabs at all today -- get a new, simpler Weekly Volume/Time toggle via a new
// shared CURR_TREND_METRIC state variable. Weight is excluded (no meaningful "duration" concept for a
// body-weight entry). This test covers the new data functions (sessionMatchesTrendType,
// weekDurationTotal, allWeeklyDurationHours, renderTrendDurationDayRows) and the new UI branches in
// renderProgress() (the subtab row itself, and the combined Time-view render branch).
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
      {id:'w1run',wk:1,d:'D1',ty:'easy',date:'2026-07-20',wd:'Mon',ti:'Easy Run',full:'Easy Run',det:'',dist:'5K'},
      {id:'w1str',wk:1,d:'D2',ty:'str',date:'2026-07-21',wd:'Tue',ti:'Strength',full:'Strength',det:'',dist:''},
      {id:'w1mob',wk:1,d:'D3',ty:'mobility',date:'2026-07-22',wd:'Wed',ti:'Mobility',full:'Mobility',det:'',dist:''}
    ]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-19'; BLOCK_END='2026-09-27';
    STATUS={w1run:'done',w1str:'done',w1mob:'done'};
    NOTES={w1run:{duration:'30:00'},w1str:{duration:'45:00'},w1mob:{duration:'15:00'}};
    ACTIVITIES=[];
    EXTRALOGS=[{id:'x1',kind:'walk',date:'2026-07-23',duration:'20:00',dist:'2'}];
  `);

  // ---- Test 1: sessionMatchesTrendType correctly buckets session types (run/str/mob types match,
  // unrelated ones don't). ----
  const t1Run = win.eval(`sessionMatchesTrendType({ty:'easy'},'run')`);
  const t1Str = win.eval(`sessionMatchesTrendType({ty:'str'},'str')`);
  const t1Mob = win.eval(`sessionMatchesTrendType({ty:'mobility'},'mob')`);
  const t1NoMatch = win.eval(`sessionMatchesTrendType({ty:'easy'},'str')`);
  console.log('Test 1 (sessionMatchesTrendType buckets run/str/mob session types correctly):',
    (t1Run && t1Str && t1Mob && !t1NoMatch) ? 'PASS' : 'FAIL', { t1Run, t1Str, t1Mob, t1NoMatch });

  // ---- Test 2: weekDurationTotal sums the run session's hand-typed duration (30:00 = 1800s) for
  // week 1's 'run' type. ----
  const t2 = win.eval(`weekDurationTotal(1,'run')`);
  console.log('Test 2 (weekDurationTotal sums run session duration for week 1):',
    (t2.total===1800 && t2.any) ? 'PASS' : 'FAIL', t2);

  // ---- Test 3: weekDurationTotal for 'str' picks up the strength session's 45:00 = 2700s. ----
  const t3 = win.eval(`weekDurationTotal(1,'str')`);
  console.log('Test 3 (weekDurationTotal sums strength session duration for week 1):',
    (t3.total===2700 && t3.any) ? 'PASS' : 'FAIL', t3);

  // ---- Test 4: weekDurationTotal for 'walk' picks up the standalone EXTRALOGS walk entry (1200s),
  // since walk has no plan session type of its own -- it's always logged as a quick add / activity. ----
  const t4 = win.eval(`weekDurationTotal(1,'walk')`);
  console.log('Test 4 (weekDurationTotal picks up a standalone walk EXTRALOGS entry):',
    (t4.total===1200 && t4.any) ? 'PASS' : 'FAIL', t4);

  // ---- Test 5: allWeeklyDurationHours returns hours (not seconds) for each week, matching
  // weekDurationTotal/3600. ----
  const t5 = win.eval(`allWeeklyDurationHours('run')[0]`);
  console.log('Test 5 (allWeeklyDurationHours converts week 1 run seconds to hours: 1800/3600=0.5):',
    t5===0.5 ? 'PASS' : 'FAIL', { t5 });

  // ---- Test 6: renderTrendDurationDayRows renders a day row with the formatted duration (fmtHoursMin)
  // for the run session on its date. ----
  const t6Html = win.eval(`renderTrendDurationDayRows(1,'run')`);
  console.log('Test 6 (renderTrendDurationDayRows renders the run day with its formatted duration):',
    /30m/.test(t6Html) ? 'PASS' : 'FAIL', { t6Html });

  // ---- Test 7: renderProgress's subtab row gives Run a 4th "Time" tab, and gives Walk/Str/Mob their
  // own Weekly Volume/Time toggle when selected. ----
  win.eval(`CURR_VIEW='progress'; CURR_TREND='run'; CURR_RUN_SUBTAB='time'; CURR_TREND_WK=null; renderProgress();`);
  const t7Trends = win.eval(`document.getElementById('view-progress').querySelector('.run-subtabs') ? document.getElementById('view-progress').querySelector('.run-subtabs').outerHTML : ''`);
  const t7HasTimeTab = /selectRunSubtab\('time'\)/.test(t7Trends) && />Time</.test(t7Trends);
  console.log('Test 7 (Run subtab row includes a 4th "Time" tab):',
    t7HasTimeTab ? 'PASS' : 'FAIL', { t7Trends });

  win.eval(`CURR_TREND='str'; CURR_TREND_METRIC='vol'; CURR_TREND_WK=null; renderProgress();`);
  const t7StrTrends = win.eval(`document.getElementById('view-progress').querySelector('.run-subtabs') ? document.getElementById('view-progress').querySelector('.run-subtabs').outerHTML : ''`);
  const t7StrHasToggle = /selectTrendMetric\('vol'\)/.test(t7StrTrends) && /selectTrendMetric\('time'\)/.test(t7StrTrends);
  console.log('Test 8 (Strength trend shows a Weekly Volume/Time toggle via CURR_TREND_METRIC):',
    t7StrHasToggle ? 'PASS' : 'FAIL', { t7StrTrends });

  // ---- Test 9: switching Strength to the Time metric renders the duration-based stat (45m, from the
  // week 1 strength session) rather than a distance/rep-based stat. ----
  win.eval(`CURR_TREND='str'; CURR_TREND_METRIC='time'; CURR_TREND_WK=null; renderProgress();`);
  const t9Card = win.eval(`document.getElementById('view-progress').innerHTML`);
  const t9Has45m = /45m/.test(t9Card);
  console.log('Test 9 (switching Strength to Time metric shows the 45m duration stat):',
    t9Has45m ? 'PASS' : 'FAIL', { snippet: t9Card.length });

  await wait(200);
  win.close();
})();
