// Regression test for the weekly sleep-tracking feature (v0.32.28). Dylon's confirmed design:
// sleep is captured in HOURS, not a 1-5 rating, via two possible sources: the plan-scheduled Weekly
// Check-In's own sleepHours question (if the person opted into check-ins and actually answered it),
// or the ad hoc Wellness Check-In's sleepHours field as a fallback. If neither exists, no data point
// is shown -- an explicit gap, never a fabricated 0 or default. The combined wellness score
// (wellnessEntryScore) drops from 3-factor (energy+sleep+soreness) to 2-factor (energy+soreness)
// since sleep no longer shares the 1-5 scale -- this applies uniformly to old and new entries alike,
// and old entries' legacy 1-5 "sleep" field is never deleted, just no longer counted.
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

  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-07-21',sessions:[
      {id:'w1run',wk:1,ty:'easy',date:'2026-07-01',ph:'dur',ti:'Easy Run'},
      {id:'w1ci',wk:1,ty:'checkin',date:'2026-07-12',ph:'dur',ti:'Weekly Check-In'},
      {id:'w2ci',wk:2,ty:'checkin',date:'2026-07-13',ph:'dur',ti:'Weekly Check-In'}
    ],mileagePlan:{1:20,2:20}}];
    DATA=BLOCKS[0].sessions;
    ACTIVE_BLOCK_ID='b1';
    STATUS={w1run:'done'};
    NOTES={};
    WELLNESS_LOG=[];
    MILEAGE_PLAN={1:20,2:20};
    RACES_LIST=[];
    EXTRALOGS=[];
    PROGRESS_SUB='main';
  `);

  // ---- Test 1: gpCheckinDay() includes a sleepHours question of type 'number', ahead of the
  // freeform questions ----
  const gpQ = win.eval(`JSON.stringify(gpCheckinDay(3).steps[0].questions)`);
  const gpQuestions = JSON.parse(gpQ);
  console.log('Test 1 (gpCheckinDay includes a sleepHours number question):',
    (gpQuestions[0].id==='sleepHours' && gpQuestions[0].type==='number') ? 'PASS' : 'FAIL', { gpQuestions });

  // ---- Test 2: stepsFor()'s defensive checkin fallback also includes the sleepHours question ----
  const fallbackQ = win.eval(`JSON.stringify(stepsFor({ty:'checkin',id:'x'}).find(g=>g.type==='checkin').questions)`);
  const fallbackQuestions = JSON.parse(fallbackQ);
  console.log('Test 2 (stepsFor checkin fallback includes sleepHours):',
    fallbackQuestions.some(q=>q.id==='sleepHours' && q.type==='number') ? 'PASS' : 'FAIL', { fallbackQuestions });

  // ---- Test 3: rendering a checkin group produces a number input for the sleepHours question,
  // not a textarea ----
  win.eval(`
    NOTES['w1ci']={checkin:{sleepHours:'7.5'}};
  `);
  const checkinHTML = win.eval(`renderStepsHTML(stepsFor(DATA.find(s=>s.id==='w1ci')), 'w1ci')`);
  const hasNumberInput = checkinHTML.includes('<input type="number"');
  const numberInputHasValue = checkinHTML.includes('value="7.5"');
  console.log('Test 3 (checkin rendering uses a number input with the saved value for sleepHours):',
    (hasNumberInput && numberInputHasValue) ? 'PASS' : 'FAIL', { hasNumberInput, numberInputHasValue });

  // ---- Test 4: saveCheckinAnswer still writes into NOTES[sessionId].checkin.sleepHours like any
  // other checkin question ----
  win.eval(`saveCheckinAnswer('w1ci','sleepHours','8.25')`);
  await wait(500);
  const savedSleepHours = win.eval(`NOTES['w1ci'].checkin.sleepHours`);
  console.log('Test 4 (saveCheckinAnswer persists sleepHours like any other checkin answer):',
    savedSleepHours==='8.25' ? 'PASS' : 'FAIL', { savedSleepHours });

  // ---- Test 5: resolveWeeklySleepHours() resolves from the Weekly Check-In first, when answered
  // within the rolling 7-day window ----
  win.eval(`WELLNESS_LOG=[{id:'w1',date:'2026-07-14',energy:4,sleepHours:6,soreness:2}];`);
  const resolved1 = win.eval(`JSON.stringify(resolveWeeklySleepHours())`);
  const resolved1Obj = JSON.parse(resolved1);
  console.log('Test 5 (resolveWeeklySleepHours prefers the Weekly Check-In answer over Wellness):',
    (resolved1Obj && resolved1Obj.source==='checkin' && resolved1Obj.hours===8.25) ? 'PASS' : 'FAIL', { resolved1Obj });

  // ---- Test 6: falls back to the Wellness Check-In(s) when no Weekly Check-In sleepHours answer
  // exists in the window (averaged if there's more than one entry) ----
  win.eval(`
    NOTES={};
    WELLNESS_LOG=[
      {id:'w1',date:'2026-07-13',energy:4,sleepHours:6,soreness:2},
      {id:'w2',date:'2026-07-14',energy:3,sleepHours:8,soreness:3}
    ];
  `);
  const resolved2 = win.eval(`JSON.stringify(resolveWeeklySleepHours())`);
  const resolved2Obj = JSON.parse(resolved2);
  console.log('Test 6 (resolveWeeklySleepHours falls back to averaged Wellness entries when no Check-In answer exists):',
    (resolved2Obj && resolved2Obj.source==='wellness' && resolved2Obj.hours===7 && resolved2Obj.count===2) ? 'PASS' : 'FAIL', { resolved2Obj });

  // ---- Test 7: resolves to null (explicit gap) when neither source has data in the window --
  // never fabricates a 0 or a default ----
  win.eval(`NOTES={}; WELLNESS_LOG=[];`);
  const resolved3 = win.eval(`resolveWeeklySleepHours()`);
  console.log('Test 7 (resolveWeeklySleepHours returns null -- an explicit gap -- when there is no data at all):',
    resolved3===null ? 'PASS' : 'FAIL', { resolved3 });

  // ---- Test 8: wellnessEntryScore() is now 2-factor (energy + inverse soreness), ignoring sleep
  // entirely -- for a brand-new entry that only has sleepHours set, not the old 1-5 sleep field ----
  const scoreNew = win.eval(`wellnessEntryScore({energy:4,sleepHours:9,soreness:2})`);
  // energy=4, soreness inverted = 6-2=4 -> avg = 4. If sleepHours were wrongly included it would
  // pull the average toward 9 and produce a different number.
  console.log('Test 8 (wellnessEntryScore ignores sleepHours entirely -- pure energy+inverse-soreness average):',
    scoreNew===4 ? 'PASS' : 'FAIL', { scoreNew });

  // ---- Test 9: wellnessEntryScore() also ignores a legacy 1-5 "sleep" rating on an OLD entry --
  // same 2-factor formula applies uniformly across all history ----
  const scoreLegacy = win.eval(`wellnessEntryScore({energy:2,sleep:5,soreness:4})`);
  // energy=2, soreness inverted = 6-4=2 -> avg = 2. If legacy sleep were still counted (5) the
  // average would be pulled up to 3.
  console.log('Test 9 (wellnessEntryScore ignores a legacy 1-5 sleep rating on old entries too):',
    scoreLegacy===2 ? 'PASS' : 'FAIL', { scoreLegacy });

  // ---- Test 10: saveWellness() writes sleepHours from the form (not the old 1-5 sleep field) and
  // preserves an existing legacy sleep rating on edit rather than deleting it ----
  win.eval(`
    document.body.insertAdjacentHTML('beforeend', '<div id="wellness-sh-title"></div><div id="wellness-sh-body"></div><div id="wellness-overlay"></div>');
    WELLNESS_LOG=[{id:'legacy1',date:'2026-07-10',energy:3,sleep:4,soreness:2}];
    WELLNESS_EDIT_ID='legacy1';
  `);
  win.eval(`openWellnessForm('legacy1')`);
  win.eval(`document.getElementById('wl-sleep-hours').value='6.5'`);
  win.eval(`saveWellness()`);
  const editedEntry = win.eval(`JSON.stringify(WELLNESS_LOG.find(x=>x.id==='legacy1'))`);
  const editedObj = JSON.parse(editedEntry);
  console.log('Test 10 (saveWellness writes sleepHours from the form and preserves the legacy 1-5 sleep field rather than deleting it):',
    (editedObj.sleepHours===6.5 && editedObj.sleep===4) ? 'PASS' : 'FAIL', { editedObj });

  // ---- Test 11: wellnessEntryHTML() displays hours ("Xh") when sleepHours is present, falling
  // back to the legacy "X/5" rating display for old entries that only have the 1-5 field ----
  const htmlNewEntry = win.eval(`wellnessEntryHTML({id:'a',date:'2026-07-14',energy:4,sleepHours:7.5,soreness:2})`);
  const htmlLegacyEntry = win.eval(`wellnessEntryHTML({id:'b',date:'2026-07-05',energy:3,sleep:3,soreness:3})`);
  console.log('Test 11 (wellnessEntryHTML shows hours for new entries, legacy /5 display for old sleep-only entries):', {
    result: (htmlNewEntry.includes('7.5h') && htmlLegacyEntry.includes('3/5')) ? 'PASS' : 'FAIL',
    hasHours: htmlNewEntry.includes('7.5h'), hasLegacy: htmlLegacyEntry.includes('3/5')
  });

  win.eval(`todayISO = __origTodayISO;`);
  await wait(200);
  win.close();
})();
