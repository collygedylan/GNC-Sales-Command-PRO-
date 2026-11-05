import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseExpressionAt} from 'acorn';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const fn=(s,n)=>{const at=s.indexOf('function '+n+'(');const a=parseExpressionAt(s,at,{ecmaVersion:'latest'});return s.slice(a.start,a.end);};
export function assertSocSuspendMembership() {
 for(const prefix of ['', 'test/']) {
  const source=read(prefix+'assets/app-runtime.js');
  const c={firstNonEmptyValue:(...v)=>v.find(x=>x!==null&&x!==undefined&&x!==''),isDockSuspendDcRequestMirrorRow:()=>true,getQueueCompletionState:()=>({completedSuspendTagKeys:new Set()}),getDockSuspendDcRequestSourceUid:r=>r.unique_id};
  vm.runInNewContext(['normalizeDockViewDockKey','normalizeDockSuspendRequestValue','normalizeDockSuspendToRequestValue','getDockSuspendValue','getDockSuspendToValue','isDockSuspendDcRequestSource','getSuspendTagRequestItems'].map(n=>fn(source,n)).join('\n'),c);
  const dc=Array.from({length:28},(_,i)=>({unique_id:'source-'+i,dock:'Dock 52',suspend:'SUSPEND',suspend_to:'dc',date_completed:'2026-11-04',suspend_candidate_state:i<3?'replaced':null}));
  const other=['ms','av','AV','mk','ba','cr','zg',''].map((to,i)=>({...dc[3],unique_id:'other-'+i,suspend_to:to}));
  const completed=Array.from({length:5},(_,i)=>({...dc[3],unique_id:'closed-'+i,suspend_completed:true,status:'completed'}));
  const result=c.getSuspendTagRequestItems([...dc,...other,...completed]);
  assert.equal(result.length,25);assert.deepEqual(Array.from(result,r=>r.unique_id),dc.slice(3).map(r=>r.unique_id));
  assert.ok(c.isDockSuspendDcRequestSource({...dc[3],suspend_to:undefined,SUSPEND_TO:' DC '}));
  assert.equal(c.isDockSuspendDcRequestSource({...dc[3],dock:'T01234'}),false);
  assert.equal(c.isDockSuspendDcRequestSource({...dc[3],suspend:''}),false);
  assert.ok(source.includes('hydrateDockSourceRows(suspendTagSource).filter(isDockSuspendDcRequestSource)'));
 }
}
test('Suspend queue follows workbook dc routing and explicit lifecycle',assertSocSuspendMembership);
test('Suspend membership migration preserves invoker security and existing data',async()=>{
 const name='20261105180000_soc_suspend_source_membership.sql',sql=read('supabase/migrations/'+name);
 const {releaseDatabaseMigrations,migrationContractQuery}=await import('../scripts/apply-item-low-stock-migration.mjs');
 assert.ok(migrationContractQuery('20261103153000_all_active_suspend_destinations.sql').includes(') workbook_suspend'),'legacy destination migration must recognize the reviewed replacement');
 assert.ok(releaseDatabaseMigrations.includes(name));assert.ok(migrationContractQuery(name).includes('as installed'));
 assert.ok(sql.includes('security_invoker=true'));assert.ok(!/DELETE FROM|UPDATE public|DROP VIEW|GRANT /.test(sql));
});
