// Regression test for two real bugs reported from a screen recording of the desktop Race Calendar
// (list on the left, edit form / Race Day Strategy docked on the right — see renderRaceCalendarDesktopHTML):
// (1) nothing in the list ever showed which race's form/strategy was currently open in the detail
// pane — raceCardHTML never got the same "selected" ring treatment Season Blocks' own list cards
// already had (planBlockCardDesktopHTML + .plans-list-card-desk.selected), so clicking through races
// changed the right-hand detail but the left-hand list looked identical no matter what was open; and
// (2) every click (or any other action) that called renderPlansBody() replaced the whole sheet body's
// innerHTML, which recreates the scrollable .plans-col-list element from scratch and silently resets
// its scrollTop to 0 — visible jank when scrolling partway down a long list and clicking anything.
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
      // JSDOM doesn't implement layout, so matchMedia-driven isDesktop() would otherwise always read
      // as mobile — force the desktop split-pane path so raceCardHTML/renderRaceCalendarDesktopHTML
      // (the code path this bug actually lives in) is what gets exercised, not the mobile fallback.
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

  // Three unscheduled races (no blockId) so they all land in the same filtered "Upcoming" list
  // together, sorted soonest-first, none tied to the active block's Race Day Strategy shortcut —
  // keeps this purely about startEditRace()/openRaceCard's plain edit-form path.
  win.eval(`
    RACES_LIST=[
      {key:'r1',name:'Race One',date:'2026-08-15',dateTBD:false,time:'',regOpenDate:'',distance:'5K',priority:'B',shoeKey:'',status:'registered',goal:'',targetMin:'',targetMax:'',isPB:false,location:'',routeUrl:'',blockId:null,resultPace:'',resultHR:'',resultPos:'',resultGPos:'',resultAPos:'',resultNotes:''},
      {key:'r2',name:'Race Two',date:'2026-09-27',dateTBD:false,time:'',regOpenDate:'',distance:'5K',priority:'A',shoeKey:'',status:'registered',goal:'',targetMin:'',targetMax:'',isPB:false,location:'',routeUrl:'',blockId:null,resultPace:'',resultHR:'',resultPos:'',resultGPos:'',resultAPos:'',resultNotes:''},
      {key:'r3',name:'Race Three',date:'2026-10-25',dateTBD:false,time:'',regOpenDate:'',distance:'10K',priority:'A',shoeKey:'',status:'registered',goal:'',targetMin:'',targetMax:'',isPB:false,location:'',routeUrl:'',blockId:null,resultPace:'',resultHR:'',resultPos:'',resultGPos:'',resultAPos:'',resultNotes:''}
    ];
    ACTIVE_BLOCK_ID=null; BLOCKS=[];
    openPlans('races','all');
  `);

  // ---- Test 1: no race selected yet — no card should carry the "selected" ring ----
  const noneSelected = win.eval(`document.querySelectorAll('.plans-col-list .plan-list-card.selected').length`);
  console.log('Test 1 (no card is marked selected before any race is opened):', noneSelected === 0 ? 'PASS' : 'FAIL', { noneSelected });

  // ---- Test 2: opening Race Two's edit form highlights ONLY Race Two's card ----
  win.eval(`startEditRace('r2');`);
  const selectedCount2 = win.eval(`document.querySelectorAll('.plans-col-list .plan-list-card.selected').length`);
  const r2Selected = win.eval(`document.querySelectorAll('.plans-col-list .plan-list-card.selected')[0]?.textContent.includes('Race Two')`);
  console.log('Test 2 (opening a race edit form highlights exactly that race card):',
    (selectedCount2 === 1 && r2Selected) ? 'PASS' : 'FAIL', { selectedCount2, r2Selected });

  // ---- Test 3: switching to Race Three's edit form MOVES the highlight, doesn't leave it stuck ----
  win.eval(`startEditRace('r3');`);
  const selectedCount3 = win.eval(`document.querySelectorAll('.plans-col-list .plan-list-card.selected').length`);
  const r3Selected = win.eval(`document.querySelectorAll('.plans-col-list .plan-list-card.selected')[0]?.textContent.includes('Race Three')`);
  const r2StillSelected = win.eval(`Array.from(document.querySelectorAll('.plans-col-list .plan-list-card.selected')).some(el=>el.textContent.includes('Race Two'))`);
  console.log('Test 3 (selecting a different race moves the highlight instead of leaving the old one lit -- the exact reported bug):',
    (selectedCount3 === 1 && r3Selected && !r2StillSelected) ? 'PASS' : 'FAIL', { selectedCount3, r3Selected, r2StillSelected });

  // ---- Test 4: canceling the edit clears the highlight ----
  win.eval(`cancelRaceEdit();`);
  const selectedAfterCancel = win.eval(`document.querySelectorAll('.plans-col-list .plan-list-card.selected').length`);
  console.log('Test 4 (canceling an edit clears the selected ring):', selectedAfterCancel === 0 ? 'PASS' : 'FAIL', { selectedAfterCancel });

  // ---- Test 5: the scroll-jank fix — scrolling the list partway down, then opening a race,
  // no longer snaps the list back to the top. This is the literal bug from the recording: click
  // any race while scrolled down, and the whole list used to jump back to scrollTop 0. ----
  win.eval(`
    const scrollEl=document.querySelector('.plans-col-list');
    if(scrollEl){ Object.defineProperty(scrollEl,'scrollHeight',{value:2000,configurable:true}); scrollEl.scrollTop=400; }
  `);
  const scrollBeforeClick = win.eval(`document.querySelector('.plans-col-list').scrollTop`);
  win.eval(`startEditRace('r1');`);
  const scrollAfterClick = win.eval(`document.querySelector('.plans-col-list').scrollTop`);
  console.log('Test 5 (opening a race no longer resets the list scroll position back to the top):',
    (scrollBeforeClick===400 && scrollAfterClick===400) ? 'PASS' : 'FAIL', { scrollBeforeClick, scrollAfterClick });

  // ---- Test 6: switching the Race Calendar filter chip is a genuinely new list — this SHOULD
  // still reset to the top, unlike just picking a different race within the same list. ----
  win.eval(`
    const scrollEl=document.querySelector('.plans-col-list');
    if(scrollEl){ Object.defineProperty(scrollEl,'scrollHeight',{value:2000,configurable:true}); scrollEl.scrollTop=500; }
    setRaceFilter('unscheduled');
  `);
  const scrollAfterFilterChange = win.eval(`document.querySelector('.plans-col-list')?.scrollTop`);
  console.log('Test 6 (changing the filter — a genuinely new list — still resets scroll to the top):',
    scrollAfterFilterChange === 0 ? 'PASS' : 'FAIL', { scrollAfterFilterChange });

  // ---- Test 7: Season Blocks' own selected-highlight + scroll-preserve still work (same shared
  // renderPlansBody() mechanism) — regression check that fixing races didn't disturb blocks. ----
  win.eval(`
    SEASONS=[{id:'s2025',name:'2025'}];
    BLOCKS=[
      {id:'b1',name:'Block One',seasonId:'s2025',status:'complete',startDate:'2025-01-01',endDate:'2025-03-01',mileagePlan:{},sessions:[]},
      {id:'b2',name:'Block Two',seasonId:'s2025',status:'complete',startDate:'2025-04-01',endDate:'2025-06-01',mileagePlan:{},sessions:[]}
    ];
    switchPlansTab('blocks');
    selectPlansBlock('b1');
  `);
  const blockSelectedCount = win.eval(`document.querySelectorAll('.plans-col-list .plan-list-card.selected').length`);
  console.log('Test 7 (Season Blocks selection highlight still works after the shared renderPlansBody change):',
    blockSelectedCount === 1 ? 'PASS' : 'FAIL', { blockSelectedCount });

  await wait(200);
  win.close();
})();
