// Dylon: "can you put the version number in this area for quick viewing ? also make it interactive
// where if i click i can see the changelog" -- pointing at the desktop sidebar's Profile/Settings
// corner (bottom of the sidebar nav). New: a small "v0.34.33" chip sits under Profile/Settings,
// synced from APP_VERSION via renderSidebarVersion() (called from renderTopbar(), same lifecycle as
// renderAvatars()), and opens a new #changelog-overlay populated from a hand-maintained APP_CHANGELOG
// array. The existing Settings > About > Version row is also now clickable to the same overlay, so
// mobile (which hides the desktop-only .sidebar entirely) still has a path in.
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

  // ---- Test 1: the sidebar version chip exists and, once renderSidebarVersion() runs (via
  // renderTopbar(), triggered here directly since a full app boot isn't set up in this harness),
  // shows the real APP_VERSION -- not hardcoded/stale text. ----
  win.eval(`renderSidebarVersion();`);
  const chipText = win.document.getElementById('sidebar-version-btn').textContent;
  const realVersion = win.eval('APP_VERSION');
  const t1 = chipText.includes(realVersion) && chipText.trim().length > 0;
  console.log('Test 1 (sidebar version chip shows the real APP_VERSION, not hardcoded):', t1?'PASS':'FAIL', { chipText, realVersion });

  // ---- Test 2: clicking the chip (openChangelog()) opens #changelog-overlay and populates it with
  // real content, newest release first. ----
  win.eval(`openChangelog();`);
  const overlayOpen = win.document.getElementById('changelog-overlay').classList.contains('open');
  const body = win.document.getElementById('changelog-sh-body').innerHTML;
  const changelog = win.eval('APP_CHANGELOG');
  const t2 = overlayOpen && body.includes('v'+changelog[0].v) && body.includes(changelog[0].items[0]);
  console.log('Test 2 (openChangelog opens the overlay with real, newest-first content):', t2?'PASS':'FAIL', { overlayOpen, snippet: body.slice(0,150) });

  // ---- Test 3: the changelog is ordered newest-first (each entry's version >= the next one's, by
  // simple string/numeric comparison of the three dot-separated parts). ----
  function verTuple(v){ return v.split('.').map(Number); }
  function verGte(a,b){ const A=verTuple(a),B=verTuple(b); for(let i=0;i<3;i++){ if(A[i]!==B[i]) return A[i]>B[i]; } return true; }
  let ordered = true;
  for(let i=0;i<changelog.length-1;i++){ if(!verGte(changelog[i].v, changelog[i+1].v)) ordered=false; }
  console.log('Test 3 (APP_CHANGELOG entries are ordered newest-version-first):', ordered?'PASS':'FAIL', { versions: changelog.map(r=>r.v) });

  // ---- Test 4: Settings > About > Version row is also wired to openChangelog(), giving mobile (no
  // .sidebar at all under 768px) the same path in. ----
  win.eval(`document.getElementById('changelog-overlay').classList.remove('open');`);
  win.eval(`renderSettingsBody();`); // just confirm it doesn't throw
  const settingsHTML = win.eval(`renderSettingsBody()`);
  const t4 = /onclick="openChangelog\(\)"[^>]*>\s*<span[^>]*>Version</.test(settingsHTML) || settingsHTML.includes('onclick="openChangelog()"');
  console.log('Test 4 (Settings > About Version row also opens the changelog, for mobile):', t4?'PASS':'FAIL', { hasHook: settingsHTML.includes('openChangelog()') });

  // ---- Test 5: closeOverlay('changelog-overlay') (the sheet's own X button) actually closes it,
  // same generic mechanism every other overlay in the app already uses. ----
  win.eval(`openChangelog(); closeOverlay('changelog-overlay');`);
  const closedNow = !win.document.getElementById('changelog-overlay').classList.contains('open');
  console.log('Test 5 (closeOverlay closes the changelog overlay like every other overlay):', closedNow?'PASS':'FAIL');
})();
