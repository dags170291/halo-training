// Regression test for the Prehab tab missing imported mobility Activities entirely. Dylon: "the prehab
// tab is missing the post-run mobility sessions that I do, so that should be included in the prehab tab
// as well." recoveryPrehabHTML() only ever merged two sources -- EXTRALOGS quick-adds and plan-sourced
// sessions -- with zero reference to ACTIVITIES anywhere in the function. A post-run mobility/stretch
// session imported as its own file and linked to that day's run (role:'fulfillment' or 'accessory',
// exactly how a real post-run stretch typically gets attached) never had a path into this tab, for any
// role, standalone or linked.
//
// Fixed with prehabActivities() (every ACTIVITIES entry typed 'mobility' or 'yoga', any role) and
// prehabActivityItemHTML(a) (a new log-feed row, tagged "Post-run" when linked to a real run session,
// "Imported" otherwise), merged into recoveryPrehabHTML() alongside the two existing sources.
// weekPrehabActual() (the Prehab Consistency % denominator) was updated the same way, with a guard
// against double-counting a fulfillment-role Activity linked to a session that's ALREADY counted via
// planDone (a real mobility-typed PLANNED session being fulfilled by an imported file).
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
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-20',endDate:'2026-09-27',mileagePlan:{1:20},sessions:[
      {id:'w1run',wk:1,ty:'easy',date:'2026-07-21',wd:'Tue',ti:'Easy Run',full:'',det:'',dist:'5K'}
    ]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-20'; BLOCK_END='2026-09-27';
    STATUS={w1run:'done'}; NOTES={}; EXTRALOGS=[]; RACES_LIST=[]; INJURIES=[]; WELLNESS_LOG=[];
    ACTIVITIES=[{id:'stretch1',type:'mobility',date:'2026-07-21',durationSec:900,title:'Post-Run Stretch',linkedSessionId:'w1run',role:'fulfillment'}];
  `);

  // ---- Test 1: the exact reported scenario -- a post-run mobility Activity, imported and linked as
  // "Fulfills this" to a run session, now actually shows up in the Prehab log. ----
  const prehabHTML = win.eval(`recoveryPrehabHTML()`);
  const t1HasIt = /Post-Run Stretch/.test(prehabHTML);
  console.log('Test 1 (a post-run mobility Activity linked to a run session now shows up in the Prehab log):',
    t1HasIt ? 'PASS' : 'FAIL');

  // ---- Test 2: it's tagged "Post-run" (not "Plan" or a generic "Imported") since it's linked to a
  // real run session -- distinguishing it from a standalone import. ----
  const t2 = /Post-run/.test(prehabHTML);
  console.log('Test 2 (it\'s tagged "Post-run" since it\'s linked to a real run session):', t2 ? 'PASS' : 'FAIL');

  // ---- Test 3: it opens the Activity's own detail page on tap, not the linked run session. ----
  const t3 = /onclick="openActivityDetail\('stretch1'\)"/.test(prehabHTML);
  console.log('Test 3 (tapping it opens the Activity\'s own detail page):', t3 ? 'PASS' : 'FAIL');

  // ---- Test 4: a standalone (unplanned) imported mobility Activity, with nothing to attribute it to,
  // is tagged "Imported" instead. ----
  win.eval(`ACTIVITIES=[{id:'standalone1',type:'yoga',date:'2026-07-22',durationSec:1200,title:'Morning Yoga',role:'unplanned'}];`);
  const standaloneHTML = win.eval(`recoveryPrehabHTML()`);
  const t4 = /Morning Yoga/.test(standaloneHTML) && /Imported/.test(standaloneHTML) && !/Post-run/.test(standaloneHTML);
  console.log('Test 4 (a standalone imported mobility/yoga Activity is tagged "Imported", not "Post-run"):',
    t4 ? 'PASS' : 'FAIL');

  // ---- Test 5: no regression -- the plan-sourced and Quick-Add-sourced entries still show up
  // alongside the new Activity-sourced ones, all merged into one list. ----
  win.eval(`
    BLOCKS[0].sessions.push({id:'w1mob',wk:1,ty:'mobility',date:'2026-07-23',ti:'Stretch & Mobility'});
    DATA=BLOCKS[0].sessions;
    STATUS={w1run:'done',w1mob:'done'};
    EXTRALOGS=[{id:'y1',kind:'yoga',date:'2026-07-22',duration:'20 min',videoTitle:'Runner Yoga Flow'}];
    ACTIVITIES=[{id:'stretch1',type:'mobility',date:'2026-07-21',durationSec:900,title:'Post-Run Stretch',linkedSessionId:'w1run',role:'fulfillment'}];
  `);
  const mergedHTML = win.eval(`recoveryPrehabHTML()`);
  // "Stretch & Mobility" renders HTML-escaped ("Stretch &amp; Mobility") via escAttr(), same as any
  // other title text in this file -- matching that escaped form here, not the raw "&".
  const t5AllThree = /Post-Run Stretch/.test(mergedHTML) && /Stretch &amp; Mobility/.test(mergedHTML) && /Runner Yoga Flow/.test(mergedHTML);
  console.log('Test 5 (plan-sourced, Quick-Add-sourced, and Activity-sourced entries all merge together):',
    t5AllThree ? 'PASS' : 'FAIL');

  // ---- Test 6: weekPrehabActual() counts the post-run Activity toward the week's Prehab Consistency
  // actual (1 plan-mobility session done + 1 quick-add + 1 post-run Activity = 3), without double-
  // counting anything. ----
  const t6 = win.eval(`weekPrehabActual(1)`);
  console.log('Test 6 (weekPrehabActual counts the post-run Activity toward the consistency score):',
    t6===3 ? 'PASS' : `FAIL (got ${t6}, expected 3)`);

  // ---- Test 7: no double-count -- an Activity that fulfills a session ALREADY counted via planDone
  // (a real mobility-typed planned session fulfilled by an imported file) doesn't add a second point. ----
  win.eval(`
    BLOCKS[0].sessions=[{id:'w1mob',wk:1,ty:'mobility',date:'2026-07-23',ti:'Stretch & Mobility'}];
    DATA=BLOCKS[0].sessions; STATUS={w1mob:'done'}; EXTRALOGS=[];
    ACTIVITIES=[{id:'mobfile1',type:'mobility',date:'2026-07-23',durationSec:900,title:'Mobility File',linkedSessionId:'w1mob',role:'fulfillment'}];
  `);
  const t7 = win.eval(`weekPrehabActual(1)`);
  console.log('Test 7 (an Activity fulfilling an already-counted plan-mobility session does not double-count):',
    t7===1 ? 'PASS' : `FAIL (got ${t7}, expected 1)`);

  await wait(200);
  win.close();
})();
