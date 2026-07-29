// Regression test for FIT (Garmin's binary export format) import support -- the gap flagged in
// DEVELOPMENT.md/ANALYTICS_ROADMAP.md since Phase 1a shipped ("FIT isn't parsed -- only TCX/GPX"),
// picked as the next thing to build once Phase 3 shipped. Since there's no real .fit file bundled
// with this repo to parse, this test hand-constructs a small-but-structurally-real FIT binary (a
// Definition Message + 3 Data Messages for a `record` message stream, plus one `session` message and
// one `lap` message, each in their own local-message-type slot) using the exact same byte layout a
// real Garmin device's own encoder produces, and checks parseFITBuffer() decodes it back out
// correctly -- along with importActivityBinary()'s {ok,activity} wrapping, isFitBuffer()'s detection,
// and the full round trip into buildActivityFromParsed()'s summary fields.
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

// ── Minimal binary builders (Node Buffer, little-endian throughout, matching the FIT files a real
// device actually writes) ──
const u8 = (v) => { const b = Buffer.alloc(1); b.writeUInt8(v & 0xFF, 0); return b; };
const i8 = (v) => { const b = Buffer.alloc(1); b.writeInt8(v, 0); return b; };
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v, 0); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v, 0); return b; };
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v, 0); return b; };
const degToSemi = (deg) => Math.round(deg * Math.pow(2, 31) / 180);

const FIT_EPOCH_OFFSET_SEC = 631065600;
const startUnixSec = Math.floor(Date.UTC(2027, 4, 1, 6, 0, 0) / 1000); // 2027-05-01T06:00:00Z
const T0 = startUnixSec - FIT_EPOCH_OFFSET_SEC;
const T1 = T0 + 300, T2 = T0 + 600; // 5 min apart, matching test_activity_import.js's own TCX fixture

// Record Definition Message (local type 0, global msg 20 = record): 9 fields, in the same order
// buildActivityFromParsed's stream expects to read them back out in.
const recordFields = [
  [253, 4, 0x86], // timestamp, uint32
  [0, 4, 0x85],   // position_lat, sint32 (semicircles)
  [1, 4, 0x85],   // position_long, sint32
  [2, 2, 0x84],   // altitude, uint16 (scale 5, offset 500)
  [3, 1, 0x02],   // heart_rate, uint8
  [4, 1, 0x02],   // cadence, uint8
  [5, 4, 0x86],   // distance, uint32 (scale 100, cumulative meters)
  [7, 2, 0x84],   // power, uint16
  [13, 1, 0x01],  // temperature, sint8
];
const recordDef = Buffer.concat([
  u8(0x40), u8(0), u8(0), u16(20), u8(recordFields.length),
  ...recordFields.map(([num, size, bt]) => Buffer.concat([u8(num), u8(size), u8(bt)]))
]);
function recordData(ts, latDeg, lonDeg, altM, hr, cad, distM, power, tempC) {
  return Buffer.concat([
    u8(0x00), // data message, local type 0
    u32(ts), i32(degToSemi(latDeg)), i32(degToSemi(lonDeg)), u16((altM + 500) * 5),
    u8(hr), u8(cad), u32(Math.round(distM * 100)), u16(power), i8(tempC)
  ]);
}
const record1 = recordData(T0, 10.65, -61.19, 70, 120, 85, 0, 200, 18);
const record2 = recordData(T1, 10.66, -61.20, 80, 150, 88, 1000, 210, 19);
const record3 = recordData(T2, 10.67, -61.21, 75, 160, 90, 2000, 205, 18);

// Session Definition Message (local type 1, global msg 18 = session): total_calories + sport.
const sessionFields = [[11, 2, 0x84], [5, 1, 0x00]];
const sessionDef = Buffer.concat([
  u8(0x41), u8(0), u8(0), u16(18), u8(sessionFields.length),
  ...sessionFields.map(([num, size, bt]) => Buffer.concat([u8(num), u8(size), u8(bt)]))
]);
const sessionData = Buffer.concat([u8(0x01), u16(250), u8(1)]); // 250 kcal, sport=1 (running)

// Lap Definition Message (local type 2, global msg 19 = lap).
const lapFields = [[2, 4, 0x86], [7, 4, 0x86], [9, 4, 0x86], [16, 1, 0x02], [22, 2, 0x84]];
const lapDef = Buffer.concat([
  u8(0x42), u8(0), u8(0), u16(19), u8(lapFields.length),
  ...lapFields.map(([num, size, bt]) => Buffer.concat([u8(num), u8(size), u8(bt)]))
]);
const lapData = Buffer.concat([
  u8(0x02), u32(T0), u32(600000), u32(200000), u8(143), u16(10) // 600s elapsed, 2000m, avgHR 143, 10m ascent
]);

const body = Buffer.concat([recordDef, record1, record2, record3, sessionDef, sessionData, lapDef, lapData]);
const header = Buffer.concat([
  u8(14), u8(0x10), u16(2158), u32(body.length), Buffer.from('.FIT', 'ascii'), u16(0)
]);
const trailer = u16(0); // CRC -- parseFITBuffer deliberately doesn't validate it (see its own comment)
const fitBuffer = Buffer.concat([header, body, trailer]);
const fitBytes = Array.from(fitBuffer);

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
  win.eval(`window.renderAll = function(){};`);

  win.eval(`window.__fitBytes = ${JSON.stringify(fitBytes)};`);
  win.eval(`window.__fitBuf = new Uint8Array(window.__fitBytes).buffer;`);

  // ---- Test 1: isFitBuffer() detects a real FIT file both by extension and by sniffing the ".FIT"
  // signature when the extension is missing/wrong (same defensive spirit as TCX/GPX content-sniffing) ----
  const byExt = win.eval(`isFitBuffer(window.__fitBuf, 'watch_export.fit')`);
  const bySignatureOnly = win.eval(`isFitBuffer(window.__fitBuf, 'no_extension_at_all')`);
  const notFitText = win.eval(`isFitBuffer(new TextEncoder().encode('<gpx></gpx>').buffer, 'file.gpx')`);
  console.log('Test 1 (isFitBuffer detects FIT by extension and by signature, not a GPX buffer):',
    (byExt === true && bySignatureOnly === true && notFitText === false) ? 'PASS' : 'FAIL',
    { byExt, bySignatureOnly, notFitText });

  // ---- Test 2: parseFITBuffer decodes the 3 record points' stream fields correctly -- position
  // (semicircles -> degrees), altitude (scale 5 / offset 500), heart rate, cadence, cumulative
  // distance (scale 100), power, and temperature, plus a real ISO timestamp for each point ----
  const parsed = JSON.parse(win.eval(`JSON.stringify(parseFITBuffer(window.__fitBuf))`));
  const s = parsed.stream;
  const latOk = s.lat.every((v, i) => Math.abs(v - [10.65, 10.66, 10.67][i]) < 0.0001);
  const lonOk = s.lon.every((v, i) => Math.abs(v - [-61.19, -61.20, -61.21][i]) < 0.0001);
  const altOk = JSON.stringify(s.alt) === JSON.stringify([70, 80, 75]);
  const hrOk = JSON.stringify(s.hr) === JSON.stringify([120, 150, 160]);
  const cadOk = JSON.stringify(s.cadence) === JSON.stringify([85, 88, 90]);
  const distOk = JSON.stringify(s.distM) === JSON.stringify([0, 1000, 2000]);
  const powerOk = JSON.stringify(s.power) === JSON.stringify([200, 210, 205]);
  const tempOk = JSON.stringify(s.temp) === JSON.stringify([18, 19, 18]);
  const timeOk = s.t.length === 3 && s.t.every(t => !isNaN(new Date(t).getTime()));
  console.log('Test 2 (parseFITBuffer decodes record-message stream fields: position/alt/hr/cadence/distance/power/temp):', {
    latOk, lonOk, altOk, hrOk, cadOk, distOk, powerOk, tempOk, timeOk, stream: s,
    result: (latOk && lonOk && altOk && hrOk && cadOk && distOk && powerOk && tempOk && timeOk) ? 'PASS' : 'FAIL'
  });

  // ---- Test 3: session message feeds calories + a sport hint (mapped through FIT_SPORT_MAP) ----
  console.log('Test 3 (session message decodes calories and maps sport enum 1 to "running"):',
    (parsed.calories === 250 && parsed.sport === 'running') ? 'PASS' : 'FAIL', { calories: parsed.calories, sport: parsed.sport });

  // ---- Test 4: lap message decodes into the exact same {startTime,durSec,distM,avgHr,elevGainM}
  // shape parseTCXString's own laps array uses, so renderActivityLapsTable needs no FIT-specific
  // branching at all ----
  const lap = parsed.laps[0];
  console.log('Test 4 (lap message decodes into the same shape TCX laps use):',
    (parsed.laps.length === 1 && lap.durSec === 600 && lap.distM === 2000 && lap.avgHr === 143 && lap.elevGainM === 10 && !isNaN(new Date(lap.startTime).getTime())) ? 'PASS' : 'FAIL',
    { lap });

  // ---- Test 5: importActivityBinary() wraps parseFITBuffer through buildActivityFromParsed() exactly
  // like importActivityText() does for TCX/GPX -- real summary distance/duration/pace/avgHr, inferred
  // type 'run' (from the sport hint), and sourceFile set from the filename passed in ----
  const result = JSON.parse(win.eval(`JSON.stringify(importActivityBinary(window.__fitBuf, 'morning_run.fit'))`));
  console.log('Test 5 (importActivityBinary produces a real activity draft via buildActivityFromParsed):', {
    result,
    okResult: (result.ok === true && result.activity.type === 'run' && result.activity.distanceKm === 2 &&
      result.activity.durationSec === 600 && result.activity.avgHr === 143 && result.activity.sourceFile === 'morning_run.fit')
      ? 'PASS' : 'FAIL'
  });

  // ---- Test 6: a corrupted/non-FIT buffer returns {ok:false,error:...} instead of throwing, same
  // graceful-failure contract importActivityText already has for a bad TCX/GPX file ----
  const badResult = win.eval(`importActivityBinary(new Uint8Array([1,2,3,4,5]).buffer, 'broken.fit')`);
  console.log('Test 6 (importActivityBinary fails gracefully on a corrupted/too-small buffer):',
    (badResult && badResult.ok === false && typeof badResult.error === 'string') ? 'PASS' : 'FAIL', { badResult });

  // ---- Test 7: full round trip -- addActivity() with the FIT-derived draft persists it into
  // ACTIVITIES with its real stream intact (not just the summary fields), proving
  // buildActivityFromParsed's output really is format-agnostic all the way through normalizeActivityRecord ----
  win.eval(`
    ACTIVITIES=[];
    const r = importActivityBinary(window.__fitBuf, 'morning_run.fit');
    addActivity(r.activity);
  `);
  const savedCount = win.eval(`ACTIVITIES.length`);
  const savedStreamLen = win.eval(`ACTIVITIES[0].stream.hr.length`);
  const savedSourceFile = win.eval(`ACTIVITIES[0].sourceFile`);
  console.log('Test 7 (addActivity persists the FIT-imported activity with its real stream intact):',
    (savedCount === 1 && savedStreamLen === 3 && savedSourceFile === 'morning_run.fit') ? 'PASS' : 'FAIL',
    { savedCount, savedStreamLen, savedSourceFile });

  await wait(200);
  win.close();
})();
