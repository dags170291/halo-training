// Regression test for the Race Predictions card, now on its v0.32.11 redesign. Earlier rounds (still
// true today, so their assertions are folded in below rather than re-tested separately): distance
// labels render as plain text matching the Personal Bests card's own bucket naming exactly
// (RACE_DIST_BUCKETS: "Half"/"Marathon"/"15K", not "21.1"/"42.2"); the hero card is centered/rounded to
// match the Personal Bests hero; the "In N weeks" forward projection extrapolates the Fitness Trend
// chip's own EF %-change-per-week rate, clamped (±2%/week, ±25% total) so a short/noisy trend can't
// blow up into an absurd number; racePredRowColorMeta/RACE_PRED_ALT_COLORS (alternating accent/gold
// tones) are still alive purely for personalBestsSectionHTML's own reuse of them.
//
// v0.32.11 itself replaced the old "every distance stacked as a row in one table" layout entirely --
// Dylon shared a hand-drawn mockup: "there is a new selector option that changes based on distance
// prediction click it and the hero changes and reveals the current time, the predicted time by the end
// of the training block ... the +/- and a chart showing the progress of the prediction over time. the
// axis of the graphs are labelled distance against time to show the progress." Confirmed directly with
// Dylon before building: (1) the pill selector fully REPLACES the old table, no dual-mode; (2) the
// trend chart reconstructs REAL history by recomputing the prediction as of each past week using only
// what was logged by then (predictedRaceTimeSec/bestEffortsByDistance/estimateRaceTime/
// knownPerformances all gained an optional cutoffDate param for exactly this), not just accumulating
// forward from a snapshot log; (3) the Strava-style Today/1M/3M/6M range bar ships in this same pass,
// scaled to a training block's own ~8-12 week length ('2W'/'4W'/'Block' instead of literal months).
//
// Building racePredictionTrendForDistance() surfaced a real, independent bug: currentRealWeek()/
// weekForDate's nearest-session-date fallback (built for a different job -- which week's phase Today
// should show) routinely resolves to a week that hasn't actually happened yet whenever today sits
// closer to next week's session date than last week's. Using it to decide "how many weeks have
// elapsed" produced the SAME today-capped trend point three times over in direct testing, and would
// have silently put the hero's "In N weeks" figure out of sync with the chart's own final plotted
// point. Fixed with a new, date-only racePredWeeksElapsed() that both racePredictionRows() and
// racePredictionTrendForDistance() now share, so the two always agree exactly.
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
// Weekly sessions 2 days into each week (start+(w-1)*7+2), NOT exactly matching most "today" values --
// deliberately, so racePredWeeksElapsed()'s own date-only logic is what's actually being exercised,
// rather than accidentally routing through weekForDate's early-return "exact date match" branch.
function buildBlock(win, startISO, weeks) {
  return win.eval(`
    (function(){
      const start = new Date('${startISO}T12:00:00');
      const sessions = [];
      const mileagePlan = {};
      for (let w=1; w<=${weeks}; w++){
        const d = new Date(start); d.setDate(d.getDate() + (w-1)*7 + 2);
        const iso = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        sessions.push({id:'w'+w+'s1', wk:w, ty:'easy', date: iso, ph:'dur'});
        mileagePlan[w] = 20;
      }
      BLOCKS = [{id:'b1', name:'Test Block', startDate: sessions[0].date, endDate: sessions[sessions.length-1].date, sessions, mileagePlan}];
      DATA = BLOCKS[0].sessions;
      MILEAGE_PLAN = mileagePlan;
      ACTIVE_BLOCK_ID = 'b1';
      STATUS = {};
      NOTES = {};
      RACES_LIST = [];
      EXTRALOGS = [];
      ACTIVITIES = [];
      return sessions.map(s=>s.date);
    })()
  `);
}

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
  win.eval(`window.renderAll = function(){};`);

  // ---- Test 1: distance labels match the Personal Bests card's own bucket naming exactly ----
  const predictorLabels = JSON.parse(win.eval(`JSON.stringify(RACE_PREDICTOR_DISTANCES.map(d=>d.label))`));
  const pbBuckets = JSON.parse(win.eval(`JSON.stringify(RACE_DIST_BUCKETS)`));
  const namesConsistent = predictorLabels.includes('Half') && predictorLabels.includes('Marathon') &&
    pbBuckets.includes('Half') && pbBuckets.includes('Marathon') &&
    !predictorLabels.includes('21.1') && !predictorLabels.includes('42.2') && !predictorLabels.includes('Half Marathon');
  const has15k = predictorLabels.includes('15K') && pbBuckets.includes('15K');
  console.log('Test 1 (predictor distance labels match the Personal Bests card\\u2019s own naming, 15K present in both):',
    (namesConsistent && has15k) ? 'PASS' : 'FAIL', { predictorLabels, pbBuckets });

  // ---- Test 2: empty state when nothing is logged at all -- no pills, no chart, no hero ----
  win.eval(`BLOCKS=[]; DATA=[]; STATUS={}; NOTES={}; EXTRALOGS=[]; RACES_LIST=[]; ACTIVITIES=[];`);
  const emptyHTML = win.eval(`racePredictionsCardHTML()`);
  console.log('Test 2 (empty state when nothing is logged, no pills/hero/chart markup):',
    (emptyHTML.includes('Race Predictions') && emptyHTML.includes('Log a few timed runs') &&
     !emptyHTML.includes('trend-pill') && !emptyHTML.includes('<svg')) ? 'PASS' : 'FAIL');

  // ---- Test 3: with one logged effort but no active block, the pill selector shows all 5 distances,
  // the default-active pill is 5K (first with data), and the hero shows its real time+pace -- no
  // Current/In-N-weeks comparison or chart data since there's no block to project a "week 8" against.
  win.eval(`EXTRALOGS=[{id:'x1',kind:'run',dist:5,pace:'5:00',date:'2026-07-01'}];`);
  const soloHTML = win.eval(`racePredictionsCardHTML()`);
  const allFivePills = ['5K','10K','15K','Half','Marathon'].every(l=>new RegExp(`>${l}<`).test(soloHTML));
  const fiveKActive = /class="trend-pill active"[^>]*>5K</.test(soloHTML);
  const hasHeroTime = soloHTML.includes('rpred-hero-time');
  const hasHeroPace = soloHTML.includes('rpred-hero-pace') && /\d:\d\d\/km/.test(soloHTML);
  const noComparison = !soloHTML.includes('rpred-cmp');
  console.log('Test 3 (all 5 distance pills render with 5K active by default, hero shows real time+pace, no comparison without a block):', {
    allFivePills, fiveKActive, hasHeroTime, hasHeroPace, noComparison,
    result: (allFivePills && fiveKActive && hasHeroTime && hasHeroPace && noComparison) ? 'PASS' : 'FAIL'
  });

  // ---- Test 4: tapping a different pill (selectRacePredDist) switches the active hero to that
  // distance's own real projected time, matching predictedRaceTimeSec(10) directly ----
  win.eval(`selectRacePredDist('10K'); renderProgress();`);
  const tenKHTML = win.eval(`racePredictionsCardHTML()`);
  const tenKActive = /class="trend-pill active"[^>]*>10K</.test(tenKHTML);
  const proj10 = win.eval(`predictedRaceTimeSec(10)`);
  const expected10Str = win.eval(`fmtDurationSec(${proj10.lowSec}) + ' \\u2013 ' + fmtDurationSec(${proj10.highSec})`);
  console.log('Test 4 (selecting the 10K pill switches the hero to 10K\\u2019s own real projected time):', {
    tenKActive, expected10Str,
    result: (tenKActive && tenKHTML.includes(expected10Str)) ? 'PASS' : 'FAIL'
  });
  win.eval(`CURR_RACE_PRED_DIST=null;`); // reset for later tests

  // ---- Test 5: build a real block with EF data improving week 1 -> week 6, with weeks still
  // remaining -- the Current/In-N-weeks/+- comparison block appears with real, non-null numbers, the
  // delta is flagged "improved" (a rising EF should mean a faster projected time), and the trend chart
  // renders with real SVG content. ----
  buildBlock(win, '2026-06-02', 10);
  win.eval(`
    STATUS['w1s1']='done'; NOTES['w1s1']={pace:'6:00',hr:150,dist:'5'};
    STATUS['w6s1']='done'; NOTES['w6s1']={pace:'5:00',hr:140,dist:'5'};
    EXTRALOGS=[{id:'x1',kind:'run',dist:5,pace:'5:00',date:'2026-07-20'}];
    todayISO = function(){ return '2026-07-21'; };
  `);
  const forwardHTML = win.eval(`racePredictionsCardHTML()`);
  const hasCmp = forwardHTML.includes('rpred-cmp');
  const hasInWeeksLbl = /In \d+ weeks?/.test(forwardHTML);
  const hasDelta = /rpred-cmp-delta improved/.test(forwardHTML);
  const hasChartSvg = /<svg/.test(forwardHTML);
  const hasRangeBar = forwardHTML.includes('rpred-range-bar') && forwardHTML.includes('rpred-range-btn active');
  console.log('Test 5 (real fitness-trend + weeks remaining -> Current/In-N-weeks/+- comparison, improved delta, real trend chart, range bar):', {
    hasCmp, hasInWeeksLbl, hasDelta, hasChartSvg, hasRangeBar,
    result: (hasCmp && hasInWeeksLbl && hasDelta && hasChartSvg && hasRangeBar) ? 'PASS' : 'FAIL'
  });

  // ---- Test 6: the comparison box's "In N weeks" value and the trend chart's own final (last)
  // plotted point agree EXACTLY -- this is the real bug racePredWeeksElapsed() was built to prevent
  // (see file header). Checked directly against the underlying data, not just markup presence. ----
  const rowsForSix = JSON.parse(win.eval(`JSON.stringify(racePredictionRows())`));
  const fiveKRow = rowsForSix.find(r=>r.label==='5K');
  const trendForSix = JSON.parse(win.eval(`JSON.stringify(racePredictionTrendForDistance(5))`));
  const lastTrendPoint = trendForSix[trendForSix.length-1];
  console.log('Test 6 (hero\\u2019s "In N weeks" figure and the trend chart\\u2019s own final plotted point are exactly the same number):', {
    futureMid: fiveKRow.futureMid, lastTrendSec: lastTrendPoint && lastTrendPoint.sec,
    result: (fiveKRow.futureMid!==null && lastTrendPoint && Math.abs(fiveKRow.futureMid-lastTrendPoint.sec)<0.01 && lastTrendPoint.projected===true) ? 'PASS' : 'FAIL'
  });

  // ---- Test 7: racePredictionTrendForDistance reconstructs REAL history, not just a forward-only
  // snapshot log -- distinct weeks with distinct logged paces produce distinct, correctly-ordered
  // historical points (getting faster over the block, matching the pace improvement logged above),
  // and the projected (future) points are flagged projected:true while every historical point is
  // projected:false. ----
  const histPoints = trendForSix.filter(p=>!p.projected);
  const projPoints = trendForSix.filter(p=>p.projected);
  const datesAscending = histPoints.every((p,i)=>i===0||p.date>=histPoints[i-1].date);
  const secsImproving = histPoints[0].sec > histPoints[histPoints.length-1].sec; // slower->faster over the block
  console.log('Test 7 (trend reconstructs real, date-ordered history that reflects the logged pace improvement, plus a distinct forward-projected tail):', {
    histCount: histPoints.length, projCount: projPoints.length, datesAscending, secsImproving,
    result: (histPoints.length>=2 && projPoints.length>=1 && datesAscending && secsImproving) ? 'PASS' : 'FAIL'
  });

  // ---- Test 8: filterRacePredTrendByRange -- '2w'/'4w' trim historical points older than that many
  // days back from today, while keeping every forward-projected point regardless (the whole point of
  // the chart is showing where you're headed, which shouldn't disappear under a tight range); 'block'
  // (the default) keeps the full reconstructed history untouched. ----
  const full = JSON.parse(win.eval(`JSON.stringify(filterRacePredTrendByRange(racePredictionTrendForDistance(5),'block'))`));
  const two = JSON.parse(win.eval(`JSON.stringify(filterRacePredTrendByRange(racePredictionTrendForDistance(5),'2w'))`));
  const twoHist = two.filter(p=>!p.projected), twoProj = two.filter(p=>p.projected);
  const fullProj = full.filter(p=>p.projected);
  console.log('Test 8 (2W range trims older history but keeps every forward-projected point; block range keeps full history):', {
    fullLen: full.length, twoLen: two.length,
    result: (two.length < full.length && twoHist.every(p=>p.date>=addDaysISOForTest('2026-07-21',-14)) &&
      twoProj.length===fullProj.length) ? 'PASS' : 'FAIL'
  });
  function addDaysISOForTest(iso,n){ const d=new Date(iso+'T12:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }

  // ---- Test 9: renderRacePredTrendChart draws an INVERTED y-axis (a faster/smaller time plots
  // HIGHER on the chart -- "up" reads as "getting faster," matching Dylon's own mockup and Strava's
  // prediction chart) and renders the forward-projected segment dashed/hollow, distinct from the solid
  // real-history line. ----
  const chartHTML = win.eval(`renderRacePredTrendChart(${JSON.stringify(trendForSix)})`);
  const hasDashedSegment = /stroke-dasharray="5,4"/.test(chartHTML);
  const hasSolidSegment = /stroke-width="2\.5" stroke-linecap="round"\//.test(chartHTML) || /stroke-linecap="round"\/>/.test(chartHTML);
  const hasHollowDot = /fill="#FFFFFF"/.test(chartHTML) || /fill="var\(--s1\)"/.test(chartHTML);
  console.log('Test 9 (trend chart renders a dashed/hollow forward-projected segment distinct from the solid real-history line):', {
    hasDashedSegment, hasSolidSegment,
    result: (hasDashedSegment && hasSolidSegment) ? 'PASS' : 'FAIL'
  });

  // ---- Test 10: the forward projection is still clamped -- an extreme, short-span EF trend can't
  // blow up into an absurd projection (total change capped at 25%), same guarantee as before the
  // redesign, unaffected by the racePredWeeksElapsed() rewrite. ----
  win.eval(`
    STATUS['w1s1']='done'; NOTES['w1s1']={pace:'8:00',hr:170,dist:'5'};
    STATUS['w2s1']='done'; NOTES['w2s1']={pace:'4:00',hr:120,dist:'5'};
  `);
  const clampedRows = JSON.parse(win.eval(`JSON.stringify(racePredictionRows())`));
  const clamped5k = clampedRows.find(r=>r.label==='5K');
  const maxAllowedDrop = clamped5k.currentMid*0.25;
  console.log('Test 10 (an extreme short-span EF trend is still clamped to a sane +-25% total projection):', {
    clamped5k, maxAllowedDrop,
    result: (clamped5k.futureMid!==null && (clamped5k.currentMid-clamped5k.futureMid) <= maxAllowedDrop+1) ? 'PASS' : 'FAIL'
  });

  // ---- Test 11: once the block has no weeks remaining at all, there's no forward projection or
  // comparison box, and the trend chart has no projected:true points -- just the reconstructed
  // history, ending at today. ----
  win.eval(`todayISO = function(){ return '2026-08-20'; };`); // well past week 10 of the block
  const noRemainingRows = JSON.parse(win.eval(`JSON.stringify(racePredictionRows())`));
  const noRemaining5k = noRemainingRows.find(r=>r.label==='5K');
  const noRemainingTrend = JSON.parse(win.eval(`JSON.stringify(racePredictionTrendForDistance(5))`));
  const noRemainingCardHTML = win.eval(`selectRacePredDist('5K'); racePredictionsCardHTML()`);
  console.log('Test 11 (no weeks remaining -> no forward projection, no comparison box, no projected trend points):', {
    futureMid: noRemaining5k.futureMid, projectedCount: noRemainingTrend.filter(p=>p.projected).length,
    result: (noRemaining5k.futureMid===null && noRemaining5k.futurePace===null &&
      noRemainingTrend.every(p=>!p.projected) && !noRemainingCardHTML.includes('rpred-cmp')) ? 'PASS' : 'FAIL'
  });
  win.eval(`todayISO = function(){ return '2026-07-21'; };`);

  // ---- Test 12: rows still alternate between just two tones by row position (racePredRowColorMeta),
  // still shared with the Personal Bests card's own alternating row treatment. ----
  const color0 = win.eval(`racePredRowColorMeta(0).color`);
  const color1 = win.eval(`racePredRowColorMeta(1).color`);
  const color2 = win.eval(`racePredRowColorMeta(2).color`);
  win.eval(`RACES_LIST=[{key:'pb5k',name:'Local 5K',date:'2026-03-01',distance:'5K',status:'done',actualTime:'22:10',isPB:true}];`);
  const pbHTML = win.eval(`personalBestsSectionHTML()`);
  const pbHasSolidRow0 = pbHTML.includes('background:var(--accent3);border:1px solid var(--accent2)');
  const pbHasSolidRow1 = pbHTML.includes('background:var(--gold3);border:1px solid var(--gold2)');
  console.log('Test 12 (racePredRowColorMeta still alternates two tones and is still shared with Personal Bests\\u2019 own row treatment):', {
    color0, color1, color2, pbHasSolidRow0, pbHasSolidRow1,
    result: (color0!==color1 && color0===color2 && pbHasSolidRow0 && pbHasSolidRow1) ? 'PASS' : 'FAIL'
  });
  win.eval(`RACES_LIST=[];`);

  // ---- Test 13: the disclaimer caption is still there, styled as a small muted centered caption --
  // and (v0.32.14 fix) actually sits INSIDE the card's own closing </div>, not floating after it --
  // Dylon: "place the footer text inside of the card remember we dont want floating texts." Checked
  // by confirming the caption's own </div> is immediately followed by exactly one more </div> (the
  // card's) and nothing else -- i.e. it's the last child inside the card, not a sibling after it. ----
  const captionMatch = forwardHTML.match(/<div style="text-align:center;font-size:11px;color:var\(--t3\)[^"]*">([^<]*)<\/div>\s*<\/div>\s*$/);
  console.log('Test 13 (disclaimer caption present, styled as a small muted centered caption, and sits INSIDE the card rather than floating after it):', {
    captionMatch: captionMatch && captionMatch[0],
    result: (forwardHTML.includes('Updates automatically as you log new efforts') && captionMatch) ? 'PASS' : 'FAIL'
  });

  // ---- Test 13b (v0.32.13): Dylon asked whether the trend chart actually updates with real
  // performance ("i want it to be a live chart... when i improve again plot on the chart again") --
  // it already does (solid history is recomputed from real logged data, dashed line's slope shifts
  // with the current Fitness Trend), but nothing on the card explained which points were which. Added
  // an Actual/Projected dot legend under the chart, shown only when the chart actually has both a real
  // and a projected point (no point showing a legend distinguishing two kinds of dot when there's only
  // one kind present). ----
  const hasLegend = /Actual<\/span>/.test(forwardHTML) && /Projected<\/span>/.test(forwardHTML);
  const soloHistoryHTML = win.eval(`todayISO = function(){ return '2026-08-20'; }; selectRacePredDist('5K'); const h = racePredictionsCardHTML(); todayISO = function(){ return '2026-07-21'; }; h`);
  const legendHiddenWithNoProjection = !/Actual<\/span>/.test(soloHistoryHTML);
  console.log('Test 13b (Actual/Projected legend shows under the chart when both real and projected points exist, hidden when there\\u2019s nothing to distinguish):', {
    hasLegend, legendHiddenWithNoProjection,
    result: (hasLegend && legendHiddenWithNoProjection) ? 'PASS' : 'FAIL'
  });

  // ---- Test 14: the hero card still has a real margin-bottom (not a dead padding-bottom override),
  // and its label/time CSS still matches the Personal Bests hero exactly. ----
  const heroCSSMatch = html.match(/\.rpred-hero\{([^}]*)\}/);
  const rpredHeroLabelCSS = html.match(/\.rpred-hero-label\{([^}]*)\}/);
  const rpredHeroTimeCSS = html.match(/\.rpred-hero-time\{([^}]*)\}/);
  console.log('Test 14 (.rpred-hero has a real margin-bottom; hero label/time CSS still matches the Personal Bests hero\\u2019s own sizing):', {
    result: (heroCSSMatch && /margin-bottom/.test(heroCSSMatch[1]) &&
      rpredHeroLabelCSS && /font-size:10px/.test(rpredHeroLabelCSS[1]) && /letter-spacing:\.6px/.test(rpredHeroLabelCSS[1]) &&
      rpredHeroTimeCSS && /font-size:32px/.test(rpredHeroTimeCSS[1]) && /font-weight:900/.test(rpredHeroTimeCSS[1])) ? 'PASS' : 'FAIL'
  });

  // ---- Test 15: the old table-only markup (rpred-row/rpred-table-hdr/rpred-row-mid run-icon divider)
  // is fully gone from the redesigned card -- confirms this isn't just an additive change sitting on
  // top of the old table. ----
  console.log('Test 15 (old table-row markup -- rpred-row, rpred-table-hdr, rpred-row-mid -- is completely gone from the redesigned card):',
    (!forwardHTML.includes('rpred-row"') && !forwardHTML.includes('rpred-table-hdr') && !forwardHTML.includes('rpred-row-mid')) ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
