// Regression test for session reminders (task #116): a client-side Notification API check that fires
// once a day, while HALO is open in a tab, for today's not-yet-logged session(s) at a chosen time.
// jsdom has no real Notification API, so this test installs a minimal mock (tracking permission state
// and captured notifications) rather than exercising a real browser notification.
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
  win.eval(`window.renderAll = function(){};`); // pre-existing jsdom/renderAll OOM workaround, same as other test files

  // Minimal mock Notification API — jsdom doesn't implement one at all.
  win.eval(`
    window.__notifications = [];
    function MockNotification(title, opts){ this.title = title; this.opts = opts; window.__notifications.push(this); }
    MockNotification.permission = 'default';
    MockNotification.requestPermission = function(){ MockNotification.permission = 'granted'; return Promise.resolve('granted'); };
    window.Notification = MockNotification;
  `);

  win.eval(`
    const t = todayISO();
    DATA = [
      {id:'s_run', wk:1, ph:'build', d:'D0', date:t, wd:'Mon', ty:'easy', ti:'Easy Run', full:'run', det:'6 km easy', dist:fmtDist(6)},
      {id:'s_done', wk:1, ph:'build', d:'D1', date:t, wd:'Tue', ty:'long', ti:'Long Run', full:'run', det:'done already', dist:fmtDist(12)},
      {id:'s_rest', wk:1, ph:'build', d:'D2', date:t, wd:'Wed', ty:'rest', ti:'Rest Day', full:'rest', det:'Full rest.'}
    ];
    STATUS = {s_done:'done'};
    PROFILE = PROFILE || {};
    PROFILE.reminderEnabled = false;
    PROFILE.reminderTime = '08:00';
    localStorage.removeItem('halo_reminder_notified_'+t);
  `);

  // ---- Test 1: todaysReminderSessions excludes rest days and already-done sessions ----
  const reminderSessions = win.eval(`todaysReminderSessions().map(s=>s.id)`);
  console.log('Test 1 (todaysReminderSessions excludes rest + done, keeps the real not-yet-done run):',
    JSON.stringify(reminderSessions) === JSON.stringify(['s_run']) ? 'PASS' : 'FAIL', { reminderSessions });

  // ---- Test 2: Settings section reflects Off state correctly (no time field, no test-reminder button) ----
  win.eval(`openSettings();`);
  let sectionHTML = win.eval(`renderReminderSectionHTML()`);
  console.log('Test 2 (Off state: no time picker, no test button):',
    (!sectionHTML.includes('reminder-time-input') && !sectionHTML.includes('sendTestReminder')) ? 'PASS' : 'FAIL');

  // ---- Test 3: setReminderEnabled(true) with permission still 'default' requests permission and
  // does NOT yet show the test-reminder button (not granted yet) ----
  win.eval(`setReminderEnabled(true);`);
  await wait(50);
  const enabledAfterSet = win.eval(`PROFILE.reminderEnabled`);
  const permissionAfterRequest = win.eval(`Notification.permission`);
  console.log('Test 3 (turning reminders on persists the setting and requests permission):',
    (enabledAfterSet === true && permissionAfterRequest === 'granted') ? 'PASS' : 'FAIL', { enabledAfterSet, permissionAfterRequest });

  // ---- Test 4: with permission now granted, the On-state section shows the time picker + test button ----
  sectionHTML = win.eval(`renderReminderSectionHTML()`);
  console.log('Test 4 (On + granted: shows time picker and Send Test Reminder):',
    (sectionHTML.includes('reminder-time-input') && sectionHTML.includes('sendTestReminder')) ? 'PASS' : 'FAIL');

  // ---- Test 5: maybeFireReminder does nothing before the chosen time ----
  win.eval(`setReminderTime('23:59');`); // definitely in the future relative to whenever this test runs
  win.eval(`window.__notifications = [];`);
  win.eval(`maybeFireReminder();`);
  const notifsBeforeTime = win.eval(`window.__notifications.length`);
  console.log('Test 5 (no notification fires before the chosen time):', notifsBeforeTime === 0 ? 'PASS' : 'FAIL', { notifsBeforeTime });

  // ---- Test 6: setReminderTime to an already-passed time re-triggers scheduleReminderCheck, which
  // runs an immediate maybeFireReminder() check — since the flag was just cleared, it fires right away
  // with the right not-yet-done session, rather than waiting for the next 60s interval tick ----
  win.eval(`window.__notifications = [];`);
  win.eval(`setReminderTime('00:00');`); // definitely already passed today -> clears flag -> fires immediately
  const notifsAfterTime = win.eval(`window.__notifications.length`);
  const firstNotifBody = win.eval(`window.__notifications[0] ? window.__notifications[0].opts.body : ''`);
  console.log('Test 6 (setting an already-passed time fires immediately, body mentions the real session):',
    (notifsAfterTime === 1 && firstNotifBody.includes('Easy Run')) ? 'PASS' : 'FAIL', { notifsAfterTime, firstNotifBody });

  // ---- Test 7: a second check the same day does NOT fire again (once-per-day flag) ----
  win.eval(`window.__notifications = [];`);
  win.eval(`maybeFireReminder();`);
  const notifsSecondCheck = win.eval(`window.__notifications.length`);
  console.log('Test 7 (does not re-fire a second time the same day):', notifsSecondCheck === 0 ? 'PASS' : 'FAIL', { notifsSecondCheck });

  // ---- Test 8: changing the reminder time again clears today's flag so it can fire again same day
  // (e.g. the person nudges their reminder time later after already getting today's notification) ----
  win.eval(`window.__notifications = [];`);
  win.eval(`setReminderTime('00:01');`); // still already-passed, but this is a NEW time -> flag reset -> fires again
  const notifsAfterTimeChange = win.eval(`window.__notifications.length`);
  console.log('Test 8 (changing the time resets the once-per-day flag):', notifsAfterTimeChange === 1 ? 'PASS' : 'FAIL', { notifsAfterTimeChange });

  // ---- Test 9: turning reminders off stops the interval (REMINDER_TIMER cleared) ----
  win.eval(`setReminderEnabled(false);`);
  const timerAfterOff = win.eval(`REMINDER_TIMER`);
  const enabledAfterOff = win.eval(`PROFILE.reminderEnabled`);
  console.log('Test 9 (turning reminders off persists the setting and clears the interval):',
    (enabledAfterOff === false && timerAfterOff === null) ? 'PASS' : 'FAIL', { enabledAfterOff, timerAfterOff });

  // ---- Test 10: sendTestReminder fires a real notification immediately regardless of the time-of-day
  // gate, using the real not-yet-done session (or a fallback placeholder if there is none) ----
  win.eval(`setReminderEnabled(true); window.__notifications = [];`);
  win.eval(`sendTestReminder();`);
  const testNotifCount = win.eval(`window.__notifications.length`);
  console.log('Test 10 (Send Test Reminder fires immediately, ignoring the time-of-day gate):', testNotifCount === 1 ? 'PASS' : 'FAIL', { testNotifCount });

  // ---- Test 11: with all sessions today logged done, no automatic reminder fires (nothing to remind about) ----
  win.eval(`STATUS = {s_run:'done', s_done:'done'}; setReminderTime('00:00'); window.__notifications = [];`);
  win.eval(`maybeFireReminder();`);
  const notifsAllDone = win.eval(`window.__notifications.length`);
  console.log('Test 11 (no reminder fires once every real session today is already logged done):', notifsAllDone === 0 ? 'PASS' : 'FAIL', { notifsAllDone });

  await wait(200);
  win.close();
})();
