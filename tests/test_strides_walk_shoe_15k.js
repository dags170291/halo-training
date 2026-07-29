// Regression test for a batch of small, unrelated fixes requested together: (1) strides logged in
// the Strides table now count toward Progress totals (loggedDist/sessionDurationSec) as a fallback
// when the session's own Distance/Duration fields were left blank -- Dylon: "ensure that when i
// record strides that data gets calculated as well in progress" -- but never double-count on top of
// a real Distance/Duration value, since that field is normally the whole continuous GPS activity and
// already covers every stride; (2) the manual Walk quick-add form now has a Shoe worn field, same as
// Run, and that shoe's walked km count toward its total wear -- Dylon: "include shoes selection in
// walks wheni add a manual activity"; (3) 15K is now a real distance bucket, alongside the Personal
// Bests card and the Race Predictions card.
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
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-09-01',sessions:[
      {id:'s1',wk:1,ty:'easy',date:'2026-07-01',ph:'dur',ti:'Easy Run + Strides'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions;
    ACTIVE_BLOCK_ID='b1';
    STATUS={s1:'done'};
    NOTES={};
    EXTRALOGS=[];
    RACES_LIST=[];
    SHOES={sl2:{brand:'ASICS',model:'SL2',km:0}};
  `);

  // ==== Strides counted in Progress ====

  // ---- Test 1: a session logged ONLY via the Strides table (no main Distance/Duration) is no
  // longer silently counted as 0 km / 0 sec -- it falls back to the strides' own summed totals ----
  win.eval(`NOTES.s1 = {strideReps:[{dist:'100m',dur:'20s'},{dist:'100m',dur:'20s'},{dist:'100m',dur:'20s'},{dist:'100m',dur:'20s'}]};`);
  const distFromStridesOnly = win.eval(`loggedDist('s1')`);
  const durFromStridesOnly = win.eval(`sessionDurationSec('s1')`);
  console.log('Test 1 (strides-only log falls back to summed stride distance/duration, not zero):',
    (Math.abs(distFromStridesOnly-0.4)<0.001 && durFromStridesOnly===80) ? 'PASS' : 'FAIL', { distFromStridesOnly, durFromStridesOnly });

  // ---- Test 2: once a real main Distance is entered, it wins outright -- strides are NOT summed on
  // top (the main field is the whole continuous GPS activity, already covering every stride) ----
  win.eval(`NOTES.s1.dist='5';`);
  const distWithMainField = win.eval(`loggedDist('s1')`);
  console.log('Test 2 (a real main Distance field is authoritative -- strides are never double-counted on top):',
    distWithMainField===5 ? 'PASS' : 'FAIL', { distWithMainField });

  // ---- Test 3: same non-double-counting rule for Duration -- a real main Duration wins over the
  // strides' own summed duration ----
  win.eval(`NOTES.s1.duration='30:00';`);
  const durWithMainField = win.eval(`sessionDurationSec('s1')`);
  console.log('Test 3 (a real main Duration field is authoritative -- strides duration is never added on top):',
    durWithMainField===1800 ? 'PASS' : 'FAIL', { durWithMainField });

  // ---- Test 4: a week's actual mileage total (weekActualKm) reflects the strides-only fallback too,
  // not just the standalone loggedDist() helper ----
  win.eval(`NOTES.s1={strideReps:[{dist:'200m'},{dist:'200m'}]};`);
  const weekTotal = win.eval(`JSON.stringify(weekActualKm(1))`);
  console.log('Test 4 (weekActualKm reflects the strides-only fallback distance):',
    JSON.parse(weekTotal).total===0.4 ? 'PASS' : 'FAIL', { weekTotal });

  // ==== Walk shoe selection ====

  win.eval(`NOTES={}; EXTRALOGS=[];`);

  // ---- Test 5: the manual Walk quick-add form now includes a Shoe worn field, same as Run ----
  const walkFormHTML = win.eval(`buildQuickAddBody('walk', null)`);
  console.log('Test 5 (Walk quick-add form includes a Shoe worn select):',
    walkFormHTML.includes('id="qa-shoe"') ? 'PASS' : 'FAIL');

  // ---- Test 6: saving a walk with a shoe selected persists the shoe key on the EXTRALOGS entry ----
  win.eval(`
    document.getElementById('qa-sh-body').innerHTML = buildQuickAddBody('walk', null);
    QA_KIND='walk'; QA_SUBTYPE=null; QA_EDIT_ID=null; QA_SELECTED_TAGS=new Set();
    document.getElementById('qa-date').value='2026-07-05';
    document.getElementById('qa-dist').value='3.0';
    document.getElementById('qa-shoe').value='sl2';
    saveQuickAdd();
  `);
  const savedWalk = win.eval(`JSON.stringify(EXTRALOGS.find(x=>x.kind==='walk'))`);
  console.log('Test 6 (saving a Walk with a shoe selected persists kind/dist/shoe correctly):',
    (savedWalk.includes('"kind":"walk"') && savedWalk.includes('"dist":"3"') && savedWalk.includes('"shoe":"sl2"')) ? 'PASS' : 'FAIL', { savedWalk });

  // ---- Test 7: that walked distance now counts toward the shoe's total tracked mileage (shoeBlockKm/
  // shoeTotalKm), same as a run in that shoe would ----
  const shoeKm = win.eval(`shoeTotalKm('sl2')`);
  console.log('Test 7 (a walk logged in a shoe counts toward that shoe\\u2019s total mileage):',
    shoeKm===3 ? 'PASS' : 'FAIL', { shoeKm });

  // ==== 15K distance ====

  win.eval(`RACES_LIST=[]; SHOES={};`);

  // ---- Test 8: raceDistBucket recognizes "15K"/"15k"/"15 km" as the 15K bucket ----
  const bucket1 = win.eval(`raceDistBucket('15K')`);
  const bucket2 = win.eval(`raceDistBucket('15k')`);
  const bucket3 = win.eval(`raceDistBucket('15 km')`);
  console.log('Test 8 (raceDistBucket recognizes 15K in its various free-text forms):',
    (bucket1==='15K' && bucket2==='15K' && bucket3==='15K') ? 'PASS' : 'FAIL', { bucket1, bucket2, bucket3 });

  // ---- Test 9: 15K appears in RACE_DIST_BUCKETS (drives both the Race Calendar's distance filter
  // chips and the Personal Bests card's per-distance grid) ----
  const bucketsHas15k = win.eval(`RACE_DIST_BUCKETS.includes('15K')`);
  console.log('Test 9 (RACE_DIST_BUCKETS includes 15K):', bucketsHas15k ? 'PASS' : 'FAIL');

  // ---- Test 10: a 15K marked as a Personal Best shows up correctly in personalBestsSectionHTML ----
  win.eval(`
    RACES_LIST=[{key:'r15k',name:'Local 15K',date:'2026-03-01',distance:'15K',status:'done',actualTime:'1:05:00',isPB:true}];
  `);
  const pbHTML = win.eval(`personalBestsSectionHTML()`);
  console.log('Test 10 (a 15K Personal Best renders correctly in the Personal Bests card):',
    (pbHTML.includes('15K') && pbHTML.includes('1:05:00')) ? 'PASS' : 'FAIL');

  // ---- Test 11: the Race Predictions card includes a real 15K row with its own projected time,
  // distinct from 10K and Half ----
  win.eval(`EXTRALOGS=[{id:'x1',kind:'run',dist:5,pace:'5:00',date:'2026-07-01'}];`);
  const predictorHTML = win.eval(`racePredictionsCardHTML()`);
  const rows = JSON.parse(win.eval(`JSON.stringify(racePredictionRows())`));
  const km15 = rows.find(r=>r.label==='15K');
  console.log('Test 11 (Race Predictions card shows a real, distinct 15K row):', {
    hasRowInHTML: predictorHTML.includes('>15K<'),
    km15,
    result: (predictorHTML.includes('>15K<') && km15 && km15.proj && km15.km===15) ? 'PASS' : 'FAIL'
  });

  await wait(200);
  win.close();
})();
