// Regression test: Dylon: "i notice pace by distant has empty data even 3 weeks into the plan."
// weekEF() (the "Pace vs HR" chart) got the Phase 1b treatment of also counting imported Activities
// toward the weekly average (see its own comment: "Imported/logged run Activities count toward the
// same weekly EF average (Phase 1b)"), but its sibling weekAvgPaceSpeed() (the "Pace by Distance"
// chart, right below it in the file) never did -- a week made up entirely of imported GPS runs, with
// nothing manually typed into a planned session's own NOTES.pace, silently showed as a gap on the
// chart even with real runs logged that week. The exact scenario Dylon hit: his real data all comes
// from imported TCX files (Best Efforts by Distance / PB Progression / Weekly Zone Time all showed
// real numbers, since those already read ACTIVITIES), so this one chart was empty from week 1 on.
//
// renderEffDayRows() (the "Week N runs" list shown when you tap a week on either the Pace by
// Distance or Pace vs HR chart) had the exact same gap -- only ever read planned sessions, so it kept
// saying "No run sessions this week" too.
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

  // Week 1 of this block has NO planned run session with a manually-typed NOTES.pace at all -- the
  // only run that week is an imported Activity, matching Dylon's real situation exactly.
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-09-01',sessions:[
      {id:'s1',wk:1,wd:'Wed',ty:'rest',date:'2026-07-01',ph:'dur',ti:'Rest'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-01'; BLOCK_END='2026-09-01';
    STATUS={}; NOTES={}; EXTRALOGS=[]; RACES_LIST=[]; ACTIVITIES=[];
    addActivity({type:'run',date:'2026-07-03',distanceKm:5,durationSec:1500,avgPace:'5:00',avgHr:172,source:'import',role:'unplanned',stream:{t:[],lat:[],lon:[],alt:[],distM:[],hr:[],cadence:[]}});
  `);

  // ---- Test 1: weekAvgPaceSpeed(1) is no longer null -- it picks up the imported Activity's own
  // avgPace even though no session that week has anything typed into NOTES.pace. 5:00/km = 300s/km
  // -> 3600/300 = 12 km/h exactly. ----
  const t1 = win.eval(`weekAvgPaceSpeed(1)`);
  console.log('Test 1 (weekAvgPaceSpeed includes an imported Activity run, not just session NOTES.pace):',
    (typeof t1 === 'number' && Math.abs(t1 - 12) < 0.001) ? 'PASS' : 'FAIL', { t1 });

  // ---- Test 2: renderEffDayRows(1) shows a real row for that Activity instead of "No run sessions
  // this week", including its pace/HR text and a click-through straight to the activity. ----
  const rows1 = win.eval(`renderEffDayRows(1)`);
  const t2 = rows1.includes('5:00/km') && rows1.includes('172bpm')
    && !rows1.includes('No run sessions this week')
    && /onclick="openActivityDetail\('[^']+'\)"/.test(rows1);
  console.log('Test 2 (renderEffDayRows shows the imported Activity, clickable to its own detail page):', t2?'PASS':'FAIL', { snippet: rows1.slice(0,200) });

  // ---- Test 3: regression -- a week with a real session (manually-typed NOTES.pace) and NO
  // Activities still works exactly as before this fix. ----
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-09-01',sessions:[
      {id:'s2',wk:1,wd:'Wed',ty:'easy',date:'2026-07-01',ph:'dur',ti:'Easy Run'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; STATUS={s2:'done'}; NOTES={s2:{dist:'5',pace:'5:30',hr:'150'}};
    ACTIVITIES=[];
  `);
  const t3speed = win.eval(`weekAvgPaceSpeed(1)`);
  const rows3 = win.eval(`renderEffDayRows(1)`);
  const t3 = t3speed !== null && rows3.includes('5:30/km') && rows3.includes('150bpm') && rows3.includes("openLog('s2')");
  console.log('Test 3 (regression: a session-only week with real NOTES.pace still works unchanged):', t3?'PASS':'FAIL', { t3speed, snippet: rows3.slice(0,200) });

  // ---- Test 4: a week with genuinely nothing (no session, no Activity) still returns null/the
  // original empty-state message, not a crash or a fabricated value. ----
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-09-01',sessions:[],mileagePlan:{1:20}}];
    DATA=[]; STATUS={}; NOTES={}; ACTIVITIES=[];
  `);
  const t4speed = win.eval(`weekAvgPaceSpeed(1)`);
  const rows4 = win.eval(`renderEffDayRows(1)`);
  const t4 = t4speed === null && rows4.includes('No run sessions this week');
  console.log('Test 4 (a genuinely empty week still shows null/the empty-state message, not fabricated):', t4?'PASS':'FAIL', { t4speed });
})();
