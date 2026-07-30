// Regression test for a real reported bug (Dylon: "disparity between races found in the schedule and
// races in the race tab" + wanting to edit a race's details "no matter where I select it"). Root
// cause: raceStepsFor(id) — which drives a race-day plan session's Details view in Schedule/Today —
// only recognized Block 5's two hand-seeded race sessions by hardcoded id ('w4d6' -> race key
// 'mayaro', anything else -> race key 'rbc'), gated behind isBlock5. Any OTHER race (from Generate
// Plan, an uploaded plan, or just a second/third race added to Block 5 itself) fell through to
// genericStep(s), which only shows that session's own static det/dist text — completely disconnected
// from the live RACES_LIST record. Editing a race's target time, distance, goal, or package pickup
// info in the Races tab would never show up in its own plan session, and vice versa.
// Fix: raceForSession(s) matches a race-day session to its RACES_LIST record by DATE (a session and
// its race always share the same calendar date) instead of by hardcoded id, works on every block, and
// raceStepsFor(s) now just calls raceStrategyStepsFor(race) — the exact same generator that drives the
// Race Day Strategy view in the Races tab — falling back to genericStep(s) only if no race record
// exists at all (an edge case, not a normal one). openLog() also gained a real "Edit Race Details"
// button on any race-day session (routing straight to openRaceDetail(), the same edit form the Races
// tab itself uses), so editing is reachable from wherever a race day is actually encountered —
// Schedule, Today, or the Races tab — not only from the Races tab.
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

  // ---- Test 1: a race-day session using Block 5's own legacy id convention ('w4d6') still resolves
  // to its race correctly -- proves the fix is a strict generalization, not a regression for the
  // sessions the old hardcoded check was originally written for ----
  win.eval(`
    RACES_LIST.push(normalizeRaceRecord({key:'oldstyle',name:'Old Style Race',date:'2027-02-01',status:'registered',distance:'5K',priority:'B',goal:'Effort-based, no time goal'}));
    BLOCKS.push({id:'oldstyleblock',name:'Old Style Block',startDate:'2027-01-25',sessions:[
      {id:'w4d6',wk:1,d:'D1',date:'2027-02-01',wd:'Mon',ty:'race',ti:'Old Style Race',full:'Old Style Block: Old Style Race',det:'Race day.',dist:'5K'}
    ]});
  `);
  const oldStyleKey = win.eval(`raceForSession(BLOCKS.find(b=>b.id==='oldstyleblock').sessions[0]).key`);
  console.log('Test 1 (a legacy-id race session (w4d6) still resolves via date match):', oldStyleKey==='oldstyle'?'PASS':'FAIL');

  // ---- Test 2: a brand-new race with a modern, non-legacy session id resolves correctly too -- this
  // is exactly the case the old hardcoded id==='w4d6'/'race' check would have silently missed,
  // falling back to a disconnected generic view instead ----
  win.eval(`
    RACES_LIST.push(normalizeRaceRecord({name:'Community 10K',date:'2027-01-15',status:'registered',distance:'10K',priority:'A',targetMin:'45:00',targetMax:'48:00',goal:'First 10K back'}));
    BLOCKS.push({id:'testblock',name:'Test Block',startDate:'2027-01-01',sessions:[
      {id:'tb-race-day',wk:1,d:'D1',date:'2027-01-15',wd:'Fri',ty:'race',ti:'Community 10K',full:'Test Block: Community 10K',det:'Race day.',dist:'10K'},
      {id:'tb-easy-day',wk:1,d:'D2',date:'2027-01-16',wd:'Sat',ty:'easy',ti:'Easy Run',full:'Test Block: Easy Run',det:'Easy.',dist:'5K'}
    ]});
  `);
  const testRace = JSON.parse(win.eval(`JSON.stringify(RACES_LIST.find(r=>r.name==='Community 10K'))`));
  const newStyleKey = win.eval(`raceForSession(BLOCKS.find(b=>b.id==='testblock').sessions[0]).key`);
  console.log('Test 2 (a brand-new race with a modern session id resolves via date match):', newStyleKey===testRace.key?'PASS':'FAIL');

  // ---- Test 3: the session's Details steps reflect the race's REAL target time (via
  // raceStrategyStepsFor, the same generator the Races tab's own Race Day Strategy view uses), not a
  // hardcoded or generic placeholder ----
  const steps = JSON.parse(win.eval(`JSON.stringify(stepsFor(BLOCKS.find(b=>b.id==='testblock').sessions[0]))`));
  console.log('Test 3 (session Details reflect the race real target time, Sub-45:00):', JSON.stringify(steps).includes('Sub-45:00')?'PASS':'FAIL');

  // ---- Test 4: THE ACTUAL BUG -- editing the race's target time in RACES_LIST immediately changes
  // what the plan session shows, with no separate sync step. This is the "disparity" fix. ----
  win.eval(`RACES_LIST.find(r=>r.name==='Community 10K').targetMin='40:00'; RACES_LIST.find(r=>r.name==='Community 10K').targetMax='42:00';`);
  const stepsAfterEdit = JSON.parse(win.eval(`JSON.stringify(stepsFor(BLOCKS.find(b=>b.id==='testblock').sessions[0]))`));
  console.log('Test 4 (editing the race in RACES_LIST updates the plan session live, no disparity):', JSON.stringify(stepsAfterEdit).includes('Sub-40:00')?'PASS':'FAIL');

  // ---- Test 5: a race-day session with genuinely no matching RACES_LIST record (edge case, e.g. a
  // deleted race whose plan session was kept) falls back to a clean genericStep() view instead of
  // throwing or showing a fabricated splits table ----
  win.eval(`
    BLOCKS.push({id:'orphanblock',name:'Orphan Block',startDate:'2027-03-01',sessions:[
      {id:'orphan-race',wk:1,d:'D1',date:'2027-03-05',wd:'Fri',ty:'race',ti:'Mystery Race',full:'Orphan Block: Mystery Race',det:'No matching race record on file.',dist:'5K'}
    ]});
  `);
  const orphanSteps = JSON.parse(win.eval(`JSON.stringify(stepsFor(BLOCKS.find(b=>b.id==='orphanblock').sessions[0]))`));
  console.log('Test 5 (a race day with no matching race record falls back cleanly to genericStep):', JSON.stringify(orphanSteps).includes('No matching race record on file')?'PASS':'FAIL');

  // ---- Test 6: openLog() shows a real "Edit Race Details" button on any race-day session, wired to
  // the exact race it resolved via raceForSession() -- this is the "edit no matter where I select it"
  // half of the fix. A non-race session never shows this button. ----
  win.eval(`ACTIVE_BLOCK_ID='testblock'; setActiveBlock('testblock'); openLog('tb-race-day');`);
  const logBodyRace = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  const raceKeyInButton = win.eval(`
    (() => { const m=document.getElementById('log-sh-body').innerHTML.match(/openRaceDetail\\('([^']+)'\\)/); return m?m[1]:null; })()
  `);
  win.eval(`openLog('tb-easy-day');`);
  const logBodyEasy = win.eval(`document.getElementById('log-sh-body').innerHTML`);
  console.log('Test 6 (race-day session shows Edit Race Details targeting the right race; non-race session never does):', {
    result: (logBodyRace.includes('Edit Race Details') && raceKeyInButton===testRace.key && !logBodyEasy.includes('Edit Race Details')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 7: tapping Edit Race Details (openRaceDetail) opens the Races page directly in EDIT
  // mode for that exact race -- not just a read-only view -- regardless of having been reached from
  // a session opened via Schedule/Today rather than the Races page itself. Races moved out of the
  // Plans popup sheet into its own page (#view-races, see test_races_page.js) -- openRaceDetail now
  // calls switchView('races') instead of opening #plans-overlay. ----
  win.eval(`CURR_VIEW='today'; RACE_EDIT_KEY=null;`);
  win.eval(`openRaceDetail('${testRace.key}')`);
  console.log('Test 7 (Edit Race Details opens the Races page directly in edit mode for that race):', {
    result: (win.eval(`RACE_EDIT_KEY`)===testRace.key && win.eval(`CURR_VIEW`)==='races' && win.eval(`document.getElementById('view-races').classList.contains('active')`)) ? 'PASS' : 'FAIL'
  });

  await wait(200);
  win.close();
})();
