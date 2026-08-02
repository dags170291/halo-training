// Regression test for splitting Weekly Zone Time by activity type. Right after the donut+legend
// redesign shipped, Dylon: "great redesign but can you also separate it by total, runs and walks?"
// weeklyHRZoneTotals()/weeklyPaceZoneTotals()/zoneTimeTrendWeeks() gained an optional `actType`
// ('all'/'run'/'walk') filter, and zoneTimeTrendCardHTML() gained a Total/Runs/Walks pill row above
// the existing Heart Rate/Pace toggle -- shown only once there's real Walk zone data to actually split
// out (otherwise "Runs" would just be a redundant copy of "Total").
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
  const week1Date = isoDaysAgo(today, 7);
  const blockEnd = isoDaysAgo(today, -14);

  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'${week1Date}',endDate:'${blockEnd}',sessions:[
      {id:'s1',wk:1,ty:'easy',date:'${week1Date}',ph:'dur'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='${week1Date}'; BLOCK_END='${blockEnd}';
    STATUS={}; NOTES={}; EXTRALOGS=[]; RACES_LIST=[]; ACTIVITIES=[];
    HRZONE_LAST={...computeHRZones({age:30,maxHRFormula:'tanaka'}),method:'karvonen'};
    PROFILE.savedHRZones={...HRZONE_LAST};
    CURR_ZONE_TREND_TYPE='hr'; CURR_ZONE_TREND_ACTTYPE='all';
    ZONE_TREND_WK={hr:null,pace:null}; ZONE_TREND_SELIDX={hr:null,pace:null};
  `);

  // One run (constant HR 110, 10 points 10s apart = 9 real intervals = 90s) and one walk (constant HR
  // 150, 10 points 20s apart = 9 real intervals = 180s), same week, so 'all' should sum to 270s.
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
      addActivity({type:'walk', date:'${week1Date}', durationSec:180, distanceKm:0.5,
        stream: stream('${week1Date}', 150, 10, 20), source:'import', role:'unplanned'});
    })();
  `);

  // ---- Test 1-3: the actType filter on the underlying data function itself ----
  const totAll = win.eval(`weeklyHRZoneTotals(1,'all').reduce((s,z)=>s+z.sec,0)`);
  const totRun = win.eval(`weeklyHRZoneTotals(1,'run').reduce((s,z)=>s+z.sec,0)`);
  const totWalk = win.eval(`weeklyHRZoneTotals(1,'walk').reduce((s,z)=>s+z.sec,0)`);
  console.log('Test 1 (weeklyHRZoneTotals actType=all sums both the run and the walk):',
    totAll === 270 ? 'PASS' : 'FAIL', { totAll });
  console.log('Test 2 (weeklyHRZoneTotals actType=run only counts the run):',
    totRun === 90 ? 'PASS' : 'FAIL', { totRun });
  console.log('Test 3 (weeklyHRZoneTotals actType=walk only counts the walk):',
    totWalk === 180 ? 'PASS' : 'FAIL', { totWalk });

  // ---- Test 4: with real walk data present, zoneTimeTrendCardHTML() shows a Total/Runs/Walks pill
  // row, defaults to Total, and the donut center shows the combined 270s ("4:30") ----
  const allCardHTML = win.eval(`zoneTimeTrendCardHTML()`);
  const t4HasPills = /selectZoneTrendActType\('all'\)/.test(allCardHTML) && /selectZoneTrendActType\('run'\)/.test(allCardHTML) && /selectZoneTrendActType\('walk'\)/.test(allCardHTML);
  const t4TotalActive = /zonewk-acttype-pill active" onclick="selectZoneTrendActType\('all'\)"/.test(allCardHTML);
  const t4ShowsCombined = /4:30/.test(allCardHTML);
  console.log('Test 4 (with real walk data, the card shows Total/Runs/Walks pills, defaults to Total, shows the combined time):',
    (t4HasPills && t4TotalActive && t4ShowsCombined) ? 'PASS' : 'FAIL', { t4HasPills, t4TotalActive, t4ShowsCombined });

  // ---- Test 5: tapping Runs re-renders scoped to just the run's own 90s ("1:30") ----
  win.eval(`selectZoneTrendActType('run')`);
  const runCardHTML = win.eval(`zoneTimeTrendCardHTML()`);
  const t5RunActive = /zonewk-acttype-pill active" onclick="selectZoneTrendActType\('run'\)"/.test(runCardHTML);
  const t5ShowsRunOnly = /1:30/.test(runCardHTML) && !/3:00/.test(runCardHTML);
  console.log('Test 5 (tapping Runs scopes the donut to just the run\'s own 90s):',
    (t5RunActive && t5ShowsRunOnly) ? 'PASS' : 'FAIL', { t5RunActive, t5ShowsRunOnly });

  // ---- Test 6: tapping Walks re-renders scoped to just the walk's own 180s ("3:00") ----
  win.eval(`selectZoneTrendActType('walk')`);
  const walkCardHTML = win.eval(`zoneTimeTrendCardHTML()`);
  const t6WalkActive = /zonewk-acttype-pill active" onclick="selectZoneTrendActType\('walk'\)"/.test(walkCardHTML);
  const t6ShowsWalkOnly = /3:00/.test(walkCardHTML) && !/1:30/.test(walkCardHTML);
  console.log('Test 6 (tapping Walks scopes the donut to just the walk\'s own 180s):',
    (t6WalkActive && t6ShowsWalkOnly) ? 'PASS' : 'FAIL', { t6WalkActive, t6ShowsWalkOnly });

  // ---- Test 7: switching actType clears any in-progress zone selection, back to the week-total
  // default rather than leaving a stale selected zone highlighted ----
  win.eval(`selectZoneTrendActType('all'); selectZoneTrendSlice('hr',0);`);
  const selectedThenSwitch = win.eval(`selectZoneTrendActType('run'); zoneTimeTrendCardHTML();`);
  const t7Cleared = /Total Time/.test(selectedThenSwitch) && !/zonewk-legend-row selected/.test(selectedThenSwitch);
  console.log('Test 7 (switching Total/Runs/Walks clears any in-progress zone selection):',
    t7Cleared ? 'PASS' : 'FAIL');

  // ---- Test 8: with no walk data at all, the Total/Runs/Walks pill row does not render (nothing to
  // split, would just duplicate Total) ----
  win.eval(`
    ACTIVITIES=ACTIVITIES.filter(a=>a.type!=='walk');
    CURR_ZONE_TREND_ACTTYPE='all'; ZONE_TREND_WK={hr:null,pace:null}; ZONE_TREND_SELIDX={hr:null,pace:null};
  `);
  const noWalkHTML = win.eval(`zoneTimeTrendCardHTML()`);
  const t8NoPills = !/selectZoneTrendActType/.test(noWalkHTML);
  console.log('Test 8 (with no walk data at all, the Total/Runs/Walks pill row does not render):',
    t8NoPills ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
