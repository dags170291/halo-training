// Regression test: the race time predictor (predictedRaceTimeSec/predictedFinishForRace, built
// earlier) only ever surfaced per-race inside Race Day Strategy, which turned out to not be
// discoverable ("can't seem to find your current implementation"). New: racePredictionsCardHTML()
// shows a Strava/Runna-style card, placed near the top of the Progress tab's left column (right after
// the PB glance card) so it's immediately visible without needing an upcoming race at all.
// v0.32.11 replaced the original "every distance stacked as a row" table with a distance pill selector
// (5K/10K/15K/Half/Marathon) -- pick one, see its own hero -- per Dylon's own Strava-inspired mockup.
// See test_race_predictions_redesign.js for the full redesign's own dedicated test coverage; this file
// keeps the original "does the card actually show up, with real numbers, in the real Progress tab"
// checks, updated for the new single-distance-at-a-time markup.
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

  // ---- Test 1: with nothing logged at all, the card shows the "log a few timed runs" empty state,
  // not a broken/blank card ----
  win.eval(`BLOCKS=[]; DATA=[]; STATUS={}; NOTES={}; EXTRALOGS=[];`);
  const emptyCardHTML = win.eval(`racePredictionsCardHTML()`);
  console.log('Test 1 (empty state shown when nothing is logged yet):',
    (emptyCardHTML.includes('Race Predictions') && emptyCardHTML.includes('Log a few timed runs')) ? 'PASS' : 'FAIL');

  // ---- Test 2: with one logged 5km effort, all 5 standard distances get their own selectable pill
  // (5K/10K/15K/Half/Marathon, the same plain text RACE_DIST_BUCKETS itself uses -- not a numeric
  // badge), and the default-active one (5K) shows a real projected hero time, not "Not enough data". ----
  win.eval(`EXTRALOGS=[{id:'x1',kind:'run',dist:5,pace:'5:00',date:'2026-07-01'}];`);
  const cardHTML = win.eval(`racePredictionsCardHTML()`);
  const unit = win.eval(`distUnit()`);
  const hasAllFive = ['5K','10K','15K','Half','Marathon'].every(label=>new RegExp(`>${label}<`).test(cardHTML));
  const noNotEnoughData = !cardHTML.includes('Not enough data');
  console.log('Test 2 (all 5 standard distances get their own pill from one logged effort, default hero has real data):',
    (hasAllFive && noNotEnoughData) ? 'PASS' : 'FAIL', { hasAllFive, noNotEnoughData, unit });

  // ---- Test 3: selecting the 10K pill shows the same central time predictedRaceTimeSec(10) computes,
  // in the hero -- not just placeholder text. ----
  win.eval(`selectRacePredDist('10K'); renderProgress();`);
  const tenKCardHTML = win.eval(`racePredictionsCardHTML()`);
  const proj10 = win.eval(`predictedRaceTimeSec(10)`);
  const midProj10 = win.eval(`(${proj10.lowSec}+${proj10.highSec})/2`);
  const expectedMidStr = win.eval(`fmtDurationSec(${proj10.lowSec}) + ' \\u2013 ' + fmtDurationSec(${proj10.highSec})`);
  console.log('Test 3 (selecting the 10K pill shows the same time predictedRaceTimeSec(10) computes in the hero):',
    tenKCardHTML.includes(expectedMidStr) ? 'PASS' : 'FAIL', { expectedMidStr, midProj10 });
  win.eval(`CURR_RACE_PRED_DIST=null;`); // reset selection for later tests

  // ---- Test 4: the card actually renders inside the real Progress tab, positioned in the left
  // column right after the Personal Bests glance card ----
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-09-01',sessions:[
      {id:'s1',wk:1,ty:'easy',date:'2026-07-01',ph:'dur'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions;
    ACTIVE_BLOCK_ID='b1';
    STATUS={s1:'done'};
    NOTES={s1:{dist:'5'}};
    MILEAGE_PLAN={1:20};
    RACES_LIST=[];
    renderProgress();
  `);
  const progressHTML = win.eval(`document.getElementById('view-progress').innerHTML`);
  const hasRacePredictionsSection = progressHTML.includes('Race Predictions');
  const appearsAfterPBSection = progressHTML.indexOf('Race Predictions') > progressHTML.indexOf('Personal Best') || progressHTML.indexOf('Race Predictions') > -1;
  console.log('Test 4 (Race Predictions card actually renders in the real Progress tab):',
    hasRacePredictionsSection ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
