// Regression test for editable planned session distance/pace. Dylon: "Add ability to edit distances
// and paces in plans. Like i want to adapt my plan to add a bit more mileage i chould be able to do
// so to specific actiities." Scoped to Easy/Long sessions only (see openLog()'s own v0.34.20 comment
// for why Quality/Race/Strength/Rest/Mobility are excluded). Distance edits s.dist directly (the same
// field runSteps()'s Main step text and recalcBlockDerived()'s mileage total both already read);
// Notes/pace edits s.det (where a pace or HR note already lives as free text for these session types).
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
      {id:'w1d1',wk:1,d:'D1',ty:'easy',date:'2026-07-22',wd:'Wed',ti:'Easy Run',full:'Easy Run',det:'9-10 km, AM',dist:'9-10 km',shoe:'SL2'},
      {id:'w1d6',wk:1,d:'D6',ty:'long',date:'2026-07-25',wd:'Sat',ti:'Long Run',full:'Long Run',det:'15 km, AM',dist:'15 km',shoe:'SL2'},
      {id:'w1d2',wk:1,d:'D2',ty:'str',date:'2026-07-23',wd:'Thu',ti:'Strength',full:'Strength',det:'stuff'},
      {id:'w1d3',wk:1,d:'D3',ty:'qual',date:'2026-07-24',wd:'Fri',ti:'Intervals',full:'Intervals',det:'reps',dist:'~7 km'},
      {id:'w1d0',wk:1,d:'D0',ty:'rest',date:'2026-07-21',wd:'Tue',ti:'Rest',full:'Rest',det:'rest'}
    ]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-20'; BLOCK_END='2026-08-30';
    STATUS={}; NOTES={};
  `);

  // ---- Test 1: an Easy session's Details view shows the "Edit Planned Distance / Pace" button ----
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d1')`);
  const easyHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 1 (an Easy session shows the Edit Planned Distance/Pace button):',
    easyHTML.includes('Edit Planned Distance') ? 'PASS' : 'FAIL');

  // ---- Test 2: a Long session also shows it ----
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d6')`);
  const longHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 2 (a Long session also shows the edit button):',
    longHTML.includes('Edit Planned Distance') ? 'PASS' : 'FAIL');

  // ---- Test 3: Strength/Quality/Rest sessions do NOT show it (out of scope -- see the code comment
  // for why Quality specifically is excluded despite having its own dist string) ----
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d2')`);
  const strHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d3')`);
  const qualHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d0')`);
  const restHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 3 (Strength/Quality/Rest sessions do NOT show the edit button):',
    (!strHTML.includes('Edit Planned Distance') && !qualHTML.includes('Edit Planned Distance') && !restHTML.includes('Edit Planned Distance')) ? 'PASS' : 'FAIL');

  // ---- Test 4: tapping the button opens the form with Distance/Notes fields prefilled from the
  // session's own current values ----
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d1'); togglePlanEdit('w1d1')`);
  const formHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  const t4HasFields = formHTML.includes('id="pe-dist"') && formHTML.includes('id="pe-det"');
  const t4Prefilled = win.eval(`document.getElementById('pe-dist').value`) === '9-10 km';
  console.log('Test 4 (the edit form has Distance/Notes fields, prefilled from the session\'s own values):',
    (t4HasFields && t4Prefilled) ? 'PASS' : 'FAIL');

  // ---- Test 5: saving new values updates the session's own dist/det fields directly, and the
  // block's mileagePlan (parsed from dist) updates accordingly -- Dylon's real use case, "add a bit
  // more mileage." ----
  win.eval(`
    document.getElementById('pe-dist').value='12-13 km';
    document.getElementById('pe-det').value='PM, target 5:30/km';
    savePlanEdits('w1d1');
  `);
  const savedSess = JSON.parse(win.eval(`JSON.stringify(findSess('w1d1'))`));
  const mileagePlan = JSON.parse(win.eval(`JSON.stringify(BLOCKS[0].mileagePlan)`));
  // Week 1's mileagePlan total is w1d1's new 12km PLUS w1d6's own unrelated 15km Long Run (both are
  // isRunTypeSession() and share wk:1) -- 27, not 12 alone.
  console.log('Test 5 (saving updates dist/det directly, and mileagePlan reflects the new distance):',
    (savedSess.dist === '12-13 km' && savedSess.det === 'PM, target 5:30/km' && mileagePlan['1'] === 27) ? 'PASS' : 'FAIL',
    { savedSess, mileagePlan });

  // ---- Test 6: the edit is immediately reflected in stepsFor()'s own Main step text -- not just the
  // raw session object, the actual rendered plan too. ----
  const steps = JSON.parse(win.eval(`JSON.stringify(stepsFor(findSess('w1d1')))`));
  const mainStep = steps.find(s => s.type === 'runline' && s.big);
  console.log('Test 6 (the new distance shows up in the rendered Main step text immediately):',
    (mainStep && mainStep.text.includes('12-13 km')) ? 'PASS' : 'FAIL', { mainStep });

  // ---- Test 7: saving closes the edit form (PLAN_EDIT_OPEN resets to false) and shows a toast ----
  console.log('Test 7 (saving closes the edit form):', win.eval(`PLAN_EDIT_OPEN`) === false ? 'PASS' : 'FAIL');

  // ---- Test 8: opening a DIFFERENT session resets PLAN_EDIT_OPEN back to false, same
  // reset-on-different-session pattern LOGGED_DATA_OPEN/SESS_ATTACH_OPEN already use ----
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d1'); togglePlanEdit('w1d1')`);
  const wasOpen = win.eval(`PLAN_EDIT_OPEN`);
  win.eval(`openLog('w1d6')`);
  const resetAfterSwitch = win.eval(`PLAN_EDIT_OPEN`);
  console.log('Test 8 (switching to a different session resets the edit form closed):',
    (wasOpen === true && resetAfterSwitch === false) ? 'PASS' : 'FAIL', { wasOpen, resetAfterSwitch });

  // ---- Test 9: v0.34.22 -- Dylon: "now that we can edit distance and pace targets ensure that
  // overall plan distance calculates as well." Root cause: recalcBlockDerived() reassigns
  // owner.mileagePlan to a brand NEW object, but the global MILEAGE_PLAN (what blockPlanTotal() /
  // the "km logged / planned" stat / the Current Block progress bar all actually read) was a stale
  // snapshot only ever refreshed by setActiveBlock() -- so BLOCKS[0].mileagePlan (checked in Test 5)
  // updated correctly, but the app-wide total silently didn't. Confirm blockPlanTotal() itself now
  // reflects the same edit Test 5 already proved landed on the block object. ----
  const planTotal = win.eval(`blockPlanTotal()`);
  // Week 1 = 27 (12 edited + 15 unrelated Long Run) is the only week with any run mileage in this
  // fixture, so the plan-wide total should be exactly that.
  console.log('Test 9 (blockPlanTotal() reflects the edited distance, not a stale pre-edit snapshot):',
    planTotal === 27 ? 'PASS' : 'FAIL', { planTotal });

  await wait(200);
  win.close();
})();
