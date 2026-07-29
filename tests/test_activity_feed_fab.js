// Regression test for Task 48 -- Dylon's feedback after Phase 1a shipped: "i dont like how buried
// all the activities is behind history we need to build a dedicated activity feed" and "i think we
// should move all the manual activity add buttons behind a FAB on the today page and schedule page".
// Covers two independent pieces: (1) a dedicated Activity Feed overlay, reachable in one tap from
// the sidebar/Tools sheet rather than two taps deep inside Progress > History, built on the exact
// same historyItems()/matchesHistoryFilter()/logFeedItemHTML() query History already used; and
// (2) a shared Add-Activity FAB (Run/Walk/Weight/Strength/Import Activity) shown on Today and
// Schedule, replacing the inline "Add Activity" grid that used to live only on Today.
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

  // ==== Dedicated Activity Feed (48-i) ====

  // Test 1: the sidebar has its own Activity Feed button, and the mobile Tools sheet lists it too.
  const sidebarHTML = win.eval(`document.querySelector('nav.sidebar, #sidebar')?document.getElementById('sidebar').innerHTML:document.body.innerHTML`);
  const t1Sidebar = /openActivityFeed\(\)/.test(sidebarHTML) && /Activity Feed/.test(sidebarHTML);
  const toolsHTML = win.eval(`toolsBodyHTML()`);
  const t1Tools = /openActivityFeed\(\)/.test(toolsHTML) && /Activity Feed/.test(toolsHTML);
  console.log('Test 1 (Activity Feed has its own sidebar button and Tools sheet row):', (t1Sidebar && t1Tools) ? 'PASS' : 'FAIL');

  // Test 2: openActivityFeed() opens the dedicated overlay and renders the same kind of filterable
  // feed History already has -- not a blank screen.
  win.eval(`openActivityFeed();`);
  const feedOpen = win.eval(`document.getElementById('actfeed-overlay').classList.contains('open')`);
  const feedBodyEmpty = win.eval(`document.getElementById('actfeed-sh-body').innerHTML`);
  console.log('Test 2 (openActivityFeed opens the overlay and renders filter pills + empty-state copy):',
    (feedOpen && /trend-pill/.test(feedBodyEmpty) && /Nothing logged yet/.test(feedBodyEmpty)) ? 'PASS' : 'FAIL');

  // Test 3: importing straight from the Activity Feed's own Import Activity button (its own file
  // input id) works via the same importActivityText()/confirmActivityImport() pipeline, and the
  // feed refreshes immediately (refreshActivityFeedIfOpen) once it's actually saved, without
  // needing to close and reopen the overlay.
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
  const feedBodyAfter = win.eval(`document.getElementById('actfeed-sh-body').innerHTML`);
  console.log('Test 3 (feed refreshes immediately after an import completes, while still open):',
    /Feed Test Run/.test(feedBodyAfter) ? 'PASS' : 'FAIL');

  // Test 4: switching the feed's own filter pills actually filters -- selecting "Walk" hides the
  // just-imported run.
  win.eval(`selectActivityFeedFilter('walk');`);
  const walkFilteredHTML = win.eval(`document.getElementById('actfeed-sh-body').innerHTML`);
  console.log('Test 4 (Activity Feed filter pills actually filter the list):',
    !/Feed Test Run/.test(walkFilteredHTML) ? 'PASS' : 'FAIL');

  win.eval(`closeOverlay('actfeed-overlay');`);

  // ==== Add-Activity FAB (48-ii) ====

  // Test 5: the FAB is hidden on Progress/Recovery/Profile, and shown on Today and Schedule.
  win.eval(`switchView('progress');`);
  const hiddenOnProgress = win.eval(`document.getElementById('activity-fab-wrap').classList.contains('show')`);
  win.eval(`switchView('today');`);
  const shownOnToday = win.eval(`document.getElementById('activity-fab-wrap').classList.contains('show')`);
  win.eval(`switchView('week');`);
  const shownOnWeek = win.eval(`document.getElementById('activity-fab-wrap').classList.contains('show')`);
  console.log('Test 5 (FAB shown only on Today/Schedule, hidden on Progress):',
    (!hiddenOnProgress && shownOnToday && shownOnWeek) ? 'PASS' : 'FAIL');

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
