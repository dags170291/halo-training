// Regression test for HALO's HR-zone donut chart -- this file's name is a holdover from when the
// chart lived on Profile (v0.32.32: bars -> pie; v0.32.33: pie -> Strava-style donut), but Dylon
// then moved it to the per-activity zone breakdown instead: "ok i messed up the new chart u created
// in profile I would like to use that instead for heart rate zones measured within activities in
// the profile lets use this new version since the zones in the profile stay stagnant and the one in
// the activities are more catered for a pie chart feature." Right call -- Profile's zones are a
// static bpm-range reference with no real duration to put in a donut's center; activityHRZoneBreakdown()
// has genuine time-in-zone seconds/percentages per activity, exactly what a Strava-style donut needs.
// Profile itself reverted to a plain list -- see test_profile_hrzone_list.js for that coverage.
//
// This file now covers the relocated chart: activityHRZonePieSlices (angle math, weighted by
// per-zone seconds instead of bpm width), activityHRZoneDonutSVG (donut sectors, skipping
// zero-second zones entirely rather than drawing degenerate slivers), activityHRZoneDonutOverlayHTML
// (center readout showing a real %/duration, plus the floating callout), activityHRZoneChipRowHTML
// (the static bpm-range legend row, sourced from currentHRZones() rather than the activity itself),
// activityHRZoneCaptionHTML, and selectActivityHRZoneSlice's per-activity-keyed selection state.
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

  // Saved profile zones (bpm ranges) -- used by the chip-row legend, distinct on purpose from the
  // activity's own time-in-zone numbers below, so a test bug conflating the two data sources would
  // actually show up as a failure.
  win.eval(`
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

  // A representative activityHRZoneBreakdown() result -- distinct, non-uniform seconds per zone
  // (including one zone with ZERO time, since that's the whole point of the "skip zero-sec zones"
  // behavior being tested), matching that function's real return shape ({label,name,sec,pct}).
  win.eval(`
    __actZones = [
      {label:'Zone 1', name:'Recovery', sec:60, pct:5},
      {label:'Zone 2', name:'Aerobic / Endurance', sec:300, pct:25},
      {label:'Zone 3', name:'Tempo', sec:600, pct:50},
      {label:'Zone 4', name:'Threshold', sec:240, pct:20},
      {label:'Zone 5', name:'Maximum', sec:0, pct:0}
    ];
    ACTIVITIES.push({id:'test-act-1', type:'run', stream:{t:[],hr:[]}});
    ACT_HRZONE_SELECTED = {};
  `);

  // ---- Test 1: activityHRZonePieSlices' angle math is weighted by seconds (not bpm width) -- 5
  // entries returned (including the zero-sec zone, with a zero sweep), non-zero sweeps sum to 360,
  // starting at -90deg ----
  const slices1 = JSON.parse(win.eval(`JSON.stringify(activityHRZonePieSlices(__actZones))`));
  const sweepSum = slices1.reduce((a,s)=>a+s.sweepDeg,0);
  console.log('Test 1 (5 slices incl. the zero-sec zone, sweeps sum to 360deg, first starts at -90deg):', {
    count: slices1.length, sweepSum: Math.round(sweepSum*100)/100, firstStart: slices1[0].startAngle, zone5Sweep: slices1[4].sweepDeg,
    result: (slices1.length===5 && Math.abs(sweepSum-360)<0.01 && slices1[0].startAngle===-90 && slices1[4].sweepDeg===0) ? 'PASS' : 'FAIL'
  });

  // ---- Test 2: each non-zero slice's sweep is proportional to its own seconds (600/300/240/60 out
  // of 1200 total), not equal-sized wedges ----
  const secs = [60,300,600,240,0];
  const total = secs.reduce((a,b)=>a+b,0);
  const expectedSweeps = secs.map(s => (s/total)*360);
  const sweepsMatch = slices1.every((s,i) => Math.abs(s.sweepDeg - expectedSweeps[i]) < 0.05);
  console.log('Test 2 (each slice sweep proportional to its own time-in-zone seconds):', {
    actual: slices1.map(s=>Math.round(s.sweepDeg*100)/100), expected: expectedSweeps.map(w=>Math.round(w*100)/100),
    result: sweepsMatch ? 'PASS' : 'FAIL'
  });

  // ---- Test 3: activityHRZoneDonutSVG renders exactly 4 wedges (skipping Zone 5's zero-second
  // slice entirely -- no degenerate zero-width path), colored 1:1 with ZONE_TREND_BAR_COLORS by
  // index, each onclick wired to selectActivityHRZoneSlice with this activity's own id ----
  const svg = win.eval(`activityHRZoneDonutSVG(__actZones, 'sess-', 'test-act-1', null)`);
  const pathMatches = [...svg.matchAll(/<path class="hrzone-slice[^"]*" data-idx="(\d)" d="([^"]+)" fill="var\((--\w+)\)"[^>]*onclick="selectActivityHRZoneSlice\('sess-','test-act-1',(\d)\)"/g)];
  const expectedColors = JSON.parse(win.eval(`JSON.stringify(ZONE_TREND_BAR_COLORS.slice(0,5))`));
  console.log('Test 3 (4 wedges rendered -- zero-sec Zone 5 skipped -- correctly colored and wired to this activity):', {
    wedgeCount: pathMatches.length,
    indices: pathMatches.map(m=>m[1]),
    colorsOk: pathMatches.every(m => expectedColors[Number(m[1])]===m[3]),
    result: (pathMatches.length===4 && pathMatches.every(m => expectedColors[Number(m[1])]===m[3] && m[1]===m[4])) ? 'PASS' : 'FAIL'
  });

  // ---- Test 4: with no selection, the overlay shows a neutral center prompt and no callout ----
  const emptyOverlay = win.eval(`activityHRZoneDonutOverlayHTML(__actZones, null)`);
  console.log('Test 4 (no-selection overlay: neutral prompt, no callout):', {
    hasPrompt: /Tap a zone/i.test(emptyOverlay), hasCallout: /hrzone-callout/.test(emptyOverlay),
    result: (/Tap a zone/i.test(emptyOverlay) && !/hrzone-callout/.test(emptyOverlay)) ? 'PASS' : 'FAIL'
  });

  // ---- Test 5: selecting Zone 3 (index 2, 600s/50%) shows the real pct + duration in the center
  // readout, and a callout with the zone name + duration (Strava's own "Tempo 41:11"-style format) ----
  const z2Overlay = win.eval(`activityHRZoneDonutOverlayHTML(__actZones, 2)`);
  console.log('Test 5 (selected zone shows real pct/duration in center + callout, not a bpm range):', {
    hasPct: /50%/.test(z2Overlay), hasDuration: /10:00/.test(z2Overlay), hasCalloutName: /hrzone-callout/.test(z2Overlay) && /Tempo/.test(z2Overlay),
    result: (/50%/.test(z2Overlay) && /10:00/.test(z2Overlay) && /hrzone-callout/.test(z2Overlay) && /Tempo/.test(z2Overlay)) ? 'PASS' : 'FAIL'
  });

  // ---- Test 6: the chip row shows each zone's STATIC bpm range from currentHRZones() (not
  // anything derived from the activity's own seconds/pct), and marks the selected index ----
  const chips = win.eval(`activityHRZoneChipRowHTML(__actZones, 'sess-', 'test-act-1', 2)`);
  console.log('Test 6 (chip row shows static bpm ranges from currentHRZones(), selected index marked):', {
    hasRange2: /148-161/.test(chips), chipCount: (chips.match(/class="hrzone-chip/g)||[]).length, selectedCount: (chips.match(/class="hrzone-chip selected"/g)||[]).length,
    result: (/148-161/.test(chips) && (chips.match(/class="hrzone-chip/g)||[]).length===5 && (chips.match(/class="hrzone-chip selected"/g)||[]).length===1) ? 'PASS' : 'FAIL'
  });

  // ---- Test 7: selectActivityHRZoneSlice looks the activity back up via ACTIVITIES (by id),
  // recomputes its zone breakdown, stores the selection keyed by idPrefix+activityId, and updates
  // the three DOM regions if present ----
  win.eval(`
    document.body.insertAdjacentHTML('beforeend', '<div id="sess-test-act-1-hrzone-pie-host"></div><div id="sess-test-act-1-hrzone-chip-row"></div><div id="sess-test-act-1-hrzone-caption"></div>');
    // activityHRZoneBreakdown needs real stream data to return non-null -- stub it for this one test
    // so selectActivityHRZoneSlice's DOM-sync path can be exercised without a full TCX fixture.
    window.__origBreakdown = activityHRZoneBreakdown;
    activityHRZoneBreakdown = function(a){ return a.id==='test-act-1' ? __actZones : window.__origBreakdown(a); };
    selectActivityHRZoneSlice('sess-','test-act-1',3);
  `);
  const selKey = win.eval(`ACT_HRZONE_SELECTED['sess-test-act-1']`);
  const pieHostHTML = win.eval(`document.getElementById('sess-test-act-1-hrzone-pie-host').innerHTML`);
  const captionHTML = win.eval(`document.getElementById('sess-test-act-1-hrzone-caption').innerHTML`);
  console.log('Test 7 (selectActivityHRZoneSlice keys selection by idPrefix+activityId and syncs the DOM):', {
    selKey, pieHostHasSelected4: /hrzone-slice selected" data-idx="3"/.test(pieHostHTML), captionHasThreshold: /Threshold/.test(captionHTML),
    result: (selKey===3 && /hrzone-slice selected" data-idx="3"/.test(pieHostHTML) && /Threshold/.test(captionHTML)) ? 'PASS' : 'FAIL'
  });

  await wait(200);
  win.close();
})();
