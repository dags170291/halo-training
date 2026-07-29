// Regression test for Task 63 of the chart-redesign batch — best-effort weather/temperature
// backfill via Open-Meteo's free, keyless Historical Weather API, for files/devices with no
// temperature sensor of their own (most GPX exports, plenty of older TCX ones). Covers the parse
// of a canned Open-Meteo response, the "device reading always wins, never overwrite" rule, the
// automatic post-import backfill attempt, the manual "Add Weather" retry button, and the
// "(estimated)" label distinguishing a real device reading from a looked-up one.
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
      {id:'s1',wk:1,ty:'easy',date:'2026-07-01',ph:'dur',ti:'Easy Run'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-01'; BLOCK_END='2026-09-01';
    STATUS={}; NOTES={}; EXTRALOGS=[]; RACES_LIST=[]; ACTIVITIES=[];
  `);

  // A GPX-style activity: real GPS (lat/lon) but no temperature sensor reading at all -- exactly
  // the case Open-Meteo backfill exists for.
  const gpxFixture = {
    type: 'run', date: '2026-07-08', startTime: '06:00', durationSec: 600,
    distanceKm: 2, avgPace: '5:00', avgHr: 150, maxHr: 150,
    stream: { t: [new Date().toISOString()], lat: [45.5], lon: [-73.6], alt: [], distM: [0], hr: [150], cadence: [] },
    source: 'import', sourceFile: 'fixture.gpx', role: 'unplanned'
  };
  // A TCX-style activity where the device itself recorded temperature -- backfill must never run
  // for this one, since a real reading always wins over an estimate.
  const tcxWithTempFixture = JSON.parse(JSON.stringify(gpxFixture));
  tcxWithTempFixture.minTempC = 18; tcxWithTempFixture.maxTempC = 24;
  win.eval(`window.__gpxFixture = ${JSON.stringify(gpxFixture)}; window.__tcxWithTempFixture = ${JSON.stringify(tcxWithTempFixture)};`);

  // Test 1: fetchActivityWeather parses a canned Open-Meteo daily-min/max response into a rounded
  // {minC,maxC,source} object.
  win.eval(`
    window.fetch = async (url) => ({ ok: true, json: async () => ({ daily: { temperature_2m_max: [24.4], temperature_2m_min: [17.6] } }) });
  `);
  const t1 = JSON.parse(await win.eval(`(async()=>JSON.stringify(await fetchActivityWeather(window.__gpxFixture)))()`));
  console.log('Test 1 (fetchActivityWeather parses a canned Open-Meteo response into rounded min/max):',
    (t1 && t1.minC === 18 && t1.maxC === 24 && t1.source === 'open-meteo') ? 'PASS' : 'FAIL', { t1 });

  // Test 2: with no GPS at all (no lat/lon in the stream), fetchActivityWeather returns null
  // without ever calling fetch -- there's no coordinate to look up weather for.
  const noGpsFixture = JSON.parse(JSON.stringify(gpxFixture));
  noGpsFixture.stream.lat = []; noGpsFixture.stream.lon = [];
  win.eval(`window.__noGpsFixture = ${JSON.stringify(noGpsFixture)}; window.__fetchCalled = false; window.fetch = async () => { window.__fetchCalled = true; return { ok:true, json: async()=>({}) }; };`);
  const t2 = await win.eval(`(async()=>await fetchActivityWeather(window.__noGpsFixture))()`);
  const t2FetchCalled = win.eval(`window.__fetchCalled`);
  console.log('Test 2 (no GPS in the file means no lookup is even attempted):',
    (t2 === null && t2FetchCalled === false) ? 'PASS' : 'FAIL');

  // Test 3: fetchActivityWeather resolves to null (not throwing) on a failed/network-error fetch.
  win.eval(`window.fetch = async () => { throw new Error('offline'); };`);
  const t3 = await win.eval(`(async()=>await fetchActivityWeather(window.__gpxFixture))()`);
  console.log('Test 3 (a network failure resolves to null instead of throwing):', t3 === null ? 'PASS' : 'FAIL');

  // Test 4: backfillActivityWeatherIfNeeded never even calls fetch for an activity whose device
  // already recorded real temperature data -- an estimate must never override a real reading.
  win.eval(`window.__fetchCalled = false; window.fetch = async () => { window.__fetchCalled = true; return { ok:true, json: async()=>({daily:{temperature_2m_max:[99],temperature_2m_min:[99]}}) }; };`);
  win.eval(`backfillActivityWeatherIfNeeded(window.__tcxWithTempFixture);`);
  await wait(50);
  const t4FetchCalled = win.eval(`window.__fetchCalled`);
  console.log('Test 4 (a real device temperature reading is never overwritten by a backfill attempt):', t4FetchCalled === false ? 'PASS' : 'FAIL');

  // Test 5: the full automatic-backfill path -- an activity with no device temperature gets saved,
  // backfillActivityWeatherIfNeeded fires, and once the (mocked) fetch resolves, the saved
  // ACTIVITIES entry itself ends up with a.weather set.
  win.eval(`
    window.fetch = async (url) => ({ ok: true, json: async () => ({ daily: { temperature_2m_max: [22], temperature_2m_min: [15] } }) });
    window.__savedGpx = addActivity(window.__gpxFixture);
    backfillActivityWeatherIfNeeded(window.__savedGpx);
  `);
  await wait(50);
  const t5 = JSON.parse(win.eval(`JSON.stringify(ACTIVITIES.find(a => a.id === window.__savedGpx.id).weather)`));
  console.log('Test 5 (the automatic post-import backfill actually writes weather onto the saved activity):',
    (t5 && t5.minC === 15 && t5.maxC === 22) ? 'PASS' : 'FAIL', { t5 });

  // Test 6: activityStatRowsHTML shows the real device reading plainly, but marks a
  // weather-backfilled reading "(estimated)" so the two are never visually indistinguishable.
  const t6Device = win.eval(`activityStatRowsHTML(window.__tcxWithTempFixture)`);
  const t6Estimated = win.eval(`activityStatRowsHTML(ACTIVITIES.find(a => a.id === window.__savedGpx.id))`);
  console.log('Test 6 (a real device temperature reads plainly; a backfilled one is marked estimated):',
    (/18–24°C/.test(t6Device) && !/estimated/.test(t6Device) && /15–22°C \(estimated\)/.test(t6Estimated)) ? 'PASS' : 'FAIL');

  // Test 7: the detail popup offers an "Add Weather" retry button only while an activity has
  // neither a device reading nor an already-backfilled one; once weather is set, the button is
  // gone rather than offering a pointless re-lookup.
  win.eval(`
    ACTIVITIES=[]; STATUS={};
    window.__freshGpx = addActivity(window.__gpxFixture);
    openActivityDetail(window.__freshGpx.id);
  `);
  const t7Before = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  win.eval(`setActivityWeather(window.__freshGpx.id, {minC:10,maxC:20,source:'open-meteo'}); openActivityDetail(window.__freshGpx.id);`);
  const t7After = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  console.log('Test 7 (Add Weather button shows only until an activity actually has a weather value):',
    (/Add Weather/.test(t7Before) && !/Add Weather/.test(t7After)) ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
