import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {parseExpressionAt} from 'acorn';
export function assertCurrentSocDockContract(){
 for(const prefix of ['', 'test/']){
  const source=fs.readFileSync(new URL('../'+prefix+'assets/app-runtime.js',import.meta.url),'utf8');
  const flow=fs.readFileSync(new URL('../'+prefix+'assets/row-workflow-functions.js',import.meta.url),'utf8');
  const fn=(src,name)=>{const at=src.indexOf('function '+name+'('),node=parseExpressionAt(src,at,{ecmaVersion:'latest'});return src.slice(at,node.end);};
  const ctx={firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!==''),getDockSuspendValue:r=>String(r.SUSPEND||r.suspend||'').toUpperCase(),
   isDockSuspendDcRequestMirrorRow:()=>true,getQueueCompletionState:()=>({completedSuspendTagKeys:new Set()}),getDockSuspendDcRequestSourceUid:r=>r.unique_id,
   getSuspendTagStatus:r=>r.suspend_tag_status||'pending',getPhysicalSuspendTagKey:r=>r.unique_id,normalizeEvalAssignableUser:v=>String(v||'').toLowerCase(),
   buildManagerEvalAssignmentKey:v=>String(v||'').replace(/[.]+$/,''),getManagerAssignedColumnState:()=>({}),currentUser:'dylan_collyge'};
  vm.runInNewContext(['normalizeDockViewDockKey','isDockSuspendDcRequestSource','getSuspendTagRequestItems','normalizeSocDockRowAliases'].map(n=>fn(source,n)).join('\n'),ctx);
  for(const value of ['T01027','Dock T36260','load 30','none','0',''])assert.equal(ctx.normalizeDockViewDockKey(value),'Unassigned');
  for(const value of ['38','Dock 38','38.0','038'])assert.equal(ctx.normalizeDockViewDockKey(value),'38');
  vm.runInNewContext(fn(source,'normalizeDockViewStopKey'),ctx);
  const load={TRIPNUMBER:'T01027',ITEMCODE:'x'};ctx.normalizeSocDockRowAliases(load);assert.equal(load.DOCK_NUM,'Unassigned');assert.equal(load.TRIPNUMBER,'T01027');
  const misplaced={dock:'T36274'};ctx.normalizeSocDockRowAliases(misplaced);assert.equal(misplaced.DOCK_NUM,'Unassigned');assert.equal(misplaced.TRIPNUMBER,'T36274');
  const active={unique_id:'active',dock:'Dock 38',SUSPEND:'SUSPEND',date_completed:'2026-11-04T12:00:00Z'};
  assert.equal(ctx.isDockSuspendDcRequestSource(active),true);assert.equal(ctx.getSuspendTagRequestItems([active]).length,1);
  assert.equal(ctx.isDockSuspendDcRequestSource({...active,SUSPEND:'SUSPENDED'}),true);
  assert.equal(ctx.isDockSuspendDcRequestSource({...active,suspend_completed:true}),false);
  assert.equal(ctx.isDockSuspendDcRequestSource({...active,suspend_candidate_state:'replaced'}),false);
  assert.equal(ctx.isDockSuspendDcRequestSource({...active,dock:'T01027'}),false);
  vm.runInNewContext(fn(flow,'queueAccessScope')+'\n'+fn(flow,'getAssignedQueueOwner'),ctx);
  ctx.GncUserAccessControl={resolveUserAccessMatrix:()=>({view_all_suspend:'Y',suspend_default_scope:'OWN'})};
  assert.equal(ctx.queueAccessScope('suspend-tag').initial,'ALL');
  ctx.GncUserAccessControl={resolveUserAccessMatrix:()=>({view_all_suspend:'N'})};
  assert.equal(ctx.queueAccessScope('suspend-tag').all,false);assert.equal(ctx.queueAccessScope('suspend-tag').initial,'dylan_collyge');
  const index={exact:new Map([['abc','megan_kelly']]),family:new Map()};
  assert.equal(ctx.getAssignedQueueOwner({ITEMCODE:'abc.'},index),'megan_kelly');
  assert.equal(ctx.getAssignedQueueOwner({ITEMCODE:'unknown'},index),'dylan_collyge');
 }
}
test('Current SOC numeric Dock identity and active evaluated tags remain aligned',assertCurrentSocDockContract);
