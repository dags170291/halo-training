// Regression test for Task 48 -- Dylon's feedback after Phase 1a shipped: "i dont like how buried
// all the activities is behind history we need to build a dedicated activity feed" and "i think we
// should move all the manual activity add buttons behind a FAB on the today page and schedule page".
// Covers two independent pieces: (1) what started as a dedicated Activity Feed overlay (reachable in
// one tap from the sidebar/Tools sheet) and later became a full primary tab -- Dylon: "I want to
// move activities out of Progress -- give them their own main tab" -- so Tests 1-4 now exercise
// switchView('activities')/renderActivities()/#view-activities instead of the old
// openActivityFeed()/#actfeed-overlay sheet, same underlying historyItems()/matchesHistoryFilter()/
// logFeedItemHTML() query throughout; and (2) a shared Add-Activity FAB (Run/Walk/Weight/Strength/
// Import Activity) shown on Today and Schedule, replacing the inline "Add Activity" grid that used
// to live only on Today -- Tests 5-9, unaffected by the Activities-tab move.
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
  // A real (if minimal) active block -- switchView('today')/('week')/('progress') all assume one
  // exists, same as every other test that actually drives view transitions rather than calling a
  // single render*() function in isolation.
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-09-01',sessions:[
      {id:'s1',wk:1,ty:'easy',date:'2026-07-01',ph:'dur',ti:'Easy Run'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-01'; BLOCK_END='2026-09-01';
    STATUS={}; NOTES={}; RACES_LIST=[]; ACTIVITIES=[]; EXTRALOGS=[];
  `);

  // ==== Activities tab (48-i, later promoted from a sheet to its own primary tab) ====

  // Test 1: the sidebar and the mobile bottom nav both have a real "Activities" tab (data-view
  // driven, same as Today/Schedule/Progress/Recovery), not a one-off sheet-opening button anymore.
  const sidebarHTML = win.eval(`document.getElementById('sidebar').innerHTML`);
  const t1Sidebar = /data-view="activities"/.test(sidebarHTML) && /Activities/.test(sidebarHTML);
  const bottomNavHTML = win.eval(`document.querySelector('.bottom-nav').innerHTML`);
  const t1BottomNav = /data-view="activities"/.test(bottomNavHTML) && /Activities/.test(bottomNavHTML);
  console.log('Test 1 (Activities has a real data-view tab in both the sidebar and the bottom nav):', (t1Sidebar && t1BottomNav) ? 'PASS' : 'FAIL');

  // Test 2: switchView('activities') renders the tab (search box + empty-state copy) into
  // #view-activities -- not a blank screen, and not a sheet overlay. Filter pills are no longer
  // shown by default -- Dylon: "move the filters behind the search function" -- so this checks for
  // the search input instead; test_activities_toolbar_redesign.js covers the toggle itself.
  win.eval(`switchView('activities');`);
  const activitiesViewActive = win.eval(`document.getElementById('view-activities').classList.contains('active')`);
  const activitiesBodyEmpty = win.eval(`document.getElementById('view-activities').innerHTML`);
  console.log('Test 2 (switchView(activities) activates the tab and renders the search box + empty-state copy):',
    (activitiesViewActive && /id="activities-search-input"/.test(activitiesBodyEmpty) && /Nothing logged yet/.test(activitiesBodyEmpty)) ? 'PASS' : 'FAIL');

  // Test 3: importing an activity (now via the shared FAB rather than the Activities tab's own
  // removed inline button -- see Test 5b below) still works via the same importActivityText()/
  // confirmActivityImport() pipeline, and the tab refreshes immediately (refreshActivitiesIfOpen)
  // once it's actually saved, without needing to leave and come back to the tab.
  const SAMPLE_TCX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Running"><Id>2027-05-01T06:00:00.000-04:00</Id>
    <Lap StartTime="2027-05-01T06:00:00.000-04:00"><TotalTimeSeconds>600.0</TotalTimeSeconds>
      <DistanceMeters>2000.0</DistanceMeters><Calories>150</Calories>
      <Track>
        <Trackpoint><Time>2027-05-01T06:00:00.000-04:00</Time><DistanceMeters>0.0</DistanceMeters><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>
        <Trackpoint><Time>2027-05-01T06:10:00.000-04:00</Time><DistanceMeters>2000.0</DistanceMeters><HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint>
      </Track>
    </Lap></Activity></Activities>
</TrainingCenterDatabase>`;
  win.eval(`
    const r = importActivityText(${JSON.stringify(SAMPLE_TCX)},'feed-test.tcx');
    confirmActivityImport(r.activity);
    document.getElementById('import-name-input').value='Feed Test Run';
    finalizeActivityImport();
  `);
  const activitiesBodyAfter = win.eval(`document.getElementById('view-activities').innerHTML`);
  console.log('Test 3 (tab refreshes immediately after an import completes, while still open):',
    /Feed Test Run/.test(activitiesBodyAfter) ? 'PASS' : 'FAIL');

  // Test 4: switching the tab's own filter pills actually filters -- selecting "Walk" hides the
  // just-imported run.
  win.eval(`selectActivitiesFilter('walk');`);
  const walkFilteredHTML = win.eval(`document.getElementById('view-activities').innerHTML`);
  console.log('Test 4 (Activities tab filter pills actually filter the list):',
    !/Feed Test Run/.test(walkFilteredHTML) ? 'PASS' : 'FAIL');

  // ==== Add-Activity FAB (48-ii) ====

  // Test 5: the FAB is hidden on Progress/Recovery/Profile, and shown on Today, Schedule, AND now
  // Activities too -- Dylon: "remove the import activity botton on the activy feed and place the
  // same fab we created on the screen."
  win.eval(`switchView('progress');`);
  const hiddenOnProgress = win.eval(`document.getElementById('activity-fab-wrap').classList.contains('show')`);
  win.eval(`switchView('today');`);
  const shownOnToday = win.eval(`document.getElementById('activity-fab-wrap').classList.contains('show')`);
  win.eval(`switchView('week');`);
  const shownOnWeek = win.eval(`document.getElementById('activity-fab-wrap').classList.contains('show')`);
  win.eval(`switchView('activities');`);
  const shownOnActivities = win.eval(`document.getElementById('activity-fab-wrap').classList.contains('show')`);
  console.log('Test 5 (FAB shown on Today/Schedule/Activities, hidden on Progress):',
    (!hiddenOnProgress && shownOnToday && shownOnWeek && shownOnActivities) ? 'PASS' : 'FAIL');

  // Test 5b: the Activities tab's own old inline "+ Import Activity" button/input is really gone --
  // the FAB (just confirmed shown above) is the only way to import from this tab now.
  const activitiesHTMLNow = win.eval(`document.getElementById('view-activities').innerHTML`);
  console.log('Test 5b (Activities tab has no leftover inline Import Activity button/input):',
    (!/activities-activity-import-input/.test(activitiesHTMLNow) && !/\+ Import Activity/.test(activitiesHTMLNow)) ? 'PASS' : 'FAIL');

  // Test 6: toggleActivityFab() opens and closes the expandable menu.
  win.eval(`switchView('today');`);
  win.eval(`toggleActivityFab();`);
  const menuOpen = win.eval(`document.getElementById('activity-fab-menu').classList.contains('open')`);
  win.eval(`toggleActivityFab();`);
  const menuClosed = win.eval(`document.getElementById('activity-fab-menu').classList.contains('open')`);
  console.log('Test 6 (toggleActivityFab opens then closes the menu):', (menuOpen && !menuClosed) ? 'PASS' : 'FAIL');

  // Test 7: fabQuickAdd routes through the exact same openQuickAdd() every other quick-add entry
  // point uses -- not a second, parallel implementation -- and closes the FAB menu on the way.
  win.eval(`toggleActivityFab(); fabQuickAdd('run','long');`);
  const qaOpen = win.eval(`document.getElementById('qa-overlay').classList.contains('open')`);
  const qaKind = win.eval(`QA_KIND`);
  const fabClosedAfter = win.eval(`document.getElementById('activity-fab-menu').classList.contains('open')`);
  console.log('Test 7 (fabQuickAdd opens the real Quick Add sheet for the right kind, and closes the FAB):',
    (qaOpen && qaKind === 'run' && !fabClosedAfter) ? 'PASS' : 'FAIL');
  win.eval(`closeOverlay('qa-overlay');`);

  // Test 8: fabImportActivity() triggers the FAB's own file input (not History's or the Feed's).
  win.eval(`
    window.__fabInputClicked = false;
    document.getElementById('fab-activity-import-input').addEventListener('click', ()=>{ window.__fabInputClicked = true; });
    fabImportActivity();
  `);
  console.log('Test 8 (fabImportActivity triggers the FAB own file input):', win.eval(`window.__fabInputClicked`) === true ? 'PASS' : 'FAIL');

  // Test 9: the inline Today "Add Activity" grid is really gone -- Run/Walk/Weight/Strength quick
  // add still work (via the FAB), just not as a grid rendered inline on the page.
  win.eval(`switchView('today');`);
  const todayHTML = win.eval(`document.getElementById('view-today').innerHTML`);
  console.log('Test 9 (Today rendered HTML has no leftover qa-grid markup):', !/class="qa-grid"/.test(todayHTML) ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
