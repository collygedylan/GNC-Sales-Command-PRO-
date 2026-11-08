import { normalizeDockViewDockKey, normalizeDockSuspendRequestValue, getDockSuspendValue, isDockSuspendDcRequestSource } from './dock-order-domain.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { extractGoldenFunction as fn } from './golden-function-extractor.mjs';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export function assertSocSuspendMembership() {
 for(const prefix of ['']) {
  const source=read(prefix+'assets/app-runtime.js');
  const c={normalizeDockViewDockKey, normalizeDockSuspendRequestValue, getDockSuspendValue, isDockSuspendDcRequestSource, firstNonEmptyValue:(...v)=>v.find(x=>x!==null&&x!==undefined&&x!==''),isDockSuspendDcRequestMirrorRow:()=>true,getQueueCompletionState:()=>({completedSuspendTagKeys:new Set()}),getDockSuspendDcRequestSourceUid:r=>r.unique_id};
  vm.runInNewContext(['normalizeDockSuspendToRequestValue','getDockSuspendToValue','getSuspendTagRequestItems'].map(n=>fn(source,n)).join('\n'),c);
  const dc=Array.from({length:28},(_,i)=>({unique_id:'source-'+i,dock:'Dock 52',suspend:'SUSPEND',suspend_to:'dc',date_completed:'2026-11-04',suspend_candidate_state:i<3?'replaced':null}));
  const other=['ms','av','AV','mk','ba','cr','zg',''].map((to,i)=>({...dc[3],unique_id:'other-'+i,suspend_to:to}));
  const completed=Array.from({length:5},(_,i)=>({...dc[3],unique_id:'closed-'+i,suspend_completed:true,status:'completed'}));
  const result=c.getSuspendTagRequestItems([...dc,...other,...completed]);
  assert.equal(result.length,25+other.length);assert.deepEqual(Array.from(result,r=>r.unique_id),[...dc.slice(3),...other].map(r=>r.unique_id));
  assert.ok(c.isDockSuspendDcRequestSource({...dc[3],suspend_to:undefined,SUSPEND_TO:' DC '}));
  assert.equal(c.isDockSuspendDcRequestSource({...dc[3],dock:'T01234'}),false);
  assert.equal(c.isDockSuspendDcRequestSource({...dc[3],suspend:''}),false);
  assert.ok(source.includes('hydrateDockSourceRows(suspendTagSource).filter(isDockSuspendDcRequestSource)'));
 }
}
