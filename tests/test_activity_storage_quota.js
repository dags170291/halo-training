// Regression test for "my uploaded activity is no longer present in the planned sessions after I
// reload" (deployed: week 1 stayed, week 2 vanished; local: nothing survived at all). Dylon's real
// backup showed why: each imported Activity keeps a full 1Hz GPS/HR/pace stream (t/lat/lon/alt/distM/
// hr/cadence/power/vertOsc/vertRatio/strideLen/temp), so a single ~75min run's stream alone can run
// 600KB+ of JSON. With 28 real activities his ACTIVITIES blob hit ~5.8MB -- past the browser's
// localStorage quota (jsdom's own default is exactly 5,000,000 UTF-16 code units; real browsers are in
// the same ballpark, Safari often stricter). saveActivitiesList()'s old safeSet(...) call swallowed the
// resulting QuotaExceededError with a bare catch(e){}, so the save silently no-op'd: it LOOKED like it
// worked in the moment, but nothing after the quota was first crossed ever reached disk -- gone the
// next real reload. Fix: (1) downsampleStreamArrays() caps every stream to STREAM_MAX_POINTS before
// it's persisted, keeping the on-disk footprint small regardless of raw export resolution, and
// (2) safeSet now reports success/failure so saveActivitiesList can warn the user via showToast instead
// of pretending a failed save worked.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('/tmp/node_modules/jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'halotraining-app', 'index.html'), 'utf8');

function makeWindow(seed) {
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
      if (seed) Object.keys(seed).forEach(k => { try { win.localStorage.setItem(k, seed[k]); } catch(e){} });
    }
  });
  return dom.window;
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
// jsdom windows can leave a stray timer (e.g. the tips carousel) firing after a window is done with --
// harness artifact, not app behavior; swallow so it can't fail the suite or hang the process.
process.on('uncaughtException', (e) => { console.log('UNCAUGHT:', e && e.stack || e); });
process.on('unhandledRejection', (e) => { console.log('UNHANDLED REJECTION:', e && e.stack || e); });

// Builds a synthetic but realistic 1Hz stream: durationSec points across every parallel array,
// values that vary per-index so we can check alignment survives downsampling.
function fakeStream(points) {
  const t=[],lat=[],lon=[],alt=[],distM=[],hr=[],cadence=[],power=[],vertOsc=[],vertRatio=[],strideLen=[],temp=[];
  for (let i=0;i<points;i++){
    t.push(i); lat.push(45+i*0.0001); lon.push(-73-i*0.0001); alt.push(100+i%20);
    distM.push(i*3.2); hr.push(120+(i%40)); cadence.push(170); power.push(250);
    vertOsc.push(8); vertRatio.push(6); strideLen.push(1.1); temp.push(22);
  }
  return {t,lat,lon,alt,distM,hr,cadence,power,vertOsc,vertRatio,strideLen,temp};
}

(async () => {
  const win = makeWindow(null);
  await wait(400);

  // Test 1: a stream already under the cap is returned untouched.
  win.eval(`window.__small = downsampleStreamArrays(${JSON.stringify(fakeStream(50))});`);
  const t1 = win.eval(`__small.t.length`);
  console.log('Test 1 (stream under cap is left alone):', t1 === 50 ? 'PASS' : `FAIL (got ${t1}, expected 50)`);

  // Test 2: a stream over the cap gets decimated down to STREAM_MAX_POINTS, keeping every array
  // aligned to the SAME sampled indices (t[i] and hr[i] must describe the same original moment).
  win.eval(`window.__big = ${JSON.stringify(fakeStream(4559))}; window.__down = downsampleStreamArrays(__big);`);
  const capLen = win.eval(`__down.t.length`);
  const maxPoints = win.eval(`STREAM_MAX_POINTS`);
  const alignedOk = win.eval(`
    (function(){
      // Every t[i] must equal the original array's value at whatever index hr[i] also came from --
      // reconstruct which original index each downsampled hr[i] came from via distM (i*3.2 is unique
      // per original index) and confirm t[i] matches that same original index exactly.
      for (let i=0;i<__down.t.length;i++){
        const origIdx=__down.distM[i]/3.2;
        if (Math.abs(origIdx - __down.t[i]) > 0.0001) return false;
      }
      return true;
    })();
  `);
  console.log('Test 2 (oversized stream decimated to STREAM_MAX_POINTS, arrays stay aligned):',
    (capLen === maxPoints && alignedOk) ? 'PASS' : `FAIL (capLen=${capLen}, maxPoints=${maxPoints}, aligned=${alignedOk})`);

  // Test 3: first and last points are preserved exactly (no truncation at the edges).
  const edgesOk = win.eval(`__down.t[0]===0 && __down.t[__down.t.length-1]===__big.t[__big.t.length-1]`);
  console.log('Test 3 (first/last points preserved through decimation):', edgesOk ? 'PASS' : 'FAIL');

  // Test 4: saveActivitiesList persists a COMPACTED copy to localStorage while the live in-memory
  // ACTIVITIES keeps full resolution for this session's own charts.
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2027-06-01',endDate:'2027-08-01',sessions:[
      {id:'s1',wk:1,ty:'long',date:'2027-06-05',ph:'dur',ti:'Long Run',full:'W1D5: Long Run'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; STATUS={}; NOTES={}; RACES_LIST={};
    ACTIVITIES=[normalizeActivityRecord({type:'run',role:'fulfillment',linkedSessionId:'s1',date:'2027-06-05',
      distanceKm:8.15,durationSec:4559,title:'Long Run',stream:${JSON.stringify(fakeStream(4559))}})];
    saveActivitiesList();
  `);
  const liveLen = win.eval(`ACTIVITIES[0].stream.t.length`);
  const persistedLen = win.eval(`JSON.parse(localStorage.getItem('b5_activities'))[0].stream.t.length`);
  console.log('Test 4 (live ACTIVITIES stays full-res, persisted copy is compacted):',
    (liveLen === 4559 && persistedLen <= maxPoints) ? 'PASS' : `FAIL (live=${liveLen}, persisted=${persistedLen})`);

  // Test 5: safeSet reports success/failure instead of always silently returning undefined.
  const safeSetResults = win.eval(`
    (function(){
      const ok1=safeSet('__probe','small value');
      let ok2;
      try{ ok2=safeSet('__probe2','x'.repeat(6000000)); }catch(e){ ok2='threw'; }
      return {ok1,ok2};
    })();
  `);
  console.log('Test 5 (safeSet returns true on success, false on genuine quota failure):',
    (safeSetResults.ok1===true && safeSetResults.ok2===false) ? 'PASS' : `FAIL (${JSON.stringify(safeSetResults)})`);

  // Test 6: if a save still fails even after compaction (a genuinely oversized total -- e.g. many
  // months of real training, each activity already at the per-activity cap but hundreds of them),
  // saveActivitiesList must warn the user via showToast rather than fail silently -- this is the
  // actual behavioral fix for the bug: no more "looked saved, wasn't."
  win.eval(`
    window.__toasts=[];
    window.showToast=(m)=>{ window.__toasts.push(m); };
    // 200 activities each already at the per-activity cap (~1000 pts) -- compaction can't shrink
    // these further, and the total genuinely exceeds any real localStorage quota.
    ACTIVITIES=[];
    for(let i=0;i<200;i++){
      ACTIVITIES.push(normalizeActivityRecord({type:'run',role:'unplanned',date:'2027-01-01',
        distanceKm:8,durationSec:1000,title:'Run '+i,stream:${JSON.stringify(fakeStream(1000))}}));
    }
    saveActivitiesList();
  `);
  const toasts = win.eval(`__toasts`);
  console.log('Test 6 (a save that still fails after compaction surfaces a toast, not silence):',
    (toasts.length===1 && /storage/i.test(toasts[0])) ? 'PASS' : `FAIL (${JSON.stringify(toasts)})`);

  // Test 7: end-to-end -- restoring a backup whose activities carry full-resolution streams (the exact
  // shape of Dylon's real file) followed by a genuine reload must NOT lose the later week's activity
  // link, reproducing "week one stays, week two moves" and proving it's fixed.
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2027-06-01',endDate:'2027-08-01',sessions:[
      {id:'w1s',wk:1,d:'D1',wd:'Sun',ty:'easy',date:'2027-06-06',ph:'dur',ti:'Easy Run',det:'Easy Run',full:'W1: Easy Run'},
      {id:'w2s',wk:2,d:'D1',wd:'Sun',ty:'easy',date:'2027-06-13',ph:'dur',ti:'Easy Run',det:'Easy Run',full:'W2: Easy Run'}
    ],mileagePlan:{1:20,2:20}}];
    const backupPayload={
      status:{},notes:{},profile:{},extralogs:[],shoes:{},dateOverrides:{},injuries:[],wellness:[],
      racesList:[],activeBlockId:'b1',blocks:BLOCKS,seasons:[],
      activities:[
        {id:'a1',type:'run',role:'fulfillment',linkedSessionId:'w1s',date:'2027-06-06',distanceKm:8,durationSec:3000,stream:${JSON.stringify(fakeStream(3000))}},
        {id:'a2',type:'run',role:'fulfillment',linkedSessionId:'w2s',date:'2027-06-13',distanceKm:8,durationSec:3000,stream:${JSON.stringify(fakeStream(3000))}}
      ]
    };
    applySyncPayload(backupPayload);
  `);
  const keys = ['b5_status','b5_notes','b5_profile','b5_extralogs','b5_shoes','b5_dateoverrides',
    'b5_injuries','b5_wellness','b5_activities','b5_seasons','b5_blocks','b5_activeblock','b5_races'];
  const seed = {};
  keys.forEach(k => { const v = win.localStorage.getItem(k); if (v !== null) seed[k] = v; });

  const win2 = makeWindow(seed);
  await wait(400);
  const w1Linked = win2.eval(`activitiesForSession('w1s').length`);
  const w2Linked = win2.eval(`activitiesForSession('w2s').length`);
  console.log('Test 7 (both week 1 and week 2 activity links survive a real reload):',
    (w1Linked===1 && w2Linked===1) ? 'PASS' : `FAIL (w1s=${w1Linked}, w2s=${w2Linked})`);

  process.exit(0);
})();
