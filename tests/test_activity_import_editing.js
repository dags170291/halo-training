// Regression test for v0.32.31's import-time editing. Dylon: "on the activity import screen after
// selecting the file outside of just renaming the activity i want the ability to edit other details
// like RPE and shoes before saving... there are too many steps to having to edit shoes and other
// details." Both the single-file import screen (confirmActivityImport) and each card of the
// multi-file batch carousel (confirmActivityImportBatch) now get the same Type/Shoe/RPE/Tags/Notes
// fields the post-save activity detail popup already had, via a shared importEditFieldsHTML()/
// readImportEditFields() pair. Separately: "instead of a long list of all the files we are trying to
// import, make it a swipeable card... swipe across or click navigation buttons left and right to go
// between each card" -- the batch review is now a one-card-at-a-time scroll-snap carousel
// (scrollImportBatchCarousel/commitBatchCardEdits/wireImportBatchCarousel) instead of a stacked list.
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
      win.Element.prototype.scrollTo = () => {};
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
  win.eval(`SHOES={sl2:{name:'Superblast 2',retired:false}}; ACTIVITIES=[];`);

  // ==== Single-file import screen ====

  // ---- Test 1: confirmActivityImport's rendered card includes the full edit field set (type/shoe/
  // RPE/tags/notes), not just the name input ----
  win.eval(`confirmActivityImport(importActivityText(${JSON.stringify(SAMPLE_TCX)},'run1.tcx').activity);`);
  const singleHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  console.log('Test 1 (single-file import screen shows Type/Shoe/RPE/Tags/Notes fields, not just Name):', {
    result: (singleHTML.includes('import-type') && singleHTML.includes('import-shoe') &&
      singleHTML.includes('import-rpe-range') && singleHTML.includes('import-notes') &&
      singleHTML.includes('import-name-input')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 2: setting the shoe/RPE/notes fields before tapping Import actually saves them onto
  // the new Activity -- not just the name, which was all the old screen could set ----
  win.eval(`document.getElementById('import-shoe').value='sl2';`);
  win.eval(`document.getElementById('import-rpe-range').value='7'; updateRPEDisplay('import');`);
  win.eval(`document.getElementById('import-notes').value='Felt strong the whole way.';`);
  win.eval(`finalizeActivityImport();`);
  const saved1 = JSON.parse(win.eval(`JSON.stringify(ACTIVITIES[0])`));
  console.log('Test 2 (shoe/RPE/notes set on the import screen are saved onto the new Activity):', {
    shoe: saved1.shoe, rpe: saved1.rpe, notes: saved1.notes,
    result: (saved1.shoe==='sl2' && saved1.rpe==='7' && saved1.notes==='Felt strong the whole way.') ? 'PASS' : 'FAIL'
  });

  // ==== Multi-file batch carousel ====

  win.eval(`ACTIVITIES=[];`);
  win.eval(`
    confirmActivityImportBatch([
      {file:{name:'run1.tcx'}, result:importActivityText(${JSON.stringify(SAMPLE_TCX)},'run1.tcx')},
      {file:{name:'walk1.gpx'}, result:importActivityText(${JSON.stringify(SAMPLE_GPX)},'walk1.gpx')},
      {file:{name:'broken.tcx'}, result:{ok:false,error:'Could not read this TCX file.'}}
    ]);
  `);

  // ---- Test 3: the batch review is now a carousel structure -- one .ibatch-card per file (still all
  // 3, error card included), nav buttons and a "File X of N" indicator present ----
  const batchHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  const cardCount = (batchHTML.match(/class="ibatch-card"/g)||[]).length;
  console.log('Test 3 (batch review renders as a carousel: one card per file, nav buttons, indicator):', {
    cardCount,
    result: (cardCount===3 && batchHTML.includes('ibatch-carousel') && batchHTML.includes('ibatch-prev') &&
      batchHTML.includes('ibatch-next') && batchHTML.includes('File 1 of 3')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 4: each successfully-parsed card also has the full edit field set (unique ids per card
  // via the batch-<id> prefix), not just name+checkbox like the old stacked list ----
  const firstId = win.eval(`PENDING_IMPORT_BATCH[0].id`);
  const hasFullFieldsOnCard1 = win.eval(`!!document.getElementById('batch-${firstId}-type') && !!document.getElementById('batch-${firstId}-shoe') && !!document.getElementById('batch-${firstId}-rpe-range')`);
  console.log('Test 4 (each batch card has its own full edit field set with unique ids):',
    hasFullFieldsOnCard1 ? 'PASS' : 'FAIL');

  // ---- Test 5: editing a field on card 0, then navigating to card 1 via scrollImportBatchCarousel,
  // commits card 0's edit into PENDING_IMPORT_BATCH -- edits aren't lost when paging away ----
  win.eval(`document.getElementById('batch-${firstId}-shoe').value='sl2';`);
  win.eval(`document.getElementById('batch-${firstId}-rpe-range').value='9'; updateRPEDisplay('batch-${firstId}');`);
  win.eval(`scrollImportBatchCarousel(1);`);
  const committedAfterNav = JSON.parse(win.eval(`JSON.stringify({shoe:PENDING_IMPORT_BATCH[0].draft.shoe, rpe:PENDING_IMPORT_BATCH[0].draft.rpe, idx:PENDING_IMPORT_BATCH_INDEX})`));
  console.log('Test 5 (navigating to the next card commits the previous card\\u2019s edits, index advances):', {
    committedAfterNav,
    result: (committedAfterNav.shoe==='sl2' && committedAfterNav.rpe==='9' && committedAfterNav.idx===1) ? 'PASS' : 'FAIL'
  });

  // ---- Test 6: the "File X of N" indicator updates to match the new index ----
  const indicatorAfterNav = win.eval(`document.getElementById('ibatch-indicator').textContent`);
  console.log('Test 6 (the File X of N indicator updates after navigating):',
    indicatorAfterNav==='File 2 of 3' ? 'PASS' : 'FAIL', { indicatorAfterNav });

  // ---- Test 7: navigating past the last card is clamped, not out of bounds (3 files -> stays at
  // index 2, never advances further) ----
  win.eval(`scrollImportBatchCarousel(1);`); // -> idx 2 (broken.tcx, no draft, commit no-ops safely)
  win.eval(`scrollImportBatchCarousel(1);`); // attempt past the end
  const idxClamped = win.eval(`PENDING_IMPORT_BATCH_INDEX`);
  console.log('Test 7 (navigation is clamped at the last card, never goes out of bounds):',
    idxClamped===2 ? 'PASS' : 'FAIL', { idxClamped });

  // ---- Test 8: finalizeActivityImportBatch commits every card's edits (not just whichever one is
  // currently on screen) before saving -- card 0's shoe/RPE edit from Test 5 survives all the way to
  // the saved Activity even though the carousel has since moved past it ----
  win.eval(`finalizeActivityImportBatch();`);
  const savedActs = JSON.parse(win.eval(`JSON.stringify(ACTIVITIES.map(a=>({type:a.type,shoe:a.shoe,rpe:a.rpe})))`));
  const runSaved = savedActs.find(a=>a.type==='run');
  console.log('Test 8 (finalizeActivityImportBatch commits every card\\u2019s edits, even ones navigated away from):', {
    savedActs,
    result: (runSaved && runSaved.shoe==='sl2' && runSaved.rpe==='9') ? 'PASS' : 'FAIL'
  });

  await wait(200);
  win.close();
})();
