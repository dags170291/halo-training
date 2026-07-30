// Regression test for a real reported bug, and a genuinely different bug than the one everyone
// (including me) had been chasing across the previous few rounds. Dylon, with a screenshot proving the
// Activity Trends weekly numbers were actually correct (matching what he saw on Strava): "how u were
// calculating the data wasnt incorrect infact that version lined up perfectly to what i was seeing on
// strava. the issue is the total km logged (in the activity grid) was giving incorrect figures 28 in
// week 1 and 20 in week 2 is 48km but the total km logged was 53. that is incorrect."
//
// Root cause: weekActualKm() (which feeds cumulativeActualKm(), which feeds the "km logged / planned"
// stat card, weeklyConsistency(), and the Mileage-by-Week bars) summed loggedDist() for EVERY session
// marked done in a week, with no session-type filter at all -- unlike weekMetricTotal(wk,'run') (the
// function behind Activity Trends' correct weekly numbers), which only ever looks at run-type sessions
// via sessionMatchesTrendType(s,'run'). cumulativeActualKm() is explicitly documented elsewhere in this
// file as "run-plan-specific on purpose" and is compared directly against blockPlanTotal()/
// MILEAGE_PLAN -- a running mileage plan -- so a non-run session (Strength, Mobility, a Weekly Check-In)
// that happened to have a distance attached (a stale hand-typed NOTES.dist, or a linked Activity that
// picked up a real GPS distance for an unrelated reason) silently inflated "km logged" past the true
// running total, with no relationship to Monday-vs-BLOCK_START week bucketing at all -- that part of
// Activity Trends was correct the whole time. Fixed: weekActualKm() now skips any session that isn't a
// run-type session, matching sessionMatchesTrendType('run', s).
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

  // Week 1: one real Easy Run (5km, done) plus a Strength session that's ALSO marked done and, for
  // whatever real-world reason (a stale hand-typed NOTES.dist left over from testing, a linked Activity
  // that picked up a distance it shouldn't have), has its own loggedDist() resolve to 5km too. The
  // Activity Trends Run total should only ever see the 5km run; "km logged" should match it exactly, not
  // silently add the strength session's 5km on top.
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-19',endDate:'2026-08-30',mileagePlan:{1:20,2:20},sessions:[
      {id:'w1run',wk:1,d:'D2',ty:'easy',date:'2026-07-21',wd:'Tue',ti:'Easy Run',full:'Easy Run',det:'',dist:'5K'},
      {id:'w1str',wk:1,d:'D3',ty:'str',date:'2026-07-22',wd:'Wed',ti:'Strength',full:'Strength',det:'',dist:''}
    ]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-19'; BLOCK_END='2026-08-30';
    STATUS={w1run:'done',w1str:'done'}; NOTES={w1run:{dist:'5'},w1str:{dist:'5'}};
    ACTIVITIES=[]; EXTRALOGS=[];
  `);

  // ---- Test 1: the strength session's stray 5km is invisible to weekActualKm -- "km logged" should
  // read exactly 5, matching the one real run, not 10. ----
  const t1 = win.eval(`weekActualKm(1)`);
  console.log('Test 1 (weekActualKm ignores a done Strength session\'s distance, counting only the real run):',
    (t1.total===5 && t1.any===true) ? 'PASS' : 'FAIL', { t1 });

  // ---- Test 2: cumulativeActualKm (the actual number shown on the "km logged / planned" stat card)
  // matches Activity Trends' own weekly Run total for the same week exactly -- the real-world "28+20=48
  // but km logged says 53" complaint, reproduced and fixed. ----
  const cum = win.eval(`cumulativeActualKm()`);
  const runTotal = win.eval(`weekMetricTotal(1,'run')`);
  console.log('Test 2 (cumulativeActualKm now matches the Activity Trends weekly Run total exactly, not inflated by the strength session):',
    (cum===5 && runTotal.total===5) ? 'PASS' : 'FAIL', { cum, runTotal });

  // ---- Test 3: a session type that's neither a run type nor has anything to do with mileage at all
  // (Mobility) is also correctly excluded, not just Strength -- confirms the fix is a genuine type
  // filter, not something narrowly patched for one session type. ----
  win.eval(`
    DATA.push({id:'w1mob',wk:1,d:'D4',ty:'mobility',date:'2026-07-23',wd:'Thu',ti:'Mobility',full:'Mobility',det:'',dist:''});
    STATUS.w1mob='done'; NOTES.w1mob={dist:'3'};
  `);
  const t3 = win.eval(`weekActualKm(1)`);
  console.log('Test 3 (a done Mobility session with its own stray distance is also excluded from km logged):',
    t3.total===5 ? 'PASS' : 'FAIL', { t3 });

  // ---- Test 4: a genuinely different real run in the SAME week still adds normally -- confirms this
  // is a type filter, not an accidental "only count the first session" regression. ----
  win.eval(`
    DATA.push({id:'w1run2',wk:1,d:'D5',ty:'long',date:'2026-07-24',wd:'Fri',ti:'Long Run',full:'Long Run',det:'',dist:'8K'});
    STATUS.w1run2='done'; NOTES.w1run2={dist:'8'};
  `);
  const t4 = win.eval(`weekActualKm(1)`);
  console.log('Test 4 (a second real run in the same week still adds normally, 5km + 8km = 13km):',
    Math.abs(t4.total-13)<0.001 ? 'PASS' : 'FAIL', { t4 });

  await wait(200);
  win.close();
})();
