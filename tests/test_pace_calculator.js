// Regression test for the new Pace Calculator feature (Dylon: "a pace calculator... combine the
// structor from yearroundrunning with stravas race calculator"). Two modes in one sheet:
// - Race Splits: distance + goal time + strategy -> a km-by-km pacing plan (yearroundrunning-style).
// - Pace <-> Time: a pace -> finish times across common distances (Strava-style).
// Desktop entry point: a dedicated sidebar button (openPaceCalc). Mobile entry point: a new "Tools"
// topbar icon (openTools) opening a small menu that currently lists just Pace Calculator.
// Paces are always per-km regardless of the km/mi display-unit setting, matching the app-wide
// convention already established by secToPaceStr elsewhere.
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

  // ---- Test 1: a flat-strategy split has every segment at exactly the average pace ----
  const flat = JSON.parse(win.eval(`JSON.stringify(computeRaceSplits(5, 24*60, 'flat'))`));
  const flatAllAvg = flat.segments.every(s => Math.abs(s.paceSec - flat.avgPaceSec) < 0.001);
  console.log('Test 1 (flat strategy: every segment sits at the average pace):', flatAllAvg ? 'PASS' : 'FAIL');

  // ---- Test 2: first half + second half always sum exactly to the goal time, for every strategy
  // (this is the whole point of the equal-zones/equal-and-opposite-offset design -- no separate
  // rescaling step should ever be needed) ----
  ['flat','negative','aggressive'].forEach(strat => {
    const r = JSON.parse(win.eval(`JSON.stringify(computeRaceSplits(10, 50*60, '${strat}'))`));
    const sumMatches = Math.abs((r.firstHalfSec + r.secondHalfSec) - r.goalSec) < 0.01;
    console.log(`Test 2 (${strat}: first half + second half == goal time exactly):`, sumMatches ? 'PASS' : 'FAIL', {firstHalfSec:r.firstHalfSec, secondHalfSec:r.secondHalfSec, goalSec:r.goalSec});
  });

  // ---- Test 3: negative/aggressive strategies actually produce a negative split -- first half
  // slower (more time) than second half, aggressive more pronounced than negative ----
  const neg = JSON.parse(win.eval(`JSON.stringify(computeRaceSplits(10, 50*60, 'negative'))`));
  const agg = JSON.parse(win.eval(`JSON.stringify(computeRaceSplits(10, 50*60, 'aggressive'))`));
  const negIsNegativeSplit = neg.firstHalfSec > neg.secondHalfSec;
  const aggMoreExtreme = (agg.firstHalfSec - agg.secondHalfSec) > (neg.firstHalfSec - neg.secondHalfSec);
  console.log('Test 3 (negative strategy: first half slower than second half):', negIsNegativeSplit ? 'PASS' : 'FAIL');
  console.log('Test 4 (aggressive strategy spreads first/second half further apart than negative):', aggMoreExtreme ? 'PASS' : 'FAIL');

  // ---- Test 5: a distance with a fractional remainder (10.5km) gets whole-km segments plus one
  // final partial segment ending near the goal time. The per-segment table assigns each segment's
  // pace by its midpoint, so it's a close approximation rather than an exact split (same rounding
  // trade-off real pace calculators make) -- the *exact* guarantee is on the continuous first/second
  // half figures (Test 2), not the discrete table, so this only checks the table is close (within
  // 1% of goal time), not exact. ----
  const frac = JSON.parse(win.eval(`JSON.stringify(computeRaceSplits(10.5, 60*60, 'negative'))`));
  const lastSeg = frac.segments[frac.segments.length - 1];
  const closeToGoal = Math.abs(lastSeg.cumSec - frac.goalSec) < frac.goalSec * 0.01;
  console.log('Test 5 (10.5km splits into 10 whole-km segments + 1 final partial, ending close to goal time):', {
    segCount: frac.segments.length, lastLabel: lastSeg.label, cumSec: lastSeg.cumSec, goalSec: frac.goalSec,
    result: (frac.segments.length === 11 && closeToGoal) ? 'PASS' : 'FAIL'
  });

  // ---- Test 5b: a distance that divides evenly into thirds (9km, i.e. 3km per zone) has NO
  // discretization slop -- the discrete segment table's cumulative total matches the goal time
  // exactly, confirming the equal-zones/equal-and-opposite-offset design really does what it claims
  // whenever the km boundaries line up with the zone boundaries ----
  const clean = JSON.parse(win.eval(`JSON.stringify(computeRaceSplits(9, 45*60, 'negative'))`));
  const cleanLastSeg = clean.segments[clean.segments.length - 1];
  console.log('Test 5b (9km divides evenly into thirds: discrete table total matches goal time exactly):', {
    cumSec: cleanLastSeg.cumSec, goalSec: clean.goalSec,
    result: Math.abs(cleanLastSeg.cumSec - clean.goalSec) < 0.01 ? 'PASS' : 'FAIL'
  });

  // ---- Test 6: calcRaceSplits() end-to-end from the actual form fields, using a named distance ----
  win.eval(`
    PACECALC_LAST_SPLITS=null;
    document.getElementById('pacecalc-sh-body').innerHTML=pacecalcBodyHTML();
    document.getElementById('pc-distance').value='Marathon';
    document.getElementById('pc-goal-time').value='3:45:00';
    document.getElementById('pc-strategy').value='negative';
  `);
  win.eval(`calcRaceSplits()`);
  const marathonResult = JSON.parse(win.eval(`JSON.stringify(PACECALC_LAST_SPLITS)`));
  const resultHTML = win.eval(`document.getElementById('pc-splits-result').innerHTML`);
  console.log('Test 6 (calcRaceSplits end-to-end: Marathon + 3:45:00 goal produces a result and renders it):', {
    km: marathonResult && marathonResult.km, goalSec: marathonResult && marathonResult.goalSec,
    result: (marathonResult && marathonResult.km === 42.195 && marathonResult.goalSec === 3*3600+45*60 && resultHTML.includes('compare-tbl')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 7: custom distance, respecting the km/mi display-unit setting via displayToKm ----
  win.eval(`
    PROFILE.distUnit='mi';
    document.getElementById('pc-distance').value='custom';
    document.getElementById('pc-custom-row').style.display='';
    document.getElementById('pc-custom-dist').value='5';
    document.getElementById('pc-goal-time').value='40:00';
  `);
  win.eval(`calcRaceSplits()`);
  const customKm = win.eval(`PACECALC_LAST_SPLITS.km`);
  console.log('Test 7 (custom distance in mi is converted to km via displayToKm):', {
    customKm, result: Math.abs(customKm - 8.04672) < 0.001 ? 'PASS' : 'FAIL'
  });
  win.eval(`PROFILE.distUnit='km';`);

  // ---- Test 8: pcDistanceChanged() shows the custom-distance field only when Custom is selected ----
  win.eval(`
    document.getElementById('pacecalc-sh-body').innerHTML=pacecalcBodyHTML();
    document.getElementById('pc-distance').value='5K';
    pcDistanceChanged();
  `);
  const hiddenForNamed = win.eval(`document.getElementById('pc-custom-row').style.display`);
  win.eval(`document.getElementById('pc-distance').value='custom'; pcDistanceChanged();`);
  const shownForCustom = win.eval(`document.getElementById('pc-custom-row').style.display`);
  console.log('Test 8 (custom-distance field only shows when "Custom distance" is selected):', {
    hiddenForNamed, shownForCustom, result: (hiddenForNamed==='none' && shownForCustom==='') ? 'PASS' : 'FAIL'
  });

  // ---- Test 9: calcPaceConvert() end-to-end -- a pace produces correct finish times across the
  // curated distance set (5:00/km over 10K should be exactly 50:00) ----
  win.eval(`
    document.getElementById('pacecalc-sh-body').innerHTML=pacecalcConvertTabHTML();
    document.getElementById('pc-pace').value='5:00';
  `);
  win.eval(`calcPaceConvert()`);
  const convertHTML = win.eval(`document.getElementById('pc-convert-result').innerHTML`);
  console.log('Test 9 (calcPaceConvert end-to-end: 5:00/km produces a 50:00 10K finish time):', {
    result: (convertHTML.includes('50:00') && convertHTML.includes('25:00') && convertHTML.includes('10K')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 9b: the Pace <-> Time tab also accepts an optional custom distance, inserted into the
  // results table in sorted order rather than just tacked on at the end ----
  win.eval(`
    PROFILE.distUnit='km';
    document.getElementById('pacecalc-sh-body').innerHTML=pacecalcConvertTabHTML();
    document.getElementById('pc-pace').value='5:00';
    document.getElementById('pc-convert-custom-dist').value='8';
  `);
  win.eval(`calcPaceConvert()`);
  const convertCustomHTML = win.eval(`document.getElementById('pc-convert-result').innerHTML`);
  const convertCustomKm = win.eval(`PACECALC_LAST_CONVERT.customKm`);
  console.log('Test 9b (Pace <-> Time: an optional custom distance produces an extra 40:00 row for 8km):', {
    customKm: convertCustomKm,
    result: (Math.abs(convertCustomKm - 8) < 0.001 && convertCustomHTML.includes('40:00') && convertCustomHTML.includes('Custom')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 9c: leaving the custom-distance field blank behaves exactly as before (no crash, no
  // extra row, customKm stays null) ----
  win.eval(`
    document.getElementById('pc-convert-custom-dist').value='';
  `);
  win.eval(`calcPaceConvert()`);
  const convertNoCustomKm = win.eval(`PACECALC_LAST_CONVERT.customKm`);
  console.log('Test 9c (Pace <-> Time: blank custom distance field leaves customKm null, no extra row):', {
    result: convertNoCustomKm === null ? 'PASS' : 'FAIL'
  });

  // ---- Test 10: switching between the Race Splits and Pace<->Time tabs preserves each tab's last
  // computed result instead of losing it ----
  const splitsTabHTML = win.eval(`switchPaceCalcTab('splits'); document.getElementById('pacecalc-sh-body').innerHTML`);
  console.log('Test 10 (switching back to Race Splits tab keeps the last computed Marathon result):', {
    result: splitsTabHTML.includes('compare-tbl') ? 'PASS' : 'FAIL'
  });

  // ---- Test 11: openPaceCalc() opens the pacecalc-overlay directly (the desktop sidebar path) ----
  win.eval(`document.getElementById('pacecalc-overlay').classList.remove('open'); openPaceCalc();`);
  const pacecalcOpen = win.eval(`document.getElementById('pacecalc-overlay').classList.contains('open')`);
  console.log('Test 11 (openPaceCalc opens the Pace Calculator sheet):', pacecalcOpen ? 'PASS' : 'FAIL');

  // ---- Test 12: openTools() opens the mobile Tools menu, and its Pace Calculator row closes Tools
  // and opens Pace Calculator in turn ----
  win.eval(`
    document.getElementById('pacecalc-overlay').classList.remove('open');
    document.getElementById('tools-overlay').classList.remove('open');
    openTools();
  `);
  const toolsOpenedAndListsPaceCalc = win.eval(`document.getElementById('tools-overlay').classList.contains('open') && document.getElementById('tools-sh-body').innerHTML.includes('Pace Calculator')`);
  console.log('Test 12 (openTools opens the Tools sheet listing Pace Calculator):', toolsOpenedAndListsPaceCalc ? 'PASS' : 'FAIL');
  win.eval(`document.querySelector('#tools-sh-body button').click();`);
  const toolsClosedPaceCalcOpen = win.eval(`!document.getElementById('tools-overlay').classList.contains('open') && document.getElementById('pacecalc-overlay').classList.contains('open')`);
  console.log('Test 13 (tapping Pace Calculator in the Tools sheet closes Tools and opens Pace Calculator):', toolsClosedPaceCalcOpen ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
