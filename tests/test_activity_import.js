// Regression test for Phase 1 of ANALYTICS_ROADMAP.md — the TCX/GPX parser, the importActivityText()
// pipeline, and reusing the existing History feed as the "all activities, planned or not" Activity
// Feed (rather than building a separate view for it). Covers both file formats, the shared summary
// builder (distance/duration/avg HR/elevation gain/pace all derived from the raw stream), a
// namespaced-prefix GPX extension (gpxtpx:hr/gpxtpx:cad) despite the prefix, a bad-file error path,
// and the full import -> addActivity -> History-feed round trip.
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
        <Calories>150</Calories>
        <Track>
          <Trackpoint>
            <Time>2027-03-10T06:00:00.000-04:00</Time>
            <Position><LatitudeDegrees>10.65</LatitudeDegrees><LongitudeDegrees>-61.19</LongitudeDegrees></Position>
            <AltitudeMeters>70.0</AltitudeMeters>
            <DistanceMeters>0.0</DistanceMeters>
            <HeartRateBpm><Value>120</Value></HeartRateBpm>
          </Trackpoint>
          <Trackpoint>
            <Time>2027-03-10T06:05:00.000-04:00</Time>
            <Position><LatitudeDegrees>10.66</LatitudeDegrees><LongitudeDegrees>-61.20</LongitudeDegrees></Position>
            <AltitudeMeters>80.0</AltitudeMeters>
            <DistanceMeters>1000.0</DistanceMeters>
            <HeartRateBpm><Value>150</Value></HeartRateBpm>
          </Trackpoint>
          <Trackpoint>
            <Time>2027-03-10T06:10:00.000-04:00</Time>
            <Position><LatitudeDegrees>10.67</LatitudeDegrees><LongitudeDegrees>-61.21</LongitudeDegrees></Position>
            <AltitudeMeters>75.0</AltitudeMeters>
            <DistanceMeters>2000.0</DistanceMeters>
            <HeartRateBpm><Value>160</Value></HeartRateBpm>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk><name>Test Walk</name><type>walking</type>
    <trkseg>
      <trkpt lat="10.65" lon="-61.19"><ele>70.0</ele><time>2027-03-11T06:00:00Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>110</gpxtpx:hr><gpxtpx:cad>80</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
      <trkpt lat="10.6510" lon="-61.1910"><ele>72.0</ele><time>2027-03-11T06:01:00Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>115</gpxtpx:hr><gpxtpx:cad>82</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
  win.eval(`window.renderAll = function(){};`);

  // Test 1: parseTCXString reads Sport + a full 3-point stream (position/altitude/distance/HR).
  win.eval(`window.__tcxParsed = parseTCXString(${JSON.stringify(SAMPLE_TCX)});`);
  const tcxParsed = JSON.parse(win.eval(`JSON.stringify(window.__tcxParsed)`));
  const t1ok = tcxParsed.sport === 'running' && tcxParsed.stream.hr.length === 3 &&
    tcxParsed.stream.hr[2] === 160 && tcxParsed.stream.lat[1] === 10.66 && tcxParsed.stream.distM[2] === 2000;
  console.log('Test 1 (parseTCXString reads sport + full stream):', t1ok ? 'PASS' : 'FAIL');

  // Test 2: buildActivityFromParsed derives distance/duration/avg+max HR/pace/date correctly from that stream.
  const built = JSON.parse(win.eval(`JSON.stringify(buildActivityFromParsed(window.__tcxParsed,'test.tcx'))`));
  const t2ok = built.type === 'run' && built.distanceKm === 2 && built.durationSec === 600 &&
    built.avgHr === 143 && built.maxHr === 160 && built.date === '2027-03-10' && built.avgPace === '5:00';
  console.log('Test 2 (buildActivityFromParsed derives correct summary metrics):', t2ok ? 'PASS' : 'FAIL');

  // Test 3: parseGPXString reads a namespaced gpxtpx:hr/gpxtpx:cad extension despite the prefix, and
  // derives distance from consecutive GPS points via haversine (no native cumulative distance in GPX).
  win.eval(`window.__gpxParsed = parseGPXString(${JSON.stringify(SAMPLE_GPX)});`);
  const gpxParsed = JSON.parse(win.eval(`JSON.stringify(window.__gpxParsed)`));
  const t3ok = gpxParsed.sport === 'walking' && gpxParsed.stream.hr[0] === 110 && gpxParsed.stream.cadence[1] === 82 &&
    gpxParsed.stream.distM[1] > 0;
  console.log('Test 3 (parseGPXString reads namespaced hr/cad extensions + derives distance):', t3ok ? 'PASS' : 'FAIL');

  // Test 4: importActivityText auto-detects TCX by content and returns a ready-to-save draft.
  const tcxImport = JSON.parse(win.eval(`JSON.stringify(importActivityText(${JSON.stringify(SAMPLE_TCX)},'morning.tcx'))`));
  console.log('Test 4 (importActivityText auto-detects TCX and returns an unplanned draft):',
    (tcxImport.ok && tcxImport.activity.role === 'unplanned' && tcxImport.activity.source === 'import' && tcxImport.activity.distanceKm === 2) ? 'PASS' : 'FAIL');

  // Test 5: importActivityText auto-detects GPX by content.
  const gpxImport = JSON.parse(win.eval(`JSON.stringify(importActivityText(${JSON.stringify(SAMPLE_GPX)},'walk.gpx'))`));
  console.log('Test 5 (importActivityText auto-detects GPX):', (gpxImport.ok && gpxImport.activity.type === 'walk') ? 'PASS' : 'FAIL');

  // Test 6: an unrecognized file returns a plain-language error instead of throwing.
  const badImport = JSON.parse(win.eval(`JSON.stringify(importActivityText('not a real file','junk.txt'))`));
  console.log('Test 6 (unrecognized file returns ok:false with an error message):', (badImport.ok === false && !!badImport.error) ? 'PASS' : 'FAIL');

  // Test 7: full round trip — import -> addActivity -> shows up in historyItems()/matchesHistoryFilter
  // as an 'activity' kind, and logFeedItemHTML renders something sensible for it.
  win.eval(`
    const r = importActivityText(${JSON.stringify(SAMPLE_TCX)},'roundtrip.tcx');
    window.__savedActivity = addActivity(r.activity);
  `);
  const feedItems = JSON.parse(win.eval(`JSON.stringify(historyItems())`));
  const feedItem = feedItems.find((i) => win.eval(`window.__savedActivity.id`) === i.id);
  const matchesRun = win.eval(`matchesHistoryFilter(${JSON.stringify(feedItem)}, 'run')`);
  const feedHTML = win.eval(`logFeedItemHTML(${JSON.stringify(feedItem)})`);
  console.log('Test 7 (imported activity appears in History feed, matches "run" filter, renders HTML):',
    (feedItem && feedItem.kind === 'activity' && matchesRun && /2km|Imported|Run/.test(feedHTML)) ? 'PASS' : 'FAIL');

  // Test 8: deleteActivity removes it from ACTIVITIES and persists.
  win.eval(`deleteActivity(window.__savedActivity.id);`);
  const stillThere = win.eval(`ACTIVITIES.some(a=>a.id===window.__savedActivity.id)`);
  console.log('Test 8 (deleteActivity removes the activity):', stillThere === false ? 'PASS' : 'FAIL');

  // Test 9: a real reported gap — importing used to write straight to ACTIVITIES the instant a file
  // parsed. confirmActivityImport() must show a card WITHOUT saving anything yet.
  win.eval(`ACTIVITIES=[]; const r = importActivityText(${JSON.stringify(SAMPLE_TCX)},'confirm-test.tcx'); confirmActivityImport(r.activity);`);
  const cardHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  const t9NothingSavedYet = win.eval(`ACTIVITIES.length`) === 0;
  console.log('Test 9 (confirmActivityImport shows a card and saves nothing yet):',
    (t9NothingSavedYet && /id="import-name-input"/.test(cardHTML) && /2 km/.test(cardHTML)) ? 'PASS' : 'FAIL');

  // Test 10: tapping Import actually saves it, using whatever name was typed into the card.
  win.eval(`document.getElementById('import-name-input').value='Race Morning'; finalizeActivityImport();`);
  const t10 = win.eval(`ACTIVITIES.length===1 && ACTIVITIES[0].title==='Race Morning' ? ACTIVITIES[0].title : null`);
  console.log('Test 10 (finalizeActivityImport saves the activity with the entered name):', t10 === 'Race Morning' ? 'PASS' : 'FAIL');

  // Test 11: tapping Cancel discards the parsed draft — nothing gets saved.
  win.eval(`ACTIVITIES=[]; const r2 = importActivityText(${JSON.stringify(SAMPLE_TCX)},'cancel-test.tcx'); confirmActivityImport(r2.activity); cancelActivityImport();`);
  const t11 = win.eval(`ACTIVITIES.length===0 && PENDING_IMPORT_ACTIVITY===null`);
  console.log('Test 11 (cancelActivityImport discards the draft without saving):', t11 ? 'PASS' : 'FAIL');

  // Tests 12-14: a real reported gap — a file with no clear Sport label used to always default to
  // 'run', silently turning real walks into runs. inferActivityType() now falls back to average
  // speed (~6.5 km/h cutoff) only once the sport string itself gives no signal at all; an explicit
  // sport keyword still wins outright regardless of pace.
  const ambiguousTCX = (distM, durSec) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Other"><Id>2027-06-01T06:00:00.000-04:00</Id>
    <Lap StartTime="2027-06-01T06:00:00.000-04:00"><TotalTimeSeconds>${durSec}</TotalTimeSeconds>
      <DistanceMeters>${distM}</DistanceMeters>
      <Track>
        <Trackpoint><Time>2027-06-01T06:00:00.000-04:00</Time><DistanceMeters>0.0</DistanceMeters></Trackpoint>
        <Trackpoint><Time>2027-06-01T06:${String(Math.floor(durSec/60)).padStart(2,'0')}:${String(durSec%60).padStart(2,'0')}.000-04:00</Time><DistanceMeters>${distM}.0</DistanceMeters></Trackpoint>
      </Track>
    </Lap></Activity></Activities>
</TrainingCenterDatabase>`;

  // Test 12: ambiguous sport label ("Other") + slow pace (2.4km in 30 min = 4.8 km/h, real walking
  // speed) now infers 'walk' instead of defaulting to 'run'.
  const slowAmbiguous = JSON.parse(win.eval(`JSON.stringify(importActivityText(${JSON.stringify(ambiguousTCX(2400,1800))},'slow-ambiguous.tcx'))`));
  console.log('Test 12 (ambiguous sport + walking-pace speed infers walk, not run):',
    (slowAmbiguous.ok && slowAmbiguous.activity.type === 'walk') ? 'PASS' : 'FAIL', { type: slowAmbiguous.activity && slowAmbiguous.activity.type });

  // Test 13: ambiguous sport label + fast pace (5km in 25 min = 12 km/h, real running speed) still
  // correctly infers 'run' via the same speed fallback -- not everything ambiguous becomes a walk.
  const fastAmbiguous = JSON.parse(win.eval(`JSON.stringify(importActivityText(${JSON.stringify(ambiguousTCX(5000,1500))},'fast-ambiguous.tcx'))`));
  console.log('Test 13 (ambiguous sport + running-pace speed still infers run):',
    (fastAmbiguous.ok && fastAmbiguous.activity.type === 'run') ? 'PASS' : 'FAIL', { type: fastAmbiguous.activity && fastAmbiguous.activity.type });

  // Test 14: an explicit sport keyword always wins over the speed fallback -- a file honestly
  // labeled Sport="Walking" stays 'walk' even at a brisk race-walk pace (6km in 30 min = 12 km/h)
  // that would otherwise read as running speed.
  const explicitWalkTCX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Walking"><Id>2027-06-02T06:00:00.000-04:00</Id>
    <Lap StartTime="2027-06-02T06:00:00.000-04:00"><TotalTimeSeconds>1800.0</TotalTimeSeconds>
      <DistanceMeters>6000.0</DistanceMeters>
      <Track>
        <Trackpoint><Time>2027-06-02T06:00:00.000-04:00</Time><DistanceMeters>0.0</DistanceMeters></Trackpoint>
        <Trackpoint><Time>2027-06-02T06:30:00.000-04:00</Time><DistanceMeters>6000.0</DistanceMeters></Trackpoint>
      </Track>
    </Lap></Activity></Activities>
</TrainingCenterDatabase>`;
  const explicitWalk = JSON.parse(win.eval(`JSON.stringify(importActivityText(${JSON.stringify(explicitWalkTCX)},'explicit-walk-fast.tcx'))`));
  console.log('Test 14 (explicit Sport=Walking wins over the speed fallback even at a brisk pace):',
    (explicitWalk.ok && explicitWalk.activity.type === 'walk') ? 'PASS' : 'FAIL', { type: explicitWalk.activity && explicitWalk.activity.type });

  // ==== Real lap parsing from TCX (Task 69) -- a 3-lap interval workout: fast/slow/fast, one lap
  // with a device-provided AverageHeartRateBpm, two without (forcing the own-trackpoint-average
  // fallback), and a real altitude change on each lap for elevGainM. ====
  const SAMPLE_TCX_INTERVALS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Running"><Id>2027-03-10T06:00:00.000-04:00</Id>
    <Lap StartTime="2027-03-10T06:00:00.000-04:00">
      <TotalTimeSeconds>90.0</TotalTimeSeconds><DistanceMeters>400.0</DistanceMeters>
      <AverageHeartRateBpm><Value>200</Value></AverageHeartRateBpm>
      <Track>
        <Trackpoint><Time>2027-03-10T06:00:00.000-04:00</Time><AltitudeMeters>100.0</AltitudeMeters><DistanceMeters>0.0</DistanceMeters><HeartRateBpm><Value>160</Value></HeartRateBpm></Trackpoint>
        <Trackpoint><Time>2027-03-10T06:01:30.000-04:00</Time><AltitudeMeters>105.0</AltitudeMeters><DistanceMeters>400.0</DistanceMeters><HeartRateBpm><Value>170</Value></HeartRateBpm></Trackpoint>
      </Track>
    </Lap>
    <Lap StartTime="2027-03-10T06:01:30.000-04:00">
      <TotalTimeSeconds>120.0</TotalTimeSeconds><DistanceMeters>200.0</DistanceMeters>
      <Track>
        <Trackpoint><Time>2027-03-10T06:01:30.000-04:00</Time><AltitudeMeters>105.0</AltitudeMeters><DistanceMeters>400.0</DistanceMeters><HeartRateBpm><Value>130</Value></HeartRateBpm></Trackpoint>
        <Trackpoint><Time>2027-03-10T06:03:30.000-04:00</Time><AltitudeMeters>103.0</AltitudeMeters><DistanceMeters>600.0</DistanceMeters><HeartRateBpm><Value>140</Value></HeartRateBpm></Trackpoint>
      </Track>
    </Lap>
    <Lap StartTime="2027-03-10T06:03:30.000-04:00">
      <TotalTimeSeconds>92.0</TotalTimeSeconds><DistanceMeters>400.0</DistanceMeters>
      <Track>
        <Trackpoint><Time>2027-03-10T06:03:30.000-04:00</Time><AltitudeMeters>103.0</AltitudeMeters><DistanceMeters>600.0</DistanceMeters><HeartRateBpm><Value>168</Value></HeartRateBpm></Trackpoint>
        <Trackpoint><Time>2027-03-10T06:05:02.000-04:00</Time><AltitudeMeters>110.0</AltitudeMeters><DistanceMeters>1000.0</DistanceMeters><HeartRateBpm><Value>172</Value></HeartRateBpm></Trackpoint>
      </Track>
    </Lap>
  </Activity></Activities>
</TrainingCenterDatabase>`;
  win.eval(`window.__intervalsParsed = parseTCXString(${JSON.stringify(SAMPLE_TCX_INTERVALS)});`);
  const intervalsParsed = JSON.parse(win.eval(`JSON.stringify(window.__intervalsParsed)`));
  console.log('Test 15 (parseTCXString reads 3 real laps: device-provided avgHr on lap 1, derived-from-trackpoints on laps 2/3):',
    (intervalsParsed.laps.length === 3 &&
     intervalsParsed.laps[0].durSec === 90 && intervalsParsed.laps[0].distM === 400 && intervalsParsed.laps[0].avgHr === 200 && intervalsParsed.laps[0].elevGainM === 5 &&
     intervalsParsed.laps[1].avgHr === 135 && intervalsParsed.laps[1].elevGainM === 0 &&
     intervalsParsed.laps[2].avgHr === 170 && intervalsParsed.laps[2].elevGainM === 7) ? 'PASS' : 'FAIL', { laps: intervalsParsed.laps });

  // Test 16: buildActivityFromParsed carries the laps array straight through onto the activity draft.
  const intervalsBuilt = JSON.parse(win.eval(`JSON.stringify(buildActivityFromParsed(window.__intervalsParsed,'intervals.tcx'))`));
  console.log('Test 16 (buildActivityFromParsed carries the real laps array through to the draft):',
    (intervalsBuilt.laps && intervalsBuilt.laps.length === 3) ? 'PASS' : 'FAIL');

  // Test 17: a plain GPX import (no native lap concept at all) never gets a laps array -- confirms
  // the format-specific behavior rather than accidentally inventing laps for a file type that has no
  // real lap markers to read.
  const gpxImportNoLaps = JSON.parse(win.eval(`JSON.stringify(importActivityText(${JSON.stringify(SAMPLE_GPX)},'walk2.gpx'))`));
  console.log('Test 17 (a GPX import never has a laps array -- GPX has no native lap concept):',
    (!gpxImportNoLaps.activity.laps) ? 'PASS' : 'FAIL');

  // Test 18: Dylon -- "i tried to import a mobility session and it still identified it as a run." A
  // mobility/stretching session has no GPS distance at all, so it used to fall through every sport-
  // string check and the distance/duration speed check straight into the old blanket "return 'run'."
  // inferActivityType() now recognizes "mobility"/"stretch"/"flexib" sport strings directly, and a file
  // with truly no distance/duration signal at all falls back to 'workout' instead of guessing 'run'.
  console.log('Test 18a (a Sport="Stretching" label infers mobility, not run):',
    win.eval(`inferActivityType('Stretching',0,600)`) === 'mobility' ? 'PASS' : 'FAIL');
  console.log('Test 18b (a Sport="Mobility" label infers mobility):',
    win.eval(`inferActivityType('Mobility',0,900)`) === 'mobility' ? 'PASS' : 'FAIL');
  console.log('Test 18c (no sport match and no distance/duration signal falls back to workout, not run):',
    win.eval(`inferActivityType('Other',0,0)`) === 'workout' ? 'PASS' : 'FAIL');
  console.log('Test 18d (real distance/duration at a running pace still correctly infers run, unaffected by the fallback change):',
    win.eval(`inferActivityType('Other',5,1500)`) === 'run' ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
