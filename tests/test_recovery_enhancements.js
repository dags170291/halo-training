// Regression test for the Recovery tab enhancements Dylon asked for after calling the tab
// "underdeveloped and bare bones": (1) a Recovery Overview card combining Training Load, active
// injury count, prehab consistency, and this-week wellness in one glance, shown above all 4
// sub-tabs; (2) richer injury tracking (status lifecycle + expected return date, active-first
// sorting); (3) Prehab Consistency (mirrors the Progress tab's mileage Consistency Score); (4) a new
// Wellness sub-tab with a weekly energy/sleep/soreness check-in log.
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
function buildBlock(win, startISO, weeks, mobilityPerWeek) {
  return win.eval(`
    (function(){
      const start = new Date('${startISO}T12:00:00');
      const sessions = [];
      const mileagePlan = {};
      for (let w=1; w<=${weeks}; w++){
        const d = new Date(start); d.setDate(d.getDate() + (w-1)*7);
        const iso = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        sessions.push({id:'w'+w+'run', wk:w, ty:'easy', date: iso, ph:'dur'});
        for (let m=0; m<${mobilityPerWeek}; m++){
          const md = new Date(d); md.setDate(md.getDate()+1);
          const miso = md.getFullYear()+'-'+String(md.getMonth()+1).padStart(2,'0')+'-'+String(md.getDate()).padStart(2,'0');
          sessions.push({id:'w'+w+'mob'+m, wk:w, ty:'mobility', date: miso, ph:'dur', ti:'Stretch & Mobility'});
        }
        mileagePlan[w] = 20;
      }
      BLOCKS = [{id:'b1', name:'Test Block', startDate: sessions[0].date, endDate: sessions[sessions.length-1].date, sessions, mileagePlan}];
      DATA = BLOCKS[0].sessions;
      MILEAGE_PLAN = mileagePlan;
      ACTIVE_BLOCK_ID = 'b1';
      STATUS = {};
      NOTES = {};
      EXTRALOGS = [];
      RACES_LIST = [];
      INJURIES = [];
      WELLNESS_LOG = [];
      return sessions;
    })()
  `);
}

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
  win.eval(`window.renderAll = function(){};`);

  buildBlock(win, '2026-06-02', 8, 1);
  win.eval(`__origTodayISO = todayISO; todayISO = function(){ return '2026-07-21'; };`); // mid-week-8

  // ==== Recovery Overview ====

  // ---- Test 1: with no data logged at all, the overview card still renders sane placeholders
  // ("—" for each metric), not broken/blank cells ----
  const emptyOverview = win.eval(`recoveryOverviewCardHTML()`);
  console.log('Test 1 (Recovery Overview renders placeholders when nothing is logged yet):',
    (emptyOverview.includes('Recovery Overview') && emptyOverview.includes('Training Load') && emptyOverview.includes('Active Injur')) ? 'PASS' : 'FAIL');

  // ---- Test 2: the overview card renders above the sub-tab pills in the real Recovery tab ----
  win.eval(`RECOVERY_SUB='durability'; renderRecovery();`);
  const recoveryHTML = win.eval(`document.getElementById('view-recovery').innerHTML`);
  const overviewIdx = recoveryHTML.indexOf('Recovery Overview');
  const pillsIdx = recoveryHTML.indexOf('trend-pills');
  console.log('Test 2 (overview card renders above the sub-tab pills in the real tab):',
    (overviewIdx>-1 && pillsIdx>-1 && overviewIdx<pillsIdx) ? 'PASS' : 'FAIL', { overviewIdx, pillsIdx });

  // ---- Test 3: an active injury + a high training load together trigger the cross-reference
  // warning inside the overview card ----
  win.eval(`EXTRALOGS = ${JSON.stringify((function(){
    // sharp acute spike: build via bash-side JSON is awkward, so just construct in-page below instead
    return [];
  })())};`);
  win.eval(`
    (function(){
      const end = new Date('2026-07-21T12:00:00');
      const out = [];
      for (let i=0;i<7;i++){ const d=new Date(end); d.setDate(d.getDate()-i); const iso=d.toISOString().slice(0,10); out.push({id:'hi'+i,kind:'run',dist:15,date:iso}); }
      for (let i=7;i<28;i++){ const d=new Date(end); d.setDate(d.getDate()-i); const iso=d.toISOString().slice(0,10); out.push({id:'lo'+i,kind:'run',dist:2,date:iso}); }
      EXTRALOGS = out;
    })();
    INJURIES = [{id:'ij1', date:'2026-07-15', bodyPart:'Left calf', severity:'Moderate', status:'Active'}];
  `);
  const crossFlagHTML = win.eval(`recoveryOverviewCardHTML()`);
  const loadBand = win.eval(`acuteChronicWorkload().band`);
  console.log('Test 3 (active injury + high training load together trigger the cross-reference warning):',
    { loadBand, hasCrossFlag: crossFlagHTML.includes('Training load is high while you have an active injury') },
    (loadBand==='high' && crossFlagHTML.includes('Training load is high while you have an active injury')) ? 'PASS' : 'FAIL');

  // reset to something calmer for the rest of the tests
  win.eval(`EXTRALOGS=[]; INJURIES=[];`);

  // ==== Richer Injury Tracking ====

  // ---- Test 4: a new injury report defaults to Active status; saving one with a status + expected
  // return date persists both fields ----
  win.eval(`
    openInjuryForm();
    document.getElementById('ij-bodypart').value='Right ankle';
    document.getElementById('ij-severity').value='Mild';
    document.getElementById('ij-status').value='Recovering';
    document.getElementById('ij-return').value='2026-08-01';
    saveInjury();
  `);
  const savedInjury = win.eval(`INJURIES.find(x=>x.bodyPart==='Right ankle')`);
  console.log('Test 4 (injury report saves status + expected return date):',
    (savedInjury && savedInjury.status==='Recovering' && savedInjury.expectedReturnDate==='2026-08-01') ? 'PASS' : 'FAIL', { savedInjury });

  // ---- Test 5: Active/Recovering injuries sort ahead of Resolved ones regardless of date, each
  // group still newest-first within itself ----
  win.eval(`
    INJURIES = [
      {id:'old-resolved', date:'2026-01-01', bodyPart:'Old Issue', status:'Resolved'},
      {id:'new-active', date:'2026-07-01', bodyPart:'New Issue', status:'Active'},
      {id:'mid-recovering', date:'2026-05-01', bodyPart:'Mid Issue', status:'Recovering'}
    ];
  `);
  const injuriesHTML = win.eval(`recoveryInjuriesHTML()`);
  const activeIdx = injuriesHTML.indexOf('New Issue');
  const recoveringIdx = injuriesHTML.indexOf('Mid Issue');
  const resolvedIdx = injuriesHTML.indexOf('Old Issue');
  console.log('Test 5 (Active/Recovering injuries sort ahead of Resolved ones):', {
    activeIdx, recoveringIdx, resolvedIdx,
    result: (activeIdx>-1 && recoveringIdx>activeIdx && resolvedIdx>recoveringIdx) ? 'PASS' : 'FAIL'
  });

  // ---- Test 6: a legacy injury with no status field at all is treated as Active (safe default) ----
  win.eval(`INJURIES = [{id:'legacy1', date:'2026-01-01', bodyPart:'Legacy Injury'}];`);
  const legacyHTML = win.eval(`recoveryInjuriesHTML()`);
  console.log('Test 6 (a legacy injury with no status field defaults to Active):',
    (legacyHTML.includes('Legacy Injury') && legacyHTML.includes('>Active<')) ? 'PASS' : 'FAIL');

  win.eval(`INJURIES=[];`);

  // ==== Prehab Consistency ====

  // ---- Test 7: with no mobility sessions logged at all, prehabConsistency() is 0% across every
  // fully-elapsed week that had a real target (the block above schedules 1 mobility session/week) ----
  const emptyPrehab = win.eval(`prehabConsistency()`);
  console.log('Test 7 (no mobility logged -> 0% prehab consistency, not blank, since weeks had a target):',
    (emptyPrehab && emptyPrehab.pct===0 && emptyPrehab.counted===7) ? 'PASS' : 'FAIL', { emptyPrehab });

  // ---- Test 8: marking the mobility session done for 5 of the 7 fully-elapsed weeks gives 5/7 ----
  win.eval(`
    for (let w=1; w<=5; w++){ STATUS['w'+w+'mob0']='done'; }
  `);
  const prehab = win.eval(`prehabConsistency()`);
  const prehabCardHTML = win.eval(`prehabConsistencyCardHTML()`);
  console.log('Test 8 (5 of 7 weeks with mobility done -> 71% prehab consistency, shown in the card):',
    (prehab && prehab.hit===5 && prehab.counted===7 && prehab.pct===71 && prehabCardHTML.includes('71%')) ? 'PASS' : 'FAIL', { prehab });

  // ---- Test 9: an extra-logged Yoga/Mobility session (not tied to the plan) also counts toward a
  // week's actual total, on top of plan-done sessions. Week 1 only has 2 scheduled sessions (the run
  // on 2026-06-02 and the mobility session on 2026-06-03, per buildBlock's one-mobility-day-per-week
  // setup), so its date range is just those two days -- the extra log has to fall inside that same
  // range to count, same as any other week. ----
  win.eval(`STATUS={}; EXTRALOGS=[{id:'yoga1',kind:'yoga',date:'2026-06-03'}];`); // same date as week 1's own mobility session
  const prehabWithExtra = win.eval(`weekPrehabActual(1)`);
  console.log('Test 9 (an extra-logged yoga/mobility session counts toward that week\\u2019s actual total):',
    prehabWithExtra===1 ? 'PASS' : 'FAIL', { prehabWithExtra });

  win.eval(`EXTRALOGS=[]; STATUS={};`);

  // ==== Weekly Wellness Check-In ====

  // ---- Test 10: with nothing logged, the Wellness sub-tab shows a sane empty state, and
  // latestWellnessThisWeek() returns null (not a broken average) ----
  const emptyWellnessHTML = win.eval(`recoveryWellnessHTML()`);
  const emptyThisWeek = win.eval(`latestWellnessThisWeek()`);
  console.log('Test 10 (no check-ins yet -> sane empty state, latestWellnessThisWeek is null):',
    (emptyWellnessHTML.includes('No check-ins yet') && emptyThisWeek===null) ? 'PASS' : 'FAIL');

  // ---- Test 11: saving a check-in via the form persists energy/sleepHours/soreness, and
  // latestWellnessThisWeek() computes the right combined score (energy + inverse soreness only --
  // sleep is tracked in hours now and no longer factors into the score, see v0.32.28) ----
  win.eval(`
    openWellnessForm();
    document.getElementById('wl-date').value='2026-07-21';
    document.getElementById('wl-energy').value='4';
    document.getElementById('wl-sleep-hours').value='5';
    document.getElementById('wl-soreness').value='2';
    saveWellness();
  `);
  const savedWellness = win.eval(`WELLNESS_LOG[0]`);
  const thisWeekScore = win.eval(`latestWellnessThisWeek()`);
  // expected combined score: (4 + (6-2)) / 2 = 8/2 = 4.0 -- sleepHours (5) is deliberately excluded
  const expectedScore = (4+4)/2;
  console.log('Test 11 (saving a check-in persists ratings; this-week score is energy + inverse soreness only):', {
    savedWellness, thisWeekScore, expectedScore,
    result: (savedWellness && savedWellness.energy===4 && savedWellness.sleepHours===5 && savedWellness.soreness===2 &&
             thisWeekScore && Math.abs(thisWeekScore.avg-expectedScore)<0.01) ? 'PASS' : 'FAIL'
  });

  // ---- Test 12: the Wellness sub-tab is a real entry in RECOVERY_SUBS and routes correctly through
  // renderRecovery() ----
  win.eval(`RECOVERY_SUB='wellness'; renderRecovery();`);
  const wellnessTabHTML = win.eval(`document.getElementById('view-recovery').innerHTML`);
  console.log('Test 12 (Wellness sub-tab renders through the real Recovery tab):',
    (wellnessTabHTML.includes('Wellness Log') && wellnessTabHTML.includes('4.0')) ? 'PASS' : 'FAIL');

  // ---- Test 13: WELLNESS_LOG round-trips through buildSyncPayload/applySyncPayload, same as
  // INJURIES already does -- confirms it's real persisted/backed-up state, not a throwaway list ----
  const payload = win.eval(`JSON.stringify(buildSyncPayload())`);
  win.eval(`WELLNESS_LOG=[]; applySyncPayload(${payload});`);
  const restoredWellness = win.eval(`WELLNESS_LOG.length`);
  console.log('Test 13 (WELLNESS_LOG round-trips through the backup/cloud-sync payload):',
    restoredWellness===1 ? 'PASS' : 'FAIL', { restoredWellness });

  win.eval(`todayISO = __origTodayISO;`);
  await wait(200);
  win.close();
})();
