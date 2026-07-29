// Regression test: Dylon: "Don't make weekly check in count towards progress / data." A Weekly
// Check-In is a reflection day (freeform text answers, no distance/pace/effort), not a training
// session -- confirmed scope with Dylon directly: it should stop affecting Sessions logged/Missed on
// Progress, the Current Block done/total + progress bar, streaks, week-complete checks, and Week
// Recap's sessions-done count. It should still show up normally as a session you can open and mark
// done in Schedule/Today (not tested here -- unrelated to this fix).
//
// isCheckinSession(s) is the one shared predicate now applied everywhere this math lives:
// countDone/totalSessions/the Progress "Missed" stat, dayHasActivity (streaks), blockLongestStreak,
// computeBlockStats (doneCount/totalCount/missedCount/completionPct), weekIsComplete, and
// weekRecapHTML.
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
  win.eval(`__origTodayISO = todayISO; todayISO = function(){ return '2026-07-15'; };`);

  // Week 1: a real easy run (done) + a Weekly Check-In (marked missed -- should NOT count as a
  // missed session in Progress). Week 2: a real easy run (NOT done) + a Weekly Check-In (done --
  // should NOT count toward streaks/completion on its own).
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-07-14',sessions:[
      {id:'w1run',wk:1,ty:'easy',date:'2026-07-01',ph:'dur',ti:'Easy Run'},
      {id:'w1ci',wk:1,ty:'checkin',date:'2026-07-05',ph:'dur',ti:'Weekly Check-In'},
      {id:'w2run',wk:2,ty:'easy',date:'2026-07-08',ph:'dur',ti:'Easy Run'},
      {id:'w2ci',wk:2,ty:'checkin',date:'2026-07-12',ph:'dur',ti:'Weekly Check-In'}
    ],mileagePlan:{1:20,2:20}}];
    DATA=BLOCKS[0].sessions;
    ACTIVE_BLOCK_ID='b1';
    STATUS={w1run:'done', w1ci:'missed', w2ci:'done'};
    NOTES={w1run:{dist:'20'}};
    MILEAGE_PLAN={1:20,2:20};
    RACES_LIST=[];
    EXTRALOGS=[];
    PROGRESS_SUB='main';
  `);

  // ---- Test 1: isCheckinSession correctly identifies checkin-type sessions only ----
  const isCheckin1 = win.eval(`isCheckinSession(DATA.find(s=>s.id==='w1ci'))`);
  const isCheckin2 = win.eval(`isCheckinSession(DATA.find(s=>s.id==='w1run'))`);
  console.log('Test 1 (isCheckinSession identifies checkin-type sessions, not run sessions):',
    (isCheckin1===true && isCheckin2===false) ? 'PASS' : 'FAIL', { isCheckin1, isCheckin2 });

  // ---- Test 2: totalSessions()/countDone() exclude the two checkin sessions entirely ----
  const total = win.eval(`totalSessions()`);
  const done = win.eval(`countDone()`);
  console.log('Test 2 (totalSessions/countDone exclude Weekly Check-In sessions):',
    (total===2 && done===1) ? 'PASS' : 'FAIL', { total, done });

  // ---- Test 3: the Progress "Missed" stat does not count w1ci, even though it's STATUS 'missed' ----
  win.eval(`renderProgress();`);
  const progressHTML = win.eval(`document.getElementById('view-progress').innerHTML`);
  const missedMatch = progressHTML.match(/<div class="stat-num">(\d+)<\/div><div class="stat-lbl">Missed<\/div>/);
  console.log('Test 3 (the live Progress "Missed" stat excludes a missed Weekly Check-In):',
    (missedMatch && missedMatch[1]==='0') ? 'PASS' : 'FAIL', { missedMatch: missedMatch && missedMatch[0] });

  // ---- Test 4: computeBlockStats totalCount/doneCount/missedCount/completionPct all exclude
  // checkin sessions ----
  const stats = win.eval(`JSON.stringify(computeBlockStats(BLOCKS[0]))`);
  const statsObj = JSON.parse(stats);
  console.log('Test 4 (computeBlockStats excludes Weekly Check-In from total/done/missed/completion):', {
    statsObj,
    result: (statsObj.totalCount===2 && statsObj.doneCount===1 && statsObj.missedCount===0 && statsObj.completionPct===50) ? 'PASS' : 'FAIL'
  });

  // ---- Test 5: weekIsComplete(1) is TRUE -- the week's only real training session (w1run) is
  // done, even though its Weekly Check-In (w1ci) is marked missed, not done ----
  const week1Complete = win.eval(`weekIsComplete(1)`);
  console.log('Test 5 (a week with its only real session done shows complete, regardless of its Check-In status):',
    week1Complete===true ? 'PASS' : 'FAIL', { week1Complete });

  // ---- Test 6: weekIsComplete(2) is FALSE -- w2run isn't done, even though w2ci (Check-In) is ----
  const week2Complete = win.eval(`weekIsComplete(2)`);
  console.log('Test 6 (a week whose only real session is NOT done shows incomplete, even with its Check-In done):',
    week2Complete===false ? 'PASS' : 'FAIL', { week2Complete });

  // ---- Test 7: dayHasActivity is FALSE for 2026-07-12 (only a done Check-In that day, no real
  // session or extra log) -- a Check-In alone should never extend a streak ----
  const streakDayFromCheckinAlone = win.eval(`dayHasActivity('2026-07-12')`);
  const streakDayFromRealSession = win.eval(`dayHasActivity('2026-07-01')`);
  console.log('Test 7 (a day with only a done Weekly Check-In does not count toward streaks; a day with a real done session does):', {
    streakDayFromCheckinAlone, streakDayFromRealSession,
    result: (streakDayFromCheckinAlone===false && streakDayFromRealSession===true) ? 'PASS' : 'FAIL'
  });

  // ---- Test 8: blockLongestStreak(b) never counts a Check-In-only day as part of a streak run ----
  const blockStreak = win.eval(`blockLongestStreak(BLOCKS[0])`);
  console.log('Test 8 (blockLongestStreak counts only the one real done session, not either Check-In):',
    blockStreak===1 ? 'PASS' : 'FAIL', { blockStreak });

  // ---- Test 9: weekRecapHTML(1) shows "Sessions done" as 1/1 (the one real session), not counting
  // the week's own Weekly Check-In in either the numerator or denominator ----
  const week1Recap = win.eval(`weekRecapHTML(1)`);
  console.log('Test 9 (Week Recap\\u2019s Sessions-done count excludes the week\\u2019s own Weekly Check-In from both numerator and denominator):',
    week1Recap.includes('1/1') ? 'PASS' : 'FAIL', { week1Recap });

  // ---- Test 10: weekRecapHTML(2) renders nothing at all -- its only real session isn't done and
  // there are no extra logs, even though its Weekly Check-In IS done (confirms Check-In completion
  // alone can't trigger a recap to appear) ----
  const week2Recap = win.eval(`weekRecapHTML(2)`);
  console.log('Test 10 (Week Recap stays empty for a week whose only real session is undone, even with its Check-In done):',
    week2Recap==='' ? 'PASS' : 'FAIL', { week2Recap });

  // ---- Test 11: weekListCardHTML(1) -- Dylon: "i am still seeing blank bar streaks due to not
  // logging check in. the weekly checkins are not for stats its more of a training journal." The
  // per-session dot bar in Schedule's week list should show only w1run's dot (1 dot total, done/green),
  // not a second permanently-blank dot for w1ci -- and "Total Workouts" should read 1, not 2. ----
  const week1CardHTML = win.eval(`weekListCardHTML(1)`);
  const week1DotCount = (week1CardHTML.match(/<div class="plan-wk-dot /g) || []).length;
  const week1TotalWorkoutsMatch = week1CardHTML.match(/Total Workouts: <b>(\d+)<\/b>/);
  console.log('Test 11 (Schedule week-list dot bar and Total Workouts exclude the week\\u2019s Weekly Check-In):', {
    week1DotCount, week1TotalWorkouts: week1TotalWorkoutsMatch && week1TotalWorkoutsMatch[1],
    result: (week1DotCount===1 && week1TotalWorkoutsMatch && week1TotalWorkoutsMatch[1]==='1') ? 'PASS' : 'FAIL'
  });

  // ---- Test 12: the Weekly Check-In itself still appears as a normal, loggable day row in the same
  // week card -- only the dot bar/count are affected, not the day list ----
  const week1HasCheckinRow = week1CardHTML.includes('Weekly Check-In');
  console.log('Test 12 (Weekly Check-In still shows as a normal day row in the week list card):',
    week1HasCheckinRow===true ? 'PASS' : 'FAIL', { week1HasCheckinRow });

  // ---- Test 13: renderWeekDetailHTML(2) -- same fix in the week-detail panel (opened by tapping a
  // week card). w2ci is done but excluded, so the dot bar shows 1 dot (w2run, not done) and "Total
  // Workouts: 1 (0 done)" -- not "2 (1 done)" ----
  const week2DetailHTML = win.eval(`renderWeekDetailHTML(2)`);
  const week2DotCount = (week2DetailHTML.match(/<div class="plan-wk-dot /g) || []).length;
  const week2MetaMatch = week2DetailHTML.match(/Total Workouts: <b>(\d+)<\/b> \((\d+) done\)/);
  console.log('Test 13 (Schedule week-detail dot bar and Total Workouts/done count exclude the week\\u2019s Weekly Check-In):', {
    week2DotCount, week2Meta: week2MetaMatch && week2MetaMatch[0],
    result: (week2DotCount===1 && week2MetaMatch && week2MetaMatch[1]==='1' && week2MetaMatch[2]==='0') ? 'PASS' : 'FAIL'
  });

  win.eval(`todayISO = __origTodayISO;`);
  await wait(200);
  win.close();
})();
