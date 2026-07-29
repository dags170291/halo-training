// Regression test for a batch of small, unrelated fixes requested together: (1) the two "This is a
// calculator, not a coach" banners (Generate Plan wizard + Plan Guide) use a softer amber caution
// style instead of the harsh red warn style -- Dylon: "the red for the plan generator seems to harsh
// use a softer amber"; (2) the training methodology/knowledge section (Plan Guide) now explains how
// Training Load (ACWR) works -- Dylon: "Add training load information i.e how it works"; (3) onboarding
// sign-in is split into 2 steps -- step 1 is profile info (incl. photo upload) with a Continue button,
// step 2 is the optional sync-devices step with a Skip/"do this later" button that advances to the
// next step and tells the user this can be done later in Settings; (4) the shoe photo crop overlay now
// has an explicit z-index above the Shoes overlay so it never renders behind the shoe edit card; (5)
// every shoe in the Shoes list gets a left-side avatar -- a real photo if uploaded, else a colored
// initials monogram -- instead of only shoes with a photo getting any left-side visual element.
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

  // ==== Amber caution banners ====

  // ---- Test 1: the Generate Plan wizard's "not a coach" banner uses the softer caution class, not
  // the harsh red warn class ----
  win.eval(`GP_DISTANCE=null; GP_EXPERIENCE=null; GP_DIFFICULTY=null;`);
  const gpStepHTML = win.eval(`gpStepRaceHTML()`);
  console.log('Test 1 (Generate Plan wizard banner uses notice-banner-caution, not notice-banner-warn):', {
    result: (gpStepHTML.includes('notice-banner-caution') && !gpStepHTML.includes('notice-banner-warn')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 2: the Plan Guide's identical banner is also softened to the caution class ----
  const planGuideHTML = win.eval(`renderPlanGuideHTML()`);
  console.log('Test 2 (Plan Guide banner uses notice-banner-caution, not notice-banner-warn):', {
    result: (planGuideHTML.includes('notice-banner-caution') && !planGuideHTML.includes('notice-banner-warn')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 3: the new .notice-banner-caution CSS rule exists and is built from the amber tokens,
  // not the red ones ----
  const cautionCSSMatch = html.match(/\.notice-banner-caution\{([^}]*)\}/);
  console.log('Test 3 (.notice-banner-caution CSS rule exists and uses amber tokens):', {
    rule: cautionCSSMatch && cautionCSSMatch[0],
    result: (cautionCSSMatch && /--am3/.test(cautionCSSMatch[1]) && /--am2/.test(cautionCSSMatch[1])) ? 'PASS' : 'FAIL'
  });

  // ==== Training Load explainer ====

  // ---- Test 4: the Plan Guide now includes a real explanation of how Training Load (ACWR) works,
  // mentioning the acute/chronic windows and the band names ----
  console.log('Test 4 (Plan Guide explains Training Load: acute/chronic windows + band names):', {
    result: (planGuideHTML.includes('Training Load') && planGuideHTML.includes('acute') && planGuideHTML.includes('chronic') &&
      planGuideHTML.includes('Balanced') && planGuideHTML.includes('Elevated')) ? 'PASS' : 'FAIL'
  });

  // ==== Onboarding 2-step sign-in ====

  win.eval(`
    PROFILE = {};
    BLOCKS = []; DATA = []; STATUS = {}; NOTES = {};
    ONBOARDING_STEP = 'welcome';
  `);

  // ---- Test 5: step 1 (profile) includes a photo upload control and a Continue button, and does
  // NOT include the sync email/password fields inline anymore ----
  const step1HTML = win.eval(`onboardingWelcomeHTML()`);
  console.log('Test 5 (onboarding step 1 = profile info + photo upload + Continue button, no inline sync fields):', {
    result: (step1HTML.includes('ob-avatar-file-input') && step1HTML.includes('>Continue<') &&
      !step1HTML.includes('ob-sync-email')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 6: completing step 1 with just a name advances to the sync step (when sync is
  // configured), not straight to the plan step ----
  win.eval(`
    document.getElementById('onboarding-card').innerHTML = onboardingWelcomeHTML();
    document.getElementById('ob-name').value = 'Test Runner';
    SB.__configured = true;
  `);
  // syncConfigured() usually checks for real Supabase config; force it true for this test via a stub
  win.eval(`window.__origSyncConfigured = syncConfigured; syncConfigured = function(){ return true; };`);
  win.eval(`completeOnboardingProfile();`);
  const stepAfterProfile = win.eval(`ONBOARDING_STEP`);
  console.log('Test 6 (completing step 1 advances to the sync step when sync is configured):',
    stepAfterProfile === 'sync' ? 'PASS' : 'FAIL', { stepAfterProfile });

  // ---- Test 7: the sync step offers a Skip/"do this later" option, and it advances to the plan step
  // without requiring sync, telling the user this can be done later in Settings ----
  const syncStepHTML = win.eval(`onboardingSyncHTML()`);
  const mentionsSettings = /settings/i.test(syncStepHTML);
  console.log('Test 7 (sync step has a Skip button and tells the user it can be done later in Settings):', {
    result: (syncStepHTML.includes('onboardingSkipSync()') && mentionsSettings) ? 'PASS' : 'FAIL'
  });
  win.eval(`onboardingSkipSync();`);
  const stepAfterSkip = win.eval(`ONBOARDING_STEP`);
  console.log('Test 8 (skipping sync advances straight to the plan step):',
    stepAfterSkip === 'plan' ? 'PASS' : 'FAIL', { stepAfterSkip });

  // ---- Test 9: when sync is NOT configured, completing step 1 skips the sync step entirely and
  // goes straight to plan ----
  win.eval(`syncConfigured = function(){ return false; }; ONBOARDING_STEP='welcome'; PROFILE={};`);
  win.eval(`
    document.getElementById('onboarding-card').innerHTML = onboardingWelcomeHTML();
    document.getElementById('ob-name').value = 'Test Runner Two';
    completeOnboardingProfile();
  `);
  const stepNoSync = win.eval(`ONBOARDING_STEP`);
  console.log('Test 9 (with no sync configured, step 1 goes straight to the plan step):',
    stepNoSync === 'plan' ? 'PASS' : 'FAIL', { stepNoSync });
  win.eval(`syncConfigured = window.__origSyncConfigured;`);

  // ==== Shoe crop overlay z-index ====

  // ---- Test 10: the crop overlay has an explicit z-index comfortably above the Shoes overlay (and
  // every other overlay), so it always paints on top when opened from within the Shoes form ----
  const cropZMatch = html.match(/id="crop-overlay"[^>]*style="[^"]*z-index:(\d+)/);
  console.log('Test 10 (#crop-overlay has an explicit z-index above 260, so it never renders behind the shoe edit card):', {
    zIndex: cropZMatch && cropZMatch[1],
    result: (cropZMatch && parseInt(cropZMatch[1], 10) > 260) ? 'PASS' : 'FAIL'
  });

  // ==== Shoe list avatars ====

  win.eval(`
    SHOES = {
      withphoto: {name:'Pegasus 40', brand:'Nike', model:'Pegasus 40', km:20, image:'data:image/jpeg;base64,AAAA'},
      nophoto: {name:'SL2', brand:'ASICS', model:'SL2', km:10}
    };
  `);
  const shoesHTML = win.eval(`shoeListHTML()`);
  const photoShoeHasImg = /Pegasus[\s\S]*?<img/.test(shoesHTML) || shoesHTML.includes('data:image/jpeg;base64,AAAA');
  const initials = win.eval(`shoeInitials('SL2')`);
  console.log('Test 11 (every shoe gets a left-side avatar -- real photo if uploaded, colored initials monogram if not):', {
    initials,
    result: (photoShoeHasImg && shoesHTML.includes(initials) && shoesHTML.includes('border-radius:var(--r10)')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 12: the initials-monogram color is stable across re-renders (same shoe key always maps
  // to the same palette entry) ----
  const meta1 = win.eval(`JSON.stringify(shoeAvatarMeta('nophoto'))`);
  const meta2 = win.eval(`JSON.stringify(shoeAvatarMeta('nophoto'))`);
  console.log('Test 12 (a shoe\\u2019s avatar color is stable across repeated calls):',
    meta1 === meta2 ? 'PASS' : 'FAIL', { meta1 });

  await wait(200);
  win.close();
})();
