// Regression test for finishing off the one piece of Phase 2 (ANALYTICS_ROADMAP.md) left unbuilt when
// the rest of it shipped: "replaces the current typed-in prewalk/postwalk numeric fields with real
// attached accessory-Activity data ... stop typing an approximation where real recorded data can live
// instead." The two typed km inputs (id="l-prewalk"/"l-postwalk") are gone from the session log form's
// "Walk & Extras" section, replaced with a hint pointing at "+ Attach Activity" (which already
// existed). A warm-up/cool-down walk attached there as an accessory Activity shows its own real
// distance/duration via the same activityStatRowsHTML row every other linked Activity already uses,
// and was already being summed into weekly walk totals regardless of role (weekMetricTotal's
// activitiesForWeek() call) -- so no new aggregation code was needed, only the UI change. Old
// sessions' already-logged NOTES[id].prewalk/postwalk keep counting via a legacy-only read in
// sessionMetric() (covered separately by test_trend_breakdown_merge.js's Test 5, left untouched).
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
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-07-14',sessions:[
      {id:'sRun',wk:1,ty:'easy',date:'2026-07-01',ph:'dur',ti:'Easy Run'},
      {id:'sCi',wk:1,ty:'checkin',date:'2026-07-01',ph:'dur',ti:'Weekly Check-In'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions;
    ACTIVE_BLOCK_ID='b1';
    STATUS={};
    NOTES={};
    MILEAGE_PLAN={1:20};
    RACES_LIST=[];
    EXTRALOGS=[];
    ACTIVITIES=[];
    SESS_ATTACH_OPEN=false;
  `);

  // ---- Test 1: the Run session's log form no longer has typed prewalk/postwalk inputs ----
  const runFieldsHTML = win.eval(`sessionLogFieldsHTML(findSess('sRun'), NOTES.sRun||{})`);
  const noPrewalkInput = !runFieldsHTML.includes('id="l-prewalk"');
  const noPostwalkInput = !runFieldsHTML.includes('id="l-postwalk"');
  console.log('Test 1 (session log form no longer has typed Pre-/Post-session walk inputs):', {
    noPrewalkInput, noPostwalkInput,
    result: (noPrewalkInput && noPostwalkInput) ? 'PASS' : 'FAIL'
  });

  // ---- Test 2: in its place, a hint pointing at "+ Attach Activity" shows in the Walk & Extras
  // section, and the dead-hang fields (unrelated to this change) are still there for a non-strength
  // session ----
  const hasAttachHint = runFieldsHTML.includes('Attach Activity') && runFieldsHTML.includes('Walk & Extras');
  const hasHangFields = runFieldsHTML.includes('id="l-hangsets"') && runFieldsHTML.includes('id="l-hangsec"');
  console.log('Test 2 (a hint pointing at + Attach Activity replaces the old inputs; dead-hang fields unaffected):', {
    hasAttachHint, hasHangFields,
    result: (hasAttachHint && hasHangFields) ? 'PASS' : 'FAIL'
  });

  // ---- Test 3: Weekly Check-In's log form skips the Walk & Extras section entirely -- there's
  // nothing to attach a walk to on a reflection day (matches sessionActivitiesHTML's own decision) ----
  const ciFieldsHTML = win.eval(`sessionLogFieldsHTML(findSess('sCi'), NOTES.sCi||{})`);
  const noWalkExtrasOnCheckin = !ciFieldsHTML.includes('Walk & Extras');
  console.log('Test 3 (Weekly Check-In\\u2019s log form has no Walk & Extras section at all):',
    noWalkExtrasOnCheckin===true ? 'PASS' : 'FAIL', { noWalkExtrasOnCheckin });

  // ---- Test 4: captureLogFields no longer writes prewalk/postwalk keys onto NOTES, even if a stray
  // element with that id somehow exists in the DOM (belt-and-suspenders: the field list itself no
  // longer includes them) ----
  win.eval(`
    NOTES={};
    const stray = document.createElement('input');
    stray.id = 'l-prewalk'; stray.value = '1.2';
    document.body.appendChild(stray);
    captureLogFields('sRun');
  `);
  const noteAfterCapture = JSON.parse(win.eval(`JSON.stringify(NOTES.sRun||{})`));
  console.log('Test 4 (captureLogFields never writes a prewalk key onto NOTES, even with a stray input present):', {
    noteAfterCapture,
    result: !('prewalk' in noteAfterCapture) ? 'PASS' : 'FAIL'
  });

  // ---- Test 5: attaching a walk Activity to sRun as an accessory shows it in that session's
  // Activities card with its own real distance/duration (activityStatRowsHTML), not a typed number ----
  win.eval(`
    ACTIVITIES=[];
    NOTES={};
    window.__walkAct = addActivity({type:'walk', date:'2026-07-01', distanceKm:1.4, durationSec:900, title:'Warm-up walk'});
    linkActivityToSession(window.__walkAct.id, 'sRun', 'accessory');
  `);
  const sessionActivitiesCard = win.eval(`sessionActivitiesHTML(findSess('sRun'))`);
  const showsAttachedExtra = sessionActivitiesCard.includes('Attached as extra');
  const showsRealDistance = /1\.4\s*km/.test(sessionActivitiesCard) || sessionActivitiesCard.includes('1.4');
  console.log('Test 5 (a warm-up walk attached as an accessory Activity shows its own real distance in the Activities card):', {
    showsAttachedExtra, showsRealDistance,
    result: (showsAttachedExtra && showsRealDistance) ? 'PASS' : 'FAIL'
  });

  // ---- Test 6: that same accessory-linked walk Activity is already counted in the week's walk total
  // (weekMetricTotal -> activitiesForWeek, regardless of role) -- no prewalk/postwalk needed at all ----
  const walkTotal = win.eval(`weekMetricTotal(1,'walk').total`);
  console.log('Test 6 (the attached accessory walk Activity is already counted in the week\\u2019s walk total):',
    walkTotal===1.4 ? 'PASS' : 'FAIL', { walkTotal });

  win.eval(`todayISO = __origTodayISO;`);
  await wait(200);
  win.close();
})();
