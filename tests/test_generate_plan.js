// Regression test for the "Generate a Plan" wizard after its consolidated-page UX rewrite. The
// wizard used to be one-question-per-screen (~20 steps); it's now grouped onto ~11-12 pages (race,
// style, times, naming, days, speed, volume, mobility, checkin, strength, [strengthdetails], review)
// with conditional follow-ups (mobility/checkin/strength "which days") living on the SAME page as
// their yes/no toggle instead of their own screen. Covers: the step-engine (gpBuildSteps/gpContinue/
// gpBack/gpJumpToStep) driven via REAL navigation (not a shortcut that injects every field into the
// DOM at once) — this is what catches state getting silently lost between pages, which is exactly the
// bug that shipped once already. Also covers the new custom-distance slider (no discrete stops), the
// selectable/jump-to-any-visited-page progress track, the extra pull-up-bar/bench equipment, the plan
// name field, the speed-workout count/day picker (replacing the old automatic quality-day
// assignment), clean whole-number/range distance rounding, the current-time pace input, stacked
// same-day sessions, difficulty, distance-vs-duration mode, weekly/long-run caps, and that the final
// plan object is schema-valid and imports/activates through the real confirmImportPlan() flow a
// manually-uploaded plan uses.
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
    }
  });
  return dom.window;
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const win = makeWindow();
  await wait(300);
  win.eval(`SB = { auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}) } };`);

  // ---- Test 1: gpNextMonday() always returns a real Monday ----
  const mondayDow = win.eval(`new Date(gpNextMonday()+'T12:00:00').getDay()`);
  console.log('Test 1 (gpNextMonday() lands on a Monday):', mondayDow === 1 ? 'PASS' : 'FAIL (' + mondayDow + ')');

  // ---- Test 2: distance helpers — presets and custom (custom label respects km/mi setting) ----
  win.eval(`PROFILE.distUnit='km'; GP_DISTANCE='10k';`);
  const tenKKm = win.eval(`gpDistanceKm()`);
  const tenKLabel = win.eval(`gpDistanceLabel()`);
  win.eval(`GP_DISTANCE='custom'; GP_CUSTOM_KM=15;`);
  const customKm = win.eval(`gpDistanceKm()`);
  const customLabelKm = win.eval(`gpDistanceLabel()`);
  win.eval(`PROFILE.distUnit='mi';`);
  const customLabelMi = win.eval(`gpDistanceLabel()`);
  win.eval(`PROFILE.distUnit='km';`);
  console.log('Test 2 (distance presets + custom, custom label follows km/mi setting):',
    (tenKKm === 10 && tenKLabel === '10K' && customKm === 15 && customLabelKm === '15.0 km' && customLabelMi === (15*0.621371).toFixed(1)+' mi') ? 'PASS' : 'FAIL',
    { tenKKm, tenKLabel, customKm, customLabelKm, customLabelMi });

  // ---- Test 3: gpPeakWeeklyKm interpolates sanely between anchors, monotonic by experience ----
  const peak5kBeg = win.eval(`gpPeakWeeklyKm(5,'beginner')`);
  const peak5kAdv = win.eval(`gpPeakWeeklyKm(5,'advanced')`);
  const peakHalfInt = win.eval(`gpPeakWeeklyKm(21.0975,'intermediate')`);
  const peakMid = win.eval(`gpPeakWeeklyKm(15,'intermediate')`);
  console.log('Test 3 (peak weekly km: advanced > beginner, interpolated midpoint is between anchors):',
    (peak5kAdv > peak5kBeg && peakHalfInt === 55 && peakMid > 36 && peakMid < 55) ? 'PASS' : 'FAIL',
    { peak5kBeg, peak5kAdv, peakHalfInt, peakMid });

  // ---- Test 4: gpPhaseSplit always sums to weeksTotal, taper scales with distance bucket ----
  const split5k12 = win.eval(`gpPhaseSplit(12,5)`);
  const splitMara16 = win.eval(`gpPhaseSplit(16,42.195)`);
  const sum5k = split5k12.baseWeeks + split5k12.buildWeeks + split5k12.taperWeeks;
  const sumMara = splitMara16.baseWeeks + splitMara16.buildWeeks + splitMara16.taperWeeks;
  console.log('Test 4 (phase split sums correctly, marathon tapers longer than 5K):',
    (sum5k === 12 && sumMara === 16 && splitMara16.taperWeeks > split5k12.taperWeeks) ? 'PASS' : 'FAIL',
    { split5k12, splitMara16 });

  // ---- Test 5: gpWeeklyKmSeries — right length, peak week is the highest, taper drops off ----
  const series = win.eval(`gpWeeklyKmSeries(12, 15, 40, 6, 4, 2)`);
  const seriesOk = Array.isArray(series) && series.length === 12;
  const peakWeek = Math.max(...series);
  const peakIsSecondLastBeforeTaper = series[9] === peakWeek;
  const taperDropsOff = series[11] < peakWeek && series[10] < peakWeek;
  console.log('Test 5 (weekly km series: right length, peak at end of buildup, taper drops off):',
    (seriesOk && peakIsSecondLastBeforeTaper && taperDropsOff) ? 'PASS' : 'FAIL',
    { length: series.length, peakWeek, week10: series[9], week11: series[10], week12: series[11] });

  // ---- Test 6: speed-workout count defaults (replacing the old automatic gpAssignDayTypes) give
  // more slots to more experienced / more frequent runners, and never exceed available non-long days ----
  win.eval(`gpResetForm(); GP_TRAINING_DAYS=new Set([0,2,5]); GP_LONG_DAY=5;`);
  const speedBeg3 = win.eval(`GP_EXPERIENCE='beginner'; gpDefaultSpeedCount();`);
  const speedAdv3 = win.eval(`GP_EXPERIENCE='advanced'; gpDefaultSpeedCount();`);
  win.eval(`GP_TRAINING_DAYS=new Set([0,1,2,3,4,5,6]); GP_LONG_DAY=5;`);
  const speedAdv6 = win.eval(`GP_EXPERIENCE='advanced'; gpDefaultSpeedCount();`);
  const othersCount = win.eval(`gpOthersDays().length`);
  console.log('Test 6 (speed-day defaults: advanced >= beginner at the same day count, capped to available days):',
    (speedAdv3 >= speedBeg3 && speedAdv6 <= othersCount) ? 'PASS' : 'FAIL', { speedBeg3, speedAdv3, speedAdv6, othersCount });
  win.eval(`gpResetForm();`);

  // ---- Test 7: gpDifficultyFactor scales in the right direction ----
  const factEasy = win.eval(`GP_DIFFICULTY='easy'; gpDifficultyFactor();`);
  const factStd = win.eval(`GP_DIFFICULTY='standard'; gpDifficultyFactor();`);
  const factHard = win.eval(`GP_DIFFICULTY='hard'; gpDifficultyFactor();`);
  console.log('Test 7 (difficulty factor: easy < standard < hard):',
    (factEasy < factStd && factStd < factHard) ? 'PASS' : 'FAIL', { factEasy, factStd, factHard });
  win.eval(`GP_DIFFICULTY='standard';`);

  // ---- Test 8: gpBuildSteps — only 'strengthdetails' is still conditional; every other page is
  // always present now that questions are consolidated ----
  win.eval(`gpResetForm();`);
  const stepsOff = win.eval(`gpBuildSteps()`);
  win.eval(`GP_STRENGTH_ON=true;`);
  const stepsOn = win.eval(`gpBuildSteps()`);
  const expectedAlwaysOn = ['race','style','times','naming','days','speed','volume','mobility','checkin','strength','review'];
  console.log('Test 8 (gpBuildSteps: consolidated page list, strengthdetails only appears when strength is on):',
    (expectedAlwaysOn.every(id => stepsOff.includes(id)) && stepsOff.length === 11 &&
     !stepsOff.includes('strengthdetails') && stepsOn.includes('strengthdetails') && stepsOn.length === 12)
      ? 'PASS' : 'FAIL', { stepsOff, stepsOn });
  win.eval(`gpResetForm();`);

  // ---- Test 9: gpAvailableRestDaysFor now offers every day — sessions are allowed to stack ----
  const availStrength = win.eval(`gpAvailableRestDaysFor('strength')`);
  const availMobility = win.eval(`gpAvailableRestDaysFor('mobility')`);
  const availCheckin = win.eval(`gpAvailableRestDaysFor('checkin')`);
  console.log('Test 9 (day pickers offer all 7 days now that stacking is allowed):',
    ([availStrength, availMobility, availCheckin].every(a => a.length === 7 && [0,1,2,3,4,5,6].every(d => a.includes(d))))
      ? 'PASS' : 'FAIL', { availStrength, availMobility, availCheckin });

  // ---- Real step-by-step wizard walkthrough (this is what would have caught the state-loss bug:
  // fields on earlier pages must survive all the way to Review, since #gp-step-body is replaced
  // wholesale on every page transition and only whatever synced into GP_* state persists). ----
  function setVal(win, id, val) {
    win.eval(`{ const el=document.getElementById(${JSON.stringify(id)}); if(el){ el.value=${JSON.stringify(val)}; } }`);
  }
  function walkthroughToReview(win, opts) {
    win.eval(`gpOpenWizard();`);
    // race: distance + experience + difficulty
    win.eval(`gpSelectDistance(${JSON.stringify(opts.distance)});`);
    if (opts.distance === 'custom') {
      setVal(win, 'gp-customkm-range', String(opts.customKm));
      win.eval(`gpOnCustomKmSlide();`);
    }
    win.eval(`gpSelectExperience(${JSON.stringify(opts.experience)});`);
    win.eval(`gpSelectDifficulty(${JSON.stringify(opts.difficulty)});`);
    win.eval(`gpContinue();`);
    // style: mode + period
    win.eval(`gpSelectMode(${JSON.stringify(opts.mode)});`);
    if (opts.periodMode === 'date') {
      win.eval(`gpSelectPeriodMode('date');`);
      setVal(win, 'gp-racedate', opts.raceDate);
      win.eval(`gpOnPeriodFieldChange();`);
    } else {
      setVal(win, 'gp-weeks', String(opts.weeks));
      setVal(win, 'gp-raceday', String(opts.raceday));
      win.eval(`gpOnPeriodFieldChange();`);
    }
    win.eval(`gpContinue();`);
    // times: current time + goal time
    setVal(win, 'gp-currenttime', opts.currentTime || '');
    win.eval(`gpOnCurrentTimeChange();`);
    setVal(win, 'gp-goaltime', opts.goalTime || '');
    win.eval(`gpOnGoalTimeChange(); gpContinue();`);
    // naming: plan name + race name
    setVal(win, 'gp-planname', opts.planName || '');
    win.eval(`gpOnPlanNameInput();`);
    setVal(win, 'gp-racename', opts.raceName || '');
    win.eval(`gpOnRaceNameInput(); gpContinue();`);
    // days: training days + long run day — gpToggleTrainingDay() is a real toggle and the wizard
    // always starts from the default {0,2,5} (set by gpResetForm() inside gpOpenWizard()), so only
    // toggle the days that actually need to change state, exactly like a person clicking chips from
    // that same starting point.
    const currentDays = win.eval(`Array.from(GP_TRAINING_DAYS)`);
    const desiredDays = opts.trainingDays;
    currentDays.filter(d => !desiredDays.includes(d)).forEach(d => win.eval(`gpToggleTrainingDay(${d});`));
    desiredDays.filter(d => !currentDays.includes(d)).forEach(d => win.eval(`gpToggleTrainingDay(${d});`));
    win.eval(`gpSelectLongDay(${opts.longDay}); gpContinue();`);
    // speed: how many speed workouts + which days
    win.eval(`gpSelectSpeedCount(${opts.speedCount});`);
    if (Array.isArray(opts.speedDays)) {
      const currentSpeed = win.eval(`Array.from(GP_SPEED_DAYS)`);
      currentSpeed.filter(d => !opts.speedDays.includes(d)).forEach(d => win.eval(`gpToggleSpeedDay(${d});`));
      opts.speedDays.filter(d => !currentSpeed.includes(d)).forEach(d => win.eval(`gpToggleSpeedDay(${d});`));
    }
    win.eval(`gpContinue();`);
    // volume: weekly cap + long-run cap + starting volume
    if (opts.maxWeekly != null) { setVal(win, 'gp-maxweekly', String(opts.maxWeekly)); win.eval(`gpOnCapInput('weekly');`); }
    if (opts.maxLongRun != null) { setVal(win, 'gp-maxlongrun', String(opts.maxLongRun)); win.eval(`gpOnCapInput('longrun');`); }
    if (opts.startVol != null) { setVal(win, 'gp-startvol', String(opts.startVol)); win.eval(`gpOnStartVolInput();`); }
    win.eval(`gpContinue();`);
    // mobility: on/off + which days on the same page
    win.eval(`gpSelectMobilityOn(${JSON.stringify(opts.mobilityOn ? 'yes' : 'no')});`);
    if (opts.mobilityOn) opts.mobilityDays.forEach(d => win.eval(`gpToggleMobilityDay(${d});`));
    win.eval(`gpContinue();`);
    // checkin: on/off + which day on the same page
    win.eval(`gpSelectCheckinOn(${JSON.stringify(opts.checkinOn ? 'yes' : 'no')});`);
    if (opts.checkinOn) win.eval(`gpSelectCheckinDay(${opts.checkinDay});`);
    win.eval(`gpContinue();`);
    // strength: on/off + which days on the same page
    win.eval(`gpSelectStrengthOn(${JSON.stringify(opts.strengthOn ? 'yes' : 'no')});`);
    if (opts.strengthOn) opts.strengthDays.forEach(d => win.eval(`gpToggleStrengthDay(${d});`));
    win.eval(`gpContinue();`);
    if (opts.strengthOn) {
      // strengthdetails: equipment + difficulty + duration
      (opts.strengthEquip || ['bw']).forEach(k => win.eval(`gpToggleStrengthEquip(${JSON.stringify(k)});`));
      win.eval(`gpSelectStrengthDifficulty(${JSON.stringify(opts.strengthDifficulty || 'standard')});`);
      win.eval(`gpSelectStrengthDuration(${opts.strengthDuration || 30}); gpContinue();`); // -> review
    }
  }

  // ---- Test 10: real step-by-step walkthrough reaches Review with every answer intact, and
  // Generate Plan succeeds — training day 0 (Monday) deliberately doubles as BOTH a run day AND the
  // strength day, and the check-in lands on the long-run day, to exercise stacking end to end. ----
  win.eval(`
    BLOCKS=[{id:'placeholder',name:'Placeholder',status:'complete',startDate:'2020-01-01',endDate:'2020-02-01',mileagePlan:{},sessions:[]}];
    SEASONS=[{id:'s2020',name:'2020'}]; ACTIVE_BLOCK_ID='does-not-exist'; DATA=[]; RACES_LIST=[];
  `);
  walkthroughToReview(win, {
    distance: '10k', experience: 'intermediate', difficulty: 'hard', mode: 'distance',
    weeks: 10, raceday: 6, currentTime: '58:00', goalTime: '55:00', planName: 'My Test Plan', raceName: 'Test 10K Race',
    trainingDays: [0, 2, 4, 5], longDay: 5, speedCount: 1, speedDays: [4],
    maxWeekly: 45, maxLongRun: 14,
    mobilityOn: true, mobilityDays: [1],
    checkinOn: true, checkinDay: 5, // stacked directly onto the long-run day
    strengthOn: true, strengthDays: [0, 6], // day 0 stacks onto a training day; day 6 is a plain rest day
    strengthEquip: ['bw', 'db'], strengthDifficulty: 'standard', strengthDuration: 30
  });
  const reviewShown = win.eval(`document.getElementById('gp-step-body').innerHTML.includes('Ready to build your plan')`);
  console.log('Test 10 (real step-by-step walkthrough reaches the Review step):', reviewShown ? 'PASS' : 'FAIL');
  win.eval(`gpGenerateAndImport();`);
  const blocksAfterWalk = win.eval(`BLOCKS.length`);
  console.log('Test 11 (Generate Plan succeeds after a real walkthrough — this is the exact bug that shipped: DOM-only fields losing their answers by the time Review was reached):',
    blocksAfterWalk === 2 ? 'PASS' : 'FAIL (plan was not imported — see errors below if any)');

  // Re-run generatePlanFromWizard() directly (state is already primed from the walkthrough above) so
  // we have the raw plan object in hand for structural assertions, without re-parsing from BLOCKS.
  const genResult = win.eval(`generatePlanFromWizard()`);
  if (genResult.ok) {
    const rawPlan = genResult.plan;
    const validation = win.eval(`validatePlanJSON(${JSON.stringify(rawPlan)})`);
    console.log('Test 12 (generated plan passes validatePlanJSON with zero errors):',
      validation.valid ? 'PASS' : 'FAIL (' + JSON.stringify(validation.errors) + ')');

    const weekCount = rawPlan.weeks.length;
    const lastWeek = rawPlan.weeks[rawPlan.weeks.length - 1];
    const hasRaceDay = lastWeek.days.some(d => d.type === 'race');
    console.log('Test 13 (10 weeks generated, exactly one race day in the final week):',
      (weekCount === 10 && hasRaceDay) ? 'PASS' : 'FAIL', { weekCount, hasRaceDay });

    // Stacking: day 0 (a training day) should carry BOTH a running session and a strength session.
    const week1 = rawPlan.weeks[0];
    const day0Entries = week1.days.filter(d => d.day === 0);
    const day5Entries = week1.days.filter(d => d.day === 5); // long run + check-in, stacked
    console.log('Test 14 (stacking: training day 0 carries both a run AND a strength session):',
      (day0Entries.length === 2 && day0Entries.some(d => d.type !== 'str') && day0Entries.some(d => d.type === 'str'))
        ? 'PASS' : 'FAIL', { day0Entries });
    console.log('Test 15 (stacking: long-run day 5 also carries the weekly check-in):',
      (day5Entries.length === 2 && day5Entries.some(d => d.type === 'long') && day5Entries.some(d => d.type === 'checkin'))
        ? 'PASS' : 'FAIL', { day5Entries });

    const mobilityDay1 = week1.days.find(d => d.day === 1 && d.type === 'rest');
    console.log('Test 16 (mobility landed on day 1 as its own session):', mobilityDay1 ? 'PASS' : 'FAIL', { mobilityDay1 });

    // Weekly cap: sum of distanceKm across running days (excluding race week) should never exceed 45.
    const midWeek = rawPlan.weeks[4];
    const midWeekRunKm = midWeek.days.filter(d => typeof d.distanceKm === 'number').reduce((s, d) => s + d.distanceKm, 0);
    const longDay = midWeek.days.find(d => d.type === 'long');
    console.log('Test 17 (weekly volume cap and long-run cap are respected):',
      (midWeekRunKm <= 45.5 && (!longDay || longDay.distanceKm <= 14.5)) ? 'PASS' : 'FAIL', { midWeekRunKm, longDayKm: longDay && longDay.distanceKm });

    const hasStrengthProgression = Array.isArray(rawPlan.strengthProgression) && rawPlan.strengthProgression.length > 0;
    console.log('Test 18 (linked race entry created, strengthProgression included, difficulty tag present, plan/race name from early pages survived to the end):',
      (rawPlan.races.length === 1 && rawPlan.races[0].name === 'Test 10K Race' && rawPlan.races[0].goal === 'Goal: 55:00' &&
       rawPlan.blockName === 'My Test Plan' && hasStrengthProgression && rawPlan.tags.includes('Hard'))
        ? 'PASS' : 'FAIL', { race: rawPlan.races[0], blockName: rawPlan.blockName, hasStrengthProgression, tags: rawPlan.tags });

    // Speed day: day 4 should be a quality/speed run, and the other non-long training day (day 2)
    // should be a plain easy run, per speedDays:[4] chosen in the walkthrough above.
    const day4Entry = week1.days.find(d => d.day === 4);
    const day2Entry = week1.days.find(d => d.day === 2);
    console.log('Test 18b (speed-day picker: day 4 got the quality session, day 2 stayed easy):',
      (day4Entry && day4Entry.type === 'qual' && day2Entry && day2Entry.type === 'easy') ? 'PASS' : 'FAIL', { day4Entry, day2Entry });

    // All running distances should render as clean whole numbers or tight ranges — never a decimal
    // like "7.4 km"/"8.9 km" (task #108's explicit complaint).
    const anyDecimalDetail = rawPlan.weeks.some(w => w.days.some(d => /\d+\.\d+\s*km/.test(d.detail || '')));
    console.log('Test 18c (no run detail text contains a decimal km figure like "7.4 km"):',
      !anyDecimalDetail ? 'PASS' : 'FAIL');

    // Feed it through parsePlanJSON (the real import path) and confirm stacked same-day sessions get
    // distinct ids instead of colliding.
    const parsed = win.eval(`parsePlanJSON(${JSON.stringify(rawPlan)})`);
    const week1Ids = parsed.sessions.filter(s => s.wk === 1).map(s => s.id);
    const uniqueIds = new Set(week1Ids);
    console.log('Test 19 (parsePlanJSON gives every stacked same-day session a unique id):',
      (uniqueIds.size === week1Ids.length) ? 'PASS' : 'FAIL', { week1Ids });
  } else {
    console.log('Test 12-19: SKIPPED (generatePlanFromWizard failed —', JSON.stringify(genResult.errors), ')');
  }

  // ---- Test 20: validatePlanJSON rejects a true duplicate (same day AND same type) but allows a
  // stacked day (same day, different type) ----
  const basePlanForDupeCheck = {
    schemaVersion: 1, blockName: 'B', planTitle: 'P', theme: 'T', tags: [], startDate: '2026-08-03',
    phaseLabels: {}, races: [],
    weeks: [{ week: 1, phase: 'base', days: [
      { day: 0, type: 'easy', title: 'Easy Run', distanceKm: 5 },
      { day: 0, type: 'str', title: 'Strength' } // stacked, different type — should be fine
    ]}]
  };
  const okStack = win.eval(`validatePlanJSON(${JSON.stringify(basePlanForDupeCheck)})`);
  const dupePlan = JSON.parse(JSON.stringify(basePlanForDupeCheck));
  dupePlan.weeks[0].days.push({ day: 0, type: 'easy', title: 'Easy Run Again', distanceKm: 5 }); // true duplicate
  const badDupe = win.eval(`validatePlanJSON(${JSON.stringify(dupePlan)})`);
  console.log('Test 20 (stacked same-day different-type entries are valid; same-day same-type duplicate is rejected):',
    (okStack.valid && !badDupe.valid) ? 'PASS' : 'FAIL', { okStackErrors: okStack.errors, badDupeErrors: badDupe.errors });

  // ---- Test 21: duration mode produces minute-based sessions with no distanceKm on running days ----
  win.eval(`gpResetForm();`);
  walkthroughToReview(win, {
    distance: '5k', experience: 'beginner', difficulty: 'standard', mode: 'duration',
    weeks: 6, raceday: 6, trainingDays: [0, 2, 5], longDay: 5, speedCount: 0,
    mobilityOn: false, checkinOn: false, strengthOn: false
  });
  const genResultDuration = win.eval(`generatePlanFromWizard()`);
  let durationOk = false, sampleDetail = '';
  if (genResultDuration.ok) {
    const wk1 = genResultDuration.plan.weeks[0];
    const easyDay = wk1.days.find(d => d.type === 'easy' || d.type === 'long');
    durationOk = easyDay && easyDay.distanceKm === undefined && /min/.test(easyDay.detail);
    sampleDetail = easyDay && easyDay.detail;
  }
  console.log('Test 21 (duration mode: running days carry no distanceKm and describe minutes):',
    (genResultDuration.ok && durationOk) ? 'PASS' : 'FAIL (' + JSON.stringify(genResultDuration.errors) + ')', { sampleDetail });

  // ---- Test 22: an impossible period (too short) can't actually be reached via real navigation —
  // gpStepValid('style') blocks Continue at the page itself — but generatePlanFromWizard() still
  // defensively rejects it if state ever ends up that way (e.g. a race date only 1 week out). Tests
  // both layers directly against state rather than the UI, since the UI's own gating makes this
  // otherwise unreachable by clicking through.
  win.eval(`
    gpResetForm();
    GP_TRAINING_DAYS=new Set([0,2,5]); GP_LONG_DAY=5;
    GP_PERIOD_MODE='date'; GP_RACEDATE=addDaysISO(gpNextMonday(),10);
  `);
  const styleStepBlocksShortDate = win.eval(`!gpStepValid('style')`);
  const badResult = win.eval(`generatePlanFromWizard()`);
  console.log('Test 22 (an impossible period is blocked both at the page level and defensively inside generatePlanFromWizard):',
    (styleStepBlocksShortDate && !badResult.ok && badResult.errors.length) ? 'PASS' : 'FAIL', { styleStepBlocksShortDate, badResult });

  // ---- Test 23: with an existing active block, generating shows the real Add & Activate / Just Add
  // dialog, and a successful import closes Plans and lands on Today (task #105) ----
  win.eval(`gpResetForm();`);
  walkthroughToReview(win, {
    distance: '5k', experience: 'beginner', difficulty: 'standard', mode: 'distance',
    weeks: 6, raceday: 6, trainingDays: [0, 2, 5], longDay: 5, speedCount: 0,
    mobilityOn: false, checkinOn: false, strengthOn: false
  });
  win.eval(`
    BLOCKS=[{id:'active1',name:'Active',status:'active',startDate:'2026-01-01',endDate:'2026-03-01',mileagePlan:{},sessions:[]}];
    ACTIVE_BLOCK_ID='active1';
    gpGenerateAndImport();
  `);
  const confirmOpen = win.eval(`document.getElementById('confirm-overlay').classList.contains('open')`);
  console.log('Test 23 (existing active block: reuses the real Add & Activate / Just Add confirm dialog):',
    confirmOpen ? 'PASS' : 'FAIL');
  win.eval(`
    document.getElementById('plans-overlay').classList.add('open');
    CURR_VIEW='plans';
    const btns=Array.from(document.querySelectorAll('#confirm-overlay button'));
    const addBtn=btns.find(b=>/Add & Activate/.test(b.textContent));
    if(addBtn) addBtn.click();
  `);
  const plansClosedAfterImport = win.eval(`!document.getElementById('plans-overlay').classList.contains('open')`);
  const onTodayAfterImport = win.eval(`CURR_VIEW`);
  console.log('Test 23b (successful import closes Plans and routes to Today):',
    (plansClosedAfterImport && onTodayAfterImport === 'today') ? 'PASS' : 'FAIL', { plansClosedAfterImport, onTodayAfterImport });

  // ---- Test 24: gpOpenWizard resets state (including plan name / current time / speed count /
  // max-step-reached) and renders the first page (race) ----
  win.eval(`
    GP_DISTANCE='marathon'; GP_TRAINING_DAYS=new Set([0,1,2,3,4,5,6]); GP_STRENGTH_ON=true; GP_STEP=5; GP_MAX_STEP_REACHED=5;
    GP_WEEKS=20; GP_RACEDAY=2; GP_GOALTIME='3:30:00'; GP_CURRENT_TIME='3:45:00'; GP_RACENAME='Old Name'; GP_PLAN_NAME='Old Plan'; GP_STARTVOL=99;
    GP_SPEED_COUNT=3;
    gpOpenWizard();
  `);
  const resetDistance = win.eval(`GP_DISTANCE`);
  const resetDaysCount = win.eval(`GP_TRAINING_DAYS.size`);
  const resetStrength = win.eval(`GP_STRENGTH_ON`);
  const resetWeeks = win.eval(`GP_WEEKS`);
  const resetGoalTime = win.eval(`GP_GOALTIME`);
  const resetCurrentTime = win.eval(`GP_CURRENT_TIME`);
  const resetPlanName = win.eval(`GP_PLAN_NAME`);
  const resetSpeedCount = win.eval(`GP_SPEED_COUNT`);
  const resetStartVol = win.eval(`GP_STARTVOL`);
  const stepAfterOpen = win.eval(`GP_STEP`);
  const maxStepAfterOpen = win.eval(`GP_MAX_STEP_REACHED`);
  const overlayOpen = win.eval(`document.getElementById('genplan-overlay').classList.contains('open')`);
  const firstStepShowsRace = win.eval(`document.getElementById('gp-step-body').innerHTML.includes('What race are you training for')`);
  console.log('Test 24 (gpOpenWizard resets the form — including plan name/current time/speed count — to defaults and opens on the race page):',
    (resetDistance === '5k' && resetDaysCount === 3 && resetStrength === false && resetWeeks === 12 && resetGoalTime === '' &&
     resetCurrentTime === '' && resetPlanName === '' && resetSpeedCount === null && resetStartVol === null &&
     stepAfterOpen === 0 && maxStepAfterOpen === 0 && overlayOpen && firstStepShowsRace)
      ? 'PASS' : 'FAIL', { resetDistance, resetDaysCount, resetStrength, resetWeeks, resetGoalTime, resetCurrentTime, resetPlanName, resetSpeedCount, resetStartVol, stepAfterOpen, maxStepAfterOpen, overlayOpen, firstStepShowsRace });

  // ---- Test 25: gpContinue/gpBack navigate the page index correctly on the new consolidated list ----
  win.eval(`gpOpenWizard();`);
  const stepsLenDefault = win.eval(`gpBuildSteps().length`);
  win.eval(`gpSelectDistance('5k'); gpSelectExperience('beginner'); gpSelectDifficulty('standard'); gpContinue();`);
  const stepIdxAfterOne = win.eval(`GP_STEP`);
  win.eval(`gpSelectMode('distance'); gpContinue();`);
  const stepIdAtTimes = win.eval(`gpBuildSteps()[GP_STEP]`);
  win.eval(`gpBack();`);
  const stepIdAfterBack = win.eval(`gpBuildSteps()[GP_STEP]`);
  console.log('Test 25 (gpContinue/gpBack move the page index and land on the right page id):',
    (stepsLenDefault === 11 && stepIdxAfterOne === 1 && stepIdAtTimes === 'times' && stepIdAfterBack === 'style')
      ? 'PASS' : 'FAIL', { stepsLenDefault, stepIdxAfterOne, stepIdAtTimes, stepIdAfterBack });

  // ---- Test 26: gpJumpToStep — the selectable progress track lets you return to any VISITED page,
  // but refuses to jump ahead to a page you haven't reached yet (task #102) ----
  const maxReachedAtTimes = win.eval(`GP_MAX_STEP_REACHED`); // should be 2 (times) after the walk above
  win.eval(`gpJumpToStep(0);`); // jump back to race — allowed, already visited
  const stepAfterJumpBack = win.eval(`gpBuildSteps()[GP_STEP]`);
  const maxReachedStaysAfterJumpBack = win.eval(`GP_MAX_STEP_REACHED`);
  win.eval(`gpJumpToStep(9);`); // review is index 10 on the default 11-step list; 9 (strength) not yet visited — should be refused
  const stepIdxAfterBadJump = win.eval(`GP_STEP`);
  console.log('Test 26 (gpJumpToStep: jumping to a visited page works and keeps max-reached; jumping ahead to an unvisited page is refused):',
    (maxReachedAtTimes >= 2 && stepAfterJumpBack === 'race' && maxReachedStaysAfterJumpBack === maxReachedAtTimes && stepIdxAfterBadJump === 0)
      ? 'PASS' : 'FAIL', { maxReachedAtTimes, stepAfterJumpBack, maxReachedStaysAfterJumpBack, stepIdxAfterBadJump });
  win.eval(`gpCloseWizard();`);

  // ---- Test 27: gpStepValid blocks Continue until required fields are filled — 'days' now gates
  // BOTH the training-day count AND the long-run-day pick on one combined page ----
  win.eval(`gpResetForm(); GP_TRAINING_DAYS=new Set();`);
  const daysStepInvalidNoD = win.eval(`gpStepValid('days')`);
  win.eval(`GP_TRAINING_DAYS=new Set([0,2,5]); GP_LONG_DAY=null;`);
  const daysStepInvalidNoLongDay = win.eval(`gpStepValid('days')`);
  win.eval(`GP_LONG_DAY=5;`);
  const daysStepValid = win.eval(`gpStepValid('days')`);
  console.log('Test 27 (gpStepValid correctly gates the combined days+long-run-day page):',
    (daysStepInvalidNoD === false && daysStepInvalidNoLongDay === false && daysStepValid === true) ? 'PASS' : 'FAIL',
    { daysStepInvalidNoD, daysStepInvalidNoLongDay, daysStepValid });

  // ---- Test 28: the custom-distance slider is RPE-style but has NO discrete stop markers, and
  // dragging it updates GP_CUSTOM_KM correctly in both km and mi (task #101) ----
  win.eval(`gpResetForm(); PROFILE.distUnit='km'; GP_DISTANCE='custom'; GP_CUSTOM_KM=10; gpOpenWizard(); gpSelectDistance('custom');`);
  const sliderHTML = win.eval(`document.getElementById('gp-customkm-wrap').innerHTML`);
  const hasSlider = /rpe-slider/.test(sliderHTML) && /rpe-track-fill/.test(sliderHTML);
  const hasNoDots = !/rpe-dots/.test(sliderHTML);
  setVal(win, 'gp-customkm-range', '18.5');
  win.eval(`gpOnCustomKmSlide();`);
  const customKmAfterSlide = win.eval(`GP_CUSTOM_KM`);
  console.log('Test 28 (custom-distance slider reuses the RPE widget styling with no discrete stop markers, and updates GP_CUSTOM_KM):',
    (hasSlider && hasNoDots && Math.abs(customKmAfterSlide - 18.5) < 0.01) ? 'PASS' : 'FAIL', { hasSlider, hasNoDots, customKmAfterSlide });
  win.eval(`gpCloseWizard();`);

  // ---- Test 29: pull-up bar and bench are real equipment options, and gpEquipLabel joins multiple
  // picks into one readable phrase (task #104) ----
  const equipKeys = win.eval(`GP_EQUIP_OPTS.map(o=>o.key)`);
  const pullupExercises = win.eval(`GP_STRENGTH_EXERCISES.filter(e=>e.eq==='pullup').length`);
  const benchExercises = win.eval(`GP_STRENGTH_EXERCISES.filter(e=>e.eq==='bench').length`);
  const joinedLabel = win.eval(`gpEquipLabel(new Set(['db','bench']))`);
  console.log('Test 29 (pull-up bar + bench are selectable equipment with real exercises, and combine into a joined label):',
    (equipKeys.includes('pullup') && equipKeys.includes('bench') && pullupExercises > 0 && benchExercises > 0 && joinedLabel === 'Dumbbell + Bench')
      ? 'PASS' : 'FAIL', { equipKeys, pullupExercises, benchExercises, joinedLabel });

  // ---- Test 30: gpDistancePrescriptionText rounds to clean whole numbers/ranges — the exact examples
  // called out as bad (7.4, 6.1, 8.9) must NOT appear verbatim, and the good examples (7-8, 8-9, 10,
  // 11) must (task #108) ----
  const rx74 = win.eval(`gpDistancePrescriptionText(7.4)`);
  const rx61 = win.eval(`gpDistancePrescriptionText(6.1)`);
  const rx89 = win.eval(`gpDistancePrescriptionText(8.9)`);
  const rx103 = win.eval(`gpDistancePrescriptionText(10.3)`);
  const rx11 = win.eval(`gpDistancePrescriptionText(11.0)`);
  console.log('Test 30 (gpDistancePrescriptionText: clean ranges under 10km, clean whole numbers 10km+):',
    (rx74 === '7-8 km' && rx61 === '6-7 km' && rx89 === '8-9 km' && rx103 === '10 km' && rx11 === '11 km')
      ? 'PASS' : 'FAIL', { rx74, rx61, rx89, rx103, rx11 });

  // ---- Test 31: current time drives the easy-pace calibration ahead of goal time, and an implied
  // goal pace is derived when a current time is given with no explicit goal (task #109) ----
  const paceFromCurrentOnly = win.eval(`gpEstimatedPaceSecPerKm(300, null)`); // 300 sec/km current -> current+60
  const paceFromGoalOnly = win.eval(`gpEstimatedPaceSecPerKm(null, 280)`); // goal+75
  const paceFromBoth = win.eval(`gpEstimatedPaceSecPerKm(300, 280)`); // current wins
  const impliedGoal = win.eval(`gpImpliedGoalPaceSecPerKm(300)`);
  console.log('Test 31 (pace calc prefers current time over goal time, and derives an implied goal pace from current alone):',
    (paceFromCurrentOnly === 360 && paceFromGoalOnly === 355 && paceFromBoth === paceFromCurrentOnly && Math.abs(impliedGoal - 291) < 0.5)
      ? 'PASS' : 'FAIL', { paceFromCurrentOnly, paceFromGoalOnly, paceFromBoth, impliedGoal });

  // End-to-end: a plan generated with ONLY a current time (no goal time) should still carry a
  // concrete pace on its quality sessions, proving the implied-goal-pace fallback actually reaches
  // the generator, not just the pure helper functions above.
  win.eval(`gpResetForm();`);
  walkthroughToReview(win, {
    distance: '10k', experience: 'intermediate', difficulty: 'standard', mode: 'distance',
    weeks: 10, raceday: 6, currentTime: '50:00', goalTime: '',
    trainingDays: [0, 2, 4, 5], longDay: 5, speedCount: 1, speedDays: [4],
    mobilityOn: false, checkinOn: false, strengthOn: false
  });
  const genResultCurrentOnly = win.eval(`generatePlanFromWizard()`);
  let qualHasPace = false;
  if (genResultCurrentOnly.ok) {
    const qualSession = genResultCurrentOnly.plan.weeks.find(w => w.phase === 'build' || w.phase === 'peak')?.days.find(d => d.type === 'qual');
    qualHasPace = !!(qualSession && /\d+:\d\d\/km/.test(qualSession.detail));
  }
  console.log('Test 31b (a current-time-only plan still gives quality sessions a real target pace via the implied-goal fallback):',
    (genResultCurrentOnly.ok && qualHasPace) ? 'PASS' : 'FAIL (' + JSON.stringify(genResultCurrentOnly.errors) + ')');

  // ---- Test 32: Quick Add run-distance field label switches with the km/mi setting ----
  win.eval(`PROFILE.distUnit='mi'; QA_KIND='run'; QA_SUBTYPE='easy'; document.getElementById('qa-sh-body').innerHTML = buildQuickAddBody('run', {});`);
  const qaLabelMi = win.eval(`document.getElementById('qa-sh-body').innerHTML.includes('Distance (mi)')`);
  win.eval(`PROFILE.distUnit='km'; document.getElementById('qa-sh-body').innerHTML = buildQuickAddBody('run', {});`);
  const qaLabelKm = win.eval(`document.getElementById('qa-sh-body').innerHTML.includes('Distance (km)')`);
  console.log('Test 32 (Quick Add distance field label follows the active km/mi setting):',
    (qaLabelMi && qaLabelKm) ? 'PASS' : 'FAIL', { qaLabelMi, qaLabelKm });

  // ---- Test 33: fmtDist()/displayToKm() round-trip correctly in both units ----
  const roundTripKm = win.eval(`PROFILE.distUnit='km'; Math.abs(displayToKm(kmToDisplay(10)) - 10) < 0.001`);
  const roundTripMi = win.eval(`PROFILE.distUnit='mi'; const r = Math.abs(displayToKm(kmToDisplay(10)) - 10) < 0.001; PROFILE.distUnit='km'; r;`);
  console.log('Test 33 (kmToDisplay/displayToKm round-trip cleanly in both km and mi):',
    (roundTripKm && roundTripMi) ? 'PASS' : 'FAIL');

  // ---- Test 34: dayIndicatorHTML shows a dot per stacked session instead of hiding extras ----
  win.eval(`
    DATA=[
      {id:'s1',date:'2026-08-03',ty:'easy',wk:1},
      {id:'s2',date:'2026-08-03',ty:'str',wk:1}
    ];
    RACES_LIST=[];
  `);
  const indicatorHTML = win.eval(`dayIndicatorHTML('2026-08-03')`);
  const dotCount = (indicatorHTML.match(/tb-day-dot/g) || []).length;
  console.log('Test 34 (dayIndicatorHTML renders a dot for every stacked session on a date):',
    dotCount === 2 ? 'PASS' : 'FAIL', { dotCount, indicatorHTML });

  await wait(200);
  win.close();
})();
