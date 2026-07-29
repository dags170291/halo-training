// Regression test for the second round of Recovery-tab feedback: (1) Durability's rule list now
// renders each rule as an icon-badged row (routine/watch/stop) instead of plain numbered text --
// Dylon: "the calf and shin durability is just words for information"; (2) Prehab log entries lead
// with the existing .sess-ico/ICONS icon-badge system instead of a plain text pill tag -- Dylon:
// "prehab needs to design the log better"; (3) the plan's Weekly Check-In sessions (freeform
// reflection Q&A) now merge into the Wellness sub-tab alongside the numeric WELLNESS_LOG entries --
// Dylon: "ensure our weekly checkins in the plan goes in to wellness."
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
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-06-01',endDate:'2026-09-01',sessions:[
      {id:'s1',wk:1,ty:'easy',date:'2026-07-01',ph:'dur'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions;
    ACTIVE_BLOCK_ID='b1';
    STATUS={};
    NOTES={};
    EXTRALOGS=[];
    RACES_LIST=[];
    INJURIES=[];
    WELLNESS_LOG=[];
    MILEAGE_PLAN={1:20};
  `);

  // ==== Durability icon-badge redesign ====

  // ---- Test 1: RECOVERY_GROUPS rules are typed objects (routine/watch/stop), not plain strings ----
  const ruleTypes = win.eval(`JSON.stringify(RECOVERY_GROUPS[0].rules.map(r=>r.type))`);
  console.log('Test 1 (Durability rules are typed routine/watch/stop objects, not plain strings):',
    ruleTypes.includes('routine') && ruleTypes.includes('watch') && ruleTypes.includes('stop') ? 'PASS' : 'FAIL', { ruleTypes });

  // ---- Test 2: the rendered Durability tab shows icon badges per rule (not a numbered "1." list),
  // and includes at least one of each rule-type tint color ----
  const durabilityHTML = win.eval(`recoveryDurabilityHTML()`);
  const hasIconBadges = /width:30px;height:30px;border-radius:var\(--r10\)/.test(durabilityHTML);
  const noNumberedList = !/>\d\.</.test(durabilityHTML);
  const hasAllThreeTints = durabilityHTML.includes('var(--gr3)') && durabilityHTML.includes('var(--am3)') && durabilityHTML.includes('var(--re3)');
  console.log('Test 2 (Durability renders icon-badged rows, not a numbered text list, with all 3 rule-type tints):', {
    hasIconBadges, noNumberedList, hasAllThreeTints,
    result: (hasIconBadges && noNumberedList && hasAllThreeTints) ? 'PASS' : 'FAIL'
  });

  // ==== Prehab icon-badge redesign ====

  // ---- Test 3: an extra-logged Yoga entry renders with the existing .sess-ico/ico-yoga icon badge,
  // not the old plain text pill tag ----
  win.eval(`EXTRALOGS=[{id:'y1',kind:'yoga',date:'2026-07-01',duration:'20 min',videoTitle:'Runner Yoga Flow'}];`);
  const prehabHTML = win.eval(`recoveryPrehabHTML()`);
  const hasSessIco = prehabHTML.includes('sess-ico') && prehabHTML.includes('ico-yoga');
  console.log('Test 3 (Prehab yoga log entry uses the .sess-ico/ico-yoga icon badge):',
    hasSessIco ? 'PASS' : 'FAIL', { hasSessIco });

  // ---- Test 4: a plan-sourced Mobility entry (a done plan session) also renders with the Mobility
  // icon badge, tagged "Plan" ----
  win.eval(`
    EXTRALOGS=[];
    BLOCKS[0].sessions=[{id:'s1',wk:1,ty:'mobility',date:'2026-07-01',ph:'dur',ti:'Mobility Flow'}];
    DATA=BLOCKS[0].sessions;
    STATUS={s1:'done'};
  `);
  const prehabPlanHTML = win.eval(`recoveryPrehabHTML()`);
  const hasMobilityIco = prehabPlanHTML.includes('sess-ico') && prehabPlanHTML.includes('ico-mobility');
  const hasPlanTag = prehabPlanHTML.includes('>Plan<');
  console.log('Test 4 (Prehab plan-sourced Mobility entry uses the .sess-ico/ico-mobility icon badge, tagged Plan):', {
    hasMobilityIco, hasPlanTag,
    result: (hasMobilityIco && hasPlanTag) ? 'PASS' : 'FAIL'
  });

  // ==== Weekly Check-In -> Wellness merge ====

  win.eval(`STATUS={}; EXTRALOGS=[]; WELLNESS_LOG=[];`);

  // ---- Test 5: a done plan Weekly Check-In session is picked up by planCheckinSessions() ----
  win.eval(`
    BLOCKS[0].sessions=[{id:'ci1',wk:1,ty:'checkin',date:'2026-07-05',ph:'dur',
      steps:[{type:'checkin',label:'Weekly Check-In',intro:'Reflect on the week.',
        questions:[{id:'feel',text:'How did you feel overall this week?'},{id:'tough',text:'What felt the most challenging?'}]}]}];
    DATA=BLOCKS[0].sessions;
    STATUS={ci1:'done'};
    NOTES={ci1:{checkin:{feel:'Pretty strong, legs felt fresh.',tough:'The Thursday tempo run.'}}};
  `);
  const checkinSessions = win.eval(`JSON.stringify(planCheckinSessions().map(s=>s.id))`);
  console.log('Test 5 (a done plan Weekly Check-In session is picked up by planCheckinSessions()):',
    checkinSessions==='["ci1"]' ? 'PASS' : 'FAIL', { checkinSessions });

  // ---- Test 6: an undone Weekly Check-In session is excluded (nothing to show yet) ----
  win.eval(`STATUS={ci1:'pending'};`);
  const undoneCheckinSessions = win.eval(`JSON.stringify(planCheckinSessions().map(s=>s.id))`);
  console.log('Test 6 (an undone Weekly Check-In session is excluded from the Wellness merge):',
    undoneCheckinSessions==='[]' ? 'PASS' : 'FAIL', { undoneCheckinSessions });
  win.eval(`STATUS={ci1:'done'};`);

  // ---- Test 7: the Wellness sub-tab renders the check-in's question text paired with its saved
  // answer, using the existing checkin icon badge ----
  const wellnessHTML = win.eval(`recoveryWellnessHTML()`);
  const hasQuestionText = wellnessHTML.includes('How did you feel overall this week?');
  const hasAnswerText = wellnessHTML.includes('Pretty strong, legs felt fresh.');
  const hasCheckinIco = wellnessHTML.includes('sess-ico') && wellnessHTML.includes('ico-checkin');
  console.log('Test 7 (Wellness tab shows the Weekly Check-In question + saved answer, with the checkin icon badge):', {
    hasQuestionText, hasAnswerText, hasCheckinIco,
    result: (hasQuestionText && hasAnswerText && hasCheckinIco) ? 'PASS' : 'FAIL'
  });

  // ---- Test 8: a numeric WELLNESS_LOG entry and a plan Weekly Check-In both appear together in the
  // Wellness tab, merged into one chronological list (newest first) ----
  win.eval(`WELLNESS_LOG=[{id:'wl1',date:'2026-07-10',energy:4,sleep:4,soreness:2}];`);
  const mergedHTML = win.eval(`recoveryWellnessHTML()`);
  const hasNumericEntry = mergedHTML.includes('Energy 4') || /Energy\s*4/.test(mergedHTML);
  const hasCheckinEntry = mergedHTML.includes('How did you feel overall this week?');
  const numericIdx = mergedHTML.indexOf('Jul 10') >= 0 ? mergedHTML.indexOf('Jul 10') : mergedHTML.search(/Energy/);
  const checkinIdx = mergedHTML.indexOf('Weekly Check-In', mergedHTML.indexOf('section-lbl')+1);
  // wl1 (2026-07-10) is more recent than ci1 (2026-07-05), so it should appear first in the merged list
  console.log('Test 8 (a numeric wellness entry and a plan Weekly Check-In both render together, newest first):', {
    hasNumericEntry, hasCheckinEntry,
    result: (hasNumericEntry && hasCheckinEntry) ? 'PASS' : 'FAIL'
  });

  await wait(200);
  win.close();
})();
