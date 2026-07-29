// Regression test for the Help/discoverability round: sidebar Help button (replacing Shortcuts),
// help icon on the Your Plans sheet header, a briefing card on the wizard's first page, "convert an
// existing plan" messaging in the upload header, and Shortcuts moved into Settings.
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

  // ---- Test 1: sidebar no longer has a Shortcuts button, has a Help button that opens the Plan Guide ----
  const sidebarHTML = win.eval(`document.getElementById('sidebar').innerHTML`);
  const noShortcutsInSidebar = !sidebarHTML.includes('>Shortcuts<');
  const hasHelpButton = sidebarHTML.includes('>Help<') && sidebarHTML.includes('onclick="openPlanGuide()"');
  console.log('Test 1 (sidebar: Shortcuts removed, Help button added that opens Plan Guide):',
    (noShortcutsInSidebar && hasHelpButton) ? 'PASS' : 'FAIL', { noShortcutsInSidebar, hasHelpButton });

  // ---- Test 2: clicking the sidebar Help button actually opens the Plan Guide overlay ----
  win.eval(`
    const btns = Array.from(document.querySelectorAll('.sidebar-btn'));
    const helpBtn = btns.find(b=>b.textContent.trim()==='Help');
    if(helpBtn) helpBtn.click();
  `);
  const planGuideOpenFromSidebar = win.eval(`document.getElementById('planguide-overlay').classList.contains('open')`);
  console.log('Test 2 (clicking sidebar Help opens the Plan Guide overlay):', planGuideOpenFromSidebar ? 'PASS' : 'FAIL');
  win.eval(`closeOverlay('planguide-overlay');`);

  // ---- Test 3: Settings now offers Keyboard Shortcuts (moved out of the sidebar) ----
  win.eval(`openSettings();`);
  const settingsHTML = win.eval(`document.getElementById('settings-sh-body').innerHTML`);
  const hasShortcutsInSettings = settingsHTML.includes('Keyboard shortcuts') && settingsHTML.includes('onclick="showShortcutsHelp()"');
  console.log('Test 3 (Settings > About offers Keyboard shortcuts):', hasShortcutsInSettings ? 'PASS' : 'FAIL');
  win.eval(`
    const btns = Array.from(document.querySelectorAll('#settings-sh-body button'));
    const scBtn = btns.find(b=>b.textContent.includes('Keyboard shortcuts'));
    if(scBtn) scBtn.click();
  `);
  const shortcutsDialogOpen = win.eval(`document.getElementById('confirm-overlay').classList.contains('open')`);
  const shortcutsDialogTitle = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  console.log('Test 3b (clicking it actually opens the shortcuts dialog):',
    (shortcutsDialogOpen && shortcutsDialogTitle.includes('Keyboard Shortcuts')) ? 'PASS' : 'FAIL');
  win.eval(`closeOverlay('confirm-overlay');`);

  // ---- Test 4: Your Plans sheet header has a help icon that opens the Plan Guide, alongside the
  // existing close button (not replacing it) ----
  win.eval(`openPlans();`);
  const plansHdrHTML = win.eval(`document.querySelector('#plans-overlay .sheet-hdr').innerHTML`);
  const hasHelpIconInPlansHdr = (plansHdrHTML.match(/onclick="openPlanGuide\(\)"/g)||[]).length >= 1;
  const stillHasCloseButton = plansHdrHTML.includes("closeOverlay('plans-overlay')");
  console.log('Test 4 (Your Plans header has a help icon + still has its close button):',
    (hasHelpIconInPlansHdr && stillHasCloseButton) ? 'PASS' : 'FAIL');
  win.eval(`
    const hdrBtns = Array.from(document.querySelectorAll('#plans-overlay .sheet-hdr button'));
    const helpIcon = hdrBtns.find(b=>b.getAttribute('onclick')==='openPlanGuide()');
    if(helpIcon) helpIcon.click();
  `);
  const planGuideOpenFromPlansHdr = win.eval(`document.getElementById('planguide-overlay').classList.contains('open')`);
  console.log('Test 4b (clicking the Your Plans help icon opens the Plan Guide):', planGuideOpenFromPlansHdr ? 'PASS' : 'FAIL');
  win.eval(`closeOverlay('planguide-overlay'); closeOverlay('plans-overlay');`);

  // ---- Test 5: the wizard's first page ("race" step) now shows an alert-style briefing banner
  // with a "not AI" / rule-based disclaimer and a real button into the full Plan Guide (redesigned
  // from a plain card + bare <a href="#"> into a proper notice-banner, see test_help_redesign.js
  // for the fuller z-index/visual regression coverage of that redesign; softened from the original
  // notice-banner-warn red to notice-banner-caution amber per Dylon's later feedback that the red
  // felt too harsh) ----
  win.eval(`gpOpenWizard();`);
  const raceStepHTML = win.eval(`gpStepRaceHTML()`);
  const hasBriefing = raceStepHTML.includes('notice-banner-caution') && raceStepHTML.includes('not AI');
  const hasLearnMoreLink = raceStepHTML.includes('<button class="primary" onclick="openPlanGuide()">See exactly how it works</button>');
  console.log('Test 5 (wizard first page has a rule-based/not-AI alert banner + button into the full guide):',
    (hasBriefing && hasLearnMoreLink) ? 'PASS' : 'FAIL');
  win.eval(`gpCloseWizard();`);

  // ---- Test 6: planUploadHeaderHTML now also covers "already have a plan, ask AI to convert it" ----
  const uploadHeaderHTML = win.eval(`planUploadHeaderHTML()`);
  const hasConvertMessaging = uploadHeaderHTML.includes('Already have a plan') && uploadHeaderHTML.includes('convert it');
  const stillHasGenerateMessaging = uploadHeaderHTML.includes('Need a plan?') && uploadHeaderHTML.includes('View the AI prompt');
  console.log('Test 6 (upload header covers both "need a plan" and "convert an existing plan"):',
    (hasConvertMessaging && stillHasGenerateMessaging) ? 'PASS' : 'FAIL');

  // ---- Test 7: PLAN_UPLOAD_PROMPT itself is untouched (must stay word-for-word identical to the
  // Plan Upload Format doc — the messaging change should be surrounding UI copy only) ----
  const promptStartsCorrectly = win.eval(`PLAN_UPLOAD_PROMPT.startsWith('Generate a training plan as a single JSON object matching this exact schema.')`);
  console.log('Test 7 (PLAN_UPLOAD_PROMPT text itself is untouched):', promptStartsCorrectly ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
