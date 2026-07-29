// Regression test for v0.32.32's HR-zone pie chart. Dylon: "can we change the heart rate zones in
// profile to an interactive pie chart? i feel like we are littered with bars let's add some
// variety." profileHRZonesCardHTML()'s old stacked-bar list was replaced with a true SVG pie chart
// (hrZonePieSVG/hrZonePieSlices/hrZonePolarPoint) sized by each zone's bpm width under the saved
// method, plus a click-to-select detail panel (selectHRZoneSlice/hrZonePieDetailHTML) and a legend
// list that's a second way to pick a zone. This covers: slice angle math sums to 360 and starts at
// -90deg (12 o'clock, matching progressRingSVG's convention), each slice's sweep is proportional to
// its bpm width, colors map 1:1 with ZONE_TREND_BAR_COLORS (same ramp the old bars used), the detail
// panel's empty/selected states render correctly, selectHRZoneSlice updates the module-level
// selection that survives independent of any single render, and the empty state (no saved zones)
// still shows the original calculator prompt untouched.
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

  // A representative saved zone set (Karvonen method) to exercise the chart against -- distinct,
  // non-uniform bpm widths per zone so proportional-sizing bugs (e.g. accidentally using equal
  // slices) would actually show up as a test failure.
  win.eval(`
    HRZONE_PIE_SELECTED = null;
    PROFILE.savedHRZones = {
      maxHR: 188, rhr: 55, hrr: 133, method: 'karvonen', savedAt: '2026-07-29',
      zones: [
        {key:'z1',label:'Zone 1',name:'Recovery',use:'Warm-ups, cool-downs, active recovery days',
         karvonen:[122,135], pctmax:[94,113], zoladz:[128,138]},
        {key:'z2',label:'Zone 2',name:'Aerobic / Endurance',use:'Easy/base mileage — most of your weekly running belongs here',
         karvonen:[135,148], pctmax:[113,132], zoladz:[138,148]},
        {key:'z3',label:'Zone 3',name:'Tempo',use:'Tempo runs, marathon-pace efforts',
         karvonen:[148,161], pctmax:[132,150], zoladz:[148,158]},
        {key:'z4',label:'Zone 4',name:'Threshold',use:'Intervals, hill repeats, 10K-pace work',
         karvonen:[161,175], pctmax:[150,169], zoladz:[158,168]},
        {key:'z5',label:'Zone 5',name:'Maximum',use:'Sprints, VO2 max work, race finishes',
         karvonen:[175,188], pctmax:[169,188], zoladz:[168,188]}
      ]
    };
  `);

  // ---- Test 1: hrZonePieSlices' angle math -- 5 slices, sweeps sum to 360, first slice starts at
  // -90deg (12 o'clock, same convention progressRingSVG already uses for "progress" visuals) ----
  const slices1 = JSON.parse(win.eval(`JSON.stringify(hrZonePieSlices(PROFILE.savedHRZones.zones,'karvonen'))`));
  const sweepSum = slices1.reduce((a,s)=>a+s.sweepDeg,0);
  console.log('Test 1 (5 slices, sweeps sum to 360deg, first starts at -90deg):', {
    count: slices1.length, sweepSum: Math.round(sweepSum*100)/100, firstStart: slices1[0].startAngle,
    result: (slices1.length===5 && Math.abs(sweepSum-360)<0.01 && slices1[0].startAngle===-90) ? 'PASS' : 'FAIL'
  });

  // ---- Test 2: each slice's sweep is proportional to its own bpm width (hi-lo under the given
  // method), not equal-sized wedges -- widths here are 13,13,13,14,13 so sweeps should differ ----
  const loBounds = [122,135,148,161,175];
  const hiBounds = [135,148,161,175,188];
  const widths = loBounds.map((lo,i)=>hiBounds[i]-lo);
  const totalW = widths.reduce((a,b)=>a+b,0);
  const expectedSweeps = widths.map(w => (w/totalW)*360);
  const sweepsMatch = slices1.every((s,i) => Math.abs(s.sweepDeg - expectedSweeps[i]) < 0.05);
  console.log('Test 2 (each slice sweep proportional to its own bpm width):', {
    actual: slices1.map(s=>Math.round(s.sweepDeg*100)/100),
    expected: expectedSweeps.map(w=>Math.round(w*100)/100),
    result: sweepsMatch ? 'PASS' : 'FAIL'
  });

  // ---- Test 3: hrZonePieSVG renders one <path class="hrzone-slice"> per zone, each colored with
  // the same ZONE_TREND_BAR_COLORS entry (by index) the old bars used, so the palette didn't change
  // even though the shape did ----
  const svg = win.eval(`hrZonePieSVG(PROFILE.savedHRZones)`);
  const pathMatches = [...svg.matchAll(/<path class="hrzone-slice[^"]*" data-idx="(\d)" d="[^"]+" fill="var\((--\w+)\)"/g)];
  const expectedColors = win.eval(`JSON.stringify(ZONE_TREND_BAR_COLORS.slice(0,5))`);
  const expectedColorsArr = JSON.parse(expectedColors);
  const colorsMatch = pathMatches.length===5 && pathMatches.every((m,i)=> m[1]===String(i) && m[2]===expectedColorsArr[i]);
  console.log('Test 3 (5 slice paths, colored 1:1 with ZONE_TREND_BAR_COLORS by index):', {
    found: pathMatches.map(m=>[m[1],m[2]]), expected: expectedColorsArr,
    result: colorsMatch ? 'PASS' : 'FAIL'
  });

  // ---- Test 4: detail panel with no selection shows the "tap a zone" prompt, not a specific zone's
  // data ----
  const emptyDetail = win.eval(`hrZonePieDetailHTML(PROFILE.savedHRZones, null)`);
  console.log('Test 4 (no-selection detail panel shows the tap-a-zone prompt):',
    /Tap a zone/i.test(emptyDetail) ? 'PASS' : 'FAIL', { emptyDetail });

  // ---- Test 5: detail panel for a specific zone (e.g. index 3, Threshold) shows its name, bpm
  // range, and best-for text ----
  const z3Detail = win.eval(`hrZonePieDetailHTML(PROFILE.savedHRZones, 3)`);
  console.log('Test 5 (selected-zone detail panel shows name/range/best-for for index 3):', {
    hasName: /Threshold/.test(z3Detail), hasRange: /161–175/.test(z3Detail), hasUse: /hill repeats/.test(z3Detail),
    result: (/Threshold/.test(z3Detail) && /161–175/.test(z3Detail) && /hill repeats/.test(z3Detail)) ? 'PASS' : 'FAIL'
  });

  // ---- Test 6: selectHRZoneSlice updates the module-level HRZONE_PIE_SELECTED, and a subsequent
  // profileHRZonesCardHTML() render reflects that selection (selected slice/legend row marked) ----
  win.eval(`selectHRZoneSlice(2)`);
  const selectedAfter = win.eval(`HRZONE_PIE_SELECTED`);
  const cardAfterSelect = win.eval(`profileHRZonesCardHTML()`);
  console.log('Test 6 (selectHRZoneSlice(2) persists and the next card render reflects it):', {
    selectedAfter,
    hasSelectedSliceClass: /hrzone-slice selected" data-idx="2"/.test(cardAfterSelect),
    hasSelectedLegendClass: /hrzone-legend-item selected/.test(cardAfterSelect),
    result: (selectedAfter===2 && /hrzone-slice selected" data-idx="2"/.test(cardAfterSelect) && /hrzone-legend-item selected/.test(cardAfterSelect)) ? 'PASS' : 'FAIL'
  });

  // ---- Test 7: empty state (no saved zones at all) is untouched -- still shows the calculator
  // prompt and button, no pie/legend markup ----
  win.eval(`HRZONE_PIE_SELECTED=null; PROFILE.savedHRZones=null;`);
  const emptyCard = win.eval(`profileHRZonesCardHTML()`);
  console.log('Test 7 (no saved zones -> original empty-state prompt, no pie markup):', {
    hasPrompt: /Not set up yet/.test(emptyCard), hasButton: /Calculate Heart Rate Zones/.test(emptyCard), hasPie: /hrzone-pie/.test(emptyCard),
    result: (/Not set up yet/.test(emptyCard) && /Calculate Heart Rate Zones/.test(emptyCard) && !/hrzone-pie/.test(emptyCard)) ? 'PASS' : 'FAIL'
  });

  await wait(200);
  win.close();
})();
