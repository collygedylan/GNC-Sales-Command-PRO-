import { isDockSuspendDcRequestSource } from './dock-order-domain.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { extractGoldenFunction as fn } from './golden-function-extractor.mjs';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export function assertSuspendRoutingAndDefaults(){
 for(const prefix of ['']){
  const source=read(prefix+'assets/row-workflow-functions.js');
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
  assert.ok(!isDockSuspendDcRequestSource.toString().includes("!== 'dc'"));
 }
}
