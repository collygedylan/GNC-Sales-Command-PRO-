import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseExpressionAt} from 'acorn';
export async function assertExactRowEvaluationContract(){
 for(const prefix of ['']){
  const ctx={};vm.runInNewContext(fs.readFileSync(new URL('../../'+prefix+'assets/queue-inventory-hydration.js',import.meta.url),'utf8'),ctx);
  const q=ctx.AgMetricQueueInventory;
  const one={UNIQUE_ID:'one',ITEMCODE:'001234.030.1',LOCATIONCODE:'J.03.000',LOTCODE:'27.F1',SEASON:'F1',SALEYEAR:'2027',PRIORITY:'1',PTRONHAND:100,PTRAVAILABLE:40,PTRREVIEWED:60,S_LTS:50};
  const sibling={...one,UNIQUE_ID:'ten',PRIORITY:'10',PTRONHAND:500,PTRAVAILABLE:400};
  const idx=q.createIndex([one,sibling]);
  const input={itemCode:one.ITEMCODE+'.',locationCode:one.LOCATIONCODE,lotCode:one.LOTCODE,season:'F1',salesYear:'27',priority:'1'};
  assert.equal(idx.resolve(input).row.UNIQUE_ID,'one');
  assert.equal(idx.resolve({...input,priority:''}).row,null);
  assert.equal(idx.resolve({...input,season:'S1'}).row,null);
  assert.equal(idx.resolve({...input,masterUid:'missing'}).row,null);
  assert.equal(idx.resolveSuspendTagDisplay({...input,lotCode:'28.F1'}).row,null);
  const display=idx.resolveSuspendTagDisplay(input).row;
  assert.equal(display.PTRONHAND,100);assert.equal(display.PTRAVAILABLE,40);assert.equal(display.LOC_ON_HAND,600);
  const source=fs.readFileSync(new URL('../../'+prefix+'assets/row-workflow-functions.js',import.meta.url),'utf8');
  const extract=name=>{let at=source.indexOf('function '+name+'(');if(source.slice(at-6,at)==='async ')at-=6;const n=parseExpressionAt(source,at,{ecmaVersion:'latest'});return source.slice(n.start,n.end);};
  let saves=0;const c={beginRowEvaluationMemoryPublication:()=>()=>{},parseAppNumber:v=>v===''?null:Number(v),firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!==''),findLinkedMasterRow:()=>one,
   masterInventoryById:new Map([['one',one]]),getSupabaseReadIdentityScope:()=>'scope',saveSecureDriveEvidence:async(...args)=>{saves++;assert.equal(args[0].UNIQUE_ID,'one');assert.equal(args[3],true);return {row:args[0]};},reconcileConfirmedDriveEvidence:r=>r};
  vm.runInNewContext(extract('getEditorLocMatchQtyValue')+'\n'+extract('publishRowEvaluationToMasterAndNotes'),c);
  assert.equal(c.getEditorLocMatchQtyValue(one,50),50);
  assert.equal(c.getEditorLocMatchQtyValue(one,0),0);
  await c.publishRowEvaluationToMasterAndNotes('one',{match:50});assert.equal(saves,1);
  Object.assign(c,{findDockSuspendDcRequestSourceRow:()=>one,getSuspendTagInventoryIdentity:()=>input,matchesSuspendTagInventoryIdentity:(r,i)=>q.matches(r,i),getDockSuspendCompletionRevision:()=>'revision',runSuspendTagRowCommand:async(...args)=>{assert.equal(args[0],'save');assert.equal(args[4].inventoryMasterUid,'one');assert.equal(args[4].requireInventoryReceipt,true);return true;}});
  assert.equal(await c.publishRowEvaluationToMasterAndNotes(one,{match:50}),true);
  await assert.rejects(c.publishRowEvaluationToMasterAndNotes(one,null,{prefix:'req-',receipt:{row:sibling}}),/IDENTITY_MISMATCH/);
 }
}
