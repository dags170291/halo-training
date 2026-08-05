// Follow-up to v0.34.34's "training logged after your last race now counts" fix. Dylon: "the entire
// interval session with warm up and cool down [dragged the prediction down]. can you research how
// strava, garmin, coros and other major players handle race / time predictions and use that." None of
// them derive a race-time prediction from a structured interval workout's own total-distance-over-
// total-elapsed-time (which blends real work pace with its own built-in recovery jogs into a
// meaningless number) -- they use continuous-effort segments or a derived fitness/efficiency model
// instead. Fixed: knownPerformances() now skips a hand-logged Quality/Interval session's (or an
// EXTRALOGS "intervals"-subtype entry's) own blended aggregate when picking the fastest performance in
// a distance bucket -- a real Activity (GPS-stream-derived, already using activityBestEffort()'s
// rolling-window search to find the genuine work-pace segment) and a hand-logged Tempo/continuous
// effort are both unaffected.
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

  const raceOnly = `[{key:'r1',name:'Test 5K',date:'2026-07-01',status:'done',distance:'5K',actualTime:'25:00',isPB:true,priority:'A'}]`;
  // 25:00 -> 1500s, low=1455, high=1560 -- same hand-checked baseline as test_race_prediction_recent_training.js.

  // ---- Test 1: a hand-logged Quality/Interval SESSION (s.ty='qual'), dated after the race, with a
  // slow blended aggregate (its own warm-up+reps+rest+cool-down averaged out to ~7:00/km over 5km =
  // 2100s) does NOT drag the prediction down -- the session is skipped entirely, so the result is
  // identical to race-only. ----
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-09-01',sessions:[
      {id:'q1',wk:1,ty:'qual',date:'2026-08-05',ph:'dur',ti:'12x2min Intervals'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1';
    STATUS={q1:'done'}; NOTES={q1:{dist:'5',duration:'35:00'}}; EXTRALOGS=[]; ACTIVITIES=[];
    RACES_LIST=${raceOnly};
  `);
  const p1 = win.eval(`predictedRaceTimeSec(5)`);
  const t1 = p1 && Math.abs(p1.lowSec-1455)<1 && Math.abs(p1.highSec-1560)<1;
  console.log("Test 1 (a hand-logged Quality/Interval session's blended pace does NOT drag Current down, even when dated after the race):", t1?'PASS':'FAIL', { p1 });

  // ---- Test 2: an EXTRALOGS entry tagged subtype 'intervals' has the identical exclusion. ----
  win.eval(`DATA=[]; STATUS={}; NOTES={}; EXTRALOGS=[{id:'x1',kind:'run',subtype:'intervals',dist:5,pace:'7:00',date:'2026-08-05'}];`);
  const p2 = win.eval(`predictedRaceTimeSec(5)`);
  const t2 = p2 && Math.abs(p2.lowSec-1455)<1 && Math.abs(p2.highSec-1560)<1;
  console.log('Test 2 (an EXTRALOGS entry tagged subtype "intervals" is excluded the same way):', t2?'PASS':'FAIL', { p2 });

  // ---- Test 3: regression -- a hand-logged Easy Run session (s.ty='easy', a genuine continuous
  // effort, no built-in rest) logged after the race still counts normally, same as v0.34.34 intended.
  // 5km @ 4:40/km = 1400s, dated after the race -> avg(1500,1400)=1450 -> low=1406.5, high=1508. ----
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-09-01',sessions:[
      {id:'e1',wk:1,ty:'easy',date:'2026-08-05',ph:'dur',ti:'Easy Run'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; STATUS={e1:'done'}; NOTES={e1:{dist:'5',pace:'4:40'}};
    EXTRALOGS=[]; ACTIVITIES=[]; RACES_LIST=${raceOnly};
  `);
  const p3 = win.eval(`predictedRaceTimeSec(5)`);
  const t3 = p3 && Math.abs(p3.lowSec-1406.5)<1 && Math.abs(p3.highSec-1508)<1;
  console.log('Test 3 (regression: a genuine continuous Easy Run session logged after the race still counts):', t3?'PASS':'FAIL', { p3 });

  // ---- Test 4: regression -- an EXTRALOGS entry tagged subtype 'tempo' (a continuous effort, not
  // broken up by rest) still counts normally, same distance/pace as Test 2 but not excluded. ----
  win.eval(`DATA=[]; STATUS={}; NOTES={}; EXTRALOGS=[{id:'x2',kind:'run',subtype:'tempo',dist:5,pace:'4:40',date:'2026-08-05'}];`);
  const p4 = win.eval(`predictedRaceTimeSec(5)`);
  const t4 = p4 && Math.abs(p4.lowSec-1406.5)<1 && Math.abs(p4.highSec-1508)<1;
  console.log('Test 4 (regression: an EXTRALOGS entry tagged subtype "tempo" still counts, unlike "intervals"):', t4?'PASS':'FAIL', { p4 });

  // ---- Test 5: a real imported Activity (a genuine GPS stream, already correctly isolated to its
  // real work-pace segment by activityBestEffort()'s rolling-window search) is NOT excluded just
  // because it happens to be dated after the race -- Activities were never the problem. ----
  win.eval(`DATA=[]; STATUS={}; NOTES={}; EXTRALOGS=[];
    ACTIVITIES=[{id:'a1',type:'run',date:'2026-08-05',distanceKm:5,durationSec:1400,avgPace:'4:40',source:'import',role:'unplanned',stream:{t:[],lat:[],lon:[],alt:[],distM:[],hr:[],cadence:[]}}];
  `);
  const p5 = win.eval(`predictedRaceTimeSec(5)`);
  const t5 = p5 && Math.abs(p5.lowSec-1406.5)<1 && Math.abs(p5.highSec-1508)<1;
  console.log('Test 5 (a real imported Activity is not excluded -- Activities were never the problem):', t5?'PASS':'FAIL', { p5 });

  await wait(200);
  win.close();
})();
