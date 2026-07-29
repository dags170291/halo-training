// Regression test for plan-download filenames. Dylon: "when downloading the training plan via pdf
// it renames the file to the current week. the plan should be renamed using the following
// convention 'athlete-trainingplantitle'." Every plan-download function (PDF/Markdown/ICS, both
// Block 5's own hardcoded downloader and the generic one every other block uses) now shares a single
// planDownloadFilename(b,ext) helper built from PROFILE.name + the block's planTitle (falling back to
// its short name), via a new slugify() helper -- instead of each picking its own ad hoc name.
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
process.on('uncaughtException', () => {});

(async () => {
  const win = makeWindow();
  await wait(400);

  // Test 1: slugify lowercases, hyphenates, and trims.
  const t1 = win.eval(`slugify('  Dylon Smith Whiskey  ')`);
  console.log('Test 1 (slugify lowercases/hyphenates/trims):', t1 === 'dylon-smith-whiskey' ? 'PASS' : `FAIL (got ${JSON.stringify(t1)})`);

  // Test 2: slugify collapses runs of non-alphanumeric characters into a single hyphen.
  const t2 = win.eval(`slugify('2026 Block 5 - Durability & Ignition')`);
  console.log('Test 2 (slugify collapses punctuation/spaces into single hyphens):',
    t2 === '2026-block-5-durability-ignition' ? 'PASS' : `FAIL (got ${JSON.stringify(t2)})`);

  // Test 3: planDownloadFilename uses PROFILE.name + the block's planTitle.
  win.eval(`PROFILE={name:'Dylon Smith Whiskey'};`);
  const t3 = win.eval(`planDownloadFilename({name:'Block 5',planTitle:'2026 Block 5 - Durability & Ignition'},'pdf')`);
  console.log('Test 3 (filename built from athlete name + planTitle):',
    t3 === 'dylon-smith-whiskey-2026-block-5-durability-ignition.pdf' ? 'PASS' : `FAIL (got ${JSON.stringify(t3)})`);

  // Test 4: falls back to the block's short name when planTitle is missing.
  const t4 = win.eval(`planDownloadFilename({name:'Beginner Plan'},'md')`);
  console.log('Test 4 (falls back to block.name when planTitle is missing):',
    t4 === 'dylon-smith-whiskey-beginner-plan.md' ? 'PASS' : `FAIL (got ${JSON.stringify(t4)})`);

  // Test 5: falls back to 'athlete'/'training-plan' when both PROFILE.name and title info are missing.
  win.eval(`PROFILE={};`);
  const t5 = win.eval(`planDownloadFilename({},'ics')`);
  console.log('Test 5 (falls back to athlete/training-plan when nothing is set):',
    t5 === 'athlete-training-plan.ics' ? 'PASS' : `FAIL (got ${JSON.stringify(t5)})`);
  win.eval(`PROFILE={name:'Dylon Smith Whiskey'};`);

  // Test 6: downloadBlock5PlanPDF (Block 5's own hardcoded PDF downloader) uses the new convention,
  // not a hardcoded 'Block5_Training_Plan.pdf' name and never anything week-numbered. jsdom doesn't
  // implement URL.createObjectURL or a real anchor click, so both are stubbed the same way
  // test_ics_export.js already does for this exact class of download function.
  win.eval(`
    BLOCKS=[{id:'block5',name:'Block 5',planTitle:'2026 Block 5 - Durability & Ignition',startDate:'2027-01-01',endDate:'2027-03-01',sessions:[],mileagePlan:{}}];
    ACTIVE_BLOCK_ID='block5'; DATA=BLOCKS[0].sessions;
    window.__lastDownloadName=null;
    URL.createObjectURL=()=>'blob:mock';
    URL.revokeObjectURL=()=>{};
    HTMLAnchorElement.prototype.click=function(){ window.__lastDownloadName=this.download; };
    downloadBlock5PlanPDF();
  `);
  const t6 = win.eval(`__lastDownloadName`);
  console.log('Test 6 (Block 5 PDF download uses athlete-planTitle, not a week number or hardcoded name):',
    t6 === 'dylon-smith-whiskey-2026-block-5-durability-ignition.pdf' ? 'PASS' : `FAIL (got ${JSON.stringify(t6)})`);

  // Test 7: the generic downloadPlanMarkdown (every non-Block-5 block) uses the same convention.
  win.eval(`
    BLOCKS=[{id:'blockX',name:'Beginner Plan',planTitle:'8-Week 5K Beginner Plan',startDate:'2027-01-01',endDate:'2027-03-01',sessions:[],mileagePlan:{}}];
    ACTIVE_BLOCK_ID='blockX'; DATA=BLOCKS[0].sessions;
    window.__lastDownloadName=null;
    downloadPlanMarkdown();
  `);
  const t7 = win.eval(`__lastDownloadName`);
  console.log('Test 7 (generic block Markdown download uses athlete-planTitle too):',
    t7 === 'dylon-smith-whiskey-8-week-5k-beginner-plan.md' ? 'PASS' : `FAIL (got ${JSON.stringify(t7)})`);

  process.exit(0);
})();
