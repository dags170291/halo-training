// Regression test for the v0.34.22 Weekly Zone Time full-card layout redesign. After the v0.34.21
// stadium-donut fix shipped, Dylon sent a fuller mockup and pushed back that only the donut shape had
// actually landed right: "you got the stadium donut right but didnt redesign the rest of the card like
// i showed in my design with the location of the total, runs walks heart rate and pace buttons that is
// who i want it . even the zones them self the colour idicator isnt how i asked take a look at the
// image agan and design exactly how i suggested please." Two fixes covered here:
//
// 1. Card section order now matches the mockup: Total/Running/Walking pills -> donut -> Heart Rate/
//    Pace toggle -> legend -> week picker -> caption. (v0.34.20/21 had the Heart Rate/Pace toggle AND
//    the week picker both sitting above the donut instead.)
// 2. ZONE_TREND_BAR_COLORS reordered so Zone 1=green, Zone 2=blue, Zone 3=gold, Zone 4=orange,
//    Zone 5=red, matching the mockup's own legend/donut coloring (the first two zones were swapped
//    relative to the mockup before this fix).
//
// Also covers the two new dedicated pill styles (zonewk-acttype-pill for Total/Running/Walking,
// zonewk-scheme-btn for Heart Rate/Pace) replacing the generic .trend-pill look used everywhere else.
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

  // ---- Test 1: ZONE_TREND_BAR_COLORS is reordered green/blue/gold/orange/red/amber, matching the
  // mockup's own zone colors (Zone 1 green, Zone 2 blue, Zone 3 gold, Zone 4 orange, Zone 5 red). ----
  const colors = win.eval(`JSON.stringify(ZONE_TREND_BAR_COLORS)`);
  console.log('Test 1 (ZONE_TREND_BAR_COLORS is [green, blue, gold, orange/ign, red, amber] per the mockup):',
    colors === JSON.stringify(['--gr','--dur','--gold','--ign','--re','--am']) ? 'PASS' : 'FAIL', { colors });

  const today = win.eval(`todayISO()`);
  const week1Date = isoDaysAgo(today, 7);
  const week2Date = today;
  const blockEnd = isoDaysAgo(today, -60);

  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'${week1Date}',endDate:'${blockEnd}',sessions:[
      {id:'s1',wk:1,ty:'easy',date:'${week1Date}',ph:'dur'},
      {id:'s2',wk:2,ty:'easy',date:'${week2Date}',ph:'dur'}
    ],mileagePlan:{1:20,2:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='${week1Date}'; BLOCK_END='${blockEnd}';
    STATUS={}; NOTES={}; EXTRALOGS=[]; RACES_LIST=[]; ACTIVITIES=[];
    HRZONE_LAST={...computeHRZones({age:30,maxHRFormula:'tanaka'}),method:'karvonen'};
    PROFILE.savedHRZones={...HRZONE_LAST};
    CURR_ZONE_TREND_TYPE='hr'; CURR_ZONE_TREND_ACTTYPE='all';
    ZONE_TREND_WK={hr:null,pace:null}; ZONE_TREND_SELIDX={hr:null,pace:null};
  `);
  win.eval(`
    (function(){
      function stream(baseDate, hrVal, points, stepSec){
        const BASE_T = Date.parse(baseDate+'T06:00:00.000Z');
        const iso = (sec) => new Date(BASE_T + sec*1000).toISOString();
        const t = []; for(let i=0;i<points;i++) t.push(iso(i*stepSec));
        const hr = t.map(()=>hrVal);
        return {t, lat:[], lon:[], alt:[], distM:[], hr, cadence:[]};
      }
      addActivity({type:'run', date:'${week1Date}', durationSec:90, distanceKm:0.3,
        stream: stream('${week1Date}', 110, 10, 10), source:'import', role:'unplanned'});
      addActivity({type:'walk', date:'${week2Date}', durationSec:180, distanceKm:0.5,
        stream: stream('${week2Date}', 150, 10, 20), source:'import', role:'unplanned'});
    })();
  `);

  // Layout/ordering only needs SOME real zone data to render each section -- it doesn't depend on
  // exact week-boundary math (that's already covered by test_weekly_zone_donut.js's own Test 9 and
  // its calendar-aligned fixture). To exercise every section at once (acttype pills need real walk
  // data, the scheme toggle needs BOTH real hr and pace weeks, the week picker needs 2+ weeks), stub
  // zoneTimeTrendWeeks() for this ordering check only, same "stub it for this one test" pattern
  // test_hrzone_pie_chart.js's Test 7 already uses for activityHRZoneBreakdown.
  win.eval(`
    window.__origZoneTimeTrendWeeks = zoneTimeTrendWeeks;
    zoneTimeTrendWeeks = function(type, n, actType){
      const real = window.__origZoneTimeTrendWeeks('hr', n, actType); // always borrow real HR data's shape
      if(!real.length) return real;
      const twoWeeks = real.length>1 ? real : real.concat([{...real[0], wk: real[0].wk+1}]);
      return twoWeeks; // both 'hr' and 'pace' get the same (fabricated, structurally valid) 2-week data
    };
  `);

  const cardHTML = win.eval(`zoneTimeTrendCardHTML()`);
  win.eval(`zoneTimeTrendWeeks = window.__origZoneTimeTrendWeeks;`); // restore for any later use

  // ---- Test 2: with real walk data present (needed for the acttype pills to show) and 2+ weeks of
  // data (needed for the week picker to show), every section appears in the mockup's order: acttype
  // pills -> donut -> scheme toggle -> legend -> week picker -> caption. ----
  const idxPills = cardHTML.indexOf('zonewk-acttype-pills');
  const idxDonut = cardHTML.indexOf('hrzone-donut-wrap');
  const idxToggle = cardHTML.indexOf('zonewk-scheme-toggle');
  const idxLegend = cardHTML.indexOf('class="zonewk-legend"');
  const idxPicker = cardHTML.indexOf('rpred-range-bar');
  const idxCaption = cardHTML.indexOf('Time spent in each');
  const allFound = [idxPills, idxDonut, idxToggle, idxLegend, idxPicker, idxCaption].every(i => i >= 0);
  const inOrder = allFound && idxPills < idxDonut && idxDonut < idxToggle && idxToggle < idxLegend && idxLegend < idxPicker && idxPicker < idxCaption;
  console.log('Test 2 (card sections render in the mockup\'s order: pills -> donut -> scheme toggle -> legend -> week picker -> caption):',
    inOrder ? 'PASS' : 'FAIL', { idxPills, idxDonut, idxToggle, idxLegend, idxPicker, idxCaption });

  // ---- Test 3: the Total/Running/Walking pills use the new dedicated zonewk-acttype-pill class (not
  // the generic trend-pill look), with the exact labels "Total"/"Running"/"Walking" (present-participle,
  // matching the mockup -- not "Runs"/"Walks"). ----
  const t3HasClass = /class="zonewk-acttype-pill active"[^>]*>Total</.test(cardHTML)
    && /class="zonewk-acttype-pill"[^>]*>Running</.test(cardHTML)
    && /class="zonewk-acttype-pill"[^>]*>Walking</.test(cardHTML);
  console.log('Test 3 (Total/Running/Walking pills use zonewk-acttype-pill with present-participle labels):',
    t3HasClass ? 'PASS' : 'FAIL');

  // ---- Test 4: the Heart Rate/Pace toggle uses the new dedicated zonewk-scheme-btn class (not
  // trend-pill), defaulting to Heart Rate active. ----
  const t4HasClass = /class="zonewk-scheme-btn active"[^>]*>Heart Rate</.test(cardHTML)
    && /class="zonewk-scheme-btn"[^>]*>Pace</.test(cardHTML);
  console.log('Test 4 (Heart Rate/Pace toggle uses zonewk-scheme-btn, Heart Rate active by default):',
    t4HasClass ? 'PASS' : 'FAIL');

  // ---- Test 5: the new pill CSS itself -- acttype pills are an outlined, theme-aware (--t1) capsule
  // that inverts to a solid fill when active; the scheme toggle's active state fills solid blue
  // (--dur) with white text, matching the mockup's specific coloring. ----
  const acttypeCSS = html.match(/\.zonewk-acttype-pill\{([^}]*)\}/)?.[1] || '';
  const acttypeActiveCSS = html.match(/\.zonewk-acttype-pill\.active\{([^}]*)\}/)?.[1] || '';
  const schemeActiveCSS = html.match(/\.zonewk-scheme-btn\.active\{([^}]*)\}/)?.[1] || '';
  const t5 = /border:1\.5px solid var\(--t1\)/.test(acttypeCSS) && /background:var\(--t1\)/.test(acttypeActiveCSS) && /background:var\(--dur\)/.test(schemeActiveCSS);
  console.log('Test 5 (acttype pills are theme-aware outlined capsules that invert when active; scheme toggle active fill is solid blue):',
    t5 ? 'PASS' : 'FAIL', { acttypeCSS, acttypeActiveCSS, schemeActiveCSS });

  await wait(200);
  win.close();
})();
