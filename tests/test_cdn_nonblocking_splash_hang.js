// Regression test for a real bug a tester hit: "the app isnt accessible outside my network nor by
// my sister" -- turned out both the github.io and (stale) netlify.app URLs were reachable fine from
// completely outside the tester's network, so it wasn't a hosting/DNS problem. A screenshot showed
// the app stuck forever on its install splash screen on mobile data with a VPN active. Root cause:
// the three optional CDN dependencies (Supabase, jsPDF, Leaflet) were loaded as plain blocking
// <script src> tags sitting in the middle of <body>, directly ahead of the single giant inline
// <script> that is the entire rest of this app. A normal (non-async/defer) external script tag
// stalls the parser -- and the page's first paint, so an installed PWA's OS-level splash just sits
// there -- until that request finishes OR errors. A VPN/ad-blocker/firewall that silently
// black-holes a request (rather than cleanly refusing it, which is exactly what some ad-blocking
// VPN apps do to CDN domains like unpkg.com) can make that hang indefinitely, freezing the ENTIRE
// app on its splash screen even though none of these three dependencies were ever actually needed
// yet (they're all optional and already guarded with `if(window.X)` checks at USE time, per their
// own pre-existing comments -- the bug was in HOW they were loaded, not whether the app used them
// safely once loaded).
//
// Fix (v0.34.30): all three <script src> tags now have `defer`, so the browser keeps parsing/
// painting/running the rest of the page immediately regardless of how long (or whether) any of them
// ever finishes. The Leaflet stylesheet <link> (which has no defer attribute of its own) uses the
// standard media="print" -> onload swap-to-"all" trick to stay non-blocking too. Because Supabase's
// client (SB) used to be created synchronously, at top level, immediately after its script tag --
// something that now may well not have loaded yet by the time that line runs -- that init was pulled
// into its own initSupabaseClient() function, callable more than once safely (guarded by `!SB`), and
// wired to the script tag's own onload so a slow/late-loading CDN still eventually creates the real
// client and retries the one-time boot-sequence session-restore check (initSyncSession()) that would
// otherwise have already run too early and silently found SB still null.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('/tmp/node_modules/jsdom');

const htmlPath = path.join(__dirname, '..', 'halotraining-app', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

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
  // ---- Test 1: the Supabase, jsPDF, and Leaflet <script src> tags are all `defer`red -- a plain
  // static-markup check, since this is precisely the attribute whose absence caused the hang. ----
  const supabaseTagMatch = html.match(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"[^>]*>/);
  const jspdfTagMatch = html.match(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/[^"]*"[^>]*>/);
  const leafletJsTagMatch = html.match(/<script src="https:\/\/unpkg\.com\/leaflet@[^"]*\/leaflet\.js"[^>]*>/);
  const t1 = !!supabaseTagMatch && /\bdefer\b/.test(supabaseTagMatch[0])
    && !!jspdfTagMatch && /\bdefer\b/.test(jspdfTagMatch[0])
    && !!leafletJsTagMatch && /\bdefer\b/.test(leafletJsTagMatch[0]);
  console.log('Test 1 (Supabase/jsPDF/Leaflet <script src> tags are all deferred, never block the page):', t1?'PASS':'FAIL', {
    supabaseTag: supabaseTagMatch && supabaseTagMatch[0], jspdfTag: jspdfTagMatch && jspdfTagMatch[0], leafletJsTag: leafletJsTagMatch && leafletJsTagMatch[0]
  });

  // ---- Test 2: the Leaflet stylesheet <link> uses the non-blocking media=print/onload-swap trick,
  // since a <link rel=stylesheet> has no defer attribute of its own and would otherwise still be
  // able to block first paint the same way the old blocking <script> tags did. ----
  const leafletCssMatch = html.match(/<link rel="stylesheet" href="https:\/\/unpkg\.com\/leaflet@[^"]*\/leaflet\.css"[^>]*>/);
  const t2 = !!leafletCssMatch && /media="print"/.test(leafletCssMatch[0]) && /onload="this\.media='all'"/.test(leafletCssMatch[0]);
  console.log('Test 2 (Leaflet stylesheet uses the non-blocking media=print -> onload swap trick):', t2?'PASS':'FAIL', { leafletCssTag: leafletCssMatch && leafletCssMatch[0] });

  // ---- Test 3: the Supabase script tag's onload calls initSupabaseClient(), so a late-finishing
  // CDN load still eventually creates the real client instead of leaving SB stuck null forever. ----
  const t3 = !!supabaseTagMatch && /onload="initSupabaseClient\(\)"/.test(supabaseTagMatch[0]);
  console.log('Test 3 (Supabase script tag retries client creation via its own onload):', t3?'PASS':'FAIL');

  // ---- Test 4: initSupabaseClient() is idempotent -- window.supabase not present yet at boot (the
  // exact "slow/blocked CDN" scenario from the bug report) leaves SB null without throwing, and the
  // whole rest of the app (BLOCKS/DATA/renderAll etc. all being real, usable globals) still boots
  // normally -- i.e. the fix actually solves the splash-hang, not just the markup shape. ----
  const win = makeWindow();
  await wait(300);
  const bootOk = win.eval(`
    (function(){
      // window.supabase deliberately left undefined here, simulating a hung/blocked CDN fetch --
      // this is the exact condition that used to freeze the whole app on its splash screen.
      return typeof initSupabaseClient === 'function'
        && SB === null
        && typeof BLOCKS !== 'undefined'
        && typeof renderAll === 'function';
    })()
  `);
  console.log('Test 4 (app boots fully with SB left null when the CDN script has not loaded, no hang/throw):', bootOk?'PASS':'FAIL');

  // ---- Test 5: once the CDN script actually does finish (simulated here by stubbing window.supabase
  // after the fact, exactly like a late onload firing), calling initSupabaseClient() creates the real
  // client, and calling it again afterward is a safe no-op (doesn't recreate/replace SB). ----
  win.eval(`
    window.supabase = { createClient: function(url,key){ return { __fake:true, url, key }; } };
  `);
  win.eval(`initSupabaseClient();`);
  const sbAfterFirst = win.eval(`SB && SB.__fake===true`);
  win.eval(`window.supabase.createClient = function(){ throw new Error('should not be called again'); }; initSupabaseClient();`);
  const sbAfterSecondStillFine = win.eval(`SB && SB.__fake===true`);
  const t5 = sbAfterFirst === true && sbAfterSecondStillFine === true;
  console.log('Test 5 (initSupabaseClient creates the real client once the CDN script loads, and is idempotent afterward):', t5?'PASS':'FAIL', { sbAfterFirst, sbAfterSecondStillFine });
})();
