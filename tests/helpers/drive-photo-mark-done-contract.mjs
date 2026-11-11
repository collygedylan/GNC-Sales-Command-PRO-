import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { functionSource } from './completed-row-contract.mjs';

const spec = '32-36" H';
const note = 'SPEC - ' + spec;

function createEvaluationFixture(status) {
    const row = {UNIQUE_ID:'drive-row',ITEMCODE:'000154.020.1',LOCATIONCODE:'L.05.000',LOTCODE:'28.F1',PTRONHAND:435,PTRAVAILABLE:415};
    const sibling = {...row,UNIQUE_ID:'sibling',LOTCODE:'27.F1'};
    const owner = {}, projected = new Map([[row.UNIQUE_ID,row],[sibling.UNIQUE_ID,sibling]]);
    const previews = ['blob:photo-1','blob:photo-2'].map(url => ({url,status}));
    const calls = [], errors = [], context = vm.createContext({
        window:{}, activeItem:row, masterInventoryById:projected, fullInventory:[row,sibling],
        masterInventoryByItemCode:new Map([[row.ITEMCODE,[row,sibling]]]),
        getSupabaseReadIdentityScope:() => 'dylan_collyge', getManagerAssignedColumnState:() => owner,
        isSameDriveEvidenceLocation:(candidate,target) => candidate.LOTCODE === target.LOTCODE,
        findLinkedMasterRow:item => projected.get(item.UNIQUE_ID),
        getRequestItemCodeOptionItemCode:item => item.ITEMCODE, mergePhotoCsvList:parts => parts.filter(Boolean).join(','),
        firstNonEmptyValue:(...values) => values.find(value => value != null && value !== ''),
        parseAppNumber:value => value === '' ? null : Number(value), getCardPtrAvailableValue:item => item.PTRAVAILABLE,
        getPhotoUrlList:value => Array.isArray(value) ? value.map(entry => entry.url || entry) : value ? value.split(',') : [],
        getRowPhotoLink:() => '', resolveAndFormatPhotoDate:() => '',
        getLocPhotoEvidenceState:() => ({qualified:false}), getPhotoQualifiedLocMatchQtyValue:() => null,
        shouldPreferFlyerOwnedFields:() => false, getPendingPhotoPreviewEntries:item => item.UNIQUE_ID === row.UNIQUE_ID ? previews : [],
        invalidateResolvedViewStateCaches() {}, markViewDirty() {}, clearDetailMeasurementKeyboardKeepAlive() {}, closeDetailMeasurementKeyboard() {},
        document:{querySelectorAll:() => [],getElementById:() => null}, PROTECTED_EDIT_CONFIG:{}, protectedEditState:{}, applyProtectedEditState() {},
        returnFromConfirmedEvaluationDetail:() => { context.activeItem = null; },
        showToast:(_title,message,error) => { if (error) errors.push(message); }, backupLocalItem() {}, escapeHtml:value => value,
        pendingPhotoUploads:new Map(), createPendingPhotoToken:() => 'scoped-token', getPendingPhotoUploadKey:item => item.UNIQUE_ID + '::saved',
        canEditRowDetails:() => true, isProtectedSectionCompleted:() => false, getRowSaveCoordinatorKey:() => 'drive::drive-row',
        isAvDetailReadOnlyContext:() => false, uploadJobs:[],
        getDetailRowPhotoUploadPromises:() => context.uploadJobs,
        hasUnsettledDetailRowPhotos:() => previews.some(preview => preview.status !== 'Uploaded'),
        getRowSaveCoordinatorState:() => ({}), ROW_SAVE_COMPLETE_INTENT_MS:1000,
        captureConfirmedRowEvaluation:() => ({source:row,row:{...row,SPEC:spec,MATCH:80,AV_NOTE:note},prefix:'lsn-',
            scope:'dylan_collyge',payload:{spec,match:80,av_note:note},uploads:context.getPendingPhotoUploadsForItem(row,'lsn-'),uploadRows:[row]}),
        prepareMarkDoneCompletionPrompt:() => ({}), openMarkDoneConfirmModal:async () => true,
        persistConfirmedRowEvaluation:(complete,_prefix,_silent,item,options) => {
            assert.equal(options.markDoneSnapshot.uploads.length,0);
            calls.push({complete,item});
            if (!complete) {
                context.beginRowEvaluationMemoryPublication(row,options.markDoneSnapshot.payload,'dylan_collyge').commit();
                return Promise.resolve(true);
            }
            return new Promise(resolve => {
                context.confirmEvaluation = () => { options.optimisticCompletion.commit(); resolve(true); };
            });
        }
    });
    const names = ['registerPendingPhotoUpload','getPendingPhotoUploadsForItem','mergeConfirmedRowEvaluationUploads',
        'beginOptimisticCompletedRow','restoreOptimisticCompletedFields','getEditorLocMatchQtyValue',
        'getCompletedRowUnlockKey','resolveCanonicalPhotoUrls','getDisplayLocMatchQtyValue','hasDriveCardEvaluation','buildCompletedRowBadge'];
    vm.runInContext(names.map(functionSource).join('\n'),context);
    for (const file of ['canonical-inventory-evidence','row-publication-branches','confirmed-evaluation-ui']) {
        const source = readFileSync(new URL(`../../src/engine/${file}.js`,import.meta.url),'utf8')
            .replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
        vm.runInContext(source,context);
    }
    return {context,row,sibling,owner,calls,errors,previews};
}

export async function assertDetachedDriveEvaluation() {
    for (const status of ['Uploading','Save failed']) {
        const {context,row,sibling,owner,calls,errors,previews} = createEvaluationFixture(status);
        let finishFirst, finishSecond;
        const first = new Promise(resolve => { finishFirst = resolve; });
        const second = new Promise(resolve => { finishSecond = resolve; });
        if (status === 'Uploading') {
            context.uploadJobs = [first,second];
            context.registerPendingPhotoUpload(row,'lsn-',first,true);
            context.registerPendingPhotoUpload(row,'lsn-',second,true);
        }
        const result = context.saveData(true,'lsn-');
        await new Promise(setImmediate);
        assert.equal(calls.length,1,'first confirmed tap sends text before either photo settles: '+errors.join(', '));
        assert.equal(calls[0].complete,false);
        assert.equal(context.activeItem,row,'the editor stays on the exact row until every selected photo settles');
        assert.equal(context.pendingPhotoUploads.size,status === 'Uploading' ? 2 : 0);
        assert.equal(row.SPEC,spec);
        assert.equal(row.AV_NOTE,note);
        assert.equal(row.LOC_PHOTO_MATCH,348);
        assert.match(context.buildCompletedRowBadge(row),/ hidden>/);
        assert.match(context.buildCompletedRowBadge(sibling),/ hidden>/);
        assert.deepEqual(Array.from(context.resolveCanonicalPhotoUrls(row,'drive')),['blob:photo-1','blob:photo-2']);
        assert.equal(owner.locationSalesNotes.get(row.ITEMCODE)[0].LOTCODE,'28.F1');
        assert.equal(sibling.SPEC,undefined);
        assert.equal(sibling.AV_NOTE,undefined);
        if (status === 'Save failed') {
            assert.equal(await result,false);
            assert.equal(context.activeItem,row);
            assert.equal(calls.length,1);
            continue;
        }
        previews.forEach(preview => { preview.status = 'Uploaded'; });
        finishFirst();
        finishSecond();
        await Promise.all([first,second]);
        await new Promise(setImmediate);
        assert.equal(calls.length,2,errors.join(', '));
        assert.equal(calls[1].complete,true);
        assert.equal(context.activeItem,null);
        assert.equal(context.getDisplayLocMatchQtyValue(row,'drive'),'348');
        assert.match(context.buildCompletedRowBadge(row),/>✅ COMPLETED/);
        context.confirmEvaluation();
        assert.equal(await result,true);
        assert.equal(context.pendingPhotoUploads.size,0);
    }
}
