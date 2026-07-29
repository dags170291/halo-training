// Regression test: the "Next Race" card's border used the exact same full-saturated var(--accent)
// color as the desktop "selected" ring (.plans-list-card-desk.selected), so it always looked actively
// selected even when nothing was actually open in the detail pane. Fixed by muting the next-race
// border to var(--accent2) — the same "2" tier PB (gold2) and Complete (gr2) already use — while the
// real .selected class (!important) still forces the full var(--accent) when a race is genuinely open.
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

  win.eval(`
    RACES_LIST=[
      {key:'r1',name:'Race One',date:'2026-08-15',dateTBD:false,time:'',regOpenDate:'',distance:'5K',priority:'B',shoeKey:'',status:'registered',goal:'',targetMin:'',targetMax:'',isPB:false,location:'',routeUrl:'',blockId:null,resultPace:'',resultHR:'',resultPos:'',resultGPos:'',resultAPos:'',resultNotes:''},
      {key:'r2',name:'Race Two',date:'2026-09-27',dateTBD:false,time:'',regOpenDate:'',distance:'5K',priority:'A',shoeKey:'',status:'registered',goal:'',targetMin:'',targetMax:'',isPB:false,location:'',routeUrl:'',blockId:null,resultPace:'',resultHR:'',resultPos:'',resultGPos:'',resultAPos:'',resultNotes:''}
    ];
    ACTIVE_BLOCK_ID=null; BLOCKS=[];
    openPlans('races','all');
  `);

  // ---- Test 1: the next-race card (r1, isNext=true), with nothing selected, uses the muted
  // accent2 border, not the full accent color the selected ring uses ----
  const nextCardHTMLNoSelection = win.eval(`raceCardHTML(RACES_LIST[0], true, '2026-07-21', false)`);
  const usesMutedBorder = nextCardHTMLNoSelection.includes('border:1px solid var(--accent2)');
  const doesNotUseFullAccentBorder = !/border:1px solid var\(--accent\);/.test(nextCardHTMLNoSelection);
  console.log('Test 1 (unselected next-race card border is muted var(--accent2), not full var(--accent)):',
    (usesMutedBorder && doesNotUseFullAccentBorder) ? 'PASS' : 'FAIL');

  // ---- Test 2: no "selected" class present when nothing is actually selected ----
  const noSelectedClass = !nextCardHTMLNoSelection.includes('selected');
  console.log('Test 2 (next-race card has no "selected" class when nothing is actually open):', noSelectedClass ? 'PASS' : 'FAIL');

  // ---- Test 3: actually selecting/opening that race still shows a real, distinguishable selection —
  // the .selected class gets added, and its CSS forces the full var(--accent) border via !important,
  // genuinely different now from the muted next-race highlight ----
  win.eval(`startEditRace('r1');`);
  const selectedCount = win.eval(`document.querySelectorAll('.plans-col-list .plan-list-card.selected').length`);
  const styleText = win.eval(`document.querySelector('style').textContent`).replace(/\s+/g,' ');
  const cssHasImportantOverride = /\.plans-list-card-desk\.selected\{border-color:var\(--accent\) ?!important\}/.test(styleText);
  console.log('Test 3 (opening the race applies .selected, whose CSS forces the real accent border via !important):',
    (selectedCount === 1 && cssHasImportantOverride) ? 'PASS' : 'FAIL', { selectedCount, cssHasImportantOverride });
  win.eval(`cancelRaceEdit();`);

  // ---- Test 4: a done/PB race's border is untouched by this change (still the muted gr2/gold2 tiers) ----
  const doneRace = {key:'r3',name:'Race Three',date:'2026-06-01',dateTBD:false,status:'done',isPB:false,distance:'5K',priority:'B',location:'',goal:'',targetMin:'',targetMax:''};
  const pbRace = {key:'r4',name:'Race Four',date:'2026-06-01',dateTBD:false,status:'done',isPB:true,distance:'5K',priority:'B',location:'',goal:'',targetMin:'',targetMax:''};
  const doneCardHTML = win.eval(`raceCardHTML(${JSON.stringify(doneRace)}, false, '2026-07-21', false)`);
  const pbCardHTML = win.eval(`raceCardHTML(${JSON.stringify(pbRace)}, false, '2026-07-21', false)`);
  console.log('Test 4 (Done/PB race borders unaffected — still gr2/gold2):', {
    doneUsesGr2: doneCardHTML.includes('border:1px solid var(--gr2)'),
    pbUsesGold2: pbCardHTML.includes('border:1px solid var(--gold2)'),
    result: (doneCardHTML.includes('border:1px solid var(--gr2)') && pbCardHTML.includes('border:1px solid var(--gold2)')) ? 'PASS' : 'FAIL'
  });

  await wait(200);
  win.close();
})();
