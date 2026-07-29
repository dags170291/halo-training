// Regression test for the activity detail popup's typography/spacing redesign. Dylon, after the
// Activities tab's own card redesign shipped: "great job on the activity feed design. can you update
// the session details to be just as clean as well i am sharing runna's session detail screen for
// inspiration. take special not of font sizing and spacing specifically." Covers: (1) a new hero stat
// grid (Distance/Time/Avg Pace, then Elevation Gain/Avg HR/Calories) with big bold values, only when
// openActivityDetail's popup asks for it (activityStatRowsHTML(a,{hero:true})) -- the import-
// confirmation cards and a planned session's inline Activities list keep the original compact list;
// (2) bigger, more generously-spaced section headers (actHdr) replacing the small uppercase
// .section-lbl eyebrow style throughout Route/the per-metric chart/Splits/Best Efforts/Pace Zones/
// Effort; (3) the per-metric chart section is now headed by the actual metric shown (e.g. "Pace"),
// not a generic "Over the Activity" label, and sits inside a real .card like every other section; and
// (4) the popup's own title (cornerBtns mode) renders bigger, matching Runna's own bold activity name.
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
  win.eval(`
    BLOCKS=[]; DATA=[]; STATUS={}; NOTES={}; RACES_LIST=[]; ACTIVITIES=[]; EXTRALOGS=[];
  `);

  // Test 1: openActivityDetail's popup renders a hero stat grid with big bold Distance/Time/Avg Pace
  // values up top, labeled in small caps above each value (Runna's own layout), for an activity that
  // has all three. A real (if small) stream is included too -- t/distM/hr with 10 points, 10 seconds
  // apart -- so the per-metric chart (Pace/HR) and the Effort section actually render, exercising the
  // section-header redesign (Tests 4/5) alongside the hero grid itself.
  win.eval(`
    const BASE_T = Date.parse('2027-04-01T06:00:00.000Z');
    const iso = (sec) => new Date(BASE_T + sec * 1000).toISOString();
    window.__act = addActivity({
      type:'run',date:'2027-04-01',startTime:'06:00',title:'Wednesday Morning Run',
      distanceKm:8.05,durationSec:2460,avgPace:'5:06',avgHr:151,elevationGainM:40,calories:811,
      stream:{
        t:[0,10,20,30,40,50,60,70,80,90].map(iso),
        lat:[],lon:[],alt:[100,101,102,103,104,105,106,107,108,109],
        distM:[0,40,80,120,160,200,240,280,320,360],
        hr:[145,148,150,152,155,158,160,159,157,151],cadence:[]
      }
    });
    openActivityDetail(window.__act.id);
  `);
  const popupHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  const heroOk = /font-size:19px;font-weight:800;color:var\(--t1\)">8\.05 km/.test(popupHTML) &&
    /DISTANCE|Distance/.test(popupHTML) && /Avg Pace/.test(popupHTML) && />Time</.test(popupHTML);
  console.log('Test 1 (activity detail popup renders a hero stat grid with big bold Distance/Time/Avg Pace values):', heroOk ? 'PASS' : 'FAIL');

  // Test 2: fields not in the hero set (Avg HR, Elevation Gain, Calories all ARE in the hero set here;
  // Type/Date/Shoe/RPE are not) still show up in the Details list underneath, not dropped.
  const detailsOk = /Type/.test(popupHTML) && /Date/.test(popupHTML);
  console.log('Test 2 (non-hero fields like Type/Date still render in the Details list below the hero grid):', detailsOk ? 'PASS' : 'FAIL');

  // Test 3: the same activity's compact rendering (activityStatRowsHTML with no opts, e.g. what the
  // import-confirmation screen and a planned session's inline Activities list both still use) does
  // NOT render the big hero grid -- no 19px bold value styling -- confirming hero mode is opt-in only.
  const compactHTML = win.eval(`activityStatRowsHTML(window.__act)`);
  console.log('Test 3 (activityStatRowsHTML without opts stays compact, no hero-grid styling):',
    !/font-size:19px;font-weight:800/.test(compactHTML) ? 'PASS' : 'FAIL');

  // Test 4: section headers throughout the popup (Route, the per-metric chart, Effort) use the
  // bigger actHdr style (17px/800) instead of the old small uppercase .section-lbl eyebrow.
  const headerOk = (popupHTML.match(/font-size:17px;font-weight:800;color:var\(--t1\)/g) || []).length >= 2 &&
    !/class="section-lbl"/.test(popupHTML);
  console.log('Test 4 (section headers use the bigger actHdr style, not the old small .section-lbl):', headerOk ? 'PASS' : 'FAIL');

  // Test 5: the per-metric chart section is headed by the metric actually showing (e.g. "Pace"), not
  // a generic "Over the Activity" label, and the chart itself sits inside a real .card.
  const chartHeaderOk = !/Over the Activity/.test(popupHTML) && /class="trend-pills"/.test(popupHTML);
  console.log('Test 5 (chart section is headed by the active metric, not a generic label, and lives in a card):', chartHeaderOk ? 'PASS' : 'FAIL');

  // Test 6: the popup's own title (cornerBtns mode) renders bigger than the old 15px, matching
  // Runna's own bold activity-name header.
  const titleOk = /font-size:19px;font-weight:800;flex:1;min-width:0/.test(popupHTML);
  console.log('Test 6 (popup title renders at the bigger 19px size):', titleOk ? 'PASS' : 'FAIL');

  // Test 7: a planned session's inline Activities list (sessionActivitiesHTML) still uses the compact
  // (non-hero) rendering, unaffected by the popup's own redesign -- confirms opts.hero is scoped to
  // openActivityDetail only, not a global behavior change.
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2027-04-01',endDate:'2027-06-01',sessions:[
      {id:'sEasy',wk:1,ty:'easy',date:'2027-04-01',ph:'dur',ti:'Easy Run'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2027-04-01'; BLOCK_END='2027-06-01';
    linkActivityToSession(window.__act.id,'sEasy','fulfillment');
    saveState();
    openLog('sEasy');
  `);
  const sessLogHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log("Test 7 (a planned session's inline Activities card still renders the compact stat list, not the hero grid):",
    !/font-size:19px;font-weight:800;color:var\(--t1\)/.test(sessLogHTML) ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
