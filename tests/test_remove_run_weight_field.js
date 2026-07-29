// Regression test for a real request (Dylon: "Remove the ability to log weight inside of the run
// data weight will be logged stand alone."). Weight already had its own standalone entry point —
// Quick Add > Weight (openQuickAdd('weight'), field id qa-weight, EXTRALOGS kind 'weight') — so
// letting a run/qual session's own logging form ALSO capture a "Weight check-in (kg)" (field id
// l-weight, inside the Run Data section of sessionLogFieldsHTML) was a redundant second entry
// point for the exact same data. Fix: removed the l-weight input from the Run Data section, and
// removed 'weight' from captureLogFields()'s generic field list (the id it read from no longer
// exists, so leaving it there was dead code). Historical n.weight values already logged this way
// on old sessions are deliberately left alone everywhere else (weekWeight(), CSV export, the
// History feed, hasLoggedData) — this removes the future ability to log it here, it does not
// erase what testers may have already recorded.
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

  // Fixture: a plain easy-run session, nothing logged yet.
  win.eval(`
    BLOCKS.push({id:'wtblock',name:'Weight Test Block',startDate:'2027-03-01',sessions:[
      {id:'wt-run',wk:1,d:'D1',date:'2027-03-01',wd:'Mon',ty:'easy',ti:'Easy Run',full:'Weight Test Block: Easy Run',det:'Easy.',dist:'8'}
    ]});
  `);

  // Test 1: the Run Data section of the session log form no longer contains a weight input.
  const runDataHTML = win.eval(`sessionLogFieldsHTML(findSess('wt-run'), NOTES['wt-run']||{})`);
  const hasWeightField = /id="l-weight"/.test(runDataHTML) || /Weight check-in/i.test(runDataHTML);
  console.log('Test 1 (Run Data section has no weight check-in field):', !hasWeightField ? 'PASS' : 'FAIL');

  // Test 2: even if an l-weight element somehow exists in the DOM (e.g. stale markup), saving a
  // session's log no longer copies it into NOTES[id].weight going forward.
  win.eval(`
    document.getElementById('log-sh-body') && (document.getElementById('log-sh-body').innerHTML += '<input id="l-weight" value="80.5">');
    document.getElementById('l-dist') || (document.body.innerHTML += '<input id="l-dist" value="8"><input id="l-status" value="completed">');
  `);
  win.eval(`captureLogFields('wt-run');`);
  const weightAfterCapture = win.eval(`NOTES['wt-run'] && NOTES['wt-run'].weight`);
  console.log('Test 2 (captureLogFields no longer writes a weight value):', (weightAfterCapture === undefined || weightAfterCapture === null) ? 'PASS' : 'FAIL');

  // Test 3: standalone Quick Add > Weight is untouched — its own field/id/save-path still exist.
  const qaHTML = win.eval(`buildQuickAddBody('weight', null)`);
  const qaOk = /id="qa-weight"/.test(qaHTML);
  console.log('Test 3 (standalone Quick Add Weight field is untouched):', qaOk ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
