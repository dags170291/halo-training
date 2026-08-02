// Regression test for a real plan-data bug Dylon caught: "I noticed recovery run in my plan was
// placed in the wrong day sunday after the race should be full rest not the sunday before." The
// session in question is BLOCK5_SESSIONS' w5d0 (2026-08-16, the Sunday right after the Mayaro Coconut
// Run 5K race on w4d6, 2026-08-15) -- it was an Easy "Recovery Run" whose det text still read "Comes
// the day after Saturday's long run," stale copy left over from the normal recovery-run template,
// never updated for the fact this particular Sunday follows a RACE, not a long run. Racing the day
// before (even an easy, no-pressure B-race) earns full rest, not another session -- fixed by changing
// w5d0's ty to 'rest' with a "Full Rest" title/text, matching the exact ty:'rest' shape the plan
// already uses elsewhere (e.g. w10d5's "Full Rest").
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

  // ---- Test 1: w5d0 (the day after the Mayaro race) is now a Rest session, not an Easy Recovery
  // Run. ----
  const w5d0 = JSON.parse(win.eval(`JSON.stringify(BLOCK5_SESSIONS.find(x=>x.id==='w5d0'))`));
  console.log('Test 1 (w5d0, the day after the Mayaro race, is now ty:\'rest\'):',
    w5d0.ty === 'rest' ? 'PASS' : 'FAIL', { got: w5d0.ty });

  // ---- Test 2: its title reflects Full Rest, matching the exact wording the plan already uses
  // elsewhere for a rest day (e.g. w10d5's "Full Rest"), and the stale "Comes the day after
  // Saturday's long run" text (wrong -- Saturday was a race, not a long run) is gone. ----
  console.log('Test 2 (title reads "Full Rest" and the stale long-run copy is gone):',
    (w5d0.ti === 'Full Rest' && !w5d0.det.includes('long run')) ? 'PASS' : 'FAIL', { ti: w5d0.ti, det: w5d0.det });

  // ---- Test 3: no dist/shoe fields remain on it (a rest day doesn't carry them, same as every other
  // ty:'rest' session in the plan). ----
  console.log('Test 3 (no leftover dist/shoe fields on the rest day):',
    (w5d0.dist === undefined && w5d0.shoe === undefined) ? 'PASS' : 'FAIL', { dist: w5d0.dist, shoe: w5d0.shoe });

  // ---- Test 4: isRunTypeSession() correctly excludes it now, so it drops out of the block's mileage
  // total (recalcBlockDerived()) same as any other non-running day -- confirms this isn't just a label
  // change, it actually stops counting as planned mileage. ----
  const t4 = win.eval(`isRunTypeSession(BLOCK5_SESSIONS.find(x=>x.id==='w5d0'))`);
  console.log('Test 4 (isRunTypeSession correctly excludes the rest day from mileage totals):',
    t4 === false ? 'PASS' : 'FAIL', { got: t4 });

  // ---- Test 5: stepsFor() renders it as a clean single-note rest day (genericStep()'s shape), same
  // as every other ty:'rest' session -- no run-specific Warm Up/Main/Cool Down breakdown left over
  // from when it was an Easy session. ----
  const steps = JSON.parse(win.eval(`JSON.stringify(stepsFor(BLOCK5_SESSIONS.find(x=>x.id==='w5d0')))`));
  const t5Shape = steps.length === 2 && steps[0].type === 'group' && steps[0].label === 'Full Rest' && steps[1].type === 'runline';
  console.log('Test 5 (stepsFor renders a clean single rest note, not a leftover run breakdown):',
    t5Shape ? 'PASS' : 'FAIL', { steps });

  // ---- Test 6: the race day itself (w4d6, the Mayaro Coconut Run) is untouched -- this fix only
  // touches the day AFTER the race, not the race session or anything earlier in the week. ----
  const raceDay = JSON.parse(win.eval(`JSON.stringify(BLOCK5_SESSIONS.find(x=>x.id==='w4d6'))`));
  console.log('Test 6 (the race day itself, w4d6, is untouched by this fix):',
    (raceDay.ty === 'race' && raceDay.date === '2026-08-15') ? 'PASS' : 'FAIL', { raceDay });

  await wait(200);
  win.close();
})();
