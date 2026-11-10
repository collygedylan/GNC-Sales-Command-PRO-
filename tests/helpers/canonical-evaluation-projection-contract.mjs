import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { functionSource } from './completed-row-contract.mjs';

const urls = value => Array.isArray(value) ? value.map(entry => entry.url || entry) : String(value || '').split(',').filter(Boolean);
const patch = {spec:'16-18" H',av_note:'SPEC - 16-18" H',match:40,photo_link:'https://fixture/figgy.jpg'};

function createProjectionFixture() {
    const master = {UNIQUE_ID:'figgy',ITEMCODE:'009999.001.1',LOCATIONCODE:'L.05.000',LOTCODE:'27.F1',PTRONHAND:210,PTRAVAILABLE:17,SPEC:'Prior'};
    const sibling = {...master,UNIQUE_ID:'old-year',LOTCODE:'26.F1',SPEC:'Old year'};
    const request = {...master,UNIQUE_ID:'request',MASTER_ID:'figgy',SOURCE_TABLE:'ph_requests_pending',LOTCODE:'F1',ORDER_QTY:999};
    const wrongRequest = {...request,UNIQUE_ID:'wrong-request',SALEYEAR:'26'};
    const suspend = {...request,UNIQUE_ID:'tag',SALEYEAR:'2027'};
    const flyer = {...request,UNIQUE_ID:'flyer',SALEYEAR:'27'};
    const state = {}, read = name => readFileSync(new URL(`../../assets/${name}.js`,import.meta.url),'utf8');
    const context = vm.createContext({scope:'actor',masterInventoryById:new Map(),masterInventoryByItemCode:new Map(),
        fullInventory:[master,sibling],requestsInventory:[request,wrongRequest],suspendTagInventory:[suspend],flyerFolderInventory:[flyer],
        getManagerAssignedColumnState:()=>state,getSupabaseReadIdentityScope:()=>context.scope,
        firstNonEmptyValue:(...values)=>values.find(value=>value!=null && value!==''),parseAppNumber:value=>value==='' ? null : Number(value),
        getRequestItemCodeOptionItemCode:row=>row.ITEMCODE,mergePhotoCsvList:parts=>[...new Set(parts.flatMap(urls))].join(','),
        getPhotoUrlList:urls,getPhotoEntryDateMs:()=>Date.now(),getPhotoRetentionFallbackDateMs:()=>Date.now(),
        invalidateResolvedViewStateCaches(){},markViewDirty(){},staleSupabaseReadScopeError:()=>Error('STALE_SCOPE'),
        findLinkedMasterRow:row=>context.masterInventoryById.get(row.MASTER_ID || row.UNIQUE_ID),
        rebuildMasterInventoryIndexes(){
            context.masterInventoryById=new Map(context.fullInventory.map(row=>[row.UNIQUE_ID,row]));
            context.masterInventoryByItemCode=new Map([[master.ITEMCODE,context.fullInventory]]);
        }
    });
    context.rebuildMasterInventoryIndexes();
    for (const file of ['canonical-inventory-evidence','row-publication-branches']) vm.runInContext(read(file),context);
    const functions = ['getEditorLocMatchQtyValue','publishRowEvaluationToMasterAndNotes','resolveCanonicalInventoryRow'];
    vm.runInContext(functions.map(functionSource).join('\n'),context);
    return {context,state,master,sibling,request,wrongRequest,suspend,flyer};
}

function assertCrossViewProjection(fixture) {
    const {context,state,master,sibling,request,wrongRequest,suspend,flyer} = fixture;
    const rollback = context.beginRowEvaluationMemoryPublication(master,patch,'actor');
    assert.equal(master.LOC_PHOTO_MATCH,84);
    assert.equal(state.locationSalesNotes.get(master.ITEMCODE)[0].SPEC,patch.spec);
    assert.equal(request.REQ_SPEC,patch.spec);
    assert.equal(request.REQ_LOC_MATCH_QTY,84);
    assert.equal(suspend.DOCK_SPEC,patch.spec);
    assert.equal(flyer.FLYER_AV_NOTE,patch.av_note);
    assert.equal(wrongRequest.REQ_SPEC,undefined);
    assert.equal(context.resolveCanonicalInventoryRow(sibling).PHOTO_LINK,undefined);
    assert.equal(context.resolveCanonicalInventoryRow({...request,PTRONHAND:999}).LOC_PHOTO_MATCH,84);
    rollback();
    assert.equal(master.SPEC,'Prior');
    assert.equal(request.REQ_SPEC,undefined);
    assert.equal(state.locationSalesNotes.get(master.ITEMCODE).length,0);
}

function assertProjectionOwnership(fixture) {
    const {context,master,request} = fixture;
    const first = context.beginRowEvaluationMemoryPublication(master,{spec:'First'},'actor');
    const second = context.beginRowEvaluationMemoryPublication(master,{spec:'Second'},'actor');
    first();
    assert.equal(master.SPEC,'Second');
    second();
    assert.equal(master.SPEC,'Prior');
    const inserted = {...master,UNIQUE_ID:'missing',unique_id:'missing'};
    const remove = context.beginRowEvaluationMemoryPublication(inserted,patch,'actor');
    assert.equal(context.masterInventoryById.get('missing').LOC_PHOTO_MATCH,84);
    assert.equal(request.REQ_SPEC,undefined,'explicit link to another UID cannot match a missing master row');
    remove();
    assert.equal(context.masterInventoryById.has('missing'),false);
    const switched = context.beginRowEvaluationMemoryPublication(master,{spec:'First'},'actor');
    context.scope='other';
    switched();
    assert.equal(master.SPEC,'First','a stale operation cannot mutate a later account');
}

async function assertPreProjectionBaseline(fixture) {
    const {context,master,request} = fixture;
    let release;
    context.buildSecureDriveEvidenceBaseline = row => ({spec:row.SPEC});
    context.saveSecureDriveEvidence = (target,_prefix,input,_complete,baseline) => {
        assert.equal(target.SPEC,input.spec);
        assert.equal(baseline.spec,'Prior');
        return new Promise(resolve => { release=resolve; });
    };
    context.reconcileConfirmedDriveEvidence = result => ({row:result.row,applied:true});
    const pending = context.publishRowEvaluationToMasterAndNotes(master,patch,{prefix:'lsn-',complete:false});
    assert.equal(request.REQ_SPEC,patch.spec,'all exact mirrors update before the persistence promise resolves');
    release({canonicalConfirmed:true,row:{unique_id:'figgy'}});
    assert.equal((await pending).applied.applied,true);
}

function assertOlderReceiptBroadcast(fixture) {
    const {context,master} = fixture;
    const broadcasts = [];
    Object.assign(context,{
        activeItem:null,confirmedDriveEvidenceRows:new Map(),
        window:{GncDatabase:{confirmedDriveEvidence:result=>result.row,driveEvidenceColumns:['spec']}},
        isSameDriveEvidenceLocation:(row,target)=>context.canonicalInventoryRowUid(row)===context.canonicalInventoryRowUid(target)
            && context.canonicalInventorySameLot(row,target,true),
        formatFetchedRows:rows=>rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key.toUpperCase(),value]))),
        buildConfirmedDriveEvidenceState:row=>({...row}),getDatasetKeysForTable:()=>[],touchDatasetLoadStateForLocalChange(){},
        setPhotoAliasFieldsForPrefix(){},normalizeRowPhotoFields(){},buildSearchIndex(){},
        propagateCommittedEdit:(_table,row)=>broadcasts.push(row.SPEC)
    });
    const rollback = context.beginRowEvaluationMemoryPublication(master,{spec:'Newer pending'},'actor');
    const row = {unique_id:master.UNIQUE_ID,itemcode:master.ITEMCODE,locationcode:master.LOCATIONCODE,lotcode:master.LOTCODE,spec:'Older confirmed'};
    context.reconcileConfirmedDriveEvidence({row},master,'lsn-');
    assert.deepEqual(broadcasts,['Older confirmed']);
    assert.equal(master.SPEC,'Newer pending');
    rollback();
    assert.equal(master.SPEC,'Older confirmed');
}

export async function assertCanonicalEvaluationProjection() {
    assertCrossViewProjection(createProjectionFixture());
    assertProjectionOwnership(createProjectionFixture());
    assertOlderReceiptBroadcast(createProjectionFixture());
    assertCanonicalInputAliases(createProjectionFixture());
    await assertPreProjectionBaseline(createProjectionFixture());
}

function assertCanonicalInputAliases({context,master,sibling,request}) {
    const photo = {url:'https://fixture/metadata.jpg',date:'2026-11-09'};
    const rollback = context.beginRowEvaluationMemoryPublication(master,{match_pct:40,photos:[photo],photo_date:photo.date},'actor');
    assert.equal(request.MATCH_PCT,40);
    assert.equal(request.LOC_PHOTO_MATCH,84);
    assert.equal(request.PHOTO_LINK,photo.url);
    assert.equal(request.photos[0].date,photo.date);
    rollback();
    const yearless = {...request,MASTER_ID:'',UNIQUE_ID:'unlinked'};
    const byId = new Map();
    assert.equal(context.resolveCanonicalInventoryTarget(yearless,byId,new Map([[master.ITEMCODE,[master]]])),master);
    assert.equal(context.resolveCanonicalInventoryTarget(yearless,byId,new Map([[master.ITEMCODE,[master,sibling]]])),null);
    assert.equal(context.resolveCanonicalInventoryTarget({...yearless,LOTCODE:'26.F1'},byId,new Map([[master.ITEMCODE,[master]]])),null);
}
