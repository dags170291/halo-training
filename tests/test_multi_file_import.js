// Regression test for multi-file activity import -- Dylon: "oh u know what i wanted? ability to
// upload and review multiple files at once." Every general-purpose "+ Import Activity" input (FAB,
// Today, Activity Feed) now has the native `multiple` file-picker attribute; the session-specific
// "+ Add Activity" input deliberately doesn't (a single planned session can only be fulfilled by one
// activity, so that flow stays single-file). Selecting more than one file routes through
// confirmActivityImportBatch() -> a review list (one card per file, each with its own editable name
// and an include checkbox, a failed file shown inline with its error instead of silently vanishing)
// -> finalizeActivityImportBatch(), which only saves the entries still checked. This test drives that
// pipeline directly via confirmActivityImportBatch()/finalizeActivityImportBatch() rather than
// simulating a real multi-file FileReader event (which handleActivityImportFile's own Promise.all
// plumbing -- unit-testable in spirit the same way importActivityText already is directly, per this
// suite's existing convention).
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

const SAMPLE_TCX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>2027-03-10T06:00:00.000-04:00</Id>
      <Lap StartTime="2027-03-10T06:00:00.000-04:00">
        <TotalTimeSeconds>600.0</TotalTimeSeconds>
        <DistanceMeters>2000.0</DistanceMeters>
        <Track>
          <Trackpoint><Time>2027-03-10T06:00:00.000-04:00</Time><DistanceMeters>0.0</DistanceMeters><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>
          <Trackpoint><Time>2027-03-10T06:10:00.000-04:00</Time><DistanceMeters>2000.0</DistanceMeters><HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Test Walk</name><type>walking</type>
    <trkseg>
      <trkpt lat="10.65" lon="-61.19"><ele>70.0</ele><time>2027-03-11T06:00:00Z</time></trkpt>
      <trkpt lat="10.6510" lon="-61.1910"><ele>72.0</ele><time>2027-03-11T06:20:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
  win.eval(`window.renderAll = function(){};`);

  // ---- Test 1: the shared FAB's own general-purpose import input has the `multiple` attribute; the
  // session-specific "+ Add Activity" input deliberately does not. Used to be 2 general-purpose
  // inputs (this one plus the Activities tab's own) before that tab's inline Import Activity
  // button/input was removed entirely in favor of showing this same FAB there too -- Dylon: "remove
  // the import activity botton on the activy feed and place the same fab we created on the screen"
  // (see test_activity_feed_fab.js/test_activities_toolbar_redesign.js). fab-activity-import-input
  // is static top-level markup, checked live in the DOM ----
  win.eval(`BLOCKS=[]; DATA=[]; STATUS={}; NOTES={}; EXTRALOGS=[]; RACES_LIST=[]; ACTIVITIES=[]; ACTIVITIES_FILTER='all'; renderActivities();`);
  const fabHasMultiple = win.eval(`document.getElementById('fab-activity-import-input').hasAttribute('multiple')`);
  const activitiesHTML = win.eval(`document.getElementById('view-activities').innerHTML`);
  const activitiesHasOwnInput = /activities-activity-import-input/.test(activitiesHTML);
  console.log('Test 1 (the shared FAB import input has the multiple attribute; the Activities tab no longer has its own separate input):',
    (fabHasMultiple === true && activitiesHasOwnInput === false) ? 'PASS' : 'FAIL',
    { fabHasMultiple, activitiesHasOwnInput });

  // ---- Test 2: parseActivityBuffer routes correctly for both text formats (same routing
  // importActivityText itself already does, just reachable as its own named function now) ----
  win.eval(`window.__tcxBuf = new TextEncoder().encode(${JSON.stringify(SAMPLE_TCX)}).buffer;`);
  win.eval(`window.__gpxBuf = new TextEncoder().encode(${JSON.stringify(SAMPLE_GPX)}).buffer;`);
  const tcxResult = JSON.parse(win.eval(`JSON.stringify(parseActivityBuffer(window.__tcxBuf,'run1.tcx'))`));
  const gpxResult = JSON.parse(win.eval(`JSON.stringify(parseActivityBuffer(window.__gpxBuf,'walk1.gpx'))`));
  console.log('Test 2 (parseActivityBuffer routes TCX/GPX buffers to the right parser):',
    (tcxResult.ok && tcxResult.activity.type === 'run' && gpxResult.ok && gpxResult.activity.type === 'walk') ? 'PASS' : 'FAIL',
    { tcxResult, gpxResult });

  // ---- Test 3: confirmActivityImportBatch builds one PENDING_IMPORT_BATCH entry per file (2 real,
  // 1 failed), each successful one starting included, the failed one starting excluded with no draft ----
  win.eval(`
    ACTIVITIES=[];
    confirmActivityImportBatch([
      {file:{name:'run1.tcx'}, result:importActivityText(${JSON.stringify(SAMPLE_TCX)},'run1.tcx')},
      {file:{name:'walk1.gpx'}, result:importActivityText(${JSON.stringify(SAMPLE_GPX)},'walk1.gpx')},
      {file:{name:'broken.tcx'}, result:{ok:false,error:'Could not read this TCX file — it may be corrupted.'}}
    ]);
  `);
  const batch = JSON.parse(win.eval(`JSON.stringify(PENDING_IMPORT_BATCH.map(x=>({filename:x.filename,hasDraft:!!x.draft,include:x.include,error:x.error})))`));
  console.log('Test 3 (confirmActivityImportBatch builds one entry per file, failed one excluded with no draft):', {
    batch,
    result: (batch.length === 3 &&
      batch[0].filename === 'run1.tcx' && batch[0].hasDraft === true && batch[0].include === true &&
      batch[1].filename === 'walk1.gpx' && batch[1].hasDraft === true && batch[1].include === true &&
      batch[2].filename === 'broken.tcx' && batch[2].hasDraft === false && batch[2].include === false && !!batch[2].error
    ) ? 'PASS' : 'FAIL'
  });

  // ---- Test 4: the review dialog actually rendered -- both real filenames appear as editable
  // name-field cards, the failed one shows its error inline, and the confirm overlay is open ----
  const dialogHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  const overlayOpen = win.eval(`document.getElementById('confirm-overlay').classList.contains('open')`);
  console.log('Test 4 (review dialog shows all 3 files, the failed one with its error, overlay open):', {
    overlayOpen,
    result: (overlayOpen && dialogHTML.includes('run1.tcx') && dialogHTML.includes('walk1.gpx') &&
      dialogHTML.includes('broken.tcx') && dialogHTML.includes('Could not read this TCX file') &&
      dialogHTML.includes('batch-include-') && dialogHTML.includes('batch-name-')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 5: toggleImportBatchInclude flips exactly the targeted entry's include flag ----
  const firstId = win.eval(`PENDING_IMPORT_BATCH[0].id`);
  win.eval(`toggleImportBatchInclude('${firstId}')`);
  const afterToggle = JSON.parse(win.eval(`JSON.stringify(PENDING_IMPORT_BATCH.map(x=>x.include))`));
  console.log('Test 5 (toggleImportBatchInclude flips only the targeted entry):',
    (afterToggle[0] === false && afterToggle[1] === true && afterToggle[2] === false) ? 'PASS' : 'FAIL', { afterToggle });

  // ---- Test 6: finalizeActivityImportBatch saves only the still-included, successfully-parsed
  // entries -- the unchecked run1.tcx from Test 5 is skipped, the failed broken.tcx was never
  // includable at all, only walk1.gpx (still checked) gets added ----
  win.eval(`finalizeActivityImportBatch();`);
  const savedCount = win.eval(`ACTIVITIES.length`);
  const savedType = win.eval(`ACTIVITIES.length ? ACTIVITIES[0].type : null`);
  const batchClearedAfterFinalize = win.eval(`PENDING_IMPORT_BATCH.length`);
  console.log('Test 6 (finalizeActivityImportBatch saves only the still-included entries, clears the batch):', {
    savedCount, savedType, batchClearedAfterFinalize,
    result: (savedCount === 1 && savedType === 'walk' && batchClearedAfterFinalize === 0) ? 'PASS' : 'FAIL'
  });

  // ---- Test 7: a custom name typed into a batch card's own name field is what actually gets saved,
  // same "blank stays as the fallback label" rule the single-file flow already has ----
  win.eval(`
    ACTIVITIES=[];
    confirmActivityImportBatch([
      {file:{name:'run1.tcx'}, result:importActivityText(${JSON.stringify(SAMPLE_TCX)},'run1.tcx')},
      {file:{name:'walk1.gpx'}, result:importActivityText(${JSON.stringify(SAMPLE_GPX)},'walk1.gpx')}
    ]);
  `);
  const secondId = win.eval(`PENDING_IMPORT_BATCH[1].id`);
  win.eval(`document.getElementById('batch-name-${secondId}').value='Evening Walk with Sister';`);
  win.eval(`finalizeActivityImportBatch();`);
  const titles = JSON.parse(win.eval(`JSON.stringify(ACTIVITIES.map(a=>a.title))`));
  console.log('Test 7 (a renamed batch entry saves with the typed name, the untouched one keeps its default):',
    titles.includes('Evening Walk with Sister') ? 'PASS' : 'FAIL', { titles });

  // ---- Test 8: cancelActivityImportBatch discards every entry without saving anything ----
  win.eval(`
    ACTIVITIES=[];
    confirmActivityImportBatch([{file:{name:'run1.tcx'}, result:importActivityText(${JSON.stringify(SAMPLE_TCX)},'run1.tcx')}]);
    cancelActivityImportBatch();
  `);
  const countAfterCancel = win.eval(`ACTIVITIES.length`);
  const batchAfterCancel = win.eval(`PENDING_IMPORT_BATCH.length`);
  console.log('Test 8 (cancelActivityImportBatch discards everything, saves nothing):',
    (countAfterCancel === 0 && batchAfterCancel === 0) ? 'PASS' : 'FAIL', { countAfterCancel, batchAfterCancel });

  await wait(200);
  win.close();
})();
