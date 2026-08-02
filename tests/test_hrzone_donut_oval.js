// Regression test for the donut/pie charts becoming a wide oval instead of a fixed 132x132 square.
// Dylon: "Make pie charts more oval shape to take up space (width across its card container) sor of
// like a standard race track." Both donuts (Weekly Zone Time's renderZoneTrendDonut and the
// per-activity Effort card's activityHRZoneDonutSVG) share the same underlying circular geometry
// helpers (hrZoneAnnularPath/activityHRZonePieSlices) -- completely unchanged. The stretch comes
// entirely from the <svg> tag itself: width="100%" (was a fixed 132) + preserveAspectRatio="none",
// which tells the browser to map that same circular geometry onto however wide the real container is,
// distorting it into a wide oval with zero new coordinate math. The one place that DOES need new math
// is the floating callout label's horizontal position -- it's now expressed in % of the wrap's width
// rather than a fixed px value computed from the old 132-wide viewBox, so it still lands on the
// visually-stretched wedge regardless of how wide the container actually renders.
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

  // ---- Test 1: .hrzone-donut-wrap is width:100% now, not a fixed 132px square -- the CSS is what
  // actually makes the card-spanning width happen. ----
  const wrapCSSMatch = html.match(/\.hrzone-donut-wrap\{([^}]*)\}/);
  const wrapCSS = wrapCSSMatch ? wrapCSSMatch[1] : '';
  console.log('Test 1 (.hrzone-donut-wrap is width:100% (not a fixed 132px square), height still fixed at 132px):',
    (/width:100%/.test(wrapCSS) && /height:132px/.test(wrapCSS)) ? 'PASS' : 'FAIL', { wrapCSS });

  // ---- Test 2: activityHRZoneDonutSVG (the per-activity Effort card's donut) renders width="100%"
  // and preserveAspectRatio="none" -- the actual stretch mechanism. ----
  const zones = [
    {label:'Zone 1',name:'Recovery',sec:60,pct:20},
    {label:'Zone 2',name:'Aerobic',sec:120,pct:40},
    {label:'Zone 3',name:'Tempo',sec:90,pct:30},
    {label:'Zone 4',name:'Threshold',sec:30,pct:10},
    {label:'Zone 5',name:'Max',sec:0,pct:0}
  ];
  const svgHTML = win.eval(`activityHRZoneDonutSVG(${JSON.stringify(zones)},'act','a1',null)`);
  console.log('Test 2 (activityHRZoneDonutSVG uses width="100%" and preserveAspectRatio="none"):',
    (svgHTML.includes('width="100%"') && svgHTML.includes('preserveAspectRatio="none"')) ? 'PASS' : 'FAIL', { svgHTML });

  // ---- Test 3: the wedge paths carry vector-effect="non-scaling-stroke" so the 2px separator stays
  // crisp/uniform despite the non-uniform horizontal stretch. ----
  console.log('Test 3 (wedge paths use vector-effect="non-scaling-stroke" to keep the separator uniform):',
    svgHTML.includes('vector-effect="non-scaling-stroke"') ? 'PASS' : 'FAIL');

  // ---- Test 4: the callout's horizontal position is expressed in %, not a fixed px value computed
  // from the old 132-wide viewBox -- required for it to still land on the wedge once the SVG is
  // actually stretched to some other real width by the browser. ----
  const calloutHTML = win.eval(`activityHRZoneDonutOverlayHTML(${JSON.stringify(zones)},1)`);
  const calloutLeftMatch = calloutHTML.match(/left:([\d.]+)(%|px)/);
  console.log('Test 4 (the callout\'s left position is in %, not px):',
    (calloutLeftMatch && calloutLeftMatch[2] === '%') ? 'PASS' : 'FAIL', { calloutHTML, calloutLeftMatch });

  // ---- Test 5: same two checks (width=100%, preserveAspectRatio=none, % callout) for the Weekly
  // Zone Time card's own inline donut (renderZoneTrendDonut), not just the per-activity one. ----
  win.eval(`
    HRZONE_LAST={...computeHRZones({age:30,maxHRFormula:'tanaka'}),method:'karvonen'};
    PROFILE.savedHRZones={...HRZONE_LAST};
  `);
  const weeksData = [{wk:1,zones:zones.map(z=>({label:z.label,name:z.name,sec:z.sec}))}];
  win.eval(`ZONE_TREND_SELIDX={hr:1,pace:null};`);
  const zoneTrendHTML = win.eval(`renderZoneTrendDonut('hr',${JSON.stringify(weeksData)},1)`);
  const t5SvgOk = zoneTrendHTML.includes('width="100%"') && zoneTrendHTML.includes('preserveAspectRatio="none"');
  const t5CalloutMatch = zoneTrendHTML.match(/hrzone-callout" style="left:([\d.]+)(%|px)/);
  console.log('Test 5 (renderZoneTrendDonut also uses the same width=100%/preserveAspectRatio=none/% callout pattern):',
    (t5SvgOk && t5CalloutMatch && t5CalloutMatch[2] === '%') ? 'PASS' : 'FAIL', { t5SvgOk, t5CalloutMatch });

  await wait(200);
  win.close();
})();
