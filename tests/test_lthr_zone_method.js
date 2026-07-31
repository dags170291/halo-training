// Regression test for adding Joe Friel's LTHR (Lactate Threshold Heart Rate) method as a 4th option
// in the Heart Rate Zone Calculator. Dylon asked for it directly after a discussion of why Karvonen
// was recommended among the original three (Karvonen/%Max HR/Zoladz): "i will like to add Joe Friel
// Lactate Threshold (LTHR) method as one of the heart rate testing methods... do u advise it?" ->
// "yes add this method please." Unlike the other three (all anchored to an age-estimated or
// directly-entered Max HR), LTHR is a directly MEASURED value with no age-based fallback at all, so
// Age/Max HR stay required regardless of the selected method (other features read hz.maxHR/hz.rhr
// directly and shouldn't silently break for someone who's only entered an LTHR) -- LTHR is layered on
// as an additional optional input that unlocks the 4th method and comparison-table column.
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

  // ---- Test 1: with a clean-math LTHR of 200 bpm, each zone's lo is Friel's own real published
  // percentage of LTHR (Z1 <85%, Z2 85%, Z3 90%, Z4 95%, Z5 100% -- Zone 5's lo lands exactly on the
  // measured LTHR itself, matching Friel's own "Zone 5 begins at 100% of LTHR" definition), and every
  // zone is perfectly contiguous with no gap or overlap -- see lthrZoneBounds()'s own comment for why
  // independently rounding Friel's non-touching zone-to-zone percentages (a real 1% gap in his own
  // published table between Z2/Z3, Z3/Z4, Z4/Z5) used to skip an integer bpm between zones. ----
  const r1 = JSON.parse(win.eval(`JSON.stringify(computeHRZones({age:32,maxHR:null,maxHRFormula:'tanaka',restingHR:60,activityLevel:'moderate',lthr:200}))`));
  const expectedLthrBands = [[0,169],[170,179],[180,189],[190,199],[200,230]];
  const bandsMatch = r1.zones.every((z,i) => z.lthr[0]===expectedLthrBands[i][0] && z.lthr[1]===expectedLthrBands[i][1]);
  console.log('Test 1 (LTHR=200 produces contiguous zones anchored to Friel\'s real percentages, Zone 5 lo = LTHR itself):',
    bandsMatch ? 'PASS' : 'FAIL', { gotBands: r1.zones.map(z=>z.lthr), expectedLthrBands });

  // ---- Test 1b: no gaps or overlaps for an arbitrary, non-clean-math LTHR too -- the exact case
  // Dylon/Gemini caught (LTHR=186 left 176 unclassified between Zone 3 and Zone 4 in the original
  // independent-rounding version). Every zone's lo must be exactly the previous zone's hi + 1. ----
  const r1b = JSON.parse(win.eval(`JSON.stringify(computeHRZones({age:32,maxHR:null,maxHRFormula:'tanaka',restingHR:60,activityLevel:'moderate',lthr:186}))`));
  const contiguous186 = r1b.zones.every((z,i) => i===0 || z.lthr[0] === r1b.zones[i-1].lthr[1]+1);
  const zone5AnchoredToLthr = r1b.zones[4].lthr[0] === 186;
  console.log('Test 1b (LTHR=186, the exact value that surfaced the gap, is now perfectly contiguous with Zone 5 anchored at 186):',
    (contiguous186 && zone5AnchoredToLthr) ? 'PASS' : 'FAIL', { gotBands186: r1b.zones.map(z=>z.lthr) });

  // ---- Test 2: with no LTHR entered at all, every zone's `lthr` field is null -- the other three
  // methods (karvonen/pctmax/zoladz) stay populated exactly as before, completely unaffected ----
  const r2 = JSON.parse(win.eval(`JSON.stringify(computeHRZones({age:32,maxHR:null,maxHRFormula:'tanaka',restingHR:60,activityLevel:'moderate'}))`));
  const allLthrNull = r2.zones.every(z => z.lthr === null);
  const othersStillWork = r2.zones[0].karvonen.length===2 && r2.zones[0].pctmax.length===2 && r2.zones[0].zoladz.length===2;
  console.log('Test 2 (with no LTHR entered, every zone\'s lthr field is null, other methods unaffected):',
    (allLthrNull && othersStillWork && r2.lthr===null) ? 'PASS' : 'FAIL');

  // ---- Test 3: zones are monotonically increasing zone-to-zone for the lthr method too (same
  // sanity check test_hr_zone_calculator.js's Test 6 already runs for the other three) ----
  const monotonic = r1.zones.every((z,i) => i===0 || z.lthr[0] >= r1.zones[i-1].lthr[0]);
  console.log('Test 3 (LTHR zones are monotonically increasing zone-to-zone):', monotonic ? 'PASS' : 'FAIL');

  // ---- Test 4: calcHRZones() end-to-end -- selecting the LTHR method WITHOUT filling in the LTHR
  // field shows a toast and does not throw or silently proceed (there's no age-based fallback to use
  // instead, unlike the other three methods) ----
  win.eval(`
    HRZONE_LAST=null;
    document.getElementById('hrzone-sh-body').innerHTML=hrzoneBodyHTML();
    document.getElementById('hr-age').value='32';
    document.getElementById('hr-method').value='lthr';
    document.getElementById('hr-lthr').value='';
  `);
  let t4Threw=false;
  try { win.eval(`calcHRZones()`); } catch(e){ t4Threw=true; }
  const t4Blocked = win.eval(`HRZONE_LAST`) === null;
  console.log('Test 4 (selecting LTHR without filling in the bpm field is blocked with a toast, not a crash):',
    (!t4Threw && t4Blocked) ? 'PASS' : 'FAIL', { t4Threw, t4Blocked });

  // ---- Test 5: calcHRZones() end-to-end with LTHR filled in -- produces a real result, method is
  // 'lthr', and the rendered "Your Training Zones" table shows the LTHR-based bpm range (not the
  // Karvonen one) for a zone ----
  win.eval(`
    document.getElementById('hr-lthr').value='200';
  `);
  win.eval(`calcHRZones()`);
  const t5Method = win.eval(`HRZONE_LAST.method`);
  const t5Lthr = win.eval(`HRZONE_LAST.lthr`);
  const t5HTML = win.eval(`document.getElementById('hr-result').innerHTML`);
  console.log('Test 5 (calcHRZones with LTHR filled in produces a real lthr-method result and renders its own bpm ranges):',
    (t5Method==='lthr' && t5Lthr===200 && t5HTML.includes('170–179 bpm')) ? 'PASS' : 'FAIL',
    { t5Method, t5Lthr });

  // ---- Test 6: the "Compare All Methods" table gets a 4th LTHR column, showing real ranges when
  // LTHR was entered ----
  const t6HasColumn = /<th>LTHR<\/th>/.test(t5HTML);
  const t6HasRealRange = /170–179/.test(t5HTML);
  console.log('Test 6 (the comparison table shows an LTHR column with real ranges once entered):',
    (t6HasColumn && t6HasRealRange) ? 'PASS' : 'FAIL');

  // ---- Test 7: switching back to Karvonen with nothing in the LTHR field (a fresh calculation)
  // shows "—" in the LTHR comparison column, rather than a stale or broken value ----
  win.eval(`
    document.getElementById('hr-method').value='karvonen';
    document.getElementById('hr-lthr').value='';
  `);
  win.eval(`calcHRZones()`);
  const t7HTML = win.eval(`document.getElementById('hr-result').innerHTML`);
  const t7ShowsDash = /<td>—<\/td>/.test(t7HTML);
  console.log('Test 7 (with no LTHR entered, the comparison table shows a dash instead of a broken value):',
    t7ShowsDash ? 'PASS' : 'FAIL');

  // ---- Test 8: the stat-grid shows an "LTHR (bpm)" card only when a real LTHR value is present ----
  const t8AbsentWithoutLthr = !t7HTML.includes('LTHR (bpm)');
  win.eval(`
    document.getElementById('hr-lthr').value='200';
  `);
  win.eval(`calcHRZones()`);
  const t8HTML = win.eval(`document.getElementById('hr-result').innerHTML`);
  const t8PresentWithLthr = t8HTML.includes('LTHR (bpm)');
  console.log('Test 8 (the LTHR stat card only shows once a real LTHR value is present):',
    (t8AbsentWithoutLthr && t8PresentWithLthr) ? 'PASS' : 'FAIL');

  // ---- Test 8b: the main "Your Training Zones" table shows "Rest" for Zone 1's floor and "Max" for
  // Zone 5's ceiling -- not a fabricated number (the 115%-of-LTHR ceiling, e.g. 230 for this LTHR=200
  // fixture, purely a rounding convenience for lthrZoneBounds() -- never meant to be shown as a real
  // physiological cap). Dylon: "instead of hard capping the max to a number just use 'max' as my max
  // is not 214 but 196." ----
  const t8bHasRest = /Rest–\d/.test(t8HTML);
  const t8bHasMax = /\d–Max bpm/.test(t8HTML);
  const t8bNoFabricatedCeiling = !/–230 bpm/.test(t8HTML);
  console.log('Test 8b (the main zone table shows Rest/Max at the open ends, not a fabricated LTHR ceiling number):',
    (t8bHasRest && t8bHasMax && t8bNoFabricatedCeiling) ? 'PASS' : 'FAIL', { t8bHasRest, t8bHasMax, t8bNoFabricatedCeiling });

  // ---- Test 8c: the "Compare All Methods" table applies the same Rest/Max treatment to EVERY
  // method's column (not just LTHR) for consistency -- Karvonen's own Zone 5 ceiling (a real maxHR
  // value, unlike LTHR's fabricated one) also reads "Max" rather than a raw number here. ----
  const t8cLthrShowsMax = /<td>Rest–\d+<\/td><td>Rest–\d+<\/td><td>Rest–\d+<\/td><td>Rest–\d+<\/td>/.test(t8HTML);
  const t8cLastRowShowsMax = (t8HTML.match(/<td>\d+–Max<\/td>/g)||[]).length >= 3;
  console.log('Test 8c (the comparison table shows Rest/Max consistently across all four method columns):',
    (t8cLthrShowsMax && t8cLastRowShowsMax) ? 'PASS' : 'FAIL', { t8cLthrShowsMax, t8cLastRowShowsMax });

  // ---- Test 9: saving to profile with method='lthr' persists correctly, and currentHRZones()'s
  // saved zones read back out through the shared z[method] pattern every other consumer
  // (profileHRZonesCardHTML, activityHRZoneChipRowHTML, zoneTrendRangeLabel) already uses ----
  win.eval(`
    document.getElementById('hr-method').value='lthr';
    document.getElementById('hr-lthr').value='200';
    calcHRZones();
    saveHRZonesToProfile();
  `);
  const t9Saved = JSON.parse(win.eval(`JSON.stringify(PROFILE.savedHRZones)`));
  const t9ProfileCardHTML = win.eval(`profileHRZonesCardHTML()`);
  console.log('Test 9 (saving with LTHR persists correctly and Profile\'s zone list reads the real lthr-based bpm ranges):',
    (t9Saved && t9Saved.method==='lthr' && t9Saved.lthr===200 && t9ProfileCardHTML.includes('170') && t9ProfileCardHTML.includes('Recovery')) ? 'PASS' : 'FAIL',
    { t9Saved });

  // ---- Test 10: changing the LTHR value (same method) correctly shows as unsaved, rather than a
  // stale "Saved to Profile" carried over from the previous LTHR value ----
  win.eval(`
    document.getElementById('hr-lthr').value='205';
    calcHRZones();
  `);
  const t10HTML = win.eval(`document.getElementById('hr-result').innerHTML`);
  const t10ShowsUnsaved = t10HTML.includes('Save to Profile') && !t10HTML.includes('Saved to Profile');
  console.log('Test 10 (changing the LTHR value while method stays lthr correctly shows as unsaved, not stale-saved):',
    t10ShowsUnsaved ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
