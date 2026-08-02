// Regression test for editable planned session targets. v0.34.20 first shipped this as a single
// Distance text box + one combined Notes/pace textarea ("Add ability to edit distances and paces in
// plans. Like i want to adapt my plan to add a bit more mileage i chould be able to do so to specific
// actiities."). v0.34.23 -- Dylon, after seeing that first version: "make distance heart rate and pace
// in the sessions a proper editable fields not just a generic note. give them individual fields that
// the app can read from and calculate from when needed also ensure when i place a distance say 20 km
// it updates the total for that week." Replaced with three real min/max field pairs (Distance km,
// Pace mm:ss/km, HR bpm) plus a separate plain Notes field, widened to Quality/Interval sessions too
// (Dylon's own choice when asked), and HR made an OPTIONAL override of the live-calculated Zone 2
// range rather than replacing that calculation outright (also Dylon's own choice).
//
// Distance edits s.distMin/s.distMax directly (numbers) and derive the legacy s.dist STRING on save,
// which is what recalcBlockDerived()'s mileage total (and ~70 other read sites across the app) still
// actually reads -- see savePlanEdits()'s own comment for why that's deliberate, not a half-finished
// migration. Pace/HR edits s.targetPaceMin/Max (mm:ss strings) and s.targetHRMin/Max (bpm numbers).
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

  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-20',endDate:'2026-08-30',mileagePlan:{1:9},sessions:[
      {id:'w1d1',wk:1,d:'D1',ty:'easy',date:'2026-07-22',wd:'Wed',ti:'Easy Run',full:'Easy Run',det:'AM, target 5:45/km',dist:'9-10 km',shoe:'SL2'},
      {id:'w1d6',wk:1,d:'D6',ty:'long',date:'2026-07-25',wd:'Sat',ti:'Long Run',full:'Long Run',det:'15 km, AM',dist:'15 km',shoe:'SL2'},
      {id:'w1d2',wk:1,d:'D2',ty:'str',date:'2026-07-23',wd:'Thu',ti:'Strength',full:'Strength',det:'stuff'},
      {id:'w1d3',wk:1,d:'D3',ty:'qual',date:'2026-07-24',wd:'Fri',ti:'Intervals',full:'Intervals',det:'reps',dist:'~7 km'},
      {id:'w1d0',wk:1,d:'D0',ty:'rest',date:'2026-07-21',wd:'Tue',ti:'Rest',full:'Rest',det:'rest'}
    ]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-20'; BLOCK_END='2026-08-30';
    STATUS={}; NOTES={};
  `);

  // ---- Test 1: an Easy session's Details view shows the "Edit Distance / Pace / HR" button ----
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d1')`);
  const easyHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 1 (an Easy session shows the Edit Distance/Pace/HR button):',
    easyHTML.includes('Edit Distance / Pace / HR') ? 'PASS' : 'FAIL');

  // ---- Test 2: a Long session also shows it ----
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d6')`);
  const longHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 2 (a Long session also shows the edit button):',
    longHTML.includes('Edit Distance / Pace / HR') ? 'PASS' : 'FAIL');

  // ---- Test 3: Quality sessions NOW show it too (v0.34.23 widened scope), Strength/Rest still do NOT ----
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d3')`);
  const qualHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d2')`);
  const strHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d0')`);
  const restHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 3 (Quality now shows the edit button too; Strength/Rest still do NOT):',
    (qualHTML.includes('Edit Distance / Pace / HR') && !strHTML.includes('Edit Distance / Pace / HR') && !restHTML.includes('Edit Distance / Pace / HR')) ? 'PASS' : 'FAIL');

  // ---- Test 4: tapping the button opens the form with 6 real Distance/Pace/HR min-max fields plus a
  // separate Notes field, pre-filled by best-effort parsing the session's OLD free-text dist/det (9-10
  // km -> distMin=9/distMax=10; "target 5:45/km" -> paceMin=paceMax="5:45"), with the old pace mention
  // stripped out of the pre-filled Notes text since it now has its own dedicated field. ----
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d1'); togglePlanEdit('w1d1')`);
  const formHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  const t4HasFields = ['pe-dist-min','pe-dist-max','pe-pace-min','pe-pace-max','pe-hr-min','pe-hr-max','pe-det'].every(id => formHTML.includes(`id="${id}"`));
  const t4DistPrefilled = win.eval(`document.getElementById('pe-dist-min').value`) === '9' && win.eval(`document.getElementById('pe-dist-max').value`) === '10';
  const t4PacePrefilled = win.eval(`document.getElementById('pe-pace-min').value`) === '5:45' && win.eval(`document.getElementById('pe-pace-max').value`) === '5:45';
  const t4NotesStripped = win.eval(`document.getElementById('pe-det').value`) === 'AM';
  console.log('Test 4 (the edit form has all 6 min/max fields + Notes, pre-filled by parsing the legacy dist/det text, pace stripped from Notes):',
    (t4HasFields && t4DistPrefilled && t4PacePrefilled && t4NotesStripped) ? 'PASS' : 'FAIL',
    { t4HasFields, t4DistPrefilled, t4PacePrefilled, t4NotesStripped });

  // ---- Test 5: saving new values stores real distMin/distMax/targetPaceMin/targetPaceMax/
  // targetHRMin/targetHRMax directly on the session, derives the legacy s.dist string from
  // distMin/distMax, and the block's mileagePlan (parsed from that derived s.dist) updates accordingly
  // -- Dylon's explicit ask, "ensure when i place a distance say 20 km it updates the total for that
  // week." ----
  win.eval(`
    document.getElementById('pe-dist-min').value='12';
    document.getElementById('pe-dist-max').value='13';
    document.getElementById('pe-pace-min').value='5:15';
    document.getElementById('pe-pace-max').value='5:30';
    document.getElementById('pe-hr-min').value='140';
    document.getElementById('pe-hr-max').value='150';
    document.getElementById('pe-det').value='PM, flat route';
    savePlanEdits('w1d1');
  `);
  const savedSess = JSON.parse(win.eval(`JSON.stringify(findSess('w1d1'))`));
  const mileagePlan = JSON.parse(win.eval(`JSON.stringify(BLOCKS[0].mileagePlan)`));
  // Week 1's mileagePlan total is w1d1's new 12km PLUS w1d6's own unrelated 15km Long Run (both are
  // isRunTypeSession() and share wk:1) -- 27, not 12 alone. w1d3 (Quality, '~7 km') isn't touched by
  // this save so it stays out of this particular sum's math (still string 'dist', not distMin).
  console.log('Test 5 (saving stores real distMin/distMax/targetPaceMin/Max/targetHRMin/Max, derives s.dist, and mileagePlan reflects it):',
    (savedSess.distMin === 12 && savedSess.distMax === 13 && savedSess.targetPaceMin === '5:15' && savedSess.targetPaceMax === '5:30'
      && savedSess.targetHRMin === 140 && savedSess.targetHRMax === 150 && savedSess.dist === '12-13 km' && savedSess.det === 'PM, flat route'
      && mileagePlan['1'] === 27) ? 'PASS' : 'FAIL',
    { savedSess, mileagePlan });

  // ---- Test 6: blockPlanTotal() (the app-wide plan total, not just this one block's own mileagePlan
  // object) also reflects the edit -- the v0.34.22 fix this same round builds on. ----
  const planTotal = win.eval(`blockPlanTotal()`);
  console.log('Test 6 (blockPlanTotal() reflects the edited distance, not a stale pre-edit snapshot):',
    planTotal === 27 ? 'PASS' : 'FAIL', { planTotal });

  // ---- Test 7: the new distance/pace/HR show up in stepsFor()'s own Main step text immediately --
  // once ANY structured field is set, the session switches fully to the new structured display path
  // (not a byte-identical old free-text render with numbers swapped in). ----
  const steps = JSON.parse(win.eval(`JSON.stringify(stepsFor(findSess('w1d1')))`));
  const mainStep = steps.find(s => s.type === 'runline' && s.big);
  const t7 = mainStep && mainStep.text.includes('12-13 km') && mainStep.sub.includes('PM, flat route') && mainStep.sub.includes('Target 5:15-5:30/km') && mainStep.sub.includes('HR 140-150 bpm');
  console.log('Test 7 (the new distance/pace/HR override show up in the rendered Main step text immediately):',
    t7 ? 'PASS' : 'FAIL', { mainStep });

  // ---- Test 8: leaving HR blank (no override) keeps using the live-calculated Zone 2 range exactly
  // as before this feature -- HR is an OPTIONAL override, not a replacement for the calculation. ----
  win.eval(`
    PROFILE.savedHRZones = {...computeHRZones({age:30,maxHRFormula:'tanaka'}), method:'karvonen'};
    PLAN_EDIT_OPEN=false; openLog('w1d1'); togglePlanEdit('w1d1');
    document.getElementById('pe-hr-min').value='';
    document.getElementById('pe-hr-max').value='';
    savePlanEdits('w1d1');
  `);
  const noOverrideSteps = JSON.parse(win.eval(`JSON.stringify(stepsFor(findSess('w1d1')))`));
  const noOverrideMain = noOverrideSteps.find(s => s.type === 'runline' && s.big);
  const t8 = noOverrideMain && /\(Zone 2\)/.test(noOverrideMain.sub) && !/140-150 bpm/.test(noOverrideMain.sub);
  console.log('Test 8 (leaving HR blank falls back to the live-calculated Zone 2 range, not a stale/blank HR line):',
    t8 ? 'PASS' : 'FAIL', { noOverrideMain });

  // ---- Test 9: a session that's NEVER been touched by the new edit form (no structured fields set
  // at all) renders through the exact old text-only path, byte-identical to before this feature
  // shipped -- w1d6 (Long Run) hasn't been edited in this test run. ----
  const untouchedSteps = JSON.parse(win.eval(`JSON.stringify(stepsFor(findSess('w1d6')))`));
  const untouchedMain = untouchedSteps.find(s => s.type === 'runline' && s.big);
  console.log('Test 9 (an unedited session still renders through the exact legacy text-only path):',
    (untouchedMain && untouchedMain.text.includes('15 km') && untouchedMain.sub.includes('15 km, AM')) ? 'PASS' : 'FAIL', { untouchedMain });

  // ---- Test 10: a Block-5 Quality session's structured pace/HR override actually changes its
  // interval work line (QUALITY_CFG-driven reps/rest/warmup/cooldown stay untouched -- only the
  // pace/HR portion of the work line changes). ----
  win.eval(`
    BLOCKS.push({id:'block5',name:'Block 5',startDate:'2026-07-20',endDate:'2026-09-27',mileagePlan:{},sessions:[
      {id:'w2d3',wk:2,d:'D3',ty:'qual',date:'2026-07-29',wd:'Wed',ti:'Intervals',full:'Intervals',det:'reps'}
    ]});
    ACTIVE_BLOCK_ID='block5'; DATA=BLOCKS.find(b=>b.id==='block5').sessions;
  `);
  const beforeOverrideSteps = JSON.parse(win.eval(`JSON.stringify(stepsFor(findSess('w2d3')))`));
  const beforeWorkLine = beforeOverrideSteps.find(s => s.type === 'interval');
  win.eval(`
    PLAN_EDIT_OPEN=false; openLog('w2d3'); togglePlanEdit('w2d3');
    document.getElementById('pe-pace-min').value='4:50';
    document.getElementById('pe-pace-max').value='4:50';
    document.getElementById('pe-hr-min').value='165';
    document.getElementById('pe-hr-max').value='';
    savePlanEdits('w2d3');
  `);
  const afterOverrideSteps = JSON.parse(win.eval(`JSON.stringify(stepsFor(findSess('w2d3')))`));
  const afterWorkLine = afterOverrideSteps.find(s => s.type === 'interval');
  console.log('Test 10 (a Block 5 Quality session\'s pace/HR override changes its interval work line, reps/rest untouched):',
    (beforeWorkLine.text.includes('~5:00/km effort') && afterWorkLine.text.includes('4:50/km') && afterWorkLine.text.includes('HR 165 bpm')
      && beforeOverrideSteps.find(s=>s.repeat).repeat === afterOverrideSteps.find(s=>s.repeat).repeat) ? 'PASS' : 'FAIL',
    { beforeWorkLine, afterWorkLine });

  // Reset back to the original test block for the remaining checks.
  win.eval(`ACTIVE_BLOCK_ID='b1'; DATA=BLOCKS.find(b=>b.id==='b1').sessions;`);

  // ---- Test 11: saving closes the edit form ----
  console.log('Test 11 (saving closes the edit form):', win.eval(`PLAN_EDIT_OPEN`) === false ? 'PASS' : 'FAIL');

  // ---- Test 12: opening a DIFFERENT session resets PLAN_EDIT_OPEN back to false, same
  // reset-on-different-session pattern LOGGED_DATA_OPEN/SESS_ATTACH_OPEN already use ----
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d1'); togglePlanEdit('w1d1')`);
  const wasOpen = win.eval(`PLAN_EDIT_OPEN`);
  win.eval(`openLog('w1d6')`);
  const resetAfterSwitch = win.eval(`PLAN_EDIT_OPEN`);
  console.log('Test 12 (switching to a different session resets the edit form closed):',
    (wasOpen === true && resetAfterSwitch === false) ? 'PASS' : 'FAIL', { wasOpen, resetAfterSwitch });

  await wait(200);
  win.close();
})();
