import assert from 'node:assert/strict';
import vm from 'node:vm';
import {functionSource,runFunctions,plain} from './golden-test-environment.mjs';

export function invariant246() {
 const body=functionSource('assets/suspend-receipt-domain.js','executeSuspendRowCommand');const expression=body.match(/if \(photoOnly && \((options.photoProof.owner[^]*?)\)\) return \{ acknowledged: true, applied: false \};/)?.[1];assert.ok(expression);
 const controller=new AbortController();const ctx=vm.createContext({getSupabaseReadIdentityScope:()=> 'actor-a',canCurrentUserWorkRequestItem:()=>true});vm.runInContext('function shouldDefer(options,mirror){return ('+expression+');}',ctx);const options={photoProof:{owner:'actor-a',signal:controller.signal}};assert.equal(ctx.shouldDefer(options,{}),false);controller.abort();assert.equal(ctx.shouldDefer(options,{}),true);
}

export async function invariant269() {
 const prior={},next={};let active=prior,undo=0,ack=0;
 const ctx=runFunctions('assets/app-runtime.js',['assignEvalItemcodes'],{
  canManageEvalItemcodeAssignments:()=>true,isManagerAssignedSnapshotCurrent:()=>true,
  buildManagerEvalAssignmentKey:x=>x,parseManagerEvalAssignmentKey:x=>({itemcode:x}),getManagerAssignedColumnState:()=>active,
  warehouseAssignedItemsInventory:[{itemcode:'A',default_revision:1}],normalizeEvalAssignableUser:x=>x,crypto:{randomUUID:()=> 'request'},
  applyOptimisticItemcodeOwners:()=>()=>{undo++;},requestAnimationFrame:()=>{},
  supabaseRpc:async()=>{active=next;return {};},applyAcknowledgedEvalAssignmentResults:()=>{ack++;}
 });
 assert.equal(await ctx.assignEvalItemcodes(['A'],'zoe_green'),false);assert.equal(undo,1);assert.equal(ack,0);assert.deepEqual(next,{});
}

export async function invariant273() {
 const state={}, events=[];let releaseRefresh,finished=false,allowed=true;
 const refresh=new Promise(resolve=>{releaseRefresh=resolve;});
 const ctx=runFunctions('assets/app-runtime.js',['assignEvalItemcodes'],{
  canManageEvalItemcodeAssignments:()=>allowed,isManagerAssignedSnapshotCurrent:()=>true,
  buildManagerEvalAssignmentKey:x=>x,parseManagerEvalAssignmentKey:x=>({itemcode:x}),getManagerAssignedColumnState:()=>state,
  warehouseAssignedItemsInventory:[{itemcode:'A',default_revision:1}],normalizeEvalAssignableUser:x=>x,crypto:{randomUUID:()=> 'request'},
  applyOptimisticItemcodeOwners:()=>{events.push('optimistic');return ()=>events.push('rollback');},requestAnimationFrame:fn=>fn(),
  supabaseRpc:async()=>{events.push('rpc');return {defaults:[{itemcode:'A',assignedto:'zoe_green',revision:2}]};},
  applyAcknowledgedEvalAssignmentResults:()=>events.push('receipt'),managerEvalAssignmentSelection:new Set(['A']),
  showToast:()=>{},updateManagerAssignedItemsView:()=>events.push('render'),scheduleManagersRender:()=>{},
  reloadWarehouseAssignmentsAfterMutation:()=>{events.push('refresh');return refresh;},reportSemanticHealthEvent:()=>{}
 });
 const save=ctx.assignEvalItemcodes(['A'],'zoe_green').then(()=>{finished=true;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(finished,true,'durable acknowledgment must not await the background snapshot');
 assert.ok(events.indexOf('optimistic')<events.indexOf('rpc'));assert.ok(events.indexOf('receipt')<events.indexOf('refresh'));
 assert.equal(state.defaultPending.size,0);assert.equal(state.defaultCommands.size,0);assert.equal(Object.keys(state.defaultDrafts).length,0);
 allowed=false;await ctx.assignEvalItemcodes(['A'],'zoe_green');assert.equal(events.filter(x=>x==='rpc').length,1);
 releaseRefresh();await save;assert.equal(events.includes('rollback'),false);
}

export async function invariant283() {
 const state={viewPageSource:{page:'assigned-items'}};const rows=[{ITEMCODE:'A',default_revision:2}];const events=[];let allowed=true,resolveSave,reads=0;
 const rpc=new Promise(resolve=>{resolveSave=resolve;});
 const ctx=runFunctions('assets/app-runtime.js',['assignEvalItemcodes'],{canManageEvalItemcodeAssignments:()=>allowed,buildManagerEvalAssignmentKey:x=>String(x||'').toUpperCase(),parseManagerEvalAssignmentKey:x=>({itemcode:x}),isManagerAssignedSnapshotCurrent:()=>true,getManagerAssignedColumnState:()=>state,readFreshPagedAssignedDefaults:async()=>{reads++;return new Map([['A',rows[0]]]);},warehouseAssignedItemsInventory:rows,normalizeEvalAssignableUser:x=>x,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000283'},applyOptimisticItemcodeOwners:()=>{events.push('optimistic');return ()=>events.push('undo');},requestAnimationFrame:()=>{},updateManagerAssignedItemsView:()=>{},supabaseRpc:(_name,body)=>{events.push('rpc');assert.deepEqual(plain(body.p_itemcodes),['A']);return rpc;},applyAcknowledgedEvalAssignmentResults:()=>events.push('ack'),managerEvalAssignmentSelection:new Set(['A']),showToast:()=>{},scheduleManagersRender:()=>{},getManagerReportPageController:()=>({refresh:()=>events.push('refresh')}),reportSemanticHealthEvent:()=>{}});
 const pending=ctx.assignEvalItemcodes(['A'],'mitch_kaiser');assert.deepEqual(events,['optimistic','rpc']);assert.equal(reads,0);assert.equal(state.defaultPending.has('A'),true);
 assert.equal(await ctx.assignEvalItemcodes(['A'],'zoe_green'),false);assert.equal(events.length,2);resolveSave({ok:true});assert.equal(await pending,false);assert.ok(events.includes('ack'));assert.equal(state.defaultPending.size,0);
 allowed=false;assert.equal(await ctx.assignEvalItemcodes(['A'],'zoe_green'),false);assert.equal(reads,0);
 allowed=true;events.length=0;ctx.supabaseRpc=async()=>{throw new Error('server denied');};assert.equal(await ctx.assignEvalItemcodes(['A'],'zoe_green'),false);assert.deepEqual(events,['optimistic','undo']);
}

export async function invariant286() {
 const rows=Array.from({length:9487},(_,i)=>({ITEMCODE:'I'+i,default_revision:i}));const codes=rows.slice(-45).map(r=>r.ITEMCODE);const state={};let lookups=0,dispatches=0;
 const ctx=runFunctions('assets/app-runtime.js',['assignEvalItemcodes'],{canManageEvalItemcodeAssignments:()=>true,buildManagerEvalAssignmentKey:x=>{lookups++;return x;},parseManagerEvalAssignmentKey:x=>({itemcode:x}),isManagerAssignedSnapshotCurrent:()=>true,getManagerAssignedColumnState:()=>state,warehouseAssignedItemsInventory:rows,normalizeEvalAssignableUser:x=>x,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000286'},applyOptimisticItemcodeOwners:()=>()=>{},requestAnimationFrame:()=>{},updateManagerAssignedItemsView:()=>{},supabaseRpc:async()=>{dispatches++;return {};},applyAcknowledgedEvalAssignmentResults:()=>{},managerEvalAssignmentSelection:new Set(),showToast:()=>{},scheduleManagersRender:()=>{},reloadWarehouseAssignmentsAfterMutation:async()=>{},reportSemanticHealthEvent:()=>{}});
 await ctx.assignEvalItemcodes(codes,'mitch_kaiser');assert.equal(dispatches,1);assert.ok(lookups<=rows.length+codes.length*2,'one scan must replace one full scan per item');
}
