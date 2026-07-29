// Regression test for the new .ics calendar export (task #115): buildPlanICS() produces a valid
// RFC5545 calendar from a block's sessions (+ any linked race not already covered by a race-day
// session), and the Download Plan popup offers it as a third option alongside PDF/Markdown.
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
  win.eval(`window.renderAll = function(){};`); // same pre-existing jsdom/renderAll OOM workaround as other test files

  win.eval(`
    BLOCKS=[{
      id:'tb1', name:'Test Block', planTitle:'Test Block', theme:'', tags:[], startDate:'2026-08-03', endDate:'2026-08-16',
      phaseLabels:{build:'Build',taper:'Taper'},
      mileagePlan:{1:16,2:10},
      sessions:[
        {id:'tb1_w1d0', wk:1, ph:'build', d:'D0', date:'2026-08-03', wd:'Mon', ty:'easy', ti:'Easy Run', full:'run', det:'6 km easy, comma test, and a semi;colon here', dist:fmtDist(6)},
        {id:'tb1_w1d5', wk:1, ph:'build', d:'D5', date:'2026-08-08', wd:'Sat', ty:'long', ti:'Long Run', full:'run', det:'10 km long run at an easy effort', dist:fmtDist(10)},
        {id:'tb1_w2d6', wk:2, ph:'taper', d:'RACE', date:'2026-08-16', wd:'Sun', ty:'race', ti:'Test 10K', full:'race', det:'Race day — Test 10K.', dist:fmtDist(10)},
        {id:'tb1_w1d2', wk:1, ph:'build', d:'D2', date:'2026-08-05', wd:'Wed', ty:'rest', ti:'Rest Day', full:'rest', det:'Full rest.'}
      ],
      weekNotes:{}, sessionNotes:{}, status:'active'
    }];
    SEASONS=[{id:'s2026',name:'2026'}];
    BLOCKS[0].seasonId='s2026';
    ACTIVE_BLOCK_ID='tb1';
    RACES_LIST=[
      {key:'race1', name:'Test 10K', date:'2026-08-16', dateTBD:false, time:'', regOpenDate:'', distance:'10K', priority:'A', shoeKey:'', status:'registered', goal:'Sub-50', targetMin:'', targetMax:'', isPB:false, location:'City Park', routeUrl:'', blockId:'tb1', resultPace:'', resultHR:'', resultPos:'', resultGPos:'', resultAPos:'', resultNotes:''},
      {key:'race2', name:'Tune-Up 5K', date:'2026-08-09', dateTBD:false, time:'', regOpenDate:'', distance:'5K', priority:'B', shoeKey:'', status:'registered', goal:'', targetMin:'', targetMax:'', isPB:false, location:'Riverside', routeUrl:'', blockId:'tb1', resultPace:'', resultHR:'', resultPos:'', resultGPos:'', resultAPos:'', resultNotes:''}
    ];
  `);

  const ics = win.eval(`buildPlanICS(BLOCKS[0])`);

  // ---- Test 1: well-formed VCALENDAR wrapper ----
  const wellFormed = ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.trim().endsWith('END:VCALENDAR');
  console.log('Test 1 (VCALENDAR wrapper present and well-formed):', wellFormed ? 'PASS' : 'FAIL');

  // ---- Test 2: one VEVENT per real session (4 sessions -> 4 VEVENTs) plus one for the unlinked
  // Tune-Up 5K race (not already covered by a race-type session) -> 5 total; the main 10K race is
  // NOT duplicated since tb1_w2d6 already covers that exact date ----
  const veventCount = (ics.match(/BEGIN:VEVENT/g)||[]).length;
  console.log('Test 2 (4 session events + 1 unlinked-race event, no duplicate for the linked race):', veventCount === 5 ? 'PASS' : 'FAIL', { veventCount });

  // ---- Test 3: DTSTART/DTEND use all-day VALUE=DATE with correct YYYYMMDD, end = start+1 day ----
  const hasCorrectLongRunDates = ics.includes('DTSTART;VALUE=DATE:20260808') && ics.includes('DTEND;VALUE=DATE:20260809');
  console.log('Test 3 (all-day DTSTART/DTEND with end = start + 1 day):', hasCorrectLongRunDates ? 'PASS' : 'FAIL');

  // ---- Test 4: SUMMARY includes title + distance ----
  const hasSummary = ics.includes('SUMMARY:Long Run — ') && /SUMMARY:Long Run — [\d.]+ (km|mi)/.test(ics);
  console.log('Test 4 (SUMMARY includes session title + distance):', hasSummary ? 'PASS' : 'FAIL');

  // ---- Test 5: RFC5545 text escaping — commas and semicolons in DESCRIPTION are escaped ----
  const hasEscaping = ics.includes('comma test\\, and a semi\\;colon here');
  console.log('Test 5 (commas/semicolons in DESCRIPTION are properly escaped):', hasEscaping ? 'PASS' : 'FAIL');

  // ---- Test 6: the unlinked Tune-Up 5K race gets its own event with goal/location in DESCRIPTION ----
  const hasUnlinkedRace = ics.includes('SUMMARY:Race: Tune-Up 5K (5K)') && ics.includes('DTSTART;VALUE=DATE:20260809');
  console.log('Test 6 (unlinked race gets its own dated VEVENT):', hasUnlinkedRace ? 'PASS' : 'FAIL');

  // ---- Test 7: UIDs are stable (session id-based) and unique per event ----
  const uids = (ics.match(/UID:[^\r\n]+/g)||[]);
  const uniqueUids = new Set(uids);
  console.log('Test 7 (every VEVENT has a unique UID):', uniqueUids.size === uids.length && uids.length === 5 ? 'PASS' : 'FAIL', { uidCount: uids.length, uniqueCount: uniqueUids.size });

  // ---- Test 8: icsFoldLine wraps long lines per RFC5545 (continuation starts with a space) ----
  const longLine = 'DESCRIPTION:'+('x'.repeat(200));
  const folded = win.eval(`icsFoldLine(${JSON.stringify(longLine)})`);
  const foldedOk = folded.includes('\r\n ') && folded.split('\r\n').every((seg,i)=> i===0 ? seg.length<=75 : seg.startsWith(' '));
  console.log('Test 8 (icsFoldLine folds long lines with a leading space on continuations):', foldedOk ? 'PASS' : 'FAIL');

  // ---- Test 9: Download Plan popup now offers a third "Add to Calendar (.ics)" option ----
  win.eval(`confirmDownloadPlan();`);
  const dialogHTML = win.eval(`document.getElementById('confirm-sheet-inner').innerHTML`);
  const hasIcsButton = dialogHTML.includes('Add to Calendar (.ics)');
  console.log('Test 9 (Download Plan popup offers Add to Calendar (.ics)):', hasIcsButton ? 'PASS' : 'FAIL');

  // ---- Test 10: clicking it actually triggers a real .ics download (createObjectURL called with a
  // text/calendar blob) — stub out the DOM download plumbing jsdom doesn't implement ----
  win.eval(`
    window.__lastBlobType = null;
    window.__downloadTriggered = false;
    URL.createObjectURL = (blob) => { window.__lastBlobType = blob.type; return 'blob:mock'; };
    URL.revokeObjectURL = () => {};
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(){ window.__downloadTriggered = true; };
  `);
  win.eval(`
    const btns = Array.from(document.querySelectorAll('.confirm-btns button'));
    const icsBtn = btns.find(b=>b.textContent.includes('Add to Calendar'));
    if(icsBtn) icsBtn.click();
  `);
  const blobType = win.eval(`window.__lastBlobType`);
  const downloadTriggered = win.eval(`window.__downloadTriggered`);
  console.log('Test 10 (clicking the button downloads a text/calendar blob):',
    (downloadTriggered && blobType && blobType.indexOf('text/calendar')===0) ? 'PASS' : 'FAIL', { downloadTriggered, blobType });

  await wait(200);
  win.close();
})();
