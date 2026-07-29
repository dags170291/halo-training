// Regression test for a real reported bug: Dylon's sister created a sync account, clicked the
// confirmation email, and could never tell whether anything had worked -- she never showed up with
// any data pushed to Supabase. Root cause: Supabase's signUp() only returns a real session
// immediately if email confirmation is disabled on the project; with confirmation required (the
// normal case), data.session is null even though the account was created successfully. Both the
// onboarding sync step and Settings' Cloud Sync card used to just fire a toast ("check your email if
// confirmation is required") and immediately fall back to/advance past the form as if nothing
// notable had happened -- easy to miss, with no persistent indication of what to do next. Fix: both
// now show a persistent "check your email, then come back and Sign In" screen whenever signUp
// succeeds without a session, instead of a toast that vanishes in a few seconds.
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
  win.eval(`syncConfigured = function(){ return true; };`);

  // ==== Onboarding sync step ====

  // ---- Test 1: signUp succeeding with NO session (email confirmation required, the normal real-
  // world case) lands on the 'sync-pending' step with a clear explanation, NOT straight through to
  // the plan step ----
  win.eval(`
    PROFILE={};ONBOARDING_STEP='sync';ONBOARD_PENDING_SYNC_EMAIL=null;
    syncSignUp = async (email,password) => ({ data:{ user:{id:'u1'}, session:null }, error:null });
    document.getElementById('onboarding-card').innerHTML = onboardingSyncHTML();
    document.getElementById('ob-sync-email').value = 'sister@example.com';
    document.getElementById('ob-sync-password').value = 'password123';
  `);
  await win.eval(`onboardingCreateSyncAccount()`);
  await wait(50);
  const stepAfterPendingSignup = win.eval(`ONBOARDING_STEP`);
  const pendingEmail = win.eval(`ONBOARD_PENDING_SYNC_EMAIL`);
  console.log('Test 1 (signUp with no session lands on sync-pending, not straight to plan):', {
    stepAfterPendingSignup, pendingEmail,
    result: (stepAfterPendingSignup === 'sync-pending' && pendingEmail === 'sister@example.com') ? 'PASS' : 'FAIL'
  });

  // ---- Test 2: the sync-pending screen names the exact email and tells her to use Sign In, not
  // Create Account again ----
  const pendingHTML = win.eval(`onboardingSyncPendingHTML()`);
  console.log('Test 2 (sync-pending screen names the email and says to use Sign In):', {
    result: (pendingHTML.includes('sister@example.com') && pendingHTML.includes('Sign In') && pendingHTML.includes('Continue for now')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 3: continuing from that screen advances to the plan step (same as Skip would) ----
  win.eval(`onboardingContinueFromSyncPending()`);
  const stepAfterContinue = win.eval(`ONBOARDING_STEP`);
  console.log('Test 3 (Continue for now advances to the plan step):', stepAfterContinue === 'plan' ? 'PASS' : 'FAIL');

  // ---- Test 4: by contrast, signUp succeeding WITH a real session (confirmation disabled on this
  // project) still goes straight to the plan step, unchanged from before ----
  win.eval(`
    PROFILE={};ONBOARDING_STEP='sync';ONBOARD_PENDING_SYNC_EMAIL=null;
    syncSignUp = async (email,password) => ({ data:{ user:{id:'u2'}, session:{user:{id:'u2',email}} }, error:null });
    document.getElementById('onboarding-card').innerHTML = onboardingSyncHTML();
    document.getElementById('ob-sync-email').value = 'confirmed@example.com';
    document.getElementById('ob-sync-password').value = 'password123';
  `);
  await win.eval(`onboardingCreateSyncAccount()`);
  await wait(50);
  const stepWithSession = win.eval(`ONBOARDING_STEP`);
  console.log('Test 4 (signUp with an immediate session still goes straight to the plan step):',
    stepWithSession === 'plan' ? 'PASS' : 'FAIL', { stepWithSession });

  // ==== Settings Cloud Sync card ====

  // ---- Test 5: same no-session signUp from Settings sets SETTINGS_SYNC_PENDING_EMAIL and the
  // Cloud Sync card shows the persistent explanation instead of the blank form ----
  win.eval(`
    SYNC_SESSION=null; SETTINGS_SYNC_PENDING_EMAIL=null;
    syncSignUp = async (email,password) => ({ data:{ user:{id:'u3'}, session:null }, error:null });
    document.body.insertAdjacentHTML('beforeend', '<div id="settings-sh-body"></div>');
    document.getElementById('settings-sh-body').innerHTML = '<input type="email" id="sync-email"><input type="password" id="sync-password">';
    document.getElementById('sync-email').value = 'sister2@example.com';
    document.getElementById('sync-password').value = 'password123';
    window.openSettings = function(){}; // stub -- not under test here
  `);
  await win.eval(`handleSyncSignUp()`);
  await wait(50);
  const settingsPendingEmail = win.eval(`SETTINGS_SYNC_PENDING_EMAIL`);
  const syncSectionHTML = win.eval(`renderSyncSectionHTML()`);
  console.log('Test 5 (Settings Cloud Sync: no-session signUp sets a pending email and shows the persistent explanation):', {
    settingsPendingEmail,
    result: (settingsPendingEmail === 'sister2@example.com' && syncSectionHTML.includes('sister2@example.com') && syncSectionHTML.includes('confirmation link')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 6: Dismiss clears the pending state, reverting to the plain sign-in/create-account form ----
  win.eval(`dismissSyncPending()`);
  const clearedPendingEmail = win.eval(`SETTINGS_SYNC_PENDING_EMAIL`);
  console.log('Test 6 (Dismiss clears the pending email):', clearedPendingEmail === null ? 'PASS' : 'FAIL');

  // ---- Test 7: a successful Sign In also clears any lingering pending-email state ----
  win.eval(`
    SETTINGS_SYNC_PENDING_EMAIL='still@pending.com';
    syncSignIn = async (email,password) => ({ error:null });
    document.getElementById('sync-email').value = 'still@pending.com';
    document.getElementById('sync-password').value = 'password123';
  `);
  await win.eval(`handleSyncSignIn()`);
  await wait(50);
  const pendingAfterSignIn = win.eval(`SETTINGS_SYNC_PENDING_EMAIL`);
  console.log('Test 7 (a successful Sign In clears any lingering pending-email state):', pendingAfterSignIn === null ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
