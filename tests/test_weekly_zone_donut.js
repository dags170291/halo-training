// Regression test for the Weekly Zone Time card's redesign from a stacked bar (one hover-only
// title="..." tooltip per segment, no legend anywhere on the card) into an interactive donut + a
// persistent legend. Dylon, with a screenshot of a single flat bar: "this is useless as is there is
// nothing that says which colour is which zone it isnt interactive or nothng ... find something
// else." The fix reuses the exact donut geometry/interaction the per-activity Effort card's HR zone
// chart already established, but adds an always-visible legend underneath (color dot + zone name +
// bpm/pace range + time, for every zone at once -- not just the one you tapped) plus a week picker
// once there's more than one real week of data to flip between.
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
function isoDaysAgo(baseISO, n) {
  const d = new Date(baseISO + 'T12:00:00');
  d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// v0.34.20 -- zoneTimeTrendWeeks() switched from racePredWeeksElapsed()/activitiesForWeek() (nearest-
// session matching) to trendCalWeek()/activitiesForTrendWeek() (pure Monday-Sunday calendar math), so
// this fixture's dates need to land on real calendar-week boundaries relative to a Monday-aligned
// BLOCK_START, same pattern test_activity_trends_calendar_week.js already established -- arbitrary
// "N days ago" offsets no longer reliably land in the week number DATA claims for them.
function mondayOf(iso) { const d = new Date(iso + 'T12:00:00'); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
  win.eval(`window.renderAll = function(){};`);

  const today = win.eval(`todayISO()`);
  const todayMonday = mondayOf(today);
  const week1Date = isoDaysAgo(todayMonday, 14); // Monday of "two calendar weeks ago"
  const week2Date = isoDaysAgo(todayMonday, 7); // Monday of "last calendar week"
  const blockEnd = isoDaysAgo(today, -60);

  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'${week1Date}',endDate:'${blockEnd}',sessions:[
      {id:'s1',wk:1,ty:'easy',date:'${week1Date}',ph:'dur'},
      {id:'s2',wk:2,ty:'easy',date:'${week2Date}',ph:'dur'},
      {id:'s3',wk:3,ty:'easy',date:'${todayMonday}',ph:'dur'}
    ],mileagePlan:{1:20,2:20,3:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='${week1Date}'; BLOCK_END='${blockEnd}';
    STATUS={}; NOTES={};
    EXTRALOGS=[{id:'x1',kind:'run',dist:5,pace:'5:00',date:'${week1Date}'}];
    RACES_LIST=[]; ACTIVITIES=[];
    HRZONE_LAST={...computeHRZones({age:30,maxHRFormula:'tanaka'}),method:'karvonen'};
    PROFILE.savedHRZones={...HRZONE_LAST};
    CURR_ZONE_TREND_TYPE='hr'; ZONE_TREND_WK={hr:null,pace:null}; ZONE_TREND_SELIDX={hr:null,pace:null};
  `);

  // Week 1: 90s of constant HR 110 (a single dominant zone, real duration to check against). Week 2:
  // 150s of constant HR 150 (a different dominant zone AND a different total, so switching weeks is
  // provably showing different data, not just re-rendering the same thing).
  win.eval(`
    (function(){
      function stream(baseDate, hrVal, points, stepSec){
        const BASE_T = Date.parse(baseDate+'T06:00:00.000Z');
        const iso = (sec) => new Date(BASE_T + sec*1000).toISOString();
        const t = []; for(let i=0;i<points;i++) t.push(iso(i*stepSec));
        const hr = t.map(()=>hrVal);
        return {t, lat:[], lon:[], alt:[], distM:[], hr, cadence:[]};
      }
      addActivity({type:'run', date:'${week1Date}', durationSec:90, distanceKm:0.3,
        stream: stream('${week1Date}', 110, 10, 10), source:'import', role:'unplanned'});
      addActivity({type:'run', date:'${week2Date}', durationSec:150, distanceKm:0.5,
        stream: stream('${week2Date}', 150, 10, 15), source:'import', role:'unplanned'});
    })();
  `);

  // ---- Test 1: with two real weeks of HR-zone data, zoneTimeTrendCardHTML() shows a legend row for
  // EVERY zone (5 for HR) at once -- persistent, not gated behind a tap -- each with its own color
  // dot and bpm range. This is the direct fix for "nothing says which colour is which zone." ----
  const cardHTML = win.eval(`zoneTimeTrendCardHTML()`);
  const legendRowCount = (cardHTML.match(/class="zonewk-legend-row/g) || []).length;
  const legendHasBpm = /\d+-\d+ bpm/.test(cardHTML);
  const legendHasDots = (cardHTML.match(/zonewk-legend-dot/g) || []).length === legendRowCount;
  console.log('Test 1 (every HR zone shows a legend row with a color dot and bpm range, with no tap needed):',
    (legendRowCount === 5 && legendHasBpm && legendHasDots) ? 'PASS' : 'FAIL',
    { legendRowCount, legendHasBpm, legendHasDots });

  // ---- Test 2: with nothing tapped yet, the donut's center readout shows the week's real total time
  // (not a blank "Tap a zone" placeholder -- Dylon's complaint was the card had nothing useful to say
  // at rest, so the default state itself should already be informative). Defaults to the most recent
  // week (week 2 -- 10 points 15s apart = 9 real intervals = 135s = "2:15"). ----
  const t2HasTotal = /Total Time/.test(cardHTML) && /2:15/.test(cardHTML) && /Week 2/.test(cardHTML);
  console.log('Test 2 (donut center defaults to the most recent week\'s real total time, not a blank placeholder):',
    t2HasTotal ? 'PASS' : 'FAIL', { hasSnippet: t2HasTotal });

  // ---- Test 3: a week picker with a button per real week (W1, W2) appears once there's more than
  // one week of data, so weeks can actually be compared instead of guessing from stacked mini-bars ----
  const t3HasWeekPicker = /selectZoneTrendWeek\('hr',1\)/.test(cardHTML) && /selectZoneTrendWeek\('hr',2\)/.test(cardHTML);
  console.log('Test 3 (a week picker with W1/W2 buttons appears once more than one real week has data):',
    t3HasWeekPicker ? 'PASS' : 'FAIL');

  // ---- Test 3b: v0.34.20 -- the week picker reuses the exact rpred-range-bar/rpred-range-btn
  // segmented-control style the Race Predictions trend chart's own 2W/4W/Block toggle already
  // established, instead of the generic trend-pill row every other filter on this card still uses.
  // Dylon: "make the weekly zone card similar to the Race prediction card with the buttom bar that
  // select the period week 1/ week 2/ etc." ----
  const t3bHasSegClass = /class="rpred-range-bar"/.test(cardHTML) && /class="rpred-range-btn active"/.test(cardHTML);
  console.log('Test 3b (the week picker uses the Race Predictions-style segmented range bar, not a plain trend-pill row):',
    t3bHasSegClass ? 'PASS' : 'FAIL', { hasSegClass: t3bHasSegClass });

  // ---- Test 4: tapping a zone (selectZoneTrendSlice) selects it -- the re-rendered card shows that
  // zone's own row marked selected and the donut center switches from the week total to that zone's
  // own percentage + time. ----
  const zone0 = win.eval(`zonesWithPct(weeklyHRZoneTotals(2))[0]`);
  win.eval(`selectZoneTrendSlice('hr',0)`);
  const selectedHTML = win.eval(`zoneTimeTrendCardHTML()`);
  const t4RowSelected = /zonewk-legend-row selected/.test(selectedHTML);
  const t4CenterShowsPct = selectedHTML.includes(`${zone0.pct}%`);
  console.log('Test 4 (tapping a zone marks its legend row selected and the donut center shows its own %):',
    (t4RowSelected && t4CenterShowsPct) ? 'PASS' : 'FAIL', { t4RowSelected, t4CenterShowsPct, zone0 });

  // ---- Test 5: tapping the SAME zone again deselects it, returning the center readout to the week
  // total rather than getting stuck selected ----
  win.eval(`selectZoneTrendSlice('hr',0)`);
  const deselectedHTML = win.eval(`zoneTimeTrendCardHTML()`);
  const t5Deselected = /Total Time/.test(deselectedHTML) && !/zonewk-legend-row selected/.test(deselectedHTML);
  console.log('Test 5 (tapping the same zone again deselects it, back to the week total):',
    t5Deselected ? 'PASS' : 'FAIL');

  // ---- Test 6: switching weeks via selectZoneTrendWeek shows week 1's own real total (90s = "1:30"),
  // proving the picker actually swaps data rather than just re-rendering the same week, and resets any
  // in-progress zone selection back to the total-time default ----
  win.eval(`selectZoneTrendSlice('hr',1); selectZoneTrendWeek('hr',1)`);
  const week1HTML = win.eval(`zoneTimeTrendCardHTML()`);
  const t6ShowsWeek1Total = /Week 1/.test(week1HTML) && /1:30/.test(week1HTML) && /Total Time/.test(week1HTML);
  console.log('Test 6 (switching to Week 1 via the picker shows week 1\'s own total and clears any selection):',
    t6ShowsWeek1Total ? 'PASS' : 'FAIL');

  // ---- Test 7: with only ONE real week of data, no week picker renders at all (nothing to switch
  // between) ----
  win.eval(`
    ACTIVITIES=ACTIVITIES.filter(a=>a.date!=='${week2Date}');
    ZONE_TREND_WK={hr:null,pace:null}; ZONE_TREND_SELIDX={hr:null,pace:null};
  `);
  const singleWeekHTML = win.eval(`zoneTimeTrendCardHTML()`);
  const t7NoPicker = !/selectZoneTrendWeek/.test(singleWeekHTML);
  console.log('Test 7 (only one real week of data means no week picker renders):',
    t7NoPicker ? 'PASS' : 'FAIL');

  // ---- Test 8: zoneTrendRangeLabel gives a real bpm range for HR zones (matching currentHRZones()
  // directly) and sensible open-ended/bounded pace ranges (Zone 1 slowest = open "X+/km", a middle
  // zone = bounded "fast-slow/km") ----
  const hrRangeMatches = win.eval(`
    (function(){
      const hz=currentHRZones();
      for(let i=0;i<hz.zones.length;i++){
        const expected = hz.zones[i].karvonen[0]+'-'+hz.zones[i].karvonen[1]+' bpm';
        if(zoneTrendRangeLabel('hr',i)!==expected) return false;
      }
      return true;
    })()
  `);
  const paceZone1Open = win.eval(`zoneTrendRangeLabel('pace',0)`);
  const paceZone4Bounded = win.eval(`zoneTrendRangeLabel('pace',3)`);
  const t8PaceOk = /\+\/km$/.test(paceZone1Open) && /^\d+:\d{2}-\d+:\d{2}\/km$/.test(paceZone4Bounded);
  console.log('Test 8 (zoneTrendRangeLabel gives real bpm ranges for HR, and open/bounded pace ranges):',
    (hrRangeMatches && t8PaceOk) ? 'PASS' : 'FAIL', { hrRangeMatches, paceZone1Open, paceZone4Bounded });

  // ---- Test 9: the real bug this round -- Dylon: "weekly zone level should be updated during the
  // week not after. once an activity is logged during that week it should show up." Week 3 (this
  // fixture's current, still-in-progress calendar week) has a session dated LATER this week (Sunday)
  // that hasn't happened yet -- under the OLD racePredWeeksElapsed()-based logic, that would keep the
  // whole week excluded from the trend until that future session's date passed. Log a real HR activity
  // TODAY (partway through week 3) and confirm it shows up in zoneTimeTrendWeeks() right away, not
  // after the week ends. ----
  win.eval(`
    DATA.push({id:'s3b',wk:3,ty:'easy',date:'${isoDaysAgo(todayMonday, -6)}',ph:'dur'});
    (function(){
      function stream(baseDate, hrVal, points, stepSec){
        const BASE_T = Date.parse(baseDate+'T06:00:00.000Z');
        const iso = (sec) => new Date(BASE_T + sec*1000).toISOString();
        const t = []; for(let i=0;i<points;i++) t.push(iso(i*stepSec));
        const hr = t.map(()=>hrVal);
        return {t, lat:[], lon:[], alt:[], distM:[], hr, cadence:[]};
      }
      addActivity({type:'run', date:'${today}', durationSec:120, distanceKm:0.4,
        stream: stream('${today}', 130, 10, 12), source:'import', role:'unplanned'});
    })();
  `);
  const t9Weeks = JSON.parse(win.eval(`JSON.stringify(zoneTimeTrendWeeks('hr',8,'all').map(w=>w.wk))`));
  console.log('Test 9 (an activity logged partway through the current, still-in-progress week shows up immediately, not after the week ends):',
    t9Weeks.includes(3) ? 'PASS' : 'FAIL', { t9Weeks, today, todayMonday });

  await wait(200);
  win.close();
})();
