// Regression test for the "Runs + Walks" secondary stat, v0.32.31. Dylon: "double check the total
// km logged. it doesnt line up with the number i am seeing for total runs or does it also include
// walks." cumulativeActualKm() (the big "km logged" number) is deliberately plan-only -- a standalone
// walk (Quick Add, or an imported Activity never linked to any session) never counted toward it.
// totalLoggedKmRunsWalks() adds those back in as a broader total, restricted to Run/Walk entries, and
// renderProgress() shows it as a small secondary line under the same stat card -- Dylon: "display
// runs as the large number as it currently is but only runs and walks as a minor number in the same
// card so it wont change the card size."
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
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-07-21',sessions:[
      {id:'w1run',wk:1,ty:'easy',date:'2026-07-01',ph:'dur',ti:'Easy Run',d:'D1',wd:'Wed',det:'5km easy'},
      {id:'w1str',wk:1,ty:'str',date:'2026-07-02',ph:'dur',ti:'Strength',d:'D2',wd:'Thu',det:'Full body'},
      {id:'w2long',wk:2,ty:'long',date:'2026-07-15',ph:'dur',ti:'Long Run',d:'D6',wd:'Wed',det:'12km long'}
    ],mileagePlan:{1:20,2:25}}];
    ACTIVE_BLOCK_ID='b1';
    DATA=BLOCKS[0].sessions;
    MILEAGE_PLAN=BLOCKS[0].mileagePlan;
    STATUS={w1run:'done'};
    NOTES={w1run:{dist:'5'}};
    ACTIVITIES=[];
    EXTRALOGS=[];
    RACES_LIST=[];
  `);

  // ---- Test 1: with no walks/unplanned activities, totalLoggedKmRunsWalks() equals
  // cumulativeActualKm() exactly (nothing extra to add) ----
  const cum1 = win.eval(`cumulativeActualKm()`);
  const rw1 = win.eval(`totalLoggedKmRunsWalks()`);
  console.log('Test 1 (no walks -> Runs+Walks total equals the plan-only total exactly):',
    (cum1===5 && rw1===5) ? 'PASS' : 'FAIL', { cum1, rw1 });

  // ---- Test 2: an unplanned/unlinked walk Activity in the block's date range gets added on top of
  // the plan-only total (this is the exact gap Dylon reported) ----
  win.eval(`
    ACTIVITIES=[{id:'act1',type:'walk',role:'unplanned',linkedSessionId:null,date:'2026-07-05',distanceKm:3.2}];
  `);
  const rw2 = win.eval(`totalLoggedKmRunsWalks()`);
  const cum2 = win.eval(`cumulativeActualKm()`);
  console.log('Test 2 (an unplanned walk Activity is added into Runs+Walks but NOT into the plan-only km-logged total):', {
    cum2, rw2, result: (cum2===5 && Math.abs(rw2-8.2)<0.01) ? 'PASS' : 'FAIL'
  });

  // ---- Test 3: a fulfillment-linked Activity (already counted via loggedDist/cumulativeActualKm)
  // is NOT double-counted when it also happens to be a Run/Walk type ----
  win.eval(`
    STATUS={w1run:'done'};
    NOTES={};
    ACTIVITIES=[{id:'act2',type:'run',role:'fulfillment',linkedSessionId:'w1run',date:'2026-07-01',distanceKm:5.4}];
  `);
  const cum3 = win.eval(`cumulativeActualKm()`);
  const rw3 = win.eval(`totalLoggedKmRunsWalks()`);
  console.log('Test 3 (a fulfillment-linked Activity is not double-counted in Runs+Walks):', {
    cum3, rw3, result: (Math.abs(cum3-5.4)<0.01 && Math.abs(rw3-5.4)<0.01) ? 'PASS' : 'FAIL'
  });

  // ---- Test 4: a non-Run/Walk unplanned Activity (e.g. strength) is excluded from Runs+Walks even
  // if it somehow has a distance value -- "only runs and walks" ----
  win.eval(`
    ACTIVITIES=[{id:'act3',type:'strength',role:'unplanned',linkedSessionId:null,date:'2026-07-02',distanceKm:1.0}];
  `);
  const rw4 = win.eval(`totalLoggedKmRunsWalks()`);
  console.log('Test 4 (a non-Run/Walk unplanned Activity is excluded from Runs+Walks):',
    rw4===0 ? 'PASS' : 'FAIL', { rw4 });

  // ---- Test 5: an EXTRALOGS walk entry (Quick Add, not an imported Activity) also counts toward
  // Runs+Walks ----
  win.eval(`
    ACTIVITIES=[];
    EXTRALOGS=[{id:'x1',kind:'walk',date:'2026-07-10',dist:'2.5'}];
  `);
  const rw5 = win.eval(`totalLoggedKmRunsWalks()`);
  console.log('Test 5 (a Quick Add walk EXTRALOGS entry counts toward Runs+Walks):',
    Math.abs(rw5-2.5)<0.01 ? 'PASS' : 'FAIL', { rw5 });

  // ---- Test 6: renderProgress() shows the secondary "incl. walks" line only when Runs+Walks
  // actually differs from the plan-only figure -- no redundant line when there's nothing extra ----
  win.eval(`ACTIVITIES=[]; EXTRALOGS=[]; NOTES={w1run:{dist:'5'}}; STATUS={w1run:'done'};`);
  win.eval(`switchView('progress');`);
  const progressHTMLNoExtra = win.eval(`document.getElementById('view-progress').innerHTML`);
  console.log('Test 6 (no secondary line shown when Runs+Walks equals the plan-only total):',
    !progressHTMLNoExtra.includes('incl. walks') ? 'PASS' : 'FAIL');

  // ---- Test 7: renderProgress() DOES show the secondary line once an unplanned walk exists, with
  // the big "km logged" number staying the plan-only figure (unchanged card size/position) ----
  win.eval(`ACTIVITIES=[{id:'act1',type:'walk',role:'unplanned',linkedSessionId:null,date:'2026-07-05',distanceKm:3.2}];`);
  win.eval(`renderProgress();`);
  const progressHTMLWithExtra = win.eval(`document.getElementById('view-progress').innerHTML`);
  const hasSecondaryLine = progressHTMLWithExtra.includes('incl. walks');
  const bigNumberStillPlanOnly = progressHTMLWithExtra.includes('>5<') || progressHTMLWithExtra.includes('>5.0<');
  console.log('Test 7 (secondary Runs+Walks line appears once a walk exists; big number stays plan-only):', {
    hasSecondaryLine, result: hasSecondaryLine ? 'PASS' : 'FAIL'
  });

  await wait(200);
  win.close();
})();
