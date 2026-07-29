// Regression test for Phase 0 of ANALYTICS_ROADMAP.md — the new Activity entity (a raw recorded
// activity, independent of any planned session, carrying its own type and a role relative to the
// plan). Covers: normalization defaults, the role/completion side-effect (only 'fulfillment' flips
// STATUS to done), linking/unlinking, the Activity Feed's core query (unplannedActivities), and the
// one rule everything downstream depends on — activitiesInRange() must return every activity
// regardless of role, since role is for completion-tracking only and must never gate analytics.
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

  // Test 1: normalization fills defaults and rejects an unrecognized type.
  const t1 = JSON.parse(win.eval(`JSON.stringify(normalizeActivityRecord({}))`));
  console.log('Test 1 (blank activity normalizes to workout/unplanned with an id):',
    (t1.type === 'workout' && t1.role === 'unplanned' && !!t1.id && Array.isArray(t1.stream.hr)) ? 'PASS' : 'FAIL');

  // Test 2: role can't be fulfillment/accessory without a linkedSessionId, even if requested.
  const t2 = JSON.parse(win.eval(`JSON.stringify(normalizeActivityRecord({type:'run',role:'fulfillment'}))`));
  console.log('Test 2 (fulfillment role forced to unplanned with no linked session):', t2.role === 'unplanned' ? 'PASS' : 'FAIL');

  // Test 3: addActivity with role fulfillment + a linked session flips STATUS to done.
  win.eval(`STATUS['t3-sess']=''; addActivity({type:'run',role:'fulfillment',linkedSessionId:'t3-sess',date:'2027-01-05'});`);
  const t3 = win.eval(`STATUS['t3-sess']`);
  console.log('Test 3 (fulfillment activity marks its linked session done):', t3 === 'done' ? 'PASS' : 'FAIL');

  // Test 4: an accessory activity linked to a session does NOT mark it done.
  win.eval(`STATUS['t4-sess']=''; addActivity({type:'walk',role:'accessory',linkedSessionId:'t4-sess',date:'2027-01-05'});`);
  const t4 = win.eval(`STATUS['t4-sess']`);
  console.log('Test 4 (accessory activity does not mark its linked session done):', t4 === '' ? 'PASS' : 'FAIL');

  // Test 5: linkActivityToSession re-links an unplanned activity as fulfillment and flips STATUS.
  win.eval(`
    STATUS['t5-sess']='';
    const a = addActivity({type:'run',date:'2027-01-06'});
    window.__t5Id = a.id;
  `);
  win.eval(`linkActivityToSession(window.__t5Id, 't5-sess', 'fulfillment');`);
  const t5Status = win.eval(`STATUS['t5-sess']`);
  const t5Role = win.eval(`ACTIVITIES.find(a=>a.id===window.__t5Id).role`);
  console.log('Test 5 (linking an unplanned activity as fulfillment flips STATUS and role):',
    (t5Status === 'done' && t5Role === 'fulfillment') ? 'PASS' : 'FAIL');

  // Test 6: unlinking (sessionId null) resets role to unplanned.
  win.eval(`linkActivityToSession(window.__t5Id, null);`);
  const t6Role = win.eval(`ACTIVITIES.find(a=>a.id===window.__t5Id).role`);
  console.log('Test 6 (unlinking an activity resets its role to unplanned):', t6Role === 'unplanned' ? 'PASS' : 'FAIL');

  // Test 7: activitiesForSession returns only activities linked to that specific session.
  const t7Count = win.eval(`activitiesForSession('t3-sess').length`);
  console.log('Test 7 (activitiesForSession finds only its own linked activities):', t7Count === 1 ? 'PASS' : 'FAIL');

  // Test 8: unplannedActivities returns only role==='unplanned' entries.
  const t8AllUnplanned = win.eval(`unplannedActivities().every(a=>a.role==='unplanned')`);
  console.log('Test 8 (unplannedActivities returns only unplanned-role entries):', t8AllUnplanned ? 'PASS' : 'FAIL');

  // Test 9: THE key rule — activitiesInRange returns everything regardless of role (fulfillment,
  // accessory, and unplanned all count toward analytics/totals, matching how Strava's own Training
  // Log has no "was this planned" concept at all; see ANALYTICS_ROADMAP.md §2).
  win.eval(`ACTIVITIES=[]; saveActivitiesList();`);
  win.eval(`
    addActivity({type:'run',role:'fulfillment',linkedSessionId:'t9-sess',date:'2027-02-01'});
    addActivity({type:'walk',role:'accessory',linkedSessionId:'t9-sess',date:'2027-02-01'});
    addActivity({type:'run',date:'2027-02-02'});
  `);
  const t9Count = win.eval(`activitiesInRange('2027-02-01','2027-02-02').length`);
  const t9Roles = JSON.parse(win.eval(`JSON.stringify(activitiesInRange('2027-02-01','2027-02-02').map(a=>a.role))`));
  console.log('Test 9 (activitiesInRange includes all 3 activities regardless of role):',
    (t9Count === 3 && t9Roles.includes('fulfillment') && t9Roles.includes('accessory') && t9Roles.includes('unplanned')) ? 'PASS' : 'FAIL');

  // Test 10: persistence round-trip through the same b5_activities localStorage key loadState() reads.
  win.eval(`saveActivitiesList(true);`);
  const stored = win.eval(`localStorage.getItem('b5_activities')`);
  win.eval(`ACTIVITIES=[]; loadState();`);
  const t10Count = win.eval(`ACTIVITIES.length`);
  console.log('Test 10 (ACTIVITIES persists through b5_activities and reloads via loadState):',
    (stored && JSON.parse(stored).length === 3 && t10Count === 3) ? 'PASS' : 'FAIL');

  // Test 11: normalizeActivityRecord now also carries shoe/tags/rpe (Dylon: "shoes is missing from
  // this as well so if we can add shoes, tags and rpe scale ... just like strava to the run
  // information") -- same value shapes NOTES/EXTRALOGS already use for these fields (a SHOES key
  // string, an array of QA_TAGS keys, and a '1'-'10' string), defaulting to unset/empty rather than
  // null/undefined so every existing display/aggregation convention built for those two applies here
  // unchanged.
  const t11Blank = JSON.parse(win.eval(`JSON.stringify(normalizeActivityRecord({}))`));
  const t11Filled = JSON.parse(win.eval(`JSON.stringify(normalizeActivityRecord({type:'run',shoe:'sl2',tags:['pet','commute'],rpe:'7'}))`));
  console.log('Test 11 (shoe/tags/rpe default to unset/empty, and round-trip when provided):',
    (t11Blank.shoe === '' && Array.isArray(t11Blank.tags) && t11Blank.tags.length === 0 && t11Blank.rpe === '' &&
     t11Filled.shoe === 'sl2' && JSON.stringify(t11Filled.tags) === JSON.stringify(['pet','commute']) && t11Filled.rpe === '7') ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
