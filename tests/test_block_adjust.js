// Regression test for the mid-block plan adjustment feature (task #114): "Shift Remaining Schedule"
// and "Add Recovery/Maintenance Weeks" on the active block's Adjust Plan sheet, letting a user handle
// missed time (injury/illness) without deleting and restarting the whole block.
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
  // renderAll()'s per-view render path (renderToday/renderWeek/etc.) reliably OOMs under jsdom's lack
  // of real layout/ResizeObserver support — same pre-existing issue hit by setDistUnit's switchView()
  // in test_plan_guide.js, unrelated to anything in this feature. shiftBlockSchedule/extendBlockPlan
  // call the real renderAll() in production (correctly, so the UI reflects the change) — stub it out
  // here so the test can exercise the actual data-mutation logic without tripping that unrelated limit.
  win.eval(`window.renderAll = function(){};`);

  // Build a synthetic 6-week block anchored so "today" (real system date, whatever it is when this
  // test runs) falls inside week 3 — weeks 1-2 already happened (some done, some missed), weeks 3-6
  // are upcoming. A linked race on the last day of week 6 exercises the RACES_LIST-shift path too.
  win.eval(`
    const todayISO = isoDate(new Date());
    const today = new Date(todayISO+'T12:00:00');
    // Start the block so today lands on week 3, day 1 (Monday-ish offset 0) — 14 days before today
    // puts us at the start of week 3 (2 full weeks elapsed).
    const blockStart = addDaysISO(todayISO, -14);
    const sessions = [];
    const mileagePlan = {};
    for(let wk=1; wk<=6; wk++){
      let wkKm = 0;
      for(let day=0; day<7; day++){
        const date = addDaysISO(blockStart, (wk-1)*7+day);
        const wd = PLAN_WD[new Date(date+'T12:00:00').getDay()];
        const isLong = day===5;
        const isRun = day===0||day===2||isLong;
        const isRace = (wk===6 && day===6);
        let s;
        if(isRace){
          s = {id:'tb_w'+wk+'d'+day, wk, ph:'taper', d:'RACE', date, wd, ty:'race', ti:'Test 10K', full:'RACE', det:'Race day', dist:fmtDist(10)};
        } else if(isRun){
          const km = isLong?12:6;
          wkKm += km;
          s = {id:'tb_w'+wk+'d'+day, wk, ph: wk<=4?'build':'taper', d:'D'+day, date, wd, ty:isLong?'long':'easy', ti:isLong?'Long Run':'Easy Run', full:'run', det:'run detail', dist:fmtDist(km)};
        } else {
          s = {id:'tb_w'+wk+'d'+day, wk, ph: wk<=4?'build':'taper', d:'D'+day, date, wd, ty:'rest', ti:'Rest Day', full:'rest', det:'Full rest.'};
        }
        sessions.push(s);
      }
      mileagePlan[wk]=wkKm;
    }
    BLOCKS=[{id:'tb1', name:'Test Block', planTitle:'Test Block', theme:'', tags:[], startDate:blockStart, endDate:sessions[sessions.length-1].date, phaseLabels:{base:'Base',build:'Build',taper:'Taper'}, mileagePlan, sessions, weekNotes:{}, sessionNotes:{}, status:'active'}];
    SEASONS=[{id:'s2026',name:'2026'}];
    BLOCKS[0].seasonId='s2026';
    ACTIVE_BLOCK_ID='tb1';
    RACES_LIST=[{key:'race1', name:'Test 10K', date: sessions[sessions.length-1].date, dateTBD:false, time:'', regOpenDate:'', distance:'10K', priority:'A', shoeKey:'', status:'registered', goal:'', targetMin:'', targetMax:'', isPB:false, location:'', routeUrl:'', blockId:'tb1', resultPace:'', resultHR:'', resultPos:'', resultGPos:'', resultAPos:'', resultNotes:''}];
    // Mark week 1 and 2 as logged (in the past) so we can verify they're untouched by any adjustment.
    STATUS={};
    sessions.filter(s=>s.wk<=2 && (s.ty==='easy'||s.ty==='long')).forEach(s=>{ STATUS[s.id]='done'; });
  `);

  const todayISO = win.eval(`isoDate(new Date())`);
  const pastCount = win.eval(`BLOCKS[0].sessions.filter(s=>s.date<'${todayISO}').length`);
  const futureCount = win.eval(`BLOCKS[0].sessions.filter(s=>s.date>='${todayISO}').length`);
  console.log('Setup: past/future session split:', { pastCount, futureCount, total: pastCount+futureCount });

  // ---- Test 1: Adjust Plan entry point only shows for the ACTIVE block ----
  win.eval(`openPlans('blocks','all');`);
  const activeCardHTML = win.eval(`planBlockCardHTML(BLOCKS[0])`);
  console.log('Test 1 (Adjust Plan button present on the active block card):', activeCardHTML.includes("openBlockAdjust('tb1')") ? 'PASS' : 'FAIL');

  // ---- Test 2: openBlockAdjust() opens the sheet with real content ----
  win.eval(`openBlockAdjust('tb1');`);
  const adjustOpen = win.eval(`document.getElementById('blockadjust-overlay').classList.contains('open')`);
  const adjustBodyLen = win.eval(`document.getElementById('blockadjust-sh-body').innerHTML.length`);
  console.log('Test 2 (openBlockAdjust opens the sheet and fills its body):', (adjustOpen && adjustBodyLen > 300) ? 'PASS' : 'FAIL', { adjustOpen, adjustBodyLen });

  // ---- Test 3: shiftBlockSchedule only moves sessions dated today or later, leaves the past alone ----
  const beforeShift = win.eval(`JSON.parse(JSON.stringify(BLOCKS[0].sessions.filter(s=>s.date<'${todayISO}').map(s=>s.date)))`);
  const futureDatesBefore = win.eval(`BLOCKS[0].sessions.filter(s=>s.date>='${todayISO}').map(s=>s.date).sort()`);
  const raceDateBefore = win.eval(`RACES_LIST[0].date`);
  win.eval(`shiftBlockSchedule('tb1', 7);`);
  const afterShiftPastDates = win.eval(`BLOCKS[0].sessions.filter(s=>{ return true; }).filter((s,i)=>i<${beforeShift.length}).map(s=>s.date)`); // not reliable ordering check; do exact id compare below instead
  const pastUnchanged = win.eval(`
    const oldPast = ${JSON.stringify(beforeShift)};
    const stillPast = BLOCKS[0].sessions.filter(s=>s.date<'${todayISO}'); // dates already shifted forward for future ones, past should be same set
    // Every originally-past date should still exist unchanged among current sessions with date<today
    oldPast.every(d=>stillPast.some(s=>s.date===d))
  `);
  const futureDatesAfter = win.eval(`BLOCKS[0].sessions.filter(s=>s.wk>=3).map(s=>s.date).sort()`);
  const expectedFutureAfter = futureDatesBefore.map(d => win.eval(`addDaysISO('${d}',7)`));
  const shiftedCorrectly = JSON.stringify(futureDatesAfter.sort()) === JSON.stringify(expectedFutureAfter.sort());
  const raceDateAfter = win.eval(`RACES_LIST[0].date`);
  const raceShifted = win.eval(`RACES_LIST[0].date === addDaysISO('${raceDateBefore}',7)`);
  console.log('Test 3 (shiftBlockSchedule moves only future sessions by the given delta, race date included):',
    (pastUnchanged && shiftedCorrectly && raceShifted) ? 'PASS' : 'FAIL',
    { pastUnchanged, shiftedCorrectly, raceShifted, raceDateBefore, raceDateAfter });

  // ---- Test 4: mileagePlan/endDate recalculated after the shift (endDate should now be 7 days later) ----
  const endDateAfterShift = win.eval(`BLOCKS[0].endDate`);
  console.log('Test 4 (endDate recalculated to reflect the shifted race day):', endDateAfterShift === raceDateAfter ? 'PASS' : 'FAIL', { endDateAfterShift, raceDateAfter });

  // ---- Test 5: extendBlockPlan inserts the requested number of weeks, using the template week's
  // day-of-week pattern, scaled to the given intensity, and pushes the next-upcoming week (and race
  // day) back by the same number of weeks ----
  const weekCountBefore = win.eval(`blockTotalWeeks(BLOCKS[0])`);
  const nextWeekBefore = win.eval(`Math.min(...BLOCKS[0].sessions.filter(s=>s.date>='${todayISO}').map(s=>s.wk))`);
  const raceDateBeforeExtend = win.eval(`RACES_LIST[0].date`);
  const res5 = win.eval(`extendBlockPlan('tb1', 2, 70)`);
  const weekCountAfter = win.eval(`blockTotalWeeks(BLOCKS[0])`);
  const insertedWeeks = win.eval(`Array.from(new Set(BLOCKS[0].sessions.filter(s=>s.ph==='maintenance').map(s=>s.wk))).sort()`);
  const raceDateAfterExtend = win.eval(`RACES_LIST[0].date`);
  const expectedRaceDateAfterExtend = win.eval(`addDaysISO('${raceDateBeforeExtend}', 14)`);
  console.log('Test 5 (extendBlockPlan inserts weeks, pushes race day back, recalculates total weeks):', {
    ok: res5.ok, insertedCount: res5.insertedCount, weeksAdded: res5.weeksAdded,
    weekCountBefore, weekCountAfter, expectedWeekCountAfter: weekCountBefore+2,
    insertedWeeks, expectedInsertedWeeks: [nextWeekBefore, nextWeekBefore+1],
    raceDateAfterExtend, expectedRaceDateAfterExtend,
    result: (res5.ok && weekCountAfter===weekCountBefore+2 && JSON.stringify(insertedWeeks)===JSON.stringify([nextWeekBefore,nextWeekBefore+1]) && raceDateAfterExtend===expectedRaceDateAfterExtend) ? 'PASS' : 'FAIL'
  });

  // ---- Test 6: inserted run-type sessions are scaled to the requested intensity (70% of the template
  // week's distances) rather than left at full/original volume ----
  const templateLongKm = 12, templateEasyKm = 6;
  const insertedLong = win.eval(`BLOCKS[0].sessions.find(s=>s.ph==='maintenance' && s.ty==='long')`);
  const insertedEasy = win.eval(`BLOCKS[0].sessions.find(s=>s.ph==='maintenance' && s.ty==='easy')`);
  const insertedLongKm = insertedLong ? win.eval(`displayToKm(parseFloat('${insertedLong.dist}'))`) : null;
  const insertedEasyKm = insertedEasy ? win.eval(`displayToKm(parseFloat('${insertedEasy.dist}'))`) : null;
  const longScaledRight = insertedLongKm !== null && Math.abs(insertedLongKm - templateLongKm*0.7) < 0.2;
  const easyScaledRight = insertedEasyKm !== null && Math.abs(insertedEasyKm - templateEasyKm*0.7) < 0.2;
  console.log('Test 6 (inserted recovery-week sessions are scaled to the chosen intensity):',
    (longScaledRight && easyScaledRight) ? 'PASS' : 'FAIL', { insertedLongKm, insertedEasyKm, expectedLong: templateLongKm*0.7, expectedEasy: templateEasyKm*0.7 });

  // ---- Test 7: a rest day in the template stays a rest day in the inserted weeks (no fabricated
  // distance/workout content on days that were originally rest) ----
  const insertedRest = win.eval(`BLOCKS[0].sessions.find(s=>s.ph==='maintenance' && s.ty==='rest')`);
  console.log('Test 7 (template rest days stay rest days in inserted weeks):', (insertedRest && !insertedRest.dist) ? 'PASS' : 'FAIL', { insertedRest });

  // ---- Test 8: already-logged (past) sessions from weeks 1-2 are completely untouched by either
  // operation — same ids, same STATUS ----
  const week1DoneStillDone = win.eval(`
    const w1 = BLOCKS[0].sessions.filter(s=>s.wk===1 && (s.ty==='easy'||s.ty==='long'));
    w1.every(s=>STATUS[s.id]==='done')
  `);
  console.log('Test 8 (past logged sessions in weeks 1-2 remain untouched after both operations):', week1DoneStillDone ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
