import test from 'node:test';
import assert from 'node:assert/strict';
import {context} from './helpers/photo-pipeline-context.mjs';
const jpeg = () => new Blob([new Uint8Array([255,216,255,1])], {type:'image/jpeg'});
const transportNames = ['assertCurrentPhotoUpload', 'isTransientPhotoUploadFailure', 'uploadNativeDrivePhotoPart'];

test('Storage posts the JPEG Blob directly with a four-second wall-clock attempt and one fast retry', async () => {
    const file = jpeg(), calls = [];
    const c = context(transportNames, {
        SUPABASE_URL:'https://kzrnyjsosryejjejliii.supabase.co',
        fetchWithTimeout:async (url, init, timeout) => {
            calls.push({url, init, timeout});
            if (calls.length === 1) throw new Error('Mobile connection timed out');
            return {ok:true, status:200};
        }
    });
    await c.uploadNativeDrivePhotoPart('request_photos/exact/photo.jpg', file,
        {Authorization:'Bearer verified'}, () => true, {timeoutMs:30000});
    assert.equal(calls.length, 2);
    for (const {url, init, timeout} of calls) {
        assert.match(url, /\/storage\/v1\/object\/request_photos\/exact\/photo\.jpg$/);
        assert.equal(url.includes('/render/image/'), false);
        assert.equal(init.body, file);
        assert.equal(init.cache, 'no-store');
        assert.equal(init.referrerPolicy, 'no-referrer');
        assert.equal(init.headers['cache-control'], 'max-age=31536000');
        assert.equal(init.headers.Authorization, 'Bearer verified');
        assert.equal(init.photoUploadAttempt, true);
        assert.equal(timeout, 4000);
    }
});

test('the coordinator owns retries while a denied or stale account cannot send another binary', async () => {
    let writes = 0;
    const c = context(transportNames, {
        SUPABASE_URL:'https://kzrnyjsosryejjejliii.supabase.co',
        staleSupabaseReadScopeError:() => new Error('account changed'),
        fetchWithTimeout:async () => { writes++; return {ok:false, status:403, json:async () => ({})}; }
    });
    await assert.rejects(c.uploadNativeDrivePhotoPart('request_photos/exact/photo.jpg', jpeg(), {},
        () => true, {singleUploadAttempt:true}), error => error.status === 403);
    assert.equal(writes, 1);
    await assert.rejects(c.uploadNativeDrivePhotoPart('request_photos/exact/photo.jpg', jpeg(), {},
        () => false, {}), /account changed/);
    assert.equal(writes, 1);
});

test('an arbitrary conflict or Duplicate-shaped denial never confirms Storage or consumes an unbounded error body', async () => {
    let status = 409, bodyReads = 0;
    const c = context(transportNames, {
        SUPABASE_URL:'https://kzrnyjsosryejjejliii.supabase.co',
        fetchWithTimeout:async () => ({ok:false, status, json:() => { bodyReads++; return new Promise(() => {}); }})
    });
    for (status of [409, 403]) {
        await assert.rejects(c.uploadNativeDrivePhotoPart('request_photos/exact/photo.jpg', jpeg(), {}, () => true, {}),
            error => error.status === status);
    }
    assert.equal(bodyReads, 0);
});

test('cellular and hidden-tab handling cannot widen a photo attempt deadline', async () => {
    const observed = [];
    const c = context(['fetchWithTimeout'], {
        SUPABASE_URL:'https://kzrnyjsosryejjejliii.supabase.co', APP_API_FUNCTION_URL:'https://unused',
        SUPABASE_WRITE_TIMEOUT_MS:30000,
        document:{hidden:true, body:{dataset:{currentView:'detail'}}}, navigator:{connection:{type:'cellular'}},
        isDirectOperationalTransport:() => true, fetchSupabaseRestViaAppApiIfNeeded:async () => null,
        fetchTimedTransport:async (_url, _options, timeout, visible) => { observed.push({timeout, visible}); return {ok:true}; }
    });
    await c.fetchWithTimeout('https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/photos/exact',
        {method:'POST', photoUploadAttempt:true}, 4000, 'Drive photo storage');
    assert.deepEqual(observed, [{timeout:4000, visible:false}]);
    await c.fetchWithTimeout('https://kzrnyjsosryejjejliii.supabase.co/rest/v1/physical_rows',
        {method:'GET'}, 4000, 'Inventory');
    assert.equal(observed[1].timeout, 15000, 'unrelated operational transport retains its existing mobile budget');
});

test('exact-row preflight aborts at 500ms and never guesses an upload identity', async () => {
    const timers = [], job = {prefix:'req-', uploadController:new AbortController()};
    let signal;
    const c = context(['assertOperationalRequestCurrent', 'waitForOperationalPrerequisite', 'prepareQueuedRowPhoto'], {
        setTimeout:(callback, ms) => { timers.push({callback, ms}); return timers.length; }, clearTimeout() {},
        isCurrentDrivePhotoAttachment:() => true,
        findLinkedMasterRow:() => null,
        canonicalInventoryLinkedUid:() => '',
        resolveQueuedRowPhotoMaster:(_job, value) => { signal = value; return new Promise(() => {}); }
    });
    const prepared = c.prepareQueuedRowPhoto(job);
    assert.ok(timers.every(timer => timer.ms === 500));
    timers[0].callback();
    await assert.rejects(prepared, error => error.code === 'TRANSPORT_TIMEOUT');
    assert.equal(signal.aborted, true);
    assert.equal(job.uploadController.signal.aborted, false, 'a retry keeps its independent originating account controller');
});

test('a verified exact cached master starts immediately while unknown or conflicting rows still need a bounded proof', async () => {
    const master = {UNIQUE_ID:'master-1', ITEMCODE:'item', LOCATIONCODE:'A.01', LOTCODE:'26.F1'};
    let lookups = 0;
    const c = context(['prepareQueuedRowPhoto'], {
        findLinkedMasterRow:() => master, canonicalInventorySameLot:() => true,
        canonicalInventoryLinkedUid:() => '',
        waitForOperationalPrerequisite:() => { lookups++; throw new Error('slow proof should be skipped'); }
    });
    assert.equal(await c.prepareQueuedRowPhoto({prefix:'req-', item:{...master}, uploadController:new AbortController()}), master);
    assert.equal(lookups, 0);
});

test('photo preflight preserves non-Request routing and canonical physical UID ambiguity checks', async () => {
    const master = {UNIQUE_ID:'master-1'};
    let masterLookups = 0;
    const c = context(['assertOperationalRequestCurrent', 'waitForOperationalPrerequisite', 'prepareQueuedRowPhoto', 'resolveQueuedRowPhotoMaster'], {
        findLinkedMasterRow:() => { masterLookups++; return master; }, canonicalInventoryLinkedUid:() => '',
        isCurrentDrivePhotoAttachment:() => true
    });
    for (const prefix of ['ssn-', 'lsn-', 'na-', 'eval-', 'flyer-']) {
        assert.equal(await c.prepareQueuedRowPhoto({prefix, item:{}, uploadController:new AbortController()}), null);
    }
    assert.equal(masterLookups, 0, 'unrelated buckets cannot become native Request master uploads');
    assert.equal(await c.prepareQueuedRowPhoto({prefix:'dock-', item:{}, uploadController:new AbortController()}), master);
    assert.equal(masterLookups, 1, 'Docks retains its existing resolver path');
    const tuple = {ITEMCODE:'item', LOCATIONCODE:'A.01', LOTCODE:'26.F1'};
    const first = {...tuple, UNIQUE_ID:'first'}, second = {...tuple, UNIQUE_ID:'second'};
    const exact = context(['canonicalInventoryValue', 'normalizeCanonicalInventoryPart', 'canonicalInventoryRowUid',
        'canonicalInventoryLinkedUid', 'canonicalInventoryLot', 'canonicalInventorySameLocation', 'canonicalInventorySameLot',
        'resolveCanonicalInventoryTarget', 'findLinkedMasterRow', 'assertOperationalRequestCurrent', 'waitForOperationalPrerequisite',
        'prepareQueuedRowPhoto', 'resolveQueuedRowPhotoMaster'], {
        masterInventoryById:new Map([['first',first], ['second',second]]), masterInventoryByItemCode:new Map([['ITEM',[first,second]]]),
        isCurrentDrivePhotoAttachment:() => true, isDockSuspendDcRequestMirrorRow:() => false
    });
    const prepare = item => exact.prepareQueuedRowPhoto({prefix:'req-', item, uploadController:new AbortController()});
    assert.equal(await prepare({...tuple, UNIQUE_ID:'request', MASTER_ID:'second'}), second);
    assert.equal(await prepare({...tuple, UNIQUE_ID:'request', MASTER_ID:'missing'}), null);
    assert.equal(await prepare({...tuple, UNIQUE_ID:'request'}), null, 'two physical UIDs sharing the tuple remain ambiguous');
});

test('a stalled native credential refresh stops at 500ms without dispatching a photo', async () => {
    const timers = [];
    let headerReads = 0, binaries = 0;
    const c = context(['assertOperationalRequestCurrent', 'waitForOperationalPrerequisite', 'assertCurrentPhotoUpload',
        'uploadDrivePhotoWithNativeSession'], {
        setTimeout:(callback, ms) => { timers.push({callback, ms}); return timers.length; }, clearTimeout() {},
        nativeAuthRecoveryEpoch:0, getSupabaseReadIdentityScope:() => 'account',
        SECURE_DRIVE_EVIDENCE_PREFIXES:new Set(['lsn-']),
        getNativeAuthRequestHeaders:async refresh => { headerReads++; return refresh ? new Promise(() => {}) : null; },
        getNativeDrivePhotoObject:async () => { binaries++; throw new Error('No object dispatch without credentials'); }
    });
    const upload = c.uploadDrivePhotoWithNativeSession(new Map([['prefix','lsn-'], ['masterUid','exact']]));
    while (headerReads < 2) await new Promise(resolve => setImmediate(resolve));
    timers.at(-1).callback();
    await assert.rejects(upload, error => error.code === 'TRANSPORT_TIMEOUT');
    assert.ok(timers.every(timer => timer.ms === 500));
    assert.equal(binaries, 0);
});

test('Storage success flips the slot before canonical publication settles, retaining the same local preview', async () => {
    const item = {UNIQUE_ID:'request-1'}, file = jpeg(), preview = {id:'photo-1', url:'blob:original', status:'Uploading'};
    const job = {id:'photo-1', preview, item, identity:{UNIQUE_ID:'request-1'}, prefix:'req-', scope:'account', file, fileName:'photo.jpg'};
    const jobs = new Map([[job.id, job]]), options = [];
    const c = context(['uploadRowPhotoAttachment', 'acceptQueuedRowPhotoUpload', 'setDrivePhotoAttachmentStatus', 'getRowPhotoUploadIdentity','capturedPhotoSourceFields',
        'getScopedDetailRowPhotoJobs', 'getDetailRowPhotoUploadPromises', 'hasUnsettledDetailRowPhotos'], {
        drivePhotoAttachments:jobs, getSupabaseReadIdentityScope:() => 'account',
        isCurrentDrivePhotoAttachment:target => jobs.get(target.id) === target,
        getPendingPhotoPreviewEntries:() => [preview], refreshPendingPhotoUiForItem() {},
        SECURE_DRIVE_EVIDENCE_PREFIXES:new Set(['lsn-']),
        isDockSuspendDcRequestMirrorRow:() => false,
        prepareQueuedRowPhoto:async () => ({UNIQUE_ID:'master-1'}), getQueuedRowPhotoHeaders:async () => ({Authorization:'Bearer verified'}),
        normalizeStoragePublicUrl:url => url,
        uploadPhotoViaAppApi:async (_prefix, blob, _name, _type, value) => {
            assert.equal(blob, file); options.push(value);
            return {publicUrl:'https://photos.invalid/photo.jpg', filePath:'exact/photo.jpg'};
        }
    });
    job.promise = new Promise(() => {});
    await c.uploadRowPhotoAttachment(job);
    assert.equal(preview.status, 'Uploaded');
    assert.equal(preview.url, 'blob:original');
    assert.equal(preview.storageUrl, 'https://photos.invalid/photo.jpg');
    assert.equal(options[0].timeoutMs, 4000);
    assert.equal(options[0].formFields.requestId,'request-1');
    assert.equal(c.getDetailRowPhotoUploadPromises(item, 'req-')[0], job.promise);
    assert.equal(c.hasUnsettledDetailRowPhotos(item, 'req-'), true, 'binary confirmation alone cannot release MARK DONE');
    jobs.delete(job.id);
    assert.equal(c.hasUnsettledDetailRowPhotos(item, 'req-'), false, 'matching canonical publication releases the completion fence');
});

test('a failed photo keeps its Blob and one-tap retry job while another account cannot access it', async () => {
    const file = jpeg(), item = {UNIQUE_ID:'request-1'}, preview = {id:'photo-1', url:'blob:original', status:'Uploading'};
    const job = {id:'photo-1', preview, item, identity:{UNIQUE_ID:'request-1'}, prefix:'req-', scope:'account', file};
    const jobs = new Map([[job.id, job]]), sent = [];
    let owner = 'account', fail = true;
    const c = context(['retryDrivePhotoAttachment', 'setDrivePhotoAttachmentStatus', 'getScopedDetailRowPhotoJobs',
        'getDetailRowPhotoUploadPromises', 'hasUnsettledDetailRowPhotos'], {
        drivePhotoAttachments:jobs, getSupabaseReadIdentityScope:() => owner,
        isCurrentDrivePhotoAttachment:target => target.scope === owner && jobs.get(target.id) === target,
        getPendingPhotoPreviewEntries:() => owner === 'account' ? [preview] : [], refreshPendingPhotoUiForItem() {},
        SECURE_DRIVE_EVIDENCE_PREFIXES:new Set(), registerPendingPhotoUpload() {}, showToast() {},
        formatPhotoUploadErrorMessage:error => error.message,
        runRowPhotoAttachmentWithRetry:async target => { sent.push(target.file); if (fail) throw new Error('Mobile connection failed'); }
    });
    c.retryDrivePhotoAttachment(job.id);
    await job.promise.catch(() => {});
    await Promise.resolve();
    assert.equal(preview.status, 'Save failed');
    assert.equal(job.file, file);
    assert.equal(jobs.get(job.id), job);
    assert.equal(c.hasUnsettledDetailRowPhotos(item, 'req-'), true);
    fail = false;
    c.retryDrivePhotoAttachment(job.id);
    await job.promise;
    assert.deepEqual(sent, [file, file]);
    owner = 'other-account';
    c.retryDrivePhotoAttachment(job.id);
    assert.equal(sent.length, 2);
    assert.equal(c.hasUnsettledDetailRowPhotos(item, 'req-'), false);
});

test('a transient fast native Storage attempt cannot divert into Edge or a long RPC recovery loop', async () => {
    const names = ['assertOperationalRequestCurrent', 'waitForOperationalPrerequisite', 'getDrivePhotoGatewayState', 'rememberDrivePhotoGatewayFailure', 'assertCurrentPhotoUpload',
        'getNativeDrivePhotoObject', 'isTransientPhotoUploadFailure', 'uploadNativeDrivePhotoPart', 'uploadDrivePhotoWithNativeSession'];
    const file = jpeg(), calls = [];
    const c = context(names, {
        nativeAuthRecoveryEpoch:0, SECURE_DRIVE_EVIDENCE_PREFIXES:new Set(['lsn-']), PHOTO_BUCKETS:{'lsn-':'location_sales_notes_photos'},
        getSupabaseReadIdentityScope:() => 'account', getNativeAuthRequestHeaders:async () => ({Authorization:'Bearer verified'}),
        SUPABASE_URL:'https://kzrnyjsosryejjejliii.supabase.co', APP_API_FUNCTION_URL:'https://unused',
        fetchWithTimeout:async url => { calls.push(url); throw new Error('Connection timed out'); }
    });
    await assert.rejects(c.uploadDrivePhotoWithNativeSession(new Map([['prefix','lsn-'], ['masterUid','exact'],
        ['file',file], ['thumbnail144',file], ['thumbnail320',file]]), {singleUploadAttempt:true}), /timed out/);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(url => url.includes('/storage/v1/object/')));
    assert.equal(c.uploadDrivePhotoWithNativeSession.state.storageGatewayCooldownUntil, 0,
        'one mobile dropout cannot disable direct Storage for the next retry');
});

test('main Storage confirmation updates its badge while thumbnail requests remain pending', async () => {
    const names = ['assertOperationalRequestCurrent', 'waitForOperationalPrerequisite', 'getDrivePhotoGatewayState',
        'rememberDrivePhotoGatewayFailure', 'assertCurrentPhotoUpload', 'getNativeDrivePhotoObject', 'uploadDrivePhotoWithNativeSession'];
    const file = jpeg(), thumbnails = [], confirmations = [];
    const c = context(names, {
        nativeAuthRecoveryEpoch:0, SECURE_DRIVE_EVIDENCE_PREFIXES:new Set(['lsn-']), PHOTO_BUCKETS:{'lsn-':'location_sales_notes_photos'},
        getSupabaseReadIdentityScope:() => 'account', getNativeAuthRequestHeaders:async () => ({Authorization:'Bearer verified'}),
        SUPABASE_URL:'https://kzrnyjsosryejjejliii.supabase.co',
        uploadNativeDrivePhotoPart:async path => {
            if (path.includes('/_thumbs/')) await new Promise(resolve => thumbnails.push(resolve));
        }
    });
    const upload = c.uploadDrivePhotoWithNativeSession(new Map([['prefix','lsn-'], ['masterUid','exact'],
        ['file',file], ['thumbnail144',file], ['thumbnail320',file]]), {onStorageUploaded:value => confirmations.push(value)});
    while (thumbnails.length < 2 || confirmations.length < 1) await new Promise(resolve => setImmediate(resolve));
    assert.equal(confirmations[0].ok, true);
    assert.match(confirmations[0].publicUrl, /\/storage\/v1\/object\/public\//);
    let settled = false;
    upload.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, true, 'confirmed primary returns without waiting for auxiliary thumbnails');
    let thumbnailsSettled = false;
    const result = await upload;
    result.thumbnailUploads.then(() => { thumbnailsSettled = true; });
    await Promise.resolve();
    assert.equal(thumbnailsSettled, false, 'auxiliary thumbnail activity remains independently tracked');
    thumbnails.forEach(resolve => resolve());
    await result.thumbnailUploads;
});

test('a Storage denial may use only the existing same-session recovery RPC and still needs positive durable confirmation', async () => {
    const names = ['assertOperationalRequestCurrent', 'waitForOperationalPrerequisite', 'getDrivePhotoGatewayState',
        'rememberDrivePhotoGatewayFailure', 'assertCurrentPhotoUpload', 'getNativeDrivePhotoObject',
        'isTransientPhotoUploadFailure', 'uploadNativeDrivePhotoPart', 'readNativeDrivePhotoContent', 'uploadDrivePhotoWithNativeSession'];
    const file = jpeg(), calls = [], badges = [];
    let denied = false;
    class Reader {
        readAsDataURL() { this.result = 'data:image/jpeg;base64,/9j/AQ=='; queueMicrotask(() => this.onload()); }
    }
    const c = context(names, {
        FileReader:Reader, nativeAuthRecoveryEpoch:0, SECURE_DRIVE_EVIDENCE_PREFIXES:new Set(['lsn-']),
        PHOTO_BUCKETS:{'lsn-':'location_sales_notes_photos'}, getSupabaseReadIdentityScope:() => 'account',
        getNativeAuthRequestHeaders:async () => ({Authorization:'Bearer verified'}),
        SUPABASE_URL:'https://kzrnyjsosryejjejliii.supabase.co', APP_API_FUNCTION_URL:'https://example.invalid/functions/v1/app-api',
        fetchWithTimeout:async (url, init, timeout, _label, consume) => {
            calls.push({url, init, timeout});
            if (url.includes('/storage/')) return {ok:false, status:403};
            return consume({ok:!denied, status:denied ? 403 : 200,
                json:async () => denied ? {message:'row permission denied'} : {id:'a'.repeat(64)}});
        }
    });
    const form = new Map([['prefix','lsn-'], ['masterUid','exact'], ['file',file]]);
    const saved = await c.uploadDrivePhotoWithNativeSession(form, {singleUploadAttempt:true, onStorageUploaded:value => badges.push(value)});
    assert.equal(saved.storage, 'postgres');
    assert.equal(badges.length, 0, 'a denied Storage object never confirms the binary badge');
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /\/rest\/v1\/rpc\/store_drive_photo_blob_v1$/);
    assert.equal(calls[1].timeout, 4000);
    assert.ok(calls.every(call => call.init.headers.Authorization === 'Bearer verified'));
    denied = true;
    await assert.rejects(c.uploadDrivePhotoWithNativeSession(form, {singleUploadAttempt:true}), /row permission denied/);
});

test('canonical photo persistence settles before MARK DONE finishes without a circular wait', async () => {
    const row = {UNIQUE_ID:'physical-1'}, jobs = new Map(), textWrites = [];
    const job = {id:'photo-1', prefix:'lsn-', scope:'account', item:row, identity:{UNIQUE_ID:'physical-1'}};
    jobs.set(job.id, job);
    let publishPhoto, finishAction;
    const action = {finished:new Promise(resolve => { finishAction = resolve; })};
    const c = context(['retryPhotoOperation', 'persistQueuedRowPhoto', 'getScopedDetailRowPhotoJobs',
        'getDetailRowPhotoUploadPromises', 'hasUnsettledDetailRowPhotos', 'settleDetailEvaluationPhotos'], {
        drivePhotoAttachments:jobs, ROW_PHOTO_SAVE_RETRY_DELAYS:[], isRetryablePhotoSave:() => false,
        isCurrentDrivePhotoAttachment:target => jobs.get(target.id) === target, getSupabaseReadIdentityScope:() => 'account',
        getPendingPhotoUploadsForItem:() => [], getPendingPhotoPreviewEntries:() => [],
        SECURE_DRIVE_EVIDENCE_PREFIXES:new Set(['lsn-']), getRowSaveCoordinatorKey:() => 'physical-1',
        window:{__agdataMarkDoneActions:new Map([['account|physical-1',action]])},
        persistDrivePhotoAttachment:async () => new Promise(resolve => {
            publishPhoto = () => { jobs.delete(job.id); resolve({saved:true}); };
        }),
        persistConfirmedRowEvaluation:async complete => { textWrites.push(complete); }, showToast() {},
        mergeConfirmedRowEvaluationUploads:snapshot => { snapshot.photosMerged = true; }
    });
    job.promise = c.persistQueuedRowPhoto(job);
    const snapshot = {scope:'account', prefix:'lsn-', source:row, row, uploads:[job.promise]};
    const completion = c.settleDetailEvaluationPhotos(snapshot);
    await Promise.resolve();
    assert.equal(typeof publishPhoto, 'function', 'photo publication must start while the completion token is held');
    assert.deepEqual(textWrites, [false], 'typed fields persist independently while completion waits');
    publishPhoto();
    assert.equal((await completion).photosMerged, true);
    finishAction();
});
