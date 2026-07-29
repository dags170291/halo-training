// Regression test for the new "How Your Plan Is Built" training-methodology info/knowledge section
// (task #113): a Settings entry point, a wizard Review-step entry point, and content that is derived
// live from the real generator constants/functions (GP_PEAK_ANCHORS, gpPeakWeeklyKm) rather than
// separately hardcoded prose that could silently drift out of sync.
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

  // ---- Test 1: openPlanGuide() populates the sheet body and opens the overlay ----
  win.eval(`openPlanGuide();`);
  const isOpen = win.eval(`document.getElementById('planguide-overlay').classList.contains('open')`);
  const bodyHTML = win.eval(`document.getElementById('planguide-sh-body').innerHTML`);
  console.log('Test 1 (openPlanGuide opens the overlay and fills its body):',
    (isOpen && bodyHTML.length > 500) ? 'PASS' : 'FAIL', { isOpen, bodyLen: bodyHTML.length });

  // ---- Test 2: contains the "not a coach" disclaimer ----
  const hasDisclaimer = win.eval(`document.getElementById('planguide-sh-body').textContent.includes('not a coach')`);
  console.log('Test 2 (disclaimer text is present):', hasDisclaimer ? 'PASS' : 'FAIL', { hasDisclaimer });

  // ---- Test 3: closeOverlay works on it like any other overlay ----
  win.eval(`closeOverlay('planguide-overlay');`);
  const isClosedAfter = win.eval(`!document.getElementById('planguide-overlay').classList.contains('open')`);
  console.log('Test 3 (closeOverlay closes it):', isClosedAfter ? 'PASS' : 'FAIL', { isClosedAfter });

  // ---- Test 4: peak-volume table values match the live gpPeakWeeklyKm() output (km units — default
  // distUnit — so the guide content can never silently drift from what the generator actually
  // computes). Note: deliberately not calling setDistUnit() here — that's a pre-existing app function
  // that triggers a full switchView(CURR_VIEW) re-render, which reliably OOMs under jsdom's lack of
  // real layout/ResizeObserver support regardless of anything in this feature; unrelated to this test.
  win.eval(`openPlanGuide();`);
  const tableText = win.eval(`document.getElementById('planguide-sh-body').textContent`);
  const expected10kInt = win.eval(`Math.round(gpPeakWeeklyKm(10,'intermediate'))+' km'`);
  const expectedMarathonAdv = win.eval(`Math.round(gpPeakWeeklyKm(42.195,'advanced'))+' km'`);
  console.log('Test 4 (peak table reflects live gpPeakWeeklyKm values):',
    (tableText.includes(expected10kInt) && tableText.includes(expectedMarathonAdv)) ? 'PASS' : 'FAIL',
    { expected10kInt, expectedMarathonAdv });

  // ---- Test 5: Settings sheet has an entry point that opens the guide ----
  win.eval(`openSettings();`);
  const settingsHasButton = win.eval(`document.getElementById('settings-sh-body').innerHTML.includes("openPlanGuide()")`);
  console.log('Test 5 (Settings has a "How your plan is built" entry point):', settingsHasButton ? 'PASS' : 'FAIL', { settingsHasButton });
  win.eval(`
    const btns=Array.from(document.querySelectorAll('#settings-sh-body button'));
    const guideBtn=btns.find(b=>b.textContent.includes('How your plan is built'));
    if(guideBtn) guideBtn.click();
  `);
  const openedFromSettings = win.eval(`document.getElementById('planguide-overlay').classList.contains('open')`);
  console.log('Test 5b (clicking the Settings entry point actually opens the guide):', openedFromSettings ? 'PASS' : 'FAIL', { openedFromSettings });

  // ---- Test 6: wizard Review step has an entry point that opens the guide ----
  win.eval(`closeOverlay('planguide-overlay'); gpOpenWizard();`);
  const reviewHTML = win.eval(`
    GP_STEP = gpBuildSteps().length - 1; // jump straight to the 'review' step id
    gpStepReviewHTML();
  `);
  const reviewHasButton = reviewHTML.includes('openPlanGuide()');
  console.log('Test 6 (wizard Review step has a "How this plan is built" link):', reviewHasButton ? 'PASS' : 'FAIL', { reviewHasButton });

  await wait(200);
  win.close();
})();
