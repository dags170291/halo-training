// Regression test for the real, confirmed root cause of "when i imported mobility sessions i.e. post
// run stretch this data didnt get loaded in the activity trends." Two earlier rounds chased adjacent but
// different bugs in this same area (v0.34.1's nearest-session week misattribution, v0.34.2's
// fulfillment-type-mismatch fix for a SESSION's own contribution) without fixing this specific
// complaint, and a follow-up round (v0.34.3) spent effort on an unrelated week-bucketing bug instead.
// Rather than guess again, this round asked Dylon directly what Type his post-run mobility activity
// showed as in the Activities tab -- "It already says Mobility" -- which ruled out inferActivityType()
// misclassification and pointed at the counting logic itself.
//
// Root cause, reproduced directly: a correctly Type-confirmed 'mobility' Activity attached with
// role:'fulfillment' to a RUN session (e.g. a post-run stretch imported as its own file and marked
// "Fulfills this" on that day's run, rather than "Attach as extra") was completely invisible to the
// Mobility trend -- weekMetricTotal(wk,'mob') and weekDurationTotal(wk,'mob') both returned
// {total:0,any:false} for it. The exact same Activity attached as role:'accessory' instead counted
// correctly. Every one of weekMetricTotal/weekDurationTotal/renderTrendDayRows/
// renderTrendDurationDayRows skipped EVERY fulfillment-role Activity from their Activities loop
// outright, on the assumption its number is always already folded into its linked session's own
// contribution -- true when a Strength Activity fulfills a Strength session, but not when a Mobility
// Activity fulfills a RUN session: the run session's own sessionMetric('mob')/sessionDurationSec('mob')
// is null (it's not a mobility session), so nothing ever counted that Activity's real Mobility number.
// Fixed with a new activityFulfillmentAlreadyCounted(a,type) helper: a fulfillment-role Activity is only
// skipped from the Activities loop when its OWN linked session actually matches the trend type being
// computed -- otherwise it's counted directly, same as an accessory Activity would be.
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

  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-19',endDate:'2026-08-30',mileagePlan:{1:20,2:20},sessions:[
      {id:'w1run',wk:1,d:'D2',ty:'easy',date:'2026-07-21',wd:'Tue',ti:'Easy Run',full:'Easy Run',det:'',dist:'5K'},
      {id:'w1str1',wk:1,d:'D3',ty:'str',date:'2026-07-22',wd:'Wed',ti:'Strength',full:'Strength',det:''},
      {id:'w1str2',wk:1,d:'D4',ty:'str',date:'2026-07-23',wd:'Thu',ti:'Strength',full:'Strength',det:''}
    ]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-19'; BLOCK_END='2026-08-30';
    STATUS={w1run:'done',w1str1:'done',w1str2:'done'}; NOTES={w1run:{dist:'5'}};
    ACTIVITIES=[
      {id:'mob1',type:'mobility',date:'2026-07-21',durationSec:900,linkedSessionId:'w1run',role:'fulfillment'},
      {id:'str1act',type:'workout',date:'2026-07-22',linkedSessionId:'w1str1',role:'fulfillment'},
      {id:'str2act',type:'strength',date:'2026-07-23',linkedSessionId:'w1str2',role:'fulfillment'}
    ];
    EXTRALOGS=[];
  `);

  // ---- Test 1: a correctly-typed Mobility Activity that FULFILLS a run session now counts toward the
  // Mobility weekly volume (a plain count of 1), where it used to silently return 0. ----
  const t1 = win.eval(`weekMetricTotal(1,'mob')`);
  console.log('Test 1 (a Mobility Activity fulfilling a RUN session now counts toward Mobility Weekly Volume):',
    (t1.total===1 && t1.any===true) ? 'PASS' : 'FAIL', { t1 });

  // ---- Test 2: same fix applies to the Time view -- its 15-minute duration now shows in Mobility's
  // weekly hours total. ----
  const t2 = win.eval(`weekDurationTotal(1,'mob')`);
  console.log('Test 2 (the same Activity\'s 900s duration now counts toward Mobility Time):',
    (t2.total===900 && t2.any===true) ? 'PASS' : 'FAIL', { t2 });

  // ---- Test 3: the day-by-day breakdown for both views shows the activity's real date. ----
  const volBreakdown = win.eval(`renderTrendDayRows(1,'mob')`);
  const durBreakdown = win.eval(`renderTrendDurationDayRows(1,'mob')`);
  console.log('Test 3 (both Mobility breakdowns show the activity\'s real Jul 21 date):',
    (/Jul 21/.test(volBreakdown) && /Jul 21/.test(durBreakdown)) ? 'PASS' : 'FAIL', { volBreakdown, durBreakdown });

  // ---- Test 4: no regression on the v0.34.2 case this fix sits right next to -- 2 strength sessions
  // marked done, one fulfilled by a 'workout'-typed Activity (ambiguous, not explicitly 'strength'),
  // still reads 2, not 1 (the original bug) and not 3 (double-counting the correctly-typed one too). ----
  const t4 = win.eval(`weekMetricTotal(1,'str')`);
  console.log('Test 4 (no regression: 2 strength sessions still both count, still no double-counting):',
    t4.total===2 ? 'PASS' : 'FAIL', { t4 });

  // ---- Test 5: the SAME Mobility Activity attached as 'accessory' instead of 'fulfillment' already
  // worked before this fix and still works identically now -- confirms this fix only changes the
  // fulfillment-role path, not the accessory one. ----
  win.eval(`ACTIVITIES[0].role='accessory'; ACTIVITIES[0].linkedSessionId='w1run';`);
  const t5 = win.eval(`weekMetricTotal(1,'mob')`);
  console.log('Test 5 (the same activity as an accessory attachment still counts identically):',
    t5.total===1 ? 'PASS' : 'FAIL', { t5 });

  // ---- Test 6: activityFulfillmentAlreadyCounted() itself -- true only when the linked session's own
  // type actually matches the trend type in question. ----
  win.eval(`ACTIVITIES[0].role='fulfillment';`); // restore
  const t6MobOnRun = win.eval(`activityFulfillmentAlreadyCounted(ACTIVITIES[0],'mob')`); // mobility activity, linked to a run session -- false
  const t6StrOnStr = win.eval(`activityFulfillmentAlreadyCounted(ACTIVITIES[2],'str')`); // strength activity, linked to a strength session -- true
  console.log('Test 6 (activityFulfillmentAlreadyCounted checks the LINKED SESSION\'s own type, not just role):',
    (t6MobOnRun===false && t6StrOnStr===true) ? 'PASS' : 'FAIL', { t6MobOnRun, t6StrOnStr });

  await wait(200);
  win.close();
})();
