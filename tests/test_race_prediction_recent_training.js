// Dylon, after logging a hard interval session: "i just ran an interval session today and i only
// notice in 8 weeks i can run 26:5 sec but my current prediction didnt update." Root cause: once you
// have ANY real completed race on record (RACES_LIST, status 'done' + actualTime), predictedRaceTimeSec()
// switched to using ONLY race results forever, ignoring every training run logged afterward no matter
// how much fitness changed -- "In N weeks" reacts instantly to new training (it's driven by the
// separate Fitness Trend/EF rate), but "Current"/the hero range stayed frozen at whatever the last real
// race said, however stale that race was. Fixed: any training performance dated AFTER the most recent
// race now counts too, alongside every race result -- a race stays the anchor when it's the newest
// thing logged, but a genuine effort since the last race is real signal, not noise to discard.
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

  // ---- Test 1: regression -- with ONLY a race result and no training at all, the prediction is
  // still exactly the race's own Riegel-scaled time (unchanged from before this fix). 25:00 -> 1500s,
  // low=1500*0.97=1455, high=1500*1.04=1560. ----
  win.eval(`BLOCKS=[]; DATA=[]; STATUS={}; NOTES={}; EXTRALOGS=[]; ACTIVITIES=[]; RACES_LIST=${raceOnly};`);
  const p1 = win.eval(`predictedRaceTimeSec(5)`);
  const t1 = p1 && Math.abs(p1.lowSec-1455)<1 && Math.abs(p1.highSec-1560)<1;
  console.log('Test 1 (regression: race-only, no training, still uses just the race result):', t1?'PASS':'FAIL', { p1 });

  // ---- Test 2: the actual bug -- a training effort logged AFTER the race (today, faster than the
  // race) now moves the prediction, instead of being silently ignored forever. Training: 5km @
  // 4:40/km = 1400s, dated after the 2026-07-01 race. Expect avg(1500,1400)=1450 -> low=1406.5,
  // high=1508. ----
  win.eval(`EXTRALOGS=[{id:'x1',kind:'run',dist:5,pace:'4:40',date:'2026-08-05'}];`);
  const p2 = win.eval(`predictedRaceTimeSec(5)`);
  const t2 = p2 && Math.abs(p2.lowSec-1406.5)<1 && Math.abs(p2.highSec-1508)<1 && (p2.lowSec!==p1.lowSec);
  console.log('Test 2 (a training run logged AFTER the race now moves the prediction -- the reported bug):', t2?'PASS':'FAIL', { p1, p2 });

  // ---- Test 3: a training effort logged BEFORE the race is still excluded -- it's stale relative to
  // the race, not a more current signal, so the prediction should be identical to Test 1 (race-only). ----
  win.eval(`EXTRALOGS=[{id:'x2',kind:'run',dist:5,pace:'4:40',date:'2026-06-01'}];`);
  const p3 = win.eval(`predictedRaceTimeSec(5)`);
  const t3 = p3 && Math.abs(p3.lowSec-p1.lowSec)<1 && Math.abs(p3.highSec-p1.highSec)<1;
  console.log('Test 3 (a training run logged BEFORE the race is still excluded, matching race-only):', t3?'PASS':'FAIL', { p1, p3 });

  // ---- Test 4: regression -- with NO race at all, training is used exactly as before (the original
  // fallback-when-no-race behavior is untouched by this fix). ----
  win.eval(`RACES_LIST=[]; EXTRALOGS=[{id:'x3',kind:'run',dist:5,pace:'4:40',date:'2026-08-05'}];`);
  const p4 = win.eval(`predictedRaceTimeSec(5)`);
  const t4 = p4 && Math.abs(p4.lowSec-1358)<1 && Math.abs(p4.highSec-1456)<1; // 1400*0.97, 1400*1.04
  console.log('Test 4 (regression: no race at all, falls back to training exactly as before):', t4?'PASS':'FAIL', { p4 });

  await wait(200);
  win.close();
})();
