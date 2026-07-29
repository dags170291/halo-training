// Regression test for the per-shoe photo feature (Task #129), requested alongside the shoe-form
// hide-behind-a-button redesign ("this is something I always wanted strava to have"). Reuses the
// existing avatar pan/zoom crop-overlay (openImageCropper/saveAvatarCrop) rather than building a
// second cropper from scratch -- CROP_TARGET now says whether a cropped photo should land on
// PROFILE.avatarImage (unchanged existing behavior) or SH_PENDING_IMAGE (new), and shoe photos are
// only actually written into SHOES on the next Add shoe / Save Changes click, same as every other
// field in that form, rather than persisting the instant a photo is cropped.
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
      // jsdom doesn't implement real <canvas> 2D rendering (no native 'canvas' package installed),
      // so the crop-save path's ctx.drawImage/toDataURL calls need a minimal fake here -- this is a
      // test-environment gap only, not an app bug: real browsers always support canvas 2D.
      win.HTMLCanvasElement.prototype.getContext = function(){
        return { clearRect(){}, drawImage(){} };
      };
      let fakeDataUrlCounter = 0;
      win.HTMLCanvasElement.prototype.toDataURL = function(){
        fakeDataUrlCounter++;
        return 'data:image/jpeg;base64,FAKE' + fakeDataUrlCounter;
      };
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
    SHOES = { sl2:{name:'Adidas Adizero SL2',km:421.9,note:'Easy, foundation, long runs',retired:false} };
    openShoes();
  `);

  // ---- Test 1: the collapsed (button) state has no photo thumbnail markup for a shoe with no
  // image yet -- opening the add form shows a camera-placeholder box with an "Add Photo" control ----
  win.eval(`openShoeAddForm();`);
  const addFormHTML = win.eval(`document.getElementById('shoes-sh-body').innerHTML`);
  const hasPhotoField = addFormHTML.includes('Photo (optional)') && addFormHTML.includes('Add Photo');
  const hasFileInput = /accept="image\/\*"[\s\S]{0,40}onchange="handleShoeImageUpload\(event\)"/.test(addFormHTML);
  console.log('Test 1 (add form shows a Photo field with an Add Photo file picker, no existing image):',
    (hasPhotoField && hasFileInput) ? 'PASS' : 'FAIL', { hasPhotoField, hasFileInput });

  // ---- Test 2: simulate picking + cropping a photo while adding a new shoe -- this routes through
  // openImageCropper(img,{type:'shoe'}) and saveAvatarCrop(), which should land the result in
  // SH_PENDING_IMAGE (not PROFILE.avatarImage) and NOT touch SHOES yet, since the shoe doesn't exist
  // until Add Shoe is actually clicked ----
  win.eval(`
    // A 4x4 fake "image" is enough -- CROP_IMG only needs .width/.height for the draw math, and
    // canvas.toDataURL works on an empty/blank canvas fine in jsdom.
    const fakeImg = { width: 4, height: 4 };
    openImageCropper(fakeImg, {type:'shoe'});
  `);
  const cropTargetType = win.eval(`CROP_TARGET.type`);
  win.eval(`saveAvatarCrop();`);
  const pendingImageSet = win.eval(`typeof SH_PENDING_IMAGE === 'string' && SH_PENDING_IMAGE.length > 0`);
  const avatarUntouched = win.eval(`!PROFILE.avatarImage`);
  const shoesStillEmpty = win.eval(`Object.keys(SHOES).length`);
  console.log('Test 2 (cropping a shoe photo sets SH_PENDING_IMAGE, not PROFILE.avatarImage or SHOES):',
    (cropTargetType==='shoe' && pendingImageSet && avatarUntouched && shoesStillEmpty===1) ? 'PASS' : 'FAIL',
    { cropTargetType, pendingImageSet, avatarUntouched, shoesStillEmpty });

  // ---- Test 3: the add form re-renders showing the picked photo as a live preview thumbnail
  // (before Add Shoe is clicked), with the control now reading "Change Photo" + a "Remove Photo"
  // option that wasn't there before a photo existed ----
  const afterPickHTML = win.eval(`document.getElementById('shoes-sh-body').innerHTML`);
  const showsPreview = afterPickHTML.includes('Change Photo') && afterPickHTML.includes('Remove Photo') && afterPickHTML.includes('<img src="data:');
  console.log('Test 3 (form shows a live preview thumbnail + Change/Remove Photo once a photo is picked):',
    showsPreview ? 'PASS' : 'FAIL');

  // ---- Test 4: completing Add Shoe actually writes the picked photo onto the new SHOES record,
  // and the list row for that shoe now renders a thumbnail image ----
  win.eval(`
    document.getElementById('sh-brand').value='Nike';
    document.getElementById('sh-model').value='Pegasus';
    addShoe();
  `);
  const newShoe = win.eval(`
    (function(){
      const k = Object.keys(SHOES).find(k=>SHOES[k].brand==='Nike');
      return k ? {key:k, hasImage: typeof SHOES[k].image==='string' && SHOES[k].image.length>0} : null;
    })()
  `);
  const listHTMLAfterAdd = win.eval(`document.getElementById('shoes-sh-body').innerHTML`);
  const hasThumbImg = /border-radius:var\(--r10\);overflow:hidden;flex-shrink:0"><img src="data:/.test(listHTMLAfterAdd);
  console.log('Test 4 (Add Shoe saves the picked photo onto the new shoe, list row shows a thumbnail):',
    (newShoe && newShoe.hasImage && hasThumbImg) ? 'PASS' : 'FAIL', { newShoe, hasThumbImg });

  // ---- Test 5: editing an existing shoe that already has a photo shows it pre-filled in the form
  // (no re-pick needed), and "Remove Photo" clears it on save without requiring a new photo ----
  win.eval(`startEditShoe('${newShoe ? newShoe.key : ''}');`);
  const editFormHTML = win.eval(`document.getElementById('shoes-sh-body').innerHTML`);
  const editShowsExistingPhoto = editFormHTML.includes('Change Photo') && editFormHTML.includes('<img src="data:');
  win.eval(`removeShoeImage(); saveShoeEdit();`);
  const afterRemove = win.eval(`SHOES['${newShoe ? newShoe.key : ''}'].image`);
  console.log('Test 5 (editing shows the existing photo pre-filled; Remove Photo + Save clears it):',
    (editShowsExistingPhoto && (afterRemove===null || afterRemove===undefined)) ? 'PASS' : 'FAIL',
    { editShowsExistingPhoto, afterRemove });

  // ---- Test 6: a shoe with no photo at all (e.g. the original legacy sl2 shoe, never given one)
  // renders its list row with no thumbnail slot -- not a broken/empty image box ----
  const listHTML = win.eval(`document.getElementById('shoes-sh-body').innerHTML`);
  const sl2RowIdx = listHTML.indexOf('Adidas Adizero SL2');
  const sl2RowSlice = sl2RowIdx>-1 ? listHTML.slice(Math.max(0,sl2RowIdx-400), sl2RowIdx) : '';
  const sl2HasNoThumb = !sl2RowSlice.includes('<img');
  console.log('Test 6 (a shoe with no photo renders no thumbnail slot, not an empty image box):',
    sl2HasNoThumb ? 'PASS' : 'FAIL');

  // ---- Test 7: the avatar cropper (Profile photo) still works completely unchanged through the
  // same shared crop machinery, confirming the shoe-photo addition didn't regress it ----
  win.eval(`
    const fakeImg2 = { width: 4, height: 4 };
    openAvatarCropper(fakeImg2);
  `);
  const avatarCropTargetType = win.eval(`CROP_TARGET.type`);
  win.eval(`saveAvatarCrop();`);
  const avatarImageSet = win.eval(`typeof PROFILE.avatarImage === 'string' && PROFILE.avatarImage.length > 0`);
  console.log('Test 7 (the original avatar cropper still targets PROFILE.avatarImage, unchanged):',
    (avatarCropTargetType==='avatar' && avatarImageSet) ? 'PASS' : 'FAIL', { avatarCropTargetType, avatarImageSet });

  await wait(200);
  win.close();
})();
