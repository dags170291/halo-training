// Regression test: the "Need a plan? / Already have a plan?" copy under Upload Plan/Generate a Plan
// used to be bare centered text with no visual container, reported as looking like a floating,
// disconnected caption. Now wrapped in a proper bordered card, left-aligned, split into two readable
// lines, with a small icon — same visual language as the rest of the app's info boxes.
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

  const headerHTML = win.eval(`planUploadHeaderHTML()`);

  // ---- Test 1: the tip copy is now wrapped in a real bordered card, not bare floating text ----
  const isInCard = /<div class="card"[^>]*>[\s\S]*Need a plan\?/.test(headerHTML);
  console.log('Test 1 (tip copy is wrapped in a bordered card container):', isInCard ? 'PASS' : 'FAIL');

  // ---- Test 2: no longer center-aligned bare text (the old floating-caption look) ----
  const noCenteredBareText = !headerHTML.includes('text-align:center');
  console.log('Test 2 (no longer center-aligned as a bare caption):', noCenteredBareText ? 'PASS' : 'FAIL');

  // ---- Test 3: the two sentences are visually split into two separate lines, not one run-on paragraph ----
  const hasTwoLines = headerHTML.includes('Need a plan?') && headerHTML.includes('Already have a plan from a coach') &&
    /Need a plan\?[\s\S]*?<\/div>\s*<div[^>]*>\s*Already have a plan/.test(headerHTML);
  console.log('Test 3 (the two messages render as two separate lines within the box):', hasTwoLines ? 'PASS' : 'FAIL');

  // ---- Test 4: carries a small icon for visual weight, consistent with other info boxes ----
  const hasIcon = headerHTML.includes('M513.5-254.5Q528-269 528-290');
  console.log('Test 4 (tip box carries the standard help icon):', hasIcon ? 'PASS' : 'FAIL');

  // ---- Test 5: the "View the AI prompt" link is still present and still wired to togglePromptView ----
  const linkStillWorks = headerHTML.includes('onclick="togglePromptView();return false;"') && headerHTML.includes('View the AI prompt');
  console.log('Test 5 (View the AI prompt link still wired to togglePromptView):', linkStillWorks ? 'PASS' : 'FAIL');

  // ---- Test 6: rendering it in the actual Plans sheet doesn't throw and the box actually appears in the DOM ----
  let renderedOk = true;
  try { win.eval(`openPlans();`); } catch(e){ renderedOk = false; console.log('  -> threw:', e.message); }
  const boxInDom = win.eval(`
    const cards = Array.from(document.querySelectorAll('#plans-sh-body .card'));
    cards.some(c => c.textContent.includes('Need a plan?') && c.textContent.includes('Already have a plan'));
  `);
  console.log('Test 6 (tip box actually renders inside the real Plans sheet):', (renderedOk && boxInDom) ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
