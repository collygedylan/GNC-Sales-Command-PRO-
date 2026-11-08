import assert from 'node:assert/strict';

export function photoParityContract(runFunctions, functionSource, plain) {
  const shared = 'https://photos.invalid/a.jpg, https://photos.invalid/b.jpg';
  const context = runFunctions('assets/app-runtime.js', ['resolveCanonicalInventoryRow','isValidPhotoRow','getAvRowPhotoUrls','getRowPhotoLink','resolveCanonicalPhotoUrls','getDetailPhotoUrls'], {
    lastView: 'drive',masterInventoryById:new Map(),masterInventoryByItemCode:new Map(),
    getManagerAssignedColumnState:()=>({}),getSupabaseReadIdentityScope:()=> 'actor',
    getPhotoEntryDateMs:()=>Date.now(),getPhotoRetentionFallbackDateMs:()=>Date.now(),isPhotoDateMsExpired:()=>false, getRequestPhotoLinkCsv: () => '', getQueueCardInventoryRow: () => null,
    getSharedAppPhotoLinkCsv: item => item.PHOTO_LINK || '', getDockOwnedPhotoLinkCsv: () => '', shouldPreferFlyerOwnedFields: () => false,
    getFlyerVisiblePhotoLinkCsv: () => '', shouldHideSharedAppPhotoForExpiredAvRules: () => false,
    mergePhotoCsvList: values => values.filter(Boolean).join(','), filterPhotoCsvByRetention: value => value,
    getSharedAppPhotoName: () => '', getPhotoUrlList: value => (Array.isArray(value) ? value.map(entry=>entry.url || entry) : String(value || '').split(',')).map(entry => String(entry).trim()).filter(Boolean),
    resolveAndFormatPhotoDate: () => '',
  });
  const item = { UNIQUE_ID:'row',ITEMCODE:'A',LOCATIONCODE:'L',LOTCODE:'27.F1',PTRONHAND:10,PHOTO_LINK:shared };
  context.masterInventoryById.set('row',item);
  const drive = plain(context.resolveCanonicalPhotoUrls(item, 'drive'));
  const av = plain(context.resolveCanonicalPhotoUrls(item, 'av'));
  const lightbox = plain(context.getDetailPhotoUrls(item, 'drive'));
  assert.deepEqual(drive, av);
  assert.deepEqual(lightbox, drive);
  assert.deepEqual(drive, ['https://photos.invalid/a.jpg', 'https://photos.invalid/b.jpg']);
  assert.match(functionSource('assets/app-runtime.js', 'generateCard'), /resolveCanonicalPhotoUrls/);
}
