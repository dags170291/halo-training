// Regression test for v0.32.30's quality-session warm-up fix. Dylon: "before my speed intervals in
// my plan i didnt notice any warm up jogs" -- turned out w2d3 (Fartlek Bridge, the block's very first
// quality session) had no warm-up prescribed anywhere (not in its det text, not in QUALITY_CFG,
// which only had entries starting at w3d3), so it fell through to genericStep() with no structured
// Warm Up/Cool Down breakdown at all. Separately, Dylon: "but i see walks as warm up in my other
// quality sessions" -- w3d3's own QUALITY_CFG entry said "1.5 km easy walk + drills" while every
// other quality session (w4d1 onward) says "easy jog + drills"; nothing in the plan's own narrative
// doc supports a walk-only warm-up before interval pace, so this was a leftover inconsistency, fixed
// to match the rest. Fix: QUALITY_CFG gained a new w2d3 entry (jog warm-up, matching its own det
// text's 12x30s/1min-jog-recovery structure), and w3d3's wu field was corrected from "walk" to "jog".
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
  win.eval(`ACTIVE_BLOCK_ID='block5';`);

  // ---- Test 1: QUALITY_CFG now has a w2d3 entry (previously missing entirely) ----
  const w2d3Cfg = win.eval(`JSON.stringify(QUALITY_CFG['w2d3'])`);
  const w2d3CfgObj = JSON.parse(w2d3Cfg);
  console.log('Test 1 (QUALITY_CFG now has a w2d3 entry with a jog warm-up):',
    (w2d3CfgObj && /jog/.test(w2d3CfgObj.wu) && !/walk/.test(w2d3CfgObj.wu)) ? 'PASS' : 'FAIL', { w2d3CfgObj });

  // ---- Test 2: w2d3's config matches its own det text (12 reps of 30s, ~5:00/km effort) so the
  // structured breakdown doesn't drift from the plain-text description like the header comment warns
  // about ----
  console.log('Test 2 (w2d3 config reps/repDist/pace match its own det text):',
    (w2d3CfgObj.reps===12 && w2d3CfgObj.repDist==='30s' && w2d3CfgObj.pace==='~5:00/km effort') ? 'PASS' : 'FAIL', { w2d3CfgObj });

  // ---- Test 3: stepsFor() for a w2d3 qual session on Block 5 now returns a real structured
  // breakdown (via intervalSteps) with a Warm Up group, instead of falling through to genericStep
  // with no warm-up at all ----
  win.eval(`
    __w2d3Session = {id:'w2d3', ty:'qual', wk:2, ti:'Fartlek Bridge 12×30s', det:'test'};
  `);
  const w2d3Steps = win.eval(`JSON.stringify(stepsFor(__w2d3Session))`);
  const w2d3StepsArr = JSON.parse(w2d3Steps);
  const warmUpGroup = w2d3StepsArr.find(g => g.type === 'group' && g.label === 'Warm Up');
  const warmUpLine = w2d3StepsArr[w2d3StepsArr.indexOf(warmUpGroup) + 1];
  console.log('Test 3 (stepsFor(w2d3) on Block 5 now returns a real Warm Up group with a jog line):', {
    hasWarmUpGroup: !!warmUpGroup,
    warmUpText: warmUpLine && warmUpLine.text,
    result: (warmUpGroup && warmUpLine && /jog/.test(warmUpLine.text)) ? 'PASS' : 'FAIL'
  });

  // ---- Test 4: QUALITY_CFG.w3d3's warm-up was corrected from "walk" to "jog" ----
  const w3d3Cfg = win.eval(`JSON.stringify(QUALITY_CFG['w3d3'])`);
  const w3d3CfgObj = JSON.parse(w3d3Cfg);
  console.log('Test 4 (QUALITY_CFG.w3d3 warm-up now says jog, not walk):',
    (/jog/.test(w3d3CfgObj.wu) && !/walk/.test(w3d3CfgObj.wu)) ? 'PASS' : 'FAIL', { w3d3CfgObj });

  // ---- Test 5: stepsFor() for a real w3d3 qual session on Block 5 reflects the corrected jog
  // warm-up in its rendered Warm Up group ----
  win.eval(`
    __w3d3Session = {id:'w3d3', ty:'qual', wk:3, ti:'12×2min Intervals', det:'test'};
  `);
  const w3d3Steps = win.eval(`JSON.stringify(stepsFor(__w3d3Session))`);
  const w3d3StepsArr = JSON.parse(w3d3Steps);
  const w3d3WarmUpGroup = w3d3StepsArr.find(g => g.type === 'group' && g.label === 'Warm Up');
  const w3d3WarmUpLine = w3d3StepsArr[w3d3StepsArr.indexOf(w3d3WarmUpGroup) + 1];
  console.log('Test 5 (stepsFor(w3d3) on Block 5 renders the corrected jog warm-up, not walk):', {
    warmUpText: w3d3WarmUpLine && w3d3WarmUpLine.text,
    result: (w3d3WarmUpLine && /jog/.test(w3d3WarmUpLine.text) && !/walk/.test(w3d3WarmUpLine.text)) ? 'PASS' : 'FAIL'
  });

  // ---- Test 6: every other existing QUALITY_CFG entry is untouched by this fix -- still says jog,
  // same as before. w5d3 is excluded here: a later plan revision turned that session into an Easy
  // Run + Tempo Finish (no longer ty:'qual'), so it no longer has a QUALITY_CFG entry at all -- see
  // that entry's own comment in index.html. ----
  const untouchedIds = ['w4d1','w6d3','w7d3','w8d3','w9d3','w10d3'];
  const allStillJog = win.eval(`JSON.stringify([${untouchedIds.map(id=>`QUALITY_CFG['${id}'].wu`).join(',')}])`);
  const allStillJogArr = JSON.parse(allStillJog);
  console.log('Test 6 (every other quality session\\u2019s warm-up is untouched, still jog-based):',
    allStillJogArr.every(wu => /jog/.test(wu)) ? 'PASS' : 'FAIL', { allStillJogArr });

  await wait(200);
  win.close();
})();
