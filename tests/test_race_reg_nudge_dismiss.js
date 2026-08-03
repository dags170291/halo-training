// Regression test for a real gap Dylon reported: "registration open soon notification dont disapear
// or is un moveable". raceRegNudgeHTML() (the "Registration opens soon"/"Registration is open" banner
// on Today) had no way to dismiss it at all -- unlike its sibling tbdRaceNudgeHTML() ("Check on
// unannounced races"), which already had a "Remind me later" snooze button (dismissTBDNudge()). Once
// a race's registration opened, the banner had NO upper bound and would show every single day forever
// until the race was manually marked Registered.
//
// Asked via AskUserQuestion whether the fix should be a snooze button, a quick "Mark as Registered"
// shortcut, or both -- Dylon chose the snooze button, the recommended option, matching the exact
// pattern tbdRaceNudgeHTML()/dismissTBDNudge() already established elsewhere in this same file.
//
// Snoozed PER-RACE (PROFILE.regNudgeSnoozed, an object keyed by race key) rather than one shared flag
// like tbdNudgeSnoozedOn -- raceRegNudgeHTML() only ever shows the single most urgent race at a time,
// so dismissing race A's nudge must not also hide a DIFFERENT race B's reg-open nudge if B becomes the
// most urgent one later (or is shown at the same time because A is snoozed).
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

  // Fixed "today" via a fixture race whose regOpenDate is already in the past (registration open,
  // the exact "doesn't disappear" case) relative to whatever todayISO() returns live -- so instead we
  // pin dates relative to a real anchor date and just check daysToOpen sign/magnitude logic indirectly
  // through the banner text, same as the pre-existing race tests in this suite do.
  const today = win.eval(`todayISO()`);
  win.eval(`
    RACES_LIST=[
      {key:'raceA',name:'Race A',date:'2026-12-01',dateTBD:false,time:'',regOpenDate:'2026-01-01',distance:'5K',priority:'B',shoeKey:'',status:'tentative',goal:'',targetMin:'',targetMax:'',isPB:false,location:'',routeUrl:'',blockId:null,resultPace:'',resultHR:'',resultPos:'',resultGPos:'',resultAPos:'',resultNotes:''},
      {key:'raceB',name:'Race B',date:'2026-12-15',dateTBD:false,time:'',regOpenDate:'2026-01-02',distance:'10K',priority:'B',shoeKey:'',status:'tentative',goal:'',targetMin:'',targetMax:'',isPB:false,location:'',routeUrl:'',blockId:null,resultPace:'',resultHR:'',resultPos:'',resultGPos:'',resultAPos:'',resultNotes:''}
    ];
    ACTIVE_BLOCK_ID=null; BLOCKS=[]; PROFILE={};
  `);

  // ---- Test 1: with nothing snoozed, the banner shows the most urgent race (raceA opened first) and
  // includes a "Remind me later" button wired to dismissRegNudge, alongside the existing "View race". ----
  const bannerInitial = win.eval(`raceRegNudgeHTML()`);
  const t1 = bannerInitial.includes('Race A')
    && bannerInitial.includes('View race')
    && bannerInitial.includes("Remind me later")
    && bannerInitial.includes("dismissRegNudge('raceA')");
  console.log('Test 1 (banner shows the most urgent race with both View race and Remind me later buttons):', t1?'PASS':'FAIL', { hasRaceA: bannerInitial.includes('Race A'), hasRemind: bannerInitial.includes('Remind me later') });

  // ---- Test 2: dismissing raceA's nudge hides it, but raceB's own nudge (a different race) still
  // shows -- proves the snooze is scoped per-race, not one shared flag. ----
  win.eval(`dismissRegNudge('raceA');`);
  const snoozedRaceA = win.eval(`PROFILE.regNudgeSnoozed && PROFILE.regNudgeSnoozed['raceA']`);
  const bannerAfterDismissA = win.eval(`raceRegNudgeHTML()`);
  const t2 = !!snoozedRaceA
    && !bannerAfterDismissA.includes('Race A')
    && bannerAfterDismissA.includes('Race B');
  console.log("Test 2 (dismissing race A hides only race A's nudge, race B's still shows):", t2?'PASS':'FAIL', { snoozedRaceA, bannerAfterDismissA: bannerAfterDismissA.slice(0,120) });

  // ---- Test 3: dismissing race B too means BOTH are snoozed -- banner returns empty, i.e. it
  // genuinely disappears now, which is the entire point of the fix. ----
  win.eval(`dismissRegNudge('raceB');`);
  const bannerAfterDismissBoth = win.eval(`raceRegNudgeHTML()`);
  const t3 = bannerAfterDismissBoth === '';
  console.log('Test 3 (dismissing both races makes the banner genuinely disappear):', t3?'PASS':'FAIL', { bannerAfterDismissBoth });

  // ---- Test 4: the snooze expires after ~7 days -- backdating raceA's snooze timestamp to 8 days ago
  // brings its nudge back (matching dismissTBDNudge's same "snooze for about a week" convention). ----
  win.eval(`
    const eightDaysAgo=new Date(new Date('${today}').getTime()-8*86400000).toISOString().slice(0,10);
    PROFILE.regNudgeSnoozed['raceA']=eightDaysAgo;
  `);
  const bannerAfterExpiry = win.eval(`raceRegNudgeHTML()`);
  const t4 = bannerAfterExpiry.includes('Race A');
  console.log('Test 4 (a snooze older than ~7 days expires and the nudge reappears):', t4?'PASS':'FAIL', { bannerAfterExpiry: bannerAfterExpiry.slice(0,120) });

  // ---- Test 5: regression -- a race already marked 'registered' never shows a nudge regardless of
  // snooze state, exactly as before this fix (pre-existing filter, untouched). ----
  win.eval(`
    RACES_LIST=[{key:'raceC',name:'Race C',date:'2026-12-01',dateTBD:false,time:'',regOpenDate:'2026-01-01',distance:'5K',priority:'B',shoeKey:'',status:'registered',goal:'',targetMin:'',targetMax:'',isPB:false,location:'',routeUrl:'',blockId:null,resultPace:'',resultHR:'',resultPos:'',resultGPos:'',resultAPos:'',resultNotes:''}];
    PROFILE={};
  `);
  const bannerRegisteredRace = win.eval(`raceRegNudgeHTML()`);
  const t5 = bannerRegisteredRace === '';
  console.log('Test 5 (a race already marked Registered still never shows a nudge, unaffected by this fix):', t5?'PASS':'FAIL', { bannerRegisteredRace });
})();
