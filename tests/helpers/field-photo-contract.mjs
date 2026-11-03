import assert from 'node:assert/strict';
import vm from 'node:vm';
import { functionSource } from './completed-row-contract.mjs';

export function fieldPhotoContract() {
    const context = vm.createContext({ URL, normalizeStoragePublicUrl: url => url });
    vm.runInContext(['rowPhotoIdentity', 'mergeRowPhotoSlots'].map(functionSource).join('\n'), context);
    for (const queue of ['drive', 'suspend', 'request']) {
        const slots = [1, 2, 3].map(id => ({ id: String(id), url: 'blob:' + queue + id, status: 'Uploading' }));
        const saved = 'https://example.test/storage/v1/object/public/photos/one.jpg';
        slots[0].publicUrl = saved;
        slots[0].status = 'Uploaded';
        for (const snapshot of [[], [{ url: saved, persistedIndex: 0 }], [{ url: saved + '?t=3', persistedIndex: 0 }]]) {
            const shown = context.mergeRowPhotoSlots(slots, snapshot);
            assert.deepEqual(Array.from(shown, x => x.previewUrl), slots.map(x => x.url));
            assert.equal(shown[0].pending, false);
            assert.equal(shown[1].pending, true);
        }
    }
    const registry = new Map();
    const tickets = vm.createContext({ pendingPhotoUploads:registry, getPendingPhotoUploadKey:(item,prefix)=>item.UNIQUE_ID+':'+prefix,
        createPendingPhotoToken:(()=>{let n=0;return ()=>String(++n);})() });
    vm.runInContext(['registerPendingPhotoUpload','getPendingPhotoUploadsForItem'].map(functionSource).join('\n'),tickets);
    for (const prefix of ['lsn-','req-']) {
        const item = {UNIQUE_ID:'physical-row'};
        for (let id=1;id<=3;id++) tickets.registerPendingPhotoUpload(item,prefix,Promise.resolve(id));
        assert.equal(tickets.getPendingPhotoUploadsForItem(item,prefix).length,3);
        assert.equal(tickets.getPendingPhotoUploadsForItem({UNIQUE_ID:'other'},prefix).length,0);
    }
    const save = functionSource('saveData');
    assert.ok(save.indexOf('await Promise.allSettled(pendingScopedUploads)') < save.indexOf("showToast('Photo Required'"));
    assert.doesNotMatch(save.slice(0, save.indexOf("showToast('Photo Required'")), /itemToSave\.REQ_STATUS\s*=\s*'Complete'/);
    const filter = vm.runInNewContext('(' + functionSource('filterAvNotes') + ')', {});
    assert.doesNotThrow(() => filter('req-'));
    const complete = vm.runInNewContext('(' + functionSource('isProtectedSectionCompleted') + ')', {
        isRowPhotoEvaluationExpired: () => false, isDockSuspendDcRequestMirrorRow: () => false,
        isRequestComplete: () => true, firstNonEmptyValue: (...args) => args.find(Boolean),
    });
    assert.equal(complete('req-', {REQ_STATUS:'Pending', DATE_COMPLETED:'2026-11-03'}), false);
}
