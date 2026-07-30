// Regression test for a real reported bug. Dylon (with a screenshot of the desktop Progress tab):
// "plot points on graphs are blown up when in desktop mode." Root cause: renderTrendAreaChart (Weekly
// Volume), renderRacePredTrendChart (shared by Race Predictions and PB Progression), and
// renderBlockComparisonChart (Block Comparison) all draw their line/area chart inside an SVG with a
// fixed 320-unit viewBox stretched to width:100% via preserveAspectRatio="none" -- necessary so the
// lines/area fill the card's real fluid width. That's fine for a <path>/<polygon>/<line>, but each
// chart's own point markers were still raw SVG <circle> elements sharing that same coordinate space,
// so a fixed radius in viewBox units got stretched *horizontally only* (height stays fixed, only
// width stretches) once the chart's actual rendered pixel width -- much wider on desktop's larger
// Progress cards than the 320-unit viewBox -- grew past the viewBox width. The result: every dot
// rendered as a wide horizontal ellipse blob instead of a small circle, exactly what the screenshots
// showed. This is the same underlying bug a prior session already fixed for these same three charts'
// own axis/date/week-label <text> (moved out of the SVG into absolutely-positioned real HTML,
// documented in each function's own comment) -- the circle markers were simply missed at the time.
// Fix: move the point markers out of the SVG into that same absolutely-positioned HTML label layer,
// as real HTML circles (equal width/height, so no non-uniform stretch is possible since they sit
// outside the SVG's own coordinate system entirely).
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

  // A real HTML dot span looks like: position:absolute, a left:%/top:% pair, equal width/height in
  // px, and border-radius:50% -- checking for all of those together (not just border-radius:50%
  // alone, which legend swatches elsewhere also use) is what actually proves it's one of these
  // point markers and not some other unrelated circular element.
  const isRealDotSpan = (html, w) => new RegExp(
    `position:absolute;left:[^;]+;top:[^;]+;width:${w}px;height:${w}px;border-radius:50%`
  ).test(html);

  // ---- Test 1: renderTrendAreaChart (Weekly Volume / Activity Trends) has no <circle> left, and its
  // point dots render as real equal-width/height HTML spans instead. ----
  const t1Html = win.eval(`renderTrendAreaChart([10,12,8,null,15,20,18,22,25,19])`);
  const t1NoCircle = !/<circle/.test(t1Html);
  const t1HasDot = isRealDotSpan(t1Html, 6) || isRealDotSpan(t1Html, 10);
  console.log('Test 1 (Weekly Volume chart: no <circle> left, point dots are real HTML circles):',
    (t1NoCircle && t1HasDot) ? 'PASS' : 'FAIL', { t1NoCircle, t1HasDot });

  // ---- Test 2: the currently-open week's dot is visibly bigger (10px) than the rest (6px) -- the
  // open/closed size distinction the old <circle r="5"/r="3"> pair drew is preserved by the fix, not
  // lost along with it. ----
  win.eval(`CURR_TREND_WK=3;`);
  const t2Html = win.eval(`renderTrendAreaChart([10,12,8,15,15,20,18,22,25,19])`);
  const t2HasOpenDot = isRealDotSpan(t2Html, 10);
  const t2HasClosedDot = isRealDotSpan(t2Html, 6);
  console.log('Test 2 (the open week keeps its bigger 10px dot; other weeks keep the smaller 6px dot):',
    (t2HasOpenDot && t2HasClosedDot) ? 'PASS' : 'FAIL', { t2HasOpenDot, t2HasClosedDot });
  win.eval(`CURR_TREND_WK=null;`);

  // ---- Test 3: renderRacePredTrendChart (shared by Race Predictions and PB Progression) has no
  // <circle> left, and its point dots render as real 7px HTML circles. ----
  const predPts = [
    {date:'2026-07-01',sec:1800,projected:false},
    {date:'2026-07-08',sec:1750,projected:false},
    {date:'2026-07-15',sec:1700,projected:false},
    {date:'2026-07-22',sec:1650,projected:true},
    {date:'2026-07-29',sec:1600,projected:true}
  ];
  const t3Html = win.eval(`renderRacePredTrendChart(${JSON.stringify(predPts)})`);
  const t3NoCircle = !/<circle/.test(t3Html);
  const t3HasDot = isRealDotSpan(t3Html, 7);
  console.log('Test 3 (Race Predictions/PB Progression chart: no <circle> left, point dots are real HTML circles):',
    (t3NoCircle && t3HasDot) ? 'PASS' : 'FAIL', { t3NoCircle, t3HasDot });

  // ---- Test 4: renderBlockComparisonChart has no <circle> left, its point dots render as real 7px
  // HTML circles, AND each dot still carries a hover tooltip (a plain title="" attribute doing the
  // same job the old SVG <title> child did) even though the wrapping labels layer itself has
  // pointer-events:none. ----
  win.eval(`
    BLOCKS=[
      {id:'b1',name:'Block One',startDate:'2026-01-01',endDate:'2026-03-01',mileagePlan:{1:20,2:20},
        sessions:[{id:'b1s1',wk:1,ty:'easy',date:'2026-01-05'},{id:'b1s2',wk:2,ty:'easy',date:'2026-01-12'}]},
      {id:'b2',name:'Block Two',startDate:'2026-03-02',endDate:'2026-05-01',mileagePlan:{1:25,2:25},
        sessions:[{id:'b2s1',wk:1,ty:'easy',date:'2026-03-05'},{id:'b2s2',wk:2,ty:'easy',date:'2026-03-12'}]}
    ];
    STATUS={b1s1:'done',b1s2:'done',b2s1:'done',b2s2:'missed'};
    NOTES={b1s1:{dist:5},b1s2:{dist:5},b2s1:{dist:6}};
    ACTIVITIES=[]; EXTRALOGS=[];
  `);
  const t4Html = win.eval(`renderBlockComparisonChart(BLOCKS)`);
  const t4NoCircle = !/<circle/.test(t4Html);
  const t4HasDot = isRealDotSpan(t4Html, 7);
  const t4HasTooltip = /<span title="[^"]+"[^>]*style="position:absolute/.test(t4Html);
  const t4PointerEventsAuto = /pointer-events:auto/.test(t4Html);
  console.log('Test 4 (Block Comparison chart: no <circle> left, dots are real HTML circles, and still keep their hover tooltip):',
    (t4NoCircle && t4HasDot && t4HasTooltip && t4PointerEventsAuto) ? 'PASS' : 'FAIL',
    { t4NoCircle, t4HasDot, t4HasTooltip, t4PointerEventsAuto });

  // ---- Test 5: the chart's own line/area/path SVG markup is untouched -- this fix should only move
  // the point markers out, not touch how the line itself is drawn (still stretches to fill the fluid
  // width via preserveAspectRatio="none", which is correct and intentional for a line/fill). ----
  const t5StillHasPolygon = /<polygon/.test(t1Html);
  const t5StillHasPreserveNone = /preserveAspectRatio="none"/.test(t1Html) && /preserveAspectRatio="none"/.test(t3Html) && /preserveAspectRatio="none"/.test(t4Html);
  console.log('Test 5 (the line/area fill itself is untouched -- still a real SVG stretched via preserveAspectRatio="none"):',
    (t5StillHasPolygon && t5StillHasPreserveNone) ? 'PASS' : 'FAIL', { t5StillHasPolygon, t5StillHasPreserveNone });

  // ---- Test 6: regression for a second, distinct reported bug -- Dylon: "the plot points on the
  // graphs in progress is misaligned." renderRacePredTrendChart's outer wrapper has
  // padding-right:32px reserved for its right-side axis value labels (gridLabelsHTML) -- per the CSS
  // spec, position:absolute;inset:0 on a descendant of a PADDED containing block is measured against
  // that block's padding box (the full width, padding included), not its narrower content box, which
  // is all the in-flow SVG itself ever actually occupied. So a dot overlay sharing that same padded
  // box as its 0%-100% coordinate space would sit on a wider reference than the SVG's real rendered
  // width, drifting right of the line -- worse for points further along the x-axis. Fix: nest an
  // unpadded inner wrapper around just the SVG + dot overlay so both share the exact same box, with
  // gridLabelsHTML alone left referencing the padded outer wrapper (where its own right:0 rule is
  // supposed to land, in the reserved 32px margin). This checks the DOM structure directly: the SVG
  // and the dot spans must share a common unpadded ancestor that is NOT the padded 32px wrapper
  // itself -- jsdom doesn't compute real pixel layout, so this is the structural proxy for "these two
  // things are now guaranteed to use the same coordinate space," not a live pixel measurement. ----
  win.eval(`document.body.innerHTML = '<div id="rpred-chart-test"></div>';`);
  win.eval(`document.getElementById('rpred-chart-test').innerHTML = renderRacePredTrendChart(${JSON.stringify(predPts)});`);
  const t6 = win.eval(`
    (() => {
      const root = document.getElementById('rpred-chart-test');
      const paddedWrapper = Array.from(root.querySelectorAll('div')).find(d => /padding-right:\\s*32px/.test(d.getAttribute('style')||''));
      if (!paddedWrapper) return { found: false };
      const svg = paddedWrapper.querySelector('svg');
      const dotSpan = paddedWrapper.querySelector('span[style*="border-radius:50%"]');
      if (!svg || !dotSpan) return { found: false, hasSvg: !!svg, hasDot: !!dotSpan };
      // Walk up from the SVG to find its nearest 'position:relative' ancestor within paddedWrapper.
      let svgWrapper = svg.parentElement;
      while (svgWrapper && svgWrapper !== paddedWrapper && !/position:\\s*relative/.test(svgWrapper.getAttribute('style')||'')) {
        svgWrapper = svgWrapper.parentElement;
      }
      const svgWrapperIsPaddedWrapper = svgWrapper === paddedWrapper;
      const dotSharesSvgWrapper = svgWrapper && svgWrapper.contains(dotSpan);
      return { found: true, svgWrapperIsPaddedWrapper, dotSharesSvgWrapper };
    })()
  `);
  console.log('Test 6 (Race Predictions/PB Progression chart: dots share an unpadded wrapper with the SVG, not the padded 32px outer box):',
    (t6.found && !t6.svgWrapperIsPaddedWrapper && t6.dotSharesSvgWrapper) ? 'PASS' : 'FAIL', t6);

  await wait(200);
  win.close();
})();
