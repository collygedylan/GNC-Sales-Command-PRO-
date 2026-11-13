import { normalizeDockViewDockKey, normalizeDockViewStopKey, isDockSuspendDcRequestSource, normalizeSocDockRowAliases } from './dock-order-domain.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseExpressionAt} from 'acorn';
export function assertCurrentSocDockContract(){
 for(const prefix of ['']){
  const source=fs.readFileSync(new URL('../../'+prefix+'assets/app-runtime.js',import.meta.url),'utf8');
  const flow=['row-workflow-functions','suspend-exact-owner','request-queue-membership'].map(name=>fs.readFileSync(new URL('../../'+prefix+'assets/'+name+'.js',import.meta.url),'utf8')).join('\n');
  const fn=(src,name)=>{const at=src.indexOf('function '+name+'('),node=parseExpressionAt(src,at,{ecmaVersion:'latest'});return src.slice(at,node.end);};
  const ctx={normalizeDockViewDockKey, normalizeDockViewStopKey, isDockSuspendDcRequestSource, normalizeSocDockRowAliases, firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!==''),getDockSuspendToValue:r=>String(r.SUSPEND_TO||r.suspend_to||'').trim().toLowerCase(),getDockSuspendValue:r=>String(r.SUSPEND||r.suspend||'').toUpperCase(),
   isDockSuspendDcRequestMirrorRow:()=>true,getQueueCompletionState:()=>({completedSuspendTagKeys:new Set()}),getDockSuspendDcRequestSourceUid:r=>r.unique_id,
   getSuspendTagStatus:r=>r.suspend_tag_status||'pending',getPhysicalSuspendTagKey:r=>r.unique_id,normalizeEvalAssignableUser:v=>String(v||'').toLowerCase(),
   buildManagerEvalAssignmentKey:v=>String(v||'').replace(/[.]+$/,''),getManagerAssignedColumnState:()=>({}),currentUser:'dylan_collyge'};
  vm.runInNewContext(['getSuspendTagRequestItems'].map(n=>fn(source,n)).join('\n'),ctx);
  for(const value of ['T01027','Dock T36260','load 30','none','0',''])assert.equal(ctx.normalizeDockViewDockKey(value),'Unassigned');
  for(const value of ['38','Dock 38','38.0','038'])assert.equal(ctx.normalizeDockViewDockKey(value),'38');
  const load={TRIPNUMBER:'T01027',ITEMCODE:'x'};ctx.normalizeSocDockRowAliases(load);assert.equal(load.DOCK_NUM,'Unassigned');assert.equal(load.TRIPNUMBER,'T01027');
  const misplaced={dock:'T36274'};ctx.normalizeSocDockRowAliases(misplaced);assert.equal(misplaced.DOCK_NUM,'Unassigned');assert.equal(misplaced.TRIPNUMBER,'T36274');
  const active={unique_id:'active',suspend_to:'dc',dock:'Dock 38',SUSPEND:'SUSPEND',date_completed:'2026-11-04T12:00:00Z'};
  assert.equal(ctx.isDockSuspendDcRequestSource(active),true);assert.equal(ctx.getSuspendTagRequestItems([active]).length,1);
  assert.equal(ctx.isDockSuspendDcRequestSource({...active,SUSPEND:'SUSPENDED'}),true);
  assert.equal(ctx.isDockSuspendDcRequestSource({...active,suspend_completed:true}),false);
  assert.equal(ctx.isDockSuspendDcRequestSource({...active,suspend_candidate_state:'replaced'}),false);
  assert.equal(ctx.isDockSuspendDcRequestSource({...active,dock:'T01027'}),false);
  vm.runInNewContext(fn(flow,'queueAccessScope')+'\n'+fn(flow,'getAssignedQueueOwner')+'\n'+fn(flow,'resolveSuspendOwner')+'\n'+fn(flow,'resolveExactSuspendOwner'),ctx);
  ctx.GncUserAccessControl={resolveUserAccessMatrix:()=>({view_all_suspend:'Y',suspend_default_scope:'OWN'})};
  assert.equal(ctx.queueAccessScope('suspend-tag').initial,'dylan_collyge');
  ctx.GncUserAccessControl={resolveUserAccessMatrix:()=>({view_all_suspend:'N'})};
  assert.equal(ctx.queueAccessScope('suspend-tag').all,false);assert.equal(ctx.queueAccessScope('suspend-tag').initial,'dylan_collyge');
  const index={exact:new Map([['abc','megan_kelly']]),family:new Map()};ctx.getCardEvalOwnerIndex=()=>index;
  assert.equal(ctx.getAssignedQueueOwner({ITEMCODE:'abc.'},index),'megan_kelly');
  assert.equal(ctx.getAssignedQueueOwner({ITEMCODE:'unknown'},index),'Unassigned');
 }
}
