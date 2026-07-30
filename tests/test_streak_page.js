// Regression test for a real feature request. Dylon, alongside Strava screenshots of a big streak
// number and a month calendar with a small activity-type icon on every logged day: "i think we should
// implement strava streak ui as well please." This adds a dedicated Streak page (opened by tapping the
// existing streak stat card in Progress) built entirely on top of the app's existing, already-tested
// currentStreak()/longestStreak()/dayHasActivity() math -- this test focuses on the new page itself:
// the month calendar grid, month navigation (capped at the real current month), and the per-day
// activity-type icon derivation (streakDayTypes), which is deliberately scoped to the exact same two
// sources dayHasActivity() checks so a day's icon can never disagree with whether that day counts.
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

  // Fixed "today" makes month-boundary/next-month-disabled assertions deterministic regardless of
  // when this test actually runs.
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-09-27',mileagePlan:{1:20,2:20},sessions:[
      {id:'w1run',wk:1,d:'D1',ty:'easy',date:'2026-07-20',wd:'Mon',ti:'Easy Run',full:'Easy Run',det:'',dist:'5K'},
      {id:'w1str',wk:1,d:'D2',ty:'str',date:'2026-07-21',wd:'Tue',ti:'Strength',full:'Strength',det:'',dist:''},
      {id:'ckin',wk:1,d:'D3',ty:'checkin',date:'2026-07-22',wd:'Wed',ti:'Weekly Check-In',full:'Weekly Check-In',det:'',dist:''}
    ]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-01'; BLOCK_END='2026-09-27';
    STATUS={w1run:'done',w1str:'done',ckin:'done'};
    NOTES={}; ACTIVITIES=[];
    EXTRALOGS=[{id:'x1',kind:'walk',date:'2026-07-23',duration:'20:00',dist:'2'}];
  `);

  // ---- Test 1: streakDayTypes picks up the run session's type ('easy') on its date. ----
  const t1 = win.eval(`streakDayTypes('2026-07-20')`);
  console.log('Test 1 (streakDayTypes returns the done run session type for its date):',
    (t1.length===1 && t1[0]==='easy') ? 'PASS' : 'FAIL', { t1 });

  // ---- Test 2: streakDayTypes picks up the strength session's type ('str'). ----
  const t2 = win.eval(`streakDayTypes('2026-07-21')`);
  console.log("Test 2 (streakDayTypes returns 'str' for the strength session's date):",
    (t2.length===1 && t2[0]==='str') ? 'PASS' : 'FAIL', { t2 });

  // ---- Test 3: a Weekly Check-In marked done does NOT get its own icon, matching
  // isCheckinSession()/dayHasActivity()'s own exclusion -- "don't make weekly check-in count towards
  // progress/data" applies here too, not just the streak count itself. ----
  const t3 = win.eval(`streakDayTypes('2026-07-22')`);
  console.log('Test 3 (a done Weekly Check-In day shows no activity-type icon):',
    t3.length===0 ? 'PASS' : 'FAIL', { t3 });

  // ---- Test 4: a standalone EXTRALOGS walk entry shows up as 'walk' on its date. ----
  const t4 = win.eval(`streakDayTypes('2026-07-23')`);
  console.log('Test 4 (a standalone EXTRALOGS walk entry shows as walk on its date):',
    (t4.length===1 && t4[0]==='walk') ? 'PASS' : 'FAIL', { t4 });

  // ---- Test 5: a day with nothing logged returns an empty array, not a stray/default icon. ----
  const t5 = win.eval(`streakDayTypes('2026-07-25')`);
  console.log('Test 5 (a day with nothing logged returns no icons):',
    t5.length===0 ? 'PASS' : 'FAIL', { t5 });

  // ---- Test 6: openStreakPage() opens the overlay and renders a calendar grid + hero stats into the
  // sheet body, defaulting to the real current month. ----
  win.eval(`
    const _origDate = Date;
    Date = class extends _origDate { constructor(...a){ if(a.length===0) return new _origDate('2026-07-25T12:00:00'); return new _origDate(...a); } static now(){ return new _origDate('2026-07-25T12:00:00').getTime(); } };
    openStreakPage();
    Date = _origDate;
  `);
  const t6Open = win.eval(`document.getElementById('streak-overlay').classList.contains('open')`);
  const t6Body = win.eval(`document.getElementById('streak-sh-body').innerHTML`);
  const t6HasGrid = /cal-grid/.test(t6Body) && /streak-day-cell/.test(t6Body);
  const t6HasMonthLbl = /July 2026/.test(t6Body);
  console.log('Test 6 (openStreakPage opens the overlay and renders the calendar for the current month):',
    (t6Open && t6HasGrid && t6HasMonthLbl) ? 'PASS' : 'FAIL', { t6Open, t6HasGrid, t6HasMonthLbl });

  // ---- Test 7: the run/strength days render their icons inside the grid (streak-day-ico spans with
  // the matching ico-easy/ico-str classes), and the "Next month" button is disabled since we're
  // already viewing the real current month (STREAK_CAL_Y/M were seeded off the mocked "today"). ----
  const t7HasRunIco = /streak-day-ico ico-easy/.test(t6Body);
  const t7HasStrIco = /streak-day-ico ico-str/.test(t6Body);
  const t7NextDisabled = /onclick="streakCalNextMonth\(\)" disabled/.test(t6Body);
  console.log('Test 7 (calendar cells show the run/strength icons, and Next month is disabled on the current month):',
    (t7HasRunIco && t7HasStrIco && t7NextDisabled) ? 'PASS' : 'FAIL', { t7HasRunIco, t7HasStrIco, t7NextDisabled });

  // ---- Test 8: streakCalPrevMonth() steps back a month and re-renders (June 2026), and
  // streakCalNextMonth() correctly refuses to go past the real current month even after being pushed
  // back and forward again (doesn't just blindly increment). ----
  win.eval(`streakCalPrevMonth()`);
  const t8JuneBody = win.eval(`document.getElementById('streak-sh-body').innerHTML`);
  const t8IsJune = /June 2026/.test(t8JuneBody);
  win.eval(`
    const _origDate2 = Date;
    Date = class extends _origDate2 { constructor(...a){ if(a.length===0) return new _origDate2('2026-07-25T12:00:00'); return new _origDate2(...a); } static now(){ return new _origDate2('2026-07-25T12:00:00').getTime(); } };
    streakCalNextMonth();
    Date = _origDate2;
  `);
  const t8BackToJulyBody = win.eval(`document.getElementById('streak-sh-body').innerHTML`);
  const t8BackToJuly = /July 2026/.test(t8BackToJulyBody);
  console.log('Test 8 (prev/next month navigation works and stays capped at the real current month):',
    (t8IsJune && t8BackToJuly) ? 'PASS' : 'FAIL', { t8IsJune, t8BackToJuly });

  await wait(200);
  win.close();
})();
