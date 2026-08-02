// Regression test for two related activity-edit-form fixes from the same round of feedback:
//
// 1. Dylon: "Different details for different activity types e.g. mobility & strength don't need
//    shoes." The activity detail popup's edit form (openActivityDetail's editBlock) used to show a
//    "Shoe worn" dropdown for every activity type, including Strength/Yoga/Mobility where it never
//    made sense. New activityTypeWearsFootwear(type) scopes Shoe (and the new Cadence field below) to
//    run/walk/workout only.
//
// 2. Dylon: "would be nice if i can add my own data to an uploaded activity e.g. cadence even if it
//    doesnt come in the tcx file." New a.avgCadence is a manually-entered scalar field (unlike
//    avgHr/avgPower, which the import parser itself fills in from the file's own stream) -- editable
//    via the same edit form, shown in activityStatRowsHTML whenever set.
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
    ACTIVITIES=[];
    addActivity({type:'run', date:'2026-08-01', durationSec:1800, distanceKm:5, source:'import', role:'unplanned'});
    addActivity({type:'strength', date:'2026-08-01', durationSec:2700, source:'import', role:'unplanned'});
    addActivity({type:'mobility', date:'2026-08-01', durationSec:1200, source:'import', role:'unplanned'});
  `);
  const runId = win.eval(`ACTIVITIES.find(a=>a.type==='run').id`);
  const strId = win.eval(`ACTIVITIES.find(a=>a.type==='strength').id`);
  const mobId = win.eval(`ACTIVITIES.find(a=>a.type==='mobility').id`);

  // ---- Test 1: activityTypeWearsFootwear correctly scopes to run/walk/workout only ----
  const t1 = win.eval(`[activityTypeWearsFootwear('run'),activityTypeWearsFootwear('walk'),activityTypeWearsFootwear('workout'),activityTypeWearsFootwear('strength'),activityTypeWearsFootwear('yoga'),activityTypeWearsFootwear('mobility')]`);
  console.log('Test 1 (activityTypeWearsFootwear: run/walk/workout=true, strength/yoga/mobility=false):',
    JSON.stringify(t1) === JSON.stringify([true,true,true,false,false,false]) ? 'PASS' : 'FAIL', { t1 });

  // ---- Test 2: opening the edit form for a RUN activity shows both Shoe and Cadence fields ----
  win.eval(`OPEN_ACTIVITY_ID='${runId}'; ACT_EDIT_MODE=true; ACT_EDIT_TAGS=new Set(); openActivityDetail('${runId}');`);
  const runHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  console.log('Test 2 (a Run activity\'s edit form shows Shoe worn and Avg cadence fields):',
    (runHTML.includes('act-edit-shoe') && runHTML.includes('act-edit-cadence')) ? 'PASS' : 'FAIL');

  // ---- Test 3: opening the edit form for a STRENGTH activity shows NEITHER Shoe nor Cadence ----
  win.eval(`OPEN_ACTIVITY_ID='${strId}'; ACT_EDIT_MODE=true; ACT_EDIT_TAGS=new Set(); openActivityDetail('${strId}');`);
  const strHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  console.log('Test 3 (a Strength activity\'s edit form shows NEITHER Shoe worn nor Avg cadence):',
    (!strHTML.includes('act-edit-shoe') && !strHTML.includes('act-edit-cadence')) ? 'PASS' : 'FAIL');

  // ---- Test 4: same for MOBILITY ----
  win.eval(`OPEN_ACTIVITY_ID='${mobId}'; ACT_EDIT_MODE=true; ACT_EDIT_TAGS=new Set(); openActivityDetail('${mobId}');`);
  const mobHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  console.log('Test 4 (a Mobility activity\'s edit form shows NEITHER Shoe worn nor Avg cadence):',
    (!mobHTML.includes('act-edit-shoe') && !mobHTML.includes('act-edit-cadence')) ? 'PASS' : 'FAIL');

  // ---- Test 5: typing a cadence value into the Run activity's edit form and saving persists it as
  // a.avgCadence, and it now shows up in the (non-edit-mode) stat rows even though the imported file
  // had no cadence stream data at all -- the exact "add my own data ... even if it doesnt come in the
  // tcx file" case. ----
  win.eval(`
    OPEN_ACTIVITY_ID='${runId}'; ACT_EDIT_MODE=true; ACT_EDIT_TAGS=new Set();
    openActivityDetail('${runId}');
    document.getElementById('act-edit-cadence').value='176';
    saveActivityDetailsInline('${runId}');
  `);
  const savedCadence = win.eval(`ACTIVITIES.find(a=>a.id==='${runId}').avgCadence`);
  const viewHTML = win.eval(`(function(){ OPEN_ACTIVITY_ID='${runId}'; ACT_EDIT_MODE=false; openActivityDetail('${runId}'); return document.getElementById('confirm-sheet-inner').innerHTML; })()`);
  console.log('Test 5 (typing a cadence value and saving persists it, and it shows in the stat rows even with no cadence stream in the file):',
    (savedCadence === 176 && /176\s*spm/.test(viewHTML)) ? 'PASS' : 'FAIL', { savedCadence, hasSpm176: /176\s*spm/.test(viewHTML) });

  // ---- Test 6: a Strength activity saved through the same flow (no Shoe/Cadence fields in the DOM
  // to read from) doesn't crash and simply leaves those fields unset. ----
  win.eval(`
    OPEN_ACTIVITY_ID='${strId}'; ACT_EDIT_MODE=true; ACT_EDIT_TAGS=new Set();
    openActivityDetail('${strId}');
  `);
  let t6Threw=false;
  try { win.eval(`saveActivityDetailsInline('${strId}')`); } catch(e){ t6Threw=true; }
  const strAfter = JSON.parse(win.eval(`JSON.stringify(ACTIVITIES.find(a=>a.id==='${strId}'))`));
  console.log('Test 6 (saving a Strength activity with no Shoe/Cadence fields in the DOM does not throw, and leaves them unset):',
    (!t6Threw && !strAfter.shoe && !strAfter.avgCadence) ? 'PASS' : 'FAIL', { t6Threw, shoe: strAfter.shoe, avgCadence: strAfter.avgCadence });

  // ---- Test 7: normalizeActivityRecord() carries avgCadence through like every other scalar field
  // (survives a save/reload round-trip, e.g. via a backup export/import) ----
  const t7 = win.eval(`normalizeActivityRecord({type:'run',avgCadence:180}).avgCadence`);
  console.log('Test 7 (normalizeActivityRecord preserves avgCadence like avgHr/avgPower):',
    t7 === 180 ? 'PASS' : 'FAIL', { t7 });

  await wait(200);
  win.close();
})();
