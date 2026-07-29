// Regression test for a real reported gap: a brand-new account (0 sessions logged, nothing in
// history) had no visible way to reach the Import Activity button shipped in v0.19.0, because Full
// History's "View all ->" link only rendered once historyItems() had something in it. Fixes: (1) that
// link is now always shown from Progress, regardless of how much has been logged, and (2) a second,
// independent Import Activity entry point was added -- originally to Today's "Add Activity" grid
// (qaGridHTML), later superseded by the Add-Activity FAB (Task 48/v0.22.0, see
// test_activity_fab.js) once Dylon asked for the inline grid to move behind a FAB instead --
// reusing the exact same triggerActivityImport()/handleActivityImportFile() pipeline via its own
// file input id so it works with zero coupling to whichever screen is currently rendered.
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

  // Test 1: the inline Today "Add Activity" grid (qaGridHTML) is gone -- superseded by the
  // Add-Activity FAB (Task 48, see test_activity_feed_fab.js) -- so Today's own rendered HTML
  // should no longer contain a qa-grid or a today-activity-import-input, and qaGridHTML itself no
  // longer exists. renderToday() (not switchView, which also touches day-strip/topbar rendering
  // that assume a real active block) needs at least a minimal block so it has something to render.
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-09-01',sessions:[
      {id:'s1',wk:1,ty:'easy',date:'2026-07-01',ph:'dur',ti:'Easy Run'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; STATUS={}; NOTES={}; RACES_LIST=[];
    SELECTED_DATE='2026-07-01';
    renderToday();
  `);
  const todayHTML = win.eval(`document.getElementById('view-today').innerHTML`);
  const t1FnGone = win.eval(`typeof qaGridHTML`) === 'undefined';
  const t1NoGrid = !/qa-grid/.test(todayHTML) && !/today-activity-import-input/.test(todayHTML);
  console.log('Test 1 (inline Today Add Activity grid is gone, replaced by the FAB):', (t1FnGone && t1NoGrid) ? 'PASS' : 'FAIL');

  // Test 2: triggerActivityImport() clicks whichever input id it's given (not hardcoded to one input).
  win.eval(`
    window.__clicked = null;
    document.body.insertAdjacentHTML('beforeend','<input type="file" id="test-fake-input">');
    document.getElementById('test-fake-input').addEventListener('click', ()=>{ window.__clicked = 'test-fake-input'; });
    triggerActivityImport('test-fake-input');
  `);
  const t2 = win.eval(`window.__clicked`);
  console.log('Test 2 (triggerActivityImport works with a caller-supplied input id):', t2 === 'test-fake-input' ? 'PASS' : 'FAIL');

  // Test 3: with zero logged sessions/extras/activities (a brand-new account), Progress's History
  // card still shows "View all" so Full History (and its Import button) stays reachable.
  win.eval(`STATUS={}; NOTES={}; EXTRALOGS=[]; ACTIVITIES=[]; PROGRESS_SUB='main'; renderProgress();`);
  const progressHTML = win.eval(`document.getElementById('view-progress').innerHTML`);
  const t3ok = /View all/.test(progressHTML) && /Nothing logged yet/.test(progressHTML);
  console.log('Test 3 ("View all" link is present on Progress even with nothing logged):', t3ok ? 'PASS' : 'FAIL');

  // Test 4: activityDisplayName() falls back to the type label with no title, and prefers a real
  // title once one's been set — the one place this fallback rule lives, so the feed and the detail
  // popup can't disagree on what to call an activity.
  win.eval(`
    ACTIVITIES=[];
    window.__act = addActivity({type:'run',date:'2027-04-01'});
  `);
  const t4NoTitle = win.eval(`activityDisplayName(window.__act)`);
  win.eval(`window.__act.title='Saturday Long Run';`);
  const t4WithTitle = win.eval(`activityDisplayName(window.__act)`);
  console.log('Test 4 (activityDisplayName falls back to type label, then prefers a real title):',
    (t4NoTitle === 'Run' && t4WithTitle === 'Saturday Long Run') ? 'PASS' : 'FAIL');

  // Test 5: the detail popup no longer shows an always-visible name input + footer "Save Name"
  // button, nor a standalone "Edit Name" ghost button below the title (Dylon, first: "i dont want
  // that ... there should just be an edit button to edit run details ... and then see the option to
  // save", then: "move the edit name icon to the right with delete and close ... edit should not just
  // be for the name but also run details also shoes ... tags and rpe scale"). Edit is now one of the
  // compact icon corner buttons alongside Delete/Close, and toggling it reveals the full edit form
  // (name input, shoe select, RPE slider, tags, notes) via
  // toggleActivityEditMode()/saveActivityDetailsInline().
  win.eval(`window.__act.title=''; ACT_EDIT_MODE=false; openActivityDetail(window.__act.id);`);
  const closedHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  const t5NoInputByDefault = !/id="act-name-input"/.test(closedHTML) && !/>Edit Name</.test(closedHTML);
  const t5HasEditIcon = /title="Edit"/.test(closedHTML);
  win.eval(`toggleActivityEditMode(window.__act.id);`);
  const editHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  const t5HasInputWhenEditing = /id="act-name-input"/.test(editHTML) && /id="act-edit-shoe"/.test(editHTML) && /id="act-edit-notes"/.test(editHTML);
  win.eval(`document.getElementById('act-name-input').value='Renamed Run'; saveActivityDetailsInline(window.__act.id);`);
  const t5Saved = win.eval(`ACTIVITIES.find(a=>a.id===window.__act.id).title`);
  const afterSaveHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  const t5BackToViewMode = !/id="act-name-input"/.test(afterSaveHTML);
  console.log('Test 5 (Edit is a corner icon button; toggling reveals name+shoe+rpe+tags+notes form; saving commits and returns to view mode):',
    (t5NoInputByDefault && t5HasEditIcon && t5HasInputWhenEditing && t5Saved === 'Renamed Run' && t5BackToViewMode) ? 'PASS' : 'FAIL');

  // Test 6: the detail popup calls out plainly when a file had no GPS/cadence, rather than silently
  // omitting those rows (a real complaint about the original one-line-blurb version of this popup).
  win.eval(`window.__act.stream={t:[],lat:[],lon:[],alt:[],distM:[],hr:[],cadence:[]}; openActivityDetail(window.__act.id);`);
  const noGpsHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  console.log('Test 6 (detail popup explicitly notes missing GPS/cadence rather than omitting it):',
    (/No GPS data/.test(noGpsHTML) && /No cadence data/.test(noGpsHTML)) ? 'PASS' : 'FAIL');

  // Test 7: the GPS/cadence note and the role/source-file line now render together at the very
  // bottom of the popup -- Dylon: "this text ... should be in the footer of the entire sheet" --
  // instead of wedged between the stat rows and everything else like before. Checked by confirming
  // the note's text index in the popup's HTML comes AFTER the "Route" section label (Route is the
  // first analytics section -- see the v0.28.0 reorder) rather than before it like the old layout.
  win.eval(`
    ACTIVITIES=[];
    window.__act7 = addActivity({
      type:'run', date:'2027-04-02', durationSec:600, distanceKm:2,
      stream:{ t:[0,60,120,180,240,300,360,420,480,540,600].map(s=>new Date(2027,3,2,6,0,s).toISOString()),
        lat:[40.0,40.001,40.002,40.003,40.004,40.005,40.006,40.007,40.008,40.009,40.010],
        lon:[-75.0,-75.001,-75.002,-75.003,-75.004,-75.005,-75.006,-75.007,-75.008,-75.009,-75.010],
        alt:[], distM:[0,180,360,540,720,900,1080,1260,1440,1620,1800], hr:[], cadence:[] }
    });
    openActivityDetail(window.__act7.id);
  `);
  const footerHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  const t7RouteIdx = footerHTML.indexOf('>Route<');
  const t7NoteIdx = footerHTML.indexOf('GPS route recorded.');
  console.log('Test 7 (GPS/cadence + role/source note renders at the bottom, after the Route section, not before it):',
    (t7RouteIdx>=0 && t7NoteIdx>t7RouteIdx) ? 'PASS' : 'FAIL');

  // Test 8: Edit/Delete/Close all render as compact icon controls next to the title (Dylon: "move
  // the edit name icon to the right with delete and close and use the attached svgs for delete and
  // edit"), not the old full-width stacked footer, and Delete is no longer a text pill either -- so
  // .confirm-btns should be entirely absent from this popup's markup, all three should render as icon
  // buttons (no visible "Edit"/"Delete"/"Close" text), and Delete should still actually work when
  // clicked.
  win.eval(`ACT_EDIT_MODE=false; openActivityDetail(window.__act.id);`);
  const cornerHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  const t8NoFooterBar = !/class="confirm-btns"/.test(cornerHTML);
  const t8CloseIsIcon = /class="sheet-close"[^>]*title="Close"/.test(cornerHTML) && !/>Close</.test(cornerHTML);
  const t8DeleteIsIcon = /class="sheet-close"[^>]*title="Delete"/.test(cornerHTML) && !/>Delete</.test(cornerHTML);
  const t8EditIsIcon = /class="sheet-close"[^>]*title="Edit"/.test(cornerHTML) && !/>Edit</.test(cornerHTML);
  win.eval(`document.getElementById('cf-btn-1').click();`); // Edit, Delete, Close -- Delete is btns[1] now
  const t8Deleted = win.eval(`ACTIVITIES.find(a=>a.id===window.__act.id)`) === undefined;
  console.log('Test 8 (Edit/Delete/Close all render as compact icon corner controls, not a full-width footer or text pill, and Delete still works):',
    (t8NoFooterBar && t8CloseIsIcon && t8DeleteIsIcon && t8EditIsIcon && t8Deleted) ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
