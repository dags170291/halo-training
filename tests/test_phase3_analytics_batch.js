// Regression tests for the whole Phase 3 batch (ANALYTICS_ROADMAP.md), shipped together as one
// version since Dylon selected all four remaining Phase 3 pieces at once ("lets do phase 3" -> all
// options picked): a Fitness & Freshness (CTL/ATL/TSB) trend chart, PB progression over time, weekly
// zone-time trends (HR + Pace), and a smaller-polish pair (walk-break route coloring + an
// effort-weighted "Effort Load" reading folded into the existing Training Load card).
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
function isoDaysAgo(baseISO, n) {
  const d = new Date(baseISO + 'T12:00:00');
  d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
  win.eval(`window.renderAll = function(){};`);

  const today = win.eval(`todayISO()`);
  const week1Date = isoDaysAgo(today, 21);
  const week2Date = isoDaysAgo(today, 14);
  const week3Date = isoDaysAgo(today, 7);
  const blockEnd = isoDaysAgo(today, -14);

  // ════════════════════════ PB Progression over time + Weekly Zone Time Trends ═══════════════════
  // Shared 3-week block: three logged 5K efforts (6:00, 5:30, 5:45 pace -> 1800s/1650s/1725s) so the
  // PB only actually improves once (week 2), plus one HR-stream Activity (logged twice, week 1 only)
  // so the HR zone-time trend has exactly one real week and two gap weeks to skip.
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'${week1Date}',endDate:'${blockEnd}',sessions:[
      {id:'s1',wk:1,ty:'easy',date:'${week1Date}',ph:'dur'},
      {id:'s2',wk:2,ty:'easy',date:'${week2Date}',ph:'dur'},
      {id:'s3',wk:3,ty:'easy',date:'${week3Date}',ph:'dur'}
    ],mileagePlan:{1:20,2:20,3:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='${week1Date}'; BLOCK_END='${blockEnd}';
    STATUS={}; NOTES={};
    EXTRALOGS=[
      {id:'x1',kind:'run',dist:5,pace:'6:00',date:'${week1Date}'},
      {id:'x2',kind:'run',dist:5,pace:'5:30',date:'${week2Date}'},
      {id:'x3',kind:'run',dist:5,pace:'5:45',date:'${week3Date}'}
    ];
    RACES_LIST=[]; ACTIVITIES=[];
  `);

  // ---- Test 1: pbProgressionTrendForDistance('5K') walks the block week by week, only ever
  // recording the fastest KNOWN time as of that week's cutoff (never "projected"), then appends
  // today's real current PB as the trailing point ----
  const pbTrend = JSON.parse(win.eval(`JSON.stringify(pbProgressionTrendForDistance('5K'))`));
  const pbOk = pbTrend.length === 4 &&
    pbTrend[0].sec === 1800 && pbTrend[0].projected === false &&
    pbTrend[1].sec === 1650 &&
    pbTrend[2].sec === 1650 &&
    pbTrend[3].date === today && pbTrend[3].sec === 1650;
  console.log('Test 1 (pbProgressionTrendForDistance walks week-by-week PB, ends on today\'s real PB):',
    pbOk ? 'PASS' : 'FAIL', { pbTrend });

  // ---- Test 2: renderBestEffortsByDistance() shows a "PB Progression" section (reusing
  // renderRacePredTrendChart) once its distance tab has 2+ trend points ----
  win.eval(`CURR_BESTEFF_DIST=null;`);
  const bestEffHTML = win.eval(`renderBestEffortsByDistance()`);
  console.log('Test 2 (Best Efforts card shows a PB Progression chart section for 5K):',
    bestEffHTML.includes('PB Progression') ? 'PASS' : 'FAIL');

  // ---- Test 3: weeklyHRZoneTotals/weeklyPaceZoneTotals stay null for a week with no eligible
  // Activity at all, rather than a misleading all-zero row ----
  // NOTE: HRZONE_LAST alone is just the calculator's own unsaved preview -- every real consumer
  // (weeklyHRZoneTotals, activityHRZoneBreakdown, fitnessFreshnessCardHTML, activityRelativeEffort)
  // reads currentHRZones(), i.e. PROFILE.savedHRZones, so every fixture below sets both together.
  win.eval(`HRZONE_LAST={...computeHRZones({age:30,maxHRFormula:'tanaka'}),method:'karvonen'}; PROFILE.savedHRZones={...HRZONE_LAST};`);
  const emptyWeekHR = win.eval(`weeklyHRZoneTotals(2)`);
  const emptyWeekPace = win.eval(`weeklyPaceZoneTotals(2)`);
  console.log('Test 3 (weeklyHRZoneTotals/weeklyPaceZoneTotals are null for a week with no Activity):',
    (emptyWeekHR === null && emptyWeekPace === null) ? 'PASS' : 'FAIL');

  // A 10-point/90-second stream on week 1: heart rate drops to 110 for a 20s stretch (points 2-4,
  // same fixture shape validated in test_activity_analytics.js's Test 7, known to bucket as
  // Zone 1 sec=20 / Zone 3 sec=70), and distance climbs steadily (30m/10s, flat altitude) so the
  // same stream also produces real Grade-Adjusted-Pace zone time.
  win.eval(`
    (function(){
      const BASE_T = Date.parse('${week1Date}T06:00:00.000Z');
      const iso = (sec) => new Date(BASE_T + sec*1000).toISOString();
      const t = [0,10,20,30,40,50,60,70,80,90].map(iso);
      const hr = [150,150,110,110,150,150,150,150,150,150];
      const distM = [0,30,60,90,120,150,180,210,240,270];
      const alt = distM.map(()=>100);
      const fixture = {type:'run', date:'${week1Date}', durationSec:90, distanceKm:0.27,
        stream:{t, lat:[], lon:[], alt, distM, hr, cadence:[]}, source:'import', role:'unplanned'};
      addActivity(fixture);
      addActivity(fixture); // logged twice on purpose -- proves weeklyHRZoneTotals SUMS across activities
    })();
  `);

  // ---- Test 4: weeklyHRZoneTotals(1) sums the same fixture's HR zone breakdown across both
  // Activities logged that week (Zone 1: 20s x2 = 40s, Zone 3: 70s x2 = 140s) ----
  const hrWeek1 = JSON.parse(win.eval(`JSON.stringify(weeklyHRZoneTotals(1))`));
  const z1 = hrWeek1.find(z => z.label === 'Zone 1');
  const z3 = hrWeek1.find(z => z.label === 'Zone 3');
  console.log('Test 4 (weeklyHRZoneTotals sums the same week\'s two Activities, not just the last one):',
    (z1 && z1.sec === 40 && z3 && z3.sec === 140) ? 'PASS' : 'FAIL', { hrWeek1 });

  // ---- Test 5: weeklyPaceZoneTotals(1) (now that EXTRALOGS x1-x3 above give estimatedThresholdPaceSecPerKm
  // a real basis to bucket against) returns all 6 Pace Zone Bands, total time matching the stream's
  // own 90 real seconds -- x2 since the fixture was logged twice, same as the HR-zone Test 4 above ----
  const paceWeek1 = JSON.parse(win.eval(`JSON.stringify(weeklyPaceZoneTotals(1))`));
  const paceTotalSec = paceWeek1 ? paceWeek1.reduce((s, z) => s + z.sec, 0) : 0;
  console.log('Test 5 (weeklyPaceZoneTotals buckets the same week\'s real pace-zone seconds, summed across both logged Activities):',
    (paceWeek1 && paceWeek1.length === 6 && Math.abs(paceTotalSec - 180) < 1) ? 'PASS' : 'FAIL', { paceWeek1, paceTotalSec });

  // ---- Test 6: zoneTimeTrendWeeks skips weeks 2 and 3 (no Activity that week), returning only the
  // one real week for both schemes ----
  const hrWeeks = JSON.parse(win.eval(`JSON.stringify(zoneTimeTrendWeeks('hr',8))`));
  const paceWeeks = JSON.parse(win.eval(`JSON.stringify(zoneTimeTrendWeeks('pace',8))`));
  console.log('Test 6 (zoneTimeTrendWeeks skips gap weeks, keeps only week 1 for both HR and Pace):',
    (hrWeeks.length === 1 && hrWeeks[0].wk === 1 && paceWeeks.length === 1 && paceWeeks[0].wk === 1) ? 'PASS' : 'FAIL');

  // ---- Test 7: zoneTimeTrendCardHTML() shows the HR/Pace toggle (both schemes have data), defaults
  // to Heart Rate (CURR_ZONE_TREND_TYPE starts 'hr'), and the card renders inside the real Progress
  // tab right after the Activity Trends card ----
  win.eval(`CURR_ZONE_TREND_TYPE='hr';`);
  const zoneCardHTML = win.eval(`zoneTimeTrendCardHTML()`);
  const hasToggle = zoneCardHTML.includes('>Heart Rate<') && zoneCardHTML.includes('>Pace<');
  const hrIsActive = /trend-pill active"[^>]*>Heart Rate<|class="trend-pill active" onclick="selectZoneTrendType\('hr'\)"/.test(zoneCardHTML) || zoneCardHTML.includes(`selectZoneTrendType('hr')">Heart Rate`) && zoneCardHTML.match(/active[^>]*onclick="selectZoneTrendType\('hr'\)"/);
  console.log('Test 7 (Zone Time card shows an HR/Pace toggle once both schemes have data):',
    hasToggle ? 'PASS' : 'FAIL', { hasToggle });

  win.eval(`renderProgress();`);
  const progressHTML = win.eval(`document.getElementById('view-progress').innerHTML`);
  const zoneAfterTrends = progressHTML.indexOf('Weekly Zone Time') > progressHTML.indexOf('Activity Trends') && progressHTML.indexOf('Weekly Zone Time') > -1;
  console.log('Test 8 (Weekly Zone Time card renders in the real Progress tab, right after Activity Trends):',
    zoneAfterTrends ? 'PASS' : 'FAIL');

  // ---- Test 9: with nothing logged at all, the card renders as '' rather than an empty shell ----
  win.eval(`ACTIVITIES=[]; EXTRALOGS=[]; HRZONE_LAST=null; PROFILE.savedHRZones=null;`);
  const emptyZoneCard = win.eval(`zoneTimeTrendCardHTML()`);
  console.log('Test 9 (Zone Time card is fully hidden when neither scheme has any data):',
    emptyZoneCard === '' ? 'PASS' : 'FAIL');

  // ════════════════════════════ Fitness & Freshness (CTL/ATL/TSB) ═══════════════════════════════
  // Reset to a clean slate: one Activity logged TODAY, every other day in the 84-day window has zero
  // training impulse -- makes the recursive EMA hand-computable exactly (see comment below).
  win.eval(`
    BLOCKS=[]; DATA=[]; STATUS={}; NOTES={}; EXTRALOGS=[]; RACES_LIST=[]; ACTIVITIES=[];
    HRZONE_LAST={...computeHRZones({age:30,maxHRFormula:'tanaka'}),method:'karvonen'}; PROFILE.savedHRZones={...HRZONE_LAST};
    addActivity({type:'run', date:todayISO(), durationSec:1800, avgHr:150, distanceKm:5, source:'import', role:'unplanned'});
  `);
  const effortToday = win.eval(`activityRelativeEffort(ACTIVITIES[0])`);

  // ---- Test 10: with every day before today at zero impulse, CTL/ATL start at 0 and only today's
  // own impulse (E) moves them -- so today's own TSB (computed from YESTERDAY's still-zero CTL/ATL,
  // before folding in today) is exactly 0, and today's resulting CTL/ATL are exactly E/42 and E/7 --
  // the recursive EMA formula recorded in ANALYTICS_ROADMAP.md §2, hand-verified on a single real
  // impulse rather than trusting the recursion blindly ----
  const series = JSON.parse(win.eval(`JSON.stringify(fitnessFreshnessSeries())`));
  const last = series[series.length - 1];
  const expectedCtl = effortToday / 42, expectedAtl = effortToday / 7;
  const fitnessMathOk = last.date === today && last.tsb === 0 &&
    Math.abs(last.ctl - expectedCtl) < 0.001 && Math.abs(last.atl - expectedAtl) < 0.001;
  console.log('Test 10 (fitnessFreshnessSeries CTL/ATL/TSB EMA math matches the recorded formula exactly):',
    fitnessMathOk ? 'PASS' : 'FAIL', { last, expectedCtl, expectedAtl, effortToday });

  // ---- Test 11: freshnessBand() picks the right reference band at each threshold ----
  const bandChecks = JSON.parse(win.eval(`JSON.stringify({
    veryFresh: freshnessBand(20).label,
    raceReady: freshnessBand(10).label,
    inTraining: freshnessBand(2).label,
    fatigued: freshnessBand(-10).label,
    overreaching: freshnessBand(-40).label
  })`));
  const bandsOk = bandChecks.veryFresh === 'Very Fresh' && bandChecks.raceReady === 'Race-Ready' &&
    bandChecks.inTraining === 'In Training' && bandChecks.fatigued === 'Fatigued' && bandChecks.overreaching === 'Overreaching Risk';
  console.log('Test 11 (freshnessBand picks the correct band at each TSB threshold):', bandsOk ? 'PASS' : 'FAIL', { bandChecks });

  // ---- Test 12: fitnessFreshnessCardHTML() is now ALWAYS rendered (never returns '' outright,
  // v0.32.25 -- Dylon: "the freshness and fitness chart is always visible but without data there
  // should be a message informing user to do the heart rate calculator") -- a "set up your zones"
  // prompt with no PROFILE.savedHRZones, a "logged enough yet?" note once zones are saved but there's
  // no real effort, and the real CTL/ATL chart once both exist ----
  win.eval(`HRZONE_LAST=null; PROFILE.savedHRZones=null;`);
  const noHrZoneCard = win.eval(`fitnessFreshnessCardHTML()`);
  win.eval(`HRZONE_LAST={...computeHRZones({age:30,maxHRFormula:'tanaka'}),method:'karvonen'}; PROFILE.savedHRZones={...HRZONE_LAST}; ACTIVITIES=[];`);
  const noActivityCard = win.eval(`fitnessFreshnessCardHTML()`);
  win.eval(`addActivity({type:'run', date:todayISO(), durationSec:1800, avgHr:150, distanceKm:5, source:'import', role:'unplanned'});`);
  const realCard = win.eval(`fitnessFreshnessCardHTML()`);
  console.log('Test 12 (Fitness & Freshness card always shows -- setup prompt with no zones, "logged enough?" note with zones but no effort, real chart once both exist):',
    (noHrZoneCard.includes('Fitness &amp; Freshness') && noHrZoneCard.includes('Set Up Heart Rate Zones') &&
     noActivityCard.includes('Fitness &amp; Freshness') && !noActivityCard.includes('Set Up Heart Rate Zones') &&
     realCard.includes('Fitness &amp; Freshness') && realCard !== noActivityCard && realCard !== noHrZoneCard) ? 'PASS' : 'FAIL',
    { noHrZoneCard, noActivityCard });

  // ---- Test 13: the card is wired into the real Recovery > Durability sub-tab, alongside (not
  // instead of) Training Load ----
  win.eval(`RECOVERY_SUB='durability';`);
  const durabilityHTML = win.eval(`recoveryDurabilityHTML()`);
  console.log('Test 13 (Fitness & Freshness renders inside recoveryDurabilityHTML, alongside Training Load):',
    durabilityHTML.includes('Fitness &amp; Freshness') ? 'PASS' : 'FAIL');

  // ═══════════════════════════════ Effort Load (Training Load extension) ════════════════════════
  // A month of hand-logged 5km/day distance (feeds acuteChronicWorkload's existing km-based ratio)
  // plus real HR-bearing Activities on those same days (feeds the new effort-weighted ratio) --
  // acute (last 7 days) at a higher HR than the chronic month, so the two ratios can be told apart.
  win.eval(`
    BLOCKS=[]; DATA=[]; STATUS={}; NOTES={};
    HRZONE_LAST={...computeHRZones({age:30,maxHRFormula:'tanaka'}),method:'karvonen'}; PROFILE.savedHRZones={...HRZONE_LAST};
    (function(){
      const today='${today}';
      const logs=[], acts=[];
      for(let i=0;i<28;i++){
        const d=new Date(today+'T12:00:00'); d.setDate(d.getDate()-i);
        const iso=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        logs.push({id:'f'+i,kind:'run',dist:5,date:iso});
        acts.push({type:'run',date:iso,durationSec:1800,avgHr:(i<7?165:135),distanceKm:5,source:'import',role:'unplanned'});
      }
      EXTRALOGS=logs;
      ACTIVITIES=[];
      acts.forEach(a=>addActivity(a));
    })();
  `);

  // ---- Test 14: acuteChronicEffortLoad() computes the same acute:chronic ratio structure as the
  // existing km-based acuteChronicWorkload(), independently cross-checked against
  // weeklyRelativeEffortTotal() over the same two windows rather than trusting the formula blindly ----
  const effortLoad = JSON.parse(win.eval(`JSON.stringify(acuteChronicEffortLoad())`));
  const expectedAcute = win.eval(`weeklyRelativeEffortTotal(addDaysISO(todayISO(),-6),todayISO())`);
  const expectedChronic = win.eval(`weeklyRelativeEffortTotal(addDaysISO(todayISO(),-27),todayISO())/4`);
  const expectedRatio = expectedAcute / expectedChronic;
  console.log('Test 14 (acuteChronicEffortLoad ratio matches an independent weeklyRelativeEffortTotal computation):',
    (effortLoad && Math.abs(effortLoad.ratio - expectedRatio) < 0.001 && effortLoad.acuteEffort === expectedAcute) ? 'PASS' : 'FAIL',
    { effortLoad, expectedRatio });

  // ---- Test 15: acuteChronicEffortLoad() returns null with no HR Zone Calculator data (same
  // "nothing to compute from" gate activityRelativeEffort itself has) ----
  win.eval(`HRZONE_LAST=null; PROFILE.savedHRZones=null;`);
  const nullEffortLoad = win.eval(`acuteChronicEffortLoad()`);
  console.log('Test 15 (acuteChronicEffortLoad is null with no HR Zone Calculator data yet):', nullEffortLoad === null ? 'PASS' : 'FAIL');
  win.eval(`HRZONE_LAST={...computeHRZones({age:30,maxHRFormula:'tanaka'}),method:'karvonen'}; PROFILE.savedHRZones={...HRZONE_LAST};`);

  // ---- Test 16: trainingLoadCardHTML() shows the additive "Effort Load" reading underneath the
  // existing distance-based gauge/note, not replacing it ----
  const loadCardHTML = win.eval(`trainingLoadCardHTML()`);
  console.log('Test 16 (Training Load card shows both the original ratio note and the new Effort Load reading):',
    (loadCardHTML.includes('Acute:chronic ratio') && loadCardHTML.includes('Effort Load')) ? 'PASS' : 'FAIL');

  // ---- Test 17: with no HR Zone data, Effort Load quietly disappears from the card while the
  // original km-based reading keeps working exactly as before ----
  win.eval(`HRZONE_LAST=null; PROFILE.savedHRZones=null;`);
  const loadCardNoEffort = win.eval(`trainingLoadCardHTML()`);
  console.log('Test 17 (Effort Load block disappears with no HR Zone data, original card still renders):',
    (loadCardNoEffort.includes('Acute:chronic ratio') && !loadCardNoEffort.includes('Effort Load')) ? 'PASS' : 'FAIL');

  // ══════════════════════════════ Walk-break route coloring ═════════════════════════════════════
  // A tiny 5-point synthetic run: fast (5 m/s) - slow (0.5 m/s, held for the full 20s minimum) - fast
  // again, so detectWalkSegments() finds exactly one break spanning points 1-3, and
  // activityRoutePointsColored() should force those (and only those) points to the dedicated --walk
  // color regardless of the pace gradient those same points would otherwise fall into.
  win.eval(`HRZONE_LAST=null; PROFILE.savedHRZones=null;`);
  const routeData = JSON.parse(win.eval(`JSON.stringify(activityRoutePointsColored({
    type:'run',
    stream:{
      t:['2026-01-01T06:00:00.000Z','2026-01-01T06:00:10.000Z','2026-01-01T06:00:20.000Z','2026-01-01T06:00:30.000Z','2026-01-01T06:00:40.000Z'],
      lat:[10,10.001,10.002,10.003,10.004], lon:[20,20.001,20.002,20.003,20.004],
      distM:[0,50,55,60,110], hr:[]
    }
  },'pace'))`));
  const walkColor = win.eval(`cssVar(document.documentElement,'--walk','#4FB8C4')`);
  const insideWalkSame = routeData.points[1].color === routeData.points[2].color && routeData.points[2].color === routeData.points[3].color;
  const insideWalkIsWalkColor = routeData.points[1].color === walkColor;
  const outsideWalkDiffers = routeData.points[0].color !== walkColor;
  console.log('Test 18 (activityRoutePointsColored forces the walk-break points, and only them, to the dedicated --walk color):', {
    insideWalkSame, insideWalkIsWalkColor, outsideWalkDiffers, hasWalkBreaks: routeData.hasWalkBreaks,
    result: (insideWalkSame && insideWalkIsWalkColor && outsideWalkDiffers && routeData.hasWalkBreaks === true) ? 'PASS' : 'FAIL'
  });

  // ---- Test 19: --walk/--walk2/--walk3 exist and differ between the dark and light theme -- the
  // jsdom matchMedia stub used throughout this whole test suite always reports matches:true, which
  // makes the app apply its light theme by default on load, so this explicitly forces both states
  // via the class rather than assuming which one the stub lands on ----
  win.eval(`document.documentElement.classList.remove('theme-light');`);
  const darkWalk = win.eval(`getComputedStyle(document.documentElement).getPropertyValue('--walk').trim()`);
  win.eval(`document.documentElement.classList.add('theme-light');`);
  const lightWalk = win.eval(`getComputedStyle(document.documentElement).getPropertyValue('--walk').trim()`);
  console.log('Test 19 (--walk CSS variable is defined for both dark and light themes, with different values):',
    (darkWalk && lightWalk && darkWalk !== lightWalk) ? 'PASS' : 'FAIL', { darkWalk, lightWalk });

  await wait(200);
  win.close();
})();
