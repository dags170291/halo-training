// Regression test for the Training Load stat-grid chip going full-width (Dylon: "the balance card
// in the grid should take up the full width and carry a design similar to what is in the recovery
// tab with the scale just minimize it to fit the size"). trainingLoadStatChipHTML() now spans the
// full stat-grid width (grid-column:1/-1) and reuses the same icon-badge+gauge+band-pill layout the
// Recovery tab's fuller trainingLoadCardHTML() uses, via a shared trainingLoadGaugeHTML(load,compact)
// helper — compact mode shrinks the gauge bar/marker/margins and drops the 0.8/1.3/1.5 zone labels,
// while the full Recovery-tab card keeps rendering exactly as before (compact=false).
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
function buildRunLogs(win, endISO, days, kmPerDay, prefix) {
  return win.eval(`
    (function(){
      const end = new Date('${endISO}T12:00:00');
      const out = [];
      for (let i=0;i<${days};i++){
        const d = new Date(end); d.setDate(d.getDate()-i);
        const iso = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        out.push({id:'${prefix}'+i,kind:'run',dist:${kmPerDay},date:iso});
      }
      return out;
    })()
  `);
}

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
  win.eval(`window.renderAll = function(){};`);

  const today = win.eval(`todayISO()`);
  win.eval(`BLOCKS=[]; DATA=[]; STATUS={}; NOTES={};`);
  win.eval(`EXTRALOGS = ${JSON.stringify(buildRunLogs(win, today, 28, 5, 'f'))};`);

  // ---- Test 1: the stat-grid chip now spans the full grid width via grid-column:1/-1 ----
  const chipHTML = win.eval(`trainingLoadStatChipHTML()`);
  console.log('Test 1 (Training Load chip spans the full grid width):',
    chipHTML.includes('grid-column:1 / -1') ? 'PASS' : 'FAIL');

  // ---- Test 2: the chip reuses the same icon badge + gauge + band pill design as the Recovery
  // tab's fuller card, just without the two mini stat boxes / note paragraph text ----
  const hasIconBadge = /width:30px;height:30px;border-radius:var\(--r10\)/.test(chipHTML);
  const hasGauge = /background:var\(--t3\)[\s\S]*background:var\(--gr\)[\s\S]*background:var\(--am\)[\s\S]*background:var\(--re\)/.test(chipHTML);
  const hasBandPill = chipHTML.includes('class="pill"');
  const noMiniStatBoxes = !chipHTML.includes('Last 7 days') && !chipHTML.includes('4-week avg/wk');
  console.log('Test 2 (chip has icon badge + gauge + band pill, no mini stat boxes/note text):', {
    hasIconBadge, hasGauge, hasBandPill, noMiniStatBoxes,
    result: (hasIconBadge && hasGauge && hasBandPill && noMiniStatBoxes) ? 'PASS' : 'FAIL'
  });

  // ---- Test 3: the compact gauge is visually smaller than the full Recovery-tab gauge (thinner
  // bar height, smaller marker dot) and omits the 0.8/1.3/1.5 zone-boundary labels ----
  const compactGaugeHTML = win.eval(`trainingLoadGaugeHTML(acuteChronicWorkload(), true)`);
  const fullGaugeHTML = win.eval(`trainingLoadGaugeHTML(acuteChronicWorkload(), false)`);
  const compactBarH = compactGaugeHTML.match(/height:(\d+)px;border-radius:var\(--rp\)/);
  const fullBarH = fullGaugeHTML.match(/height:(\d+)px;border-radius:var\(--rp\)/);
  const compactHasNoZoneLabels = !compactGaugeHTML.includes('>0.8<');
  const fullHasZoneLabels = fullGaugeHTML.includes('>0.8<') && fullGaugeHTML.includes('>1.3<') && fullGaugeHTML.includes('>1.5<');
  console.log('Test 3 (compact gauge is visually smaller and drops the zone-boundary labels):', {
    compactBarH: compactBarH && compactBarH[1], fullBarH: fullBarH && fullBarH[1],
    compactHasNoZoneLabels, fullHasZoneLabels,
    result: (compactBarH && fullBarH && Number(compactBarH[1]) < Number(fullBarH[1]) && compactHasNoZoneLabels && fullHasZoneLabels) ? 'PASS' : 'FAIL'
  });

  // ---- Test 4: the marker position math is identical between compact and full (same ratio, same
  // percentage placement) -- only the visual scale (bar/dot size) shrinks, not the underlying data ----
  const compactMarker = compactGaugeHTML.match(/left:([\d.]+)%;transform:translate\(-50%,-50%\)/);
  const fullMarker = fullGaugeHTML.match(/left:([\d.]+)%;transform:translate\(-50%,-50%\)/);
  console.log('Test 4 (marker position is identical in compact vs full -- same underlying ratio):',
    (compactMarker && fullMarker && compactMarker[1]===fullMarker[1]) ? 'PASS' : 'FAIL',
    { compactMarker: compactMarker && compactMarker[1], fullMarker: fullMarker && fullMarker[1] });

  // ---- Test 5: the full Recovery-tab card (trainingLoadCardHTML) is completely unaffected --
  // still has its icon badge, full gauge with zone labels, mini stat boxes, and note text ----
  const recoveryCardHTML = win.eval(`trainingLoadCardHTML()`);
  console.log('Test 5 (the full Recovery-tab card is unaffected by the compact-mode addition):',
    (recoveryCardHTML.includes('Last 7 days') && recoveryCardHTML.includes('4-week avg/wk') && recoveryCardHTML.includes('>0.8<')) ? 'PASS' : 'FAIL');

  // ---- Test 6 (v0.32.14, flipped): Training Load was removed from the Progress tab entirely --
  // Dylon: "remove training load from progress (leave it in recovery)." trainingLoadStatChipHTML()
  // itself is untouched (still full-width, still tested directly in Tests 1-5 above) -- it's just no
  // longer called from renderProgress(), so the live Progress DOM should have no such chip at all. ----
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-06-01',endDate:'2026-09-01',sessions:[
      {id:'s1',wk:1,ty:'easy',date:'${today}',ph:'dur'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions;
    ACTIVE_BLOCK_ID='b1';
    STATUS={};
    NOTES={};
    MILEAGE_PLAN={1:20};
    RACES_LIST=[];
    renderProgress();
  `);
  const chipEl = win.eval(`
    (function(){
      const chip = Array.from(document.querySelectorAll('#view-progress .stat-card')).find(c=>c.textContent.includes('Training Load'));
      return chip ? chip.style.gridColumn : null;
    })()
  `);
  console.log('Test 6 (no Training Load chip renders anywhere in the live Progress tab DOM anymore):',
    chipEl===null ? 'PASS' : 'FAIL', { chipEl });

  await wait(200);
  win.close();
})();
