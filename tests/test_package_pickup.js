// Regression test for Package/Bib Pickup (Dylon: races usually hand out packages over a date RANGE
// ahead of race day, at a specific LOCATION -- often different from the start line -- modeled on the
// RBC Race For The Kids confirmation email's own pickup section). Covers three pieces: (1) the race
// data model + Add/Edit Race form fields (pkgPickupStart, pkgPickupEnd, pkgPickupLocation,
// pkgPickupNotes), (2) a Today banner nudge (pkgPickupNudgeHTML, same pattern as the existing
// raceRegNudgeHTML) with a PKG_PICKUP_LEAD_DAYS=3 lookahead, and (3) a one-time browser notification
// (maybePkgPickupReminder / firePkgPickupNotification) gated by its own Settings toggle
// (PROFILE.pkgReminderEnabled), tracked per-race via pkgReminderFired so it never repeats -- reset by
// saveRaceForm() only if the pickup start date is actually edited to a new value. Also surfaced as a
// small info card on the Race Day Strategy view (renderRaceStrategyHTML), alongside location/route
// link, so it's visible without having to re-open the edit form.
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

  // ---- Test 1: normalizeRaceRecord() gives every pkg field a sane default ----
  const rec = JSON.parse(win.eval(`JSON.stringify(normalizeRaceRecord({name:'Fresh Race',date:'2026-11-01'}))`));
  const hasAllFields = ['pkgPickupStart','pkgPickupEnd','pkgPickupLocation','pkgPickupNotes','pkgReminderFired'].every(k=>k in rec);
  console.log('Test 1 (normalizeRaceRecord defaults every pkg field, pkgReminderFired starts false):', {
    result: (hasAllFields && rec.pkgPickupStart==='' && rec.pkgPickupEnd==='' && rec.pkgPickupLocation==='' && rec.pkgPickupNotes==='' && rec.pkgReminderFired===false) ? 'PASS' : 'FAIL'
  });

  // ---- Test 2: the Add/Edit Race form renders all four pkg fields plus their own maps link ----
  const formHtml = win.eval(`renderRaceFormHTML(null)`);
  const formHasFields = ['race-pkg-start','race-pkg-end','race-pkg-location','race-pkg-notes','race-pkg-maps-link'].every(id=>formHtml.includes(`id="${id}"`));
  console.log('Test 2 (Add Race form renders pkg start/end/location/notes fields + a maps link):', formHasFields ? 'PASS' : 'FAIL');

  // ---- Test 3: adding a new race through the real save flow persists all four pkg fields ----
  win.eval(`RACE_EDIT_KEY=null; RACE_ADDING=true; document.getElementById('plans-sh-body').innerHTML=renderRaceFormHTML(null);`);
  win.eval(`
    document.getElementById('race-name').value='RBC Race For The Kids';
    document.getElementById('race-date').value='2026-09-27';
    document.getElementById('race-pkg-start').value='2026-09-20';
    document.getElementById('race-pkg-end').value='2026-09-22';
    document.getElementById('race-pkg-location').value='Fitness Zone, Ellerslie Plaza';
    document.getElementById('race-pkg-notes').value='Bring photo ID, 10am-6pm';
  `);
  win.eval(`saveRaceForm()`);
  const saved = JSON.parse(win.eval(`JSON.stringify(RACES_LIST.find(r=>r.name==='RBC Race For The Kids'))`));
  console.log('Test 3 (adding a race saves all four pkg fields via the real form flow):', {
    result: (saved && saved.pkgPickupStart==='2026-09-20' && saved.pkgPickupEnd==='2026-09-22' &&
      saved.pkgPickupLocation==='Fitness Zone, Ellerslie Plaza' && saved.pkgPickupNotes==='Bring photo ID, 10am-6pm' &&
      saved.pkgReminderFired===false) ? 'PASS' : 'FAIL'
  });

  // ---- Test 4: an invalid range (end before start) is rejected with a toast, and nothing is saved ----
  win.eval(`window.__toasts=[]; window.showToast=(m)=>{window.__toasts.push(m);};`);
  win.eval(`RACE_EDIT_KEY=null; RACE_ADDING=true; document.getElementById('plans-sh-body').innerHTML=renderRaceFormHTML(null);`);
  win.eval(`
    document.getElementById('race-name').value='Bad Range Race';
    document.getElementById('race-date').value='2026-12-01';
    document.getElementById('race-pkg-start').value='2026-11-20';
    document.getElementById('race-pkg-end').value='2026-11-10';
  `);
  win.eval(`saveRaceForm()`);
  const badRangeSaved = win.eval(`RACES_LIST.some(r=>r.name==='Bad Range Race')`);
  const gotRangeToast = win.eval(`window.__toasts`).some(m=>m.includes('before the start date'));
  console.log('Test 4 (pickup end date before start date is rejected, nothing saved):', {
    result: (!badRangeSaved && gotRangeToast) ? 'PASS' : 'FAIL'
  });

  // ---- Test 5: editing a race and changing its pkgPickupStart resets pkgReminderFired to false;
  // editing WITHOUT changing the start date leaves an already-true flag alone ----
  win.eval(`RACES_LIST.find(r=>r.name==='RBC Race For The Kids').pkgReminderFired=true;`);
  win.eval(`
    const r=RACES_LIST.find(x=>x.name==='RBC Race For The Kids');
    RACE_EDIT_KEY=r.key;
    document.getElementById('plans-sh-body').innerHTML=renderRaceFormHTML(r);
  `);
  win.eval(`document.getElementById('race-pkg-start').value='2026-09-18';`);
  win.eval(`saveRaceForm()`);
  const afterDateChange = JSON.parse(win.eval(`JSON.stringify(RACES_LIST.find(r=>r.name==='RBC Race For The Kids'))`));
  win.eval(`RACES_LIST.find(r=>r.name==='RBC Race For The Kids').pkgReminderFired=true;`);
  win.eval(`
    const r=RACES_LIST.find(x=>x.name==='RBC Race For The Kids');
    RACE_EDIT_KEY=r.key;
    document.getElementById('plans-sh-body').innerHTML=renderRaceFormHTML(r);
  `);
  win.eval(`saveRaceForm()`); // no field changes this time
  const afterNoOpSave = JSON.parse(win.eval(`JSON.stringify(RACES_LIST.find(r=>r.name==='RBC Race For The Kids'))`));
  console.log('Test 5 (changing pickup start resets pkgReminderFired; unchanged save preserves it):', {
    result: (afterDateChange.pkgPickupStart==='2026-09-18' && afterDateChange.pkgReminderFired===false &&
      afterNoOpSave.pkgReminderFired===true) ? 'PASS' : 'FAIL'
  });

  // ---- Test 6: pkgPickupNudgeHTML() shows nothing when the soonest pickup is outside the 3-day lead
  // window, shows an "opens soon" message inside the window, and an "open now" message once today is
  // actually inside the pickup range ----
  win.eval(`RACES_LIST.length=0;`);
  win.eval(`RACES_LIST.push(normalizeRaceRecord({name:'Far Pickup Race',date:'2026-12-01',status:'registered',pkgPickupStart:addDaysISO(todayISO(),10)}))`);
  const nudgeFar = win.eval(`pkgPickupNudgeHTML()`);
  win.eval(`RACES_LIST.length=0;`);
  win.eval(`RACES_LIST.push(normalizeRaceRecord({name:'Soon Pickup Race',date:'2026-12-01',status:'registered',pkgPickupStart:addDaysISO(todayISO(),2),pkgPickupEnd:addDaysISO(todayISO(),4),pkgPickupLocation:'Some Store'}))`);
  const nudgeSoon = win.eval(`pkgPickupNudgeHTML()`);
  win.eval(`RACES_LIST.length=0;`);
  win.eval(`RACES_LIST.push(normalizeRaceRecord({name:'Open Pickup Race',date:'2026-12-01',status:'registered',pkgPickupStart:addDaysISO(todayISO(),-1),pkgPickupEnd:addDaysISO(todayISO(),1),pkgPickupLocation:'Some Store'}))`);
  const nudgeOpen = win.eval(`pkgPickupNudgeHTML()`);
  console.log('Test 6 (pickup nudge respects the 3-day lead window and switches to "open now"):', {
    result: (nudgeFar==='' &&
      nudgeSoon.includes('Soon Pickup Race') && nudgeSoon.includes('opens soon') &&
      nudgeOpen.includes('Open Pickup Race') && nudgeOpen.includes('is open') && nudgeOpen.includes('Collect your package')) ? 'PASS' : 'FAIL'
  });

  // ---- Test 6b: a race marked done drops out of the pickup nudge entirely, same as it does for the
  // registration-open nudge -- nothing left to remind about once a race is over ----
  win.eval(`RACES_LIST.length=0;`);
  win.eval(`RACES_LIST.push(normalizeRaceRecord({name:'Done Race',date:'2026-08-01',status:'done',pkgPickupStart:addDaysISO(todayISO(),1)}))`);
  const nudgeDone = win.eval(`pkgPickupNudgeHTML()`);
  console.log('Test 6b (a done race never triggers the pickup nudge):', nudgeDone==='' ? 'PASS' : 'FAIL');

  // ---- Test 7: pkgPickupsDueForReminder() finds exactly the races inside the lead window that
  // haven't already fired, and maybePkgPickupReminder() fires a real Notification, marks
  // pkgReminderFired, and never fires again for that same race ----
  win.eval(`RACES_LIST.length=0; PROFILE.pkgReminderEnabled=true;`);
  win.eval(`RACES_LIST.push(normalizeRaceRecord({name:'Due Race',date:'2026-12-01',status:'registered',pkgPickupStart:addDaysISO(todayISO(),1),pkgPickupEnd:addDaysISO(todayISO(),2),pkgPickupLocation:'Loc'}))`);
  win.eval(`RACES_LIST.push(normalizeRaceRecord({name:'Not Due Race',date:'2026-12-01',status:'registered',pkgPickupStart:addDaysISO(todayISO(),20)}))`);
  const dueBefore = win.eval(`pkgPickupsDueForReminder().map(r=>r.name)`);
  win.eval(`
    window.__notifCount=0;
    window.Notification=function(title,opts){ window.__notifCount++; this.title=title; this.body=opts.body; };
    Notification.permission='granted';
  `);
  win.eval(`maybePkgPickupReminder()`);
  const notifCount = win.eval(`window.__notifCount`);
  const dueAfter = win.eval(`pkgPickupsDueForReminder().length`);
  win.eval(`maybePkgPickupReminder()`); // run again -- should be a no-op now
  const notifCountAfterSecondRun = win.eval(`window.__notifCount`);
  console.log('Test 7 (pickup reminder fires exactly once per due race, never repeats):', {
    dueBefore, notifCount,
    result: (JSON.stringify(dueBefore)===JSON.stringify(['Due Race']) && notifCount===1 && dueAfter===0 && notifCountAfterSecondRun===1) ? 'PASS' : 'FAIL'
  });

  // ---- Test 7b: the reminder respects its own on/off toggle -- disabled means no notification and
  // no pkgReminderFired flag set, even for a race squarely inside the lead window ----
  win.eval(`RACES_LIST.length=0; PROFILE.pkgReminderEnabled=false; window.__notifCount=0;`);
  win.eval(`RACES_LIST.push(normalizeRaceRecord({name:'Disabled Toggle Race',date:'2026-12-01',status:'registered',pkgPickupStart:addDaysISO(todayISO(),1)}))`);
  win.eval(`maybePkgPickupReminder()`);
  const firedWhileDisabled = win.eval(`RACES_LIST[0].pkgReminderFired`);
  console.log('Test 7b (reminder toggle off means no notification and no fired flag):', {
    result: (win.eval(`window.__notifCount`)===0 && firedWhileDisabled===false) ? 'PASS' : 'FAIL'
  });

  // ---- Test 8: Settings renders the new Race Package Pickup Reminders section with a working on/off
  // toggle (setPkgReminderEnabled), separate from the existing Session Reminders section ----
  win.eval(`PROFILE.pkgReminderEnabled=false;`);
  const settingsOff = win.eval(`renderSettingsBody()`);
  win.eval(`setPkgReminderEnabled(true)`);
  const settingsOn = win.eval(`renderSettingsBody()`);
  console.log('Test 8 (Settings has its own Race Package Pickup Reminders toggle section):', {
    result: (settingsOff.includes('Race Package Pickup Reminders') && settingsOn.includes('Race Package Pickup Reminders') &&
      settingsOff.includes('Session Reminders') && win.eval(`PROFILE.pkgReminderEnabled`)===true) ? 'PASS' : 'FAIL'
  });

  // ---- Test 9: the Race Day Strategy view shows a Package Pickup info card when pkgPickupStart is
  // set (with location and notes), and omits it entirely for a race with no pickup info at all ----
  win.eval(`RACES_LIST.length=0;`);
  win.eval(`RACES_LIST.push(normalizeRaceRecord({name:'Strategy Race With Pickup',date:'2026-12-01',status:'registered',pkgPickupStart:'2026-11-20',pkgPickupEnd:'2026-11-22',pkgPickupLocation:'Fitness Zone',pkgPickupNotes:'Bring ID'}))`);
  win.eval(`RACES_LIST.push(normalizeRaceRecord({name:'Strategy Race No Pickup',date:'2026-12-01',status:'registered'}))`);
  const stratWith = win.eval(`renderRaceStrategyHTML(RACES_LIST.find(r=>r.name==='Strategy Race With Pickup'))`);
  const stratWithout = win.eval(`renderRaceStrategyHTML(RACES_LIST.find(r=>r.name==='Strategy Race No Pickup'))`);
  console.log('Test 9 (Race Day Strategy shows a Package Pickup card only when pickup info is set):', {
    result: (stratWith.includes('Package Pickup') && stratWith.includes('Fitness Zone') && stratWith.includes('Bring ID') &&
      !stratWithout.includes('Package Pickup')) ? 'PASS' : 'FAIL'
  });

  await wait(200);
  win.close();
})();
