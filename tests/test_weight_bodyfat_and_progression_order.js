// Regression test for the batch where Dylon asked: "let weight and body fat in the profile take its
// data when i manually add weight and body fat. this also means that we have to add body fat when we
// log weight manually. in the progress tab place run progression before strength progression."
//
// Three changes covered here:
// 1. Quick Add > Weight now has a Body fat (%) field alongside Weight, saved onto the EXTRALOGS entry
//    as bodyFat.
// 2. Profile's Weight/Body fat are no longer their own separate, manually-typed fields -- they're a
//    read-only display of latestWeighIn() (the most recent Quick Add > Weight entry), tappable to log
//    a new one. Clarified directly with Dylon: read-only, not still independently editable.
// 3. In renderProgress(), Run Progression now renders before Strength Progression (was the other way
//    around).
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
  win.eval(`__origTodayISO = todayISO; todayISO = function(){ return '2026-07-27'; };`);

  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-07-14',
      strengthProgression:[{exercise:'Pull-ups',start:'3x5',target:'3x10'}],
      sessions:[
        {id:'w1run',wk:1,ty:'easy',date:'2026-07-01',ph:'dur',ti:'Easy Run'}
      ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions;
    ACTIVE_BLOCK_ID='b1';
    STATUS={w1run:'done'};
    NOTES={w1run:{weight:'70.0'}};
    MILEAGE_PLAN={1:20};
    RACES_LIST=[];
    EXTRALOGS=[];
    PROFILE={name:'Dylon'};
  `);

  // ---- Test 1: buildQuickAddBody('weight') includes a Body fat (%) input alongside Weight ----
  const qaWeightBodyHTML = win.eval(`buildQuickAddBody('weight', null)`);
  const hasWeightField = qaWeightBodyHTML.includes('id="qa-weight"');
  const hasBodyFatField = qaWeightBodyHTML.includes('id="qa-bodyfat"') && qaWeightBodyHTML.includes('Body fat');
  console.log('Test 1 (Quick Add Weight form has both a Weight and a Body fat field):', {
    hasWeightField, hasBodyFatField,
    result: (hasWeightField && hasBodyFatField) ? 'PASS' : 'FAIL'
  });

  // ---- Test 2: saveQuickAdd() captures bodyFat onto the EXTRALOGS entry ----
  win.eval(`
    document.getElementById('qa-sh-body').innerHTML = buildQuickAddBody('weight', null);
    QA_KIND='weight'; QA_SUBTYPE=null; QA_EDIT_ID=null; QA_SELECTED_TAGS=new Set();
    document.getElementById('qa-date').value='2026-07-20';
    document.getElementById('qa-weight').value='69.5';
    document.getElementById('qa-bodyfat').value='16.2';
    saveQuickAdd();
  `);
  const savedEntry = JSON.parse(win.eval(`JSON.stringify(EXTRALOGS.find(x=>x.kind==='weight'))`));
  console.log('Test 2 (saveQuickAdd stores both weight and bodyFat on the EXTRALOGS entry):', {
    savedEntry,
    result: (savedEntry && savedEntry.weight==='69.5' && savedEntry.bodyFat==='16.2') ? 'PASS' : 'FAIL'
  });

  // ---- Test 3: latestWeighIn() picks the most recent entry by date and surfaces its bodyFat, even
  // though there's also an older legacy NOTES-based weight entry (2026-07-01, no bodyFat) ----
  const latest = JSON.parse(win.eval(`JSON.stringify(latestWeighIn())`));
  console.log('Test 3 (latestWeighIn returns the most recent weigh-in, including body fat):', {
    latest,
    result: (latest && latest.date==='2026-07-20' && latest.weight===69.5 && latest.bodyFat===16.2) ? 'PASS' : 'FAIL'
  });

  // ---- Test 4: latestWeighIn() returns null when nothing at all has been logged ----
  const noneLogged = win.eval(`
    (function(){
      const savedExtralogs = EXTRALOGS, savedNotes = NOTES;
      EXTRALOGS = []; NOTES = {};
      const result = latestWeighIn();
      EXTRALOGS = savedExtralogs; NOTES = savedNotes;
      return result;
    })()
  `);
  console.log('Test 4 (latestWeighIn returns null with no weigh-in ever logged):',
    noneLogged===null ? 'PASS' : 'FAIL', { noneLogged });

  // ---- Test 5: Profile shows the latest weigh-in read-only (no more editable p-weight/p-bf inputs),
  // tappable to open Quick Add > Weight ----
  win.eval(`renderProfile();`);
  const profileHTML = win.eval(`document.getElementById('view-profile').innerHTML`);
  const noEditableWeightInput = !profileHTML.includes('id="p-weight"');
  const noEditableBfInput = !profileHTML.includes('id="p-bf"');
  const showsWeightValue = profileHTML.includes('69.5 kg');
  const showsBodyFatValue = profileHTML.includes('16.2%');
  const opensQuickAdd = /class="profile-readonly-stat" onclick="fabQuickAdd\('weight'\)"/.test(profileHTML);
  console.log('Test 5 (Profile shows the latest weigh-in read-only, not as separate editable fields):', {
    noEditableWeightInput, noEditableBfInput, showsWeightValue, showsBodyFatValue, opensQuickAdd,
    result: (noEditableWeightInput && noEditableBfInput && showsWeightValue && showsBodyFatValue && opensQuickAdd) ? 'PASS' : 'FAIL'
  });

  // ---- Test 6: with nothing logged, Profile shows a clear empty state instead of a blank field ----
  win.eval(`
    __savedExtralogs=EXTRALOGS; __savedNotes=NOTES;
    EXTRALOGS=[]; NOTES={};
    renderProfile();
  `);
  const emptyProfileHTML = win.eval(`document.getElementById('view-profile').innerHTML`);
  const showsEmptyState = emptyProfileHTML.includes('No weigh-in logged yet');
  win.eval(`EXTRALOGS=__savedExtralogs; NOTES=__savedNotes; renderProfile();`);
  console.log('Test 6 (Profile shows a clear empty state before any weigh-in has been logged):',
    showsEmptyState===true ? 'PASS' : 'FAIL', { showsEmptyState });

  // ---- Test 7: in the live Progress tab, Run Progression now renders before Strength Progression ----
  win.eval(`renderProgress();`);
  const progressHTML = win.eval(`document.getElementById('view-progress').innerHTML`);
  const runIdx = progressHTML.indexOf('Run Progression');
  const strengthIdx = progressHTML.indexOf('Strength Progression');
  console.log('Test 7 (Progress tab shows Run Progression before Strength Progression):', {
    runIdx, strengthIdx,
    result: (runIdx>=0 && strengthIdx>=0 && runIdx<strengthIdx) ? 'PASS' : 'FAIL'
  });

  win.eval(`todayISO = __origTodayISO;`);
  await wait(200);
  win.close();
})();
