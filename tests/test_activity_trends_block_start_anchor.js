// Regression test for a bug I (Claude) introduced while fixing a different bug -- twice in a row.
// v0.34.1 anchored trendCalWeek() to the calendar Monday of BLOCK_START's own week. Dylon, still seeing
// wrong running totals after that: "why is it so hard to just add up individual running stats?" That led
// to v0.34.3, which switched to matching parsePlanJSON()'s own `addDaysISO(BLOCK_START,(week-1)*7+day)`
// formula instead -- reasoning that a block's week boundaries follow BLOCK_START's own weekday, not the
// calendar Monday. THAT reasoning was itself wrong, and Dylon proved it by laying out a full week of real
// logged runs day by day: Monday 20th through Sunday 26th as one real Monday-Sunday training week
// (5.2+0.8+6.2+5.1+8.2+2.7 = 28.2km), Monday 27th onward as the next. The v0.34.3 BLOCK_START-anchored
// version (BLOCK_START = 2026-07-19, a Sunday) put week 1's boundary at Sat 07-25, misattributing Sunday
// 07-26's 2.7km Recovery Run into "Week 2" instead -- inflating week 2 and undercounting week 1 relative
// to the real Monday-Sunday split Dylon (and Strava) actually use.
//
// The real reason BLOCK_START isn't the right anchor: Block 5's own plan data describes 2026-07-19 as a
// standalone PREP day, not the start of training -- its own session detail text literally reads "The
// block runs Monday to Sunday, so today is prep, not training." Real Week 1 starts the FOLLOWING Monday
// (2026-07-20), not BLOCK_START's own weekday. Fix: trendCalWeek() now anchors to the first real Monday
// ON OR AFTER BLOCK_START (not the Monday of BLOCK_START's own week, which rounds DOWN when BLOCK_START
// isn't already a Monday) -- genuine Monday-Sunday weeks from there on, any lead-in prep day before that
// first Monday folding into week 1 via the same clamping as before.
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

  // Dylon's own real logged data, reconstructed exactly as reported: BLOCK_START 2026-07-19 (Sun, prep
  // day, no session of its own in this fixture). Week 1: Mon 20 (Easy Run 5.2km + Strides 0.8km), Wed 22
  // (Easy Run 6.2km), Thu 23 (Recovery Run 5.1km), Sat 25 (Long Run 8.2km), Sun 26 (Recovery Run 2.7km).
  // Week 2 (partial): Mon 27 (Easy Run 8.2km + Strides 0.9km), Wed 29 (Fartlek Bridge 5.4km). Strides are
  // logged as standalone unplanned Activities (matching how a watch often exports them as a separate
  // short activity rather than folded into the main run file).
  win.eval(`
    BLOCKS=[{id:'b1',name:'Test Block',startDate:'2026-07-19',endDate:'2026-09-27',mileagePlan:{1:20,2:20,3:20},sessions:[
      {id:'w1d1',wk:1,d:'D1',ty:'easy',date:'2026-07-20',wd:'Mon',ti:'Easy Run + Strides',full:'',det:'',dist:'5K'},
      {id:'w1d2',wk:1,d:'D2',ty:'easy',date:'2026-07-22',wd:'Wed',ti:'Easy Run',full:'',det:'',dist:'6K'},
      {id:'w1d3',wk:1,d:'D3',ty:'easy',date:'2026-07-23',wd:'Thu',ti:'Recovery Run',full:'',det:'',dist:'5K'},
      {id:'w1d4',wk:1,d:'D4',ty:'long',date:'2026-07-25',wd:'Sat',ti:'Long Run',full:'',det:'',dist:'8K'},
      {id:'w1d5',wk:1,d:'D5',ty:'easy',date:'2026-07-26',wd:'Sun',ti:'Recovery Run',full:'',det:'',dist:'3K'},
      {id:'w2d1',wk:2,d:'D1',ty:'easy',date:'2026-07-27',wd:'Mon',ti:'Easy Run + Strides',full:'',det:'',dist:'8K'},
      {id:'w2d2',wk:2,d:'D2',ty:'easy',date:'2026-07-29',wd:'Wed',ti:'Fartlek Bridge',full:'',det:'',dist:'5K'}
    ]}];
    DATA=BLOCKS[0].sessions; ACTIVE_BLOCK_ID='b1'; BLOCK_START='2026-07-19'; BLOCK_END='2026-09-27';
    STATUS={w1d1:'done',w1d2:'done',w1d3:'done',w1d4:'done',w1d5:'done',w2d1:'done',w2d2:'done'};
    NOTES={
      w1d1:{dist:'5.2'}, w1d2:{dist:'6.2'}, w1d3:{dist:'5.1'}, w1d4:{dist:'8.2'}, w1d5:{dist:'2.7'},
      w2d1:{dist:'8.2'}, w2d2:{dist:'5.4'}
    };
    ACTIVITIES=[
      {id:'strides1',type:'run',date:'2026-07-20',distanceKm:0.8,linkedSessionId:null,role:'unplanned'},
      {id:'strides2',type:'run',date:'2026-07-27',distanceKm:0.9,linkedSessionId:null,role:'unplanned'}
    ];
    EXTRALOGS=[];
  `);

  // ---- Test 1: confirms BLOCK_START itself really is a Sunday, not a Monday -- the precondition that
  // makes anchoring to BLOCK_START's own weekday wrong for this block. ----
  const t1 = win.eval(`new Date(BLOCK_START+'T12:00:00').getDay()`);
  console.log('Test 1 (this block\'s BLOCK_START, 2026-07-19, is a Sunday -- getDay()===0):',
    t1===0 ? 'PASS' : 'FAIL', { t1 });

  // ---- Test 2: the actual reported bug -- Sunday 07-26's Recovery Run buckets into WEEK 1 (the same
  // real Monday-Sunday week as the rest of that week's runs), not week 2. The old BLOCK_START-anchored
  // version put week 1's boundary at Saturday 07-25, misattributing this into week 2 instead. ----
  const t2 = win.eval(`trendCalWeek('2026-07-26')`);
  console.log('Test 2 (Sunday 07-26 buckets into week 1, the real Monday-Sunday week it belongs to):',
    t2===1 ? 'PASS' : 'FAIL', { t2 });

  // ---- Test 3: the plan's own week-1 sessions (Mon 20 through Sun 26) all agree with trendCalWeek(),
  // and week-2's first session (Mon 27) correctly starts a new week. ----
  const t3 = win.eval(`JSON.stringify({
    mon20: trendCalWeek('2026-07-20'), wed22: trendCalWeek('2026-07-22'), thu23: trendCalWeek('2026-07-23'),
    sat25: trendCalWeek('2026-07-25'), sun26: trendCalWeek('2026-07-26'),
    mon27: trendCalWeek('2026-07-27'), wed29: trendCalWeek('2026-07-29')
  })`);
  const t3parsed = JSON.parse(t3);
  const t3AllWeek1 = [t3parsed.mon20,t3parsed.wed22,t3parsed.thu23,t3parsed.sat25,t3parsed.sun26].every(w=>w===1);
  const t3AllWeek2 = [t3parsed.mon27,t3parsed.wed29].every(w=>w===2);
  console.log('Test 3 (every date Mon 20 - Sun 26 buckets into week 1; Mon 27 and Wed 29 both bucket into week 2):',
    (t3AllWeek1 && t3AllWeek2) ? 'PASS' : 'FAIL', t3parsed);

  // ---- Test 4: the real-world consequence Dylon proved by hand -- week 1's running total is exactly
  // 28.2km (5.2+0.8+6.2+5.1+8.2+2.7), week 2's (partial, through Wed 29) is exactly 14.5km (8.2+0.9+5.4).
  // Nothing bleeds across the Sunday/Monday boundary either direction. ----
  const t4 = win.eval(`allWeeklyTotals('run')`);
  console.log('Test 4 (week 1 totals exactly 28.2km, week 2 (partial) totals exactly 14.5km -- matching Dylon\'s own hand count):',
    (Math.abs(t4[0]-28.2)<0.01 && Math.abs(t4[1]-14.5)<0.01) ? 'PASS' : 'FAIL', { t4 });

  // ---- Test 5: the week-1 day-by-day breakdown shows Sunday 07-26's real date; week 2's breakdown does
  // not. ----
  const wk1Breakdown = win.eval(`renderTrendDayRows(1,'run')`);
  const wk2Breakdown = win.eval(`renderTrendDayRows(2,'run')`);
  const t5Wk1HasIt = /Jul 26/.test(wk1Breakdown);
  const t5Wk2LacksIt = !/Jul 26/.test(wk2Breakdown);
  console.log('Test 5 (week 1 breakdown shows Sunday 07-26\'s real date; week 2 breakdown does not):',
    (t5Wk1HasIt && t5Wk2LacksIt) ? 'PASS' : 'FAIL', { t5Wk1HasIt, t5Wk2LacksIt });

  // ---- Test 6: a block whose BLOCK_START IS already a Monday needs no shift at all -- confirms the fix
  // doesn't accidentally push week 1 a week late for the (more common) case where BLOCK_START already
  // falls on a Monday. ----
  win.eval(`BLOCK_START='2026-07-20'; BLOCK_END='2026-09-28';`); // Monday
  const t6 = win.eval(`trendCalWeek('2026-07-20')`);
  console.log('Test 6 (a Monday-starting block needs no shift -- its own BLOCK_START date is still week 1):',
    t6===1 ? 'PASS' : 'FAIL', { t6 });

  // ---- Test 7: mondayOfDate() itself is untouched and still genuinely Monday-anchored -- it's still
  // used (correctly, on purpose) by the plan-independent week-streak functions. ----
  const t7 = win.eval(`mondayOfDate('2026-07-19').toISOString().slice(0,10)`);
  console.log('Test 7 (mondayOfDate is still genuinely Monday-anchored -- Sunday 07-19 resolves to Monday 07-13):',
    t7==='2026-07-13' ? 'PASS' : 'FAIL', { t7 });

  await wait(200);
  win.close();
})();
