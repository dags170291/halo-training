// Regression test for the v0.32.14 Progress tab reorg/cleanup batch. Dylon, in one message: "place
// the footer text inside of the card remember we dont want floating texts. also the 2w 4w block
// switch doesnt seem to work. also we need to reorder and clean up the progress tab. 1. move personal
// best to the profile 2. remove training load from progress (leave it in recovery) 3. Move week
// recap to the week summary in the schedule (that area when u click into a week card in schedule) 4.
// move the current block progress bar to Current block card in the progress tab 5. in that card
// remove the completion % since the progress bar will cater for that place best streak and km logged
// in the same row. 6. move activity trends just below the grid."
//
// Personal Bests (item 1) and Training Load (item 2) are covered by test_pb_section_move.js and
// test_training_load_fullwidth.js respectively -- this file covers items 3-6, plus the two reported
// bugs (floating caption, broken-looking range switch).
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
function buildBlock(win, startISO, weeks) {
  return win.eval(`
    (function(){
      const start = new Date('${startISO}T12:00:00');
      const sessions = [];
      const mileagePlan = {};
      for (let w=1; w<=${weeks}; w++){
        const d = new Date(start); d.setDate(d.getDate() + (w-1)*7);
        const iso = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        sessions.push({id:'w'+w+'s1', wk:w, ty:'easy', date: iso, ph:'dur'});
        mileagePlan[w] = 20;
      }
      BLOCKS = [{id:'b1', name:'Test Block', startDate: sessions[0].date, endDate: sessions[sessions.length-1].date, sessions, mileagePlan}];
      DATA = BLOCKS[0].sessions;
      MILEAGE_PLAN = mileagePlan;
      ACTIVE_BLOCK_ID = 'b1';
      STATUS = {};
      NOTES = {};
      RACES_LIST = [];
      EXTRALOGS = [];
      return sessions.map(s=>s.date);
    })()
  `);
}

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);
  win.eval(`window.renderAll = function(){};`);
  win.eval(`__origTodayISO = todayISO; todayISO = function(){ return '2026-07-21'; };`);

  buildBlock(win, '2026-06-02', 10);
  win.eval(`
    STATUS['w1s1']='done'; NOTES['w1s1']={pace:'6:00',hr:150,dist:'20'};
    STATUS['w2s1']='done'; NOTES['w2s1']={pace:'5:00',hr:140,dist:'18'};
    PROGRESS_SUB='main';
  `);

  // ==== Item 3: Week Recap moved into Schedule's week-detail panel ====

  // ---- Test 1: weekRecapHTML(wk) now takes an explicit week and recaps THAT week (not always
  // currentRealWeek()-1) -- week 1 has a done session with pace+HR+dist logged, so it should render
  // real content ----
  const wk1Recap = win.eval(`weekRecapHTML(1)`);
  console.log('Test 1 (weekRecapHTML(wk) recaps the explicit week passed in, not a hardcoded "last week"):',
    (wk1Recap.includes('Week 1 Recap') && wk1Recap.includes('Sessions done')) ? 'PASS' : 'FAIL', { wk1Recap });

  // ---- Test 2: Week Recap no longer renders anywhere inside the real Progress tab ----
  win.eval(`renderProgress();`);
  const progressHTML = win.eval(`document.getElementById('view-progress').innerHTML`);
  console.log('Test 2 (Week Recap no longer renders inside the Progress tab):',
    !progressHTML.includes('Recap') ? 'PASS' : 'FAIL');

  // ---- Test 3: opening Week 1's detail panel in Schedule (the real click-into-a-week-card flow)
  // shows that week's own recap, right there in the panel ----
  win.eval(`openWeekDetail(1);`);
  const weekDetailHTML = win.eval(`document.getElementById('view-week').innerHTML`);
  console.log('Test 3 (opening a week card in Schedule shows that week\\u2019s own Week Recap in the detail panel):',
    (weekDetailHTML.includes('Week 1 Recap') && weekDetailHTML.includes('Sessions done')) ? 'PASS' : 'FAIL');

  // ---- Test 4: a future week with nothing logged yet shows no recap at all (not a broken empty
  // card) -- week 9 has no STATUS/EXTRALOGS entries ----
  win.eval(`openWeekDetail(9);`);
  const futureWeekHTML = win.eval(`document.getElementById('view-week').innerHTML`);
  console.log('Test 4 (a week with nothing logged shows no Week Recap at all in its detail panel):',
    !futureWeekHTML.includes('Recap') ? 'PASS' : 'FAIL');

  // ==== Item 6: Activity Trends moved right below the stat-grid ====

  // ---- Test 5: in the real Progress tab, "Activity Trends" now appears BEFORE "Current Block",
  // right after the stat-grid closes ----
  win.eval(`openWeekDetail(1); renderProgress();`); // reset PLAN_VIEW noise, re-render progress
  const progressHTML2 = win.eval(`document.getElementById('view-progress').innerHTML`);
  const gridEndIdx = progressHTML2.indexOf('Current streak');
  const trendsIdx = progressHTML2.indexOf('Activity Trends');
  const currentBlockIdx = progressHTML2.indexOf('Current Block');
  console.log('Test 5 (Activity Trends renders right after the stat-grid, before Current Block):', {
    gridEndIdx, trendsIdx, currentBlockIdx,
    result: (gridEndIdx>=0 && trendsIdx>gridEndIdx && currentBlockIdx>trendsIdx) ? 'PASS' : 'FAIL'
  });

  // ==== Item 4+5: block progress bar merged into Current Block card, Completion % removed, Best
  // Streak + km Logged share one row ====

  // ---- Test 6: currentBlockGlanceCardHTML() includes the phase-track progress bar (done/total
  // sessions), no longer has a "Completion" stat box, and Best Streak + km Logged both still appear ----
  const blockCardHTML = win.eval(`currentBlockGlanceCardHTML()`);
  console.log('Test 6 (Current Block card has the progress bar, no Completion % box, Best Streak + km Logged both present):', {
    hasBar: blockCardHTML.includes('phase-track'),
    noCompletion: !blockCardHTML.includes('Completion'),
    hasStreak: blockCardHTML.includes('Best Streak'),
    hasKmLogged: blockCardHTML.includes('km Logged'),
    result: (blockCardHTML.includes('phase-track') && !blockCardHTML.includes('Completion') &&
      blockCardHTML.includes('Best Streak') && blockCardHTML.includes('km Logged')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 7: the old standalone "Block Progress" section is gone from Progress entirely --
  // blockProgressCardHTML no longer exists as a function at all ----
  const blockProgressFnGone = win.eval(`typeof blockProgressCardHTML==='undefined'`);
  console.log('Test 7 (the old standalone Block Progress section/function is gone -- merged into Current Block instead):',
    blockProgressFnGone ? 'PASS' : 'FAIL');

  // ---- Test 8: Best Streak and km Logged render inside the SAME stat-grid row (2 boxes), not 3 --
  // confirmed by counting stat-box divs in the card ----
  const statBoxCount = (blockCardHTML.match(/class="stat-box"/g)||[]).length;
  console.log('Test 8 (Best Streak + km Logged are the only two stat boxes left in the row):',
    statBoxCount===2 ? 'PASS' : 'FAIL', { statBoxCount });

  // ==== Reported bug 1: Race Predictions footer caption floating outside the card ====

  win.eval(`
    EXTRALOGS=[{id:'x1',kind:'run',dist:5,pace:'5:00',date:'2026-07-20'}];
  `);
  const rpredHTML = win.eval(`racePredictionsCardHTML()`);
  // The card opens with exactly one <div class="card"> and the caption's own </div> should be
  // immediately followed by the card's closing </div> and nothing else -- i.e. inside, not floating
  // after it as a sibling.
  const captionInsideCard = /Updates automatically as you log new efforts[^<]*<\/div>\s*<\/div>\s*$/.test(rpredHTML);
  console.log('Test 9 (Race Predictions footer caption sits inside the card, not floating after it):',
    captionInsideCard ? 'PASS' : 'FAIL', { rpredHTMLTail: rpredHTML.slice(-200) });

  // ==== Reported bug 2: 2W/4W/Block range switch "doesn't work" ====

  // ---- Test 10: the range buttons no longer inherit the browser's default focus/tap-highlight ring
  // -- outline:none + transparent tap-highlight are set directly on .rpred-range-btn ----
  const rangeBtnCSSMatch = html.match(/\.rpred-range-btn\{([^}]*)\}/);
  console.log('Test 10 (.rpred-range-btn explicitly kills outline and tap-highlight-color):', {
    css: rangeBtnCSSMatch && rangeBtnCSSMatch[1],
    result: (rangeBtnCSSMatch && /outline:none/.test(rangeBtnCSSMatch[1]) && /-webkit-tap-highlight-color:transparent/.test(rangeBtnCSSMatch[1])) ? 'PASS' : 'FAIL'
  });

  // ---- Test 11: clicking through the range buttons in the real live DOM (not just calling the JS
  // function directly) actually updates which pill is active and re-renders the card -- confirms the
  // underlying switch logic genuinely works end-to-end, not just in isolation ----
  win.eval(`selectRacePredDist('5K'); CURR_RACE_PRED_RANGE='block'; renderProgress();`);
  const clicked2w = win.eval(`
    (function(){
      const btns = Array.from(document.querySelectorAll('#view-progress .rpred-range-btn'));
      const btn2w = btns.find(b=>b.textContent.trim()==='2W');
      if(!btn2w) return null;
      btn2w.click();
      return CURR_RACE_PRED_RANGE;
    })()
  `);
  const activeAfterClick = win.eval(`
    (function(){
      const btns = Array.from(document.querySelectorAll('#view-progress .rpred-range-btn'));
      const active = btns.find(b=>b.classList.contains('active'));
      return active ? active.textContent.trim() : null;
    })()
  `);
  console.log('Test 11 (clicking the 2W button in the live DOM updates CURR_RACE_PRED_RANGE and moves the active pill):', {
    clicked2w, activeAfterClick,
    result: (clicked2w==='2w' && activeAfterClick==='2W') ? 'PASS' : 'FAIL'
  });

  win.eval(`todayISO = __origTodayISO;`);
  await wait(200);
  win.close();
})();
