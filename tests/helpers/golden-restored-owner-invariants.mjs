import assert from 'node:assert/strict';
import {read, functionSource, runFunctions} from './golden-test-environment.mjs';

export function invariant237() {
  const ownerMigration = read('supabase/migrations/20261030220000_agdata_v23117_itemcode_owner_lww.sql');
  const appRuntime = read('assets/app-runtime.js');
  const ownerSave = functionSource('assets/manager-tab-routing.js','applyManagerAssignedOwnerMirrors');
  const storageBuilder = appRuntime.slice(appRuntime.indexOf('function buildSupabaseStorageThumbnailUrl'), appRuntime.indexOf('function getDirectImageUrl'));
  assert.doesNotMatch(ownerMigration, /ITEMCODE_DEFAULT_OWNER_REVISION_CONFLICT/);
  assert.match(ownerMigration, /current_row\.revision \+ 1/);
  assert.match(ownerSave, /const owner = saved\.assignedto[^]*default_owner: owner/);
  assert.match(ownerSave, /Number\(saved\?\.default_revision \?\? saved\?\.revision[^]*default_revision: revision/);
  assert.match(storageBuilder, /nextUrl\.pathname = objectPrefix \+ publicPath/);
  assert.match(storageBuilder, /searchParams\.delete\(key\)/);
  assert.doesNotMatch(storageBuilder, /nextUrl\.pathname = renderPrefix \+ publicPath|searchParams\.set\('(width|height|resize|quality|format)'/);
  assert.ok(/cacheControl: String\(options\.cacheControl \|\| '31536000'\)/.test(appRuntime));
}

export async function invariant274() {
 const body={p_itemcodes:['A'],p_assignedto:'zoe_green',p_request_id:'00000000-0000-4000-8000-000000000001'};
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 const harness=()=>{
  let scope='account-a',native=true;const timers=new Map(),calls=[];
  let nextTimer = 1;
  const context=runFunctions('assets/app-runtime.js',['supabaseRpc'],{AbortController,
   assertEvalDataSourceAllowed:()=>{},getNativeAuthRequestHeaders:async()=>native?{Authorization:'Bearer native-session'}:null,
   getSupabaseReadIdentityScope:()=>scope,nativeSessionRecoveryError:()=>new Error('Native session required'),
   SUPABASE_URL:'https://example.test',SUPABASE_WRITE_TIMEOUT_MS:22000,redactEvalSensitiveData:value=>value,
   getResponseError:async()=> 'Forbidden',setTimeout:(fn,ms)=>{
     if (ms === 75) { timers.set(1,fn); return 1; }
     assert.equal(ms,22000);
     return ++nextTimer;
   },clearTimeout:id=>timers.delete(id),
   window:{GncDatabase:{fetchRpc:(url,name,request)=>new Promise((resolve,reject)=>calls.push({url,name,request,resolve,reject}))}}
  });
  return {context,calls,timers,setScope:value=>{scope=value;},denyNative:()=>{native=false;}};
 };
 const h=harness();const pending=h.context.supabaseRpc('set_itemcode_default_owners_v1',body);await flush();assert.equal(h.calls.length,1);
 h.timers.get(1)();await flush();assert.equal(h.calls.length,2);assert.equal(h.calls[0].request.body,h.calls[1].request.body);
 assert.deepEqual(h.calls[0].request.headers,h.calls[1].request.headers);assert.equal(h.calls[0].request.ownerReplayRelay,false);assert.equal(h.calls[1].request.ownerReplayRelay,true);assert.equal(JSON.parse(h.calls[1].request.body).p_request_id,body.p_request_id);
 h.calls[1].resolve(new Response(JSON.stringify({requestId:body.p_request_id,defaults:[{itemcode:'A',assignedto:'zoe_green'}]})));
 assert.equal((await pending).requestId,body.p_request_id);assert.equal(h.timers.size,0);assert.equal(h.calls[0].request.signal.aborted,true);assert.equal(h.calls[1].request.signal.aborted,false);
 h.calls[0].reject(new Error('superseded transport'));await flush();assert.equal(h.calls.length,2);
 const denied=harness();const deniedSave=denied.context.supabaseRpc('set_itemcode_default_owners_v1',body);await flush();
 denied.calls[0].resolve(new Response(JSON.stringify({code:'42501'}),{status:403}));await assert.rejects(deniedSave,error=>error.status===403&&error.code==='42501');assert.equal(denied.calls.length,1);assert.equal(denied.timers.size,0);
 const switched=harness();const switchedSave=switched.context.supabaseRpc('set_itemcode_default_owners_v1',body);await flush();switched.setScope('account-b');switched.timers.get(1)();await assert.rejects(switchedSave,error=>error.code==='REQUEST_SCOPE_CHANGED');assert.equal(switched.calls.length,1);assert.equal(switched.calls[0].request.signal.aborted,true);
 const cancelled=harness(),abort=new AbortController();const cancelledSave=cancelled.context.supabaseRpc('set_itemcode_default_owners_v1',body,{signal:abort.signal});await flush();cancelled.timers.get(1)();abort.abort();await assert.rejects(cancelledSave,error=>error.code==='REQUEST_ABORTED');assert.ok(cancelled.calls.every(call=>call.request.signal.aborted));
 const unauthenticated=harness();unauthenticated.denyNative();await assert.rejects(unauthenticated.context.supabaseRpc('set_itemcode_default_owners_v1',body),/Native session required/);assert.equal(unauthenticated.calls.length,0);
 const unavailable=harness();const continued=unavailable.context.supabaseRpc('set_itemcode_default_owners_v1',body);await flush();unavailable.timers.get(1)();unavailable.calls[1].resolve(new Response('{}',{status:503}));await flush();unavailable.calls[0].resolve(new Response('{}'));await continued;assert.equal(unavailable.calls.length,2);
 const other=harness();const otherSave=other.context.supabaseRpc('other_authorized_rpc',{});await flush();assert.equal(other.timers.size,0);other.calls[0].resolve(new Response('{}'));await otherSave;assert.equal(other.calls.length,1);
}

export function invariant291() {
 const row={master_unique_id:'A',ITEMCODE:'A',default_revision:1,default_owner:'old'};
 const other={master_unique_id:'B',ITEMCODE:'B',default_revision:7,default_owner:'other'};
 const rows=[row,other],state={displayCache:{input:rows,rows,signature:'before'}};
 let normalized=0;
 const ctx=runFunctions('assets/app-runtime.js',['applyAcknowledgedEvalAssignmentResults','unwrapEvalAssignmentRpcRow','applyManagerAssignedOwnerMirrors'],{
   warehouseAssignedItemsInventory:rows,fullInventory:rows,currentUser:'dylan_collyge',getManagerAssignedColumnState:()=>state,
   buildManagerEvalAssignmentKey:String,normalizeWarehouseAssignedItemRow:r=>{normalized++;return r;},
   clearWarehouseAssignedItemCaches:()=>{},invalidateManagerEvalReport2Cache:()=>{}
 });
 ctx.applyAcknowledgedEvalAssignmentResults([],[{contractVersion:'inventory-row-assignments-v1',
   assignments:[{master_unique_id:'A',itemcode:'A',assignedto:'new',revision:2,present_in_drive:true}],
   defaults:[{itemcode:'A',assignedto:'new',revision:2}]}]);
 assert.equal(row.default_owner,'new');
 assert.equal(row.effective_worker,'new');
 assert.equal(row.default_revision,2);
 assert.equal(other.default_owner,'other');
 assert.equal(ctx.warehouseAssignedItemsInventory[0],other);
 assert.equal(normalized,1,'the acknowledgement normalizes only the confirmed row');
 assert.equal(state.displayCache,null,'a later paint must recalculate the stale projection');
}

export async function invariant297() {
 let finish,calls=0;const ctx=runFunctions('assets/app-runtime.js',['supabaseRpc'],{setTimeout,clearTimeout,assertEvalDataSourceAllowed:()=>{},getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer verified'}),SUPABASE_URL:'https://project.test',SUPABASE_WRITE_TIMEOUT_MS:22000,redactEvalSensitiveData:x=>x,window:{GncDatabase:{fetchRpc:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}}}});
 let done=false;const pending=ctx.supabaseRpc('set_itemcode_default_owners_v1',{p_itemcodes:['A','B','C'],p_assignedto:'abigail_vazquez',p_request_id:'00000000-0000-4000-8000-000000000001'},{singleWrite:true}).then(v=>{done=true;return v;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(done,false);finish(new Response(JSON.stringify({contractVersion:'inventory-row-assignments-v1',assignments:[]})));assert.equal((await pending).contractVersion,'inventory-row-assignments-v1');assert.equal(calls,1);
}

export async function invariant301() {
 const calls=[];const ctx=runFunctions('assets/app-runtime.js',['supabaseRpc'],{setTimeout,clearTimeout,assertEvalDataSourceAllowed:()=>{},getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer verified'}),SUPABASE_URL:'https://project.test',SUPABASE_WRITE_TIMEOUT_MS:22000,redactEvalSensitiveData:x=>x,window:{GncDatabase:{fetchRpc:async(_url,_name,request)=>{const command=JSON.parse(request.body);calls.push(command);return Response.json({requestId:command.p_request_id});}}}});
 for(const p_request_id of ['first','second'])assert.equal((await ctx.supabaseRpc('set_itemcode_default_owners_v1',{p_itemcodes:['A'],p_assignedto:'owner',p_request_id},{singleWrite:true})).requestId,p_request_id);
 assert.equal(calls.length,2);const sql=read('supabase/migrations/20261101010000_agdata_v23127_permissions_and_hold_history.sql');assert.match(sql,/unchanged authorized command[^]*if exists[^]*d.assignedto is distinct from[^]*with requested as materialized/);assert.match(sql,/insert into private.ph_itemcode_default_owner_commands/);
}
