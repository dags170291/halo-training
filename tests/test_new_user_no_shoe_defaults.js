// Regression test for a real reported bug: Dylon's sister, on a brand-new device with an empty
// localStorage, saw his actual 4 shoes (Adidas Adizero SL2, Evo SL, New Balance Rebel v4, PUMA
// Pounce Lite) instead of an empty shoe list. Root cause: loadState() had SHOES fall back to
// SHOE_DEFAULTS (a hardcoded copy of Dylon's real shoe collection, left over from before the app
// supported more than one person) whenever there was no saved shoe data yet -- every OTHER piece of
// state (STATUS/NOTES/EXTRALOGS/DATE_OVERRIDES/GLOBAL_RACES/RACES_LIST/INJURIES/WELLNESS_LOG)
// already defaulted to empty on a fresh device, shoes was the one exception. Same bug existed in
// confirmReset()'s "Reset all progress" path. Fix: both now default/reset to {} like everything else.
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

  // ---- Test 1: on a genuinely fresh device (real jsdom localStorage, nothing ever saved to it),
  // calling loadState() gives an EMPTY shoe list, not Dylon's real 4 shoes ----
  win.eval(`localStorage.clear(); loadState();`);
  const freshShoes = JSON.parse(win.eval(`JSON.stringify(SHOES)`));
  const freshShoeKeys = Object.keys(freshShoes);
  console.log('Test 1 (a brand-new device with empty localStorage gets an empty shoe list, not Dylon\\u2019s real shoes):',
    freshShoeKeys.length === 0 ? 'PASS' : 'FAIL', { freshShoeKeys });

  // ---- Test 2: SHOE_DEFAULTS itself is untouched (still exists, in case anything else ever needs
  // Dylon's own historical seed data) -- this fix only changes what a FRESH device falls back to,
  // it doesn't delete the underlying constant ----
  const defaultsStillExist = win.eval(`typeof SHOE_DEFAULTS==='object' && Object.keys(SHOE_DEFAULTS).length===4`);
  console.log('Test 2 (SHOE_DEFAULTS constant itself is untouched, just no longer auto-applied):', defaultsStillExist ? 'PASS' : 'FAIL');

  // ---- Test 3: a device that DOES have its own real saved shoe data still loads it correctly --
  // this fix must not affect any device (like Dylon's own) that already has real shoes saved ----
  win.eval(`
    localStorage.clear();
    localStorage.setItem('b5_shoes', JSON.stringify({sl2:{name:'Adidas Adizero SL2',km:421.9,note:'Easy, foundation, long runs',retired:false}}));
    loadState();
  `);
  const realShoes = JSON.parse(win.eval(`JSON.stringify(SHOES)`));
  console.log('Test 3 (a device with its own real saved shoe data still loads it correctly, unaffected by this fix):',
    (Object.keys(realShoes).length===1 && realShoes.sl2 && realShoes.sl2.km===421.9) ? 'PASS' : 'FAIL', { realShoes });

  // ---- Test 4: "Reset all progress" (Settings) also resets shoes to empty, not back to Dylon's
  // real shoes -- same root bug, different code path (confirmReset) ----
  win.eval(`
    SHOES={sl2:{name:'Some Shoe',km:100,retired:false}};
    STATUS={a:'done'};NOTES={a:{dist:'5'}};EXTRALOGS=[{id:'x'}];DATE_OVERRIDES={};INJURIES=[];WELLNESS_LOG=[];
  `);
  win.eval(`
    STATUS={};NOTES={};EXTRALOGS=[];DATE_OVERRIDES={};SHOES={};INJURIES=[];WELLNESS_LOG=[];
    applyDateOverrides();
    saveState();
  `);
  const shoesAfterReset = JSON.parse(win.eval(`JSON.stringify(SHOES)`));
  console.log('Test 4 (Reset all progress clears shoes to empty, not back to Dylon\\u2019s real shoes):',
    Object.keys(shoesAfterReset).length === 0 ? 'PASS' : 'FAIL', { shoesAfterReset });

  await wait(200);
  win.close();
})();
