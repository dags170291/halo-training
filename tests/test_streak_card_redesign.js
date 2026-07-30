// Regression test spanning six rounds of follow-up requests on the v0.34.0 streak page. Round 1
// (v0.34.1), Dylon: "add a right chevron... track both daily and weekly streaks in the same card...
// split that card into week and day" -- shipped as a full-width card. Round 2 (v0.34.2), Dylon: "the
// streak card is to remain the same size as the other cards in the grid" -- moved back into the
// 2-column .stat-grid as a compact chevron+mini-split cell. Round 3 (v0.34.3), Dylon: "there is enough
// room for the icon, please put it back" -- a bare 18px flame added back with no colored background.
// Round 4 (v0.34.4), Dylon on where that whole chain landed: "the streak card the icon is now too small
// and the you removed the colour. all that was required was to add the week streaks in place of the sub
// text" -- reverted to the original single-hero-number grid cell. Round 5 (v0.34.6), Dylon designed and
// sent his own exact mockup instead of describing it in words: "you wasnt getting the streak card right
// so i designed it my self here is the design you are to use" -- shipped as a wide standalone hero card
// (icon badge, big "N DAYS", a divider, "N WEEKS" underneath, a chevron on the right) on a soft amber
// gradient, outside .stat-grid entirely. Round 6 (v0.34.7), Dylon: "the streak card is too wide it
// should be the same size as the other grid items without changeing the design" -- same exact design
// (badge/N DAYS/divider/N WEEKS/chevron, same amber gradient) put back into a normal .stat-grid cell
// (class="stat-card stat-card-streak"), just scaled down to fit the grid's own card width instead of a
// full-width row. This covers: (1) the currentWeekStreak()/longestWeekStreak() functions (a week counts
// if ANY day inside it has activity, mirroring dayHasActivity()'s own day-streak rule), (2) the Progress
// streak card in its v0.34.7 grid-cell form, and (3) the Streak page's own hero, which keeps its fuller
// Day/Week split (unaffected by this round -- that page always had the room the compact card never did).
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

  // Fixed "today" (Sat 2026-07-25, week of Mon 2026-07-20) for deterministic streak math.
  win.eval(`
    const _origDate = Date;
    Date = class extends _origDate { constructor(...a){ if(a.length===0) return new _origDate('2026-07-25T12:00:00'); return new _origDate(...a); } static now(){ return new _origDate('2026-07-25T12:00:00').getTime(); } };
  `);
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-06',endDate:'2026-09-27',mileagePlan:{1:20,2:20,3:20},sessions:[
      {id:'w1s1',wk:1,d:'D1',ty:'easy',date:'2026-07-08',wd:'Wed',ti:'Easy Run',full:'Easy Run',det:'',dist:'5K'},
      {id:'w2s1',wk:2,d:'D1',ty:'easy',date:'2026-07-15',wd:'Wed',ti:'Easy Run',full:'Easy Run',det:'',dist:'5K'},
      {id:'w3s1',wk:3,d:'D1',ty:'easy',date:'2026-07-22',wd:'Wed',ti:'Easy Run',full:'Easy Run',det:'',dist:'5K'}
    ]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-06'; BLOCK_END='2026-09-27';
    STATUS={w1s1:'done',w2s1:'done',w3s1:'done'}; NOTES={};
    ACTIVITIES=[]; EXTRALOGS=[];
  `);

  // ---- Test 1: weekHasActivity is true for a week containing a done session, false for an empty one.
  const t1True = win.eval(`weekHasActivity('2026-07-20')`); // week of w3s1 (07-22)
  const t1False = win.eval(`weekHasActivity('2026-08-03')`); // a week with nothing logged
  console.log('Test 1 (weekHasActivity is true for a week with a done session, false for an empty week):',
    (t1True===true && t1False===false) ? 'PASS' : 'FAIL', { t1True, t1False });

  // ---- Test 2: currentWeekStreak counts 3 consecutive weeks each with one done session (07-08,
  // 07-15, 07-22 -- "today" 07-25 sits in the third of these weeks). ----
  const t2 = win.eval(`currentWeekStreak()`);
  console.log('Test 2 (currentWeekStreak counts 3 consecutive weeks with activity):', t2===3 ? 'PASS' : 'FAIL', { t2 });

  // ---- Test 3: longestWeekStreak matches the current streak here (no gap weeks yet). ----
  const t3 = win.eval(`longestWeekStreak()`);
  console.log('Test 3 (longestWeekStreak matches currentWeekStreak with no gap weeks):', t3===3 ? 'PASS' : 'FAIL', { t3 });

  // ---- Test 4: a gap week (week 2 not done) breaks the week streak down to 1 (only the current week
  // counts), proving weekHasActivity -- not just "every single day" -- drives this. ----
  win.eval(`STATUS.w2s1='missed';`);
  const t4 = win.eval(`currentWeekStreak()`);
  console.log('Test 4 (a gap week breaks the week streak):', t4===1 ? 'PASS' : 'FAIL', { t4 });
  win.eval(`STATUS.w2s1='done';`); // restore for the render tests below

  // ---- Test 5: v0.34.7 -- Dylon's exact mockup design (icon badge, big "N DAYS", a divider, "N WEEKS"
  // underneath, a chevron on the right, amber gradient) now lives inside a normal .stat-grid cell again
  // ("the streak card is too wide it should be the same size as the other grid items without changeing
  // the design"). Confirm: it's rendered as class="stat-card stat-card-streak" (back inside the grid,
  // sharing .stat-card's own base sizing/padding), still with a real colored icon badge
  // (.streak-hero-badge wrapping the same STREAK_ICON svg path used on the Streak page), a big
  // "N DAYS"/"N WEEKS" pair with a divider between them, and a trailing chevron -- every element from
  // the mockup preserved, just no longer a full-width standalone .streak-hero-card row. ----
  win.eval(`CURR_VIEW='progress'; renderProgress();`);
  const progressHTML = win.eval(`document.getElementById('view-progress').innerHTML`);
  const t5NoOldText = !/Current streak/.test(progressHTML);
  const t5NoFullWidthCard = !/class="streak-hero-card"/.test(progressHTML) && !/class="streak-badge"/.test(progressHTML) && !/streak-mini-/.test(progressHTML);
  const t5IsGridCell = /class="stat-card stat-card-streak" onclick="openStreakPage\(\)"/.test(progressHTML);
  const t5HasColoredBadge = /class="streak-hero-badge"/.test(progressHTML) && /M240-400q0 52 21 98\.5/.test(progressHTML);
  const t5HasDivider = /class="streak-hero-div"/.test(progressHTML);
  const t5HasChevron = /class="streak-hero-chevron"/.test(progressHTML);
  // The streak card's own day/week text: "<N> DAY(S)" and "<M> WEEK(S)".
  const t5HasDaysWeeks = /class="streak-hero-days">\d+ DAYS?</.test(progressHTML) && /class="streak-hero-weeks">\d+ WEEKS?</.test(progressHTML);
  console.log('Test 5 (Progress streak card keeps Dylon\'s exact mockup design -- colored icon badge, N DAYS / divider / N WEEKS, chevron -- but now sized as a normal .stat-grid cell):',
    (t5NoOldText && t5NoFullWidthCard && t5IsGridCell && t5HasColoredBadge && t5HasDivider && t5HasChevron && t5HasDaysWeeks) ? 'PASS' : 'FAIL',
    { t5NoOldText, t5NoFullWidthCard, t5IsGridCell, t5HasColoredBadge, t5HasDivider, t5HasChevron, t5HasDaysWeeks });

  // ---- Test 6: the streak card is clickable (onclick="openStreakPage()"), same entry point as before
  // the redesign. ----
  const t6 = /class="stat-card stat-card-streak" onclick="openStreakPage\(\)"/.test(progressHTML);
  console.log('Test 6 (the resized card still opens the Streak page on tap):', t6 ? 'PASS' : 'FAIL');

  // ---- Test 8: v0.34.8 -- Dylon, testing locally: "the streak card still isnt designed properly the
  // main streak can be larger to match the other cards and the weeks treak to match the sub text."
  // v0.34.7's resize shrank the text well past the grid's own type scale. Confirm .streak-hero-days
  // (the "N DAYS" number) uses the EXACT same font-size as .stat-num (the big number on every other
  // stat card, e.g. "47.2" or "13/90"), and .streak-hero-weeks (the "N WEEKS" line) uses the exact same
  // font-size as .stat-lbl (the small caption under every other stat card, e.g. "Sessions logged") --
  // read directly from the stylesheet source so this can't silently regress to a smaller custom size
  // again. ----
  const statNumSize = html.match(/\.stat-num\{[^}]*font-size:([\d.]+px)/)?.[1];
  const statLblSize = html.match(/\.stat-lbl\{[^}]*font-size:([\d.]+px)/)?.[1];
  const heroDaysSize = html.match(/\.streak-hero-days\{[^}]*font-size:([\d.]+px)/)?.[1];
  const heroWeeksSize = html.match(/\.streak-hero-weeks\{[^}]*font-size:([\d.]+px)/)?.[1];
  const t8 = !!statNumSize && !!statLblSize && heroDaysSize === statNumSize && heroWeeksSize === statLblSize;
  console.log('Test 8 (streak card\'s "N DAYS" number matches .stat-num\'s font-size, "N WEEKS" matches .stat-lbl\'s):',
    t8 ? 'PASS' : 'FAIL', { statNumSize, statLblSize, heroDaysSize, heroWeeksSize });

  // ---- Test 7: the Streak page's own hero now shows the same Day streak / Week streak split (with
  // each one's own "Longest: N" line), not just a single day-streak number. ----
  win.eval(`openStreakPage();`);
  const streakBody = win.eval(`document.getElementById('streak-sh-body').innerHTML`);
  const t7HasDayCol = /streak-page-lbl">Day streak</.test(streakBody);
  const t7HasWeekCol = /streak-page-lbl">Week streak</.test(streakBody);
  const t7HasLongestDay = /Longest: 3/.test(streakBody); // both day and week longest streaks are 3 in this fixture
  console.log('Test 7 (Streak page hero shows the same Day/Week split as the card):',
    (t7HasDayCol && t7HasWeekCol && t7HasLongestDay) ? 'PASS' : 'FAIL', { t7HasDayCol, t7HasWeekCol, t7HasLongestDay });

  await wait(200);
  win.close();
})();
