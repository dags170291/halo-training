// Regression test for Phase 2 of ANALYTICS_ROADMAP.md -- multi-activity days & reconciliation. Phase 0
// already built the underlying data model (linkActivityToSession/activitiesForSession/
// unplannedActivities) but nothing in the UI ever called it -- Dylon: "my 2.63 run is actually my
// recovery run which is planned today so we should start working on either uploaded runs in sessions
// or connecting uploaded sessions with planned ones." This covers the new suggestion engine
// (candidateSessionsForActivity/candidateActivitiesForSession/sessionTypeMatchesActivityType) and both
// new picker UIs: the activity-side "link to a planned session" flow in openActivityDetail, and the
// session-side "+ Attach Activity" flow in openLog, plus the Activity Feed's new "Needs Review" filter
// (the "unmatched activities inbox" from the roadmap doc).
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

  // Shared fixture: one block with three sessions -- an easy run today, a rest day tomorrow (should
  // never be a candidate), and a strength session 3 days out (outside the default 2-day window).
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2027-06-01',endDate:'2027-08-01',sessions:[
      {id:'sEasy',wk:1,ty:'easy',date:'2027-06-10',ph:'dur',ti:'Recovery Run',full:'2027 Block Durability W1D1: Recovery Run'},
      {id:'sRest',wk:1,ty:'rest',date:'2027-06-11',ph:'dur',ti:'Rest Day'},
      {id:'sStr',wk:1,ty:'str',date:'2027-06-13',ph:'dur',ti:'Strength'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; STATUS={}; NOTES={}; RACES_LIST=[];
    ACTIVITIES=[];
    window.__runAct = addActivity({type:'run',date:'2027-06-10',distanceKm:2.63,title:''});
  `);

  // Test 1: candidateSessionsForActivity finds the same-day easy run, excludes the rest day (no
  // fulfillment/accessory target there), and excludes the strength session (3 days out, past the
  // default 2-day window) -- exactly the "date/time/type proximity" suggestion the roadmap calls for.
  const t1Ids = JSON.parse(win.eval(`JSON.stringify(candidateSessionsForActivity(window.__runAct).map(s=>s.id))`));
  console.log('Test 1 (candidateSessionsForActivity finds the same-day session, excludes rest and the too-far session):',
    (t1Ids.length === 1 && t1Ids[0] === 'sEasy') ? 'PASS' : 'FAIL');

  // Test 2: sessionTypeMatchesActivityType -- the "likely match" badge, not a hard filter (accessory
  // candidates of a different type still need to show up in Test 1's results, just unbadged).
  const t2 = {
    runEasy: win.eval(`sessionTypeMatchesActivityType('easy','run')`),
    runStr: win.eval(`sessionTypeMatchesActivityType('str','run')`),
    strStr: win.eval(`sessionTypeMatchesActivityType('str','strength')`),
    yogaMob: win.eval(`sessionTypeMatchesActivityType('mobility','yoga')`),
  };
  console.log('Test 2 (sessionTypeMatchesActivityType badges same-type pairs true, cross-type false):',
    (t2.runEasy === true && t2.runStr === false && t2.strStr === true && t2.yogaMob === true) ? 'PASS' : 'FAIL');

  // Test 3: the activity-side picker (openActivityDetail's activityPlanLinkHTML) shows a "Link to a
  // planned session" prompt by default (not auto-expanded), and expands into the actual candidate list
  // -- with both a Fulfills and an Attach-as-extra action -- once toggled.
  win.eval(`ACT_LINK_PICKER_OPEN=false; ACT_EDIT_MODE=false; openActivityDetail(window.__runAct.id);`);
  const t3Collapsed = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  const t3HasPrompt = /Link to a planned session/.test(t3Collapsed) && !/Which session is this\?/.test(t3Collapsed);
  win.eval(`toggleActivityLinkPicker(window.__runAct.id);`);
  const t3Expanded = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  const t3HasCandidates = /Which session is this\?/.test(t3Expanded) && /Recovery Run/.test(t3Expanded) &&
    /Fulfills this/.test(t3Expanded) && /Attach as extra/.test(t3Expanded);
  console.log('Test 3 (activity-side picker shows a collapsed prompt, then expands to the candidate with both role actions):',
    (t3HasPrompt && t3HasCandidates) ? 'PASS' : 'FAIL');

  // Test 4: picking "Fulfills this" links the activity, flips STATUS to done, and the popup now shows
  // the linked-state view (with an Unlink action) instead of the picker.
  win.eval(`pickActivitySessionLink(window.__runAct.id,'sEasy','fulfillment');`);
  const t4Status = win.eval(`STATUS['sEasy']`);
  const t4Activity = JSON.parse(win.eval(`JSON.stringify(ACTIVITIES.find(a=>a.id===window.__runAct.id))`));
  const t4HTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  console.log('Test 4 (linking as fulfillment marks the session done, updates the activity, and shows the linked view with Unlink):',
    (t4Status === 'done' && t4Activity.role === 'fulfillment' && t4Activity.linkedSessionId === 'sEasy' &&
     /Fulfills Recovery Run/.test(t4HTML) && />Unlink</.test(t4HTML)) ? 'PASS' : 'FAIL');

  // Test 5: unlinking clears the link/role (back to unplanned) but does NOT silently revert the
  // session's STATUS back off done -- matching every other completion action in the app, which never
  // auto-reverses a status; only an explicit tap on Completed does that.
  win.eval(`unlinkActivityFromPlan(window.__runAct.id);`);
  const t5Activity = JSON.parse(win.eval(`JSON.stringify(ACTIVITIES.find(a=>a.id===window.__runAct.id))`));
  const t5Status = win.eval(`STATUS['sEasy']`);
  console.log('Test 5 (unlinking resets role/link to unplanned without silently reverting STATUS):',
    (t5Activity.role === 'unplanned' && t5Activity.linkedSessionId === null && t5Status === 'done') ? 'PASS' : 'FAIL');

  // Test 6: candidateActivitiesForSession (session-side, the reverse direction) finds the same
  // unplanned activity for its nearby session, and the session sheet's own Activities card offers the
  // same two role actions.
  const t6Ids = JSON.parse(win.eval(`JSON.stringify(candidateActivitiesForSession(DATA.find(s=>s.id==='sEasy')).map(a=>a.id))`));
  const t6RunActId = win.eval(`window.__runAct.id`);
  win.eval(`SESS_ATTACH_OPEN=false; openLog('sEasy');`);
  const t6Collapsed = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  win.eval(`toggleSessionAttachPicker('sEasy');`);
  const t6Expanded = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 6 (candidateActivitiesForSession finds the nearby unplanned activity; session sheet picker offers both role actions):',
    (t6Ids.length === 1 && t6Ids[0] === t6RunActId &&
    /No activity attached yet\./.test(t6Collapsed) && /Nearby activities not yet linked/.test(t6Expanded) &&
    /Fulfills this/.test(t6Expanded) && /Attach as extra/.test(t6Expanded)) ? 'PASS' : 'FAIL');

  // Test 7: attaching from the session side as 'accessory' does NOT flip STATUS (only fulfillment
  // does), and the session sheet's Activities card now lists it with an Unlink control instead of the
  // picker.
  win.eval(`STATUS['sEasy']=''; attachActivityToSession(window.__runAct.id,'sEasy','accessory');`);
  const t7Status = win.eval(`STATUS['sEasy']`);
  const t7Activity = JSON.parse(win.eval(`JSON.stringify(ACTIVITIES.find(a=>a.id===window.__runAct.id))`));
  const t7HTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 7 (session-side attach as accessory links without marking done, and lists the activity with Unlink):',
    (t7Status === '' && t7Activity.role === 'accessory' && t7Activity.linkedSessionId === 'sEasy' &&
     /Attached as extra/.test(t7HTML) && />Unlink</.test(t7HTML)) ? 'PASS' : 'FAIL');

  // Test 8: detachActivityFromSession removes it from activitiesForSession and the sheet goes back to
  // showing the empty state.
  win.eval(`detachActivityFromSession(window.__runAct.id,'sEasy');`);
  const t8Count = win.eval(`activitiesForSession('sEasy').length`);
  const t8HTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 8 (detachActivityFromSession removes the link and the sheet reverts to the empty state):',
    (t8Count === 0 && /No activity attached yet\./.test(t8HTML)) ? 'PASS' : 'FAIL');

  // Test 9: the Activity Feed's "Needs Review" filter (the roadmap's "unmatched activities inbox") --
  // an unplanned activity with a nearby candidate session counts and is included; a genuinely unplanned
  // one-off with nothing planned anywhere near it does not.
  win.eval(`
    ACTIVITIES=[];
    window.__nearAct = addActivity({type:'run',date:'2027-06-10'});
    window.__farAct = addActivity({type:'run',date:'2027-01-01'});
    ACTFEED_FILTER='needsreview';
  `);
  const t9Body = win.eval(`activityFeedBodyHTML()`);
  const t9NearIncluded = win.eval(`matchesHistoryFilter({kind:'activity',id:window.__nearAct.id},'needsreview')`);
  const t9FarExcluded = win.eval(`matchesHistoryFilter({kind:'activity',id:window.__farAct.id},'needsreview')`);
  console.log('Test 9 (Needs Review includes an unplanned activity with a nearby session, excludes one with nothing nearby, and shows a count pill):',
    (t9NearIncluded === true && t9FarExcluded === false && /Needs Review \(1\)/.test(t9Body)) ? 'PASS' : 'FAIL');

  // Tests 10-12: Dylon -- "when you attach an activity it combines the total volume so it gets
  // doubled." A session already logged by hand (NOTES.dist typed in, marked done) plus a real Activity
  // now linked as its 'fulfillment' used to count toward weekly volume, Training Load, AND Block
  // mileage TWICE -- once from the hand-typed number, once from the Activity's own distanceKm. All
  // three should now count the real Activity's distance exactly once, not stacked with the old
  // hand-typed value.
  win.eval(`
    NOTES={sEasy:{dist:'3'}};
    STATUS={sEasy:'done'};
    ACTIVITIES=[];
    window.__fulfillAct = addActivity({type:'run',date:'2027-06-10',distanceKm:2.63});
    linkActivityToSession(window.__fulfillAct.id,'sEasy','fulfillment');
  `);
  const t10 = win.eval(`weekMetricTotal(1,'run').total`);
  console.log('Test 10 (weekMetricTotal counts the fulfilling Activity once, not stacked with the sessions own hand-typed distance):',
    Math.abs(t10 - 2.63) < 0.001 ? 'PASS' : 'FAIL', { total: t10 });

  const t11 = win.eval(`loggedRunKmInRange('2027-06-09','2027-06-11')`);
  console.log('Test 11 (loggedRunKmInRange counts the fulfilling Activity once, not stacked with the sessions own hand-typed distance):',
    Math.abs(t11 - 2.63) < 0.001 ? 'PASS' : 'FAIL', { total: t11 });

  // Test 12: loggedDist() (feeds "Block mileage complete") still prefers a hand-typed NOTES.dist when
  // one exists (never stacks it with the Activity), but now falls back to the fulfilling Activity's own
  // distance when NOTES.dist was left blank entirely -- so linking alone is never silently worth zero
  // km for that stat either.
  const t12WithNotes = win.eval(`loggedDist('sEasy')`);
  win.eval(`NOTES={sEasy:{}};`);
  const t12FallbackOnly = win.eval(`loggedDist('sEasy')`);
  console.log('Test 12 (loggedDist prefers hand-typed NOTES.dist when present, falls back to the fulfilling Activitys distance when blank):',
    (t12WithNotes === 3 && Math.abs(t12FallbackOnly - 2.63) < 0.001) ? 'PASS' : 'FAIL', { t12WithNotes, t12FallbackOnly });

  // Test 13: an 'accessory' link must NOT suppress the session's own hand-typed metric -- only
  // 'fulfillment' means "this Activity IS this session," so only that role should stop the session's
  // own NOTES-based number from counting.
  win.eval(`NOTES={sEasy:{dist:'3'}}; STATUS={sEasy:'done'}; linkActivityToSession(window.__fulfillAct.id,'sEasy','accessory');`);
  const t13 = win.eval(`weekMetricTotal(1,'run').total`);
  console.log('Test 13 (an accessory link does not suppress the sessions own hand-typed distance, only fulfillment does):',
    Math.abs(t13 - (3 + 2.63)) < 0.001 ? 'PASS' : 'FAIL', { total: t13 });

  // Test 14: Dylon -- "make activity type editable." The edit form now includes a Type select;
  // changing it and saving actually updates the Activity's type, correcting a misdetected import
  // (e.g. inferActivityType wrongly guessing 'run' for a mobility session) without needing to delete
  // and re-import the file.
  win.eval(`ACTIVITIES=[]; window.__typeAct = addActivity({type:'run',date:'2027-06-12'});`);
  win.eval(`ACT_EDIT_MODE=false; openActivityDetail(window.__typeAct.id); toggleActivityEditMode(window.__typeAct.id);`);
  const t14EditHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  const t14HasTypeSelect = /id="act-edit-type"/.test(t14EditHTML);
  win.eval(`
    document.getElementById('act-name-input').value='Mobility Session';
    document.getElementById('act-edit-type').value='mobility';
    saveActivityDetailsInline(window.__typeAct.id);
  `);
  const t14SavedType = win.eval(`ACTIVITIES.find(a=>a.id===window.__typeAct.id).type`);
  console.log('Test 14 (the edit form has a Type select, and changing + saving it updates the Activitys type):',
    (t14HasTypeSelect && t14SavedType === 'mobility') ? 'PASS' : 'FAIL', { t14SavedType });

  // Test 15: Dylon -- "some places that should not have attach an activity, the weekly check in
  // should not have an attach an activity button." A Weekly Check-In is a reflection Q&A, not a
  // physical session, so sessionActivitiesHTML() (and therefore openLog's whole Activities card /
  // "+ Attach Activity" button) should render nothing at all for it.
  win.eval(`
    BLOCKS[0].sessions.push({id:'sCheckin',wk:1,ty:'checkin',date:'2027-06-14',ph:'dur',ti:'Weekly Check-In'});
    DATA=BLOCKS[0].sessions;
  `);
  const t15Direct = win.eval(`sessionActivitiesHTML(DATA.find(s=>s.id==='sCheckin'))`);
  win.eval(`openLog('sCheckin');`);
  const t15LogBody = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 15 (Weekly Check-In gets no Activities card / Attach Activity button at all):',
    (t15Direct === '' && !/Attach Activity/.test(t15LogBody) && !/class="card"[^>]*>\\s*<div[^>]*>Activities</.test(t15LogBody)) ? 'PASS' : 'FAIL');

  // Test 16: Dylon -- "no no the add activity is supposed to upload the activity (tcx, gpx files and
  // complete the data." "+ Add Activity" triggers the exact same import pipeline every other entry
  // point uses (triggerActivityImport/handleActivityImportFile), just passing this session's id along
  // -- confirmed by checking the hidden file input actually exists and the button wires to it with the
  // session id attached.
  win.eval(`STATUS={sEasy:''}; NOTES={}; ACTIVITIES=[]; SESS_ATTACH_OPEN=false; openLog('sEasy');`);
  const t16HTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 16 (Add Activity and Attach Activity show side by side, wired to the real import input for this session):',
    (/\+ Add Activity/.test(t16HTML) && /\+ Attach Activity/.test(t16HTML) &&
     /id="sess-add-activity-import-input"/.test(t16HTML) &&
     /triggerActivityImport\('sess-add-activity-import-input','sEasy'\)/.test(t16HTML)) ? 'PASS' : 'FAIL');

  // A minimal real TCX fixture, parsed the same way handleActivityImportFile would (importActivityText
  // -- the FileReader plumbing itself is already covered by test_activity_import.js).
  const SESSION_IMPORT_TCX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Running"><Id>2027-06-10T06:00:00.000-04:00</Id>
    <Lap StartTime="2027-06-10T06:00:00.000-04:00"><TotalTimeSeconds>1800.0</TotalTimeSeconds>
      <DistanceMeters>5000.0</DistanceMeters>
      <Track>
        <Trackpoint><Time>2027-06-10T06:00:00.000-04:00</Time><DistanceMeters>0.0</DistanceMeters><HeartRateBpm><Value>140</Value></HeartRateBpm></Trackpoint>
        <Trackpoint><Time>2027-06-10T06:30:00.000-04:00</Time><DistanceMeters>5000.0</DistanceMeters><HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint>
      </Track>
    </Lap></Activity></Activities>
</TrainingCenterDatabase>`;

  // Test 17: triggering the import for this session, then simulating the parsed file reaching
  // confirmActivityImport() (same as handleActivityImportFile would after FileReader resolves), shows
  // the confirm card with the NAME PRE-FILLED to the session's own title ("complete the data") and an
  // explicit note that it'll be linked as fulfilling that session.
  win.eval(`
    triggerActivityImport('sess-add-activity-import-input','sEasy');
    const parsed = importActivityText(${JSON.stringify(SESSION_IMPORT_TCX)},'session-import.tcx');
    confirmActivityImport(parsed.activity);
  `);
  const t17NameValue = win.eval(`document.getElementById('import-name-input').value`);
  const t17ConfirmHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  console.log('Test 17 (importing from within a session pre-fills the name with the sessions title and notes the auto-link):',
    (t17NameValue === 'Recovery Run' && /Will be linked as fulfilling "Recovery Run\."/.test(t17ConfirmHTML)) ? 'PASS' : 'FAIL');

  // Test 18: tapping Import actually links the resulting Activity as this session's fulfillment
  // (STATUS flips done, same side-effect as linking an already-imported one), and the session sheet
  // -- since it's the one currently open -- immediately shows that Activity's full metrics inline
  // (activityStatRowsHTML, the same renderer the standalone popup uses), not just a name.
  win.eval(`document.getElementById('cf-btn-0').click();`); // Import is btns[0]
  const t18Status = win.eval(`STATUS['sEasy']`);
  const t18Act = JSON.parse(win.eval(`JSON.stringify(ACTIVITIES.find(a=>a.linkedSessionId==='sEasy'))`));
  const t18LogHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 18 (Import links the Activity as fulfillment, marks the session done, and shows its full metrics inline):',
    (t18Status === 'done' && t18Act && t18Act.role === 'fulfillment' && t18Act.distanceKm === 5 &&
     />Distance</.test(t18LogHTML) && />5 km</.test(t18LogHTML) && />Avg HR</.test(t18LogHTML)) ? 'PASS' : 'FAIL', { t18Act });

  // Test 19: cancelling a session-scoped import clears PENDING_IMPORT_SESSION_ID so it can never leak
  // into a later, unrelated import (e.g. from Activity Feed's own generic import button).
  win.eval(`
    ACTIVITIES=[]; STATUS={sEasy:''};
    triggerActivityImport('sess-add-activity-import-input','sEasy');
    const parsed2 = importActivityText(${JSON.stringify(SESSION_IMPORT_TCX)},'cancel-test.tcx');
    confirmActivityImport(parsed2.activity);
    cancelActivityImport();
  `);
  const t19PendingCleared = win.eval(`PENDING_IMPORT_SESSION_ID === null && ACTIVITIES.length === 0`);
  console.log('Test 19 (cancelling a session-scoped import discards it and clears the pending session id):',
    t19PendingCleared ? 'PASS' : 'FAIL');

  // Test 20: FAB gained a third action, originally labeled "Upload Plan," renamed to "Import Training
  // Plan" in v0.32.10 -- Dylon: "rename upload plan in the fab to Import Training plan." fabUploadPlan()
  // closes the fab menu and triggers its OWN hidden file input (#fab-plan-upload-input), not the Plans
  // sheet's #plan-upload-input -- that one only exists in the DOM while the Plans overlay has actually
  // rendered planUploadHeaderHTML(), which isn't true while the FAB lives on Today/Schedule.
  const t20FabHTML = win.eval(`document.getElementById('activity-fab-menu').innerHTML`);
  const t20HasInput = win.eval(`document.getElementById('fab-plan-upload-input') !== null`);
  console.log('Test 20 (FAB menu has an Import Training Plan action wired to its own hidden JSON input):',
    (/Import Training Plan/.test(t20FabHTML) && /fabUploadPlan\(\)/.test(t20FabHTML) && t20HasInput) ? 'PASS' : 'FAIL');

  // Test 21: triggerPlanUpload(inputId) clicks whichever input id is passed (so the FAB button reaches
  // its own input), and falls back to the original #plan-upload-input when called with no argument at
  // all (the Plans sheet's own "Upload Plan" button still calls triggerPlanUpload() bare).
  const t21 = win.eval(`
    let fabClicked = false, plansClicked = false;
    document.getElementById('fab-plan-upload-input').click = () => { fabClicked = true; };
    const fakePlansInput = document.createElement('input');
    fakePlansInput.id = 'plan-upload-input';
    fakePlansInput.click = () => { plansClicked = true; };
    document.body.appendChild(fakePlansInput);
    triggerPlanUpload('fab-plan-upload-input');
    const fabOnly = fabClicked && !plansClicked;
    fabClicked = false; plansClicked = false;
    triggerPlanUpload();
    fakePlansInput.remove();
    JSON.stringify({fabOnly, defaultOnly: (!fabClicked && plansClicked)});
  `);
  const t21r = JSON.parse(t21);
  console.log('Test 21 (triggerPlanUpload targets the id its passed, and defaults to #plan-upload-input when called bare):',
    (t21r.fabOnly && t21r.defaultOnly) ? 'PASS' : 'FAIL');

  // Tests 22-23: the inline-full-analytics behavior these two tests originally covered (v0.32.0) was
  // reverted in v0.32.8. Dylon: "originally i asked for the ability to see the charts in line when i
  // upload an activity to a planned session. I want to revert that since one activity can have many
  // files added to it the stream can get quite long so lets have just the basic info but when i click
  // in to each part of the activity i get taken to the run data. there should be a button however as
  // opposed to clicking the title that says analyze activity next to the uploaded activity." A GPS-
  // bearing TCX (reuses the same fixture shape as test_activity_import.js's SAMPLE_TCX) so the Route
  // card would render if it were (wrongly) still inline, giving these tests something real to rule out.
  const GPS_TCX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Running"><Id>2027-06-10T06:00:00.000-04:00</Id>
    <Lap StartTime="2027-06-10T06:00:00.000-04:00"><TotalTimeSeconds>600.0</TotalTimeSeconds>
      <DistanceMeters>2000.0</DistanceMeters>
      <Track>
        <Trackpoint><Time>2027-06-10T06:00:00.000-04:00</Time><Position><LatitudeDegrees>10.65</LatitudeDegrees><LongitudeDegrees>-61.19</LongitudeDegrees></Position><DistanceMeters>0.0</DistanceMeters><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>
        <Trackpoint><Time>2027-06-10T06:05:00.000-04:00</Time><Position><LatitudeDegrees>10.66</LatitudeDegrees><LongitudeDegrees>-61.20</LongitudeDegrees></Position><DistanceMeters>1000.0</DistanceMeters><HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint>
        <Trackpoint><Time>2027-06-10T06:10:00.000-04:00</Time><Position><LatitudeDegrees>10.67</LatitudeDegrees><LongitudeDegrees>-61.21</LongitudeDegrees></Position><DistanceMeters>2000.0</DistanceMeters><HeartRateBpm><Value>160</Value></HeartRateBpm></Trackpoint>
      </Track>
    </Lap></Activity></Activities>
</TrainingCenterDatabase>`;
  win.eval(`
    ACTIVITIES=[]; STATUS={sEasy:''}; NOTES={};
    const parsedGps = importActivityText(${JSON.stringify(GPS_TCX)},'gps-test.tcx');
    window.__gpsAct = addActivity(parsedGps.activity);
    linkActivityToSession(window.__gpsAct.id,'sEasy','fulfillment');
    saveState();
  `);
  win.eval(`openLog('sEasy');`);
  const t22LogHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  const t22gpsId = win.eval(`window.__gpsAct.id`);
  console.log('Test 22 (a linked activity shows only basic stat rows inline in the session -- no Route card, chart, or Splits table -- plus an Analyze Activity button, and the title itself is no longer clickable):',
    (!/>Route</.test(t22LogHTML) && !/Over the Activity/.test(t22LogHTML) && !/Splits/.test(t22LogHTML) &&
     !new RegExp('id="sess-route-card-'+t22gpsId+'"').test(t22LogHTML) &&
     />Analyze Activity</.test(t22LogHTML) &&
     new RegExp(`onclick="openActivityDetail\\('${t22gpsId}'\\)"`).test(t22LogHTML) &&
     !new RegExp(`cursor:pointer" onclick="openActivityDetail\\('${t22gpsId}'\\)"`).test(t22LogHTML)) ? 'PASS' : 'FAIL',
    { t22LogHTML });

  // Test 23: the "Analyze Activity" button opens the exact same full-analytics popup Activity Feed's
  // own entries use -- Route card, "Over the Activity" chart, Splits table, all with real unprefixed
  // ids -- so nothing was lost by moving it behind a button instead of showing inline.
  win.eval(`openActivityDetail(window.__gpsAct.id);`);
  const t23PopupHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  const t23gpsId = win.eval(`window.__gpsAct.id`);
  console.log('Test 23 (Analyze Activity opens the full popup with Route card, chart, and Splits table intact):',
    (/>Route</.test(t23PopupHTML) && /Over the Activity/.test(t23PopupHTML) && /Splits/.test(t23PopupHTML) &&
     new RegExp(`id="route-card-${t23gpsId}"`).test(t23PopupHTML)) ? 'PASS' : 'FAIL');

  // Tests 24-28: Dylon -- "I still think there is too many descreprencies with planned data and
  // uploaded data. when i edit the uploaded data and edit the rpe and shoes these things needs to be
  // translated to the planned data as well ... once planned data gets a linked upload or linked
  // activity it becomes 1 activity." Traced this to several rollup functions reading NOTES[s.id]
  // directly without checking sessionHasFulfillingActivity, unlike the already-guarded loggedDist()/
  // sessionMetric()/loggedRunKmInRange(). Fresh state for each so nothing here depends on the fixture
  // left over from Tests 1-23 above.

  // Test 24: shoeBlockKm() no longer double-counts (or splits across two shoes) a session that has
  // both a stale hand-typed NOTES.dist/.shoe AND a real linked fulfilling Activity with its own
  // (different) shoe -- only the Activity's real distance/shoe should count, once.
  win.eval(`
    SHOES={shoeA:{name:'Shoe A',km:0},shoeB:{name:'Shoe B',km:0}};
    STATUS={sEasy:'done'}; NOTES={sEasy:{dist:'8',shoe:'shoeA'}}; ACTIVITIES=[];
    const t24Act=addActivity({type:'run',date:'2027-06-10',distanceKm:5,shoe:'shoeB',title:''});
    linkActivityToSession(t24Act.id,'sEasy','fulfillment');
  `);
  const t24ShoeA = win.eval(`shoeBlockKm('shoeA')`);
  const t24ShoeB = win.eval(`shoeBlockKm('shoeB')`);
  console.log('Test 24 (shoeBlockKm counts a fulfilled sessions real Activity shoe/distance once, ignoring the stale NOTES copy):',
    (t24ShoeA === 0 && t24ShoeB === 5) ? 'PASS' : 'FAIL', {t24ShoeA, t24ShoeB});

  // Test 25: computeBlockStats().actualKm no longer under-counts a fulfilled sessions distance when
  // NOTES.dist was never filled in (the normal case for the file-upload workflow) -- it now reads
  // through loggedDist() (route map/Activity fallback included) instead of a raw NOTES.dist check.
  win.eval(`
    STATUS={sEasy:'done'}; NOTES={}; ACTIVITIES=[];
    const t25RunAct=addActivity({type:'run',date:'2027-06-10',distanceKm:6.2,title:''});
    linkActivityToSession(t25RunAct.id,'sEasy','fulfillment');
  `);
  const t25ActualKm = win.eval(`computeBlockStats(BLOCKS[0]).actualKm`);
  console.log('Test 25 (computeBlockStats actualKm includes a fulfilled sessions real Activity distance even with NOTES.dist blank):',
    Math.abs(t25ActualKm - 6.2) < 0.001 ? 'PASS' : 'FAIL', {t25ActualKm});

  // Test 26: historyItems() no longer lists a fulfilled session as its own separate 'session' entry
  // alongside its fulfilling Activity's own 'activity' entry -- same physical run, shown once.
  const t26Items = JSON.parse(win.eval(`JSON.stringify(historyItems().map(i=>({kind:i.kind,id:i.id})))`));
  const t26HasSessionDupe = t26Items.some(i=>i.kind==='session' && i.id==='sEasy');
  const t26HasActivity = t26Items.some(i=>i.kind==='activity');
  console.log('Test 26 (historyItems drops the redundant session entry once its Activity fulfills it, keeping the Activity entry):',
    (!t26HasSessionDupe && t26HasActivity) ? 'PASS' : 'FAIL', {t26Items});

  // Test 27: openLog hides the session's own "Edit Logged Data" toggle once fulfilled (showing an
  // explanatory note instead when there was pre-existing hand-logged data), and still shows it
  // normally for a session with no linked Activity.
  win.eval(`NOTES={sEasy:{dist:'8'}}; openLog('sEasy');`); // sEasy still fulfilled from Test 25 setup
  const t27FulfilledHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  win.eval(`ACTIVITIES=[]; STATUS={sStr:'done'}; NOTES={sStr:{weights:'Goblet squat 12.5kg'}}; openLog('sStr');`);
  const t27UnfulfilledHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 27 (Edit Logged Data is hidden with an explanatory note once fulfilled, but still works normally when not linked):',
    (!/Edit Logged Data/.test(t27FulfilledHTML) && /now come from its linked activity/.test(t27FulfilledHTML) &&
     /Edit Logged Data/.test(t27UnfulfilledHTML)) ? 'PASS' : 'FAIL');

  // Test 28: confirmComplete() shows a short confirmation instead of the full manual data-entry form
  // when tapped on a session that's already fulfilled by a linked Activity (the "status got cleared,
  // Complete tapped again by hand" edge case) -- never invites a second, independent copy of the data.
  win.eval(`
    STATUS={sEasy:''}; NOTES={};
    const t28Act=addActivity({type:'run',date:'2027-06-10',distanceKm:4,title:''});
    linkActivityToSession(t28Act.id,'sEasy','fulfillment');
    STATUS.sEasy=''; // simulate clearing status while still linked
    confirmComplete('sEasy');
  `);
  const t28HTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  console.log('Test 28 (confirmComplete skips the manual form and just confirms completion when a fulfilling Activity is already linked):',
    (/already fulfilled by its linked activity/.test(t28HTML) && !/id="l-dist"/.test(t28HTML)) ? 'PASS' : 'FAIL');

  // Tests 29-31 (v0.32.9): Dylon, looking at a session sheet with a shoe target shown right at the top,
  // ahead of the linked activity -- "move this information into the run details portion below the
  // uploaded activity it seems out of place here as this is information needed before the run. also
  // remove the shoe tag as well." The Distance/Shoe quick-stats row moved from right after the title to
  // just under the "Details" header (below the Activities card); the separate shoe equip-chip pill that
  // used to sit next to it is gone for run-type sessions.
  win.eval(`
    BLOCKS=[{id:'b29',name:'B29',startDate:'2027-06-01',endDate:'2027-07-01',sessions:[
      {id:'sQS',wk:1,ty:'easy',date:'2027-06-01',ph:'dur',ti:'Recovery Run',full:'Recovery Run',dist:'7-8 km',shoe:'SL2'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b29'; STATUS={}; NOTES={}; ACTIVITIES=[];
    openLog('sQS');
  `);
  const t29HTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  const t29ActivitiesIdx = t29HTML.indexOf('Activities');
  const t29DetailsIdx = t29HTML.indexOf('Details');
  const t29QsRowIdx = t29HTML.indexOf('qs-row');
  console.log('Test 29 (Distance/Shoe quick stats now render after the Activities card, under the Details header, not right after the title):',
    (t29ActivitiesIdx>=0 && t29DetailsIdx>t29ActivitiesIdx && t29QsRowIdx>t29DetailsIdx && /7-8 km/.test(t29HTML) && /SL2/.test(t29HTML)) ? 'PASS' : 'FAIL',
    { t29ActivitiesIdx, t29DetailsIdx, t29QsRowIdx });

  console.log('Test 30 (no shoe equip-chip renders for a run-type session anymore):',
    !/equip-chip/.test(t29HTML) ? 'PASS' : 'FAIL', { hasEquipChip: /equip-chip/.test(t29HTML) });

  // Test 31: a strength session's own equipment chips (Rings/Dumbbell/Bodyweight/etc) are unaffected --
  // only the run-type shoe chip was removed, not equipRowHTML's other equipment types.
  win.eval(`
    BLOCKS=[{id:'b31',name:'B31',startDate:'2027-06-01',endDate:'2027-07-01',sessions:[
      {id:'sStr1',wk:1,ty:'str',date:'2027-06-01',ph:'dur',ti:'Full Body Strength'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b31'; STATUS={}; NOTES={}; ACTIVITIES=[];
    openLog('sStr1');
  `);
  const t31HTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 31 (a strength sessions own equipment chips -- Rings/Dumbbell/Bodyweight -- still render normally):',
    (/equip-chip/.test(t31HTML) && /Rings/.test(t31HTML) && /Dumbbell/.test(t31HTML) && /Bodyweight/.test(t31HTML)) ? 'PASS' : 'FAIL');

  // Tests 32-34 (v0.32.10): Dylon -- "make the detail area of a run collapsable one activity is
  // completed or added." Details (target stats + step-by-step breakdown, under the "Details" header)
  // now collapses by default once a real Activity has been completed/added for the session, stays
  // expanded by default otherwise, and the header itself is tappable to override either way.

  // Test 32: an untouched session (no linked/attached Activity at all) shows Details expanded by
  // default -- nothing worth collapsing away from an athlete who hasn't done anything yet.
  win.eval(`
    BLOCKS=[{id:'b32',name:'B32',startDate:'2027-06-01',endDate:'2027-07-01',sessions:[
      {id:'sD32',wk:1,ty:'easy',date:'2027-06-01',ph:'dur',ti:'Easy Run',full:'Easy Run',dist:'5 km',shoe:'SL2'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b32'; STATUS={}; NOTES={}; ACTIVITIES=[];
    LOG_DETAILS_OPEN=null;
    openLog('sD32');
  `);
  const t32HTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 32 (Details is expanded by default for a session with no linked/attached activity):',
    (/qs-row/.test(t32HTML) && /rotate\(0deg\)/.test(t32HTML)) ? 'PASS' : 'FAIL');

  // Test 33: once a real Activity is added/completed for the session, Details collapses by default --
  // the quick stats and step-by-step breakdown drop out of the rendered body entirely, leaving just the
  // header and a rotated chevron.
  win.eval(`
    const t33Act=addActivity({type:'run',date:'2027-06-01',distanceKm:5,title:''});
    linkActivityToSession(t33Act.id,'sD32','fulfillment');
    LOG_DETAILS_OPEN=null;
    openLog('sD32');
  `);
  const t33HTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 33 (Details collapses by default once an activity has been completed/added for the session):',
    (!/qs-row/.test(t33HTML) && /rotate\(-90deg\)/.test(t33HTML) && /Details/.test(t33HTML)) ? 'PASS' : 'FAIL');

  // Test 34: tapping the Details header (toggleLogDetails) flips whatever the current state is, and
  // that explicit choice sticks rather than snapping back to the collapsed-by-default state.
  win.eval(`toggleLogDetails('sD32');`);
  const t34OpenHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  win.eval(`toggleLogDetails('sD32');`);
  const t34ClosedHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 34 (tapping the Details header toggles it open, then closed again, overriding the default):',
    (/qs-row/.test(t34OpenHTML) && !/qs-row/.test(t34ClosedHTML)) ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
