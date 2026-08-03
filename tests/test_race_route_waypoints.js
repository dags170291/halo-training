// Regression test for the race route WAYPOINTS + "play the route" feature. Dylon, with a
// plotaroute.com route-VIEWER screenshot (numbered waypoint markers, an A/B marker, and a bottom
// play button + distance scrubber reading "0.383 / 5.109 km"): "is it possible to load markers and
// waypoints for the route as seen on the website and play the route as well like plotaroute?"
//
// Asked via AskUserQuestion how detailed the markers should be (simple named pins, chosen over trying
// to distinguish water-stop/aid-station/turn icon types since that "type" data is inconsistently
// populated across GPX/TCX/KML export tools) and how playback should work (Play/pause + animated
// marker + distance scrubber, chosen over a scrubber-only no-animation version).
//
// Waypoint sources, all newly added this round:
//   - GPX <wpt> (a standalone marker element, distinct from the <trk><trkseg><trkpt> track line)
//   - TCX <CoursePoint>, which ALSO required teaching parseTCXString to accept the Course schema
//     (<Courses><Course>) alongside the Activity schema (<Activities><Activity>) it only supported
//     before -- a real plotaroute.com/Garmin Connect TCX COURSE export uses the Course schema, which
//     used to be rejected outright with "No activity found in this TCX file" even though its own
//     <Trackpoint>/<Lap> elements are structurally identical to the Activity schema's.
//   - KML <Placemark><Point> (distinct from the route's own <Placemark><LineString>)
//   - FIT deliberately NOT covered -- its course_point message's exact field-number layout couldn't be
//     confirmed with real confidence, and this codebase's own convention is to never guess at silently
//     wrong data (see the ~-prefixed-distance and race/rest-day-swap bugs earlier this project). A FIT
//     route still gets its route line correctly; it just never carries named waypoints.
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

const GPX_WITH_WPT = `<?xml version="1.0"?>
<gpx version="1.1">
<wpt lat="10.6555" lon="-61.5025"><name>Water Station 1</name></wpt>
<wpt lat="10.6560" lon="-61.5030"><name>Mile 2</name></wpt>
<trk><name>Test Route</name><trkseg>
<trkpt lat="10.6549" lon="-61.5019"></trkpt>
<trkpt lat="10.6550" lon="-61.5020"></trkpt>
</trkseg></trk></gpx>`;

const TCX_COURSE = `<?xml version="1.0"?>
<TrainingCenterDatabase><Courses><Course><Name>Test Course</Name>
<Track>
<Trackpoint><Position><LatitudeDegrees>10.65</LatitudeDegrees><LongitudeDegrees>-61.50</LongitudeDegrees></Position></Trackpoint>
<Trackpoint><Position><LatitudeDegrees>10.66</LatitudeDegrees><LongitudeDegrees>-61.51</LongitudeDegrees></Position></Trackpoint>
</Track>
<CoursePoint><Name>Water Stop</Name><PointType>Water</PointType><Position><LatitudeDegrees>10.655</LatitudeDegrees><LongitudeDegrees>-61.505</LongitudeDegrees></Position></CoursePoint>
<CoursePoint><Name>Turn Right</Name><PointType>Right</PointType><Position><LatitudeDegrees>10.658</LatitudeDegrees><LongitudeDegrees>-61.508</LongitudeDegrees></Position></CoursePoint>
</Course></Courses></TrainingCenterDatabase>`;

const TCX_ACTIVITY = `<?xml version="1.0"?>
<TrainingCenterDatabase><Activities><Activity Sport="Running"><Lap StartTime="2026-01-01T00:00:00Z"><Track>
<Trackpoint><Position><LatitudeDegrees>10.65</LatitudeDegrees><LongitudeDegrees>-61.50</LongitudeDegrees></Position></Trackpoint>
<Trackpoint><Position><LatitudeDegrees>10.66</LatitudeDegrees><LongitudeDegrees>-61.51</LongitudeDegrees></Position></Trackpoint>
</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;

const TCX_NEITHER = `<?xml version="1.0"?><TrainingCenterDatabase><Folders></Folders></TrainingCenterDatabase>`;

const KML_WITH_PLACEMARK_POINTS = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Course</name><LineString><coordinates>
-61.5019,10.6549,0 -61.5020,10.6550,0 -61.5021,10.6551,0 -61.5022,10.6552,0
</coordinates></LineString></Placemark>
<Placemark><name>Aid Station 1</name><Point><coordinates>-61.5020,10.6550,0</coordinates></Point></Placemark>
<Placemark><name>Turn Left</name><Point><coordinates>-61.5021,10.6551,0</coordinates></Point></Placemark>
</Document></kml>`;

function toBuf(str) { return new TextEncoder().encode(str).buffer; }
function toWinBuf(win, varName, str) {
  win.eval(`window.${varName} = ${JSON.stringify(Array.from(new Uint8Array(toBuf(str))))};`);
  return `new Uint8Array(window.${varName}).buffer`;
}

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
  win.eval(`window.renderAll = function(){};`);

  // ---- Test 1: parseGPXString extracts <wpt> elements as waypoints (name + lat/lon), alongside the
  // existing <trkpt>-based track stream (unaffected). ----
  const gpxParsed = JSON.parse(win.eval(`JSON.stringify(parseGPXString(${JSON.stringify(GPX_WITH_WPT)}))`));
  const t1 = gpxParsed.stream.lat.length === 2
    && gpxParsed.waypoints.length === 2
    && gpxParsed.waypoints[0].name === 'Water Station 1' && gpxParsed.waypoints[0].lat === 10.6555 && gpxParsed.waypoints[0].lon === -61.5025
    && gpxParsed.waypoints[1].name === 'Mile 2';
  console.log('Test 1 (parseGPXString extracts <wpt> waypoints alongside the <trkpt> track):',
    t1 ? 'PASS' : 'FAIL', { waypoints: gpxParsed.waypoints, trackLen: gpxParsed.stream.lat.length });

  // ---- Test 2: parseTCXString accepts the Course schema (<Courses><Course>, no <Activities> at all)
  // instead of throwing "No activity found" -- the real gap a plotaroute.com/Garmin Connect TCX COURSE
  // export would have hit -- and extracts its <CoursePoint> elements as waypoints. ----
  const tcxCourseParsed = JSON.parse(win.eval(`JSON.stringify(parseTCXString(${JSON.stringify(TCX_COURSE)}))`));
  const t2 = tcxCourseParsed.stream.lat.length === 2
    && tcxCourseParsed.waypoints.length === 2
    && tcxCourseParsed.waypoints[0].name === 'Water Stop' && tcxCourseParsed.waypoints[0].lat === 10.655
    && tcxCourseParsed.waypoints[1].name === 'Turn Right';
  console.log('Test 2 (parseTCXString accepts Course-schema TCX and extracts CoursePoint waypoints):',
    t2 ? 'PASS' : 'FAIL', { waypoints: tcxCourseParsed.waypoints, trackLen: tcxCourseParsed.stream.lat.length });

  // ---- Test 3: parseTCXString on an ordinary Activity-schema TCX (a real recorded run, not a course)
  // still works exactly as before -- no CoursePoint means waypoints comes back as an empty array, not
  // undefined or an error. ----
  const tcxActivityParsed = JSON.parse(win.eval(`JSON.stringify(parseTCXString(${JSON.stringify(TCX_ACTIVITY)}))`));
  const t3 = tcxActivityParsed.stream.lat.length === 2 && Array.isArray(tcxActivityParsed.waypoints) && tcxActivityParsed.waypoints.length === 0;
  console.log('Test 3 (parseTCXString on a normal Activity-schema TCX still works, waypoints empty):',
    t3 ? 'PASS' : 'FAIL', { waypoints: tcxActivityParsed.waypoints });

  // ---- Test 4: parseTCXString still throws a clear error when there is genuinely neither an Activity
  // nor a Course in the file. ----
  const tcxNeitherErr = win.eval(`(function(){ try{ parseTCXString(${JSON.stringify(TCX_NEITHER)}); return 'no-throw'; }catch(e){ return e.message; } })()`);
  console.log('Test 4 (parseTCXString still throws when neither Activity nor Course is present):',
    /no activity or course/i.test(tcxNeitherErr) ? 'PASS' : 'FAIL', { tcxNeitherErr });

  // ---- Test 5: parseKMLString extracts <Placemark><Point> waypoints, correctly NOT counting the
  // route's own <Placemark><LineString> as one of them. ----
  const kmlParsed = JSON.parse(win.eval(`JSON.stringify(parseKMLString(${JSON.stringify(KML_WITH_PLACEMARK_POINTS)}))`));
  const t5 = kmlParsed.points.length === 4
    && kmlParsed.waypoints.length === 2
    && kmlParsed.waypoints[0].name === 'Aid Station 1' && kmlParsed.waypoints[0].lat === 10.6550 && kmlParsed.waypoints[0].lon === -61.5020
    && kmlParsed.waypoints[1].name === 'Turn Left';
  console.log('Test 5 (parseKMLString extracts Placemark/Point waypoints, not confusing them with the route LineString):',
    t5 ? 'PASS' : 'FAIL', { waypoints: kmlParsed.waypoints, routePoints: kmlParsed.points.length });

  // ---- Test 6: parseRaceRouteBuffer wires waypoints through end-to-end for all three text formats. ----
  const gpxBufExpr = toWinBuf(win, '__wgpxBuf', GPX_WITH_WPT);
  const gpxRoute = JSON.parse(win.eval(`JSON.stringify(parseRaceRouteBuffer(${gpxBufExpr},'course.gpx'))`));
  const tcxBufExpr = toWinBuf(win, '__wtcxBuf', TCX_COURSE);
  const tcxRoute = JSON.parse(win.eval(`JSON.stringify(parseRaceRouteBuffer(${tcxBufExpr},'course.tcx'))`));
  const kmlBufExpr = toWinBuf(win, '__wkmlBuf', KML_WITH_PLACEMARK_POINTS);
  const kmlRoute = JSON.parse(win.eval(`JSON.stringify(parseRaceRouteBuffer(${kmlBufExpr},'course.kml'))`));
  const t6 = gpxRoute.ok && gpxRoute.waypoints.length === 2
    && tcxRoute.ok && tcxRoute.waypoints.length === 2
    && kmlRoute.ok && kmlRoute.waypoints.length === 2;
  console.log('Test 6 (parseRaceRouteBuffer wires waypoints through for GPX/TCX/KML end-to-end):',
    t6 ? 'PASS' : 'FAIL', { gpxCount: gpxRoute.waypoints.length, tcxCount: tcxRoute.waypoints.length, kmlCount: kmlRoute.waypoints.length });

  // ---- Test 7: capWaypoints truncates an oversized waypoints array down to ROUTE_WAYPOINT_MAX,
  // keeping the first N in file order (not stride-sampled -- waypoints are already sparse and each one
  // is individually meaningful). ----
  win.eval(`window.__manyWps = Array.from({length:90},(_,i)=>({lat:i,lon:i,name:'wp'+i}));`);
  const capped = JSON.parse(win.eval(`JSON.stringify(capWaypoints(window.__manyWps))`));
  const maxAllowed = win.eval(`ROUTE_WAYPOINT_MAX`);
  const t7 = capped.length === maxAllowed && capped[0].name === 'wp0';
  console.log('Test 7 (capWaypoints truncates to ROUTE_WAYPOINT_MAX, keeping the first N in order):',
    t7 ? 'PASS' : 'FAIL', { cappedLen: capped.length, maxAllowed });

  // ---- Test 8: normalizeRaceRecord keeps well-formed routeWaypoints, filters out malformed entries
  // (missing lat/lon), and defaults a missing field to [] rather than null/undefined. ----
  const normWithWps = JSON.parse(win.eval(`JSON.stringify(normalizeRaceRecord({name:'T',date:'2026-09-01',routeWaypoints:[{lat:1,lon:1,name:'A'},{name:'Bad, no coords'},{lat:2,lon:2,name:'B'}]}))`));
  const normNoWps = JSON.parse(win.eval(`JSON.stringify(normalizeRaceRecord({name:'T2',date:'2026-09-01'}))`));
  const t8 = normWithWps.routeWaypoints.length === 2 && normWithWps.routeWaypoints[0].name === 'A' && Array.isArray(normNoWps.routeWaypoints) && normNoWps.routeWaypoints.length === 0;
  console.log('Test 8 (normalizeRaceRecord keeps valid waypoints, filters malformed ones, defaults to [] when absent):',
    t8 ? 'PASS' : 'FAIL', { normWithWps: normWithWps.routeWaypoints, normNoWps: normNoWps.routeWaypoints });

  // ---- Test 9: saving the Add/Edit Race form with RACE_ROUTE_PENDING.waypoints set (simulating a
  // successful file upload that included waypoints) persists routeWaypoints onto the new race record,
  // same pattern as test_race_route_import.js's Test 10 for routePoints/routeFileName. ----
  win.eval(`
    BLOCKS=[]; RACES_LIST=[]; ACTIVE_BLOCK_ID=null;
    startAddRace();
    document.getElementById('race-name').value='RBC Race for the Kids 5K';
    document.getElementById('race-date').value='2026-09-27';
    RACE_ROUTE_PENDING={points:[{lat:10.65,lon:-61.50},{lat:10.66,lon:-61.51}],fileName:'course.gpx',waypoints:[{lat:10.655,lon:-61.505,name:'Water Stop'}]};
    saveRaceForm();
  `);
  const savedRace = JSON.parse(win.eval(`JSON.stringify(RACES_LIST[0])`));
  const t9 = savedRace && savedRace.routeWaypoints && savedRace.routeWaypoints.length === 1 && savedRace.routeWaypoints[0].name === 'Water Stop';
  console.log('Test 9 (saving a new race with RACE_ROUTE_PENDING.waypoints set persists routeWaypoints):',
    t9 ? 'PASS' : 'FAIL', { savedRace: savedRace && savedRace.routeWaypoints });

  // ---- Test 10: removeRaceRouteFile() clears the pending waypoints too, not just points/fileName --
  // confirms Save reflects RACE_ROUTE_PENDING's current state for all three fields together. ----
  win.eval(`
    startEditRace('${JSON.parse(win.eval('JSON.stringify(RACES_LIST[0].key)'))}');
    removeRaceRouteFile();
    saveRaceForm();
  `);
  const afterRemove = JSON.parse(win.eval(`JSON.stringify(RACES_LIST[0])`));
  const t10 = afterRemove.routePoints === null && Array.isArray(afterRemove.routeWaypoints) && afterRemove.routeWaypoints.length === 0;
  console.log('Test 10 (removeRaceRouteFile clears pending waypoints too, not just points/fileName):',
    t10 ? 'PASS' : 'FAIL', { afterRemove: { routePoints: afterRemove.routePoints, routeWaypoints: afterRemove.routeWaypoints } });

  // ---- Test 11: re-opening the edit form for a race that already has saved waypoints pre-fills
  // RACE_ROUTE_PENDING.waypoints (not just .points/.fileName) from the race's own saved data. ----
  win.eval(`
    RACES_LIST[0].routePoints=[{lat:1,lon:1},{lat:2,lon:2}];
    RACES_LIST[0].routeFileName='saved-course.tcx';
    RACES_LIST[0].routeWaypoints=[{lat:1.5,lon:1.5,name:'Halfway'}];
    startEditRace(RACES_LIST[0].key);
  `);
  const pendingOnReopen = JSON.parse(win.eval(`JSON.stringify(RACE_ROUTE_PENDING)`));
  const statusText = win.eval(`document.getElementById('race-route-status').textContent`);
  const t11 = pendingOnReopen.waypoints && pendingOnReopen.waypoints.length === 1 && pendingOnReopen.waypoints[0].name === 'Halfway'
    && /1 waypoint/.test(statusText);
  console.log('Test 11 (re-opening the edit form pre-fills RACE_ROUTE_PENDING.waypoints and mentions the count in the status line):',
    t11 ? 'PASS' : 'FAIL', { pendingOnReopen, statusText });

  // ---- Test 12: renderRaceRouteMapHTML always includes the play/scrubber controls (hidden by default,
  // revealed later by initRaceRoutePlayer once the live map is up) for a race with a route, and shows
  // the waypoint-count badge only when routeWaypoints is non-empty. ----
  const mapWithWps = win.eval(`renderRaceRouteMapHTML(RACES_LIST[0],'strat-')`);
  win.eval(`RACES_LIST.push(normalizeRaceRecord({name:'Route No Waypoints',date:'2026-10-01',routePoints:[{lat:1,lon:1},{lat:2,lon:2}]}));`);
  const mapNoWps = win.eval(`renderRaceRouteMapHTML(RACES_LIST[1],'strat-')`);
  const t12 = mapWithWps.includes('id="strat-route-play-btn"') && mapWithWps.includes('id="strat-route-scrubber"') && mapWithWps.includes('id="strat-route-dist-label"')
    && mapWithWps.includes('1 waypoint')
    && !mapNoWps.includes('waypoint');
  console.log('Test 12 (renderRaceRouteMapHTML always includes play/scrubber controls, shows the waypoint badge only when there are waypoints):',
    t12 ? 'PASS' : 'FAIL');

  // ---- Test 13: positionAtDistance linearly interpolates a lat/lon position along a route at a given
  // cumulative distance -- the core "where is the marker right now" math the play animation and manual
  // scrubbing both share. Pure function, no Leaflet/DOM involved. ----
  const posStart = win.eval(`JSON.stringify(positionAtDistance([[0,0],[0,1]],[0,100],0))`);
  const posMid = win.eval(`JSON.stringify(positionAtDistance([[0,0],[0,1]],[0,100],50))`);
  const posEnd = win.eval(`JSON.stringify(positionAtDistance([[0,0],[0,1]],[0,100],999))`);
  const t13 = posStart === '[0,0]' && posMid === '[0,0.5]' && posEnd === '[0,1]';
  console.log('Test 13 (positionAtDistance interpolates start/mid/past-end positions correctly):',
    t13 ? 'PASS' : 'FAIL', { posStart, posMid, posEnd });

  // ---- Test 14: updateRaceRouteDistLabel formats the "X.XX / Y.YY km" readout, matching the
  // plotaroute-style "0.383 / 5.109 km" display the screenshot showed (rounded to 2 decimals here). ----
  win.eval(`document.body.insertAdjacentHTML('beforeend','<span id="t14-route-dist-label"></span>');`);
  win.eval(`updateRaceRouteDistLabel('t14-',383,5109)`);
  const labelText = win.eval(`document.getElementById('t14-route-dist-label').textContent`);
  const t14 = labelText === '0.38 / 5.11 km';
  console.log('Test 14 (updateRaceRouteDistLabel formats the distance readout as "X.XX / Y.YY km"):',
    t14 ? 'PASS' : 'FAIL', { labelText });

  // ---- Test 15: raceAvgPaceSecPerKm averages targetMin/targetMax (fast/slow) the same way
  // raceStrategyStepsFor already does, divided by the race's own recognized distance. ----
  const paceFromTarget = win.eval(`raceAvgPaceSecPerKm({distance:'5K',targetMin:'25:00',targetMax:'27:30'})`);
  // (25:00+27:30)/2 = 26:15 = 1575s over 5km = 315s/km
  const t15 = Math.abs(paceFromTarget - 315) < 0.01;
  console.log('Test 15 (raceAvgPaceSecPerKm averages targetMin/targetMax over the race distance):',
    t15 ? 'PASS' : 'FAIL', { paceFromTarget });

  // ---- Test 16: with no target set, raceAvgPaceSecPerKm falls back to a completed race's own
  // actualTime instead -- e.g. for looking back at how a past race's route played out. ----
  const paceFromActual = win.eval(`raceAvgPaceSecPerKm({distance:'10K',status:'done',actualTime:'50:00'})`);
  const t16 = Math.abs(paceFromActual - 300) < 0.01; // 50:00 / 10km = 300s/km = 5:00/km
  console.log('Test 16 (raceAvgPaceSecPerKm falls back to actualTime when no target is set):',
    t16 ? 'PASS' : 'FAIL', { paceFromActual });

  // ---- Test 17: with no recognizable distance at all, raceAvgPaceSecPerKm returns null rather than
  // guessing or dividing by a bogus number. ----
  const paceNoDistance = win.eval(`raceAvgPaceSecPerKm({targetMin:'25:00'})`);
  console.log('Test 17 (raceAvgPaceSecPerKm returns null with no recognizable race distance):',
    paceNoDistance === null ? 'PASS' : 'FAIL', { paceNoDistance });

  // ---- Test 18: raceRouteBaseDurationMs derives the route-player's animation length from pace --
  // Dylon: "add the ability to speed up the video based on running pace." A faster pace over the same
  // distance means less real running time, so it should produce a SHORTER base animation than a slower
  // pace over that same distance; with no pace data at all it falls back to the flat default; and
  // extreme values clamp into [MIN,MAX] rather than producing an unwatchably short or long animation. ----
  const durFastPace = win.eval(`raceRouteBaseDurationMs(240, 5000)`);  // 4:00/km over 5km = 1200s real
  const durSlowPace = win.eval(`raceRouteBaseDurationMs(360, 5000)`);  // 6:00/km over 5km = 1800s real
  const durNoData = win.eval(`raceRouteBaseDurationMs(null, 5000)`);
  const durExtreme = win.eval(`raceRouteBaseDurationMs(1200, 100000)`); // ultra-long+slow -> should clamp to MAX
  const minMs = win.eval(`RACE_ROUTE_MIN_DURATION_MS`), maxMs = win.eval(`RACE_ROUTE_MAX_DURATION_MS`), fallbackMs = win.eval(`RACE_ROUTE_BASE_DURATION_MS`);
  const t18 = durFastPace < durSlowPace && durNoData === fallbackMs && durExtreme === maxMs && durFastPace >= minMs && durSlowPace <= maxMs;
  console.log('Test 18 (raceRouteBaseDurationMs: faster pace -> shorter animation, no data -> flat fallback, extremes clamp):',
    t18 ? 'PASS' : 'FAIL', { durFastPace, durSlowPace, durNoData, durExtreme, minMs, maxMs, fallbackMs });

  // ---- Test 19: setRaceRouteSpeed updates RACE_ROUTE_PLAYER's speed and the three speed buttons'
  // active styling -- tested directly against a hand-seeded player/DOM (bypassing the Leaflet-dependent
  // initRaceRoutePlayer, same as positionAtDistance/updateRaceRouteDistLabel above, since Leaflet's CDN
  // script never loads in this offline test harness). ----
  win.eval(`
    document.body.insertAdjacentHTML('beforeend','<button id="t19-route-speed-1"></button><button id="t19-route-speed-2"></button><button id="t19-route-speed-4"></button>');
    RACE_ROUTE_PLAYER={idPrefix:'t19-',speed:1,playing:false,currentDistM:0,playStartDist:0,playStartTs:0};
    setRaceRouteSpeed('t19-',4);
  `);
  const speedAfter = win.eval(`RACE_ROUTE_PLAYER.speed`);
  const btn4Bg = win.eval(`document.getElementById('t19-route-speed-4').style.background`);
  const btn1Bg = win.eval(`document.getElementById('t19-route-speed-1').style.background`);
  const t19 = speedAfter === 4 && btn4Bg === 'var(--accent)' && btn1Bg === 'var(--s2)';
  console.log('Test 19 (setRaceRouteSpeed updates player speed and highlights the active speed button):',
    t19 ? 'PASS' : 'FAIL', { speedAfter, btn4Bg, btn1Bg });

  // ---- Test 20: renderRaceRouteMapHTML includes the three speed buttons alongside the play/scrubber
  // controls tested in Test 12. ----
  const mapWithSpeed = win.eval(`renderRaceRouteMapHTML(RACES_LIST[0],'strat-')`);
  const t20 = mapWithSpeed.includes('id="strat-route-speed-1"') && mapWithSpeed.includes('id="strat-route-speed-2"') && mapWithSpeed.includes('id="strat-route-speed-4"');
  console.log('Test 20 (renderRaceRouteMapHTML includes the 1x/2x/4x speed buttons):',
    t20 ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
