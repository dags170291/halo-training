// Regression test for giving every activity type its own soft gradient tint. Dylon: "in the activity
// tab workout sessions have a gradient colour, running have a gradient colour, but not for the other
// activities give each activity type its own soft gradient colour like running and workout."
//
// ICO_CARD_TINT (the map historyItemCardHTML() uses for each card's full-card gradient background) and
// the underlying .ico-X badge CSS classes already covered Run (ico-easy), Workout (ico-qual), Long,
// Strength, Race, Yoga, and Check-in -- but Walk/Mobility/Weight fell back to a plain grey badge
// (var(--s3)/var(--t3)) and had no ICO_CARD_TINT entry at all, so their cards stayed a flat, untinted
// background. Fixed by wiring .ico-walk to the already-existing (but previously unused) --walk/--walk2/
// --walk3 tokens, adding new --mob (soft rose) and --wt (soft khaki-gold) token families for Mobility
// and Weight, and adding all three to ICO_CARD_TINT following the exact same pattern every other type
// already uses (badge bg tier doubles as the card gradient's bright stop, fading to --s1).
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

  // ---- Test 1: ICO_CARD_TINT now has real gradient entries for Walk/Mobility/Weight, not just
  // Run/Workout/Strength/Long/Race/Yoga/Check-in. ----
  const tint = win.eval(`JSON.stringify(ICO_CARD_TINT)`);
  const tintObj = JSON.parse(tint);
  const hasAllThree = ['ico-walk','ico-mobility','ico-weight'].every(k=>typeof tintObj[k]==='string' && /linear-gradient/.test(tintObj[k]));
  console.log('Test 1 (ICO_CARD_TINT has real gradient entries for Walk/Mobility/Weight):',
    hasAllThree ? 'PASS' : 'FAIL', { tintObj });

  // ---- Test 2: none of the three reuse the plain grey --s1/--s3/--t3 tokens the old fallback used --
  // each references its own dedicated color family (--walk3/--mob3/--wt3). ----
  const noGreyFallback = !/var\(--s3\)/.test(tintObj['ico-walk']) && !/var\(--s3\)/.test(tintObj['ico-mobility']) && !/var\(--s3\)/.test(tintObj['ico-weight'])
    && /var\(--walk3\)/.test(tintObj['ico-walk']) && /var\(--mob3\)/.test(tintObj['ico-mobility']) && /var\(--wt3\)/.test(tintObj['ico-weight']);
  console.log('Test 2 (Walk/Mobility/Weight each use their own dedicated color family, not a grey fallback):',
    noGreyFallback ? 'PASS' : 'FAIL');

  // ---- Test 3: the underlying .ico-walk/.ico-mobility/.ico-weight badge CSS classes were updated too
  // (not just the card tint) -- they no longer sit on the generic --s3/--t3 grey pair. ----
  const cssBlock = html.match(/\.ico-walk\{[^}]*\}/)[0]+html.match(/\.ico-mobility\{[^}]*\}/)[0]+html.match(/\.ico-weight\{[^}]*\}/)[0];
  const badgesUpdated = /var\(--walk3\)/.test(cssBlock) && /var\(--walk\)/.test(cssBlock)
    && /var\(--mob3\)/.test(cssBlock) && /var\(--mob\)/.test(cssBlock)
    && /var\(--wt3\)/.test(cssBlock) && /var\(--wt\)/.test(cssBlock)
    && !/var\(--s3\)/.test(cssBlock);
  console.log('Test 3 (the .ico-walk/.ico-mobility/.ico-weight badge CSS classes use their own real colors, not grey):',
    badgesUpdated ? 'PASS' : 'FAIL', { cssBlock });

  // ---- Test 4: a real rendered Activities-tab card for each of the three types actually carries its
  // new tint as an inline background style, same mechanism historyItemCardHTML() already uses for
  // Run/Strength/etc. ----
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2027-06-01',endDate:'2027-08-01',sessions:[]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; STATUS={}; NOTES={}; RACES_LIST=[];
    EXTRALOGS=[{id:'wt1',kind:'weight',date:'2027-06-05',weight:'78',tags:[]}];
    ACTIVITIES=[];
    addActivity({id:'walk1',type:'walk',role:'unplanned',date:'2027-06-05',startTime:'07:00',distanceKm:3,durationSec:1800,title:'Morning Walk'});
    addActivity({id:'mob1',type:'mobility',role:'unplanned',date:'2027-06-05',startTime:'20:00',durationSec:900,title:'Evening Mobility'});
  `);
  const walkCard = win.eval(`historyItemCardHTML({kind:'activity',ty:'walk',date:'2027-06-05',id:'walk1'})`);
  const mobCard = win.eval(`historyItemCardHTML({kind:'activity',ty:'mobility',date:'2027-06-05',id:'mob1'})`);
  const wtCard = win.eval(`historyItemCardHTML({kind:'extra',ty:'weight',date:'2027-06-05',id:'wt1'})`);
  const walkTinted = /background:linear-gradient\(160deg,var\(--walk3\)/.test(walkCard);
  const mobTinted = /background:linear-gradient\(160deg,var\(--mob3\)/.test(mobCard);
  const wtTinted = /background:linear-gradient\(160deg,var\(--wt3\)/.test(wtCard);
  console.log('Test 4 (real rendered cards for Walk/Mobility/Weight each carry their new gradient tint):',
    (walkTinted && mobTinted && wtTinted) ? 'PASS' : 'FAIL', { walkTinted, mobTinted, wtTinted });

  // ---- Test 5: the new color tokens are defined in BOTH the dark (:root) and light (.theme-light)
  // theme blocks, not just one -- otherwise the light theme would silently fall back to an invalid/
  // undefined CSS variable. ----
  const darkBlock = html.slice(html.indexOf(':root{'), html.indexOf(':root.theme-light'));
  const lightBlock = html.slice(html.indexOf(':root.theme-light'), html.indexOf('body.phase-durability'));
  const definedInBoth = ['--mob:','--mob2:','--mob3:','--wt:','--wt2:','--wt3:'].every(v=>darkBlock.includes(v)&&lightBlock.includes(v));
  console.log('Test 5 (the new --mob/--wt color tokens are defined in both dark and light theme blocks):',
    definedInBoth ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
