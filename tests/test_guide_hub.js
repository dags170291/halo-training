// Regression test for the Guide Hub (Dylon: another feature request, referencing
// yearroundrunning's Guide Hub). A standalone library of 8 short, ORIGINAL explainers (Recovery/
// Easy/Long/Tempo run, Interval Training, Cross Training, Strength Training, Stretching &
// Mobility) -- separate from "How Your Plan Is Built" (the existing Plan Guide content, which is
// specifically about how HALO's own plan generator works). As of v0.15.0, Guide Hub's landing screen
// is a selectable list (GUIDEHUB_MENU, same card-row pattern as the Tools sheet's TOOLS_LIST -- NOT
// a tab switcher) offering two destinations: "Training Guides" (the 8 articles) and "How Your Plan
// Is Built" (the real Plan Guide content, reused verbatim via renderPlanGuideHTML() -- not
// duplicated). Picking a row navigates into that content; a back-arrow button in the sheet header
// (#guidehub-back-btn, display:none while the list itself is showing -- NOT visibility:hidden, which
// was a real bug: visibility:hidden still reserves the button's layout space, pushing the header's
// sh-ico icon right and leaving a visible blank gap in front of it) returns to the list on click.
// Reachable from the desktop sidebar (its own "Guide Hub" button, grouped with Pace Calculator/Heart
// Rate Zones in their own separated sidebar section) and from the mobile Tools sheet (alongside Pace
// Calculator, Heart Rate Zones, Plan Generator, and Shoes -- 5 entries as of v0.15.0). Plan Guide's
// OTHER existing entry points (sidebar Help button, Settings > About "How your plan is built", wizard
// briefing card) are untouched and still open #planguide-overlay directly -- the Guide Hub list row
// is an additional way in, not a replacement. "Cross Training" (renamed from "Other Forms of Cardio")
// uses a dedicated pool icon; Strength Training uses a dedicated exercise icon -- both added to the
// shared ICONS dictionary specifically for this feature, not reused session-logging glyphs.
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

  // ---- Test 1: exactly 8 articles, matching the reference site's topic list, each with real
  // non-empty content (not a placeholder) ----
  const articles = JSON.parse(win.eval(`JSON.stringify(GUIDE_HUB_ARTICLES)`));
  const expectedTitles = ['Recovery Run','Easy Run','Long Run','Tempo Run','Interval Training','Cross Training','Strength Training','Stretching & Mobility'];
  const titlesMatch = JSON.stringify(articles.map(a=>a.title)) === JSON.stringify(expectedTitles);
  const allHaveContent = articles.every(a => a.icon && a.title && a.tagline && a.body && a.body.length > 40);
  console.log('Test 1 (8 articles, matching topic list, each with real content):', {
    titles: articles.map(a=>a.title),
    result: (articles.length === 8 && titlesMatch && allHaveContent) ? 'PASS' : 'FAIL'
  });

  // ---- Test 2: every article's icon key resolves to a real entry in the app's existing ICONS
  // dictionary -- these are reused, already-verified glyphs, not new hand-authored SVG paths, so
  // there's zero risk of a malformed/blank icon ----
  const iconsValid = win.eval(`GUIDE_HUB_ARTICLES.every(a => typeof ICONS[a.icon] === 'string' && ICONS[a.icon].length > 0)`);
  console.log('Test 2 (every article icon resolves to a real, existing ICONS entry):', iconsValid ? 'PASS' : 'FAIL');

  // ---- Test 3: openGuideHub() defaults to the landing LIST -- exactly 2 selectable rows
  // ("Training Guides" / "How Your Plan Is Built"), not the 8 article cards, and the back button is
  // display:none (not just visually hidden -- it must be removed from layout flow so the sh-ico icon
  // sits flush left with no reserved blank space in front of it) ----
  win.eval(`openGuideHub();`);
  const listRowCount = win.eval(`document.querySelectorAll('#guidehub-sh-body .card').length`);
  const listText = win.eval(`document.getElementById('guidehub-sh-body').textContent`);
  const listHasBothRows = listText.includes('Training Guides') && listText.includes('How Your Plan Is Built');
  const backHiddenOnList = win.eval(`document.getElementById('guidehub-back-btn').style.display`) === 'none';
  console.log('Test 3 (landing screen is a 2-row selectable list, not tabs; back button display:none):', {
    listRowCount, result: (listRowCount === 2 && listHasBothRows && backHiddenOnList) ? 'PASS' : 'FAIL'
  });

  // ---- Test 4: selecting "Training Guides" (view 'training') navigates into exactly 8 article
  // cards, each showing its title and body text, and reveals the back button ----
  win.eval(`selectGuideHubView('training')`);
  const cardCount = win.eval(`document.querySelectorAll('#guidehub-sh-body .card').length`);
  // Use textContent (real rendered text), not the raw innerHTML string -- re-serializing innerHTML
  // escapes "&" back to "&amp;", which would make a literal-"&" title like "Stretching & Mobility"
  // look "missing" even though the DOM renders it correctly.
  const bodyText = win.eval(`document.getElementById('guidehub-sh-body').textContent`);
  const allTitlesPresent = expectedTitles.every(t => bodyText.includes(t));
  const backVisibleOnTraining = win.eval(`document.getElementById('guidehub-back-btn').style.display`) === 'flex';
  console.log('Test 4 (selecting Training Guides shows exactly 8 cards, all 8 titles present, back button visible):', {
    cardCount, result: (cardCount === 8 && allTitlesPresent && backVisibleOnTraining) ? 'PASS' : 'FAIL'
  });

  // ---- Test 5: selecting "How Your Plan Is Built" (view 'planbuilt') shows the real Plan Guide
  // content (reused verbatim via renderPlanGuideHTML(), not duplicated). Note: article TITLES aren't
  // a safe "gone" signal here -- Plan Guide's own prose legitimately has a "Long Runs & Speed Days"
  // section, which contains the substring "Long Run". Use a Guide-Hub-only tagline instead, which has
  // no reason to appear in Plan Guide's own unrelated copy. ----
  win.eval(`selectGuideHubView('planbuilt')`);
  const planBuiltText = win.eval(`document.getElementById('guidehub-sh-body').textContent`);
  const showsRealPlanGuideContent = planBuiltText.includes('Periodization');
  const noLongerShowsArticles = !planBuiltText.includes('The foundation of your training');
  const backVisibleOnPlanBuilt = win.eval(`document.getElementById('guidehub-back-btn').style.display`) === 'flex';
  console.log('Test 5 (selecting How Your Plan Is Built shows real Plan Guide content, back button visible):', {
    showsRealPlanGuideContent,
    result: (showsRealPlanGuideContent && noLongerShowsArticles && backVisibleOnPlanBuilt) ? 'PASS' : 'FAIL'
  });

  // ---- Test 5b: tapping the back button (guideHubBackToList()) returns to the 2-row list and hides
  // the back button again -- navigation is a real back-and-forth, not a one-way drill-down ----
  win.eval(`guideHubBackToList()`);
  const backToListRowCount = win.eval(`document.querySelectorAll('#guidehub-sh-body .card').length`);
  const backHiddenAfterBack = win.eval(`document.getElementById('guidehub-back-btn').style.display`) === 'none';
  console.log('Test 5b (back button returns to the 2-row list and hides itself again):', {
    result: (backToListRowCount === 2 && backHiddenAfterBack) ? 'PASS' : 'FAIL'
  });

  // ---- Test 6: openGuideHub() opens the Guide Hub sheet directly (desktop sidebar path), and always
  // resets to the landing list even if a previous session left it mid-drill-down ----
  win.eval(`selectGuideHubView('training'); document.getElementById('guidehub-overlay').classList.remove('open'); openGuideHub();`);
  const guideHubOpen = win.eval(`document.getElementById('guidehub-overlay').classList.contains('open')`);
  const resetToListOnReopen = win.eval(`document.querySelectorAll('#guidehub-sh-body .card').length`) === 2;
  console.log('Test 6 (openGuideHub opens the Guide Hub sheet and always resets to the landing list):', {
    result: (guideHubOpen && resetToListOnReopen) ? 'PASS' : 'FAIL'
  });

  // ---- Test 7: closeOverlay works generically for guidehub-overlay (no special-case cleanup
  // needed, unlike log-overlay/crop-overlay) ----
  win.eval(`closeOverlay('guidehub-overlay')`);
  const guideHubClosed = win.eval(`!document.getElementById('guidehub-overlay').classList.contains('open')`);
  console.log('Test 7 (closeOverlay closes the Guide Hub sheet):', guideHubClosed ? 'PASS' : 'FAIL');

  // ---- Test 8: the desktop sidebar has its own "Guide Hub" button wired to openGuideHub(),
  // separate from the existing Help button (which still opens Plan Guide, unchanged) ----
  const sidebarHasGuideHub = win.eval(`Array.from(document.querySelectorAll('.sidebar-btn')).some(b => b.getAttribute('onclick') === 'openGuideHub()' && b.textContent.includes('Guide Hub'))`);
  const helpStillOpensPlanGuide = win.eval(`Array.from(document.querySelectorAll('.sidebar-help-btn')).some(b => b.getAttribute('onclick') === 'openPlanGuide()')`);
  console.log('Test 8 (sidebar has a dedicated Guide Hub button; Help still opens Plan Guide, unchanged):', {
    result: (sidebarHasGuideHub && helpStillOpensPlanGuide) ? 'PASS' : 'FAIL'
  });

  // ---- Test 8b: Pace Calculator, Heart Rate Zones, and Guide Hub sit together as their own visually
  // separated sidebar section (a sidebar-sep immediately precedes the Pace Calculator button),
  // distinct from the Plans/Races/Shoes group above them ----
  const toolsSectionSeparated = win.eval(`
    (() => {
      const paceBtn = Array.from(document.querySelectorAll('.sidebar-btn')).find(b => b.getAttribute('onclick') === 'openPaceCalc()');
      return !!(paceBtn && paceBtn.previousElementSibling && paceBtn.previousElementSibling.classList.contains('sidebar-sep'));
    })()
  `);
  console.log('Test 8b (Pace Calculator/Heart Rate Zones/Guide Hub form their own separated sidebar section):', toolsSectionSeparated ? 'PASS' : 'FAIL');

  // ---- Test 9: on mobile, the Tools sheet lists 5 secondary tools in order (Pace Calculator,
  // Heart Rate Zones, Guide Hub, Plan Generator, Shoes -- "Activity Feed" was Task 48's addition
  // here, later removed once Activities became its own primary tab (v0.32.35, see
  // test_activity_feed_fab.js) rather than staying tucked in Tools as a redundant duplicate entry
  // point), and Settings' About section still only has "How your plan is built" (Plan Guide is a
  // different feature and keeps its own entry point, never routed through Tools) ----
  win.eval(`document.getElementById('tools-sh-body').innerHTML = toolsBodyHTML();`);
  const toolsTitlesInOrder = win.eval(`JSON.stringify(TOOLS_LIST.map(t=>t.title))`);
  const expectedToolsTitles = JSON.stringify(['Pace Calculator','Heart Rate Zones','Guide Hub','Plan Generator','Shoes']);
  const toolsListsGuideHub = win.eval(`TOOLS_LIST.some(t => t.title === 'Guide Hub' && t.onclick.includes('openGuideHub()'))`);
  const toolsListsPlanGenerator = win.eval(`TOOLS_LIST.some(t => t.title === 'Plan Generator' && t.onclick.includes('gpOpenWizard()'))`);
  const toolsListsShoes = win.eval(`TOOLS_LIST.some(t => t.title === 'Shoes' && t.onclick.includes('openShoes()'))`);
  win.eval(`document.getElementById('settings-sh-body').innerHTML = renderSettingsBody();`);
  const settingsHTML = win.eval(`document.getElementById('settings-sh-body').innerHTML`);
  const settingsNoLongerHasGuideHub = !settingsHTML.includes('openGuideHub()');
  console.log('Test 9 (Tools sheet lists 5 tools in order incl. Guide Hub + Plan Generator + Shoes; Settings > About unaffected):', {
    toolsTitlesInOrder,
    result: (toolsTitlesInOrder === expectedToolsTitles && toolsListsGuideHub && toolsListsPlanGenerator && toolsListsShoes &&
      settingsNoLongerHasGuideHub && settingsHTML.includes('How your plan is built')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 10: tapping the Guide Hub row in the Tools sheet closes Tools and opens Guide Hub
  // (Guide Hub is the 3rd of 4 rows, index 2) ----
  win.eval(`
    document.getElementById('guidehub-overlay').classList.remove('open');
    document.getElementById('tools-overlay').classList.add('open');
  `);
  win.eval(`document.querySelectorAll('#tools-sh-body button')[2].click();`);
  const toolsClosedGuideHubOpen = win.eval(`!document.getElementById('tools-overlay').classList.contains('open') && document.getElementById('guidehub-overlay').classList.contains('open')`);
  console.log('Test 10 (tapping Guide Hub in the Tools sheet closes Tools and opens Guide Hub):', toolsClosedGuideHubOpen ? 'PASS' : 'FAIL');

  // ---- Test 11: tapping the Plan Generator row (4th of 4, index 3) in the Tools sheet closes Tools
  // and opens the Generate-a-Plan wizard directly, with no dependency on the Plans sheet being open ----
  win.eval(`
    document.getElementById('genplan-overlay').classList.remove('open');
    document.getElementById('tools-overlay').classList.add('open');
    document.getElementById('tools-sh-body').innerHTML = toolsBodyHTML();
  `);
  win.eval(`document.querySelectorAll('#tools-sh-body button')[3].click();`);
  const toolsClosedWizardOpen = win.eval(`!document.getElementById('tools-overlay').classList.contains('open') && document.getElementById('genplan-overlay').classList.contains('open')`);
  console.log('Test 11 (tapping Plan Generator in the Tools sheet closes Tools and opens the wizard):', toolsClosedWizardOpen ? 'PASS' : 'FAIL');

  // ---- Test 12: tapping the Shoes row (5th of 5, index 4) in the Tools sheet closes Tools and opens
  // the Shoes sheet directly -- Shoes previously had no dedicated one-tap mobile entry point (only
  // Settings > General > "Manage shoes" or the Progress tab's Shoe Rotation "Manage" link), so this
  // gives it the same one-tap Tools access as the other four rows ----
  win.eval(`
    document.getElementById('shoes-overlay').classList.remove('open');
    document.getElementById('tools-overlay').classList.add('open');
    document.getElementById('tools-sh-body').innerHTML = toolsBodyHTML();
  `);
  win.eval(`document.querySelectorAll('#tools-sh-body button')[4].click();`);
  const toolsClosedShoesOpen = win.eval(`!document.getElementById('tools-overlay').classList.contains('open') && document.getElementById('shoes-overlay').classList.contains('open')`);
  console.log('Test 12 (tapping Shoes in the Tools sheet closes Tools and opens Shoes):', toolsClosedShoesOpen ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
