import assert from 'node:assert/strict';
import vm from 'node:vm';

export function checkPhotoPreview(runtime, workflow, extract) {
  let probe,revoked=0;const entries=new Map(),item={UNIQUE_ID:'one'},photo={getPhotoBucketKeysForItem:()=>['lsn'],createPendingPhotoToken:()=> 'upload',getSupabaseReadIdentityScope:()=>'owner',pendingPhotoPreviews:entries,getPendingPhotoPreviewKey:()=> 'one::lsn',normalizeStoragePublicUrl:v=>v.replace('/render/image/','/object/'),refreshPendingPhotoUiForItem:()=>{},URL:{revokeObjectURL:()=>revoked++},Image:class {constructor(){probe=this;}},rowPhotoIdentity:v=>v};
  vm.runInNewContext(['createPendingPhotoPreview','clearPendingPhotoPreview','getPendingPhotoPreviewEntries'].map(n=>extract(runtime,n)).join('\n')+'\n'+['verifyPublishedPhotoPreview','mergeRowPhotoSlots'].map(n=>extract(workflow,n)).join('\n'),photo);
  photo.createPendingPhotoPreview(item,'lsn-','blob:local','one.jpg');photo.verifyPublishedPhotoPreview(item,'lsn-','upload','https://host/storage/v1/render/image/public/photos/one','one.jpg');
  const slot=photo.getPendingPhotoPreviewEntries(item,'lsn-')[0];assert.equal(slot.localPreviewUrl,'blob:local');assert.equal(slot.status,'Uploaded');assert.ok(probe.src.includes('/object/public/'));
  probe.onerror();assert.equal(slot.url,'blob:local');probe.naturalWidth=0;probe.onload();assert.equal(photo.getPendingPhotoPreviewEntries(item,'lsn-').length,1);
  probe.naturalWidth=800;probe.onload();const merged=photo.mergeRowPhotoSlots([slot],[{url:slot.publicUrl,persistedIndex:0}]);assert.equal(merged.length,1);assert.equal(merged[0].previewUrl,'blob:local');assert.equal(merged[0].persistedIndex,0);assert.equal(revoked,0);
  photo.clearPendingPhotoPreview(item,'lsn-','upload');assert.equal(photo.getPendingPhotoPreviewEntries(item,'lsn-').length,0);assert.equal(revoked,0);
}
