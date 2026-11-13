import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = path => readFileSync(new URL('../../' + path, import.meta.url),'utf8')
    .replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');

function photoFixture() {
    const jobs = new Map(), transfers = [], writes = [], delays = [], backups = [];
    const file = new Blob(['jpeg'],{type:'image/jpeg'});
    const attempts = new Map();
    const context = {
        AbortController, SECURE_DRIVE_EVIDENCE_PREFIXES:new Set(['lsn-']), drivePhotoAttachments:jobs, drivePhotoSaveChains:new Map(),
        isCurrentDrivePhotoAttachment:job => jobs.get(job.id) === job && job.scope === context.owner,
        getSupabaseReadIdentityScope:() => context.owner, owner:'current',
        findLinkedMasterRow:() => null, canonicalInventoryLinkedUid:() => '', isDockSuspendDcRequestMirrorRow:() => false,
        waitForOperationalPrerequisite:read => read(), inventoryPhotoLocationKey:() => '',
        getPendingPhotoPreviewEntries:item => [jobs.get(item.UNIQUE_ID)?.preview].filter(Boolean), refreshPendingPhotoUiForItem() {},
        registerPendingPhotoUpload() {}, showToast() {}, formatPhotoUploadErrorMessage:error => error.message,
        isTransientPhotoUploadFailure:error => error instanceof TypeError || /timed out/.test(error.message),
        normalizeStoragePublicUrl:url => url.replace('/render/image/','/object/'),
        optimizePhotoBlobForUpload:async () => ({blob:file}), retainDetailPhotoBlob:async job => { backups.push(job.id); },
        persistDrivePhotoAttachment:async job => { writes.push(job.id); jobs.delete(job.id); },
        setTimeout(callback, delay) {
            if (delay !== 25000 && delay !== 500) { delays.push(delay); queueMicrotask(callback); }
            return 0;
        }, clearTimeout() {},
    };
    runInNewContext(source('src/core/inventory-photo-domain.js'),context);
    context.uploadPhotoViaAppApi = async (_prefix, _file, name, _type, options) => {
        const id = name.split('.')[0], attempt = (attempts.get(id) || 0) + 1;
        attempts.set(id,attempt);
        transfers.push(id);
        assert.equal(options.timeoutMs,25000);
        assert.equal(options.preparedPhoto.blob,file);
        assert.ok(backups.includes(id));
        if (id === '1' && attempt < 4) {
            throw [null,Object.assign(new Error('server'),{status:507}),new TypeError('network'),new Error('timed out')][attempt];
        }
        if (id === 'denied') throw Object.assign(new Error('denied'),{status:403});
        return {publicUrl:'https://example.invalid/storage/v1/render/image/public/b/' + name};
    };
    const add = id => {
        const job = {id, item:{UNIQUE_ID:id}, identity:{UNIQUE_ID:id}, scope:context.owner, prefix:'req-', file,
            fileName:id + '.jpg',preview:{id,localPreviewUrl:'blob:' + id}};
        jobs.set(id,job);
        context.retryDrivePhotoAttachment(id);
        return job;
    };
    return {context,add,transfers,writes,delays,attempts};
}

function assertPreviewFallback() {
    const remote = 'https://example.invalid/storage/v1/object/public/b/1.jpg';
    const slot = {localPreviewUrl:'blob:1',publicUrl:remote,publicPreviewReady:false};
    const img = {dataset:{src:remote}};
    const context = {findPendingPhotoPreviewByUrl:() => slot,normalizeStoragePublicUrl:url => url};
    runInNewContext(source('src/views/deferred-card-photo-queue.js'),context);
    assert.equal(context.resolveDeferredPhotoSources(img).src,'blob:1');
    slot.publicPreviewReady = true;
    const loaded = context.resolveDeferredPhotoSources(img);
    assert.equal(loaded.src,remote);
    assert.equal(loaded.fallbackSrc,'blob:1');
}

export async function assertOrderedDetailPhotoUploads() {
    const fixture = photoFixture();
    const ids = ['1','2','3','4','5','6'];
    const jobs = ids.map(fixture.add);
    await Promise.all(jobs.map(job => job.promise));
    assert.deepEqual(fixture.delays,[1000,2500,5000]);
    assert.deepEqual(fixture.transfers,['1','1','1',...ids]);
    assert.deepEqual(fixture.writes,ids);
    assert.ok(jobs.every(job => job.upload.publicUrl.includes('/storage/v1/object/public/')));
    const denied = fixture.add('denied');
    await assert.rejects(denied.promise,/denied/);
    assert.equal(fixture.attempts.get('denied'),1);
    assert.equal(denied.preview.localPreviewUrl,'blob:denied');
    const stale = fixture.add('stale');
    fixture.context.owner = 'other';
    await stale.promise;
    assert.equal(fixture.attempts.has('stale'),false);
    assertPreviewFallback();
}
