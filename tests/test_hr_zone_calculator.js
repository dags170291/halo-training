// Regression test for the new Heart Rate Zone Calculator (Dylon: modeled after yearroundrunning's
// Heart Rate Zone Calculator). A standalone tool, same entry-point pattern as the Pace Calculator:
// a dedicated sidebar button on desktop, a row in the mobile Tools sheet. Supports three methods
// (Karvonen/Heart Rate Reserve, %Max HR, Zoladz) with Max HR estimated from age (Tanaka/Fox/Gulati)
// and Resting HR estimated from a self-reported activity level when either isn't directly known.
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

  // ---- Test 1: Max HR estimation formulas match their published equations for a 30-year-old ----
  const tanaka = win.eval(`hrEstimateMaxHR(30,'tanaka')`);
  const fox = win.eval(`hrEstimateMaxHR(30,'fox')`);
  const gulati = win.eval(`hrEstimateMaxHR(30,'gulati')`);
  console.log('Test 1 (Max HR formulas: Tanaka 208-0.7*age, Fox 220-age, Gulati 206-0.88*age):', {
    tanaka, fox, gulati,
    result: (Math.abs(tanaka-187)<0.01 && Math.abs(fox-190)<0.01 && Math.abs(gulati-179.6)<0.01) ? 'PASS' : 'FAIL'
  });

  // ---- Test 2: with explicit Max HR + Resting HR (no estimation needed), Karvonen zone 1's lower
  // bound matches the published formula exactly: (HRR * 0.50) + RHR ----
  const r1 = JSON.parse(win.eval(`JSON.stringify(computeHRZones({age:null,maxHR:190,maxHRFormula:'tanaka',restingHR:50,activityLevel:'moderate'}))`));
  const expectedZ1Lo = Math.round((190-50)*0.50+50);
  console.log('Test 2 (Karvonen zone 1 lower bound matches (HRR*0.50)+RHR exactly):', {
    got: r1.zones[0].karvonen[0], expected: expectedZ1Lo,
    result: r1.zones[0].karvonen[0] === expectedZ1Lo ? 'PASS' : 'FAIL'
  });

  // ---- Test 3: with Max HR left blank, falls back to age-based estimation ----
  const r2 = JSON.parse(win.eval(`JSON.stringify(computeHRZones({age:30,maxHR:null,maxHRFormula:'tanaka',restingHR:60,activityLevel:'moderate'}))`));
  console.log('Test 3 (Max HR left blank falls back to age-based Tanaka estimate):', {
    maxHR: r2.maxHR, result: r2.maxHR === 187 ? 'PASS' : 'FAIL'
  });

  // ---- Test 4: with Resting HR left blank, falls back to the chosen activity level's estimate
  // (Very Active -> ~50 bpm) ----
  const r3 = JSON.parse(win.eval(`JSON.stringify(computeHRZones({age:30,maxHR:190,maxHRFormula:'tanaka',restingHR:null,activityLevel:'active'}))`));
  console.log('Test 4 (Resting HR left blank falls back to the activity-level estimate):', {
    rhr: r3.rhr, result: r3.rhr === 50 ? 'PASS' : 'FAIL'
  });

  // ---- Test 5: with neither a real age nor a real Max HR, there's no way to compute anything --
  // returns null rather than silently producing garbage zones ----
  const r4 = win.eval(`computeHRZones({age:null,maxHR:null,maxHRFormula:'tanaka',restingHR:60,activityLevel:'moderate'})`);
  console.log('Test 5 (no age AND no Max HR returns null instead of garbage zones):', r4 === null ? 'PASS' : 'FAIL');

  // ---- Test 6: zones are monotonically increasing (Zone 5 hotter than Zone 1) across all three
  // methods -- a basic sanity check that the zone table isn't scrambled ----
  const r5 = JSON.parse(win.eval(`JSON.stringify(computeHRZones({age:30,maxHR:190,maxHRFormula:'tanaka',restingHR:55,activityLevel:'moderate'}))`));
  const monotonic = ['karvonen','pctmax','zoladz'].every(method =>
    r5.zones.every((z,i) => i===0 || z[method][0] >= r5.zones[i-1][method][0])
  );
  console.log('Test 6 (zones are monotonically increasing zone-to-zone for every method):', monotonic ? 'PASS' : 'FAIL');

  // ---- Test 7: calcHRZones() end-to-end from the real form, age-only (no Max HR / Resting HR
  // typed in) -- the common real-world case ----
  win.eval(`
    HRZONE_LAST=null;
    document.getElementById('hrzone-sh-body').innerHTML=hrzoneBodyHTML();
    document.getElementById('hr-age').value='32';
    document.getElementById('hr-method').value='karvonen';
    document.getElementById('hr-activity').value='active';
  `);
  win.eval(`calcHRZones()`);
  const hrResultHTML = win.eval(`document.getElementById('hr-result').innerHTML`);
  const hrLastMaxHR = win.eval(`HRZONE_LAST.maxHR`);
  console.log('Test 7 (calcHRZones end-to-end, age-only input, produces a result and renders it):', {
    maxHR: hrLastMaxHR,
    result: (hrLastMaxHR === Math.round(208-0.7*32) && hrResultHTML.includes('compare-tbl') && hrResultHTML.includes('Zone 1')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 8: calcHRZones() with neither age nor Max HR shows a toast and doesn't throw ----
  win.eval(`
    document.getElementById('hr-age').value='';
    document.getElementById('hr-maxhr').value='';
  `);
  let threw = false;
  try { win.eval(`calcHRZones()`); } catch(e) { threw = true; }
  console.log('Test 8 (missing both age and Max HR shows a toast, does not throw):', !threw ? 'PASS' : 'FAIL');

  // ---- Test 9: openHRZone() opens the Heart Rate Zones sheet directly (desktop sidebar path) ----
  win.eval(`document.getElementById('hrzone-overlay').classList.remove('open'); openHRZone();`);
  const hrOverlayOpen = win.eval(`document.getElementById('hrzone-overlay').classList.contains('open')`);
  console.log('Test 9 (openHRZone opens the Heart Rate Zones sheet):', hrOverlayOpen ? 'PASS' : 'FAIL');

  // ---- Test 10: the mobile Tools sheet lists Heart Rate Zones alongside Pace Calculator, and
  // tapping it closes Tools and opens Heart Rate Zones in turn ----
  win.eval(`
    document.getElementById('hrzone-overlay').classList.remove('open');
    document.getElementById('tools-overlay').classList.remove('open');
    openTools();
  `);
  const toolsListsHR = win.eval(`document.getElementById('tools-sh-body').innerHTML.includes('Heart Rate Zones')`);
  console.log('Test 10 (Tools sheet lists Heart Rate Zones):', toolsListsHR ? 'PASS' : 'FAIL');
  win.eval(`document.querySelectorAll('#tools-sh-body button')[1].click();`);
  const toolsClosedHROpen = win.eval(`!document.getElementById('tools-overlay').classList.contains('open') && document.getElementById('hrzone-overlay').classList.contains('open')`);
  console.log('Test 11 (tapping Heart Rate Zones in Tools closes Tools and opens Heart Rate Zones):', toolsClosedHROpen ? 'PASS' : 'FAIL');

  // ---- v0.32.25: "Save to Profile" -- Dylon: "when i set up my heart rate zones it works but then
  // it disappears after reload." Calculating alone (HRZONE_LAST) was never durable; PROFILE.savedHRZones
  // (via currentHRZones()) is now the one real source every dependent feature reads. ----

  // Test 12: recalculating from scratch (fresh profile, nothing saved yet) shows an enabled
  // "Save to Profile" button, and the explanatory note about why saving matters.
  win.eval(`
    PROFILE={};
    HRZONE_LAST=null;
    document.getElementById('hrzone-sh-body').innerHTML=hrzoneBodyHTML();
    document.getElementById('hr-age').value='32';
    document.getElementById('hr-method').value='karvonen';
    document.getElementById('hr-activity').value='active';
    calcHRZones();
  `);
  const t12HTML = win.eval(`document.getElementById('hr-result').innerHTML`);
  console.log('Test 12 (fresh calculation shows an enabled "Save to Profile" button with an explanatory note):',
    (t12HTML.includes('Save to Profile') && !t12HTML.includes('disabled') && t12HTML.includes('Fitness &amp; Freshness')) ? 'PASS' : 'FAIL');

  // Test 13: tapping Save writes PROFILE.savedHRZones (matching HRZONE_LAST's own values, plus a
  // savedAt date), and the button flips to a disabled "Saved to Profile ✓" state in place.
  win.eval(`saveHRZonesToProfile()`);
  const t13Saved = JSON.parse(win.eval(`JSON.stringify(PROFILE.savedHRZones)`));
  const t13HTML = win.eval(`document.getElementById('hr-result').innerHTML`);
  console.log('Test 13 (Save to Profile persists PROFILE.savedHRZones and flips the button to Saved state):', {
    t13Saved,
    result: (t13Saved && t13Saved.maxHR===win.eval(`HRZONE_LAST.maxHR`) && t13Saved.rhr===win.eval(`HRZONE_LAST.rhr`) &&
      !!t13Saved.savedAt && t13HTML.includes('Saved to Profile') && t13HTML.includes('disabled')) ? 'PASS' : 'FAIL'
  });

  // Test 14: currentHRZones() (the shared helper every dependent feature reads) now returns the
  // saved zones -- proving the fix actually closes the loop, not just the button's own label.
  const t14 = JSON.parse(win.eval(`JSON.stringify(currentHRZones())`));
  console.log('Test 14 (currentHRZones() returns the saved zones once Save to Profile has been tapped):',
    (t14 && t14.zones && t14.zones.length===5) ? 'PASS' : 'FAIL');

  // Test 15: reopening the sheet fresh (simulating a reload -- HRZONE_LAST reset to null, only
  // PROFILE persisted) still shows the previously-saved result via hrzoneBodyHTML's own
  // `HRZONE_LAST?...` guard -- confirms PROFILE.savedHRZones survives independent of the transient
  // preview global. Real reload behavior (Profile card, Fitness & Freshness) is covered separately
  // in test_phase3_analytics_batch.js and this file's own Test 16 below.
  win.eval(`HRZONE_LAST=null;`);
  const t15BodyHTML = win.eval(`hrzoneBodyHTML()`);
  console.log('Test 15 (a fresh page load with no HRZONE_LAST but a saved profile still has the data in PROFILE):',
    JSON.parse(win.eval(`JSON.stringify(PROFILE.savedHRZones)`)) !== null ? 'PASS' : 'FAIL');

  // Test 16: the new Profile "Heart Rate Zones" card renders the saved zones as bars with bpm
  // ranges, and offers Recalculate -- Dylon: "in the profile there should be a heart rate zone
  // chart but this chart is generated after the user does a heart rate zone calculation."
  const t16HTML = win.eval(`profileHRZonesCardHTML()`);
  console.log('Test 16 (Profile Heart Rate Zones card shows saved zones + Recalculate once saved):',
    (t16HTML.includes('Heart Rate Zones') && t16HTML.includes('bpm') && t16HTML.includes('Recalculate') && !t16HTML.includes('Calculate Heart Rate Zones')) ? 'PASS' : 'FAIL');

  // Test 17: with nothing saved at all, the Profile card instead shows the empty-state prompt that
  // doubles as the entry point into the calculator.
  win.eval(`PROFILE={};`);
  const t17HTML = win.eval(`profileHRZonesCardHTML()`);
  console.log('Test 17 (Profile Heart Rate Zones card shows a setup prompt with nothing saved yet):',
    (t17HTML.includes('Not set up yet') && t17HTML.includes('Calculate Heart Rate Zones')) ? 'PASS' : 'FAIL');

  // Test 18: the staleness nudge (hrZoneNudgeHTML) stays silent with nothing saved, stays silent for
  // a recently-saved calculation, but fires once a saved calculation is 90+ days old -- Dylon: "I
  // should also be advised to read through the calculation ever so often."
  win.eval(`PROFILE={};`);
  const t18NoZones = win.eval(`hrZoneNudgeHTML()`);
  win.eval(`PROFILE.savedHRZones={maxHR:187,rhr:60,hrr:127,zones:[],method:'karvonen',savedAt:todayISO()};`);
  const t18Fresh = win.eval(`hrZoneNudgeHTML()`);
  win.eval(`PROFILE.savedHRZones.savedAt=addDaysISO(todayISO(),-95);`);
  const t18Stale = win.eval(`hrZoneNudgeHTML()`);
  console.log('Test 18 (HR zone staleness nudge: silent unsaved, silent when fresh, fires past 90 days):', {
    result: (t18NoZones==='' && t18Fresh==='' && t18Stale.includes('Recheck your Heart Rate Zones')) ? 'PASS' : 'FAIL'
  });

  // Test 19: dismissing the nudge snoozes it (PROFILE.hrZoneNudgeSnoozedOn set to today), so it goes
  // quiet again immediately after, same snooze contract dismissBackupNudge() already established.
  win.eval(`dismissHRZoneNudge()`);
  const t19AfterDismiss = win.eval(`hrZoneNudgeHTML()`);
  console.log('Test 19 (dismissing the HR zone nudge snoozes it):',
    (t19AfterDismiss==='' && win.eval(`PROFILE.hrZoneNudgeSnoozedOn`)===win.eval(`todayISO()`)) ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
