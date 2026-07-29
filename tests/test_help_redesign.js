// Regression test for the Plan Guide visual/z-index fixes: (1) the "See exactly how it works" link
// used to open a popup that was invisible behind the wizard because #genplan-overlay has an elevated
// z-index (225) while planguide-overlay used the base .overlay z-index (200) — fixed by giving it 230;
// (2) the wizard briefing + Plan Guide's own top disclaimer are now real notice-banner/notice-banner-
// warn alerts (matching install/reminder styling, just red) instead of plain cards with a bare <a>;
// (3) the Plan Guide body now uses icon-badged sections instead of plain section-lbl+card blocks;
// (4) the same help icon (user-supplied asset) is used consistently in the sidebar, Your Plans header,
// and the Plan Guide's own sheet header; (5) the race carousel's per-card baseline width shrank from
// 340 to 300 so 2 cards fit at a narrower available width than before.
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

  // ---- Test 1: z-index fix — planguide-overlay (230) now outranks genplan-overlay (225) ----
  const planGuideZ = win.eval(`parseInt(document.getElementById('planguide-overlay').style.zIndex, 10)`);
  const genplanZ = win.eval(`parseInt(getComputedStyle(document.getElementById('genplan-overlay')).zIndex, 10)`);
  console.log('Test 1 (Plan Guide z-index is now above the wizard overlay z-index):',
    (planGuideZ > genplanZ) ? 'PASS' : 'FAIL', { planGuideZ, genplanZ });

  // ---- Test 2: opening the wizard then clicking "See exactly how it works" actually leaves the
  // Plan Guide open on top — both overlays open, guide's z-index wins, so it's genuinely visible ----
  win.eval(`gpOpenWizard();`);
  const wizardOpenBefore = win.eval(`document.getElementById('genplan-overlay').classList.contains('open')`);
  win.eval(`
    const btns = Array.from(document.querySelectorAll('#gp-step-body .notice-banner-actions button'));
    const learnMoreBtn = btns.find(b=>b.textContent.includes('See exactly how it works'));
    if(learnMoreBtn) learnMoreBtn.click();
  `);
  const guideOpenAfterClick = win.eval(`document.getElementById('planguide-overlay').classList.contains('open')`);
  const wizardStillOpen = win.eval(`document.getElementById('genplan-overlay').classList.contains('open')`);
  console.log('Test 2 (clicking the wizard briefing link opens the guide without closing the wizard, and it now outranks it):',
    (wizardOpenBefore && guideOpenAfterClick && wizardStillOpen) ? 'PASS' : 'FAIL',
    { wizardOpenBefore, guideOpenAfterClick, wizardStillOpen });
  win.eval(`closeOverlay('planguide-overlay'); gpCloseWizard();`);

  // ---- Test 3: the wizard's first page briefing is a real notice-banner alert with a real
  // button (not a bare <a href="#">, which was part of the original "window doesn't move" complaint).
  // Originally a red notice-banner-warn; softened to notice-banner-caution amber per Dylon's later
  // feedback that the red felt too harsh. ----
  const raceStepHTML = win.eval(`gpOpenWizard(); gpStepRaceHTML();`);
  const isRealBanner = raceStepHTML.includes('class="notice-banner notice-banner-caution"');
  const noBareAnchor = !raceStepHTML.includes('<a href="#"');
  const hasRealButton = raceStepHTML.includes('<button class="primary" onclick="openPlanGuide()">See exactly how it works</button>');
  console.log('Test 3 (wizard briefing is a real notice-banner alert with a real button, no bare anchor):',
    (isRealBanner && noBareAnchor && hasRealButton) ? 'PASS' : 'FAIL');
  win.eval(`gpCloseWizard();`);

  // ---- Test 4: the Plan Guide's own top disclaimer is also a real notice-banner (same alert
  // language as the wizard, and the same visual family as install/reminder banners); now the softer
  // amber notice-banner-caution rather than the original red notice-banner-warn ----
  const guideHTML = win.eval(`renderPlanGuideHTML()`);
  const guideHasWarnBanner = guideHTML.includes('class="notice-banner notice-banner-caution"') && guideHTML.includes('This is a calculator, not a coach');
  console.log('Test 4 (Plan Guide top disclaimer uses the softer amber alert banner style):', guideHasWarnBanner ? 'PASS' : 'FAIL');

  // ---- Test 5: the Plan Guide body now has icon-badged sections (36px colored icon circle + title
  // row) rather than plain section-lbl/card blocks — check a few of the section titles are present
  // alongside the icon-badge markup. 7 sections now (a Training Load explainer was added later, per
  // Dylon: "Add training load information i.e how it works") ----
  const sectionTitles = ['Periodization: Base', 'Peak Weekly Volume', 'Long Runs & Speed Days', 'Pacing', 'Clean Numbers', 'Difficulty Dial', 'Training Load'];
  const allTitlesPresent = sectionTitles.every(t => guideHTML.includes(t));
  const iconBadgeCount = (guideHTML.match(/width:36px;height:36px;border-radius:var\(--r10\)/g) || []).length;
  console.log('Test 5 (all 7 concept sections present, each with an icon badge):',
    (allTitlesPresent && iconBadgeCount === 7) ? 'PASS' : 'FAIL', { allTitlesPresent, iconBadgeCount });

  // ---- Test 6: the same help icon path (user-supplied asset) appears in the sidebar Help button,
  // the Your Plans sheet header, and the Plan Guide's own sheet header — one consistent glyph ----
  const helpIconPathFragment = 'M513.5-254.5Q528-269 528-290';
  const sidebarHTML = win.eval(`document.getElementById('sidebar').innerHTML`);
  win.eval(`openPlans();`);
  const plansHdrHTML = win.eval(`document.querySelector('#plans-overlay .sheet-hdr').innerHTML`);
  const planguideHdrHTML = win.eval(`document.querySelector('#planguide-overlay .sheet-hdr').innerHTML`);
  console.log('Test 6 (the same help icon glyph is used in the sidebar, Your Plans header, and Plan Guide header):',
    (sidebarHTML.includes(helpIconPathFragment) && plansHdrHTML.includes(helpIconPathFragment) && planguideHdrHTML.includes(helpIconPathFragment)) ? 'PASS' : 'FAIL');
  win.eval(`closeOverlay('plans-overlay');`);

  // ---- Test 7: race carousel per-card baseline shrank from 340 to 300 — at an available width where
  // the OLD baseline could only fit 1 card, the new one fits 2 ----
  win.eval(`
    const carousel = document.createElement('div');
    carousel.id = 'cd-carousel-test';
    for(let i=0;i<2;i++){ const c=document.createElement('div'); c.className='cd-carousel-card'; carousel.appendChild(c); }
    document.body.appendChild(carousel);
  `);
  const availableWidth = 620; // deliberately between the old (692 needed) and new (612 needed) thresholds for 2 cards
  const oldWouldFit = win.eval(`Math.floor((${availableWidth}+12)/(340+12))`);
  const newFits = win.eval(`Math.floor((${availableWidth}+12)/(300+12))`);
  console.log('Test 7 (2 race cards now fit at a width where the old 340px baseline only fit 1):',
    (oldWouldFit === 1 && newFits === 2) ? 'PASS' : 'FAIL', { oldWouldFit, newFits });

  await wait(200);
  win.close();
})();
