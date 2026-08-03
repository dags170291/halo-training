// Regression test for structured interval (Quality/Interval session) editing. Dylon: "intervals need
// more editing features, eg no of times to repeat a, or number of reps. or pace each rep, distance vs
// time each rep etc. overall distance dont matter as much but the app should be able to calculate based
// on the data entered." Asked via AskUserQuestion: (1) uniform reps vs a custom per-rep list -- chose
// CUSTOM, so s.intervalReps is a flat array where each rep can have its own distance-or-time value, its
// own pace, and its own optional rest; (2) whether time-based rest should count toward total distance --
// chose NOT to estimate it, since that would mean fabricating an assumed recovery pace.
//
// This sits alongside (not replacing) the pre-existing Distance Min/Max / Pace Min/Max / HR Min/Max
// fields from the v0.34.23 "Edit Distance / Pace / HR" feature (see test_plan_session_edit.js) -- a
// Quality session that's never been touched by the new Intervals editor keeps using those exactly as
// before; only once s.intervalReps has real reps does the calculated total take over Distance Min/Max.
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
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-20',endDate:'2026-08-30',mileagePlan:{1:9},sessions:[
      {id:'w1d1',wk:1,d:'D1',ty:'easy',date:'2026-07-22',wd:'Wed',ti:'Easy Run',full:'Easy Run',det:'AM',dist:'9-10 km',shoe:'SL2'},
      {id:'w1d3',wk:1,d:'D3',ty:'qual',date:'2026-07-24',wd:'Fri',ti:'Intervals',full:'Intervals',det:'reps',dist:'~7 km'}
    ]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-20'; BLOCK_END='2026-08-30';
    STATUS={}; NOTES={};
  `);

  // ---- Test 1: intervalRepDistanceKm / intervalRepDurationSec calculate (never guess) whichever side
  // wasn't directly entered, from the OTHER real data actually entered for that same rep. ----
  const distRepDur = win.eval(`intervalRepDurationSec({workType:'distance',workVal:'1',pace:'5:00'})`); // 1km @ 5:00/km = 300s
  const timeRepDist = win.eval(`intervalRepDistanceKm({workType:'time',workVal:'3:00',pace:'5:00'})`); // 180s / 300s-per-km = 0.6km
  const timeRepNoPaceDist = win.eval(`intervalRepDistanceKm({workType:'time',workVal:'3:00'})`); // no pace -> can't calculate -> null
  const distRepNoPaceDur = win.eval(`intervalRepDurationSec({workType:'distance',workVal:'1'})`); // no pace -> null
  const t1 = distRepDur === 300 && Math.abs(timeRepDist-0.6)<0.0001 && timeRepNoPaceDist === null && distRepNoPaceDur === null;
  console.log('Test 1 (rep distance/duration calculated from real entered data, never guessed when pace is missing):',
    t1 ? 'PASS' : 'FAIL', { distRepDur, timeRepDist, timeRepNoPaceDist, distRepNoPaceDur });

  // ---- Test 2: rest/warmup/cooldown segments only contribute distance when entered AS a distance, and
  // only contribute duration when entered as time -- confirming Dylon's own answer: time-based rest is
  // never estimated into a distance (no assumed recovery pace baked in anywhere). ----
  const restDistKm = win.eval(`intervalRestDistanceKm({type:'distance',val:'0.4'})`);
  const restDistDur = win.eval(`intervalRestDurationSec({type:'distance',val:'0.4'})`); // distance-type rest -> 0 duration (can't compute without its own pace)
  const restTimeKm = win.eval(`intervalRestDistanceKm({type:'time',val:'1:30'})`); // time-type rest -> 0 distance, NOT estimated
  const restTimeDur = win.eval(`intervalRestDurationSec({type:'time',val:'1:30'})`);
  const t2 = restDistKm === 0.4 && restDistDur === 0 && restTimeKm === 0 && restTimeDur === 90;
  console.log('Test 2 (rest only counts toward distance when entered as distance, toward duration when entered as time):',
    t2 ? 'PASS' : 'FAIL', { restDistKm, restDistDur, restTimeKm, restTimeDur });

  // ---- Test 3: intervalSetTotals rolls warmup + reps (with per-rep rest) + cooldown into one totals
  // object, matching a hand-computed expectation. Session: warmup 1.5km (distance) + 2 reps (rep1:
  // 800m @ 5:00/km with 90s time-based rest after it; rep2: 3:00 @ 5:00/km i.e. 0.6km, with a 0.2km
  // distance-based rest after it) + cooldown 8:00 (time). ----
  win.eval(`
    window.__totalsSess = {
      warmup:{type:'distance',val:'1.5'},
      cooldown:{type:'time',val:'8:00'},
      intervalReps:[
        {workType:'distance',workVal:'0.8',pace:'5:00',rest:{type:'time',val:'1:30'}},
        {workType:'time',workVal:'3:00',pace:'5:00',rest:{type:'distance',val:'0.2'}}
      ]
    };
  `);
  const totals = JSON.parse(win.eval(`JSON.stringify(intervalSetTotals(window.__totalsSess))`));
  // distKm = 1.5(warmup) + 0.8(rep1) + 0(rep1 rest, time-based) + 0.6(rep2, 3:00/5:00perkm) + 0.2(rep2 rest, distance-based) = 3.1
  // durSec = 0(warmup, distance-type) + 240(rep1, 0.8km@5:00/km=240s) + 90(rep1 rest) + 180(rep2, 3:00) + 0(rep2 rest, distance-type) + 480(cooldown 8:00) = 990
  const t3 = Math.abs(totals.distKm-3.1)<0.001 && totals.durSec===990 && totals.repsCount===2;
  console.log('Test 3 (intervalSetTotals rolls warmup+reps+rests+cooldown into one correct totals object):',
    t3 ? 'PASS' : 'FAIL', { totals });

  // ---- Test 4: the Intervals editor card only renders for a Quality/Interval session, not Easy/Long,
  // when the edit form is open -- with its warmup/reps-list/cooldown/quick-add fields all present. ----
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d3'); togglePlanEdit('w1d3')`);
  const qualFormHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d1'); togglePlanEdit('w1d1')`);
  const easyFormHTML = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  const t4QualHasFields = ['pe-warmup','pe-reps-list','pe-cooldown','pe-qa-count','pe-qa-val','pe-qa-pace','pe-qa-rest'].every(id=>qualFormHTML.includes(`id="${id}"`));
  const t4 = t4QualHasFields && !easyFormHTML.includes('id="pe-warmup"');
  console.log('Test 4 (Intervals editor card shows for Quality sessions only, not Easy/Long):',
    t4 ? 'PASS' : 'FAIL');

  // ---- Test 5: addBlankIntervalRep() appends one row to #pe-reps-list. ----
  win.eval(`PLAN_EDIT_OPEN=false; openLog('w1d3'); togglePlanEdit('w1d3')`);
  const beforeAdd = win.eval(`document.getElementById('pe-reps-list').children.length`);
  win.eval(`addBlankIntervalRep()`);
  const afterAdd = win.eval(`document.getElementById('pe-reps-list').children.length`);
  console.log('Test 5 (addBlankIntervalRep appends one row to the reps list):',
    afterAdd === beforeAdd+1 ? 'PASS' : 'FAIL', { beforeAdd, afterAdd });

  // ---- Test 6: setIntervalRowType updates the row's own data-work-type attribute and the value
  // field's label/placeholder, without needing any per-row generated id (this-based navigation only). ----
  const rowWorkTypeBefore = win.eval(`document.querySelector('#pe-reps-list .pe-rep-row').dataset.workType`);
  win.eval(`
    const row=document.querySelector('#pe-reps-list .pe-rep-row');
    const distBtn=row.querySelector('.work-type-toggle .trend-subtab');
    setIntervalRowType(distBtn,'work','distance');
  `);
  const rowWorkTypeAfter = win.eval(`document.querySelector('#pe-reps-list .pe-rep-row').dataset.workType`);
  const labelAfter = win.eval(`document.querySelector('#pe-reps-list .pe-rep-row .work-val-label').textContent`);
  const t6 = rowWorkTypeBefore === 'time' && rowWorkTypeAfter === 'distance' && labelAfter === 'Distance (km)';
  console.log("Test 6 (setIntervalRowType updates the row's work type + label without a per-row id):",
    t6 ? 'PASS' : 'FAIL', { rowWorkTypeBefore, rowWorkTypeAfter, labelAfter });

  // ---- Test 7: quickAddIntervalReps auto-detects distance vs time from the value's own shape (mm:ss
  // -> time, plain number -> distance) and appends N identical rows, clearing its own inputs after. ----
  win.eval(`
    document.getElementById('pe-reps-list').innerHTML='';
    document.getElementById('pe-qa-count').value='3';
    document.getElementById('pe-qa-val').value='2:00';
    document.getElementById('pe-qa-pace').value='5:15';
    document.getElementById('pe-qa-rest').value='1:00';
    quickAddIntervalReps();
  `);
  const qaRowCount = win.eval(`document.getElementById('pe-reps-list').children.length`);
  const qaFirstRowType = win.eval(`document.querySelector('#pe-reps-list .pe-rep-row').dataset.workType`);
  const qaFirstRestType = win.eval(`document.querySelector('#pe-reps-list .pe-rep-row').dataset.restType`);
  const qaCountCleared = win.eval(`document.getElementById('pe-qa-count').value`) === '';
  const t7 = qaRowCount === 3 && qaFirstRowType === 'time' && qaFirstRestType === 'time' && qaCountCleared;
  console.log('Test 7 (quickAddIntervalReps auto-detects distance/time and appends N identical rows, then clears its inputs):',
    t7 ? 'PASS' : 'FAIL', { qaRowCount, qaFirstRowType, qaFirstRestType });

  // ---- Test 8: removing a row (the Remove button's own onclick, "this.closest('.pe-rep-row').remove()")
  // takes just that one row out, leaving the others -- no stored per-row id needed since rows are always
  // read back positionally on save (captureIntervalReps below). ----
  win.eval(`document.querySelectorAll('#pe-reps-list .pe-rep-row')[1].querySelector('button').click()`);
  const afterRemoveCount = win.eval(`document.getElementById('pe-reps-list').children.length`);
  console.log('Test 8 (removing one row via its own Remove button leaves the other rows intact):',
    afterRemoveCount === 2 ? 'PASS' : 'FAIL', { afterRemoveCount });

  // ---- Test 9: captureIntervalSeg / captureIntervalReps read the current DOM state back into the
  // {type,val} / [{workType,workVal,pace,rest}] shapes savePlanEdits stores on the session. ----
  win.eval(`
    document.getElementById('pe-reps-list').innerHTML='';
    document.getElementById('pe-warmup').dataset.type='distance';
    document.getElementById('pe-warmup').querySelector('.pe-seg-val').value='2';
    addBlankIntervalRep();
    const row=document.querySelector('#pe-reps-list .pe-rep-row');
    row.dataset.workType='distance'; row.dataset.restType='time';
    row.querySelector('.pe-rep-workval').value='0.8';
    row.querySelector('.pe-rep-pace').value='4:50';
    row.querySelector('.pe-rep-restval').value='1:00';
  `);
  const capturedWarmup = JSON.parse(win.eval(`JSON.stringify(captureIntervalSeg('pe-warmup'))`));
  const capturedReps = JSON.parse(win.eval(`JSON.stringify(captureIntervalReps())`));
  const t9 = capturedWarmup.type==='distance' && capturedWarmup.val==='2'
    && capturedReps.length===1 && capturedReps[0].workType==='distance' && capturedReps[0].workVal==='0.8'
    && capturedReps[0].pace==='4:50' && capturedReps[0].rest.type==='time' && capturedReps[0].rest.val==='1:00';
  console.log('Test 9 (captureIntervalSeg/captureIntervalReps read the current DOM state back into the right shape):',
    t9 ? 'PASS' : 'FAIL', { capturedWarmup, capturedReps });

  // ---- Test 10: saving the form end-to-end persists s.warmup/s.cooldown/s.intervalReps onto the real
  // session AND overwrites Distance Min/Max with the calculated total (not left at whatever it was, or
  // at 0) -- this is the actual "the app should calculate overall distance from the data entered" ask. ----
  win.eval(`
    document.getElementById('pe-cooldown').dataset.type='time';
    document.getElementById('pe-cooldown').querySelector('.pe-seg-val').value='5:00';
    savePlanEdits('w1d3');
  `);
  const savedSess = JSON.parse(win.eval(`JSON.stringify(findSess('w1d3'))`));
  // warmup 2km (distance) + rep 0.8km@4:50/km (distance-type, direct) + rest 0 (time-based, not estimated)
  // + cooldown 0 (time-type) = 2.8km total
  const t10 = savedSess.warmup && savedSess.warmup.val==='2' && savedSess.cooldown && savedSess.cooldown.val==='5:00'
    && savedSess.intervalReps.length===1 && Math.abs(savedSess.distMin-2.8)<0.001 && savedSess.distMin===savedSess.distMax
    && /2\.8/.test(savedSess.dist);
  console.log('Test 10 (saving persists warmup/cooldown/intervalReps and overwrites Distance Min/Max with the calculated total):',
    t10 ? 'PASS' : 'FAIL', { savedSess });

  // ---- Test 11: stepsFor(s) now returns real per-rep work/rest steps for a session with intervalReps --
  // a Main Set group, one work step per rep (with its own distance+pace text), and a rest step wherever
  // a rest was actually prescribed for that rep (this session's one rep has a 1:00 time-based rest, set
  // up back in Test 9's DOM state and carried through Test 10's save). ----
  const steps = JSON.parse(win.eval(`JSON.stringify(stepsFor(findSess('w1d3')))`));
  const workSteps = steps.filter(st=>st.type==='interval'&&st.kind==='work');
  const restSteps = steps.filter(st=>st.type==='interval'&&st.kind==='rest');
  const t11 = steps.some(st=>st.type==='group'&&st.label==='Main Set') && workSteps.length===1 && restSteps.length===1
    && workSteps[0].text.includes('0.8 km') && workSteps[0].text.includes('4:50') && restSteps[0].text.includes('1:00');
  console.log('Test 11 (stepsFor builds real per-rep work+rest steps from intervalReps):',
    t11 ? 'PASS' : 'FAIL', { steps });

  // ---- Test 12: a Quality session that's never had intervals entered (intervalReps empty/absent)
  // still falls back to the original generic step rendering, completely unaffected by this feature --
  // and saving with an EMPTY reps list leaves Distance Min/Max exactly as manually typed, not zeroed. ----
  win.eval(`
    BLOCKS[0].sessions.push({id:'w1d9',wk:1,d:'D9',ty:'qual',date:'2026-07-26',wd:'Sun',ti:'Untouched Intervals',full:'Untouched Intervals',det:'reps',dist:'6 km'});
    DATA=BLOCKS[0].sessions;
    PLAN_EDIT_OPEN=false; openLog('w1d9'); togglePlanEdit('w1d9');
    document.getElementById('pe-dist-min').value='6'; document.getElementById('pe-dist-max').value='6';
    savePlanEdits('w1d9');
  `);
  const untouchedSess = JSON.parse(win.eval(`JSON.stringify(findSess('w1d9'))`));
  const untouchedSteps = JSON.parse(win.eval(`JSON.stringify(stepsFor(findSess('w1d9')))`));
  const t12 = untouchedSess.distMin===6 && untouchedSess.distMax===6 && Array.isArray(untouchedSess.intervalReps) && untouchedSess.intervalReps.length===0
    && !untouchedSteps.some(st=>st.type==='group'&&st.label==='Main Set'&&st.sets&&st.sets.includes('rep'));
  console.log('Test 12 (a Quality session with no intervals entered keeps its manually-typed Distance Min/Max, unaffected by this feature):',
    t12 ? 'PASS' : 'FAIL', { untouchedSess, untouchedStepsFirst: untouchedSteps[0] });

  await wait(200);
  win.close();
})();
