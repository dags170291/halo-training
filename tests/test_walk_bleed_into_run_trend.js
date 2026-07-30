// Regression test for a real reported bug, found by Dylon himself against his own hand-logged data.
// After the trendCalWeek() week-bucketing fix (v0.34.6) was verified byte-for-byte against his exact
// real numbers (28.2km/14.5km), he was STILL seeing an inflated Run Weekly Volume figure on the live
// app -- Week 1 showing 30.5km instead of the real 28.2km, with the day-by-day breakdown showing
// Wed 22 at 7.6km (actually 6.2km) and Sat 25 at 9.3km (actually 8.2km), while Mon/Thu/Sun matched
// closely. Asked directly rather than guessing again: "so i found the error, some walks were added as
// activity and not as extras is there some way we can ensure that this dont happen when we add walks
// (warm up or cool down) and even add mobility post run that they get added to their designated
// activity type even if it is attached to a planned session?"
//
// Root cause: loggedDist()/sessionDurationSec() summed EVERY fulfillment-role Activity linked to a
// session with zero regard for that Activity's own .type. A warm-up/cool-down walk marked "Fulfills
// this" on a run session (instead of "Attach as extra") had its distance/duration folded straight into
// the RUN session's own number -- inflating the Run trend -- while ALSO still counting correctly under
// its own Walk trend (weekMetricTotal's walk branch counts every walk Activity unconditionally, any
// role). A genuine double-count, not just a misattribution.
//
// Fix (v0.34.9): activityIsNativeToSession(a,s) -- a fulfilling Activity's distance/duration only folds
// into its linked session's own number when that Activity's type is actually native to the session it's
// fulfilling (run session -> 'run' Activity; Strength session -> 'strength' Activity; Mobility session ->
// 'mobility'/'yoga' Activity; the generic unclassified 'workout' fallback still always counts, to avoid
// resurrecting the earlier v0.34.2 bug). A walk linked as fulfillment to a run session no longer inflates
// the run's own distance -- it still marks the session done, and its own km still shows up once, under
// the Walk trend where it actually belongs.
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

  // A simplified version of Dylon's real week: two run sessions, each with its real run file linked as
  // fulfillment PLUS a warm-up/cool-down walk file ALSO linked as fulfillment (the actual mistake he
  // found -- "some walks were added as activity and not as extras").
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-20',endDate:'2026-09-27',mileagePlan:{1:20},sessions:[
      {id:'wed22',wk:1,d:'D2',ty:'easy',date:'2026-07-22',wd:'Wed',ti:'Easy Run',full:'',det:'',dist:'6K'},
      {id:'sat25',wk:1,d:'D4',ty:'long',date:'2026-07-25',wd:'Sat',ti:'Long Run',full:'',det:'',dist:'8K'}
    ]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-20'; BLOCK_END='2026-09-27';
    STATUS={wed22:'done',sat25:'done'}; NOTES={};
    ACTIVITIES=[
      {id:'a1',type:'run',date:'2026-07-22',distanceKm:6.2,durationSec:3752,linkedSessionId:'wed22',role:'fulfillment'},
      {id:'a2',type:'walk',date:'2026-07-22',distanceKm:1.4,durationSec:900,linkedSessionId:'wed22',role:'fulfillment'},
      {id:'a3',type:'run',date:'2026-07-25',distanceKm:8.2,durationSec:4391,linkedSessionId:'sat25',role:'fulfillment'},
      {id:'a4',type:'walk',date:'2026-07-25',distanceKm:1.1,durationSec:700,linkedSessionId:'sat25',role:'fulfillment'}
    ];
    EXTRALOGS=[];
  `);

  // ---- Test 1: loggedDist() for each run session returns ONLY the real run's distance -- the
  // mistakenly-linked walk no longer inflates it (6.2, not 6.2+1.4=7.6; 8.2, not 8.2+1.1=9.3, matching
  // exactly what Dylon reported seeing wrong). ----
  const t1wed = win.eval(`loggedDist('wed22')`);
  const t1sat = win.eval(`loggedDist('sat25')`);
  console.log('Test 1 (loggedDist excludes a walk linked as fulfillment to a run session):',
    (Math.abs(t1wed-6.2)<0.001 && Math.abs(t1sat-8.2)<0.001) ? 'PASS' : 'FAIL', { t1wed, t1sat });

  // ---- Test 2: sessionDurationSec() has the identical fix -- only the run's own duration counts. ----
  const t2wed = win.eval(`sessionDurationSec('wed22')`);
  const t2sat = win.eval(`sessionDurationSec('sat25')`);
  console.log('Test 2 (sessionDurationSec excludes a walk linked as fulfillment to a run session):',
    (t2wed===3752 && t2sat===4391) ? 'PASS' : 'FAIL', { t2wed, t2sat });

  // ---- Test 3: the actual reported bug -- Run Weekly Volume for the week totals 14.4km (6.2+8.2), not
  // the inflated 16.9km (7.6+9.3) it showed before this fix. ----
  const t3 = win.eval(`weekMetricTotal(1,'run').total`);
  console.log('Test 3 (Run Weekly Volume is no longer inflated by the mislinked walks):',
    Math.abs(t3-14.4)<0.001 ? 'PASS' : 'FAIL', { t3 });

  // ---- Test 4: the day-by-day Run breakdown shows the real, non-inflated distance per date too, not
  // just the weekly total. ----
  const dayRows = win.eval(`renderTrendDayRows(1,'run')`);
  const t4wed = /Jul 22[^<]*<\/span><span[^>]*>6\.2/.test(dayRows) || /6\.2/.test(dayRows);
  const t4NoInflated = !/7\.6/.test(dayRows) && !/9\.3/.test(dayRows);
  console.log('Test 4 (Run day-by-day breakdown reflects the real, non-inflated distances):',
    (t4wed && t4NoInflated) ? 'PASS' : 'FAIL', { dayRows });

  // ---- Test 5: the walks' own distance/duration didn't just vanish -- they still show up correctly
  // under the Walk trend for the same week (1.4 + 1.1 = 2.5km), exactly where Dylon wants them. ----
  const t5 = win.eval(`weekMetricTotal(1,'walk').total`);
  console.log('Test 5 (the mislinked walks\' own km still counts under the Walk trend):',
    Math.abs(t5-2.5)<0.001 ? 'PASS' : 'FAIL', { t5 });

  // ---- Test 6: no regression on the classic mismatched-type case -- a fulfilling Activity typed
  // 'workout' (inferActivityType()'s generic, unclassified fallback -- not confidently a different real
  // type) still counts toward its session's own run distance, same as before this round's fix. ----
  win.eval(`ACTIVITIES=[{id:'a5',type:'workout',date:'2026-07-22',distanceKm:6.2,durationSec:3752,linkedSessionId:'wed22',role:'fulfillment'}];`);
  const t6 = win.eval(`loggedDist('wed22')`);
  console.log('Test 6 (a generic/unclassified "workout"-typed fulfilling Activity still counts, no regression):',
    Math.abs(t6-6.2)<0.001 ? 'PASS' : 'FAIL', { t6 });

  await wait(200);
  win.close();
})();
