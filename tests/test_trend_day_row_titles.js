// Regression test for adding the contributing session/activity's own name to each Activity Trends
// day-by-day breakdown row, and making that row clickable straight into it. Dylon, looking at a
// screenshot of the Time view's Week 1 breakdown with two arrows pointing at the wide empty gap between
// the date and the number on each row: "it's a bit empty... put the name of the planned workout
// session... make it clickable, so when I click it, it can go directly to the session that it is linked
// to." He also flagged the nuance himself -- "these activities are drawn to output the name of the
// workout session in there as well" -- since a single day's row can be a SUM of more than one real
// source (a planned session + a standalone extra + an imported Activity all on the same date). The fix
// only shows/links the FIRST contributor to a given date, matching the priority order these functions
// already use elsewhere: a real planned session's own title wins over a same-day Quick Add extra, which
// wins over a same-day imported Activity.
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
      {id:'w1d1',wk:1,d:'D1',ty:'easy',date:'2026-07-20',wd:'Mon',ti:'Easy Run',full:'',det:'',dist:'6K'},
      {id:'w1d2',wk:1,d:'D2',ty:'str',date:'2026-07-21',wd:'Tue',ti:'Gym Strength Circuit',full:'',det:'',dist:''}
    ]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-20'; BLOCK_END='2026-09-27';
    STATUS={w1d1:'done',w1d2:'done'}; NOTES={w1d1:{dist:'6.2',duration:'32:00'}};
    ACTIVITIES=[]; EXTRALOGS=[];
  `);

  // ---- Test 1: the Run day row for Mon 20 (a real planned session) shows the session's own title
  // ("Easy Run"), and the row is clickable (onclick calls openLog with that session's real id). ----
  const volRows = win.eval(`renderTrendDayRows(1,'run')`);
  const t1HasTitle = /Easy Run/.test(volRows);
  const t1Clickable = /onclick="openLog\('w1d1'\)"/.test(volRows);
  console.log("Test 1 (a planned session's Run day row shows its own title and opens that session on tap):",
    (t1HasTitle && t1Clickable) ? 'PASS' : 'FAIL', { t1HasTitle, t1Clickable });

  // ---- Test 2: the Strength day row for Tue 21 shows that session's own real title ("Gym Strength
  // Circuit", not a generic "Strength" label), also clickable to that same session. ----
  const strVolRows = win.eval(`renderTrendDayRows(1,'str')`);
  const t2HasTitle = /Gym Strength Circuit/.test(strVolRows);
  const t2Clickable = /onclick="openLog\('w1d2'\)"/.test(strVolRows);
  console.log("Test 2 (a Strength session's day row shows its own real title, not a generic label):",
    (t2HasTitle && t2Clickable) ? 'PASS' : 'FAIL', { t2HasTitle, t2Clickable });

  // ---- Test 3: the same title/click-through applies to the Time view (renderTrendDurationDayRows),
  // not just Weekly Volume -- this was the exact screen in Dylon's screenshot. ----
  const durRows = win.eval(`renderTrendDurationDayRows(1,'run')`);
  const t3HasTitle = /Easy Run/.test(durRows);
  const t3Clickable = /onclick="openLog\('w1d1'\)"/.test(durRows);
  console.log('Test 3 (the Time view day row also shows the title and click-through, not just Volume):',
    (t3HasTitle && t3Clickable) ? 'PASS' : 'FAIL', { t3HasTitle, t3Clickable });

  // ---- Test 4: a standalone imported Activity with no linked session (nothing planned that day) still
  // gets its own name shown and opens straight to that Activity's own detail page. ----
  win.eval(`
    ACTIVITIES=[{id:'act1',type:'run',role:'unplanned',date:'2026-07-23',distanceKm:5,durationSec:1800,title:'Trail Loop'}];
  `);
  const standaloneRows = win.eval(`renderTrendDayRows(1,'run')`);
  const t4HasTitle = /Trail Loop/.test(standaloneRows);
  const t4Clickable = /onclick="openActivityDetail\('act1'\)"/.test(standaloneRows);
  console.log('Test 4 (a standalone imported Activity with no session shows its own name and opens its own detail page):',
    (t4HasTitle && t4Clickable) ? 'PASS' : 'FAIL', { t4HasTitle, t4Clickable });

  // ---- Test 5: when BOTH a planned session AND a standalone Activity land on the same date, the
  // session's own title wins (matches priority order elsewhere: a real planned session always takes
  // precedence over a same-day standalone extra/Activity). ----
  win.eval(`
    ACTIVITIES=[{id:'act2',type:'run',role:'unplanned',date:'2026-07-20',distanceKm:2,durationSec:600,title:'Bonus Shakeout'}];
  `);
  const mergedRows = win.eval(`renderTrendDayRows(1,'run')`);
  const t5SessionWins = /Easy Run/.test(mergedRows) && !/Bonus Shakeout/.test(mergedRows);
  console.log("Test 5 (when a session and a standalone Activity share a date, the session's own title wins):",
    t5SessionWins ? 'PASS' : 'FAIL', { mergedRows });

  await wait(200);
  win.close();
})();
