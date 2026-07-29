// Regression test for the Runna-style Add/Edit Shoe form redesign. The old form only had a single
// free-text Name field, a "Starting km" number, and a Notes field, and existing shoes could only be
// Retired, never actually edited. New: a Brand dropdown (POPULAR_SHOE_BRANDS, with an "Other"
// free-text fallback), Model/Color/Nickname fields, a continuous Distance Goal slider that sets the
// replacement-mileage alert right at creation, and a real Edit flow (startEditShoe/saveShoeEdit)
// that works on every shoe, including the ones seeded in before this feature existed.
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

  win.eval(`
    SHOES = {
      sl2:{name:'Adidas Adizero SL2',km:421.9,note:'Easy, foundation, long runs',retired:false}
    };
    openShoes();
  `);

  // ---- Test 0: NEW (Task #128) -- the form is now hidden behind a "+ Add Shoe" button by default
  // instead of sitting front-and-center; opening Shoes shows the button and the list, not the form ----
  const collapsedHTML = win.eval(`document.getElementById('shoes-sh-body').innerHTML`);
  const showsAddButton = collapsedHTML.includes('openShoeAddForm()') && collapsedHTML.includes('+ Add Shoe');
  const formHiddenByDefault = !collapsedHTML.includes('<select id="sh-brand"');
  console.log('Test 0 (form is hidden behind a + Add Shoe button by default):',
    (showsAddButton && formHiddenByDefault) ? 'PASS' : 'FAIL', { showsAddButton, formHiddenByDefault });

  // Open the add form for the rest of the tests that need the actual form fields on screen.
  win.eval(`openShoeAddForm();`);

  // ---- Test 1: the add form now has a Brand select populated with a real list of popular running
  // shoe brands (plus an Other fallback), instead of one bare free-text Name field ----
  const formHTML1 = win.eval(`document.getElementById('shoes-sh-body').innerHTML`);
  const hasBrandSelect = /<select id="sh-brand"/.test(formHTML1);
  const hasKnownBrands = ['Nike','Asics','Brooks','Hoka','Saucony'].every(b=>formHTML1.includes(`>${b}<`));
  const hasOtherOption = formHTML1.includes('>Other<');
  const noOldNameField = !formHTML1.includes('id="sh-name"');
  console.log('Test 1 (Brand select with popular brands + Other, old bare Name field gone):',
    (hasBrandSelect && hasKnownBrands && hasOtherOption && noOldNameField) ? 'PASS' : 'FAIL',
    { hasBrandSelect, hasKnownBrands, hasOtherOption, noOldNameField });

  // ---- Test 2: Model, Color, Nickname, and a Distance Goal slider (rpe-widget) are all present ----
  const hasModel = formHTML1.includes('id="sh-model"');
  const hasColor = formHTML1.includes('id="sh-color"');
  const hasNickname = formHTML1.includes('id="sh-nickname"');
  const hasGoalSlider = formHTML1.includes('id="sh-alertkm-range"') && formHTML1.includes('Distance Goal');
  const hasAdvisoryText = formHTML1.includes('500-800');
  console.log('Test 2 (Model/Color/Nickname fields + Distance Goal slider + advisory copy present):',
    (hasModel && hasColor && hasNickname && hasGoalSlider && hasAdvisoryText) ? 'PASS' : 'FAIL',
    { hasModel, hasColor, hasNickname, hasGoalSlider, hasAdvisoryText });

  // ---- Test 3: adding a shoe via Brand + Model (no nickname) derives its display name as
  // "Brand Model", and the Distance Goal slider value is stored as that shoe's alertKm ----
  win.eval(`
    document.getElementById('sh-brand').value='Hoka';
    document.getElementById('sh-model').value='Mach 6';
    document.getElementById('sh-color').value='Blue';
    document.getElementById('sh-km').value='0';
    document.getElementById('sh-alertkm-range').value='650';
    onShAlertKmSlide();
    addShoe();
  `);
  const newShoe = win.eval(`
    (function(){
      const k = Object.keys(SHOES).find(k=>SHOES[k].brand==='Hoka' && SHOES[k].model==='Mach 6');
      return k ? SHOES[k] : null;
    })()
  `);
  console.log('Test 3 (adding via Brand+Model derives "Brand Model" as the display name, stores alertKm):',
    (newShoe && newShoe.name==='Hoka Mach 6' && newShoe.color==='Blue' && newShoe.alertKm===650) ? 'PASS' : 'FAIL', { newShoe });

  // ---- Test 4: choosing "Other" as the brand reveals a free-text brand field, and its value is
  // used as the shoe's brand/name when saved. NOTE: addShoe() in Test 3 closed the form again (the
  // hide-behind-a-button redesign resets SH_FORM_OPEN on success), so the form has to be explicitly
  // reopened here before touching its fields. ----
  win.eval(`
    openShoeAddForm();
    document.getElementById('sh-brand').value='Other';
    onShBrandChange();
  `);
  const otherWrapVisible = win.eval(`document.getElementById('sh-brand-other-wrap').style.display !== 'none'`);
  win.eval(`
    document.getElementById('sh-brand-other').value='Local Cobbler Co';
    document.getElementById('sh-model').value='Trail Special';
    addShoe();
  `);
  const otherBrandShoe = win.eval(`
    (function(){
      const k = Object.keys(SHOES).find(k=>SHOES[k].brand==='Local Cobbler Co');
      return k ? SHOES[k] : null;
    })()
  `);
  console.log('Test 4 (selecting Other reveals a free-text brand field, used as the shoe\\u2019s brand):',
    (otherWrapVisible && otherBrandShoe && otherBrandShoe.name==='Local Cobbler Co Trail Special') ? 'PASS' : 'FAIL',
    { otherWrapVisible, otherBrandShoe });

  // ---- Test 5: a hardcoded/pre-existing shoe (sl2, seeded with only a legacy "name", no brand/
  // model) is now genuinely editable, not just retire-only. Clicking Edit opens the same form
  // pre-filled with its current data, and saving a change (e.g. adding a Nickname) actually updates
  // the shoe while preserving its original name since brand/model are still blank. ----
  const listHTML = win.eval(`document.getElementById('shoes-sh-body').innerHTML`);
  const hasEditButtonForLegacyShoe = listHTML.includes(`onclick="startEditShoe('sl2')"`);
  win.eval(`startEditShoe('sl2');`);
  const editFormHTML = win.eval(`document.getElementById('shoes-sh-body').innerHTML`);
  const prefilledKm = win.eval(`document.getElementById('sh-km').value`);
  const editButtonSaysChanges = editFormHTML.includes('Save Changes') && editFormHTML.includes('Cancel');
  win.eval(`
    document.getElementById('sh-nickname').value='Long Run Pair';
    saveShoeEdit();
  `);
  const editedShoe = win.eval(`SHOES.sl2`);
  console.log('Test 5 (a hardcoded shoe is genuinely editable: Edit button, pre-filled form, save updates it):', {
    hasEditButtonForLegacyShoe, prefilledKm, editButtonSaysChanges,
    nicknameApplied: editedShoe.nickname==='Long Run Pair',
    nameUpdatedFromNickname: editedShoe.name==='Long Run Pair',
    kmPreserved: Math.abs(editedShoe.km-421.9)<0.01,
    result: (hasEditButtonForLegacyShoe && editButtonSaysChanges && editedShoe.nickname==='Long Run Pair' && editedShoe.name==='Long Run Pair' && Math.abs(editedShoe.km-421.9)<0.01) ? 'PASS' : 'FAIL'
  });

  // ---- Test 6: editing a shoe and clearing Nickname/Brand/Model back to blank does NOT wipe its
  // name to empty — it falls back to keeping the existing name, since a legacy shoe might have
  // nothing else to derive a name from ----
  win.eval(`
    startEditShoe('sl2');
    document.getElementById('sh-nickname').value='';
    saveShoeEdit();
  `);
  const afterClearNickname = win.eval(`SHOES.sl2.name`);
  console.log('Test 6 (clearing Nickname/Brand/Model back to blank keeps the existing name, doesn\\u2019t blank it):',
    afterClearNickname==='Long Run Pair' ? 'PASS' : 'FAIL', { afterClearNickname });

  // ---- Test 7: Cancel discards edits without saving, and -- per the Task #128 hide-behind-a-button
  // redesign -- collapses the form back behind the "+ Add Shoe" button instead of falling back to a
  // blank add-mode form sitting front-and-center ----
  win.eval(`
    startEditShoe('sl2');
    document.getElementById('sh-nickname').value='Should Not Save';
    cancelShoeEdit();
  `);
  const afterCancelName = win.eval(`SHOES.sl2.name`);
  const afterCancelHTML = win.eval(`document.getElementById('shoes-sh-body').innerHTML`);
  const formIsCollapsedAfterCancel = afterCancelHTML.includes('+ Add Shoe') && !afterCancelHTML.includes('<select id="sh-brand"');
  console.log('Test 7 (Cancel discards the in-progress edit and collapses the form behind the button):',
    (afterCancelName==='Long Run Pair' && formIsCollapsedAfterCancel) ? 'PASS' : 'FAIL', { afterCancelName, formIsCollapsedAfterCancel });

  // ---- Test 8: reopening the Shoes sheet resets any in-progress edit state, so a half-finished
  // edit from a previous visit never silently reappears -- and per Task #128, it also always
  // collapses back behind the button rather than reopening straight into add-mode ----
  win.eval(`startEditShoe('sl2'); closeOverlay('shoes-overlay'); openShoes();`);
  const reopenedHTML = win.eval(`document.getElementById('shoes-sh-body').innerHTML`);
  const reopenedIsCollapsed = reopenedHTML.includes('+ Add Shoe') && !reopenedHTML.includes('<select id="sh-brand"');
  console.log('Test 8 (reopening Shoes always resets to the collapsed button state, no stale edit state):', reopenedIsCollapsed ? 'PASS' : 'FAIL');

  // ---- Test 9: NEW (Task #128) -- clicking "+ Add Shoe" opens a blank add-mode form, and Cancel
  // from add-mode (not just edit-mode) also collapses it back behind the button without adding
  // anything ----
  win.eval(`openShoeAddForm();`);
  const openedAddHTML = win.eval(`document.getElementById('shoes-sh-body').innerHTML`);
  const addFormOpened = openedAddHTML.includes('Add a new pair') && openedAddHTML.includes('<select id="sh-brand"');
  const shoeCountBefore = win.eval(`Object.keys(SHOES).length`);
  win.eval(`closeShoeForm();`);
  const afterAddCancelHTML = win.eval(`document.getElementById('shoes-sh-body').innerHTML`);
  const collapsedAfterAddCancel = afterAddCancelHTML.includes('+ Add Shoe') && !afterAddCancelHTML.includes('<select id="sh-brand"');
  const shoeCountAfter = win.eval(`Object.keys(SHOES).length`);
  console.log('Test 9 (+ Add Shoe opens a blank form; Cancel from add-mode collapses it, adds nothing):',
    (addFormOpened && collapsedAfterAddCancel && shoeCountBefore===shoeCountAfter) ? 'PASS' : 'FAIL',
    { addFormOpened, collapsedAfterAddCancel, shoeCountBefore, shoeCountAfter });

  await wait(200);
  win.close();
})();
