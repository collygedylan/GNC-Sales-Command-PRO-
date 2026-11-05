import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseExpressionAt} from 'acorn';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const fn=(s,n)=>{const at=s.indexOf('function '+n+'(');const a=parseExpressionAt(s,at,{ecmaVersion:'latest'});return s.slice(a.start,a.end);};
export function assertSuspendRoutingAndDefaults(){
 for(const prefix of ['', 'test/']){
  const source=read(prefix+'assets/row-workflow-functions.js'),runtime=read(prefix+'assets/app-runtime.js');
  const state={}, index={exact:new Map([['111111.030.1','other_eval'],['222222.030.1','no_tags']]),family:new Map()};
  const c={currentUser:'dylan_collyge',activeReqTab:'suspend-tag',normalizeEvalAssignableUser:v=>String(v||'').trim().toLowerCase(),buildManagerEvalAssignmentKey:v=>String(v||''),getManagerAssignedColumnState:()=>state,getCardEvalOwnerIndex:()=>index,isDockSuspendDcRequestMirrorRow:r=>r?.DOCK_SUSPEND_DC_REQUEST===true,isDockSuspendDcRequestSource:r=>r?.suspend==='SUSPEND',getDockSuspendToValue:r=>String(r.suspend_to||r.SUSPEND_TO||'').trim().toLowerCase(),escapeHtml:v=>String(v),firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!==''),markViewDirty:()=>{},renderRequest:()=>{},paintFooterRequestBadgeOnly:()=>{}};
  vm.runInNewContext(['resolveSuspendOwner','getAssignedQueueOwner','queueAccessScope','getQueueScopeFilter','getSuspendEvalUserFilter','buildSuspendEvalUserFilter','setSuspendEvalUserFilter'].map(n=>fn(source,n)).join('\n'),c);
  const row=to=>({unique_id:to,itemcode:'111111.030.1',suspend:'SUSPEND',suspend_to:to});
  assert.equal(c.resolveSuspendOwner(row('dc')),'dylan_collyge');
  for(const to of ['ms','mk',' MS '])assert.equal(c.resolveSuspendOwner(row(to)),'megan_kelly');
  assert.equal(c.resolveSuspendOwner(row('av')),'other_eval');
  assert.equal(c.resolveSuspendOwner({...row('unknown'),itemcode:'missing'}),'Unassigned');
  assert.equal(c.getAssignedQueueOwner(row('ms')),'megan_kelly');
  assert.equal(c.getAssignedQueueOwner(row('third_eval')),'third_eval');
  for(const [user,initial] of [['dylan_collyge','dylan_collyge'],['megan_kelly','megan_kelly'],['jd_jones','ALL'],['other_eval','other_eval']]){c.currentUser=user;assert.equal(c.getSuspendEvalUserFilter(),initial);}
  c.currentUser='megan_kelly';assert.equal(c.getSuspendEvalUserFilter(),'megan_kelly');
  const rows=[row('dc'),...Array.from({length:24},()=>row('ms')),...Array.from({length:3},()=>row('mk')),row('av')];
  const html=c.buildSuspendEvalUserFilter(rows);assert.ok(html.includes('megan_kelly (27)'));assert.ok(html.includes('All Users (29)'));assert.ok(html.includes('other_eval (1)'));assert.ok(!html.includes('no_tags'));assert.ok(c.buildSuspendEvalUserFilter(rows,'request-eval-user-filter').includes('no_tags (0)'));
  c.setSuspendEvalUserFilter('ALL');assert.equal(c.getSuspendEvalUserFilter(),'ALL');c.setSuspendEvalUserFilter('dylan_collyge');assert.equal(c.getSuspendEvalUserFilter(),'dylan_collyge');
  c.GncUserAccessControl={resolveUserAccessMatrix:()=>({view_all_suspend:'N'})};assert.equal(c.queueAccessScope().all,false);assert.equal(c.getSuspendEvalUserFilter(),'megan_kelly');
  assert.ok(!fn(runtime,'isDockSuspendDcRequestSource').includes("!== 'dc'"));
 }
}
test('Workbook routes own evaluator assignment and per-user dropdown defaults',assertSuspendRoutingAndDefaults);
test('SOC cleanup preserves app work and exact Complete Tag tombstones',async()=>{
 const name='20261105190000_suspend_all_routes_and_saved_work.sql',sql=read('supabase/migrations/'+name);
 const {releaseDatabaseMigrations,migrationContractQuery}=await import('../scripts/apply-item-low-stock-migration.mjs');
 assert.ok(releaseDatabaseMigrations.includes(name));assert.ok(migrationContractQuery(name).includes('as installed'));
 assert.ok(sql.includes('and not private.soc_tag_has_saved_work_v23188(to_jsonb(target))'));
 assert.ok(sql.includes("h.event_key='suspend-tag-complete:'||new.unique_id"));
 assert.ok(sql.includes("new.suspend_completed:=true"));
 assert.ok(!sql.includes('where source_uid=new.unique_id or business_key='));
 assert.ok(sql.includes("WHEN 'ms' THEN 'megan_kelly' WHEN 'mk' THEN 'megan_kelly'"));
 assert.ok(!sql.includes("families.owner, 'dylan_collyge'"));
 assert.ok(!/DELETE FROM public.ph_master_inventory|UPDATE public.ph_master_inventory|GRANT /i.test(sql));
});
