// Regression test for Phase 1b of ANALYTICS_ROADMAP.md — the actual analytics engine built on top
// of Phase 1's imported Activity stream: wiring ACTIVITIES into the existing weekly trend chart /
// Training Load (ACWR) / Efficiency Factor / Best Efforts (the real gap Dylon reported -- "the data
// dont get added to the current charts and graphs"), plus new per-activity analytics -- a TRIMP-
// style Relative Effort score, an HR zone time-in-zone breakdown (reusing the existing HR Zone
// Calculator's own last-computed zones), a pace/HR/elevation chart series, and intra-activity
// walk-break detection.
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

// A synthetic 10-point stream, 10 seconds apart: fast running throughout except a deliberate
// 20-second slow stretch (points 2-4) at ~1 m/s (well under the 2.2 m/s walk-break threshold),
// with heart rate dropping to 110 during that same stretch and sitting at 150 the rest of the way
// -- lets one fixture exercise walk-break detection, the HR zone breakdown, and the chart series
// all at once with hand-checkable expected numbers.
const BASE_T = Date.parse('2027-04-01T06:00:00.000Z');
function iso(sec) { return new Date(BASE_T + sec * 1000).toISOString(); }
const STREAM_T = [0,10,20,30,40,50,60,70,80,90].map(iso);
const STREAM_DIST = [0,40,80,90,100,140,180,220,260,300];
const STREAM_HR = [150,150,110,110,150,150,150,150,150,150];
const STREAM_ALT = [100,101,102,102,101,103,104,105,106,107];

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
  win.eval(`window.renderAll = function(){};`);

  // Summary fields (distanceKm/durationSec/avgPace/avgHr) are deliberately a clean, independent
  // "2km in 10 minutes" for readable weekly-total/EF/best-effort math; the raw stream above is its
  // own small 300m/90s fixture purely for the per-point walk-break/HR-zone/chart-series tests --
  // real imports derive both from the same stream, but decoupling them here keeps each set of
  // assertions easy to hand-check on its own.
  const activityFixture = {
    type: 'run', date: '2026-07-08', startTime: '06:00', durationSec: 600,
    distanceKm: 2, avgPace: '5:00', avgHr: 150, maxHr: 150, elevationGainM: 6,
    stream: { t: STREAM_T, lat: [], lon: [], alt: STREAM_ALT, distM: STREAM_DIST, hr: STREAM_HR, cadence: [] },
    source: 'import', sourceFile: 'fixture.tcx', role: 'unplanned'
  };
  win.eval(`window.__fixture = ${JSON.stringify(activityFixture)};`);

  // ==== Wiring ACTIVITIES into existing charts/totals (1b-i) ====

  win.eval(`BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-09-01',sessions:[
      {id:'s1',wk:1,ty:'easy',date:'2026-07-01',ph:'dur',ti:'Easy Run'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-01'; BLOCK_END='2026-09-01';
    STATUS={s1:'done'}; NOTES={s1:{dist:'5',pace:'5:30'}};
    EXTRALOGS=[]; RACES_LIST=[]; ACTIVITIES=[];
    addActivity(window.__fixture);
  `);

  const t1 = win.eval(`loggedRunKmInRange('2026-07-01','2026-07-31')`);
  console.log('Test 1 (loggedRunKmInRange/Training Load includes an imported Activity run):',
    Math.abs(t1 - 7) < 0.001 ? 'PASS' : 'FAIL', { t1 });

  const t2 = JSON.parse(win.eval(`JSON.stringify(weekMetricTotal(1,'run'))`));
  console.log('Test 2 (weekMetricTotal/weekly trend chart includes an imported Activity run):',
    (t2.any && Math.abs(t2.total - 7) < 0.001) ? 'PASS' : 'FAIL', { t2 });

  const t3 = win.eval(`weekEF(1)`);
  console.log('Test 3 (weekEF folds in the Activity-derived EF alongside session EF):', t3 !== null ? 'PASS' : 'FAIL', { t3 });

  // bestEffortsByDistance() labels by real Strava-style standard checkpoint (v0.32.3, see
  // BEST_EFFORT_SEARCH_DISTANCES/closestStandardDistance). The shared Activity fixture above has a real
  // GPS stream covering only ~300m total -- too short for any of the 10 standard distances -- so under
  // v0.32.7's rolling-window search (see Test 71 below) it correctly contributes nothing here, unlike
  // its own whole-run distanceKm field (2, used only for OTHER tests' easy arithmetic) which was never
  // meant to represent a real checkpoint anyway. A second, separate Activity with NO stream (so it falls
  // back to whole-run distance matching) at a real standard distance (5K) confirms plain, non-GPS
  // Activities still feed this rollup too, same as hand-logged runs.
  win.eval(`addActivity({type:'run',date:'2026-07-05',distanceKm:5.0,durationSec:1500,avgPace:'5:00',source:'import',role:'unplanned'});`);
  const t4Buckets = JSON.parse(win.eval(`JSON.stringify(bestEffortsByDistance())`));
  const t4HasFixtureBucket = t4Buckets.some(g => g.label === '5K' && g.runs.some(r => r.dist === 5));
  console.log('Test 4 (bestEffortsByDistance includes an imported Activity run at a real standard distance):', t4HasFixtureBucket ? 'PASS' : 'FAIL');

  // ==== Per-activity analytics (1b-ii/iii/iv) ====

  // Test 5: with no HR Zone Calculator data yet (HRZONE_LAST null), Relative Effort and the zone
  // breakdown both stay null rather than guessing at zones with no real basis.
  win.eval(`HRZONE_LAST=null; PROFILE.savedHRZones=null;`);
  const t5Effort = win.eval(`activityRelativeEffort(window.__fixture)`);
  const t5Zones = win.eval(`activityHRZoneBreakdown(window.__fixture)`);
  console.log('Test 5 (Relative Effort and HR zone breakdown stay null with no HR Zone Calculator data):',
    (t5Effort === null && t5Zones === null) ? 'PASS' : 'FAIL');

  // Test 5b: a calculated-but-unsaved preview (HRZONE_LAST set, PROFILE.savedHRZones still null)
  // is NOT enough on its own -- proves the fix for Dylon's "it disappears after reload" report:
  // only an explicit Save to Profile (which writes PROFILE.savedHRZones) should ever feed these.
  win.eval(`HRZONE_LAST={...computeHRZones({age:30,maxHRFormula:'tanaka'}),method:'karvonen'};`);
  const t5bEffort = win.eval(`activityRelativeEffort(window.__fixture)`);
  const t5bZones = win.eval(`activityHRZoneBreakdown(window.__fixture)`);
  console.log('Test 5b (an unsaved calculator preview alone does not feed Relative Effort/zone breakdown):',
    (t5bEffort === null && t5bZones === null) ? 'PASS' : 'FAIL');

  // Test 6: once zones are saved to the profile (age 30, Tanaka -> maxHR 187, default resting 60),
  // Relative Effort computes a positive TRIMP-style score in a sane range for a 90-second effort at
  // HR 150. Both HRZONE_LAST and PROFILE.savedHRZones are set here -- only the latter is what
  // activityRelativeEffort/activityHRZoneBreakdown actually read (via currentHRZones()); HRZONE_LAST
  // alone (the calculator's own unsaved preview) is no longer enough on its own.
  win.eval(`HRZONE_LAST={...computeHRZones({age:30,maxHRFormula:'tanaka'}),method:'karvonen'}; PROFILE.savedHRZones={...HRZONE_LAST};`);
  const t6Effort = win.eval(`activityRelativeEffort(window.__fixture)`);
  console.log('Test 6 (Relative Effort computes a positive score once HR zone data exists):',
    (typeof t6Effort === 'number' && t6Effort > 0 && t6Effort < 500) ? 'PASS' : 'FAIL', { t6Effort });

  // Test 7: HR zone breakdown buckets the 20s of HR-110 (below Zone 1's own floor, so it reads as
  // Zone 1) separately from the 70s of HR-150 (squarely Zone 3/Tempo) -- percentages sum to 100.
  const t7Zones = JSON.parse(win.eval(`JSON.stringify(activityHRZoneBreakdown(window.__fixture))`));
  const t7Z1 = t7Zones.find(z => z.label === 'Zone 1');
  const t7Z3 = t7Zones.find(z => z.label === 'Zone 3');
  const t7PctSum = t7Zones.reduce((s,z) => s + z.pct, 0);
  console.log('Test 7 (HR zone breakdown splits low-HR walk stretch from high-HR running, sums to 100%):',
    (t7Z1 && t7Z3 && t7Z1.sec === 20 && t7Z3.sec === 70 && t7PctSum === 100) ? 'PASS' : 'FAIL', { t7Zones });

  // Test 8: detectWalkSegments/walkSegmentsSummary finds exactly the one deliberate 20-second slow
  // stretch, not the fast running before or after it.
  const t8 = JSON.parse(win.eval(`JSON.stringify(walkSegmentsSummary(window.__fixture))`));
  console.log('Test 8 (walk-break detection finds the one 20-second slow stretch):',
    (t8 && t8.count === 1 && t8.totalSec === 20) ? 'PASS' : 'FAIL', { t8 });

  // Test 9: a fixture with no slow stretch at all (steady fast pace throughout) finds no walk
  // breaks, so a clean run doesn't get a false-positive break flagged.
  const cleanFixture = JSON.parse(JSON.stringify(activityFixture));
  cleanFixture.stream.distM = [0,40,80,120,160,200,240,280,320,360];
  win.eval(`window.__cleanFixture = ${JSON.stringify(cleanFixture)};`);
  const t9 = win.eval(`walkSegmentsSummary(window.__cleanFixture)`);
  console.log('Test 9 (a steady-pace run with no slow stretch reports no walk breaks):', t9 === null ? 'PASS' : 'FAIL');

  // Test 10: activityChartSeries returns the expected point counts for pace (needs a valid prior
  // point, so one fewer than the raw stream length) vs. HR/elevation (one point per stream sample).
  const t10Pace = win.eval(`activityChartSeries(window.__fixture,'pace').length`);
  const t10Hr = win.eval(`activityChartSeries(window.__fixture,'hr').length`);
  const t10Elev = win.eval(`activityChartSeries(window.__fixture,'elev').length`);
  console.log('Test 10 (activityChartSeries returns correct point counts per metric):',
    (t10Pace === 9 && t10Hr === 10 && t10Elev === 10) ? 'PASS' : 'FAIL', { t10Pace, t10Hr, t10Elev });

  // Test 11: openActivityDetail's analytics block renders without throwing and includes the chart
  // pills, the Relative Effort score, and the walk-break summary -- an end-to-end smoke test that
  // the pure functions above are actually wired into the popup, not just unit-testable in isolation.
  win.eval(`
    ACTIVITIES=[]; STATUS={s1:'done'};
    const a = addActivity(window.__fixture);
    window.__savedFixtureId = a.id;
    openActivityDetail(window.__savedFixtureId);
  `);
  const detailHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  console.log('Test 11 (activity detail popup renders chart pills, Relative Effort, and walk-break summary):',
    (/class="trend-pills"/.test(detailHTML) && /Relative Effort/.test(detailHTML) && /walk break/.test(detailHTML)) ? 'PASS' : 'FAIL');

  // ==== Chart visual upgrade + Run/Walk/Idle timeline (Tasks 61/62) ====

  // Test 12: activityMetricStats gives Average/Maximum for HR (avg=142 across the 8x150 + 2x110
  // stretch, max=150), and Average/Best for pace where "Best" is the fastest (lowest sec/km) split
  // rather than the max value -- the direction flip has to be metric-aware, not just min-vs-max.
  const t12Hr = JSON.parse(win.eval(`JSON.stringify(activityMetricStats(activityChartSeries(window.__fixture,'hr'),'hr'))`));
  const t12Pace = JSON.parse(win.eval(`JSON.stringify(activityMetricStats(activityChartSeries(window.__fixture,'pace'),'pace'))`));
  console.log('Test 12 (activityMetricStats: HR gets Average/Maximum, pace gets Average/Best):',
    (t12Hr[0].label === 'Average' && Math.abs(t12Hr[0].v - 142) < 0.01 && t12Hr[1].label === 'Maximum' && t12Hr[1].v === 150 &&
     t12Pace[0].label === 'Average' && t12Pace[1].label === 'Best') ? 'PASS' : 'FAIL', { t12Hr, t12Pace });

  // Test 13: the rendered chart for the HR metric actually shows both stat numbers (142 and 150) in
  // its header row, not just a bare min-max caption like the old sparkline did.
  const t13 = win.eval(`renderActivityMetricChart(activityChartSeries(window.__fixture,'hr'),'hr')`);
  console.log('Test 13 (rendered HR chart shows both Average and Maximum stat numbers):',
    (/142/.test(t13) && /150/.test(t13) && /Average/.test(t13) && /Maximum/.test(t13)) ? 'PASS' : 'FAIL');

  // Test 16: a device that actually recorded power gets a Power pill + chart in the analytics block
  // (satisfying "still build the features for data my sister may have"), while a device with no
  // power data (like Dylon's own Pixel Watch fixture) never shows one -- pills are additive per file,
  // not a fixed set.
  const powerFixture = JSON.parse(JSON.stringify(activityFixture));
  powerFixture.stream.power = [200,205,150,140,210,215,220,218,222,225];
  win.eval(`window.__powerFixture = ${JSON.stringify(powerFixture)};`);
  const t16WithPower = win.eval(`activityAnalyticsHTML(window.__powerFixture)`);
  const t16WithoutPower = win.eval(`activityAnalyticsHTML(window.__fixture)`);
  console.log('Test 16 (Power pill appears only when a device actually recorded power data):',
    (/>Power</.test(t16WithPower) && !/>Power</.test(t16WithoutPower)) ? 'PASS' : 'FAIL');

  // Test 17: relativeEffortBand buckets a score into the right Easy/Moderate/Hard/Very Hard band,
  // and renderRelativeEffortGauge places its marker proportionally along the 0-240 scale (a score
  // of 120 is the exact Moderate/Hard boundary, so its marker sits at 50%).
  const t17Bands = JSON.parse(win.eval(`JSON.stringify([relativeEffortBand(30).label, relativeEffortBand(90).label, relativeEffortBand(150).label, relativeEffortBand(220).label])`));
  const t17Gauge = win.eval(`renderRelativeEffortGauge(120)`);
  console.log('Test 17 (relativeEffortBand buckets scores correctly; gauge marker lands at the right position):',
    (t17Bands[0] === 'Easy' && t17Bands[1] === 'Moderate' && t17Bands[2] === 'Hard' && t17Bands[3] === 'Very Hard' &&
     /left:50/.test(t17Gauge)) ? 'PASS' : 'FAIL', { t17Bands });

  // Test 18: the Effort card in the real detail popup actually shows the segmented gauge and a band
  // pill (e.g. "Moderate"), not just the bare number the old text-only row used to show.
  const t18 = win.eval(`activityAnalyticsHTML(window.__fixture)`);
  console.log('Test 18 (Effort card renders the segmented gauge + a band pill, not just a bare number):',
    (/Relative Effort/.test(t18) && /Easy|Moderate|Hard/.test(t18) && /border-radius:50%/.test(t18)) ? 'PASS' : 'FAIL');

  // ==== Bug fixes reported after v0.23.0 shipped: --accent read from the wrong element, noisy
  // Run/Walk/Idle flicker, no real axis labels (Task 66) ====

  // Test 19: --accent is only ever set on <body> (body.phase-durability/body.phase-ignition), never
  // on <html> -- custom properties don't propagate upward, so getComputedStyle(document.
  // documentElement) always came back empty and cssVar() silently fell back to a hardcoded blue
  // that had nothing to do with the app's actual theme. Confirms the asymmetry directly (jsdom
  // doesn't fully resolve a nested var(--ign) chain the way a real browser's getComputedStyle does,
  // but the html-vs-body emptiness split -- the actual bug -- is real and jsdom reproduces it
  // faithfully), then confirms renderActivityMetricChart's line color is no longer the fixed
  // fallback once read from the correct element.
  const t19Html = win.eval(`getComputedStyle(document.documentElement).getPropertyValue('--accent')`);
  win.eval(`document.body.className='phase-ignition';`);
  const t19Body = win.eval(`getComputedStyle(document.body).getPropertyValue('--accent')`);
  const t19Chart = win.eval(`renderActivityMetricChart(activityChartSeries(window.__fixture,'hr'),'hr')`);
  console.log('Test 19 (accent is unreadable from <html> but readable from <body>; chart no longer hardcodes the fallback color):',
    (t19Html.trim()==='' && t19Body.trim()!=='' && !/#5B8DEF/i.test(t19Chart)) ? 'PASS' : 'FAIL', { t19Html, t19Body });
  win.eval(`document.body.className='';`);

  // Test 21: the rendered chart now has real y-axis value labels (not just the old bare min-max
  // caption) and real x-axis distance labels, so a rider can actually read a specific value off the
  // chart instead of just seeing the two headline stat numbers.
  const t21 = win.eval(`renderActivityMetricChart(activityChartSeries(window.__fixture,'hr'),'hr')`);
  console.log('Test 21 (chart renders real y-axis value labels and x-axis distance labels):',
    (/0 km/.test(t21) && /km<\/span>/.test(t21) && (t21.match(/150/g)||[]).length >= 2) ? 'PASS' : 'FAIL');

  // ==== GAP -- Grade Adjusted Pace (Task 66) ====

  // Test 22: minettiCostRatio is exactly 1.0 on the flat (i=0, by construction: Cr(0)=3.6, normalized
  // against itself), above 1.0 uphill, and below 1.0 downhill -- the three sanity-checkable anchor
  // points of the Minetti energy-cost-of-running curve.
  const t22 = JSON.parse(win.eval(`JSON.stringify({flat:minettiCostRatio(0), uphill:minettiCostRatio(0.1), downhill:minettiCostRatio(-0.1)})`));
  console.log('Test 22 (minettiCostRatio: exactly 1.0 flat, above 1.0 uphill, below 1.0 downhill):',
    (Math.abs(t22.flat-1)<0.0001 && t22.uphill>1 && t22.downhill<1 && t22.downhill>0) ? 'PASS' : 'FAIL', { t22 });

  // Test 23: intervalGAP's whole point -- the same actual pace uphill reads as a *faster* (lower)
  // GAP number than flat (since the effort was harder than the actual pace alone suggests), and the
  // same actual pace downhill reads as a *slower* (higher) GAP number (since the effort was easier).
  const t23 = JSON.parse(win.eval(`JSON.stringify({flat:intervalGAP(300,0), uphill:intervalGAP(300,0.1), downhill:intervalGAP(300,-0.1)})`));
  console.log('Test 23 (intervalGAP: uphill at a given pace reads faster than flat; downhill reads slower):',
    (Math.abs(t23.flat-300)<0.01 && t23.uphill<300 && t23.downhill>300) ? 'PASS' : 'FAIL', { t23 });

  // Test 24: activityChartSeries('gap') produces a plottable series (same point count as pace, since
  // it's derived the same way) whenever altitude data is present, and activityAvgGAP returns a
  // sane whole-activity number in the same rough ballpark as the fixture's actual ~5:00/km pace
  // (grades in the fixture are all mild, so GAP shouldn't be wildly different from actual pace).
  const t24GapLen = win.eval(`activityChartSeries(window.__fixture,'gap').length`);
  const t24AvgGAP = win.eval(`activityAvgGAP(window.__fixture)`);
  console.log('Test 24 (GAP chart series and whole-activity average both compute from the fixture):',
    (t24GapLen === 9 && typeof t24AvgGAP === 'number' && t24AvgGAP > 200 && t24AvgGAP < 400) ? 'PASS' : 'FAIL', { t24GapLen, t24AvgGAP });

  // Test 25: activityStatRowsHTML shows a Grade-Adj. Pace row once altitude data lets it compute one,
  // and the detail popup's chart pills include a Grade-Adj. Pace option alongside Pace.
  const t25Rows = win.eval(`activityStatRowsHTML(window.__fixture)`);
  const t25Analytics = win.eval(`activityAnalyticsHTML(window.__fixture)`);
  console.log('Test 25 (Grade-Adj. Pace row and chart pill both appear once altitude data is available):',
    (/Grade-Adj\. Pace/.test(t25Rows) && /Grade-Adj\. Pace/.test(t25Analytics)) ? 'PASS' : 'FAIL');

  // ==== Per-km/mile splits table (Task 67) ====

  // A longer, evenly-paced 2.5km fixture (26 points, 100m/20s apart -- a steady 3:20/km) purely for
  // splits math, since the 300m walk-break fixture above is too short to ever cross a full km
  // boundary. HR climbs steadily (140 -> 164) and altitude climbs steadily (+0.5m per interval) so
  // each split's avg HR and elevation gain are meaningfully different from the others, not just
  // trivially all-equal or all-zero.
  const SPLIT_T = Array.from({length:26},(_,i)=>iso(i*20));
  const SPLIT_DIST = Array.from({length:26},(_,i)=>i*100);
  const SPLIT_HR = Array.from({length:26},(_,i)=>140+i);
  const SPLIT_ALT = Array.from({length:26},(_,i)=>100+i*0.5);
  const splitsFixture = {
    type:'run', date:'2026-07-20', startTime:'06:00', durationSec:500, distanceKm:2.5, avgPace:'3:20', avgHr:152,
    stream:{ t:SPLIT_T, lat:[], lon:[], alt:SPLIT_ALT, distM:SPLIT_DIST, hr:SPLIT_HR, cadence:[] },
    source:'import', sourceFile:'splits-fixture.tcx', role:'unplanned'
  };
  win.eval(`window.__splitsFixture = ${JSON.stringify(splitsFixture)}; PROFILE=PROFILE||{}; PROFILE.distUnit='km';`);

  // Test 26: a 2.5km run at a steady pace produces 3 splits (two full 1km splits + one 0.5km
  // partial leftover), each taking the same ~200s-per-km pace, confirming the boundary-crossing
  // logic lands on the right points rather than off by one interval.
  const t26 = JSON.parse(win.eval(`JSON.stringify(activitySplits(window.__splitsFixture))`));
  console.log('Test 26 (a 2.5km run produces 2 full-km splits plus one 0.5km partial, all at the same pace):',
    (t26.length === 3 && Math.abs(t26[0].distM-1000)<1 && Math.abs(t26[1].distM-1000)<1 && Math.abs(t26[2].distM-500)<1 &&
     Math.abs(t26[0].durSec-200)<1 && Math.abs(t26[2].durSec-100)<1) ? 'PASS' : 'FAIL', { t26 });

  // Test 27: each split's avg HR climbs from one split to the next (matching the steadily-rising HR
  // fixture), and elevation gain is positive for every split (matching the steadily-climbing
  // altitude fixture) -- confirms the per-split aggregation, not just the boundary math.
  console.log('Test 27 (avg HR rises split-over-split; every split shows positive elevation gain):',
    (t26[0].avgHr < t26[1].avgHr && t26[1].avgHr < t26[2].avgHr && t26.every(s => s.elevGainM > 0)) ? 'PASS' : 'FAIL',
    { hrs: t26.map(s=>s.avgHr), gains: t26.map(s=>s.elevGainM) });

  // Test 28: renderActivitySplitsTable renders a real HTML table with one row per split, including
  // the HR and elevation-gain columns since this fixture actually has both, and it's wired into
  // activityAnalyticsHTML for a run-type activity. A too-short activity (the 300m walk-break
  // fixture, under one full split) renders no table at all rather than a pointless single-row one.
  const t28Table = win.eval(`renderActivitySplitsTable(window.__splitsFixture)`);
  const t28Analytics = win.eval(`activityAnalyticsHTML(window.__splitsFixture)`);
  const t28ShortFixture = win.eval(`renderActivitySplitsTable(window.__fixture)`);
  console.log('Test 28 (splits table renders with HR/elevation columns, wired into the popup; too-short activity renders nothing):',
    (/Splits \(per km\)/.test(t28Table) && /<table/.test(t28Table) && (t28Table.match(/<tr>/g)||[]).length >= 3 &&
     /Splits \(per km\)/.test(t28Analytics) && t28ShortFixture === '') ? 'PASS' : 'FAIL');

  // ==== Best-efforts rolling-window search (Task 68) ====

  // Test 29: on the same perfectly-steady 2.5km/3:20-per-km fixture used for splits, a 1K best
  // effort comes back at exactly 200s (any 1km window takes exactly 200s at a truly uniform pace),
  // and a 5K search correctly returns null since the activity never covers that much distance --
  // no phantom result for a distance the run didn't reach.
  const t29Km = win.eval(`activityBestEffort(window.__splitsFixture,1).durSec`);
  const t29Null = win.eval(`activityBestEffort(window.__splitsFixture,5)`);
  console.log('Test 29 (1K best effort computes exactly; a distance the run never covers returns null):',
    (Math.abs(t29Km-200)<0.01 && t29Null===null) ? 'PASS' : 'FAIL', { t29Km });

  // Test 30: activityBestEfforts() only returns the standard distances this 2.5km activity actually
  // covers (1K and 1 Mile), never a 5K/10K/15K/Half entry it can't possibly have run.
  const t30 = JSON.parse(win.eval(`JSON.stringify(activityBestEfforts(window.__splitsFixture).map(e=>e.label))`));
  console.log('Test 30 (best-efforts list only includes distances the activity actually covers):',
    (t30.includes('1K') && t30.includes('1 Mile') && !t30.includes('5K') && !t30.includes('10K')) ? 'PASS' : 'FAIL', { t30 });

  // Test 31: renderActivityBestEffortsHTML renders a real card with both found distances and their
  // times, and it's wired into activityAnalyticsHTML for a run-type activity.
  const t31Card = win.eval(`renderActivityBestEffortsHTML(window.__splitsFixture)`);
  const t31Analytics = win.eval(`activityAnalyticsHTML(window.__splitsFixture)`);
  console.log('Test 31 (Best Efforts card renders found distances and is wired into the popup):',
    (/Best Efforts in This Activity/.test(t31Card) && /1K/.test(t31Card) && /1 Mile/.test(t31Card) &&
     /Best Efforts in This Activity/.test(t31Analytics)) ? 'PASS' : 'FAIL');

  // ==== Real lap/interval table (Task 69) ====

  // A 3-lap interval-workout fixture built directly on top of the same splitsFixture stream shape --
  // fast/slow/fast, matching real device lap data -- purely to test the render + Interval/Recovery
  // tagging + laps-preferred-over-splits wiring (the parser side is already covered end-to-end in
  // test_activity_import.js against real TCX XML).
  const lapsFixture = JSON.parse(JSON.stringify(splitsFixture));
  lapsFixture.laps = [
    {startTime:iso(0), durSec:90, distM:400, avgHr:165, elevGainM:5},   // 4.44 m/s -> Interval
    {startTime:iso(90), durSec:120, distM:200, avgHr:135, elevGainM:0}, // 1.67 m/s -> Recovery
    {startTime:iso(210), durSec:92, distM:400, avgHr:170, elevGainM:7}  // 4.35 m/s -> Interval
  ];
  win.eval(`window.__lapsFixture = ${JSON.stringify(lapsFixture)};`);

  // Test 32: renderActivityLapsTable tags the slow middle lap Recovery and the two fast laps
  // Interval (compares each lap's own speed against WALK_BREAK_SPEED_MPS), and shows real
  // HR/elevation-gain columns since this fixture has both.
  const t32 = win.eval(`renderActivityLapsTable(window.__lapsFixture)`);
  const t32RecoveryCount = (t32.match(/>Recovery</g)||[]).length;
  const t32IntervalCount = (t32.match(/>Interval</g)||[]).length;
  console.log('Test 32 (laps table tags the slow lap Recovery and the two fast laps Interval, with HR/gain columns):',
    (t32RecoveryCount === 1 && t32IntervalCount === 2 && /165/.test(t32) && /\+5m/.test(t32)) ? 'PASS' : 'FAIL');

  // Test 33: activityAnalyticsHTML shows the real Laps table (not the even Splits table) once an
  // activity has real device laps, but falls back to Splits for the same underlying stream once
  // laps are stripped off -- confirming the "laps win when present, splits otherwise" rule.
  const t33WithLaps = win.eval(`activityAnalyticsHTML(window.__lapsFixture)`);
  const noLapsFixture = JSON.parse(JSON.stringify(lapsFixture));
  delete noLapsFixture.laps;
  win.eval(`window.__noLapsFixture = ${JSON.stringify(noLapsFixture)};`);
  const t33WithoutLaps = win.eval(`activityAnalyticsHTML(window.__noLapsFixture)`);
  console.log('Test 33 (Laps table shown when real laps exist; falls back to Splits when they do not):',
    (/>Laps</.test(t33WithLaps) && !/Splits \(per/.test(t33WithLaps) &&
     /Splits \(per/.test(t33WithoutLaps) && !/>Laps</.test(t33WithoutLaps)) ? 'PASS' : 'FAIL');

  // Test 34: HR zone bars now use a distinct low-to-high intensity color per zone (matching Strava's
  // own Training Zones page and Google Health's zone view) instead of every zone sharing one flat
  // accent color -- Zone 1 reads as the "cool" end of the ramp, Zone 3 (the zone this fixture
  // actually spends time in per Test 7) reads as a different, warmer color, not the same one.
  const t34 = win.eval(`activityAnalyticsHTML(window.__fixture)`);
  console.log('Test 34 (HR zone bars use a distinct color per zone instead of one flat accent color):',
    (/var\(--dur\)/.test(t34) && /var\(--gold\)/.test(t34)) ? 'PASS' : 'FAIL');

  // ==== Best Efforts -> Personal Bests integration + ranking (Task 73) ====
  // Registers the steady 2.5km/3:20-per-km splitsFixture as a real logged Activity (its 1K rolling-
  // window best effort is exactly 200s, per Test 29), plus two slower hand-logged 1K-ish entries (a
  // planned session and a Quick Add) so there's a real field of 3 efforts to rank against -- Dylon:
  // "if i have 5 runs... shouldnt it be added from my run like how strava always tell you this is your
  // 2nd or 3rd fastest 5k?"
  win.eval(`
    ACTIVITIES.push(window.__splitsFixture);
    DATA.push({id:'s2',wk:1,ty:'easy',date:'2026-07-10',ph:'dur',ti:'Slow 1K'});
    STATUS.s2='done'; NOTES.s2={dist:'1',pace:'4:30'};
    EXTRALOGS.push({id:'x1',kind:'run',date:'2026-07-11',dist:'1',pace:'5:00'});
  `);

  // Test 35: allEffortsAtDistance(1) finds the imported Activity's true rolling-window 1K (~200s,
  // via activityBestEffort) alongside both hand-logged 1K entries, sorted fastest first.
  const t35 = JSON.parse(win.eval(`JSON.stringify(allEffortsAtDistance(1))`));
  console.log('Test 35 (allEffortsAtDistance merges the Activity rolling-window effort with hand-logged 1K entries, fastest first):',
    (t35.length === 3 && Math.abs(t35[0].sec-200)<1 && t35[t35.length-1].sec >= 300) ? 'PASS' : 'FAIL', { t35 });

  // Test 36: the fastest of the three (the imported Activity's 200s effort) ranks 1st of 3; the
  // slowest (270s pace session at 4:30/km) ranks correctly among the field rather than always 1st.
  const t36Fast = JSON.parse(win.eval(`JSON.stringify(effortRankAmong(200,1))`));
  const t36Slow = JSON.parse(win.eval(`JSON.stringify(effortRankAmong(300,1))`));
  console.log('Test 36 (effortRankAmong correctly ranks the fastest 1st and the slowest last, out of 3 total):',
    (t36Fast.rank === 1 && t36Fast.total === 3 && t36Slow.rank === 3 && t36Slow.total === 3) ? 'PASS' : 'FAIL',
    { t36Fast, t36Slow });

  // Test 37: renderActivityBestEffortsHTML shows a ranking line under each distance -- "Fastest 1K
  // all-time!" for the splitsFixture's own rank-1 effort (since it's the fastest of the 3 logged).
  const t37 = win.eval(`renderActivityBestEffortsHTML(window.__splitsFixture)`);
  console.log('Test 37 (Best Efforts card shows a "Fastest ... all-time!" ranking line for a rank-1 effort):',
    /Fastest 1K all-time!/.test(t37) ? 'PASS' : 'FAIL');

  // Test 38: the Personal Bests card falls back to the fastest logged training effort ("best
  // training run") for a distance bucket with no manually-entered race PB, but still shows "Not yet
  // raced" for a bucket with neither a race PB nor any matching training data (10K, untouched here).
  win.eval(`RACES_LIST=[];`);
  const t38 = win.eval(`personalBestsSectionHTML()`);
  console.log('Test 38 (Personal Bests falls back to a labeled best training run when no race PB exists, but still shows "Not yet raced" where there is truly no data):',
    (/best training run/.test(t38) && /3:20/.test(t38) && /Not yet raced/.test(t38)) ? 'PASS' : 'FAIL');

  // Test 39: once a real race PB is entered for that same bucket, the card prefers the verified race
  // result over the training-run fallback -- a real race result should never be shadowed by training data.
  win.eval(`RACES_LIST=[{key:'r1',name:'Local 1K',distance:'1K',status:'done',isPB:true,actualTime:'3:05',date:'2026-07-15'}];`);
  const t39 = win.eval(`personalBestsSectionHTML()`);
  console.log('Test 39 (a real race PB takes priority over the training-run fallback for the same bucket):',
    (/3:05/.test(t39) && /Local 1K/.test(t39) && !/best training run/.test(t39.match(/1K[\s\S]{0,200}/)[0])) ? 'PASS' : 'FAIL');

  // ==== Pace zones time-in-zone bar chart (Task 74) ====

  // A clean 15K race result is the ONLY known performance for this block so predictedRaceTimeSec(15)
  // -- and therefore the estimated threshold pace -- comes out to an exact, hand-checkable number:
  // riegelPredictSec(sec,15,15) is just sec itself (same distance, no scaling), so the projected
  // midpoint is raceSec * 1.005 (the average of the *0.97/*1.04 spread predictedRaceTimeSec always
  // applies) -- 301.5 sec/km for a 75:00 (4500s) 15K. Also clears EXTRALOGS/DATA/STATUS/NOTES/
  // ACTIVITIES left over from earlier tests in this file, not just RACES_LIST -- since v0.34.34, any
  // training performance dated AFTER the most recent race counts toward predictedRaceTimeSec() too
  // (Dylon: "i just ran an interval session today ... my current prediction didnt update" -- races
  // no longer silently freeze out every later training run forever), so a stray leftover EXTRALOGS
  // entry dated after this race's 2026-06-01 would now dilute what's meant to be an isolated,
  // race-only check of the Riegel math itself.
  win.eval(`EXTRALOGS=[]; DATA=[]; STATUS={}; NOTES={}; ACTIVITIES=[]; RACES_LIST=[{key:'r2',name:'Test 15K',distance:'15K',status:'done',actualTime:'1:15:00',date:'2026-06-01'}];`);
  const t40 = win.eval(`estimatedThresholdPaceSecPerKm()`);
  console.log('Test 40 (estimated threshold pace derives from a real 15K race result via the existing Riegel race-projection engine):',
    Math.abs(t40 - 301.5) < 0.1 ? 'PASS' : 'FAIL', { t40 });

  // A synthetic 13-point/120s stream with three exact, evenly-paced 40-second blocks straddling that
  // 301.5 sec/km threshold: 400 sec/km (132.8% of threshold -> Zone 1 Active Recovery), 301.5 sec/km
  // exactly (100% -> Zone 4 Threshold), and 250 sec/km (82.9% -> Zone 6 Anaerobic). No altitude data,
  // so Grade-Adj. Pace falls back to raw actual pace, keeping the numbers exact and hand-checkable.
  function buildPaceBlockDist(paces, ptsPerBlock, dtSec) {
    const dist = [0];
    paces.forEach((pace) => {
      const ddPerInterval = (dtSec * 1000) / pace;
      for (let k = 0; k < ptsPerBlock; k++) dist.push(dist[dist.length - 1] + ddPerInterval);
    });
    return dist;
  }
  const pzDist = buildPaceBlockDist([400, 301.5, 250], 4, 10);
  const pzT = pzDist.map((_, i) => iso(i * 10));
  const pzFixture = {
    type: 'run', date: '2026-07-22', startTime: '06:00', durationSec: 120, distanceKm: pzDist[pzDist.length-1]/1000, avgPace: '8:30',
    stream: { t: pzT, lat: [], lon: [], alt: [], distM: pzDist, hr: [], cadence: [] },
    source: 'import', sourceFile: 'pacezone-fixture.tcx', role: 'unplanned'
  };
  win.eval(`window.__pzFixture = ${JSON.stringify(pzFixture)};`);
  const t41 = JSON.parse(win.eval(`JSON.stringify(activityPaceZoneBreakdown(window.__pzFixture))`));
  const t41z1 = t41.find(z => z.label === 'Zone 1'), t41z4 = t41.find(z => z.label === 'Zone 4'), t41z6 = t41.find(z => z.label === 'Zone 6');
  console.log('Test 41 (pace zone breakdown correctly buckets three evenly-timed segments into Zone 1/4/6, 40s/33% each):',
    (t41z1.sec === 40 && t41z4.sec === 40 && t41z6.sec === 40 && t41z1.pct === 33 && t41z4.pct === 33 && t41z6.pct === 33) ? 'PASS' : 'FAIL', { t41 });

  // Test 42: renderActivityPaceZoneBreakdown renders a real card with all three zone names/times, and
  // it's wired into activityAnalyticsHTML for a run-type activity.
  const t42Card = win.eval(`renderActivityPaceZoneBreakdown(window.__pzFixture)`);
  const t42Analytics = win.eval(`activityAnalyticsHTML(window.__pzFixture)`);
  console.log('Test 42 (Pace Zones card renders zone names/times and is wired into the popup):',
    (/Pace Zones/.test(t42Card) && /Active Recovery/.test(t42Card) && /Threshold/.test(t42Card) && /Anaerobic/.test(t42Card) &&
     /Pace Zones/.test(t42Analytics)) ? 'PASS' : 'FAIL');

  // Test 43: with no known performance at all to project a threshold from, the whole feature stays
  // hidden (returns null / empty string) rather than guessing at arbitrary zone boundaries.
  win.eval(`RACES_LIST=[]; ACTIVITIES=[]; DATA=[]; EXTRALOGS=[];`);
  const t43 = win.eval(`activityPaceZoneBreakdown(window.__pzFixture)`);
  const t43Card = win.eval(`renderActivityPaceZoneBreakdown(window.__pzFixture)`);
  console.log('Test 43 (no known performance to project a threshold from -> feature stays hidden rather than guessing):',
    (t43 === null && t43Card === '') ? 'PASS' : 'FAIL');

  // ==== Route map visualization (Task 75) ====

  // Test 44: routeMapGradientColor interpolates across the exact five hex stops (--dur/--gr/--gold/
  // --am/--re) read straight off :root -- frac 0 is exactly the first stop, 1 the last, 0.5 lands
  // exactly on the middle stop. This jsdom window loads with the light theme active (this test suite
  // never toggles PROFILE.theme), so the expected values are the light-theme hex, not the dark ones.
  const t44a = win.eval(`routeMapGradientColor(0)`);
  const t44b = win.eval(`routeMapGradientColor(1)`);
  const t44c = win.eval(`routeMapGradientColor(0.5)`);
  console.log('Test 44 (routeMapGradientColor interpolates correctly across the five real theme color stops):',
    (t44a === 'rgb(59,111,224)' && t44b === 'rgb(225,68,63)' && t44c === 'rgb(184,134,11)') ? 'PASS' : 'FAIL',
    { t44a, t44b, t44c });

  // A small 5-point GPS route (a real lat/lon shape, not a straight line) with four 10-second
  // intervals at four distinct, hand-chosen paces (200/400/600/150 sec/km) and five distinct HR
  // readings, so both the Pace and Heart Rate coloring modes have real, hand-checkable data.
  const routeFixture = {
    type: 'run', date: '2026-07-23', startTime: '06:00', durationSec: 40, distanceKm: 0.158333, avgPace: '4:10', avgHr: 150,
    stream: {
      t: [0,10,20,30,40].map(iso),
      lat: [40.0000,40.0004,40.0008,40.0004,40.0000],
      lon: [-75.0000,-75.0003,-75.0006,-75.0009,-75.0012],
      alt: [], distM: [0,50,75,91.666666666666666,158.33333333333331],
      hr: [130,150,170,140,160], cadence: []
    },
    source: 'import', sourceFile: 'route-fixture.tcx', role: 'unplanned'
  };
  win.eval(`window.__routeFixture = ${JSON.stringify(routeFixture)};`);

  // Test 45: activityRouteSVG draws one line segment per interval (4) plus start/finish markers (2
  // circles), preserving the route's true shape (preserveAspectRatio="xMidYMid meet", never "none"
  // like the intentionally-stretched metric chart elsewhere) -- for both Pace and Heart Rate modes.
  const t45Pace = win.eval(`activityRouteSVG(window.__routeFixture,'pace')`);
  const t45Hr = win.eval(`activityRouteSVG(window.__routeFixture,'hr')`);
  console.log('Test 45 (route SVG draws 4 segments + start/finish markers, true aspect ratio preserved, for both Pace and HR modes):',
    (t45Pace && t45Hr &&
     (t45Pace.match(/<line/g)||[]).length === 4 && (t45Pace.match(/<circle/g)||[]).length === 2 &&
     (t45Hr.match(/<line/g)||[]).length === 4 &&
     /preserveAspectRatio="xMidYMid meet"/.test(t45Pace) && !/preserveAspectRatio="none"/.test(t45Pace)) ? 'PASS' : 'FAIL');

  // Test 46: a activity with no usable GPS (the original fixture's empty lat/lon arrays) returns
  // null/'' instead of an empty or broken map.
  const t46Svg = win.eval(`activityRouteSVG(window.__fixture,'pace')`);
  const t46Card = win.eval(`renderActivityRouteMapHTML(window.__fixture)`);
  console.log('Test 46 (no usable GPS -> route map stays hidden entirely, not an empty/broken map):',
    (t46Svg === null && t46Card === '') ? 'PASS' : 'FAIL');

  // Test 47: renderActivityRouteMapHTML renders a real "Route" card with both a Pace and Heart Rate
  // toggle (since this fixture has data for both), and it's wired into activityAnalyticsHTML.
  const t47Card = win.eval(`renderActivityRouteMapHTML(window.__routeFixture)`);
  const t47Analytics = win.eval(`activityAnalyticsHTML(window.__routeFixture)`);
  console.log('Test 47 (Route card renders a Pace/Heart Rate toggle and is wired into the popup):',
    (/>Route</.test(t47Card) && />Pace</.test(t47Card) && />Heart Rate</.test(t47Card) && /<svg/.test(t47Card) &&
     />Route</.test(t47Analytics)) ? 'PASS' : 'FAIL');

  // Test 48: regression guard for the real-world "Route/Splits render but visually collapse to a
  // sliver" bug -- #confirm-sheet-inner (the popup this markup gets injected into) carries class
  // "sheet", which is a flex column with max-height:92vh (see .sheet in the CSS). Per the CSS flex
  // spec, a flex item's automatic minimum size collapses from "its content size" to 0 the moment the
  // item itself sets any overflow value other than visible -- which is exactly what Route's
  // (overflow:hidden) and Splits'/Laps' (overflow-x:auto) own cards do, while sibling cards like Best
  // Efforts/Pace Zones (no overflow set) are unaffected. flex-shrink:0 on these three cards is the
  // fix, restoring their protected natural height regardless of overflow. If this regresses (someone
  // drops the flex-shrink:0 while touching this markup), Route/Splits/Laps will silently collapse to
  // a near-zero-height sliver again on any popup taller than ~92% of the viewport -- exactly what was
  // reported against the real "2026-07-26-pixel-run2.63km.tcx" file.
  const t48Route = win.eval(`renderActivityRouteMapHTML(window.__routeFixture)`);
  const t48Splits = win.eval(`renderActivitySplitsTable(window.__splitsFixture)`);
  const t48Laps = win.eval(`renderActivityLapsTable(window.__lapsFixture)`);
  console.log('Test 48 (Route/Splits/Laps cards carry flex-shrink:0 so they cannot collapse inside the flex-column popup sheet):',
    (/overflow:hidden;flex-shrink:0/.test(t48Route) &&
     /overflow-x:auto;flex-shrink:0/.test(t48Splits) &&
     /overflow-x:auto;flex-shrink:0/.test(t48Laps)) ? 'PASS' : 'FAIL');

  // ==== Live route map (v0.27.2): real Leaflet+CARTO map when online, offline SVG when not ====
  // Dylon, once the offline-only SVG route shipped: "the rout is really barebones and not like a
  // map, any suggestions to make it more of a map maybe using a maping api once online and bare
  // bones offline version when there is no internet ? also we need to reorder how the data is
  // presented. the map should be at the top of the page like Google health and the pill shaped
  // bottons below it."

  // Test 49: activityRoutePointsColored -- the shared point/color computation pulled out of
  // activityRouteSVG so the new live map can reuse the exact same downsampling/coloring logic --
  // returns all 5 real points with their real lat/lon and a genuine color string per point.
  const t49 = win.eval(`activityRoutePointsColored(window.__routeFixture,'pace')`);
  console.log('Test 49 (activityRoutePointsColored returns all 5 points with real coordinates and a color per point):',
    (t49 && t49.points.length===5 && t49.start.lat===40.0000 && t49.end.lat===40.0000 &&
     t49.points.every(p=>typeof p.color==='string' && p.color.length>0)) ? 'PASS' : 'FAIL');

  // Test 50: renderActivityRouteMapHTML's new markup -- a hidden-by-default live-map container
  // (#route-live-<id>, given real height so Leaflet has room to lay out into once JS swaps it in)
  // sits above the always-rendered offline SVG (#route-svg-<id>) in the same card, and the Pace/
  // Heart Rate toggle pills now render AFTER that card closes -- Dylon wanted the map up top and
  // the pills underneath it, not above it like the pre-reorder version.
  const t50 = win.eval(`renderActivityRouteMapHTML(window.__routeFixture)`);
  const t50LiveIdx = t50.indexOf('id="route-live-');
  const t50SvgIdx = t50.indexOf('id="route-svg-');
  const t50PillsIdx = t50.indexOf('class="trend-pills"');
  console.log('Test 50 (Route card has a hidden live-map container + visible SVG fallback; pills render after the card):',
    (t50LiveIdx>=0 && t50SvgIdx>t50LiveIdx && /id="route-live-[^"]*"\s+style="[^"]*display:none/.test(t50) &&
     t50PillsIdx>t50SvgIdx) ? 'PASS' : 'FAIL');

  // Test 51: activityAnalyticsHTML now renders the Route card FIRST, ahead of the per-metric chart
  // (headed "Pace"/"Heart Rate"/etc, not a generic "Over the Activity" label -- see actHdr) --
  // matching the Google Health-style "map at the top" layout Dylon referenced. The chart's own card
  // is the only section using the padding:16px card style ahead of Splits/Best Efforts/Pace
  // Zones/Effort further down, so that's what marks its position here.
  const t51 = win.eval(`activityAnalyticsHTML(window.__routeFixture)`);
  const t51RouteIdx = t51.indexOf('>Route<');
  const t51ChartIdx = t51.indexOf('style="padding:16px"');
  console.log('Test 51 (Route section now renders before the per-metric chart in the popup):',
    (t51RouteIdx>=0 && t51ChartIdx>=0 && t51RouteIdx<t51ChartIdx) ? 'PASS' : 'FAIL');

  // Test 52: initActivityRouteLiveMap gracefully no-ops (returns false, doesn't throw) when
  // Leaflet's CDN script hasn't loaded -- true both for a genuinely offline device and, confirmed
  // directly against this exact jsdom sandbox, for a network-restricted environment where the CDN
  // itself can't be reached (typeof L stays 'undefined' here, the same as real offline). The
  // offline SVG (#route-svg-<id>) must stay the visible one and the live-map container
  // (#route-live-<id>) must stay hidden -- i.e. nothing changes and nothing throws.
  win.eval(`
    window.__t52Fixture = Object.assign({},window.__routeFixture,{id:'t52-route'});
    document.body.insertAdjacentHTML('beforeend','<div id="t52-wrap">'+renderActivityRouteMapHTML(window.__t52Fixture)+'</div>');
  `);
  let t52Threw=false, t52Result=null;
  try{ t52Result = win.eval(`initActivityRouteLiveMap(window.__t52Fixture)`); }
  catch(e){ t52Threw=true; }
  const t52LiveDisplay = win.eval(`document.getElementById('route-live-t52-route').style.display`);
  const t52SvgDisplay = win.eval(`document.getElementById('route-svg-t52-route').style.display`);
  console.log('Test 52 (no Leaflet loaded -> initActivityRouteLiveMap no-ops safely, offline SVG stays visible):',
    (!t52Threw && t52Result===false && t52LiveDisplay==='none' && t52SvgDisplay!=='none') ? 'PASS' : 'FAIL');

  // Test 53: destroyActivityLiveMap is a safe no-op when there's no live map instance to tear down
  // (the common case -- most closes happen without a live map ever having successfully loaded).
  let t53Threw=false;
  try{ win.eval(`destroyActivityLiveMap()`); } catch(e){ t53Threw=true; }
  console.log('Test 53 (destroyActivityLiveMap is a safe no-op with no live map instance):', !t53Threw ? 'PASS' : 'FAIL');

  // Test 54: the pace/HR color legend AND a new Start/Finish dot legend now live OUTSIDE
  // #route-svg-<id> as their own always-visible block, instead of inside it -- Dylon, after the live
  // map started working: "there should be a legend for the coloured dots on the route." Before this,
  // the whole legend (Cooler/Hotter scale included) silently disappeared whenever the live map took
  // over, since it used to live inside the same div that gets hidden in that mode.
  const t54 = win.eval(`renderActivityRouteMapHTML(window.__routeFixture)`);
  const t54SvgOpenIdx = t54.indexOf('id="route-svg-');
  const t54SvgCloseIdx = t54.indexOf('</div>', t54SvgOpenIdx);
  const t54InsideSvgDiv = t54.slice(t54SvgOpenIdx, t54SvgCloseIdx);
  console.log('Test 54 (legend + Start/Finish key render outside #route-svg-<id>, always visible):',
    (!/Cooler/.test(t54InsideSvgDiv) && !/Start/.test(t54InsideSvgDiv) &&
     /Cooler/.test(t54) && />Start</.test(t54) && />Finish</.test(t54)) ? 'PASS' : 'FAIL');

  // Test 55: shoeBlockKm() now also counts imported Activities toward a shoe's tracked mileage, not
  // just NOTES/EXTRALOGS -- Dylon asked to "add shoes ... to the run information," and that's only
  // meaningful if wearing a shoe on an imported run actually puts mileage on it, the same as a
  // hand-logged run/walk already does. Two activities on the same shoe should sum; a third on a
  // different shoe (or unset) must not be counted.
  win.eval(`
    SHOES={sk1:{name:'Shoe One',km:400,note:'',retired:false},sk2:{name:'Shoe Two',km:400,note:'',retired:false}};
    EXTRALOGS=[];
    ACTIVITIES=[];
    addActivity({type:'run',date:'2027-05-01',distanceKm:5,shoe:'sk1'});
    addActivity({type:'run',date:'2027-05-02',distanceKm:3.5,shoe:'sk1'});
    addActivity({type:'run',date:'2027-05-03',distanceKm:10,shoe:'sk2'});
    addActivity({type:'run',date:'2027-05-04',distanceKm:7});
  `);
  const t55Sk1 = win.eval(`shoeBlockKm('sk1')`);
  const t55Sk2 = win.eval(`shoeBlockKm('sk2')`);
  console.log('Test 55 (shoeBlockKm sums imported Activities by shoe, ignoring other shoes/unset):',
    (Math.abs(t55Sk1-8.5)<0.001 && Math.abs(t55Sk2-10)<0.001) ? 'PASS' : 'FAIL');

  // Test 56: activityStatRowsHTML() displays Shoe (with a "(retired)" suffix when applicable), RPE
  // (value + its RPE_LABELS text), Notes, and tag pills once an activity has them set -- the read-only
  // counterpart to the new edit form, and the same display conventions NOTES/EXTRALOGS already use.
  win.eval(`
    SHOES={sk3:{name:'Retired Shoe',km:400,note:'',retired:true}};
    window.__act56 = addActivity({type:'run',date:'2027-05-05',shoe:'sk3',rpe:'8',tags:['pet','recovery'],notes:'Felt tough on the hills.'});
  `);
  const t56 = win.eval(`activityStatRowsHTML(window.__act56)`);
  console.log('Test 56 (activityStatRowsHTML shows shoe/retired flag, RPE label, notes, and tag pills):',
    (/Retired Shoe \(retired\)/.test(t56) && /8 · Hard/.test(t56) && /Felt tough on the hills\./.test(t56) &&
     /With Pet/.test(t56) && /Recovery/.test(t56)) ? 'PASS' : 'FAIL');

  // Tests 57-60: "Best Efforts by Distance" now buckets by Strava-style standard checkpoint instead
  // of every rounded km -- Dylon: "best efforts by distance shouldnt log every distance let's use
  // strava same distances instead."

  // Test 57: closestStandardDistance snaps a real-world GPS-noisy distance to its checkpoint within
  // the ±7% tolerance, and returns null for something nowhere near any recognized distance.
  const t57 = JSON.parse(win.eval(`JSON.stringify({
    close5k: closestStandardDistance(5.08),
    close10k: closestStandardDistance(9.7),
    farOff: closestStandardDistance(3.7)
  })`));
  console.log('Test 57 (closestStandardDistance snaps GPS-noisy distances to the right checkpoint, and returns null when too far off):',
    (t57.close5k && t57.close5k.label==='5K' && t57.close10k && t57.close10k.label==='10K' && t57.farOff===null) ? 'PASS' : 'FAIL', { t57 });

  // Test 58: bestEffortsByDistance groups a real 5K (5.08km) and a slightly-off 5K (4.95km) into the
  // SAME "5K" bucket together, rather than two separate rounded-km buckets ("5km" and "5km" would have
  // coincidentally matched before too, but a 4.6km/5.4km pair -- both "5" when rounded -- versus a
  // genuinely different-distance run now separates correctly by real standard checkpoint instead).
  win.eval(`
    BLOCKS=[{id:'b58',name:'B58',startDate:'2027-07-01',endDate:'2027-09-01',sessions:[
      {id:'r1',wk:1,ty:'easy',date:'2027-07-01',ph:'dur',ti:'Run 1'},
      {id:'r2',wk:1,ty:'easy',date:'2027-07-02',ph:'dur',ti:'Run 2'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b58'; STATUS={r1:'done',r2:'done'};
    NOTES={r1:{dist:'5.08',duration:'25:00'}, r2:{dist:'4.95',duration:'24:30'}};
    EXTRALOGS=[]; ACTIVITIES=[];
  `);
  const t58Groups = JSON.parse(win.eval(`JSON.stringify(bestEffortsByDistance())`));
  const t585k = t58Groups.find(g=>g.label==='5K');
  console.log('Test 58 (two real-world 5Ks with slightly different GPS distances land in the same 5K bucket):',
    (t585k && t585k.runs.length===2) ? 'PASS' : 'FAIL', { t58Groups });

  // Test 59 (v0.32.7): a hand-logged run at a genuinely non-standard distance (e.g. a 3.7km recovery
  // jog -- outside ±7% of both 2 Miles/3.22km and 5K/5km) produces NO bucket at all. The v0.32.4 "~Nkm"
  // fallback that used to catch this case is gone -- Dylon: "why is each tab still showing 3k, 8km, 6k?
  // the tabs should be specific to the specified list" -- so a hand-logged entry with no GPS stream
  // either genuinely matches one of the 10 fixed distances or it contributes nothing, full stop. (A real
  // GPS-tracked Activity covering this same distance would be handled completely differently -- see
  // Test 71 -- since a stream can be searched for a shorter segment inside it; a bare dist+duration pair
  // like this one cannot.)
  win.eval(`
    STATUS={r1:'done'}; NOTES={r1:{dist:'3.7',duration:'20:00'}};
  `);
  const t59Groups = JSON.parse(win.eval(`JSON.stringify(bestEffortsByDistance())`));
  console.log('Test 59 (a non-standard hand-logged distance like 3.7km produces no bucket at all):',
    t59Groups.length===0 ? 'PASS' : 'FAIL', { t59Groups });

  // Test 60: renderBestEffortsByDistance() shows the standard label ("5K"), not a "~Nkm" bucket number.
  win.eval(`NOTES={r1:{dist:'5.0',duration:'25:00'}};`);
  const t60HTML = win.eval(`renderBestEffortsByDistance()`);
  console.log('Test 60 (Best Efforts by Distance card shows a real standard-distance label like "5K"):',
    (/>5K /.test(t60HTML) && !/~5km/.test(t60HTML)) ? 'PASS' : 'FAIL', { t60HTML });

  // Test 61 (v0.32.7): the same five real hand-logged training distances from Dylon's own backup
  // (5.85/6.1/5.1/8.1/2.67km -- ordinary prescribed training runs, none of them races, none of them
  // GPS-tracked Activities with a stream to search inside) now correctly show up ONLY where they
  // genuinely belong: just the 5.1km run (close enough to 5K) produces a bucket. The other four --
  // 5.85/6.1/8.1/2.67 -- aren't close enough to any of the 10 fixed distances and, being plain
  // dist+duration entries with no stream, there's no way to find a shorter real segment inside them, so
  // they correctly contribute nothing. (v0.32.4's "~Nkm" fallback used to catch these; removed in
  // v0.32.7 since Dylon confirmed tabs should be limited to the fixed list -- see Test 71 for how a real
  // GPS-tracked 6km+ run gets a fair shot at a genuine 5K result instead.)
  win.eval(`
    BLOCKS=[{id:'b61',name:'B61',startDate:'2027-08-01',endDate:'2027-09-01',sessions:[
      {id:'q1',wk:1,ty:'easy',date:'2027-08-01',ph:'dur',ti:'Run 1'},
      {id:'q2',wk:1,ty:'easy',date:'2027-08-02',ph:'dur',ti:'Run 2'},
      {id:'q3',wk:1,ty:'easy',date:'2027-08-03',ph:'dur',ti:'Run 3'},
      {id:'q4',wk:1,ty:'easy',date:'2027-08-04',ph:'dur',ti:'Run 4'},
      {id:'q5',wk:1,ty:'easy',date:'2027-08-05',ph:'dur',ti:'Run 5'}
    ],mileagePlan:{1:40}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b61';
    STATUS={q1:'done',q2:'done',q3:'done',q4:'done',q5:'done'};
    NOTES={
      q1:{dist:'5.85',duration:'35:00'}, q2:{dist:'6.1',duration:'36:00'},
      q3:{dist:'5.1',duration:'29:00'}, q4:{dist:'8.1',duration:'48:00'},
      q5:{dist:'2.67',duration:'16:00'}
    };
    EXTRALOGS=[]; ACTIVITIES=[]; RACES_LIST=[];
  `);
  const t61Groups = JSON.parse(win.eval(`JSON.stringify(bestEffortsByDistance())`));
  const t61TotalRuns = t61Groups.reduce((n,g)=>n+g.runs.length,0);
  const t615k = t61Groups.find(g=>g.label==='5K');
  console.log('Test 61 (only the genuinely-close-to-5K distance gets a bucket; the other four contribute nothing):',
    (t61Groups.length===1 && t61TotalRuns===1 && t615k && t615k.runs[0].dist===5.1) ? 'PASS' : 'FAIL',
    { t61Groups });

  // Tests 62-66 (v0.32.5): Strava-style tabbed Best Efforts card -- Dylon: "bring back that card but
  // use standard distances like those found in strava best efforts screen. this screen have tabs with
  // top 3 efforts per distance that also linked to the activity. i want this feature." A distance tab
  // row now drives which group's PR/ranked list shows, and every entry (hero PR and each ranked row)
  // taps through to wherever it was actually logged.
  win.eval(`
    BLOCKS=[{id:'b62',name:'B62',startDate:'2027-09-01',endDate:'2027-10-01',sessions:[
      {id:'p1',wk:1,ty:'easy',date:'2027-09-01',ph:'dur',ti:'Run P1'},
      {id:'p2',wk:1,ty:'easy',date:'2027-09-02',ph:'dur',ti:'Run P2'}
    ],mileagePlan:{1:40}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b62';
    STATUS={p1:'done',p2:'done'};
    NOTES={p1:{dist:'5.0',duration:'24:00'}, p2:{dist:'5.05',duration:'25:00'}};
    EXTRALOGS=[{id:'ex1',kind:'run',date:'2027-09-03',dist:'10.0',duration:'50:00'}];
    ACTIVITIES=[]; RACES_LIST=[]; CURR_BESTEFF_DIST=null;
  `);
  const a1Id = win.eval(`addActivity({type:'run',date:'2027-09-04',distanceKm:21.1,durationSec:6300,avgPace:'4:58',role:'unplanned'}).id`);

  // Test 62: every entry in bestEffortsByDistance() carries a source object identifying exactly where
  // it was logged (session/extra/activity + its own id) -- the whole point being that a tap on any
  // entry can navigate straight to it.
  const t62Groups = JSON.parse(win.eval(`JSON.stringify(bestEffortsByDistance())`));
  const t62_5k = t62Groups.find(g=>g.label==='5K');
  const t62_10k = t62Groups.find(g=>g.label==='10K');
  const t62_hm = t62Groups.find(g=>g.label==='Half Marathon');
  console.log('Test 62 (every bestEffortsByDistance entry carries a source pointing back to session/extra/activity):',
    (t62_5k && t62_5k.runs.every(r=>r.source && r.source.kind==='session') &&
     t62_10k && t62_10k.runs[0].source.kind==='extra' && t62_10k.runs[0].source.id==='ex1' &&
     t62_hm && t62_hm.runs[0].source.kind==='activity' && t62_hm.runs[0].source.id===a1Id) ? 'PASS' : 'FAIL',
    { t62Groups });

  // Test 63: renderBestEffortsByDistance() renders one tab per real distance (shortest-first), defaults
  // to the shortest as active, and shows that distance's fastest time as the "PR" hero.
  const t63HTML = win.eval(`renderBestEffortsByDistance()`);
  const t635kTabActive = /class="trend-pill active"[^>]*>5K</.test(t63HTML);
  console.log('Test 63 (Best Efforts card defaults to the shortest distance tab, showing its PR):',
    (t635kTabActive && /10K</.test(t63HTML) && /Half Marathon</.test(t63HTML) &&
     />5K PR</.test(t63HTML) && /24:00/.test(t63HTML)) ? 'PASS' : 'FAIL', { t63HTML });

  // Test 64: tapping a different distance tab (selectBestEffDist) switches which tab is active and
  // which distance's PR shows, without losing the other tabs.
  win.eval(`selectBestEffDist('10K');`);
  const t64HTML = win.eval(`renderBestEffortsByDistance()`);
  console.log('Test 64 (tapping a different distance tab switches the active tab and the PR shown):',
    (/class="trend-pill active"[^>]*>10K</.test(t64HTML) && !/class="trend-pill active"[^>]*>5K</.test(t64HTML) &&
     />10K PR</.test(t64HTML) && /50:00/.test(t64HTML)) ? 'PASS' : 'FAIL', { t64HTML });

  // Test 65: switching back to the 5K tab (which has two logged efforts) shows the faster one (24:00)
  // as the PR hero and the slower one (25:00) as a ranked row underneath it, not the other way round.
  win.eval(`selectBestEffDist('5K');`);
  const t65HTML = win.eval(`renderBestEffortsByDistance()`);
  const t65PrBeforeRanked = t65HTML.indexOf('24:00') < t65HTML.indexOf('25:00');
  console.log('Test 65 (the 5K tab shows the faster effort as the PR hero, the slower one ranked below it):',
    (/24:00/.test(t65HTML) && /25:00/.test(t65HTML) && t65PrBeforeRanked) ? 'PASS' : 'FAIL', { t65HTML });

  // Test 66: bestEffortEntryOnclick() produces working navigation for all three source kinds --
  // executing it actually opens the right session/extra/activity, confirmed via each open function's
  // own tracking variable (CURR_LOG_ID / QA_EDIT_ID / OPEN_ACTIVITY_ID).
  win.eval(`CURR_LOG_ID=null; QA_EDIT_ID=null; OPEN_ACTIVITY_ID=null;`);
  win.eval(`eval(bestEffortEntryOnclick(${JSON.stringify(t62_5k.runs[0])}));`);
  const t66Session = win.eval(`CURR_LOG_ID`);
  win.eval(`eval(bestEffortEntryOnclick(${JSON.stringify(t62_10k.runs[0])}));`);
  const t66Extra = win.eval(`QA_EDIT_ID`);
  win.eval(`eval(bestEffortEntryOnclick(${JSON.stringify(t62_hm.runs[0])}));`);
  const t66Activity = win.eval(`OPEN_ACTIVITY_ID`);
  console.log('Test 66 (tapping a Best Efforts entry opens its real source -- session, Quick Add extra, or Activity):',
    (t66Session==='p1' && t66Extra==='ex1' && t66Activity===a1Id) ? 'PASS' : 'FAIL',
    { t66Session, t66Extra, t66Activity });

  // Tests 67-70 (v0.32.6): Dylon specified an exact 10-distance list to show Best Efforts for --
  // "here are the distances i want to show best efforts for 400m 800m 1k 1 mile 2 miles 5K 10k 15k half
  // marathon marathon. if i have never run a distance then i have no data to show only show data i have
  // until i run the distance. you can also make best efforts accessable from the profile tab and give
  // it it's own section in progress i.e. separate it from the trends."

  // Test 67: BEST_EFFORT_SEARCH_DISTANCES is exactly Dylon's 10 distances, in order, nothing extra
  // (the old 2 Mile/10 Mile/20K/30K set is gone, replaced by 400m/800m). v0.32.10 prepended 100m/200m
  // -- Dylon: "add 100m and 200m as a best effort distance (helpful for strides data)".
  const t67 = JSON.parse(win.eval(`JSON.stringify(BEST_EFFORT_SEARCH_DISTANCES)`));
  const t67Expected = ['100m','200m','400m','800m','1K','1 Mile','2 Miles','5K','10K','15K','Half Marathon','Marathon'];
  console.log('Test 67 (BEST_EFFORT_SEARCH_DISTANCES is exactly the 12 distances Dylon specified, in order):',
    (t67.length===12 && t67.every((d,i)=>d.label===t67Expected[i])) ? 'PASS' : 'FAIL', { t67 });

  // Test 68: the Best Efforts card only ever produces a tab for a distance with real logged data --
  // Dylon: "if i have never run a distance then i have no data to show only show data i have until i
  // run the distance." The b62 fixture above only has runs at 5K/10K/Half Marathon, so 400m/800m/1K/
  // 1 Mile/2 Miles/15K/Marathon (never logged) must NOT show up as tabs at all.
  const t68Groups = JSON.parse(win.eval(`JSON.stringify(bestEffortsByDistance())`));
  const t68Labels = t68Groups.map(g=>g.label);
  console.log('Test 68 (only distances with real logged data get a tab -- nothing for distances never run):',
    (t68Labels.length===3 && t68Labels.includes('5K') && t68Labels.includes('10K') && t68Labels.includes('Half Marathon') &&
     !t68Labels.some(l=>['400m','800m','1K','1 Mile','2 Miles','15K','Marathon'].includes(l))) ? 'PASS' : 'FAIL',
    { t68Labels });

  // Test 69: the Best Efforts section now renders in Progress unconditionally -- "give it it's own
  // section in progress i.e. separate it from the trends" -- even while a totally different Activity
  // Trends pill/subtab (Weight, not Run/Pace) is selected, which used to hide it entirely.
  win.eval(`CURR_TREND='weight'; CURR_RUN_SUBTAB='vol'; CURR_TREND_WK=null; CURR_BESTEFF_DIST=null; renderProgress();`);
  const t69HTML = win.eval(`document.getElementById('view-progress').innerHTML`);
  console.log('Test 69 (Best Efforts section shows in Progress even when Weight, not Run/Pace, is the selected trend):',
    (/id="best-efforts-section"/.test(t69HTML) && /Best Efforts by Distance/.test(t69HTML) && />5K PR</.test(t69HTML)) ? 'PASS' : 'FAIL');

  // Test 70: Profile's "Best Efforts → View" row (openBestEffortsFromProfile) switches to the Progress
  // tab and the Best Efforts section is actually there waiting -- Dylon: "make best efforts accessable
  // from the profile tab."
  win.eval(`CURR_VIEW='profile'; switchView('profile');`);
  win.eval(`openBestEffortsFromProfile();`);
  const t70View = win.eval(`CURR_VIEW`);
  const t70HasSection = win.eval(`!!document.getElementById('best-efforts-section')`);
  console.log('Test 70 (Best Efforts is reachable from Profile -- jumps to Progress, section is there):',
    (t70View==='progress' && t70HasSection) ? 'PASS' : 'FAIL', { t70View, t70HasSection });

  // Test 71 (v0.32.7): the actual feature Dylon asked for -- "if the distance is 6km for a run you are
  // only checking 5km of that run and pulling the best 5km segment from it not checking close to 5km."
  // A synthetic 6.2km GPS stream at a constant 5:00/km pace throughout, with a whole-run distance (6.2km)
  // that does NOT itself land within ±7% of any of the 10 fixed checkpoints (nearest is 5K, 24% off --
  // would have produced nothing at all under the old whole-run-matching approach). Since the pace is
  // constant, a real continuous segment of EVERY checkpoint distance up to 5K genuinely exists inside
  // this one run -- 400m/800m/1K/1 Mile/2 Miles/5K all real, same as a real runner setting several
  // distance PRs in one race -- while 10K/15K/Half Marathon/Marathon correctly produce nothing since the
  // stream never actually covers that far.
  const CONST_PACE_SEC_PER_KM = 300; // 5:00/km
  const streamKm = [0,1,2,3,4,5,6,6.2];
  const streamDistM = streamKm.map(km=>km*1000);
  const streamT = streamKm.map(km=>iso(km*CONST_PACE_SEC_PER_KM));
  win.eval(`
    ACTIVITIES=[]; DATA=[]; STATUS={}; NOTES={}; EXTRALOGS=[]; RACES_LIST=[];
    addActivity({
      type:'run', date:'2027-10-01', durationSec:${6.2*CONST_PACE_SEC_PER_KM}, distanceKm:6.2,
      avgPace:'5:00', source:'import', role:'unplanned',
      stream:{ t:${JSON.stringify(streamT)}, lat:[], lon:[], alt:[], distM:${JSON.stringify(streamDistM)}, hr:[], cadence:[] }
    });
  `);
  const t71Groups = JSON.parse(win.eval(`JSON.stringify(bestEffortsByDistance())`));
  const t71Labels = t71Groups.map(g=>g.label);
  const t71ExpectedPresent = ['400m','800m','1K','1 Mile','2 Miles','5K'];
  const t71ExpectedAbsent = ['10K','15K','Half Marathon','Marathon'];
  const t71_5k = t71Groups.find(g=>g.label==='5K');
  console.log('Test 71 (a 6.2km GPS run -- not itself close to any standard distance -- still surfaces real segments at every shorter checkpoint, but nothing longer than the stream itself):',
    (t71ExpectedPresent.every(l=>t71Labels.includes(l)) && t71ExpectedAbsent.every(l=>!t71Labels.includes(l)) &&
     t71_5k && t71_5k.runs[0].sec===1500) ? 'PASS' : 'FAIL', { t71Labels });

  // Test 72 (v0.32.10): Dylon reported a visible scrollbar under the Best Efforts distance tab row --
  // "remove the scrollbar seen in img 2." The row already scrolls horizontally (overflow-x:auto, more
  // tabs than fit on screen); it just needs the same "scrollable but no visible scrollbar" treatment
  // (.chip-scroll, already used by the Plans-sheet filter chip rows) rather than a bare inline style.
  const t72HTML = win.eval(`renderBestEffortsByDistance()`);
  console.log('Test 72 (Best Efforts tab row uses the no-visible-scrollbar chip-scroll treatment):',
    (/class="chip-scroll"[^>]*overflow-x:auto/.test(t72HTML)) ? 'PASS' : 'FAIL');

  // Test 73 (v0.32.13): Dylon shared a star icon and asked for "coloured badges to the top 3 best
  // efforts ... gold for top best, silver for second and bronze for third." Five 5K-bucket efforts
  // (via plain EXTRALOGS run entries) give a clean PR hero + 4 ranked rows underneath -- confirms the
  // hero (rank 1) gets a gold star, the first ranked row (rank 2) gets silver, the second ranked row
  // (rank 3) gets bronze, and the last two ranked rows (ranks 4-5) get no medal at all, same plain
  // ordinal treatment as before this change.
  win.eval(`
    BLOCKS=[]; DATA=[]; STATUS={}; NOTES={}; ACTIVITIES=[]; CURR_BESTEFF_DIST=null;
    EXTRALOGS=[
      {id:'m1',kind:'run',dist:'5.0',pace:'4:00',date:'2027-09-01'},
      {id:'m2',kind:'run',dist:'5.0',pace:'4:10',date:'2027-09-02'},
      {id:'m3',kind:'run',dist:'5.0',pace:'4:20',date:'2027-09-03'},
      {id:'m4',kind:'run',dist:'5.0',pace:'4:30',date:'2027-09-04'},
      {id:'m5',kind:'run',dist:'5.0',pace:'4:40',date:'2027-09-05'}
    ];
  `);
  const t73HTML = win.eval(`renderBestEffortsByDistance()`);
  const heroIdx = t73HTML.indexOf('5K PR');
  const goldIdx = t73HTML.indexOf('var(--gold)');
  const silverIdx = t73HTML.indexOf('var(--silver)');
  const bronzeIdx = t73HTML.indexOf('var(--bronze)');
  const secondBronzeIdx = t73HTML.indexOf('var(--bronze)', bronzeIdx + 1);
  const secondSilverIdx = t73HTML.indexOf('var(--silver)', silverIdx + 1);
  console.log('Test 73 (Best Efforts hero gets a gold star, rank 2 silver, rank 3 bronze, ranks 4-5 no medal):', {
    heroIdx, goldIdx, silverIdx, bronzeIdx, secondSilverIdx, secondBronzeIdx,
    result: (heroIdx !== -1 && goldIdx !== -1 && goldIdx < heroIdx &&
      silverIdx !== -1 && bronzeIdx !== -1 && silverIdx < bronzeIdx &&
      secondSilverIdx === -1 && secondBronzeIdx === -1) ? 'PASS' : 'FAIL'
  });

  await wait(200);
  win.close();
})();
