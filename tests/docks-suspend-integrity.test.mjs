import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {parseExpressionAt} from 'acorn';
export function assertDocksSuspendIntegrity(){
 for(const prefix of ['', 'test/']){
  const read=p=>fs.readFileSync(new URL('../'+prefix+p,import.meta.url),'utf8');
  const workflow=read('assets/row-workflow-functions.js'),runtime=read('assets/app-runtime.js');
  const extract=(source,name)=>{let at=source.indexOf('function '+name+'(');if(at<0)throw Error(name);if(source.slice(at-6,at)==='async ')at-=6;const n=parseExpressionAt(source,at,{ecmaVersion:'latest'});return source.slice(n.start,n.end);};
  const ctx={};vm.runInNewContext(read('assets/queue-inventory-hydration.js'),ctx);
  const q=ctx.AgMetricQueueInventory;
  const one={UNIQUE_ID:'one',ITEMCODE:'003085.030.1',LOCATIONCODE:'C.08.000',LOTCODE:'27.F1',SEASON:'F1',PRIORITY:'1',PHOTO_LINK:'photo-one',SPEC:'spec-one',AV_NOTE:'whole note',LOC_MATCH_QTY:112};
  const two={...one,UNIQUE_ID:'two',PRIORITY:'2',PHOTO_LINK:'',SPEC:'spec-two'};
  const source={SOURCE_TABLE:'ph_soc_master',ITEMCODE:'003085.030.',LOCATIONCODE:'C.08.000',LOTCODE:'27.F1',PRI:'-'};
  Object.assign(ctx,{window:{AgMetricQueueInventory:q},fullInventory:[two,one],masterInventoryById:new Map([['one',one],['two',two]]),
   masterInventoryByNormalizedItemLocation:new Map(),suspendTagItemHydration:new Map(),isRequestOwnedPhotoRow:()=>false,isDockSuspendDcRequestMirrorRow:()=>false,
   getRequestItemCodeOptionItemCode:r=>r.ITEMCODE,getInventoryCardItemLocationKey:()=>'',isFalseBlockLocation:l=>l==='0.00.111',
   getSupabaseReadIdentityScope:()=>'scope',getManagerAssignedColumnState:()=>({}),getQueueDisplayPhotoUrls:r=>r.PHOTO_LINK?[r.PHOTO_LINK]:[]});
  vm.runInNewContext(extract(workflow,'getQueueDisplayEvidenceRow'),ctx);
  assert.equal(ctx.getQueueDisplayEvidenceRow(source).UNIQUE_ID,'one');
  assert.equal(ctx.getQueueDisplayEvidenceRow({...source,PRI:'2'}).UNIQUE_ID,'two');
  assert.equal(ctx.getQueueDisplayEvidenceRow({...source,MASTER_ID:'two'}).UNIQUE_ID,'two');
  assert.equal(ctx.getQueueDisplayEvidenceRow({...source,SEASON:'S1'}),null);
  assert.equal(ctx.getQueueDisplayEvidenceRow({...source,LOCATIONCODE:'D.20.000'}),null);
  assert.equal(ctx.getQueueDisplayEvidenceRow({...source,SOURCE_TABLE:'ph_master_inventory'}),null);
  assert.equal(q.createIndex([one,two]).resolve({...q.identity(one),priority:''}).row,null);
  Object.assign(ctx,{firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!==''),getPhysicalSuspendTagKey:r=>r.unique_id});
  vm.runInNewContext(['normalizeDockViewDockKey','normalizeDockViewStopKey'].map(n=>extract(runtime,n)).join('\n')+'\n'+['getDockOrderBusinessKey','uniquePhysicalSuspendTags'].map(n=>extract(workflow,n)).join('\n'),ctx);
  assert.equal(ctx.normalizeDockViewDockKey('Dock 38.0'),'38');assert.equal(ctx.normalizeDockViewDockKey('39'),'39');
  const a={unique_id:'a',dock:'Dock 36',stopnumber:'30',itemcode:'003085.030.',locationcode:' C.08.000 ',consigneename:'Customer',quantityordered:'10'};
  const b={...a,unique_id:'b',dock:'36',itemcode:'003085.030',quantityordered:'10.0'};
  assert.equal(ctx.getDockOrderBusinessKey(a),ctx.getDockOrderBusinessKey(b));
  assert.equal(ctx.uniquePhysicalSuspendTags([a,b,{...a,unique_id:'c',status:'completed'}]).length,1);
  const soc=[{UNIQUE_ID:'a',LOCATIONCODE:'old'}],raw=[{...soc[0]}],tags=[{...soc[0]}],tagRaw=[{...soc[0]}];
  Object.assign(ctx,{socInventory:soc,socRawSourceRows:raw,suspendTagInventory:tags,suspendTagRawSourceRows:tagRaw,
   upsertRealtimeRow:(rows,r)=>{const i=rows.findIndex(x=>(x.UNIQUE_ID||x.unique_id)===(r.UNIQUE_ID||r.unique_id));if(i<0)rows.push(r);else Object.assign(rows[i],r);},
   refreshRealtimeDetailLookupIndexes:()=>{},invalidateDockSuspendDcSourceRowLookup:()=>{},invalidateResolvedViewStateCaches:()=>{},
   markViewDirty:()=>{},isViewVisible:()=>false,scheduleDocksRender:()=>{},refreshLocalDockSuspendDcRequestState:()=>{}});
  vm.runInNewContext(extract(runtime,'applySuspendCandidateRows'),ctx);
  ctx.applySuspendCandidateRows([{unique_id:'a',locationcode:'D.20.000'}]);
  for(const rows of [soc,raw,tags,tagRaw])assert.equal(rows[0].LOCATIONCODE,'D.20.000');
  ctx.applySuspendCandidateRows([{unique_id:'a',date_completed:'2026-11-05T12:00:00Z',suspend:null}],{close:true});
  assert.equal(tags.length,0);assert.equal(tagRaw.length,0);assert.equal(soc[0].suspend_completed,true);
  const codes=[];
  Object.assign(ctx,{state:{getDocksSuspendAudit:()=>({duplicates:1,resurrected:1,mismatches:1,duplicateCards:0,hierarchyMismatch:false})},reportHandledRuntimeIssue:(scope,code)=>codes.push([scope,code])});
  vm.runInNewContext(extract(read('assets/runtime-watchdog.js'),'docks_suspend_sync_guard'),ctx);
  ctx.docks_suspend_sync_guard();assert.equal(codes.length,3);assert.ok(codes.every(([scope])=>scope==='docks_suspend_sync_guard'));
 }
}
test('Docks and Suspend share exact display evidence, deduplication and receipts',assertDocksSuspendIntegrity);
