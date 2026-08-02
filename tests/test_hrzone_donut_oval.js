// Regression test for the donut/pie charts' wide-card-filling shape -- originally "make pie charts
// more oval" (v0.34.20), then CORRECTED in v0.34.21 after Dylon rejected that first attempt outright:
// "this is how i want the zones card to be redesigned not how you did it. it should also look this
// way for the activity heart rate zones as well," with a mockup showing a literal stadium/race-track
// ring -- flat straight top/bottom edges, semicircular rounded ends -- not the continuously-curved
// ellipse v0.34.20 produced by non-uniformly stretching a circle via preserveAspectRatio="none". A
// non-uniform scale of a circle can only ever yield an ellipse, so v0.34.21 replaced that hack with
// real stadium-perimeter path geometry (hrZoneStadiumGeom/hrZoneStadiumPoint/hrZoneStadiumVertices/
// hrZoneStadiumSectorPath/hrZoneStadiumSlices, see their own big comment in index.html), built directly
// in viewBox coordinates at a fixed wide aspect ratio and scaled uniformly via CSS aspect-ratio on the
// wrapper -- no more preserveAspectRatio="none" anywhere. Both donuts (Weekly Zone Time's
// renderZoneTrendDonut and the per-activity Effort card's activityHRZoneDonutSVG) share this exact
// same geometry per Dylon's explicit instruction that both must match.
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

  // ---- Test 1: .hrzone-donut-wrap is width:100% with a CSS aspect-ratio matching the stadium
  // viewBox's own 320:140 ratio -- NOT a fixed height anymore, so it scales fluidly with card width. ----
  const wrapCSSMatch = html.match(/\.hrzone-donut-wrap\{([^}]*)\}/);
  const wrapCSS = wrapCSSMatch ? wrapCSSMatch[1] : '';
  console.log('Test 1 (.hrzone-donut-wrap is width:100% with aspect-ratio:320/140, no fixed height):',
    (/width:100%/.test(wrapCSS) && /aspect-ratio:320\/140/.test(wrapCSS) && !/height:132px/.test(wrapCSS)) ? 'PASS' : 'FAIL', { wrapCSS });

  // ---- Test 2: activityHRZoneDonutSVG (the per-activity Effort card's donut) renders width="100%"
  // height="100%" with a real 320x140 stadium viewBox, and NO preserveAspectRatio="none" hack --
  // the shape is genuinely stadium-shaped in its own coordinates now, no distortion trick needed. ----
  const zones = [
    {label:'Zone 1',name:'Recovery',sec:60,pct:20},
    {label:'Zone 2',name:'Aerobic',sec:120,pct:40},
    {label:'Zone 3',name:'Tempo',sec:90,pct:30},
    {label:'Zone 4',name:'Threshold',sec:30,pct:10},
    {label:'Zone 5',name:'Max',sec:0,pct:0}
  ];
  const svgHTML = win.eval(`activityHRZoneDonutSVG(${JSON.stringify(zones)},'act','a1',null)`);
  console.log('Test 2 (activityHRZoneDonutSVG uses width="100%" height="100%", viewBox 0 0 320 140, no preserveAspectRatio="none"):',
    (svgHTML.includes('width="100%"') && svgHTML.includes('height="100%"') && svgHTML.includes('viewBox="0 0 320 140"') && !svgHTML.includes('preserveAspectRatio')) ? 'PASS' : 'FAIL', { svgHTML });

  // ---- Test 3: the wedge paths carry vector-effect="non-scaling-stroke" so the 2px separator stays
  // crisp/uniform regardless of how much the CSS aspect-ratio scales the SVG. ----
  console.log('Test 3 (wedge paths use vector-effect="non-scaling-stroke" to keep the separator uniform):',
    svgHTML.includes('vector-effect="non-scaling-stroke"') ? 'PASS' : 'FAIL');

  // ---- Test 4: the callout's position is expressed in % for BOTH left and top now (not px for top) --
  // required since the wrap's height is no longer fixed, it scales with the wrap's real rendered size. ----
  const calloutHTML = win.eval(`activityHRZoneDonutOverlayHTML(${JSON.stringify(zones)},1)`);
  const calloutStyleMatch = calloutHTML.match(/style="left:([\d.]+)(%|px);top:([\d.]+)(%|px)"/);
  console.log('Test 4 (the callout\'s left AND top position are both in %, not px):',
    (calloutStyleMatch && calloutStyleMatch[2] === '%' && calloutStyleMatch[4] === '%') ? 'PASS' : 'FAIL', { calloutHTML, calloutStyleMatch });

  // ---- Test 5: same checks (width/height=100%, real stadium viewBox, no preserveAspectRatio, %
  // callout) for the Weekly Zone Time card's own inline donut (renderZoneTrendDonut), not just the
  // per-activity one -- Dylon: "it should also look this way for the activity heart rate zones as well." ----
  win.eval(`
    HRZONE_LAST={...computeHRZones({age:30,maxHRFormula:'tanaka'}),method:'karvonen'};
    PROFILE.savedHRZones={...HRZONE_LAST};
  `);
  const weeksData = [{wk:1,zones:zones.map(z=>({label:z.label,name:z.name,sec:z.sec}))}];
  win.eval(`ZONE_TREND_SELIDX={hr:1,pace:null};`);
  const zoneTrendHTML = win.eval(`renderZoneTrendDonut('hr',${JSON.stringify(weeksData)},1)`);
  const t5SvgOk = zoneTrendHTML.includes('width="100%"') && zoneTrendHTML.includes('height="100%"') && zoneTrendHTML.includes('viewBox="0 0 320 140"') && !zoneTrendHTML.includes('preserveAspectRatio');
  const t5CalloutMatch = zoneTrendHTML.match(/hrzone-callout" style="left:([\d.]+)(%|px);top:([\d.]+)(%|px)"/);
  console.log('Test 5 (renderZoneTrendDonut also uses the same stadium viewBox + %/% callout pattern):',
    (t5SvgOk && t5CalloutMatch && t5CalloutMatch[2] === '%' && t5CalloutMatch[4] === '%') ? 'PASS' : 'FAIL', { t5SvgOk, t5CalloutMatch });

  // ---- Test 6: hrZoneStadiumSectorPath produces well-formed "M ... Z" path strings with no NaN, for
  // every non-zero wedge in both donuts -- a malformed/NaN path would silently render nothing. ----
  const allDAttrs = [...svgHTML.matchAll(/d="([^"]+)"/g)].map(m=>m[1]).concat([...zoneTrendHTML.matchAll(/d="([^"]+)"/g)].map(m=>m[1]));
  const wellFormed = allDAttrs.length>0 && allDAttrs.every(d => /^M [\d.-]+ [\d.-]+ /.test(d) && d.trim().endsWith('Z') && !d.includes('NaN'));
  console.log('Test 6 (every wedge\'s d attribute is a well-formed M...Z path with no NaN):',
    wellFormed ? 'PASS' : 'FAIL', { count: allDAttrs.length, sample: allDAttrs[0] });

  // ---- Test 7: adjacent wedges' outer boundaries meet exactly at the shared zone-boundary arc-length
  // -- hrZoneStadiumSlices' cumulative s1/s2 should produce zero gap/overlap between consecutive
  // non-zero zones (the geometry's whole "clean radial cuts" promise). ----
  const geomCheck = JSON.parse(win.eval(`
    (function(){
      var geom = hrZoneStadiumGeom(320,140,30);
      var slices = hrZoneStadiumSlices(${JSON.stringify(zones)}, geom);
      return JSON.stringify({total: geom.total, sliceTotal: slices.reduce(function(a,s){return a+s.span;},0), s1s2: slices.map(function(s){return [s.s1,s.s2];})});
    })()
  `));
  const gapsOk = geomCheck.s1s2.every((pair,i) => i===0 || Math.abs(pair[0]-geomCheck.s1s2[i-1][1])<1e-6);
  const totalsMatch = Math.abs(geomCheck.total - geomCheck.sliceTotal) < 1e-6;
  console.log('Test 7 (adjacent wedges share exact boundary arc-lengths, slices sum to the stadium\'s full perimeter):',
    (gapsOk && totalsMatch) ? 'PASS' : 'FAIL', geomCheck);

  // ---- Test 8: .zonewk-legend-dot is a rounded square now (per the mockup's legend swatches), not
  // a circular dot. ----
  const dotCSSMatch = html.match(/\.zonewk-legend-dot\{([^}]*)\}/);
  const dotCSS = dotCSSMatch ? dotCSSMatch[1] : '';
  console.log('Test 8 (.zonewk-legend-dot is a rounded square, not a circular dot):',
    (/border-radius:3px/.test(dotCSS) && !/border-radius:50%/.test(dotCSS)) ? 'PASS' : 'FAIL', { dotCSS });

  await wait(200);
  win.close();
})();
