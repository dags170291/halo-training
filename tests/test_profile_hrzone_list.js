// Regression test for Profile's Heart Rate Zones card reverting to a plain static list (v0.32.34),
// after two chart iterations (bars -> pie -> Strava-style donut, see test_hrzone_pie_chart.js's own
// header comment for that history). Dylon: "the zones in the profile stay stagnant and the one in
// the activities are more catered for a pie chart feature" -- so the interactive donut moved to the
// per-activity zone breakdown (real time-in-zone data), and Profile went back to a list closer to
// Strava's own Training Zones *settings* page: a vertical color bar per row, the zone's name/type,
// and its bpm range with the open ends read as "Rest"/"Max" rather than raw numbers, ordered Zone 5
// (highest) at the top down to Zone 1 at the bottom. Shortly after, Dylon: "I liked how you had what
// each zone is meant for previously, so if you could include that again, perhaps under the heart-
// rate zone in the profile" -- each zone's "best for" text (dropped by the original bars-to-list
// rewrite, never actually removed on purpose) is back underneath its name/range row (Test 4b).
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
    PROFILE.savedHRZones = {
      maxHR: 188, rhr: 55, hrr: 133, method: 'karvonen', savedAt: '2026-07-29',
      zones: [
        {key:'z1',label:'Zone 1',name:'Recovery',use:'Warm-ups, cool-downs, active recovery days',
         karvonen:[122,135], pctmax:[94,113], zoladz:[128,138]},
        {key:'z2',label:'Zone 2',name:'Aerobic / Endurance',use:'Easy/base mileage — most of your weekly running belongs here',
         karvonen:[135,148], pctmax:[113,132], zoladz:[138,148]},
        {key:'z3',label:'Zone 3',name:'Tempo',use:'Tempo runs, marathon-pace efforts',
         karvonen:[148,161], pctmax:[132,150], zoladz:[148,158]},
        {key:'z4',label:'Zone 4',name:'Threshold',use:'Intervals, hill repeats, 10K-pace work',
         karvonen:[161,175], pctmax:[150,169], zoladz:[158,168]},
        {key:'z5',label:'Zone 5',name:'Maximum',use:'Sprints, VO2 max work, race finishes',
         karvonen:[175,188], pctmax:[169,188], zoladz:[168,188]}
      ]
    };
  `);

  const cardHTML = win.eval(`profileHRZonesCardHTML()`);

  // ---- Test 1: no interactive chart markup at all -- no donut wrap, no chip row, no callout, no
  // onclick handlers -- confirming this really is a plain static list now ----
  console.log('Test 1 (no donut/chip/callout markup -- a plain static list, not the interactive chart):', {
    hasDonut: /hrzone-donut-wrap/.test(cardHTML), hasChip: /hrzone-chip/.test(cardHTML), hasCallout: /hrzone-callout/.test(cardHTML), hasOnclick: /onclick="select/.test(cardHTML),
    result: (!/hrzone-donut-wrap/.test(cardHTML) && !/hrzone-chip/.test(cardHTML) && !/hrzone-callout/.test(cardHTML) && !/onclick="select/.test(cardHTML)) ? 'PASS' : 'FAIL'
  });

  // ---- Test 2: zones are listed highest to lowest (Zone 5 first, Zone 1 last), matching Strava's
  // own Training Zones settings page ordering ----
  const zone5Pos = cardHTML.indexOf('Zone 5');
  const zone1Pos = cardHTML.indexOf('Zone 1');
  console.log('Test 2 (zones listed Zone 5 -> Zone 1, highest first):', {
    zone5Pos, zone1Pos, result: (zone5Pos>=0 && zone1Pos>zone5Pos) ? 'PASS' : 'FAIL'
  });

  // ---- Test 3: the open ends of the whole range read as "Rest" (below Zone 1's floor) and "Max"
  // (above Zone 5's ceiling) rather than raw numbers, matching Strava's own "Rest - 120"/"180 - Max"
  // labeling; every zone in between shows real numbers on both sides ----
  console.log('Test 3 (open ends read as Rest/Max; every other zone shows real numbers both sides):', {
    hasRest: /Rest - 135/.test(cardHTML), hasMax: /175 - Max/.test(cardHTML), hasMidZone: /148 - 161/.test(cardHTML),
    noNumericRestFloor: !/122 - 135/.test(cardHTML), noNumericMaxCeiling: !/175 - 188/.test(cardHTML),
    result: (/Rest - 135/.test(cardHTML) && /175 - Max/.test(cardHTML) && /148 - 161/.test(cardHTML) && !/122 - 135/.test(cardHTML) && !/175 - 188/.test(cardHTML)) ? 'PASS' : 'FAIL'
  });

  // ---- Test 4: each zone row is colored with the same ZONE_TREND_BAR_COLORS ramp every previous
  // version of this chart used, by its own index (not the display order) -- Zone 1 = index 0 =
  // first color, Zone 5 = index 4 = fifth color ----
  const expectedColors = JSON.parse(win.eval(`JSON.stringify(ZONE_TREND_BAR_COLORS.slice(0,5))`));
  const hasZone1Color = cardHTML.includes(`background:var(${expectedColors[0]})`);
  const hasZone5Color = cardHTML.includes(`background:var(${expectedColors[4]})`);
  console.log('Test 4 (each zone bar colored 1:1 with ZONE_TREND_BAR_COLORS by its own zone index):', {
    expectedColors, hasZone1Color, hasZone5Color,
    result: (hasZone1Color && hasZone5Color) ? 'PASS' : 'FAIL'
  });

  // ---- Test 4b: each zone's "best for" text (dropped when the list was first built, then Dylon:
  // "I liked how you had what each zone is meant for previously, so if you could include that
  // again, perhaps under the heart-rate zone in the profile") is back, shown under that zone's own
  // name/range row ----
  console.log('Test 4b (each zone shows its own best-for/use text under its row):', {
    hasZone1Use: /Warm-ups, cool-downs, active recovery days/.test(cardHTML),
    hasZone5Use: /Sprints, VO2 max work, race finishes/.test(cardHTML),
    result: (/Warm-ups, cool-downs, active recovery days/.test(cardHTML) && /Sprints, VO2 max work, race finishes/.test(cardHTML)) ? 'PASS' : 'FAIL'
  });

  // ---- Test 5: Recalculate button present, and the empty state (no saved zones) is untouched --
  // still the original prompt/button, no list markup ----
  win.eval(`PROFILE={};`);
  const emptyHTML = win.eval(`profileHRZonesCardHTML()`);
  console.log('Test 5 (Recalculate present when saved; empty state unchanged with nothing saved):', {
    hasRecalculate: /Recalculate/.test(cardHTML),
    emptyHasPrompt: /Not set up yet/.test(emptyHTML), emptyHasButton: /Calculate Heart Rate Zones/.test(emptyHTML), emptyHasZoneRow: /Zone 1/.test(emptyHTML),
    result: (/Recalculate/.test(cardHTML) && /Not set up yet/.test(emptyHTML) && /Calculate Heart Rate Zones/.test(emptyHTML) && !/Zone 1/.test(emptyHTML)) ? 'PASS' : 'FAIL'
  });

  await wait(200);
  win.close();
})();
