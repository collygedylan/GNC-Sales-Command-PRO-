import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {chromium, webkit} from 'playwright';
import {readDetailSource, detailFunctionSource} from './helpers/request-detail-compact-contract.mjs';

const mutationRoute = /^https:\/\/fixture.test\/(?:rpc|suspend)\//;
const site = process.env.GNC_DETAIL_SITE || '_site';
const shell = fs.readFileSync(path.join(site,'index.html'),'utf8');
const styles = [...shell.matchAll(/<link\b[^>]*href="\.\/([^"?]+\.css)(?:\?[^"]*)?"/g)]
    .map(match => `<style>${fs.readFileSync(path.join(site,match[1]),'utf8')}</style>`).join('\n');
const start = shell.indexOf('<div id="view-detail"');
function detailTemplate() {
    let depth=0;
    for (const match of shell.slice(start).matchAll(/<\/?div\b[^>]*>/g)) {
        depth += match[0].startsWith('</') ? -1 : 1;
        if (!depth) return shell.slice(start,start+match.index+match[0].length).replace('id="view-detail" class="hidden"','id="view-detail"');
    }
    throw Error('Detail template missing');
}
const detail=detailTemplate();
const row = {UNIQUE_ID:'REQ-source',ITEMCODE:'grass',COMMONNAME:'Cassian Dwarf Fountain Grass',CONTSIZE:'#3',LOTCODE:'27.F1',LOCATIONCODE:'C.16.000',
    PRIORITY:1,PTRONHAND:703,PTRREVIEWED:49,PTRAVAILABLE:654,S_LTS:703,REQ_QTY:1,REQ_RESERVE:'YES',REQUESTED_BY:'Kevin Effinger',REQ_CUSTOMER:'Customer',REQUEST_FOLDER:'Folder A'};
const options = [1,2].map(n => ({...row,UNIQUE_ID:'master-'+n,LOCATIONCODE:'C.16.00'+n,PTRAVAILABLE:n === 1 ? 654 : 49}));

function commandSources() {
    return detailFunctionSource(['syncSuspendAvOptionSelectionControls','collectSelectedRequestItemCodeOptionRows','addSelectedRequestItemCodeOptions',
        'appendSelectedOptionsToExistingRequest','mergeConfirmedRequestOptionRows','addSelectedDockSuspendDcRequestOptions','applySuspendCandidateRows'])
        + detailFunctionSource(['suspendTagApi'],'assets/row-workflow-functions.js');
}

function fixtureBindings(suspend) {
    return `
    window.lastToast=null;
    var activeItem=${JSON.stringify({...row,suspend,docknumber:38,dropnumber:2,loadnumber:56})}, candidates=${JSON.stringify(options)};
    var activeDetailSourceView='request',lastView='request',requestAvOptionsDropdownOpen=false,activeReqTab='pending',requestViewLevel=1,selectedReqFolder='Folder A';
    var requestsInventory=[],socInventory=[],socRawSourceRows=[],suspendTagInventory=[],suspendTagRawSourceRows=[],requestScopedItemsCacheKey='',docksScopedItemsCacheKey='';
    var currentUser='fixture',nativeAuthSessionActive=true,ACTIVE_REQUEST_TABLE='ph_requests_pending',SUPABASE_WRITE_TIMEOUT_MS=1000;
    var requestOptionAppendInFlight=new Set(),requestOptionAppendBatchIds=new Map(),dockSuspendCompletionInFlight=new Set(),commandState={scope:'fixture',pending:{}};
    var noOp=()=>{},escapeShareHtml=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),esc=escapeShareHtml;
    var firstNonEmptyValue=(...v)=>v.find(x=>x!==null&&x!==undefined&&x!=='');
    var getItemUniqueId=x=>typeof x==='string'?x:x?.UNIQUE_ID||x?.unique_id||'',getCurrentVisibleViewId=()=> 'detail';
    var isRequestDetailItem=()=>true,isDockSuspendDcRequestMirrorRow=x=>!!x?.suspend,canAddRequestItemCodeOptions=()=>true;
    var getRequestItemCodeOptionItemCode=x=>x.ITEMCODE,getRequestItemCodeOptionMasterId=getItemUniqueId,getRequestItemCodeOptionRows=()=>candidates;
    var ensureRequestItemCodeOptionState=()=>({key:'fixture',error:''}),loadRequestItemCodeOptions=async()=>{},filterDriveNegativeSltsAvOptionRows=x=>x;
    var getExistingRequestItemCodeOptionKeys=()=>({}),getRequestItemCodeOptionCandidateState=()=>({selectable:true});
    var getCardPtrOnHandValue=x=>x.PTRONHAND,getCardPtrReviewedValue=x=>x.PTRREVIEWED,getCardPtrAvailableValue=x=>x.PTRAVAILABLE,getCardOpenStockValue=x=>x.S_LTS;
    var getRequestAvailableQty=x=>x.PTRAVAILABLE,resolveCanonicalInventoryRow=x=>x,buildQueueInventoryMetricsHtml=x=>x;
    var getRequestFolderName=x=>x.REQUEST_FOLDER,getRequestDesiredSpecValue=()=> '12-18 in',getRequestDesiredCaliperValue=()=> 'N/A',getRequestRowNoteValue=()=> 'Keep separate';
    var resolveRequestCardQuantity=x=>x.REQ_QTY,normalizeRequestReserveValue=x=>x==='YES'?'YES':'NO',getSupabaseReadIdentityScope=()=> 'fixture';
    var syncDetailSharedPanelsVisibility=()=>document.querySelector('#detail-shared-panels').classList.remove('hidden'),syncRequestDetailScrollMode=noOp;
    var showToast=(title,message)=>{window.lastToast={title,message}},normalizeRowPhotoFields=x=>x,buildSearchIndex=x=>x,createStableClientBatchId=()=> 'stable-batch';
    var formatFetchedRows=rows=>rows.map(x=>({...x,UNIQUE_ID:x.unique_id||x.UNIQUE_ID})),findRequestInventoryRowByUniqueId=id=>requestsInventory.find(x=>getItemUniqueId(x)===id);
    var rebuildRequestInventoryIndexes=noOp,syncRealtimeRequestRows=noOp,refreshLocalRequestViewState=noOp,triggerRequestRealtimeUiRefresh=noOp;
    var queueAppLiveEventForWrite=noOp,flushQueuedAppLiveEvents=async()=>{},syncAlwaysOnRequestData=noOp,renderRequestThisLocationPanel=noOp;
    var getRequestOptionAppendErrorState=()=>({title:'Save Failed',message:'Retry'}),isViewVisible=()=>false;
    var supabaseRpc=async(name,payload)=>{const r=await fetch('https://fixture.test/rpc/'+name,{method:'POST',body:JSON.stringify(payload)});if(!r.ok)throw Error('failed');return r.json()};
    var getDockSuspendDcRequestSourceUid=getItemUniqueId,findDockSuspendDcRequestSourceRow=x=>x,getSuspendTagStableSourceIdentity=x=>({uid:getItemUniqueId(x)});
    var serializeSuspendTagRowWrite=(row,callback)=>callback(),getDockSuspendCompletionState=()=>commandState,persistDockSuspendCompletionState=noOp;
    var getDockSuspendCompletionRevision=()=> 'revision',getSuspendTagWriteVersion=()=>1,isFalseBlockLocation=()=>false;
    var buildDockSuspendDcOptionSocEntry=x=>({payload:{unique_id:getItemUniqueId(x),locationcode:x.LOCATIONCODE,lotcode:x.LOTCODE}}),syncRequestTabButtons=noOp;
    var openDockSuspendDcRequestUpdate=noOp,goBackFromDetail=noOp,switchView=noOp,scheduleRequestRender=noOp,suspendTagErrorMessage=e=>e.message;
    var currentSuspendSourceSnapshot=()=>null,suspendTagReceiptMatchesSource=(op,p,result)=>result.ok===true,suspendSourceSnapshotChanged=()=>false,applySuspendTagInventoryReceipt=noOp;
    var retrySuspendTagTransport=async(operation,payload)=>{const r=await fetch('https://fixture.test/suspend/'+operation,{method:'POST',body:JSON.stringify(payload)});if(!r.ok)throw Error('failed');return {data:await r.json()}};
    var upsertRealtimeRow=(rows,row)=>{const i=rows.findIndex(x=>getItemUniqueId(x)===getItemUniqueId(row));if(i<0)rows.push(row);else rows[i]=row};
    var refreshRealtimeDetailLookupIndexes=noOp,invalidateDockSuspendDcSourceRowLookup=noOp,invalidateResolvedViewStateCaches=noOp,markViewDirty=noOp,scheduleDocksRender=noOp;
    var refreshLocalDockSuspendDcRequestState=noOp;
    function toggleRequestAvOptionsDropdown(){requestAvOptionsDropdownOpen=!requestAvOptionsDropdownOpen;renderRequestMatchingInventoryOptions(activeItem,'request',{skipLoad:true});return false;}
    `;
}

async function installFixture(page,suspend,theme) {
    await page.route('https://fixture.test/document',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head>
        <body class="ops-precision-pilot ag-premium-skin current-view-detail" data-ops-theme="${theme}" data-current-view="detail">
        <main id="main-scroll-area">${detail}</main><section id="fixture-queue"></section></body></html>`}));
    await page.goto('https://fixture.test/document');
    await page.unroute('https://fixture.test/document');
    await page.addScriptTag({content:fixtureBindings(suspend)});
    for (const file of ['request-detail-summary','request-detail-av-options','detail-item-share']) {
        await page.addScriptTag({content:fs.readFileSync(path.join(site,'assets',file+'.js'),'utf8')});
    }
    await page.addScriptTag({content:commandSources()});
    await page.evaluate(() => {
        document.getElementById('view-detail').classList.add('detail-request-mode');
        document.getElementById('det-overview-content').classList.add('hidden');
        document.getElementById('det-request-content').classList.remove('hidden');
        renderRequestDetailInfo(activeItem,'request');
        renderRequestMatchingInventoryOptions(activeItem,'request',{skipLoad:true});
        syncInlineItemDetailShare(document.getElementById('view-detail'));
    });
}

async function checkGeometry(page,suspend) {
    assert.equal(await page.locator('[data-inline-detail-share],.request-reference-identity,#request-summary-dialog').count(),0);
    for (const id of ['det-tabs-container','det-mobile-tab-select-wrap','det-title-row','det-request-desired-panel']) {
        assert.equal(await page.locator('#'+id).isVisible(),false,id);
    }
    assert.equal(await page.locator('#req-reserve').getAttribute('readonly'),'');
    assert.deepEqual(await page.locator('.request-reference-line > span').allTextContents(),['Cassian Dwarf Fountain Grass','#3','27.F1','C.16.000','PRI 1']);
    assert.deepEqual(await page.locator('.request-compact-metrics .request-compact-label').allTextContents(),['Priority','On Hand','Review','Available','Open Stock']);
    assert.deepEqual(await page.locator('.request-compact-dock .request-compact-value').allTextContents(),suspend ? ['38','2','56'] : []);
    const geometry = await page.evaluate(() => {
        const rect=s=>document.querySelector(s).getBoundingClientRect();
        return {ys:[...document.querySelectorAll('.request-reference-line > span')].map(x=>x.getBoundingClientRect().top),
            header:rect('.request-compact-header').height,button:rect('.detail-av-trigger').height,
            spec:rect('#req-spec').bottom,metadata:rect('.request-compact-metadata').bottom,metrics:rect('.request-compact-metrics').bottom,
            overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.ok(Math.max(...geometry.ys)-Math.min(...geometry.ys)<2,'single identity row');
    assert.ok(geometry.header<260 && geometry.button<=40 && geometry.metadata>geometry.metrics);
    assert.equal(geometry.overflow,false);
    assert.ok(geometry.spec>0 && geometry.spec<650,'Spec stays above the mobile fold');
    return geometry;
}

async function exerciseAdd(page,suspend,count,fail=false) {
    const calls=[];
    await page.route(mutationRoute,async route => {
        calls.push({url:route.request().url(),body:route.request().postDataJSON()});
        const rows=options.slice(0,count).map((value,index)=>({...value,UNIQUE_ID:'added-'+index,unique_id:'added-'+index,REQUEST_FOLDER:'Folder A'}));
        await route.fulfill({headers:{'access-control-allow-origin':'*'},status:fail ? 503 : 200,json:suspend ? {ok:true,rows} : {status:'added',inserted_count:count,rows}});
    });
    await page.locator('.detail-av-trigger').click();
    for (let index=0;index<count;index++) await page.locator('[data-request-itemcode-option]').nth(index).check();
    assert.equal(await page.locator('.detail-av-add').isEnabled(),true);
    await page.locator('.detail-av-add').click();
    await page.waitForFunction(() => window.lastToast || requestsInventory.length || (!dockSuspendCompletionInFlight.size && suspendTagInventory.some(x=>x.unique_id?.startsWith('added-'))));
    const result=await page.evaluate(suspend => ({rows:(suspend?suspendTagInventory:requestsInventory).map(x=>x.UNIQUE_ID||x.unique_id),
        toast:window.lastToast,checked:document.querySelectorAll('[data-request-itemcode-option]:checked').length}),suspend);
    assert.deepEqual(result.rows,fail ? [] : Array.from({length:count},(_,i)=>'added-'+i),JSON.stringify({result,calls}));
    assert.equal(calls.length,1);
    assert.ok(calls[0].url.endsWith(suspend ? '/suspend/add_candidates' : '/rpc/append_request_options_v1'));
    if (!suspend) assert.equal(calls[0].body.p_request_folder,'Folder A');
    if (fail) assert.equal(result.checked,count,'retain failed selection');
    await page.unroute(mutationRoute);
}

async function checkTheme(page,engine,width,theme,measurements) {
    for (const suspend of [false,true]) {
        await installFixture(page,suspend,theme);
        measurements.push({width,engine:engine.name(),theme,suspend,...await checkGeometry(page,suspend)});
        await exerciseAdd(page,suspend,theme==='light'?1:2);
    }
}

async function checkProfile(engine,width,measurements) {
    const browser=await engine.launch({headless:true});
    try {
        const page=await browser.newPage({viewport:{width,height:844}});
        const errors=[];
        page.on('pageerror',error=>errors.push(error.stack));
        await page.route('**/*',route=>route.abort());
        for (const theme of ['light','dark']) await checkTheme(page,engine,width,theme,measurements);
        await installFixture(page,false,'dark');
        await exerciseAdd(page,false,2,true);
        assert.deepEqual(errors,[]);
    } finally { await browser.close(); }
}

test('compact Request/Suspend geometry and confirmed multi-row additions',async t => {
    const {version}=JSON.parse(readDetailSource('version.json'));
    const measurements=[];
    for (const [engine,width] of [[chromium,1440],[chromium,390],[webkit,390]]) await checkProfile(engine,width,measurements);
    const evidence=`G:/My Drive/GNC/AgData/Release Evidence/v${version}-detail-geometry.json`;
    fs.writeFileSync(evidence,JSON.stringify({version,componentFixture:true,measurements},null,2));
    t.diagnostic(`12 geometry/addition cases and 3 failed-write cases passed; ${evidence}`);
});
