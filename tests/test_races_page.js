// Regression test for turning Races from a "Race Calendar" tab inside the Plans popup sheet into its
// own real page. Dylon: "Turn races into an actual page instead of just a pop up. give it a search
// field and filter similar to activities as well." Same architecture Profile already used (a real
// .view switched via switchView()/CURR_VIEW, not a #plans-overlay tab) rather than a new bottom-nav
// tab -- Dylon picked "same entry points, full page" when asked, so the desktop sidebar's own "Races"
// button and a new mobile Tools-sheet row are still how you get there, they just land on a real page
// now instead of opening a modal. The Plans sheet itself is untouched apart from losing its internal
// "Race Calendar" tab -- Season Blocks is now the only thing it shows.
//
// New pieces covered here: the #view-races page itself and its two entry helpers (openRaces(filterVal)
// for a fresh/filtered open, openRaceDetail(key) for jumping straight into one race's edit form); a
// search box (RACES_SEARCH, matched against name + location) and a filter-toggle icon that hides the
// existing block/distance filter chip rows by default, same pattern the Activities tab already
// established (ACTIVITIES_SEARCH/ACTIVITIES_FILTERS_OPEN); and confirmation that the Plans sheet no
// longer has any races-tab remnant (switchPlansTab is gone, PLANS_TAB is gone, no "Race Calendar" tab
// button). test_races_jank.js and test_next_race_border.js (both already existing, updated in place
// for the openPlans('races',...) -> openRaces(...) rename) continue to cover the desktop
// list+detail split, the selected-card ring, and the scroll-preserve behavior in detail -- not
// re-tested here to avoid duplicating those.
//
// v0.33.1 additions (Dylon: "add the ability to add races from the FAB as well, manage races from the
// block detail screen dont work, make the add race form a pop up"): Tests 7/8 rewritten since the
// add/edit form is a real popup (#race-form-overlay) now, not something that renders inline on this
// page; Test 7b covers Cancel closing it; Tests 12/13 cover the actual reported bug -- openRaces()/
// openRaceDetail() now close #plans-overlay first, since switchView() alone never did and the Plans
// sheet was silently staying open on top of the Races page; Test 14 covers the FAB's new Add Race item.
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
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-06-01',endDate:'2026-08-01',sessions:[
      {id:'s1',wk:1,ty:'easy',date:'2026-06-10',ph:'dur',ti:'Recovery Run'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-06-01'; BLOCK_END='2026-08-01';
    STATUS={}; NOTES={}; RACES_LIST=[]; ACTIVITIES=[]; EXTRALOGS=[];
    RACES_LIST=[
      normalizeRaceRecord({name:'Port of Spain 5K',date:'2026-08-15',distance:'5K',status:'registered',location:'Queens Park Savannah',blockId:null}),
      normalizeRaceRecord({name:'Chaguanas 10K',date:'2026-09-20',distance:'10K',status:'registered',location:'Chaguanas',blockId:'b1'})
    ];
  `);

  // Test 1: the desktop sidebar's Races button is a real data-view button calling openRaces() now,
  // not openPlans('races') -- and #view-races exists as a real .view alongside Today/Activities/etc.
  const sidebarHTML = win.eval(`document.getElementById('sidebar').innerHTML`);
  const t1SidebarBtn = /data-view="races"/.test(sidebarHTML) && /onclick="openRaces\(\)"/.test(sidebarHTML);
  const t1ViewExists = win.eval(`!!document.getElementById('view-races')`);
  const t1ViewIsRealView = win.eval(`document.getElementById('view-races').classList.contains('view')`);
  console.log('Test 1 (sidebar Races button calls openRaces(), and #view-races is a real .view):',
    (t1SidebarBtn && t1ViewExists && t1ViewIsRealView) ? 'PASS' : 'FAIL');

  // Test 2: openRaces() activates the page (CURR_VIEW/active class), renders the search box + both
  // races, and is NOT the old modal overlay -- #plans-overlay should stay closed.
  win.eval(`openRaces();`);
  const t2CurrView = win.eval(`CURR_VIEW`) === 'races';
  const t2ViewActive = win.eval(`document.getElementById('view-races').classList.contains('active')`);
  const t2PlansOverlayClosed = win.eval(`!document.getElementById('plans-overlay').classList.contains('open')`);
  const racesBody = win.eval(`document.getElementById('view-races').innerHTML`);
  const t2HasSearch = /id="races-search-input"/.test(racesBody);
  const t2HasBothRaces = /Port of Spain 5K/.test(racesBody) && /Chaguanas 10K/.test(racesBody);
  console.log('Test 2 (openRaces() lands on a real active page, not the Plans popup, with search + both races showing):',
    (t2CurrView && t2ViewActive && t2PlansOverlayClosed && t2HasSearch && t2HasBothRaces) ? 'PASS' : 'FAIL');

  // Test 3: filter chips (block + distance) are hidden by default -- "filter similar to activities" --
  // and the filter-toggle button reveals/hides them, same as Activities' own toggle.
  const t3NoChipsByDefault = !/chip-scroll/.test(racesBody);
  win.eval(`toggleRacesFilters();`);
  const openBody = win.eval(`document.getElementById('view-races').innerHTML`);
  const t3ChipsShown = /chip-scroll/.test(openBody) && /Unscheduled/.test(openBody) && /All Distances/.test(openBody);
  win.eval(`toggleRacesFilters();`);
  const closedBody = win.eval(`document.getElementById('view-races').innerHTML`);
  const t3ChipsHiddenAgain = !/chip-scroll/.test(closedBody);
  console.log('Test 3 (block/distance filter chips are hidden by default; the filter icon toggles them open/closed):',
    (t3NoChipsByDefault && t3ChipsShown && t3ChipsHiddenAgain) ? 'PASS' : 'FAIL');

  // Test 4: typing in the search box filters the list to matching name/location only; clearing it
  // restores everything.
  win.eval(`setRacesSearch('Chaguanas');`);
  const searchedBody = win.eval(`document.getElementById('view-races').innerHTML`);
  const t4Filtered = /Chaguanas 10K/.test(searchedBody) && !/Port of Spain 5K/.test(searchedBody);
  win.eval(`setRacesSearch('');`);
  const clearedBody = win.eval(`document.getElementById('view-races').innerHTML`);
  const t4Cleared = /Chaguanas 10K/.test(clearedBody) && /Port of Spain 5K/.test(clearedBody);
  console.log('Test 4 (search filters the list by name/location; clearing it restores every race):', (t4Filtered && t4Cleared) ? 'PASS' : 'FAIL');

  // Test 5: search also matches on location, not just name -- typing the venue for Port of Spain 5K
  // (which doesn't appear in its own name) still finds it.
  win.eval(`setRacesSearch('Savannah');`);
  const locationSearchBody = win.eval(`document.getElementById('view-races').innerHTML`);
  console.log("Test 5 (search also matches a race's location, not just its name):",
    (/Port of Spain 5K/.test(locationSearchBody) && !/Chaguanas 10K/.test(locationSearchBody)) ? 'PASS' : 'FAIL');
  win.eval(`setRacesSearch('');`);

  // Test 6: a search with no matches shows its own message, not the generic "no races yet" empty state.
  win.eval(`setRacesSearch('zzz-nothing-matches-zzz');`);
  const noMatchBody = win.eval(`document.getElementById('view-races').innerHTML`);
  console.log('Test 6 (a search with no matches shows its own "no races match" message):',
    /No races match your search/.test(noMatchBody) ? 'PASS' : 'FAIL');
  win.eval(`setRacesSearch('');`);

  // Test 7: "+ Add Race" opens the add form as a real popup (#race-form-overlay) as of v0.33.1 --
  // Dylon: "make the add race form a pop up" -- not inline on the page anymore. The page underneath
  // stays untouched (no form markup leaks into #view-races), and the popup has its own Save/Cancel
  // footer via raceFormFooterHTML.
  win.eval(`startAddRace();`);
  const addFormOpen = win.eval(`document.getElementById('race-form-overlay').classList.contains('open')`);
  const addFormBody = win.eval(`document.getElementById('race-form-sh-body').innerHTML`);
  const addFormTitle = win.eval(`document.getElementById('race-form-sh-title').textContent`);
  const pageBodyDuringAdd = win.eval(`document.getElementById('view-races').innerHTML`);
  console.log('Test 7 (+ Add Race opens the form as a popup, not inline on the page, with Save/Cancel present):',
    (addFormOpen && /id="race-name"/.test(addFormBody) && />Add race</.test(addFormBody)
      && addFormTitle === 'Add a Race' && !/id="race-name"/.test(pageBodyDuringAdd)) ? 'PASS' : 'FAIL');
  win.eval(`cancelRaceEdit();`);
  const addFormClosedAfterCancel = win.eval(`!document.getElementById('race-form-overlay').classList.contains('open')`);
  console.log('Test 7b (Cancel closes the Add Race popup):', addFormClosedAfterCancel ? 'PASS' : 'FAIL');

  // Test 8: openRaceDetail(key) jumps to the Races page AND opens that race's edit form in the same
  // popup, prefilled -- reachable from anywhere (e.g. a race-day session's "Edit Race Details" button),
  // not just from a card tap on the page itself.
  const chagKey = win.eval(`RACES_LIST.find(r=>r.name==='Chaguanas 10K').key`);
  win.eval(`openRaceDetail('${chagKey}');`);
  const t8PopupOpen = win.eval(`document.getElementById('race-form-overlay').classList.contains('open')`);
  const detailBody = win.eval(`document.getElementById('race-form-sh-body').innerHTML`);
  const t8EditMode = win.eval(`RACE_EDIT_KEY`) === chagKey;
  const t8Prefilled = /value="Chaguanas 10K"/.test(detailBody);
  const t8StillOnPage = win.eval(`CURR_VIEW`) === 'races';
  const t8Title = win.eval(`document.getElementById('race-form-sh-title').textContent`) === 'Edit Race';
  console.log("Test 8 (openRaceDetail lands on the Races page and opens that race's prefilled edit popup):",
    (t8PopupOpen && t8EditMode && t8Prefilled && t8StillOnPage && t8Title) ? 'PASS' : 'FAIL');
  win.eval(`cancelRaceEdit();`);

  // Test 9: openRaces(filterVal) both filters the list AND forces the filter chip row visible (a
  // non-default filter should never be silently hidden) -- same "active filter stays visible" rule
  // Activities uses. Filtering to b1 should hide the unscheduled 5K and keep the 10K.
  win.eval(`openRaces('b1');`);
  const filteredOpenBody = win.eval(`document.getElementById('view-races').innerHTML`);
  const t9Filtered = /Chaguanas 10K/.test(filteredOpenBody) && !/Port of Spain 5K/.test(filteredOpenBody);
  const t9ChipsVisible = /chip-scroll/.test(filteredOpenBody);
  console.log("Test 9 (openRaces(blockId) filters to that block's races and keeps the filter chips visible):",
    (t9Filtered && t9ChipsVisible) ? 'PASS' : 'FAIL');
  win.eval(`openRaces();`);

  // Test 10: the mobile Tools sheet has its own "Races" row calling openRaces() -- the entry point
  // for phones, which don't have the desktop sidebar.
  win.eval(`openTools();`);
  const toolsBody = win.eval(`document.getElementById('tools-sh-body').innerHTML`);
  console.log('Test 10 (mobile Tools sheet has a Races row that opens the new page):',
    (/>Races</.test(toolsBody) && /openRaces\(\)/.test(toolsBody)) ? 'PASS' : 'FAIL');
  win.eval(`closeOverlay('tools-overlay');`);

  // Test 11: the Plans sheet (Season Blocks) has no leftover "Race Calendar" tab or PLANS_TAB/
  // switchPlansTab machinery -- Races moved out entirely, Plans is Season-Blocks-only now.
  win.eval(`openPlans();`);
  const plansBody = win.eval(`document.getElementById('plans-sh-body').innerHTML`);
  const t11NoRaceTab = !/Race Calendar/.test(plansBody);
  const t11NoSwitchFn = win.eval(`typeof switchPlansTab`) === 'undefined';
  const t11NoPlansTabVar = win.eval(`typeof PLANS_TAB`) === 'undefined';
  console.log('Test 11 (Plans sheet has no Race Calendar tab left, and PLANS_TAB/switchPlansTab are gone):',
    (t11NoRaceTab && t11NoSwitchFn && t11NoPlansTabVar) ? 'PASS' : 'FAIL');

  // Test 12: regression for a real reported bug -- "manage races from the block detail screen dont
  // work." Clicking "Manage Races" on a block card (planBlockCardHTML, mobile) or the block detail
  // pane (blockDetailHTML, desktop split) calls openRaces(b.id) from *inside* #plans-overlay.
  // switchView() never closes an open .overlay on its own, so without closeOverlay('plans-overlay')
  // inside openRaces()/openRaceDetail(), the Plans sheet stayed visibly open on top of the Races page,
  // making the button look broken. Plans sheet is still open from Test 11 above -- don't reopen it.
  const t12PlansOpenBefore = win.eval(`document.getElementById('plans-overlay').classList.contains('open')`);
  win.eval(`openRaces('b1');`);
  const t12PlansClosedAfter = win.eval(`!document.getElementById('plans-overlay').classList.contains('open')`);
  const t12OnRacesPage = win.eval(`CURR_VIEW`) === 'races' && win.eval(`document.getElementById('view-races').classList.contains('active')`);
  console.log('Test 12 (openRaces() called from inside the open Plans sheet actually closes it, revealing the Races page):',
    (t12PlansOpenBefore && t12PlansClosedAfter && t12OnRacesPage) ? 'PASS' : 'FAIL');

  // Test 13: same bug, same fix, via openRaceDetail() -- reached from a race-day session's "Edit Race
  // Details" button, which could in principle be clicked while some other overlay is open.
  win.eval(`document.getElementById('plans-overlay').classList.add('open');`);
  win.eval(`openRaceDetail('${chagKey}');`);
  const t13PlansClosedAfter = win.eval(`!document.getElementById('plans-overlay').classList.contains('open')`);
  console.log('Test 13 (openRaceDetail() also closes the Plans sheet if it happened to be open):',
    t13PlansClosedAfter ? 'PASS' : 'FAIL');
  win.eval(`cancelRaceEdit();`);

  // Test 14: the Add-Activity FAB has its own "Add Race" item (Dylon: "add the ability to add races
  // from the FAB as well") that opens the same popup startAddRace() drives everywhere else, and it
  // works from a page that isn't the Races page at all -- the whole point of it being a popup now.
  win.eval(`switchView('today');`);
  const fabMenuHTML = win.eval(`document.getElementById('activity-fab-menu').innerHTML`);
  const t14HasFabItem = />Add Race</.test(fabMenuHTML) && /fabAddRace\(\)/.test(fabMenuHTML);
  win.eval(`fabAddRace();`);
  const t14PopupOpenFromToday = win.eval(`document.getElementById('race-form-overlay').classList.contains('open')`);
  const t14StillOnToday = win.eval(`CURR_VIEW`) === 'today';
  const t14FabClosed = win.eval(`!document.getElementById('activity-fab-wrap').classList.contains('open')`);
  console.log('Test 14 (FAB has an Add Race item that opens the popup without leaving the current page):',
    (t14HasFabItem && t14PopupOpenFromToday && t14StillOnToday && t14FabClosed) ? 'PASS' : 'FAIL');
  win.eval(`cancelRaceEdit();`);

  win.eval(`closeOverlay('plans-overlay');`);

  await wait(200);
  win.close();
})();
