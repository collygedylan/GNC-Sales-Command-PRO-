import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {isRequestBatchReceiptRead,RELEASE_SMOKE_SUPABASE_ORIGIN} from './release-smoke-route-policy.mjs';

const read = file => readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const runtime = read('assets/app-runtime.js'), workflow = read('assets/row-workflow-functions.js'), watchdog = read('assets/runtime-watchdog.js');
const box = {window:{}}; vm.runInNewContext(read('assets/request-submission.js'),box);
const api = box.window.AgMetricRequestSubmission;
function install(ctx,source,name) {
    const match=source.match(new RegExp('^( *)((?:async )?function '+name+'\\([^]*?^\\1})','m'));
    assert.ok(match,name);vm.runInContext(match[2],ctx);
}
export async function receiptContract() {
    const batch='1bf694e3-0000-4000-8000-000000000001',draft={ownerKey:'account',clientBatchId:batch,status:'review-required',requests:[{unique_id:'r1'}]};
    let actor='account',sent=0,removed=0,acked=0,reads=0;
    let proof={client_batch_id:batch,receipt_only:true,delivery_state:'delivered',rows:[{unique_id:'r1',client_batch_id:batch,active:false,lifecycle_state:'completed_history'}]};
    const c=api.createController({currentOwner:()=>actor,saveEntry:async()=>{},deleteEntry:async()=>{removed++;},readEntries:async()=>[draft],
        readReceipt:async()=>{reads++;return proof;},send:async()=>{sent++;},onAcknowledged:()=>{acked++;}});
    const [a,b]=await Promise.all([c.reconcile(draft),c.reconcile(draft)]);
    assert.equal(a.status,'acknowledged');assert.equal(b.status,'acknowledged');assert.deepEqual([reads,sent,removed,acked],[1,0,1,1]);
    proof={...proof,client_batch_id:'sibling'};assert.equal((await c.reconcile(draft)).status,'unconfirmed');
    assert.equal((await c.flush()).pending,1);assert.equal(sent,0);assert.equal(removed,1);
    actor='other';assert.equal((await c.reconcile(draft)).status,'scope-changed');assert.equal(removed,1);
    const url=RELEASE_SMOKE_SUPABASE_ORIGIN+'/rest/v1/rpc/get_my_request_batch_receipt_v23162', body={p_batch:batch,p_ids:['r1']};
    assert.ok(isRequestBatchReceiptRead('POST',url,body));
    for (const invalid of [{...body,p_actor:'forged'},{...body,p_ids:['r1','r1']},{...body,p_ids:[]}])assert.ok(!isRequestBatchReceiptRead('POST',url,invalid));
}
export async function workReceiptContract() {
    const id='conflicted-row',draft={requestId:id,complete:true,baseVersion:10,baseValues:{req_status:'Pending'},dirtyValues:{req_status:'Complete'}};
    const row={unique_id:id,req_status:'Complete',date_completed:'2026-11-04',row_version:13};
    let writes=0;
    const opts={draft,expectedVersion:10,initialPatch:draft.dirtyValues,send:async({expectedVersion})=>{writes++;if(writes===1)throw Object.assign(new Error('REQUEST_VERSION_CONFLICT'),{status:409});assert.equal(expectedVersion,13);return {row,lifecycle_state:'completed_history'};},
        readCanonical:async()=>({requestId:id,completed:true,row,rowVersion:13,values:{req_status:'Complete'}})};
    const outcome=await api.saveRequestWorkWithReconciliation(opts);assert.equal(outcome.status,'saved');
    assert.equal(outcome.result.row,row);assert.equal(outcome.result.lifecycle_state,'completed_history');assert.equal(writes,2);
    const foreign=await api.saveRequestWorkWithReconciliation({...opts,send:async()=>{throw Object.assign(new Error('conflict'),{status:409});},readCanonical:async()=>({requestId:'different',completed:true,row:{unique_id:'different'},rowVersion:13,values:{req_status:'Complete'}})});
    assert.notEqual(foreign.status,'saved');
    const ctx = vm.createContext({activeItem:null,currentUser:'actor',getRequestSubmissionOwnerKey:()=> 'account',isViewVisible:()=>false,
        fetchCanonicalRequestWorkRow:opts.readCanonical,confirmQueueCompletion(){},flushPendingEditsCache(){},getPendingEditsCache:()=>cache});
    const cache={[id]:{requestWorkOwnerKey:'account',requestWorkDraft:draft,autoRetryBlocked:true,timestamp:1}};
    install(ctx,workflow,'reconcileConfirmedRequestWorkDrafts');
    await ctx.reconcileConfirmedRequestWorkDrafts('account');assert.equal(cache[id],undefined);
    cache[id]={requestWorkOwnerKey:'account',requestWorkDraft:{...draft,dirtyValues:{req_spec:'new draft'}},autoRetryBlocked:true,timestamp:2};
    await ctx.reconcileConfirmedRequestWorkDrafts('account');assert.equal(cache[id].requestWorkDraft.dirtyValues.req_spec,'new draft');
}
export function requestGuidanceContract() {
    const seen=[],field={setAttribute(k,v){this[k]=v;},addEventListener(){},focus(){this.focused=true;}};
    const ctx=vm.createContext({document:{getElementById:()=>field},isViewVisible:()=>true,showToast:(...args)=>seen.push(args)});
    install(ctx,workflow,'showRequestWorkFieldValidation');ctx.showRequestWorkFieldValidation('req-match','LOC MATCH % is required');
    assert.equal(field['aria-invalid'],'true');assert.ok(field.focused);assert.equal(seen[0][2],true);assert.ok(seen[0][3].requestInputGuidance);
    const signals=[];const dom=vm.createContext({isVisibleParityNode:()=>true,bannerSelector:'[role=alert]',observeError:(...v)=>signals.push(v)});
    install(dom,watchdog,'inspectBanner');
    const banner={dataset:{kind:'input-guidance'},textContent:'Request field required',matches:()=>true,closest:()=>null};
    dom.inspectBanner(banner);assert.equal(signals.length,0);
    banner.dataset.kind='error';dom.inspectBanner(banner);assert.equal(signals.length,1);
    const recovery = read('assets/rpc-recovery-domain.js');
    assert.ok(/response\.status === 409 && \/\^save_request_work\/\.test\(rpcName\)/.test(recovery),
        'direct RPC recovery reserves expected request-work conflicts for reconciliation');
    assert.ok(/isRequestWorkVersionConflict\(error\).*observeError/.test(runtime),
        'unresolved request-work conflicts remain observable');
    const transport = vm.createContext({window:{GncRuntimeWatchdog:{
        observeError:(...args)=>signals.push(args), record:(...args)=>signals.push(args)
    }}});
    install(transport,read('assets/app-api-transport.js'),'reportAppFunctionFailure');
    transport.reportAppFunctionFailure('request_work',{operation:'save'},{status:409},'REQUEST_VERSION_CONFLICT');
    assert.equal(signals.length,1);
    transport.reportAppFunctionFailure('request_work',{operation:'save'},{status:500},'REQUEST_SAVE_FAILED');
    assert.equal(signals.length,3);
}
export async function retainedDraftContract() {
    const owner='reviewer', batches=['aaaaaaaa-aaaa-4aaa-8aaa-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-000000000003'];
    const store=new Map(batches.map((b,i)=>[b,{ownerKey:owner,clientBatchId:b,status:'pending',attempts:1,
        requests:[{unique_id:'r'+i}],formSnapshot:{customer:'Customer '+i}}]));
    let sends=0,deletes=0,recorded=0;
    const options={currentOwner:()=>owner,saveEntry:async entry=>{store.set(entry.clientBatchId,entry);},deleteEntry:async()=>{deletes++;},
        readEntries:async()=>Array.from(store.values()),readReceipt:async entry=>({review_only:true,client_batch_id:entry.clientBatchId,request_ids:entry.requests.map(row=>row.unique_id)}),
        send:async()=>{sends++;},onRetained:async()=>{recorded++;}};
    const controller=api.createController(options);
    await controller.flush();await controller.flush();
    assert.deepEqual([sends,deletes,recorded],[0,0,3]);
    for (const entry of store.values()) { assert.equal(entry.status,'review-required');assert.ok(entry.retainedForReview && entry.formSnapshot.customer); }
    const original={...store.values().next().value,status:'pending',retainedForReview:false};
    const malformed=api.createController({...options,readReceipt:async()=>({review_only:true,client_batch_id:original.clientBatchId,request_ids:['other']})});
    assert.equal((await malformed.submit(original)).status,'unconfirmed');assert.equal(sends,0);
    const offline=api.createController({...options,saveEntry:async()=>{throw new Error('disk full');}});
    assert.equal((await offline.submit(original)).status,'storage-failed');assert.equal(sends,0);
    let selected=null,root=null;
    const el=()=>({children:[],setAttribute(){},append(...nodes){this.children.push(...nodes);},appendChild(node){this.children.push(node);},remove(){}});
    const doc={createElement:el,getElementById:id=>id==='request-rep-modal'?{querySelector:()=>({prepend:node=>{root=node;}}),classList:{remove(){}}}:null};
    const ui=vm.createContext({document:doc,getRequestSubmissionOwnerKey:()=>owner,requestSubmissionEntries:store,requestSubmitInFlight:false,
        closeRequestModal(){},restoreRequestSubmissionForm:entry=>{selected=entry.clientBatchId;}});
    install(ui,workflow,'showSavedRequestReviewChoices');
    assert.equal(ui.showSavedRequestReviewChoices(owner),true);assert.equal(root.children.length,6);
    root.children[3].onclick();assert.equal(selected,batches[1]);assert.equal(sends,0);
}
