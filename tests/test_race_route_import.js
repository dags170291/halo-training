// Regression test for the race route file import feature. Dylon, with a plotaroute.com course-download
// screenshot: "I will like to add a feature to import maps via gpx, Fit, tcx, KML files for races and
// show the race route in the app within the race card." Asked via AskUserQuestion where the map should
// show (Races page card + Race Day Strategy view, both recommended and chosen) and how upload should
// work (a new field in the Add/Edit Race form, also recommended and chosen).
//
// GPX/TCX/FIT parsing is reused as-is from the existing activity-import parsers (parseGPXString/
// parseTCXString/parseFITBuffer) via a new extractRoutePoints() that just pulls the lat/lon polyline
// back out of their stream shape -- this file's own new parsing logic is really only parseKMLString
// (KML has no existing parser anywhere in the app) and parseRaceRouteBuffer's format-sniffing/routing.
// routePoints is stored directly on the race record (normalizeRaceRecord), read by raceRouteSVG (the
// static thumbnail used on both the Races page card and as the Race Day Strategy view's offline
// fallback) and initRaceRouteLiveMap (the Leaflet map, Race Day Strategy view only -- the Races list
// deliberately stays static-thumbnail-only, since it can show many race cards at once).
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

const GPX_TEXT = `<?xml version="1.0"?>
<gpx version="1.1"><trk><name>Test Route</name><trkseg>
<trkpt lat="10.6549" lon="-61.5019"></trkpt>
<trkpt lat="10.6550" lon="-61.5020"></trkpt>
<trkpt lat="10.6551" lon="-61.5021"></trkpt>
</trkseg></trk></gpx>`;

const TCX_TEXT = `<?xml version="1.0"?>
<TrainingCenterDatabase><Activities><Activity Sport="Running"><Lap StartTime="2026-01-01T00:00:00Z"><Track>
<Trackpoint><Position><LatitudeDegrees>10.65</LatitudeDegrees><LongitudeDegrees>-61.50</LongitudeDegrees></Position></Trackpoint>
<Trackpoint><Position><LatitudeDegrees>10.66</LatitudeDegrees><LongitudeDegrees>-61.51</LongitudeDegrees></Position></Trackpoint>
</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;

const KML_TEXT = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Spur</name><LineString><coordinates>-61.5010,10.6510,0 -61.5011,10.6511,0</coordinates></LineString></Placemark>
<Placemark><name>Course</name><LineString><coordinates>
-61.5019,10.6549,0 -61.5020,10.6550,0 -61.5021,10.6551,0 -61.5022,10.6552,0
</coordinates></LineString></Placemark>
</Document></kml>`;

function toBuf(str) { return new TextEncoder().encode(str).buffer; }

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
  win.eval(`window.renderAll = function(){};`);

  // ---- Test 1: parseKMLString picks the LineString with the most points (the real course, not a
  // short spur), returning {lat,lon} pairs correctly de-swizzled from KML's lon,lat coordinate order. ----
  const kmlResult = JSON.parse(win.eval(`JSON.stringify(parseKMLString(${JSON.stringify(KML_TEXT)}))`));
  const t1 = kmlResult.length === 4 && kmlResult[0].lat === 10.6549 && kmlResult[0].lon === -61.5019;
  console.log('Test 1 (parseKMLString picks the longest LineString and de-swizzles lon,lat -> {lat,lon}):',
    t1 ? 'PASS' : 'FAIL', { kmlResult });

  // ---- Test 2: parseKMLString throws a helpful error on a file with no LineString at all. ----
  const t2 = win.eval(`(function(){ try{ parseKMLString('<kml><Document></Document></kml>'); return 'no-throw'; }catch(e){ return e.message; } })()`);
  console.log('Test 2 (parseKMLString throws a helpful error when there is no route track):',
    /no route track/i.test(t2) ? 'PASS' : 'FAIL', { t2 });

  // ---- Test 3: parseRaceRouteBuffer correctly routes a GPX buffer through the existing GPX parser
  // (reused as-is, not reimplemented) and returns a real points array. ----
  win.eval(`window.__gpxBuf = ${JSON.stringify(Array.from(new Uint8Array(toBuf(GPX_TEXT))))};`);
  const gpxParse = JSON.parse(win.eval(`JSON.stringify(parseRaceRouteBuffer(new Uint8Array(window.__gpxBuf).buffer,'course.gpx'))`));
  const t3 = gpxParse.ok && gpxParse.points.length === 3 && gpxParse.points[0].lat === 10.6549;
  console.log('Test 3 (parseRaceRouteBuffer routes GPX through the existing parser):', t3 ? 'PASS' : 'FAIL', { gpxParse });

  // ---- Test 4: parseRaceRouteBuffer correctly routes a TCX buffer, same reuse. ----
  win.eval(`window.__tcxBuf = ${JSON.stringify(Array.from(new Uint8Array(toBuf(TCX_TEXT))))};`);
  const tcxParse = JSON.parse(win.eval(`JSON.stringify(parseRaceRouteBuffer(new Uint8Array(window.__tcxBuf).buffer,'course.tcx'))`));
  const t4 = tcxParse.ok && tcxParse.points.length === 2 && tcxParse.points[1].lat === 10.66;
  console.log('Test 4 (parseRaceRouteBuffer routes TCX through the existing parser):', t4 ? 'PASS' : 'FAIL', { tcxParse });

  // ---- Test 5: parseRaceRouteBuffer correctly routes a KML buffer to the new KML parser. ----
  win.eval(`window.__kmlBuf = ${JSON.stringify(Array.from(new Uint8Array(toBuf(KML_TEXT))))};`);
  const kmlParse = JSON.parse(win.eval(`JSON.stringify(parseRaceRouteBuffer(new Uint8Array(window.__kmlBuf).buffer,'course.kml'))`));
  const t5 = kmlParse.ok && kmlParse.points.length === 4;
  console.log('Test 5 (parseRaceRouteBuffer routes KML to the new parser):', t5 ? 'PASS' : 'FAIL', { kmlParse });

  // ---- Test 6: an unrecognized file format returns a clear {ok:false,error}, not a thrown exception. ----
  win.eval(`window.__badBuf = ${JSON.stringify(Array.from(new Uint8Array(toBuf('not a route file at all'))))};`);
  const badParse = JSON.parse(win.eval(`JSON.stringify(parseRaceRouteBuffer(new Uint8Array(window.__badBuf).buffer,'notes.txt'))`));
  console.log('Test 6 (an unrecognized file format returns a clear ok:false error):',
    (badParse.ok===false && /gpx.*tcx.*fit.*kml/i.test(badParse.error)) ? 'PASS' : 'FAIL', { badParse });

  // ---- Test 7: extractRoutePoints downsamples a long stream to ROUTE_MAP_MAX_POINTS, always keeping
  // the true first and last point (same stride technique activityRoutePointsColored already uses). ----
  win.eval(`
    const n=850;
    const lat=[], lon=[];
    for(let i=0;i<n;i++){ lat.push(10+i*0.0001); lon.push(-61-i*0.0001); }
    window.__longStream={lat,lon};
  `);
  const downsampled = JSON.parse(win.eval(`JSON.stringify(extractRoutePoints(window.__longStream))`));
  const t7 = downsampled.length <= 300 && downsampled.length > 2
    && downsampled[0].lat === 10 && downsampled[downsampled.length-1].lat === 10+849*0.0001;
  console.log('Test 7 (extractRoutePoints downsamples a long stream but keeps the true first/last point):',
    t7 ? 'PASS' : 'FAIL', { count: downsampled.length });

  // ---- Test 8: normalizeRaceRecord keeps a real multi-point routePoints array, but discards a
  // degenerate one (0 or 1 points) back to null rather than storing a useless "route" that can't draw
  // a line. ----
  const normWithRoute = JSON.parse(win.eval(`JSON.stringify(normalizeRaceRecord({name:'Test',date:'2026-09-01',routePoints:[{lat:1,lon:1},{lat:2,lon:2}],routeFileName:'course.gpx'}))`));
  const normNoRoute = JSON.parse(win.eval(`JSON.stringify(normalizeRaceRecord({name:'Test2',date:'2026-09-01',routePoints:[{lat:1,lon:1}]}))`));
  const t8 = normWithRoute.routePoints.length === 2 && normWithRoute.routeFileName === 'course.gpx' && normNoRoute.routePoints === null;
  console.log('Test 8 (normalizeRaceRecord keeps a real route, discards a degenerate 1-point one back to null):',
    t8 ? 'PASS' : 'FAIL', { normWithRoute, normNoRoute });

  // ---- Test 9: raceRouteSVG returns null for fewer than 2 points, and a real <svg>...<path>...</svg>
  // string (with start/finish dots) for a valid route. ----
  const svgNull = win.eval(`raceRouteSVG([{lat:1,lon:1}])`);
  const svgReal = win.eval(`raceRouteSVG([{lat:10.65,lon:-61.50},{lat:10.66,lon:-61.51},{lat:10.67,lon:-61.52}],120)`);
  const t9 = svgNull === null && typeof svgReal === 'string' && svgReal.includes('<svg') && svgReal.includes('<path') && (svgReal.match(/<circle/g)||[]).length === 2;
  console.log('Test 9 (raceRouteSVG returns null for <2 points, a real SVG with 2 start/finish dots otherwise):',
    t9 ? 'PASS' : 'FAIL', { svgNull, hasPath: svgReal && svgReal.includes('<path') });

  // ---- Test 10: saving the Add/Edit Race form with RACE_ROUTE_PENDING set (simulating a successful
  // file upload -- handleRaceRouteFile's own async FileReader isn't practical to drive directly in this
  // harness, but it does nothing more than call parseRaceRouteBuffer, already covered by Tests 3-6,
  // and set this exact global) actually persists routePoints/routeFileName onto the new race record. ----
  win.eval(`
    BLOCKS=[]; RACES_LIST=[]; ACTIVE_BLOCK_ID=null;
    startAddRace();
    document.getElementById('race-name').value='RBC Race for the Kids 5K';
    document.getElementById('race-date').value='2026-09-27';
    RACE_ROUTE_PENDING={points:[{lat:10.65,lon:-61.50},{lat:10.66,lon:-61.51},{lat:10.67,lon:-61.52}],fileName:'RBC RFTK 2026 5K.gpx'};
    saveRaceForm();
  `);
  const savedRace = JSON.parse(win.eval(`JSON.stringify(RACES_LIST[0])`));
  const t10 = savedRace && savedRace.routePoints && savedRace.routePoints.length === 3 && savedRace.routeFileName === 'RBC RFTK 2026 5K.gpx';
  console.log('Test 10 (saving a new race with RACE_ROUTE_PENDING set persists routePoints/routeFileName):',
    t10 ? 'PASS' : 'FAIL', { savedRace });

  // ---- Test 11: editing that same race and calling removeRaceRouteFile() (the "Remove Route File"
  // button) before saving clears routePoints/routeFileName back to null/'' -- confirms Save always
  // reflects RACE_ROUTE_PENDING's CURRENT state, not just whatever a file upload set it to earlier. ----
  win.eval(`
    startEditRace('${JSON.parse(win.eval('JSON.stringify(RACES_LIST[0].key)'))}');
    removeRaceRouteFile();
    saveRaceForm();
  `);
  const afterRemove = JSON.parse(win.eval(`JSON.stringify(RACES_LIST[0])`));
  const t11 = afterRemove.routePoints === null && afterRemove.routeFileName === '';
  console.log('Test 11 (removing the route file before saving clears routePoints/routeFileName):',
    t11 ? 'PASS' : 'FAIL', { afterRemove });

  // ---- Test 12: re-editing a race that already has a route pre-fills RACE_ROUTE_PENDING (and
  // therefore the form's status line) from the race's own saved data, not a blank slate -- opening the
  // edit form should never look like the route was never uploaded when it actually was. ----
  win.eval(`
    RACES_LIST[0].routePoints=[{lat:1,lon:1},{lat:2,lon:2}];
    RACES_LIST[0].routeFileName='saved-course.tcx';
    startEditRace(RACES_LIST[0].key);
  `);
  const pendingOnReopen = JSON.parse(win.eval(`JSON.stringify(RACE_ROUTE_PENDING)`));
  const statusText = win.eval(`document.getElementById('race-route-status').textContent`);
  const t12 = pendingOnReopen.points && pendingOnReopen.points.length === 2 && pendingOnReopen.fileName === 'saved-course.tcx'
    && /saved-course\.tcx/.test(statusText) && /2 points/.test(statusText);
  console.log('Test 12 (re-opening the edit form for a race with a saved route pre-fills RACE_ROUTE_PENDING and the status line):',
    t12 ? 'PASS' : 'FAIL', { pendingOnReopen, statusText });

  // ---- Test 13: raceCardHTML renders a route thumbnail for a race that has routePoints, and renders
  // nothing extra (no stray empty wrapper) for one that doesn't. ----
  const cardWithRoute = win.eval(`raceCardHTML(RACES_LIST[0],false,todayISO(),false)`);
  win.eval(`RACES_LIST.push(normalizeRaceRecord({name:'No Route Race',date:'2026-10-01'}));`);
  const cardNoRoute = win.eval(`raceCardHTML(RACES_LIST[1],false,todayISO(),false)`);
  const t13 = cardWithRoute.includes('<svg') && cardWithRoute.includes('<path') && !cardNoRoute.includes('<path');
  console.log('Test 13 (raceCardHTML shows a route thumbnail only for a race that actually has one):',
    t13 ? 'PASS' : 'FAIL');

  // ---- Test 14: renderRaceStrategyHTML includes the route map card (with its live-map/svg container
  // ids) for a race with a route, and renderRaceRouteMapHTML itself returns '' for one without. ----
  const strategyWithRoute = win.eval(`renderRaceStrategyHTML(RACES_LIST[0])`);
  const emptyMap = win.eval(`renderRaceRouteMapHTML(RACES_LIST[1],'strat-')`);
  const t14 = strategyWithRoute.includes('id="strat-route-live"') && strategyWithRoute.includes('id="strat-route-svg"') && emptyMap === '';
  console.log('Test 14 (renderRaceStrategyHTML includes the route map card for a race with a route; renderRaceRouteMapHTML is empty otherwise):',
    t14 ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
