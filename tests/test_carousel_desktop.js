// Regression test for: race countdown carousel looking cut-off on desktop. The 82%-flex-basis
// "peek next card" sizing is a deliberate mobile swipe cue but reads as a broken half-card on
// desktop. Fix: a cd-carousel-few class (added in JS based on race count) makes 2-or-fewer races
// split evenly to fill the row on desktop; 3+ get a fixed comfortable width plus rounded prev/next
// buttons that page through by exactly one whole card (scroll-snap-align:start), never a partial one.
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
    }
  });
  return dom.window;
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);

  // Fixture: a block + two upcoming races (matches the screenshot's Mayaro + RBC scenario).
  win.eval(`
    BLOCKS = [{id:'blockX', name:'Test Block', status:'active', startDate:'2026-07-13', endDate:'2026-09-27',
      mileagePlan:{1:10}, strengthProgression:[], sessions:[{id:'x1', wk:1, ph:'dur', ty:'easy', ti:'Easy Run', det:'5km easy', dist:'5km', d:'D2', date:'2026-07-21', wd:'Tue'}]}];
    ACTIVE_BLOCK_ID='blockX';
    DATA=BLOCKS[0].sessions;
    MILEAGE_PLAN=BLOCKS[0].mileagePlan;
    BLOCK_START=BLOCKS[0].startDate;
    BLOCK_END=BLOCKS[0].endDate;
    STATUS={}; NOTES={}; DATE_OVERRIDES={};
    RACES_LIST=[
      {key:'r1', name:'Mayaro Coconut Run 5K', date:'2026-08-15', status:'registered', priority:'B', distance:'5K', blockId:'blockX'},
      {key:'r2', name:'RBC Race for the Kids 5K', date:'2026-09-27', status:'registered', priority:'A', distance:'5K', blockId:'blockX'}
    ];
  `);

  // ---- Test 1: two upcoming races -> cd-carousel-few class present ----
  win.eval(`switchView('today');`);
  const todayHTML2 = win.eval(`document.getElementById('view-today').innerHTML`);
  const hasFewClass = /class="cd-carousel cd-carousel-few"/.test(todayHTML2);
  console.log('Test 1 (2 races -> cd-carousel-few applied):', hasFewClass ? 'PASS' : 'FAIL');

  // ---- Test 2: three upcoming races -> no cd-carousel-few class, nav buttons present ----
  win.eval(`
    RACES_LIST.push({key:'r3', name:'UWI SPEC Half', date:'2026-10-25', status:'registered', priority:'A', distance:'Half', blockId:null});
    switchView('today');
  `);
  const todayHTML3 = win.eval(`document.getElementById('view-today').innerHTML`);
  const hasFewClass3 = /cd-carousel-few/.test(todayHTML3);
  const hasNavButtons3 = todayHTML3.includes('id="cd-nav-prev"') && todayHTML3.includes('id="cd-nav-next"');
  console.log('Test 2 (3 races -> cd-carousel-few NOT applied, nav buttons rendered):',
    (!hasFewClass3 && hasNavButtons3) ? 'PASS' : 'FAIL', {hasFewClass3, hasNavButtons3});

  // ---- Test 2b: exactly 2 races -> no nav buttons rendered at all (nothing to page through) ----
  const hasNavButtons2 = todayHTML2.includes('id="cd-nav-prev"') || todayHTML2.includes('id="cd-nav-next"');
  console.log('Test 2b (2 races -> no nav buttons rendered):', !hasNavButtons2 ? 'PASS' : 'FAIL');

  // ---- Test 3: CSS rules present (fixed width + scroll-snap-align:start + rounded nav buttons, no fade mask) ----
  const styleText = win.eval(`document.querySelector('style').textContent`).replace(/\s+/g,' ');
  const hasFewRule = /\.cd-carousel-few \.cd-carousel-card\{flex:1 1 0\}/.test(styleText);
  const hasFixedWidthRule = /\.cd-carousel:not\(\.cd-carousel-few\) \.cd-carousel-card\{flex:0 0 var\(--cd-card-w,300px\);scroll-snap-align:start\}/.test(styleText);
  const hasNoFadeMask = !/mask-image:linear-gradient/.test(styleText);
  const hasRoundedNavCSS = /\.cd-nav-btn\{[^}]*border-radius:50%/.test(styleText);
  console.log('Test 3 (fixed width + snap-start, rounded nav CSS, fade mask removed):',
    (hasFewRule && hasFixedWidthRule && hasNoFadeMask && hasRoundedNavCSS) ? 'PASS' : 'FAIL',
    {hasFewRule, hasFixedWidthRule, hasNoFadeMask, hasRoundedNavCSS});

  // ---- Test 3a: carousel always resets to scrollLeft 0 on render, and overflow-anchor is disabled ----
  win.eval(`document.getElementById('cd-carousel').scrollLeft=250;`); // simulate a stale/drifted position
  win.eval(`switchView('today');`); // re-render (still 3 races from Test 2's push)
  const resetScrollLeft = win.eval(`document.getElementById('cd-carousel').scrollLeft`);
  const hasOverflowAnchorNone = /\.cd-carousel\{[^}]*overflow-anchor:none/.test(styleText);
  console.log('Test 3a (carousel resets to scrollLeft 0 on every render, overflow-anchor:none set):',
    (resetScrollLeft===0 && hasOverflowAnchorNone) ? 'PASS' : 'FAIL', {resetScrollLeft, hasOverflowAnchorNone});

  // ---- Test 3b: scrollCdCarousel() and updateCdNavButtons() exist and run without throwing ----
  win.eval(`
    window.matchMedia = (q) => ({ matches: true, media:q, addListener(){}, removeListener(){} });
    Object.defineProperty(document.getElementById('cd-carousel'), 'clientWidth', {value: 340, configurable:true});
    Object.defineProperty(document.getElementById('cd-carousel'), 'scrollWidth', {value: 1200, configurable:true});
  `);
  let scrollFnsOk = true;
  try {
    win.eval(`scrollCdCarousel(1); updateCdNavButtons();`);
  } catch (e) { scrollFnsOk = false; console.log('  -> threw:', e.message); }
  console.log('Test 3b (scrollCdCarousel/updateCdNavButtons run cleanly):', scrollFnsOk ? 'PASS' : 'FAIL');

  // ---- Test 4: single race still gets flex-basis:100% (unchanged existing behavior) ----
  win.eval(`RACES_LIST=[{key:'r1', name:'Solo Race', date:'2026-08-15', status:'registered', priority:'B', distance:'5K', blockId:'blockX'}]; switchView('today');`);
  const todayHTML1 = win.eval(`document.getElementById('view-today').innerHTML`);
  const singleHasFullWidth = /flex-basis:100%/.test(todayHTML1);
  const singleHasFewClass = /cd-carousel-few/.test(todayHTML1);
  console.log('Test 4 (1 race -> flex-basis:100% + still gets cd-carousel-few, both harmless together):',
    (singleHasFullWidth && singleHasFewClass) ? 'PASS' : 'FAIL', {singleHasFullWidth, singleHasFewClass});

  // ---- Test 5: resizeCdCarousel() stretches cards to fill the full available width, no leftover ----
  // wrap (the .countdown-row) is mocked at 760px wide: (760+12)/(300+12) = 2.47 -> floor 2 whole
  // cards fit comfortably -> cards stretch so 2*cardW + 1*gap === 760 exactly -> cardW = (760-12)/2 = 374px.
  // Reset back to 3 races first — Test 4 left RACES_LIST at a single race (cd-carousel-few).
  win.eval(`
    RACES_LIST=[
      {key:'r1', name:'Mayaro Coconut Run 5K', date:'2026-08-15', status:'registered', priority:'B', distance:'5K', blockId:'blockX'},
      {key:'r2', name:'RBC Race for the Kids 5K', date:'2026-09-27', status:'registered', priority:'A', distance:'5K', blockId:'blockX'},
      {key:'r3', name:'UWI SPEC Half', date:'2026-10-25', status:'registered', priority:'A', distance:'Half', blockId:null}
    ];
    switchView('today');
    const _carousel = document.getElementById('cd-carousel');
    Object.defineProperty(_carousel.parentElement, 'clientWidth', {value: 760, configurable: true});
    resizeCdCarousel();
  `);
  const cardWAt760 = win.eval(`document.getElementById('cd-carousel').style.getPropertyValue('--cd-card-w')`);
  console.log('Test 5 (760px available, 2 cards fit -> stretched to 374px, no leftover):',
    cardWAt760 === '374px' ? 'PASS' : 'FAIL (' + cardWAt760 + ')');

  // ---- Test 5b: cd-carousel-few (2 or fewer races) never gets a --cd-card-w constraint ----
  win.eval(`RACES_LIST=[{key:'r1', name:'Solo A', date:'2026-08-15', status:'registered', priority:'B', distance:'5K', blockId:'blockX'},{key:'r2', name:'Solo B', date:'2026-09-01', status:'registered', priority:'A', distance:'5K', blockId:'blockX'}]; switchView('today'); resizeCdCarousel();`);
  const cardWFew = win.eval(`document.getElementById('cd-carousel').style.getPropertyValue('--cd-card-w')`);
  console.log('Test 5b (2 races -> no --cd-card-w constraint applied):', cardWFew === '' ? 'PASS' : 'FAIL (' + cardWFew + ')');

  // ---- Test 5c: fewer total cards than fit at that width -> n caps at totalCards, cards fill 100% ----
  // Same 3-race fixture, but a much wider wrap (2000px) than 3 comfortable cards need: floor((2000+12)/312)=6,
  // capped to totalCards=3 -> cardW = (2000 - 2*12)/3 = 658.67px, filling the row completely (no blank tail).
  win.eval(`
    RACES_LIST=[
      {key:'r1', name:'Mayaro Coconut Run 5K', date:'2026-08-15', status:'registered', priority:'B', distance:'5K', blockId:'blockX'},
      {key:'r2', name:'RBC Race for the Kids 5K', date:'2026-09-27', status:'registered', priority:'A', distance:'5K', blockId:'blockX'},
      {key:'r3', name:'UWI SPEC Half', date:'2026-10-25', status:'registered', priority:'A', distance:'Half', blockId:null}
    ];
    switchView('today');
    const _carousel2 = document.getElementById('cd-carousel');
    Object.defineProperty(_carousel2.parentElement, 'clientWidth', {value: 2000, configurable: true});
    resizeCdCarousel();
  `);
  const cardWAt2000 = win.eval(`document.getElementById('cd-carousel').style.getPropertyValue('--cd-card-w')`);
  const expectedAt2000 = ((2000 - 2*12)/3) + 'px';
  console.log('Test 5c (only 3 cards exist, wide wrap -> n capped to 3, cards stretch to fill 100%):',
    cardWAt2000 === expectedAt2000 ? 'PASS' : 'FAIL (' + cardWAt2000 + ', expected ' + expectedAt2000 + ')');

  // ---- Test 5d: CSS uses --cd-card-w custom property (with 340px fallback) instead of a fixed value ----
  const cssHasVarWidth = /\.cd-carousel:not\(\.cd-carousel-few\) \.cd-carousel-card\{flex:0 0 var\(--cd-card-w,300px\);scroll-snap-align:start\}/.test(styleText);
  console.log('Test 5d (card width driven by --cd-card-w custom property):', cssHasVarWidth ? 'PASS' : 'FAIL');

  // ---- Test 6: nav buttons auto-hide until hover/focus (opacity-based, not display:none, so layout
  // never shifts) — they no longer sit permanently visible on top of card content. ----
  const hasHiddenByDefault = /\.cd-nav-btn\{[^}]*opacity:0;pointer-events:none;transition:opacity \.28s ease-out\}/.test(styleText);
  const hasHoverReveal = /\.countdown-row:hover \.cd-nav-btn:not\(\.cd-limit\),\.countdown-row:focus-within \.cd-nav-btn:not\(\.cd-limit\)\{opacity:1;pointer-events:auto\}/.test(styleText);
  console.log('Test 6 (nav buttons hidden by default, revealed on row hover/focus-within, smoother 280ms fade):',
    (hasHiddenByDefault && hasHoverReveal) ? 'PASS' : 'FAIL', {hasHiddenByDefault, hasHoverReveal});

  // ---- Test 7: "nothing left to scroll to" is expressed via the .cd-limit class (shares the same
  // opacity transition as the hover reveal) instead of a separate, untransitioned style.visibility
  // flip — that mismatch was the actual cause of the reveal feeling inconsistent. ----
  win.eval(`
    const _pb=document.getElementById('cd-nav-prev'), _nb=document.getElementById('cd-nav-next');
    Object.defineProperty(document.getElementById('cd-carousel'),'scrollLeft',{value:0,configurable:true});
    Object.defineProperty(document.getElementById('cd-carousel'),'scrollWidth',{value:1200,configurable:true});
    Object.defineProperty(document.getElementById('cd-carousel'),'clientWidth',{value:700,configurable:true});
    updateCdNavButtons();
  `);
  const prevHasLimitAtStart = win.eval(`document.getElementById('cd-nav-prev').classList.contains('cd-limit')`);
  const nextHasLimitAtStart = win.eval(`document.getElementById('cd-nav-next').classList.contains('cd-limit')`);
  const noInlineVisibility = win.eval(`document.getElementById('cd-nav-prev').style.visibility===''&&document.getElementById('cd-nav-next').style.visibility===''`);
  console.log('Test 7 (at scroll start: prev gets .cd-limit, next does not, no leftover inline visibility):',
    (prevHasLimitAtStart===true && nextHasLimitAtStart===false && noInlineVisibility) ? 'PASS' : 'FAIL',
    {prevHasLimitAtStart, nextHasLimitAtStart, noInlineVisibility});

  await wait(200); // let any pending requestAnimationFrame/setTimeout from the last render settle first
  win.close();
})();
