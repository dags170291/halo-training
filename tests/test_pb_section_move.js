// Regression test: Personal Bests has now moved TWICE. It originally lived in Profile only; Dylon
// then asked for the full section (hero PB card + grid covering every standard distance) in Progress
// instead, so it moved there and Profile's copy was removed. v0.32.14 reverses that as part of a
// broader Progress tab cleanup — Dylon: "move personal best to the profile" — so
// personalBestsSectionHTML() is called from renderProfile() once again, and renderProgress() no
// longer renders it at all. This file's assertions were flipped to match the current (Profile) home;
// personalBestsSectionHTML() itself is unchanged either way.
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

  win.eval(`
    RACES_LIST = [{key:'hadco5k', name:'HADCO Foundation 5K', date:'2026-03-14', distance:'5K', status:'done', actualTime:'27:34', isPB:true}];
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-01',endDate:'2026-09-01',sessions:[
      {id:'s1',wk:1,ty:'easy',date:'2026-07-01',ph:'dur'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions;
    ACTIVE_BLOCK_ID='b1';
    STATUS={};
    NOTES={};
    MILEAGE_PLAN={1:20};
  `);

  // ---- Test 1: personalBestsSectionHTML() renders the full hero + per-distance grid ----
  const pbHTML = win.eval(`personalBestsSectionHTML()`);
  const hasHero = pbHTML.includes('Personal Bests') && pbHTML.includes('27:34') && pbHTML.includes('HADCO Foundation 5K');
  const hasFullGrid = pbHTML.includes('Not yet raced'); // other RACE_DIST_BUCKETS with no PB on record
  console.log('Test 1 (personalBestsSectionHTML renders the hero PB + full per-distance grid):',
    (hasHero && hasFullGrid) ? 'PASS' : 'FAIL', { hasHero, hasFullGrid });

  // ---- Test 2 (v0.32.14, flipped): the full Personal Bests section (hero + grid) now renders
  // inside the real Profile tab, not Progress ----
  win.eval(`renderProfile();`);
  const profileHTML = win.eval(`document.getElementById('view-profile').innerHTML`);
  console.log('Test 2 (Personal Bests section renders inside the real Profile tab):',
    (profileHTML.includes('Personal Bests') && profileHTML.includes('27:34')) ? 'PASS' : 'FAIL');

  // ---- Test 3 (v0.32.14, flipped): renderProgress() no longer renders the Personal Bests section
  // at all (moved back to Profile, not duplicated) ----
  win.eval(`renderProgress();`);
  const progressHTML = win.eval(`document.getElementById('view-progress').innerHTML`);
  const progressHasPB = progressHTML.includes('Personal Bests');
  console.log('Test 3 (Progress tab no longer shows Personal Bests -- moved back to Profile, not duplicated):',
    !progressHasPB ? 'PASS' : 'FAIL', { progressHasPB });

  // ---- Test 4 (v0.32.14, flipped): with no PB on record at all, the section still renders a sane
  // empty state (not a broken/blank card), both standalone and inside the real Profile tab ----
  win.eval(`RACES_LIST=[];`);
  const emptyPBHTML = win.eval(`personalBestsSectionHTML()`);
  const hasEmptyState = emptyPBHTML.includes('Mark a race as a Personal Best');
  win.eval(`renderProfile();`);
  const profileEmptyHTML = win.eval(`document.getElementById('view-profile').innerHTML`);
  console.log('Test 4 (no PB on record -> sane empty state, both standalone and in Profile tab):',
    (hasEmptyState && profileEmptyHTML.includes('Mark a race as a Personal Best')) ? 'PASS' : 'FAIL');

  // ---- Test 5: Profile's Race Goals section still renders correctly alongside Personal Bests --
  // confirms adding the PB block back didn't break the code around it ----
  win.eval(`
    RACES_LIST = [{key:'r1', name:'Fall 10K', date:'2026-09-01', distance:'10K', status:'registered', priority:'B'}];
    renderProfile();
  `);
  const profileHTML2 = win.eval(`document.getElementById('view-profile').innerHTML`);
  console.log('Test 5 (Profile Race Goals section still renders fine alongside Personal Bests):',
    (profileHTML2.includes('Race Goals') && profileHTML2.includes('Fall 10K')) ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
