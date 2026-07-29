// Regression test for two real Dylon requests, both about the Progress tab's Activity Trends card:
// (1) "In the week breakdown merge same dates distances eg there are 3 entries on sund 26 but only
// 1.9km. what should happen is if i had 3 walks on sunday 26 cumulate all the walks on that day and
// only show the total. if there is no walks then hide the date. same for runs" -- renderTrendDayRows()
// used to render one row per underlying session/Quick-Add-extra entry (including a "-" placeholder row
// for every session in the week that had nothing logged for the selected trend), rather than grouping
// by calendar date and summing. Fixed by grouping into one row per date, summing every contributor, and
// dropping dates with nothing logged for that trend entirely.
// (2) "also remove dead hang filter dead hangs should be classified as a strength training exercise" --
// TREND_TYPES no longer has its own 'hang' entry/pill; dead hang data (NOTES.hangsets/.hangsec) is
// untouched on the session itself, just no longer a standalone trend category.
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

  // Test 1: TREND_TYPES no longer includes a 'hang' entry -- no separate Dead Hang pill.
  const t1 = win.eval(`JSON.stringify(TREND_TYPES.map(t=>t.id))`);
  const t1Ids = JSON.parse(t1);
  console.log('Test 1 (TREND_TYPES has no separate hang entry -- Dead Hang pill is gone):',
    !t1Ids.includes('hang') ? 'PASS' : 'FAIL', { t1Ids });

  // Test 2: the Activity Trends pill row itself doesn't render a "Dead Hang" button.
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2027-06-06',endDate:'2027-08-01',sessions:[
      {id:'s1',wk:1,day:0,wd:'Sun',ty:'str',date:'2027-06-06',ph:'dur',ti:'Full Body Strength'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; STATUS={s1:'done'};
    NOTES={s1:{hangsets:'3',hangsec:'30'}}; EXTRALOGS=[]; ACTIVITIES=[]; RACES_LIST=[];
    switchView('progress');
  `);
  const t2HTML = win.eval(`document.getElementById('view-progress').innerHTML`);
  console.log('Test 2 (Progress view renders no Dead Hang trend pill, but Strength still shows):',
    (!/Dead Hang/.test(t2HTML) && /Strength/.test(t2HTML)) ? 'PASS' : 'FAIL');

  // Test 3: renderTrendDayRows merges 3 separate walk entries on the same date into ONE row showing
  // their combined total, exactly Dylon's "3 entries on sund 26 but only 1.9km" report. Two Quick Add
  // walk extras (1.2km, 0.7km) both dated the same Sunday as a session that has no walk data of its
  // own (prewalk/postwalk blank) -- the merged row should show 1.9km total, not three rows.
  win.eval(`
    BLOCKS=[{id:'b2',name:'Test Block 2',startDate:'2027-06-06',endDate:'2027-08-01',sessions:[
      {id:'sEasy2',wk:1,day:0,wd:'Sun',ty:'easy',date:'2027-06-06',ph:'dur',ti:'Recovery Run'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b2'; STATUS={sEasy2:'done'}; NOTES={sEasy2:{}};
    EXTRALOGS=[
      {id:'x1',kind:'walk',date:'2027-06-06',dist:'1.2'},
      {id:'x2',kind:'walk',date:'2027-06-06',dist:'0.7'}
    ];
    ACTIVITIES=[];
  `);
  const t3HTML = win.eval(`renderTrendDayRows(1,'walk')`);
  const t3RowCount = (t3HTML.match(/trend-day-row/g)||[]).length;
  console.log('Test 3 (three same-date walk entries merge into one row totalling 1.9km):',
    (t3RowCount === 1 && /1\.9/.test(t3HTML) && /Sun/.test(t3HTML)) ? 'PASS' : 'FAIL', { t3HTML });

  // Test 4: a day with NOTHING logged for the selected trend is dropped entirely, not shown as a "-"
  // placeholder row -- "if there is no walks then hide the date."
  win.eval(`
    BLOCKS=[{id:'b3',name:'Test Block 3',startDate:'2027-06-06',endDate:'2027-08-01',sessions:[
      {id:'sA',wk:1,day:0,wd:'Sun',ty:'easy',date:'2027-06-06',ph:'dur',ti:'Recovery Run'},
      {id:'sB',wk:1,day:2,wd:'Tue',ty:'str',date:'2027-06-08',ph:'dur',ti:'Strength'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b3'; STATUS={sA:'done',sB:'done'}; NOTES={};
    EXTRALOGS=[]; ACTIVITIES=[];
  `);
  const t4HTML = win.eval(`renderTrendDayRows(1,'walk')`);
  console.log('Test 4 (a week with no walk data at all shows no day rows, just the empty-state note):',
    (!/trend-day-row/.test(t4HTML) && /Nothing logged this week/.test(t4HTML)) ? 'PASS' : 'FAIL', { t4HTML });

  // Test 5: a session's own real value AND a same-date Quick Add extra both contribute to one merged
  // total (not just multiple extras merging with each other) -- e.g. prewalk/postwalk on a run session
  // plus a separate Quick Add walk logged the same day.
  win.eval(`
    BLOCKS=[{id:'b4',name:'Test Block 4',startDate:'2027-06-06',endDate:'2027-08-01',sessions:[
      {id:'sC',wk:1,day:0,wd:'Sun',ty:'easy',date:'2027-06-06',ph:'dur',ti:'Recovery Run'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b4'; STATUS={sC:'done'};
    NOTES={sC:{prewalk:'0.5',postwalk:'0.4'}};
    EXTRALOGS=[{id:'x3',kind:'walk',date:'2027-06-06',dist:'1.0'}];
    ACTIVITIES=[];
  `);
  const t5HTML = win.eval(`renderTrendDayRows(1,'walk')`);
  const t5RowCount = (t5HTML.match(/trend-day-row/g)||[]).length;
  // 0.5 + 0.4 (session prewalk/postwalk) + 1.0 (extra) = 1.9
  console.log('Test 5 (a sessions own prewalk/postwalk and a same-date Quick Add extra merge into one total):',
    (t5RowCount === 1 && /1\.9/.test(t5HTML)) ? 'PASS' : 'FAIL', { t5HTML });

  // Test 6: renderTrendDayRows now includes imported/uploaded Activities in its per-day totals, not
  // just NOTES-based sessions and Quick Add extras -- Dylon: "uploaded data isnt added to the activity
  // trends breakdown," spotted as the big weekly number showing a real total while the breakdown below
  // it said "Nothing logged this week." A run-type Activity linked to nothing in particular (unplanned)
  // dated inside the week should show up in the walk/run breakdown same as weekMetricTotal() already
  // counts it in the big number above.
  win.eval(`
    BLOCKS=[{id:'b6',name:'Test Block 6',startDate:'2027-06-06',endDate:'2027-08-01',sessions:[
      {id:'sD',wk:1,day:0,wd:'Sun',ty:'easy',date:'2027-06-06',ph:'dur',ti:'Recovery Run'}
    ],mileagePlan:{1:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b6'; STATUS={sD:'done'}; NOTES={sD:{}};
    EXTRALOGS=[];
    ACTIVITIES=[];
    addActivity({type:'run',date:'2027-06-06',distanceKm:2.7,role:'unplanned'});
  `);
  const t6HTML = win.eval(`renderTrendDayRows(1,'run')`);
  const t6RowCount = (t6HTML.match(/trend-day-row/g)||[]).length;
  console.log('Test 6 (renderTrendDayRows includes an imported/uploaded Activitys distance in the day total):',
    (t6RowCount === 1 && /2\.7/.test(t6HTML)) ? 'PASS' : 'FAIL', { t6HTML });

  // Test 7: the big number/label above the chart ("X · Week N (currently viewing)") now reflects
  // whichever week was actually TAPPED on the chart, not just the current in-progress week -- Dylon:
  // "when i click a week in the activity trends the total doesnt change for past weeks." Week 1 has a
  // real walk total (1.9km via a Quick Add extra); Week 2 (the "current" week) has none logged yet.
  // Viewing with nothing tapped should show Week 2's own total (0/-), and tapping Week 1 on the chart
  // should flip the big number over to Week 1's real total instead of staying stuck on Week 2's.
  win.eval(`
    BLOCKS=[{id:'b7',name:'Test Block 7',startDate:'2027-06-06',endDate:'2027-08-01',sessions:[
      {id:'sE',wk:1,day:0,wd:'Sun',ty:'easy',date:'2027-06-06',ph:'dur',ti:'Recovery Run'},
      {id:'sF',wk:2,day:0,wd:'Sun',ty:'easy',date:'2027-06-13',ph:'dur',ti:'Recovery Run'}
    ],mileagePlan:{1:20,2:20}}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b7'; STATUS={sE:'done',sF:'done'}; NOTES={};
    EXTRALOGS=[{id:'x7',kind:'walk',date:'2027-06-06',dist:'1.9'}];
    ACTIVITIES=[];
    CURR_WK=2; CURR_TREND='walk'; CURR_TREND_WK=null;
    switchView('progress');
  `);
  const t7Wk2HTML = win.eval(`document.getElementById('view-progress').innerHTML`);
  win.eval(`toggleTrendWeek(1);`);
  const t7Wk1HTML = win.eval(`document.getElementById('view-progress').innerHTML`);
  console.log('Test 7 (tapping a past week on the chart updates the big total to that weeks own number):',
    (/Week 2 \(currently viewing\)/.test(t7Wk2HTML) && !/1\.9.*Week 2 \(currently viewing\)/.test(t7Wk2HTML) &&
     /1\.9/.test(t7Wk1HTML) && /Week 1 \(currently viewing\)/.test(t7Wk1HTML)) ? 'PASS' : 'FAIL');

  await wait(200);
  win.close();
})();
