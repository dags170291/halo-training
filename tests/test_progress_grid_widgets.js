// Regression test for the Progress-grid Fitness Trend / Consistency Score chips. Originally added
// alongside a third "Days to Next Race" chip (Task #130); Dylon later asked to remove that chip
// entirely ("remove the race countdown from progress as we solved the training load issue") and to
// reposition these two chips BEFORE the full-width Training Load row ("i also didnt see the
// consistency score and fitness trend we discuss add them in before the training load"). That
// complaint traced back to both chips silently rendering '' with no visible placeholder whenever
// there wasn't yet enough data -- likely true for his real block state -- so both now always render
// a visible "not enough data yet" fallback card instead of disappearing.
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
// Builds a simple N-week block of easy-run sessions (Monday of each week, arbitrary) starting on a
// given ISO date, so blockWeekCount()/weekSessionsFull()/currentRealWeek() all have real data to
// walk. Each week's session date is set explicitly so currentRealWeek() (which is date-driven, not
// index-driven) lines up with a real 'today'.
function buildBlock(win, startISO, weeks) {
  return win.eval(`
    (function(){
      const start = new Date('${startISO}T12:00:00');
      const sessions = [];
      const mileagePlan = {};
      for (let w=1; w<=${weeks}; w++){
        const d = new Date(start); d.setDate(d.getDate() + (w-1)*7);
        const iso = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        sessions.push({id:'w'+w+'s1', wk:w, ty:'easy', date: iso, ph:'dur'});
        mileagePlan[w] = 20;
      }
      BLOCKS = [{id:'b1', name:'Test Block', startDate: sessions[0].date, endDate: sessions[sessions.length-1].date, sessions, mileagePlan}];
      DATA = BLOCKS[0].sessions;
      MILEAGE_PLAN = mileagePlan;
      ACTIVE_BLOCK_ID = 'b1';
      STATUS = {};
      NOTES = {};
      RACES_LIST = [];
      return sessions.map(s=>s.date);
    })()
  `);
}

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
  win.eval(`window.renderAll = function(){};`);

  // Freeze "today" to a fixed, known date so currentRealWeek()/weekActualKm() math is deterministic
  // regardless of when this test actually runs.
  win.eval(`__origTodayISO = todayISO; todayISO = function(){ return '2026-07-21'; };`);

  // Block starts 2026-06-02 (a Tuesday) with weekly sessions on that weekday -- '2026-07-21' lands
  // partway through week 8, so weeks 1-7 are "fully elapsed" and week 8 is still in progress.
  const dates = buildBlock(win, '2026-06-02', 10);

  // ---- Test 1: with no EF data logged at all, Fitness Trend still renders a real, visible chip --
  // a "not enough data yet" fallback card, not an empty string that silently vanishes from the grid ----
  const noTrendChip = win.eval(`fitnessTrendStatChipHTML()`);
  console.log('Test 1 (no EF data -> Fitness Trend chip still renders a visible fallback card, not blank):',
    (noTrendChip!=='' && noTrendChip.includes('stat-card') && noTrendChip.includes('not enough data yet')) ? 'PASS' : 'FAIL', { noTrendChip });

  // ---- Test 2: log an EF reading in week 1 and a higher (better) one in week 6 -- Fitness Trend
  // should compute a positive % change between exactly those two weeks ----
  win.eval(`
    STATUS['w1s1']='done'; NOTES['w1s1']={pace:'6:00',hr:150}; // slower pace, higher HR -> lower EF
    STATUS['w6s1']='done'; NOTES['w6s1']={pace:'5:00',hr:140}; // faster pace, lower HR -> higher EF
  `);
  const trend = win.eval(`fitnessTrendPct()`);
  const trendChip = win.eval(`fitnessTrendStatChipHTML()`);
  console.log('Test 2 (Fitness Trend computes a positive % change from week 1 to week 6, EF improved):', {
    trend,
    chipShowsPositive: trendChip.includes('+') && trendChip.includes('Wk 1'),
    result: (trend && trend.pct>0 && trend.fromWk===1 && trend.toWk===6 && trendChip.includes('+')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 3: with no mileage logged at all for the fully-elapsed weeks (1-7), Consistency Score
  // is 0% (0 of 7 weeks hit target), not null/blank, since those weeks DID have a real plan target ----
  const consistencyEmpty = win.eval(`weeklyConsistency()`);
  console.log('Test 3 (no mileage logged against a real plan -> Consistency Score is 0%, not blank):',
    (consistencyEmpty && consistencyEmpty.pct===0 && consistencyEmpty.counted===7) ? 'PASS' : 'FAIL', { consistencyEmpty });

  // ---- Test 4: logging >=85% of planned mileage (17 of 20km planned) for weeks 1-5, and well under
  // target for weeks 6-7, gives a 5/7 = 71% consistency score ----
  win.eval(`
    for (let w=1; w<=5; w++){ NOTES['w'+w+'s1'] = {...(NOTES['w'+w+'s1']||{}), dist:'17'}; STATUS['w'+w+'s1']='done'; }
    NOTES['w6s1'] = {...(NOTES['w6s1']||{}), dist:'5'};
    NOTES['w7s1'] = {dist:'5'}; STATUS['w7s1']='done';
  `);
  const consistency = win.eval(`weeklyConsistency()`);
  const consistencyChip = win.eval(`consistencyStatChipHTML()`);
  console.log('Test 4 (5 of 7 fully-elapsed weeks hit >=85% of planned mileage -> 71% consistency):',
    (consistency && consistency.hit===5 && consistency.counted===7 && consistency.pct===71 && consistencyChip.includes('71%')) ? 'PASS' : 'FAIL',
    { consistency });

  // ---- Test 5: week 8 (still in progress relative to the frozen "today") is never counted toward
  // the score even if it has a plan target, since it hasn't fully elapsed yet ----
  console.log('Test 5 (in-progress/future weeks are excluded from the denominator):', consistency.counted===7 ? 'PASS' : 'FAIL', { counted: consistency.counted, totalWeeks: 10 });

  // ---- Test 6: with no weeks fully elapsed at all (block just started), Consistency Score still
  // renders a real, visible fallback chip rather than an empty string ----
  win.eval(`__origTodayISO2 = todayISO; todayISO = function(){ return '2026-06-02'; };`);
  const noConsistencyChip = win.eval(`consistencyStatChipHTML()`);
  console.log('Test 6 (no fully-elapsed weeks yet -> Consistency chip still renders a visible fallback card, not blank):',
    (noConsistencyChip!=='' && noConsistencyChip.includes('stat-card') && noConsistencyChip.includes('not enough data yet')) ? 'PASS' : 'FAIL', { noConsistencyChip });
  win.eval(`todayISO = __origTodayISO2;`);

  // ---- Test 7: Days to Next Race is gone entirely -- the function no longer exists, and the chip
  // never appears in the live Progress grid regardless of upcoming races ----
  const daysToRaceFnGone = win.eval(`typeof daysToNextRaceStatChipHTML==='undefined'`);
  const nextUpcomingRaceFnGone = win.eval(`typeof nextUpcomingRace==='undefined'`);
  console.log('Test 7 (Days to Next Race feature removed entirely -- functions no longer exist):',
    (daysToRaceFnGone && nextUpcomingRaceFnGone) ? 'PASS' : 'FAIL', { daysToRaceFnGone, nextUpcomingRaceFnGone });

  // ---- Test 8: inside the real Progress tab, Fitness Trend and Consistency both render as real
  // cells, no Days to Next Race chip appears anywhere even with a real upcoming race on record, and
  // (v0.32.14) Training Load no longer renders in Progress at all -- Dylon: "remove training load
  // from progress (leave it in recovery)." trainingLoadStatChipHTML() itself still exists and is
  // still tested directly (test_training_load_fullwidth.js); it's just not called from
  // renderProgress() anymore, so its old "stat-card" chip markup shouldn't appear in this HTML. ----
  win.eval(`
    RACES_LIST = [{key:'near', name:'Near 10K', date:'2026-07-28', status:'registered', dateTBD:false}];
    PROGRESS_SUB='main';
    renderProgress();
  `);
  const progressHTML = win.eval(`document.getElementById('view-progress').innerHTML`);
  const hasFitnessTrend = progressHTML.includes('Fitness Trend');
  const hasConsistency = progressHTML.includes('Consistency');
  const noTrainingLoad = !progressHTML.includes('Training Load');
  const noDaysToRaceChip = !progressHTML.includes('Near 10K');
  console.log('Test 8 (Fitness Trend + Consistency render in the live grid, Training Load no longer appears in Progress, no race-countdown chip):', {
    hasFitnessTrend, hasConsistency, noTrainingLoad, noDaysToRaceChip,
    result: (hasFitnessTrend && hasConsistency && noTrainingLoad && noDaysToRaceChip) ? 'PASS' : 'FAIL'
  });

  win.eval(`todayISO = __origTodayISO;`);
  await wait(200);
  win.close();
})();
