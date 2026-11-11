import test from 'node:test';
import assert from 'node:assert/strict';
import {context} from './helpers/photo-pipeline-context.mjs';

const owners = ['assertCurrentPhotoUpload', 'getDrivePhotoGatewayState', 'rememberDrivePhotoGatewayFailure',
    'getNativeDrivePhotoObject', 'uploadDrivePhotoWithNativeSession', 'uploadRowPhotoAttachment', 'acceptQueuedRowPhotoUpload',
    'getRowPhotoUploadIdentity', 'capturedPhotoSourceFields', 'setDrivePhotoAttachmentStatus', 'retryPhotoOperation', 'runRowPhotoAttachmentWithRetry',
    'retryDrivePhotoAttachment', 'enqueueRowPhotoSave', 'rowPhotoSaveKey', 'persistQueuedRowPhoto'];

test('main ACK enters the canonical publisher immediately while thumbnail failure preserves uploaded status and raw retry identity', async () => {
    const file = new Blob([new Uint8Array([255,216,255,1])], {type:'image/jpeg'});
    const item = {UNIQUE_ID:'exact-master'}, preview = {id:'slot', url:'blob:local', status:'Uploading'};
    const job = {id:'slot', item, preview, identity:{UNIQUE_ID:'exact-master'}, scope:'account', prefix:'lsn-', file, fileName:'photo.jpg'};
    const jobs = new Map([[job.id,job]]), registered = [], reports = [];
    let releaseThumbnail, primaryWrites = 0, canonicalWrites = 0, c;
    c = context(owners, {
        drivePhotoAttachments:jobs, drivePhotoSaveChains:new Map(), nativeAuthRecoveryEpoch:0,
        SECURE_DRIVE_EVIDENCE_PREFIXES:new Set(['lsn-']), PHOTO_BUCKETS:{'lsn-':'location_sales_notes_photos'},
        ROW_PHOTO_TRANSFER_RETRY_DELAYS:[], ROW_PHOTO_SAVE_RETRY_DELAYS:[],
        getSupabaseReadIdentityScope:() => 'account', isCurrentDrivePhotoAttachment:target => jobs.get(target.id) === target,
        getPendingPhotoPreviewEntries:() => [preview], refreshPendingPhotoUiForItem() {},
        prepareQueuedRowPhoto:async () => null, getQueuedRowPhotoHeaders:async () => ({Authorization:'Bearer verified'}),
        normalizeStoragePublicUrl:url => url, SUPABASE_URL:'https://kzrnyjsosryejjejliii.supabase.co',
        uploadPhotoViaAppApi:async (_prefix, blob, _name, _type, options) => {
            assert.equal(blob, file);
            return c.uploadDrivePhotoWithNativeSession(new Map([['prefix','lsn-'],['masterUid','exact-master'],
                ['file',blob],['thumbnail144',blob],['thumbnail320',blob]]), options);
        },
        uploadNativeDrivePhotoPart:async path => {
            if (path.includes('-w144.')) throw Object.assign(new Error('Thumbnail denied'), {status:403});
            if (path.includes('-w320.')) return new Promise(resolve => { releaseThumbnail = resolve; });
            primaryWrites++;
        },
        isRetryablePhotoTransfer:() => false, isRetryablePhotoSave:() => false,
        registerPendingPhotoUpload:(_item,_prefix,promise,independent) => { registered.push({promise,independent}); },
        persistDrivePhotoAttachment:async target => {
            canonicalWrites++;
            assert.equal(target.upload.publicUrl, preview.storageUrl);
            assert.equal(preview.status, 'Uploaded');
            jobs.delete(target.id);
        },
        reportHandledRuntimeIssue:(...args) => reports.push(args), showToast:() => { throw new Error('Unexpected photo failure'); }
    });
    c.retryDrivePhotoAttachment(job.id);
    await job.promise;
    assert.equal(primaryWrites, 1);
    assert.equal(canonicalWrites, 1, 'main ACK must reach the canonical publisher before a slow thumbnail settles');
    assert.equal(preview.status, 'Uploaded');
    assert.equal(preview.url, 'blob:local');
    assert.equal(typeof releaseThumbnail, 'function');
    assert.equal(registered.length, 2, 'primary and auxiliary writes both remain visible to app-update activity guards');
    assert.equal(reports.length, 0);
    releaseThumbnail();
    await Promise.all(registered.map(entry => entry.promise));
    assert.deepEqual(reports, [['uploadRowPhotoAttachment','PHOTO_THUMBNAIL_UPLOAD_FAILED']]);
    assert.equal(preview.status, 'Uploaded', 'thumbnail-only failure cannot turn a confirmed primary into Save failed');
    assert.equal(job.file, file);
});
