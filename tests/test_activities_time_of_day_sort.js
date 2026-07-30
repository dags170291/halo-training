// Regression test for the Activities tab's sort order. Dylon: "i will like each activity to be sorted
// by time the activity was done (not uploaded), most recent to the top. this must apply for even the
// uploaded activities as well as manually logged activities."
//
// Investigation found historyItems() was already sorting by each item's real DATE (never an upload/
// import/created timestamp -- an imported Activity's own `date`/`startTime` always come from the file's
// real recorded start time, see buildActivityFromParsed()), descending, and consistently across planned
// sessions/manual EXTRALOGS entries/imported ACTIVITIES alike -- so day-level ordering, and the "most
// recent to top" direction, were already correct. The actual gap: none of the three source types' items
// carried a time-of-day into the sort comparator, so two items landing on the SAME calendar day fell
// back to plain array/insertion order (all same-day sessions, then all same-day extras, then all
// same-day activities, in whatever order they happened to be pushed) -- which could look exactly like
// "sorted by when it was added to the app" for that day, even though the underlying date was correct.
// Fixed by carrying a real Activity's own `startTime` onto its history item and using it as a same-day
// tiebreaker (mirroring the pattern unplannedActivities() already used for the Needs Review list).
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
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2027-06-01',endDate:'2027-08-01',sessions:[
      {id:'sMon',wk:1,ty:'str',date:'2027-06-05',ph:'dur',ti:'Strength',full:''}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; STATUS={sMon:'done'}; NOTES={}; RACES_LIST=[];
    EXTRALOGS=[];
    ACTIVITIES=[];
    // Two imported activities on the SAME calendar day, deliberately imported/pushed OUT of real-time
    // order (the evening one added to ACTIVITIES first, the morning one second) -- if the sort fell back
    // to insertion order, the evening run would wrongly appear to have happened "more recently" than the
    // morning one just because it was imported first.
    addActivity({id:'evening',type:'strength',role:'unplanned',date:'2027-06-05',startTime:'19:30',durationSec:2400,title:'Evening Strength'});
    addActivity({id:'morning',type:'run',role:'unplanned',date:'2027-06-05',startTime:'06:15',distanceKm:8,durationSec:2400,title:'Morning Run'});
    // A third activity on an EARLIER day but with a deliberately mismatched createdAt (far in the
    // future, as if imported today) -- must still sort by its real date, never by createdAt.
    addActivity({id:'older',type:'run',role:'unplanned',date:'2027-06-01',startTime:'07:00',distanceKm:5,durationSec:1500,createdAt:'2027-08-01T12:00:00.000Z',title:'Older Run'});
  `);

  // ---- Test 1: two Activities on the same real day sort by their own real startTime, most recent
  // (later clock time) first -- NOT by which one was pushed/imported first. ----
  const order = win.eval(`historyItems().filter(i=>i.date==='2027-06-05').map(i=>i.id)`);
  console.log('Test 1 (same-day Activities sort by real startTime, most recent first, not insertion order):',
    JSON.stringify(order)===JSON.stringify(['evening','morning','sMon']) ? 'PASS' : `FAIL (got ${JSON.stringify(order)})`);

  // ---- Test 2: overall day-level ordering is still correct -- 2027-06-05's items all come before
  // 2027-06-01's, most recent day first. ----
  const allIds = win.eval(`historyItems().map(i=>i.id)`);
  const olderIdx = allIds.indexOf('older');
  const eveningIdx = allIds.indexOf('evening');
  console.log('Test 2 (the earlier day\'s activity sorts after every item from the more recent day):',
    eveningIdx < olderIdx ? 'PASS' : 'FAIL', { allIds });

  // ---- Test 3: the mismatched createdAt on 'older' (set far in the future, mimicking "imported today")
  // has zero effect on where it sorts -- confirms the sort is driven by the activity's real recorded
  // date/time, never an upload/import timestamp. ----
  const olderPos = win.eval(`historyItems().findIndex(i=>i.id==='older')`);
  const isLast = olderPos === win.eval(`historyItems().length`) - 1;
  console.log('Test 3 (an activity with a recent createdAt but an old real date still sorts by its real date, not createdAt):',
    isLast ? 'PASS' : 'FAIL', { olderPos });

  // ---- Test 4: sessions/extras (no time-of-day data at all) are unaffected -- a same-day session with
  // no startTime still appears (doesn't crash/vanish), landing after the time-stamped activities since
  // an empty startTime never outranks a real one. ----
  const sMonPresent = win.eval(`historyItems().some(i=>i.id==='sMon')`);
  console.log('Test 4 (a same-day session with no time-of-day data still appears in the list):',
    sMonPresent ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
