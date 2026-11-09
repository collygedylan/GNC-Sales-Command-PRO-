import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseExpressionAt, parse} from 'acorn';
import {analyze} from 'eslint-scope';
import {createHash} from 'node:crypto';

const read = file => readFileSync(new URL('../../'+file,import.meta.url),'utf8');
export const cardOwners = ['inventory-card-context','av-inventory-card','request-inventory-card','workflow-inventory-card'];

function declaration(source, name) {
    let at = source.indexOf('function '+name+'(');
    assert.ok(at >= 0, name);
    if (source.slice(at-6,at) === 'async ') at -= 6;
    const node = parseExpressionAt(source,at,{ecmaVersion:'latest'});
    return source.slice(at,node.end);
}

export function cardExtractionFixture(source = read('assets/app-runtime.js'), options = {}) {
    const ownerSource = cardOwners.map(name => read('assets/'+name+'.js')).join('\n');
    const code = ownerSource+'\n'+declaration(source,'generateCard');
    const ast = parse(code,{ecmaVersion:'latest',sourceType:'script',ranges:true});
    const globals = analyze(ast,{ecmaVersion:2022,sourceType:'script',optimistic:true}).globalScope.through;
    const context = {};
    for (const {identifier} of globals) if (!(identifier.name in globalThis)) context[identifier.name] = () => '';
    const calls = [], photo = options.photo ? 'https://fixture.example/one.jpg' : '';
    const master = {UNIQUE_ID:'master-one',DOM_ID:'card-one',ITEMCODE:'sku-one',COMMONNAME:'Tree & shrub',CONTSIZE:'#3',
        LOCATIONCODE:'A.01.000',LOTCODE:'27.F1',SEASON:'F1',PTRONHAND:7,PTRAVAILABLE:0,SPEC:'Exact spec',AV_NOTE:'Published note',
        CALIPER:'1.5',PIC_NOTE:'Pick carefully',PHOTO_LINK:photo,PHOTO_DATE:photo?'11/8/2026':'',HOLDSTOPCODE:'H',HOLDSTOPREASON:'Cold hold'};
    const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    Object.assign(context, {
        window:{__agdataAvKioskState:{active:options.kiosk === true}}, selectedItems:new Set(['card-one']),
        inventoryStatusRenderedCards:new Map(), activeReqTab:options.suspend?'suspend-tag':'pending',
        firstNonEmptyValue:(...values)=>values.find(value=>value!=null&&String(value).trim()!=='') ?? '',
        esc:escape, escapeHtml:escape, escJsAttrValue:escape, escapeQueueNoteText:escape,
        normalizeEscapedDisplayText:value=>value, normalizeRequestCardCustomer:value=>value,
        normalizeRowPhotoFields:()=>{}, getInventoryStatusSync:()=>null,
        resolveCanonicalInventoryRow:row=>{calls.push(['canonical',row.UNIQUE_ID]);return {...master};},
        getDockCardLiveInventoryDisplayRow:row=>({...master,...row,PTRONHAND:7,PTRAVAILABLE:0}),
        buildDockSuspendDcRequestCardDisplayItem:row=>row,
        resolveCanonicalPhotoUrls:row=>row.PHOTO_LINK?row.PHOTO_LINK.split(','):[],
        resolveAndFormatPhotoDate:row=>row.PHOTO_DATE || '',
        getItemDisplayValue:(row,key)=>row[key] ?? '', getLiveDriveNoteRow:row=>row,
        getCorrectedPickNoteValue:(_row,value)=>value, getDirectImageUrl:value=>value,
        buildDeferredCardPhotoImg:(url,settings)=>'<img src="'+url+'" loading="'+(settings.loading || 'lazy')+'">',
        buildInventoryQuantityChipsHtml:row=>'<span data-quantity="'+row.PTRONHAND+'">Available '+row.PTRAVAILABLE+'</span>',
        buildInventoryCardFieldChipsHtml:()=>'<span>Physical fields</span>',
        buildCardActivationAttrs:(domId,uid,view)=>'data-open="'+domId+'|'+uid+'|'+view+'"',
        getRoleAccessState:()=>({isSalesRep:false,isAdmin:false}), getDockItemProgress:()=>({}),
        getQueueDisplayEvidenceRow:()=>master, getOperationalCardInventoryRow:()=>master,
        resolveRequestCardQuantity:row=>row.REQ_QTY || 2, getRequestAssignedRep:()=>'A rep',
        isDockSuspendDcRequestMirrorRow:()=>options.suspend === true,
        getDockSuspendDcRequestPlanstartInfo:()=>({className:'monday',legacyClassName:'',value:'11/9/2026',tone:'purple',valid:true}),
        getSalesOfficeDisplayAvNote:row=>row.AV_NOTE, stripWorkflowApprovalLinesFromSalesNote:value=>value,
        getDockOrderedQtyRaw:()=>2, getDockOrderedQtyDisplay:()=>'2', getDockDisplayQty:()=>2,
        formatDockDisplayQty:String, getDockStopOrDropValue:()=>3,
        buildSharedInventoryCardLayout:(_row,settings)=>'<section>'+settings.metricsHtml+settings.photoHtml+settings.detailsHtml+'</section>',
    });
    for (const name of ['isHoldReleaseOverrideActiveForItem','isSeasonSalesNoteCardItem','isEvalSensitiveDataRestricted','isRequestComplete',
        'isRequestDeliverySending','isRequestDeliveryNeedsAttention','isTouchConstrainedDevice','rowSourceContainsHl','isSeasonSalesOfficeItem',
        'canAddItemToBloomPicker','canCurrentUserUseDriveCardOptions','canCurrentUserSelectDriveWorkflowRow','isWarehouseAssignedDriveCardForCurrentUser']) context[name] = () => false;
    vm.createContext(context);
    vm.runInContext(code,context);
    return {context,calls,master,item:{...master,UNIQUE_ID:'display-one',PTRONHAND:999,PTRAVAILABLE:999,ORDER_QTY:500}};
}

export function normalizedCardDigest(html) {
    return createHash('sha256').update(html.replace(/\s+/g,' ').trim()).digest('hex');
}

function fixturePhotoUrls(value) {
    if (Array.isArray(value)) return value.map(entry=>typeof entry==='string'?entry:entry.url);
    return String(value||'').split(',').filter(Boolean);
}

export function assertCanonicalEvidenceExtraction() {
    const code = read('assets/canonical-inventory-evidence.js')+'\n'+declaration(read('assets/row-workflow-functions.js'),'resolveCanonicalInventoryRow');
    const now = Date.now(), fresh = new Date(now-86400000).toISOString();
    const master = {UNIQUE_ID:'one',ITEMCODE:'sku',LOCATIONCODE:'A.01',LOTCODE:'27.F1',PTRONHAND:7,PTRAVAILABLE:0,MATCH:50};
    const note = {master_unique_id:'sibling',ITEMCODE:'sku',LOCATIONCODE:'A.01',LOTCODE:'27.F1',PHOTO_LINK:'https://fixture/new.jpg',PHOTO_DATE:fresh,SPEC:'Location spec'};
    let scope = 'account';
    const context = {masterInventoryById:new Map([['one',master]]),masterInventoryByItemCode:new Map([['SKU',[master]]]),
        getManagerAssignedColumnState:()=>({noteScope:'account',locationSalesNotes:new Map([['SKU',[note]]])}),
        getSupabaseReadIdentityScope:()=>scope,
        getPhotoUrlList:fixturePhotoUrls,
        getPhotoEntryDateMs:(_url,row)=>Date.parse(row.PHOTO_DATE), getPhotoRetentionFallbackDateMs:row=>Date.parse(row.PHOTO_DATE)};
    vm.createContext(context);vm.runInContext(code,context);
    const row = {...master,PTRONHAND:999,PTRAVAILABLE:999,SNAPSHOT:{PTRONHAND:999,PTRAVAILABLE:999,OPEN_STOCK:500}};
    const resolve = () => context.resolveCanonicalInventoryRow(row);
    assert.equal(resolve().UNIQUE_ID,'one');assert.equal(resolve().PTRONHAND,7);assert.equal(resolve().AVAILABLE,0);
    assert.equal(resolve().SNAPSHOT.PTRONHAND,7);assert.equal(resolve().SNAPSHOT.OPEN_STOCK,undefined);
    assert.equal(resolve().SPEC,'Location spec');assert.equal(resolve().LOC_PHOTO_MATCH,4);
    scope = 'other';assert.equal(resolve().PHOTO_LINK,undefined);assert.equal(resolve().SPEC,undefined);
    scope = 'account';master.LOC_PHOTO_MATCH = 0;
    assert.equal(resolve().PHOTO_LINK,undefined);assert.equal(resolve().LOC_PHOTO_MATCH,0);
    delete master.LOC_PHOTO_MATCH;note.PHOTO_DATE = new Date(now-11*86400000).toISOString();
    assert.equal(resolve().PHOTO_LINK,undefined);
}

export async function assertPublicationBranchExtraction() {
    const code = read('assets/row-publication-branches.js')+'\n'+declaration(read('assets/row-workflow-functions.js'),'publishRowEvaluationToMasterAndNotes');
    let scope = 'account', rollbacks = 0, confirmations = 0, projections = 0;
    const master = {UNIQUE_ID:'master'}, item = {UNIQUE_ID:'request',MASTER_ID:'master'};
    const context = {getSupabaseReadIdentityScope:()=>scope,nativeAuthRecoveryEpoch:1,findLinkedMasterRow:()=>master,
        buildRequestMasterUpdatePayloadFromSave:()=>({}),beginRowEvaluationMemoryPublication:()=>()=>{rollbacks++;},
        staleSupabaseReadScopeError:()=>Error('STALE_SCOPE'),hasRequestCompletionState:row=>row.completed === true,
        reconcileConfirmedDriveEvidence:()=>{projections++;},parsePhotoCsvValues:value=>String(value||'').split(','),
        queueVisibleDatasetCatchup:()=>{},reportHandledRuntimeIssue:()=>{}};
    vm.createContext(context);vm.runInContext(code,context);
    const receipt = {ok:true,lifecycle_state:'completed_history',active:false,row:{unique_id:'request',master_id:'master',completed:true},master_row:{unique_id:'master'}};
    const publish = (result, extra={}) => context.publishRowEvaluationToMasterAndNotes(item,{},
        {requestWork:true,complete:true,onConfirmed:()=>{confirmations++;},persist:async()=>({status:'saved',result}),...extra});
    assert.equal((await publish(receipt)).status,'saved');assert.equal(confirmations,1);assert.equal(projections,1);
    await assert.rejects(publish({...receipt,row:{...receipt.row,unique_id:'wrong'}}),/SAVE_UNCONFIRMED/);
    assert.equal(rollbacks,1);assert.equal(confirmations,1);
    await assert.rejects(publish({...receipt,row:{...receipt.row,completed:false}}),/COMPLETION_RECEIPT_UNCONFIRMED/);
    assert.equal(confirmations,1);assert.equal(rollbacks,2);
    assert.equal((await publish({...receipt,master_row:{unique_id:'wrong'}})).status,'saved');
    assert.equal(confirmations,2);assert.equal(projections,1);assert.equal(rollbacks,2);
    await assert.rejects(publish(receipt,{persist:async()=>{scope='other';return {status:'saved',result:receipt};}}),/STALE_SCOPE/);
    assert.equal(confirmations,2);assert.equal(rollbacks,3);
    scope='account';
    const season = {ok:true,status:'saved',masterId:'master',avNote:'Exact',revision:3};
    const seasonOptions = {seasonSalesOffice:true,expectedRevision:2,persist:async()=>season};
    assert.equal(await context.publishRowEvaluationToMasterAndNotes(master,{av_note:'Exact'},seasonOptions),season);
    await assert.rejects(context.publishRowEvaluationToMasterAndNotes(master,{av_note:'Other'},seasonOptions),/RECEIPT_UNCONFIRMED/);
}
export async function assertPhasebRuntimeExtraction() {
  assertCanonicalEvidenceExtraction();
  await assertPublicationBranchExtraction();
}
