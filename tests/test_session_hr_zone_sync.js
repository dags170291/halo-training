// Regression test for making the training plan's own per-session HR recommendations track the
// user's real calculated HR zones instead of static text baked into the plan when it was authored.
// Dylon, seeing tomorrow's Long Run (BLOCK5_SESSIONS w2d6) prescribe "HR ≤148–152" in the session
// detail sheet: "which based on my recent calculation is zone 1 we need to update our training plan
// recommendations to match what is my heart rate zones." Block 5's easy/long sessions had their HR
// cue written as plain text straight into each session's own det field back when the block was
// authored (a placeholder guess, never wired to the HR Zone Calculator) -- see sessionAerobicHRNote()
// and its call site inside stepsFor()'s easy/long branch for the fix.
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

  // ---- Test 1: with NO HR zones saved yet, sessionAerobicHRNote() strips the embedded static
  // "HR ≤NNN[-NNN]" text rather than showing a stale/wrong number -- no zones saved means nothing
  // accurate to show, so it's dropped entirely instead of left frozen at plan-authoring time. ----
  win.eval(`PROFILE.savedHRZones = null;`);
  const t1 = win.eval(`sessionAerobicHRNote('9–10 km, AM, HR ≤148–152')`);
  console.log('Test 1 (with no saved HR zones, the old embedded HR text is stripped, not shown stale):',
    t1 === '9–10 km, AM' ? 'PASS' : 'FAIL', { got: t1 });

  // ---- Test 2: with real HR zones saved (Karvonen, maxHR=196, rhr=60 -- Dylon's own real numbers
  // from this session's earlier LTHR discussion), the exact w2d6 Long Run example from Dylon's
  // screenshot ("9–10 km, AM, HR ≤148–152") now shows a live Zone 2 (Aerobic/Endurance) range instead
  // of the old static Zone-1-level text. ----
  win.eval(`
    HRZONE_LAST = {...computeHRZones({age:30,maxHR:196,maxHRFormula:'tanaka',restingHR:60,activityLevel:'moderate'}), method:'karvonen'};
    saveHRZonesToProfile();
  `);
  const hz = JSON.parse(win.eval(`JSON.stringify(currentHRZones())`));
  const expectedZone2 = hz.zones[1].karvonen; // [lo,hi]
  const t2 = win.eval(`sessionAerobicHRNote('9–10 km, AM, HR ≤148–152')`);
  const t2Expected = `9–10 km, AM, HR ${expectedZone2[0]}–${expectedZone2[1]} (Zone 2)`;
  console.log('Test 2 (w2d6 Long Run example: static "HR ≤148–152" (Zone 1-level) becomes a live Zone 2/Aerobic range):',
    t2 === t2Expected ? 'PASS' : 'FAIL', { got: t2, expected: t2Expected, expectedZone2 });
  const t2NotZone1 = !t2.includes('148–152');
  console.log('Test 2b (the fixed text no longer shows the old Zone-1-level 148–152 range):',
    t2NotZone1 ? 'PASS' : 'FAIL', { got: t2 });

  // ---- Test 3: all 5 real BLOCK5_SESSIONS det-derived examples that had embedded HR text produce
  // the expected stripped+replaced text, covering both the single-number ("HR ≤148") and range
  // ("HR ≤148–152") forms the plan actually used. ----
  const examples = [
    ['4–5 km, flat, AM, HR ≤148', `4–5 km, flat, AM, HR ${expectedZone2[0]}–${expectedZone2[1]} (Zone 2)`], // w1d1
    ['8–9 km, AM, flat route, HR ≤148', `8–9 km, AM, flat route, HR ${expectedZone2[0]}–${expectedZone2[1]} (Zone 2)`], // w1d6
    ['7–8 km, AM, HR ≤148–152', `7–8 km, AM, HR ${expectedZone2[0]}–${expectedZone2[1]} (Zone 2)`], // w2d1
    ['9–10 km, AM, HR ≤148–152', `9–10 km, AM, HR ${expectedZone2[0]}–${expectedZone2[1]} (Zone 2)`], // w2d6
    ['10–11 km, AM, HR ≤152', `10–11 km, AM, HR ${expectedZone2[0]}–${expectedZone2[1]} (Zone 2)`] // w3d6
  ];
  const t3Results = examples.map(([input, expected]) => {
    const got = win.eval(`sessionAerobicHRNote(${JSON.stringify(input)})`);
    return { input, expected, got, pass: got === expected };
  });
  console.log('Test 3 (all 5 real BLOCK5_SESSIONS HR-bearing det examples get the live Zone 2 range):',
    t3Results.every(r => r.pass) ? 'PASS' : 'FAIL', t3Results);

  // ---- Test 4: sessions that never had embedded HR text to begin with (e.g. w1d3 Easy Run's real
  // det text) are left completely untouched -- this only touches the specific "HR ≤..." substring, it
  // doesn't invent HR guidance for a session that never had any. ----
  const t4Input = '5–6 km, flat, only if Monday was clean';
  const t4 = win.eval(`sessionAerobicHRNote(${JSON.stringify(t4Input)})`);
  console.log('Test 4 (a session with no embedded HR text is left completely unchanged):',
    t4 === t4Input ? 'PASS' : 'FAIL', { got: t4 });

  // ---- Test 5: end-to-end through stepsFor() -- the real w2d6 Long Run session object (Dylon's own
  // screenshot example) now renders its Main step's sub-line with the live Zone 2 range, via the real
  // BLOCK5_SESSIONS entry and the real stepsFor()/runSteps() rendering path, not just the helper
  // function in isolation. ----
  const t5Sub = win.eval(`
    (function(){
      const s = BLOCK5_SESSIONS.find(x=>x.id==='w2d6');
      const steps = stepsFor(s);
      const main = steps.find(st=>st.type==='runline' && st.big);
      return main.sub;
    })()
  `);
  console.log('Test 5 (end-to-end: the real w2d6 Long Run session, rendered via stepsFor(), shows the live Zone 2 range):',
    t5Sub === `9–10 km, AM, HR ${expectedZone2[0]}–${expectedZone2[1]} (Zone 2)` ? 'PASS' : 'FAIL', { got: t5Sub });

  // ---- Test 6: BLOCK4_SESSIONS (historical/completed past-block data, loaded with its own explicit
  // structured `steps` arrays) never reaches sessionAerobicHRNote() at all -- stepsFor()'s very first
  // check (`if(s.steps && s.steps.length) return s.steps`) returns those steps as-is, so rewriting an
  // already-executed past block's HR text is correctly out of scope for this fix. ----
  const t6 = win.eval(`
    (function(){
      if(typeof BLOCK4_SESSIONS === 'undefined') return 'no-block4';
      const withSteps = BLOCK4_SESSIONS.find(x=>x.steps && x.steps.length);
      if(!withSteps) return 'no-structured-steps-found';
      const steps = stepsFor(withSteps);
      return steps === withSteps.steps ? 'unchanged' : 'modified';
    })()
  `);
  console.log('Test 6 (BLOCK4_SESSIONS historical sessions with structured steps bypass sessionAerobicHRNote entirely, untouched):',
    t6 === 'unchanged' ? 'PASS' : 'FAIL', { got: t6 });

  // ---- Test 7: with LTHR as the saved method instead of Karvonen, sessionAerobicHRNote() correctly
  // reads the LTHR-based Zone 2 range rather than silently defaulting to Karvonen -- currentHRZones()
  // must be respected end-to-end regardless of which of the 4 methods the user actually saved. ----
  win.eval(`
    HRZONE_LAST = {...computeHRZones({age:30,maxHR:196,maxHRFormula:'tanaka',restingHR:60,activityLevel:'moderate',lthr:186}), method:'lthr'};
    saveHRZonesToProfile();
  `);
  const hzLthr = JSON.parse(win.eval(`JSON.stringify(currentHRZones())`));
  const expectedZone2Lthr = hzLthr.zones[1].lthr;
  const t7 = win.eval(`sessionAerobicHRNote('9–10 km, AM, HR ≤148–152')`);
  const t7Expected = `9–10 km, AM, HR ${expectedZone2Lthr[0]}–${expectedZone2Lthr[1]} (Zone 2)`;
  console.log('Test 7 (with LTHR saved as the method, the live range correctly comes from the LTHR-based Zone 2 bounds):',
    t7 === t7Expected ? 'PASS' : 'FAIL', { got: t7, expected: t7Expected });

  await wait(200);
  win.close();
})();
