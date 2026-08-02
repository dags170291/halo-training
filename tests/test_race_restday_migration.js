// Regression test for fixRaceRestDaySwapIfNeeded(), a one-time startup migration. Dylon's screenshot:
// the ordinary week-transition Sunday BEFORE Race Week even starts (a full week early) showed "Full
// Rest", while the actual day after the Mayaro race -- the one that's supposed to be full rest -- was
// still a plain Recovery Run. Root cause: an earlier round's "Sun after the race gets Full Rest" fix
// only ever edited the hardcoded seed template, but loadSeasonsBlocks() loads BLOCKS purely from
// localStorage/Supabase and never re-seeds an already-created block from that template -- so a block
// created before the source fix landed just keeps whatever it was originally (mis-)seeded with,
// forever, no matter how many later rounds correct the template itself. This migration self-heals any
// block still carrying that old mis-seeded pair, anchored to each block's own race date (not a
// hardcoded session id) so it isn't specific to Block 5's exact ids.
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

  // ---- Test 1: a block carrying the exact mis-seeded pair (wrong Sunday = Full Rest, real
  // day-after-race Sunday = still a plain Recovery Run) gets corrected -- ty/ti/det/dist swapped so the
  // real day after the race becomes Full Rest and the ordinary week-transition Sunday reverts to a
  // normal Recovery Run, and the block's mileagePlan is recalculated to match (Full Rest no longer
  // counts km, the reverted Recovery Run now does). ----
  win.eval(`
    localStorage.removeItem('b5_race_restday_fixed');
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-20',endDate:'2026-09-01',mileagePlan:{},sessions:[
      {id:'race1',wk:4,d:'D6',ty:'race',date:'2026-08-15',wd:'Sat',ti:'Mayaro Coconut Run 5K',full:'2026 Block 5 Durability W4D6: Mayaro Coconut Run 5K',det:'Race day.',dist:'5 km'},
      {id:'wrong1',wk:4,d:'D0',ty:'rest',date:'2026-08-09',wd:'Sun',ti:'Full Rest',full:'2026 Block 5 Durability W4D0: Full Rest',det:'No run, no strength.'},
      {id:'correct1',wk:5,d:'D0',ty:'easy',date:'2026-08-16',wd:'Sun',ti:'Recovery Run',full:'2026 Block 5 Ignition W5D0: Recovery Run',det:'~5 km / 30 min, extremely easy pace.',dist:'~5 km'},
      {id:'other1',wk:5,d:'D1',ty:'easy',date:'2026-08-17',wd:'Mon',ti:'Easy Run',full:'2026 Block 5 Ignition W5D1: Easy Run',det:'5 km.',dist:'5 km'}
    ]}];
    fixRaceRestDaySwapIfNeeded();
  `);
  const afterFix = JSON.parse(win.eval(`JSON.stringify(BLOCKS[0].sessions)`));
  const wrong1 = afterFix.find(s => s.id === 'wrong1');
  const correct1 = afterFix.find(s => s.id === 'correct1');
  const mileagePlan1 = JSON.parse(win.eval(`JSON.stringify(BLOCKS[0].mileagePlan)`));
  const t1 = wrong1.ty === 'easy' && wrong1.ti === 'Recovery Run' && wrong1.dist === '~5 km' && wrong1.full.endsWith(': Recovery Run')
    && correct1.ty === 'rest' && correct1.ti === 'Full Rest' && correct1.dist === undefined && correct1.full.endsWith(': Full Rest')
    && mileagePlan1['4'] === 10 // race1's 5km PLUS wrong1's now-restored 5km Recovery Run (both wk:4)
    && mileagePlan1['5'] === 5; // other1's 5km only -- correct1 (now Full Rest) no longer contributes any km
  console.log('Test 1 (a block carrying the mis-seeded Full-Rest/Recovery-Run pair gets corrected, mileagePlan recalculated):',
    t1 ? 'PASS' : 'FAIL', { wrong1, correct1, mileagePlan1 });

  // ---- Test 2: running the migration again is a no-op (idempotent, gated by its own one-time flag) --
  // doesn't re-touch already-corrected sessions or throw. ----
  win.eval(`fixRaceRestDaySwapIfNeeded();`);
  const afterSecondRun = JSON.parse(win.eval(`JSON.stringify(BLOCKS[0].sessions)`));
  const stillCorrect = afterSecondRun.find(s => s.id === 'wrong1').ty === 'easy' && afterSecondRun.find(s => s.id === 'correct1').ty === 'rest';
  console.log('Test 2 (running the migration again is a no-op, gated by its own flag):', stillCorrect ? 'PASS' : 'FAIL');

  // ---- Test 3: a block that was NEVER mis-seeded (created after the source template was already
  // correct -- real day-after-race is already Full Rest, the week-transition Sunday is already a plain
  // Recovery Run) is left completely untouched, not force-swapped into the wrong state. ----
  win.eval(`
    localStorage.removeItem('b5_race_restday_fixed');
    BLOCKS=[{id:'b2',name:'Already Correct Block',startDate:'2026-07-20',endDate:'2026-09-01',mileagePlan:{},sessions:[
      {id:'race2',wk:4,d:'D6',ty:'race',date:'2026-08-15',wd:'Sat',ti:'Some Race',full:'...: Some Race',det:'Race day.',dist:'5 km'},
      {id:'sunbefore2',wk:4,d:'D0',ty:'easy',date:'2026-08-09',wd:'Sun',ti:'Recovery Run',full:'...: Recovery Run',det:'~5 km.',dist:'~5 km'},
      {id:'sunafter2',wk:5,d:'D0',ty:'rest',date:'2026-08-16',wd:'Sun',ti:'Full Rest',full:'...: Full Rest',det:'No run, no strength.'}
    ]}];
    fixRaceRestDaySwapIfNeeded();
  `);
  const untouched = JSON.parse(win.eval(`JSON.stringify(BLOCKS[0].sessions)`));
  const t3 = untouched.find(s => s.id === 'sunbefore2').ty === 'easy' && untouched.find(s => s.id === 'sunafter2').ty === 'rest';
  console.log('Test 3 (a block that was never mis-seeded is left untouched):', t3 ? 'PASS' : 'FAIL', { untouched });

  await wait(200);
  win.close();
})();
