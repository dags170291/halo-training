// Regression test for the Activities tab's card redesign. Dylon shared a screenshot of Runna's own
// Activities tab and said: "wee need to redesign the activities to look more presentable as a home
// page tab take a look at runna stream to redesign it with a preview of data give each activity it's
// own card as well dont use the coloured line on the outside of runnas card though you may colour
// each card base don activity." Covers: (1) each history item now renders as its own real .card
// instead of every item sharing one big wrapper, (2) a Runna-style month header row ("July 2026 ...
// 51.7 km") groups items and totals that month's distance, (3) each card previews up to 3 stats
// (Distance/Time/Avg Pace, or whatever subset actually applies) instead of one packed text line, and
// (4) cards are colored per activity type via a soft full-card gradient tint (activityTypeIcoCls/
// ICO_CARD_TINT) rather than Runna's own outer accent bar, which Dylon explicitly ruled out.
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
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-09-01',sessions:[
      {id:'s1',wk:1,ty:'easy',date:'2026-07-15',ph:'dur',ti:'Easy Run'},
      {id:'s2',wk:1,ty:'str',date:'2026-07-10',ph:'dur',ti:'Strength Session'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-01'; BLOCK_END='2026-09-01';
    STATUS={s1:'done',s2:'done'}; NOTES={s2:{}}; RACES_LIST=[]; ACTIVITIES=[]; EXTRALOGS=[];
  `);

  // Test 1: two imported Activities each get their own .card inside #view-activities, rather than
  // being packed into one shared wrapper the way the old logFeedItemHTML-based feed did.
  win.eval(`
    window.__a1 = addActivity({type:'run',date:'2026-07-20',startTime:'05:24',distanceKm:8.05,durationSec:2460,avgPace:'5:06',avgHr:151,title:'Wednesday Morning Run'});
    window.__a2 = addActivity({type:'walk',date:'2026-07-18',distanceKm:3.2,durationSec:1800});
    switchView('activities');
  `);
  const bodyHTML = win.eval(`document.getElementById('view-activities').innerHTML`);
  const cardCount = (bodyHTML.match(/class="card"/g) || []).length;
  console.log('Test 1 (each history item renders as its own .card, not one shared wrapper):',
    cardCount >= 4 ? 'PASS' : 'FAIL', { cardCount }); // 2 sessions + 2 activities = 4 cards min

  // Test 2: the month header row groups by month and shows that month's total distance (Runna's
  // "July 2026 ... 51.7 km" style) — all four test entries fall in July 2026, total should be
  // 8.05 + 3.2 = 11.25 km (session distances are 0 here since NOTES has no .dist typed in).
  const hasMonthHeader = /July 2026/.test(bodyHTML);
  const hasTotal = /11\.3 km|11\.2 km|11\.25 km/.test(bodyHTML);
  console.log('Test 2 (month header row shows the month label and its total distance):',
    (hasMonthHeader && hasTotal) ? 'PASS' : 'FAIL', { hasMonthHeader, hasTotal });

  // Test 3: the imported run's card previews Distance/Time/Avg Pace as separate labeled stats
  // (Runna-style), not one packed "8.05km · 5:06/km · 151bpm avg" text line.
  const runCardOk = /Wednesday Morning Run/.test(bodyHTML) && /Distance/.test(bodyHTML) &&
    />Time</.test(bodyHTML) && /Avg Pace/.test(bodyHTML) && /8\.1 km|8\.05 km/.test(bodyHTML) && /5:06\/km/.test(bodyHTML);
  console.log('Test 3 (an activity card previews Distance/Time/Avg Pace as separate labeled stats):', runCardOk ? 'PASS' : 'FAIL');

  // Test 4: the relative date/time line reads "Today · <time>" for an activity dated today with a
  // startTime, matching Runna's own "Today · 5:24 AM" style.
  win.eval(`
    window.__todayAct = addActivity({type:'run',date:todayISO(),startTime:'05:24',distanceKm:5});
    switchView('activities');
  `);
  const todayHTML = win.eval(`document.getElementById('view-activities').innerHTML`);
  console.log('Test 4 (an activity dated today shows "Today · 5:24 AM" as its date/time line):',
    /Today · 5:24 AM/.test(todayHTML) ? 'PASS' : 'FAIL');

  // Test 5: a done session with no metrics logged still falls back to the same "no metrics" caption
  // the old single-line feed used, rather than an empty/broken stat row.
  const fallbackOk = /Logged, no metrics entered/.test(bodyHTML);
  console.log('Test 5 (a session with nothing logged falls back to "Logged, no metrics entered"):', fallbackOk ? 'PASS' : 'FAIL');

  // Test 6: cards are colored per activity type via a full-card background tint (not a border/outline
  // "line" running down one edge) — the run card's background should be the ico-easy gradient tint,
  // and nothing in the redesign should introduce a colored border-left accent bar.
  const hasRunTint = /background:linear-gradient\(160deg,var\(--dur3\)/.test(bodyHTML);
  const hasNoAccentBar = !/border-left:\s*\d+px solid/.test(bodyHTML);
  console.log('Test 6 (cards are colored via a full-card tint, not a colored border/edge accent bar):',
    (hasRunTint && hasNoAccentBar) ? 'PASS' : 'FAIL', { hasRunTint, hasNoAccentBar });

  // Test 7: tapping a card still opens the right detail sheet — activity cards call
  // openActivityDetail with that activity's id, same as the old feed item did.
  const onclickPresent = new RegExp(`onclick="openActivityDetail\\('${win.eval('window.__a1.id')}'\\)"`).test(bodyHTML);
  console.log('Test 7 (an activity card still opens the right detail sheet on tap):', onclickPresent ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
