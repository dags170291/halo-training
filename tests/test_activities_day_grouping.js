// Regression test for grouping the Activities tab's cards by day. Dylon: "also group activity by days
// in the activity tab please" -- said right after the time-of-day sort fix (see
// test_activities_time_of_day_sort.js), so the two are closely related: once same-day items sort
// correctly by real time, a day header makes it obvious at a glance which cards actually happened on
// the same real day, nested one level under the existing Runna-style month header.
//
// activitiesDayGroups(items) sub-groups an already-sorted, already-month-grouped item list one level
// further, by calendar day, reusing the same most-recent-first order the items already arrived in --
// mirrors activitiesMonthGroups()'s own grouping shape (key/label/items/totalKm) just one level down.
// dayGroupLabel() gives "Today"/"Yesterday" the same shortcut relDayLabel() already uses on each card,
// but always includes the weekday past that ("Wed, Jul 22"), since the month is already shown by the
// header above it -- a bare "Jul 22" alone wouldn't help tell several stacked day groups apart at a
// glance the way relDayLabel()'s own fmtDate() fallback does fine for a single card.
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
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2027-06-01',endDate:'2027-08-01',sessions:[]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; STATUS={}; NOTES={}; RACES_LIST=[];
    EXTRALOGS=[]; ACTIVITIES=[];
    // Two activities on 2027-06-05 (one evening, one morning), one activity on an earlier day
    // (2027-06-03) in the same month.
    addActivity({id:'evening',type:'strength',role:'unplanned',date:'2027-06-05',startTime:'19:30',durationSec:2400,title:'Evening Strength'});
    addActivity({id:'morning',type:'run',role:'unplanned',date:'2027-06-05',startTime:'06:15',distanceKm:8,durationSec:2400,title:'Morning Run'});
    addActivity({id:'earlier',type:'run',role:'unplanned',date:'2027-06-03',startTime:'07:00',distanceKm:5,durationSec:1500,title:'Earlier Run'});
  `);

  // ---- Test 1: activitiesDayGroups() produces one group per real calendar day, most recent first,
  // each with the right items nested inside. ----
  const groups = win.eval(`JSON.stringify(activitiesDayGroups(historyItems()).map(g=>({key:g.key,label:g.label,ids:g.items.map(i=>i.id)})))`);
  const parsed = JSON.parse(groups);
  console.log('Test 1 (activitiesDayGroups groups items by real calendar day, most recent first):',
    (parsed.length===2 && parsed[0].key==='2027-06-05' && JSON.stringify(parsed[0].ids)===JSON.stringify(['evening','morning'])
      && parsed[1].key==='2027-06-03' && JSON.stringify(parsed[1].ids)===JSON.stringify(['earlier'])) ? 'PASS' : 'FAIL',
    { parsed });

  // ---- Test 2: dayGroupLabel() includes the weekday (not just a bare "Jun 5"), so several stacked day
  // headers under one month can still be told apart at a glance. ----
  const label = win.eval(`dayGroupLabel('2027-06-05')`);
  console.log('Test 2 (dayGroupLabel includes the weekday, e.g. "Sat, Jun 5"):',
    /^[A-Za-z]{3}, Jun 5$/.test(label) ? 'PASS' : `FAIL (got "${label}")`);

  // ---- Test 3: dayGroupLabel() still says "Today"/"Yesterday" for those two special cases, same
  // shortcut relDayLabel() already uses per-card. ----
  const todayLabel = win.eval(`dayGroupLabel(todayISO())`);
  console.log('Test 3 (dayGroupLabel says "Today" for the real current date):',
    todayLabel==='Today' ? 'PASS' : `FAIL (got "${todayLabel}")`);

  // ---- Test 4: the real Activities tab render actually shows exactly one day-header ELEMENT
  // (.activities-day-hdr) per distinct day -- both 2027-06-05 activities nest under one shared header,
  // not two. (Each card also shows its own date/time line via relDayLabel(), same as before this
  // change -- so this counts the dedicated header element, not just any occurrence of the date text.) ----
  win.eval(`CURR_VIEW='activities'; renderActivities();`);
  const activitiesHTML = win.eval(`document.getElementById('view-activities').innerHTML`);
  const dayHeaderCount = (activitiesHTML.match(/class="activities-day-hdr"/g)||[]).length;
  console.log('Test 4 (the rendered Activities tab shows exactly one day-header element per real calendar day):',
    dayHeaderCount===2 ? 'PASS' : 'FAIL', { dayHeaderCount });

  // ---- Test 5: within the rendered HTML, both 2027-06-05 cards ("Evening Strength", "Morning Run")
  // appear AFTER that day's header and BEFORE the 2027-06-03 day header -- confirms real nesting, not
  // just two headers dropped in with the cards in the wrong place. ----
  const day5HeaderIdx = activitiesHTML.indexOf('Jun 5');
  const eveningIdx = activitiesHTML.indexOf('Evening Strength');
  const morningIdx = activitiesHTML.indexOf('Morning Run');
  const day3HeaderIdx = activitiesHTML.indexOf('Jun 3');
  console.log('Test 5 (both same-day cards render nested between their day header and the next one):',
    (day5HeaderIdx>=0 && day5HeaderIdx<eveningIdx && eveningIdx<morningIdx && morningIdx<day3HeaderIdx) ? 'PASS' : 'FAIL',
    { day5HeaderIdx, eveningIdx, morningIdx, day3HeaderIdx });

  await wait(200);
  win.close();
})();
