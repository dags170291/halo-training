// Regression test for a real reported bug: Dylon logged a completely normal run as "1:02:36"
// (1h 2m 36s) via Quick Add and saw "Total time logged" (the Progress stat-grid card) jump to
// something like 60 hours -- "when entering time specifically hours manually it gets converted to
// days ... i see my total training time up to 60 hours and that shouldnt be." Direct testing proved
// parseDurationSec("1:02:36") itself is correct (3756 sec, exactly 1h 2m 36s) in every code path that
// touches it (Quick Add, the planned-session Log sheet, sessionDurationSec, extraLogDurationSec) --
// the real bug was in totalLoggedTimeSec() itself: it summed EVERY EXTRALOGS entry ever created
// across the app's entire history with no date bound at all, while its own neighbors in the same
// stat-grid row ("Sessions logged", "Block mileage complete") only ever count the CURRENT block.
// Months of accumulated Quick Add test entries were silently baked into that one number the whole
// time, invisible until any new entry (including a perfectly normal one) pushed the total somewhere
// that finally looked obviously wrong. Fixed by scoping EXTRALOGS to the current block's own
// min/max session date, the same pattern weekPrehabActual() already uses for its own
// extras-in-range check, rather than summing every extra ever logged unconditionally.
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

  // Test 1: parseDurationSec/sessionDurationSec themselves are correct for the exact reported
  // string -- confirms the bug was never in the parser, only in totalLoggedTimeSec's own scope.
  win.eval(`
    DATA=[{id:'s1',wk:1,day:0,ty:'easy',ph:'base',date:'2026-07-20'}];
    STATUS={s1:'done'};
    NOTES={s1:{duration:'1:02:36'}};
    EXTRALOGS=[];
  `);
  const t1Parsed = win.eval(`parseDurationSec("1:02:36")`);
  const t1SessionSec = win.eval(`sessionDurationSec('s1')`);
  console.log('Test 1 ("1:02:36" parses to exactly 3756 sec / 1h 2m 36s, not something huge):',
    (t1Parsed === 3756 && t1SessionSec === 3756) ? 'PASS' : 'FAIL', { t1Parsed, t1SessionSec });

  // Test 2: an EXTRALOGS entry dated WELL OUTSIDE the current block's session date range (the "old
  // test entries from months ago" scenario) no longer gets folded into Total time logged.
  win.eval(`
    DATA=[
      {id:'s1',wk:1,day:0,ty:'easy',ph:'base',date:'2026-07-20'},
      {id:'s2',wk:1,day:2,ty:'long',ph:'base',date:'2026-07-22'}
    ];
    STATUS={s1:'done',s2:'done'};
    NOTES={s1:{duration:'1:02:36'}, s2:{duration:'45:00'}};
    EXTRALOGS=[
      {id:'x-old',kind:'run',date:'2026-01-01',duration:'60:00:00'},
      {id:'x-in-range',kind:'run',date:'2026-07-21',duration:'20:00'}
    ];
  `);
  const t2Total = win.eval(`totalLoggedTimeSec()`);
  // Expected: s1 (3756s) + s2 (2700s) + x-in-range (1200s) = 7656s. x-old (216000s) must be excluded.
  console.log('Test 2 (an EXTRALOGS entry dated months before the current block is excluded from the total):',
    t2Total === 7656 ? 'PASS' : 'FAIL', { t2Total });

  // Test 3: an EXTRALOGS entry dated INSIDE the current block's range, but on a day with no planned
  // session at all, still counts -- this isn't about "only days with a session," it's about the
  // block's overall date span (matching weekPrehabActual's own min/max-date approach).
  win.eval(`
    EXTRALOGS=[{id:'x-mid-nosession',kind:'run',date:'2026-07-21',duration:'30:00'}];
  `);
  const t3Total = win.eval(`totalLoggedTimeSec()`);
  // s1 (3756) + s2 (2700) + x-mid-nosession (1800) = 8256
  console.log('Test 3 (an in-range extra still counts even on a day with no planned session of its own):',
    t3Total === 8256 ? 'PASS' : 'FAIL', { t3Total });

  // Test 4: with zero planned sessions at all (no active block / brand-new device), extras
  // contribute nothing rather than throwing or falling back to an unscoped lifetime sum.
  win.eval(`
    DATA=[];
    STATUS={};
    NOTES={};
    EXTRALOGS=[{id:'x-any',kind:'run',date:'2026-07-21',duration:'30:00'}];
  `);
  let t4Threw=false, t4Total=null;
  try{ t4Total = win.eval(`totalLoggedTimeSec()`); } catch(e){ t4Threw=true; }
  console.log('Test 4 (no planned sessions at all -> total is 0, no throw, no unscoped lifetime fallback):',
    (!t4Threw && t4Total === 0) ? 'PASS' : 'FAIL', { t4Total });

  // Test 5: a NEW real "Total time logged" bug -- Dylon shared a real backup showing 60h46m, traced
  // via the backup's own data to one Quick Add walk logged with duration "3215" (no colon). The bare-
  // number branch of parseDurationSec always treated a colon-less number as MINUTES, so "3215" became
  // 3215 minutes (53.6 hours) -- almost certainly meant as "32:15" (32 min 15 sec) with the ":" key
  // dropped on a phone keyboard. A colon-less 3+ digit string that works out to over 12 hours now gets
  // reinterpreted as compact mm:ss (last two digits = seconds, the rest = minutes) instead.
  win.eval(`DATA=[]; STATUS={}; NOTES={}; EXTRALOGS=[];`);
  const t5 = win.eval(`parseDurationSec('3215')`);
  console.log('Test 5 (a colon-less "3215" reinterprets as 32 min 15 sec, not 3215 minutes):',
    t5 === 1935 ? 'PASS' : 'FAIL', { t5 });

  // Test 6: a normal, well-under-the-threshold bare number (a real 2-hour strength session logged as
  // "120") is completely unaffected -- the fix only kicks in for results no real single session could
  // plausibly be, not for ordinary long bare-minute entries.
  const t6 = win.eval(`parseDurationSec('120')`);
  console.log('Test 6 (an ordinary bare "120" (2 hours) still parses as plain minutes, no regression):',
    t6 === 7200 ? 'PASS' : 'FAIL', { t6 });

  // Test 7: the exact real-world shape of the bug -- an in-range EXTRALOGS walk with duration "3215"
  // now contributes only ~32 minutes to totalLoggedTimeSec(), not 53+ hours.
  win.eval(`
    DATA=[{id:'s1',wk:1,day:0,ty:'easy',ph:'base',date:'2026-07-20'}];
    STATUS={s1:'done'}; NOTES={s1:{duration:'10:00'}};
    EXTRALOGS=[{id:'x-walk',kind:'walk',date:'2026-07-20',dist:'2.33',duration:'3215'}];
  `);
  const t7Total = win.eval(`totalLoggedTimeSec()`);
  // s1 (600s) + walk (1935s) = 2535s, not 600+192900=193500s.
  console.log('Test 7 (totalLoggedTimeSec no longer inflated by a colon-less walk duration):',
    t7Total === 2535 ? 'PASS' : 'FAIL', { t7Total });

  // Tests 8-10 (v0.32.10): Dylon -- "the time and the km logged doesnt seem to change after uploading
  // walks." Traced to totalLoggedTimeSec() never looking at ACTIVITIES at all -- an uploaded/imported
  // walk (or any activity) that wasn't hand-typed into NOTES or Quick Add contributed nothing to Total
  // time logged, no matter how it got attached to the day.

  // Test 8: a standalone (unlinked, role 'unplanned') Activity dated inside the block's range now
  // contributes its own real durationSec.
  win.eval(`
    DATA=[
      {id:'s1',wk:1,day:0,ty:'easy',ph:'base',date:'2026-07-20'},
      {id:'s1b',wk:1,day:2,ty:'long',ph:'base',date:'2026-07-22'}
    ];
    STATUS={s1:'done'}; NOTES={s1:{duration:'10:00'}};
    EXTRALOGS=[];
    ACTIVITIES=[{id:'a-walk',type:'walk',role:'unplanned',linkedSessionId:null,date:'2026-07-21',durationSec:1800,distanceKm:2}];
  `);
  const t8Total = win.eval(`totalLoggedTimeSec()`);
  // s1 (600s) + standalone walk (1800s) = 2400s.
  console.log('Test 8 (a standalone uploaded walk with no session link now counts toward Total time logged):',
    t8Total === 2400 ? 'PASS' : 'FAIL', { t8Total });

  // Test 9: an Activity linked as a session's FULFILLMENT, where NOTES never got a hand-typed
  // duration, now counts via sessionDurationSec's own fallback -- and is NOT double-counted by also
  // being summed again in the standalone-activities pass.
  win.eval(`
    DATA=[{id:'s2',wk:1,day:0,ty:'easy',ph:'base',date:'2026-07-20'}];
    STATUS={s2:'done'}; NOTES={};
    EXTRALOGS=[];
    ACTIVITIES=[{id:'a-fulfill',type:'run',role:'fulfillment',linkedSessionId:'s2',date:'2026-07-20',durationSec:2400,distanceKm:5}];
  `);
  const t9SessionSec = win.eval(`sessionDurationSec('s2')`);
  const t9Total = win.eval(`totalLoggedTimeSec()`);
  console.log('Test 9 (a session fulfilled purely by an uploaded activity, with no hand-typed duration, counts that activitys own real time exactly once):',
    (t9SessionSec === 2400 && t9Total === 2400) ? 'PASS' : 'FAIL', { t9SessionSec, t9Total });

  // Test 10: an Activity attached as "extra" (not fulfillment) to a session still counts -- the
  // fulfillment exclusion in totalLoggedTimeSec only skips fulfillment-role activities (already
  // counted via their session above), not every linked activity.
  win.eval(`
    DATA=[{id:'s3',wk:1,day:0,ty:'easy',ph:'base',date:'2026-07-20'}];
    STATUS={s3:'done'}; NOTES={s3:{duration:'20:00'}};
    EXTRALOGS=[];
    ACTIVITIES=[{id:'a-extra',type:'run',role:'extra',linkedSessionId:'s3',date:'2026-07-20',durationSec:900,distanceKm:2}];
  `);
  const t10Total = win.eval(`totalLoggedTimeSec()`);
  // s3 (1200s) + extra-attached activity (900s) = 2100s.
  console.log('Test 10 (an activity attached as "extra" -- not fulfillment -- still adds its own time on top of the sessions own hand-typed duration):',
    t10Total === 2100 ? 'PASS' : 'FAIL', { t10Total });

  // Test 11: the OTHER stat in that same Progress row, "km logged / planned," stays deliberately
  // run-mileage-specific -- it's compared against the block's own MILEAGE_PLAN (a running target), the
  // same way Week Recap already splits "km run" from "km walked" rather than blending them. A walk
  // Activity (linked or standalone) must NOT move cumulativeActualKm(), even though Total time logged
  // now counts its time above -- confirmed directly with Dylon before making this change.
  win.eval(`
    BLOCKS=[{id:'bkm',name:'BKM',startDate:'2026-07-20',endDate:'2026-07-26',sessions:[
      {id:'skm',wk:1,day:0,ty:'easy',ph:'base',date:'2026-07-20'}
    ],mileagePlan:{1:10}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='bkm'; MILEAGE_PLAN=BLOCKS[0].mileagePlan;
    STATUS={skm:'done'}; NOTES={skm:{dist:'5'}};
    EXTRALOGS=[];
    ACTIVITIES=[{id:'a-kmwalk',type:'walk',role:'unplanned',linkedSessionId:null,date:'2026-07-20',durationSec:1800,distanceKm:3}];
  `);
  const t11Km = win.eval(`cumulativeActualKm()`);
  console.log('Test 11 (km logged / planned stays run-mileage-specific -- an uploaded walk does not inflate it):',
    t11Km === 5 ? 'PASS' : 'FAIL', { t11Km });

  await wait(200);
  win.close();
})();
