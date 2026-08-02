// Regression test for the v0.34.22 streak card redesign. Dylon sent a new mockup: "redesign the
// streaks card in the grid, remove block mileage completion card and extend the streaks card the
// width of two items in the grid." Two changes covered here:
//
// 1. The Progress stat-grid's separate "Block mileage complete %" cell is gone entirely -- it was
//    redundant with the progress bar already on the Current Block card below, and freed up room for
//    the wider streak card.
// 2. The streak card (.stat-card-streak) now spans both columns of the 2-column .stat-grid
//    (grid-column:1 / -1) instead of being a single grid cell, with a new right-hand section: a
//    "View This Month's Streak" link (with a small chevron) above a compact 7-column dot-grid
//    calendar preview (streakMiniCalDotsHTML) showing the current real month at a glance -- filled
//    dots for days with logged activity, pale dots for past/today days with nothing logged, and
//    fully blank cells for both the leading days before the 1st and any day still in the future.
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
  win.eval(`window.renderAll = function(){};`);

  const today = win.eval(`todayISO()`);

  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-09-01',mileagePlan:{1:20},sessions:[
      {id:'s1',wk:1,ty:'easy',date:'${today}',ph:'dur',dist:'5K'}
    ]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-01'; BLOCK_END='2026-09-01';
    STATUS={s1:'done'}; NOTES={}; EXTRALOGS=[]; RACES_LIST=[]; ACTIVITIES=[];
  `);

  // ---- Test 1: .stat-card-streak spans the full grid width now (grid-column:1 / -1), not a single
  // .stat-grid cell like the v0.34.7 version ----
  const streakCSSMatch = html.match(/\.stat-card-streak\{([^}]*)\}/);
  const streakCSS = streakCSSMatch ? streakCSSMatch[1] : '';
  console.log('Test 1 (.stat-card-streak spans both grid columns via grid-column:1 / -1):',
    /grid-column:1 \/ -1/.test(streakCSS) ? 'PASS' : 'FAIL', { streakCSS });

  // ---- Test 2: the real Progress tab render no longer shows a "Block mileage complete" stat card
  // anywhere ----
  win.eval(`CURR_VIEW='progress'; renderProgress();`);
  const progressHTML = win.eval(`document.getElementById('view-progress').innerHTML`);
  console.log('Test 2 (Progress no longer shows a "Block mileage complete" stat card):',
    !/Block mileage complete/.test(progressHTML) ? 'PASS' : 'FAIL');

  // ---- Test 3: the streak card shows the "View This Month's Streak" link and a dot-grid calendar
  // preview (streak-hero-cal-dots containing at least one smcal-dot) ----
  const t3HasLink = /streak-hero-cal-link">View This Month's Streak/.test(progressHTML);
  const t3HasDotsWrap = /streak-hero-cal-dots/.test(progressHTML);
  const t3DotCount = (progressHTML.match(/class="smcal-dot/g) || []).length;
  console.log('Test 3 (streak card shows "View This Month\'s Streak" link and a dot-grid calendar preview):',
    (t3HasLink && t3HasDotsWrap && t3DotCount > 20) ? 'PASS' : 'FAIL', { t3HasLink, t3HasDotsWrap, t3DotCount });

  // ---- Test 4: the streak card still keeps its badge/N DAYS/divider/N WEEKS and is still clickable
  // through to the Streak page -- only the surrounding layout changed, not this core content ----
  const t4 = /streak-hero-badge/.test(progressHTML) && /class="streak-hero-days">\d+ DAYS?</.test(progressHTML)
    && /class="streak-hero-weeks">\d+ WEEKS?</.test(progressHTML)
    && /class="stat-card stat-card-streak" onclick="openStreakPage\(\)"/.test(progressHTML);
  console.log('Test 4 (streak card still has badge/N DAYS/N WEEKS and opens the Streak page on tap):', t4 ? 'PASS' : 'FAIL');

  // ---- Test 5: streakMiniCalDotsHTML() produces exactly one cell (dot or blank) for every day of the
  // current real month, in Monday-first grid order -- leading blanks before the 1st plus one cell per
  // day of the month, future days rendering as blank (.empty) cells rather than being omitted (so the
  // 7-column grid alignment never shifts) -- and marks today's own dot active since a done session
  // (s1) is dated today. ----
  const dotsHTML = win.eval(`streakMiniCalDotsHTML()`);
  const totalDots = (dotsHTML.match(/smcal-dot/g) || []).length;
  const now = new Date();
  const firstWd = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const expectedDots = firstWd + daysInMonth; // one cell per leading blank + one per day of the month
  const activeDots = (dotsHTML.match(/smcal-dot active/g) || []).length;
  console.log('Test 5 (streakMiniCalDotsHTML renders one cell per leading-blank/calendar-day, with today marked active):',
    (totalDots === expectedDots && activeDots >= 1) ? 'PASS' : 'FAIL', { totalDots, expectedDots, activeDots, firstWd, daysInMonth });

  // ---- Test 6: a day with nothing logged (and not in the future) renders a plain, non-active dot --
  // not an "empty" blank cell (those are reserved for the leading days before the 1st and days that
  // haven't happened yet this month) ----
  win.eval(`STATUS={}; EXTRALOGS=[];`); // wipe out all activity so nothing is active anymore
  const noActivityDots = win.eval(`streakMiniCalDotsHTML()`);
  const t6NoActive = !/smcal-dot active/.test(noActivityDots);
  const t6StillHasPastDots = (noActivityDots.match(/class="smcal-dot"/g) || []).length > 0;
  console.log('Test 6 (with nothing logged, past/today dots render as plain non-active dots, not blank):',
    (t6NoActive && t6StillHasPastDots) ? 'PASS' : 'FAIL', { t6NoActive, t6StillHasPastDots });

  await wait(200);
  win.close();
})();
