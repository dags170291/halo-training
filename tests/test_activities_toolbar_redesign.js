// Regression test for the Activities tab's toolbar redesign. Dylon, in one message: "remove the
// import activity botton on the activy feed and place the same fab we created on the screen. use the
// attached icon as the activity button. move today to the center tab as the hom screen. implement a
// search function on the activity screen and move the filters behind the search function. Also not
// ever activty is meant to be attached to a planned session so we need something to do with those
// activities that are in the needs review tab. also move needs review behind an icon which display a
// list of the activities that require review or needs the user attention." Five independent pieces:
// (1) the Activities tab's own inline "+ Import Activity" button/input is gone, replaced by the same
// shared Add-Activity FAB Today/Schedule already had (see test_activity_feed_fab.js for the
// visibility-toggle side of this); (2) the FAB's main icon is Dylon's own supplied glyph, not the old
// plus/cross; (3) Today moved from the leading tab to the center (3rd of 5) position in both the
// bottom nav and the sidebar, while staying the default landing view; (4) a real search box now
// filters the list by title, with the filter-pill row tucked behind a toggle icon instead of always
// showing; and (5) "Needs Review" is no longer a filter pill -- it's a flag icon with a count badge
// that opens a dedicated sheet, and activities that were never meant to link to a session can now be
// permanently dismissed from it (reviewDismissed) without touching their role/link at all.
//
// Follow-up fixes, same session: Dylon didn't like the center-tab nav move ("i dont like the today in
// center again move it back how it was") -- Today is back to leading both nav rows (Test 1 rewritten
// below).
//
// A second follow-up, after Dylon reported "the icons i asked to fix previously didnt quite get
// fixed" and supplied five renamed SVGs so their destinations were unambiguous: the FAB's main icon
// is now two real icons (a plus, an X) swapped by open state via CSS, rather than a single static
// glyph -- "icon FAB add.svg"/"icon Fab close.svg" (Test 2 rewritten, Test 2d new); the filter toggle
// button uses "Icon Filter List.svg" instead of the earlier hand-authored bars (Test 2b, new); the
// Needs Review button uses "icon-review.svg" instead of the bookmark swapped in just before (Test 2c,
// new); and the Activities tab's own nav icon (bottom nav + sidebar) uses "icon-activities.svg"
// instead of the glyph that had been borrowed from the FAB (Test 2e, new). The FAB icon's white color
// (fixed in the same earlier follow-up, for contrast against the accent-blue circle) still applies to
// both the add and close icons since they share the button's `color`.
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
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2027-06-01',endDate:'2027-08-01',sessions:[
      {id:'sEasy',wk:1,ty:'easy',date:'2027-06-10',ph:'dur',ti:'Recovery Run'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2027-06-01'; BLOCK_END='2027-08-01';
    STATUS={}; NOTES={}; RACES_LIST=[]; ACTIVITIES=[]; EXTRALOGS=[];
  `);

  // ==== Today leads the nav (reverted from the earlier center-tab move) ====

  // Test 1: Today sits at index 0 in both the bottom nav and the sidebar, and is still the
  // default/active view on load -- Dylon: "i dont like the today in center again move it back how it
  // was".
  const bottomNavBtns = JSON.parse(win.eval(`JSON.stringify(Array.from(document.querySelectorAll('.bottom-nav .nav-btn')).map(b=>b.dataset.view))`));
  const sidebarBtns = JSON.parse(win.eval(`JSON.stringify(Array.from(document.querySelectorAll('.sidebar-nav .sidebar-btn[data-view]')).map(b=>b.dataset.view))`));
  const t1BottomLeads = bottomNavBtns.length === 5 && bottomNavBtns[0] === 'today';
  const t1SidebarLeads = sidebarBtns.length >= 5 && sidebarBtns[0] === 'today';
  const t1DefaultView = win.eval(`CURR_VIEW`) === 'today';
  const t1TodayActive = win.eval(`document.querySelector('.bottom-nav .nav-btn[data-view="today"]').classList.contains('active')`);
  console.log('Test 1 (Today leads both nav rows again, and is still the default active view):',
    (t1BottomLeads && t1SidebarLeads && t1DefaultView && t1TodayActive) ? 'PASS' : 'FAIL', { bottomNavBtns, sidebarBtns });

  // ==== FAB: shown on Activities, real add/close icons, white for contrast ====

  // Test 2: the FAB's main button renders both a real plus (add) icon and a real X (close) icon --
  // Dylon's own supplied glyphs -- rather than one static icon or a rotated plus, and renders them in
  // white against the accent-colored circle (the original near-black color was low-contrast).
  const fabMainHTML = win.eval(`document.querySelector('.fab-main').innerHTML`);
  const t2HasAddIcon = /M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z/.test(fabMainHTML);
  const t2HasCloseIcon = /m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z/.test(fabMainHTML);
  const t2NoOldFirstPage = !/M240-240v-480h80v480h-80Zm440 0L440-480l240-240 56 56-184 184 184 184-56 56Z/.test(fabMainHTML);
  const t2WhiteIcon = win.eval(`getComputedStyle(document.querySelector('.fab-main')).color`) === 'rgb(255, 255, 255)';
  console.log('Test 2 (FAB main button renders real add + close icons, not the old single first_page glyph, in white):',
    (t2HasAddIcon && t2HasCloseIcon && t2NoOldFirstPage && t2WhiteIcon) ? 'PASS' : 'FAIL');

  // Test 2b: the filter toggle button uses the uploaded "Filter List" glyph, not the earlier
  // hand-authored bars icon.
  win.eval(`ACTIVITIES=[]; switchView('activities');`);
  const filterBtnHTML = win.eval(`document.querySelector('[aria-label="Filters"]').innerHTML`);
  const t2bFilterList = /M400-240v-80h160v80H400ZM240-440v-80h480v80H240ZM120-640v-80h720v80H120Z/.test(filterBtnHTML);
  const t2bNoOldBars = !/M200-700h560v60H200v-60ZM320-500h320v60H320v-60ZM420-300h120v60H420v-60Z/.test(filterBtnHTML);
  console.log('Test 2b (filter button uses the uploaded Filter List icon, not the old hand-authored bars):', (t2bFilterList && t2bNoOldBars) ? 'PASS' : 'FAIL');

  // Test 2c: the Needs Review button uses the uploaded review glyph, not the bookmark icon swapped in
  // just before this -- Dylon: "the icons i asked to fix previously didnt quite get fixed".
  const needsReviewBtnHTML = win.eval(`document.querySelector('[aria-label="Needs review"]').innerHTML`);
  const t2cReviewIcon = /M508\.5-291\.5Q520-303 520-320t-11\.5-28\.5Q497-360 480-360t-28\.5 11\.5Q440-337 440-320t11\.5 28\.5Q463-280 480-280t28\.5-11\.5ZM440-440h80v-240h-80v240ZM200-120q-33 0-56\.5-23\.5T120-200v-560q0-33 23\.5-56\.5T200-840h168q13-36 43\.5-58t68\.5-22q38 0 68\.5 22t43\.5 58h168q33 0 56\.5 23\.5T840-760v560q0 33-23\.5 56\.5T760-120H200Zm0-80h560v-560H200v560Zm301\.5-598\.5Q510-807 510-820t-8\.5-21\.5Q493-850 480-850t-21\.5 8\.5Q450-833 450-820t8\.5 21\.5Q467-790 480-790t21\.5-8\.5ZM200-200v-560 560Z/.test(needsReviewBtnHTML);
  const t2cNoOldBookmark = !/M200-120v-640q0-33 23\.5-56\.5T280-840h400q33 0 56\.5 23\.5T760-760v640L480-240 200-120Zm80-122 200-86 200 86v-518H280v518Zm0-518h400-400Z/.test(needsReviewBtnHTML);
  console.log('Test 2c (Needs Review button uses the uploaded review icon, not the earlier bookmark icon):', (t2cReviewIcon && t2cNoOldBookmark) ? 'PASS' : 'FAIL');

  // Test 2d: opening the FAB shows the close (X) icon and hides the add (plus) icon; closing it again
  // reverses that -- a real icon swap via CSS, not a single glyph rotated with a transform. Stays on
  // the Activities view (already active) rather than switching to Today -- this minimal test fixture's
  // BLOCKS session lacks fields renderToday() needs, so switching there crashes for reasons unrelated
  // to what this test is actually checking.
  win.eval(`closeActivityFab();`);
  const closedVis = JSON.parse(win.eval(`JSON.stringify({add:getComputedStyle(document.querySelector('.fab-icon-add')).display, close:getComputedStyle(document.querySelector('.fab-icon-close')).display})`));
  win.eval(`toggleActivityFab();`);
  const openVis = JSON.parse(win.eval(`JSON.stringify({add:getComputedStyle(document.querySelector('.fab-icon-add')).display, close:getComputedStyle(document.querySelector('.fab-icon-close')).display})`));
  win.eval(`toggleActivityFab();`);
  console.log('Test 2d (FAB shows the plus when closed and the X when open, swapping cleanly):',
    (closedVis.add!=='none' && closedVis.close==='none' && openVis.add==='none' && openVis.close!=='none') ? 'PASS' : 'FAIL', { closedVis, openVis });

  // Test 2e: the Activities tab's own nav icon (bottom nav + sidebar) uses the uploaded
  // "icon-activities" glyph, not the FAB glyph it had briefly borrowed -- Dylon: "use the othe scg as
  // the activities icon in the navbar" (this earlier fix reused the wrong one; the icon-activities.svg
  // upload settles it).
  win.eval(`switchView('activities');`);
  const bottomActivitiesIconHTML = win.eval(`document.querySelector('.bottom-nav .nav-btn[data-view="activities"]').innerHTML`);
  const sidebarActivitiesIconHTML = win.eval(`document.querySelector('.sidebar-nav .sidebar-btn[data-view="activities"]').innerHTML`);
  const t2eBottom = /M120-160v-80h720v80H120Zm0-560v-80h720v80H120Zm80 400q-33 0-56\.5-23\.5T120-400v-160q0-33 23\.5-56\.5T200-640h560q33 0 56\.5 23\.5T840-560v160q0 33-23\.5 56\.5T760-320H200Zm0-80h560v-160H200v160Zm0-160v160-160Z/.test(bottomActivitiesIconHTML);
  const t2eSidebar = /M120-160v-80h720v80H120Zm0-560v-80h720v80H120Zm80 400q-33 0-56\.5-23\.5T120-400v-160q0-33 23\.5-56\.5T200-640h560q33 0 56\.5 23\.5T840-560v160q0 33-23\.5 56\.5T760-320H200Zm0-80h560v-160H200v160Zm0-160v160-160Z/.test(sidebarActivitiesIconHTML);
  const t2eNoFabGlyph = !/M240-240v-480h80v480h-80Zm440 0L440-480l240-240 56 56-184 184 184 184-56 56Z/.test(bottomActivitiesIconHTML);
  console.log('Test 2e (Activities tab nav icon uses the uploaded icon-activities glyph in both nav rows, not the FAB glyph):',
    (t2eBottom && t2eSidebar && t2eNoFabGlyph) ? 'PASS' : 'FAIL');

  // ==== Search + filters behind an icon ====

  win.eval(`
    window.__runAct = addActivity({type:'run',date:'2027-06-15',title:'Wednesday Morning Run'});
    window.__walkAct = addActivity({type:'walk',date:'2027-06-16',title:'Evening Walk'});
    switchView('activities');
  `);

  // Test 3: the filter-pill row is NOT shown by default -- "move the filters behind the search
  // function" -- only the search box + toolbar icons render up front.
  const freshBody = win.eval(`document.getElementById('view-activities').innerHTML`);
  const t3NoPillsByDefault = !/class="trend-pills"/.test(freshBody);
  const t3HasSearch = /id="activities-search-input"/.test(freshBody);
  console.log('Test 3 (filter pills are hidden by default; the search box is there instead):', (t3NoPillsByDefault && t3HasSearch) ? 'PASS' : 'FAIL');

  // Test 4: toggling the filter icon reveals the pill row (All/Run/Walk/Weight/Strength/Mobility --
  // no "Needs Review" pill anymore), and toggling again hides it.
  win.eval(`toggleActivitiesFilters();`);
  const openBody = win.eval(`document.getElementById('view-activities').innerHTML`);
  const t4PillsShown = /class="trend-pills"/.test(openBody) && /Strength/.test(openBody);
  const t4NoNeedsReviewPill = !/>Needs Review/.test(openBody);
  win.eval(`toggleActivitiesFilters();`);
  const closedBody = win.eval(`document.getElementById('view-activities').innerHTML`);
  const t4PillsHiddenAgain = !/class="trend-pills"/.test(closedBody);
  console.log('Test 4 (filter icon toggles the pill row open/closed; Needs Review is not one of the pills anymore):',
    (t4PillsShown && t4NoNeedsReviewPill && t4PillsHiddenAgain) ? 'PASS' : 'FAIL');

  // Test 5: typing in the search box filters the visible list down to matching titles only, and
  // clearing it shows everything again.
  win.eval(`setActivitiesSearch('Wednesday');`);
  const searchedBody = win.eval(`document.getElementById('view-activities').innerHTML`);
  const t5Filtered = /Wednesday Morning Run/.test(searchedBody) && !/Evening Walk/.test(searchedBody);
  win.eval(`setActivitiesSearch('');`);
  const clearedBody = win.eval(`document.getElementById('view-activities').innerHTML`);
  const t5Cleared = /Wednesday Morning Run/.test(clearedBody) && /Evening Walk/.test(clearedBody);
  console.log('Test 5 (search filters the list by title; clearing it restores every entry):', (t5Filtered && t5Cleared) ? 'PASS' : 'FAIL');

  // Test 6: a search with no matches shows a distinct "no results" message, not the generic
  // "nothing logged" empty state.
  win.eval(`setActivitiesSearch('zzz-nothing-matches-zzz');`);
  const noMatchBody = win.eval(`document.getElementById('view-activities').innerHTML`);
  console.log('Test 6 (a search with no matches shows its own "no activities match" message):',
    /No activities match your search/.test(noMatchBody) ? 'PASS' : 'FAIL');
  win.eval(`setActivitiesSearch('');`);

  // ==== Needs Review: icon + sheet + dismiss ====

  // Test 7: an unplanned activity with a nearby candidate session shows up behind the flag icon's
  // count badge, and opening the sheet lists it with Fulfills/Attach-as-extra actions plus a new
  // "Not related to a session" dismiss action.
  win.eval(`
    ACTIVITIES=[];
    window.__needsRevAct = addActivity({type:'run',date:'2027-06-11',title:'Unplanned Shakeout'});
    switchView('activities');
  `);
  const badgeBody = win.eval(`document.getElementById('view-activities').innerHTML`);
  const t7BadgeShows1 = /id="activities-needsreview-badge"[^>]*>1</.test(badgeBody);
  win.eval(`openNeedsReviewSheet();`);
  const sheetHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  const t7SheetListsIt = /Unplanned Shakeout/.test(sheetHTML) && /Fulfills this/.test(sheetHTML) && /Attach as extra/.test(sheetHTML) && /Not related to a session/.test(sheetHTML);
  console.log('Test 7 (Needs Review badge shows the right count; its sheet lists the activity with link + dismiss actions):',
    (t7BadgeShows1 && t7SheetListsIt) ? 'PASS' : 'FAIL');

  // Test 8: dismissing it removes it from needsReviewActivities() immediately, the open sheet
  // reflects that without needing to be closed and reopened, and its role/link are untouched -- it's
  // still exactly as unplanned as before, just no longer flagged for review.
  win.eval(`dismissActivityReview(window.__needsRevAct.id);`);
  const t8StillUnplanned = win.eval(`ACTIVITIES.find(a=>a.id===window.__needsRevAct.id).role`) === 'unplanned';
  const t8Dismissed = win.eval(`ACTIVITIES.find(a=>a.id===window.__needsRevAct.id).reviewDismissed`) === true;
  const t8CountNow = win.eval(`needsReviewActivities().length`);
  const sheetAfterDismiss = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  const t8SheetUpdated = /Nothing needs review right now/.test(sheetAfterDismiss) && !/Unplanned Shakeout/.test(sheetAfterDismiss);
  console.log('Test 8 (dismissing clears it from Needs Review immediately and in-place, without changing its role/link):',
    (t8StillUnplanned && t8Dismissed && t8CountNow === 0 && t8SheetUpdated) ? 'PASS' : 'FAIL');

  // Test 9: a dismissed activity's own detail popup still offers "Link to a planned session" like
  // any other unplanned activity -- dismissing only removes it from the review inbox, it never
  // forbids linking later if that turns out to be wrong.
  win.eval(`closeOverlay('confirm-overlay'); openActivityDetail(window.__needsRevAct.id);`);
  const detailHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  console.log('Test 9 (a dismissed activity can still be linked to a session from its own detail popup):',
    /Link to a planned session/.test(detailHTML) ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
