import { isDockSuspendDcRequestSource } from './dock-order-domain.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { extractGoldenFunction as fn } from './golden-function-extractor.mjs';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export function assertSuspendRoutingAndDefaults(){
 for(const prefix of ['']){
  const source=['row-workflow-functions','suspend-exact-owner','request-queue-membership','row-access-policy']
    .map(name=>read(prefix+'assets/'+name+'.js')).join('\n');
  const state={}, index={exact:new Map([['111111.030.1','other_eval'],['222222.030.1','no_tags']]),family:new Map()};
  const c={currentUser:'dylan_collyge',activeReqTab:'suspend-tag',normalizeEvalAssignableUser:v=>String(v||'').trim().toLowerCase(),buildManagerEvalAssignmentKey:v=>String(v||''),getManagerAssignedColumnState:()=>state,getCardEvalOwnerIndex:()=>index,isDockSuspendDcRequestMirrorRow:r=>r?.DOCK_SUSPEND_DC_REQUEST===true,isDockSuspendDcRequestSource:r=>r?.suspend==='SUSPEND',getDockSuspendToValue:r=>String(r.suspend_to||r.SUSPEND_TO||'').trim().toLowerCase(),escapeHtml:v=>String(v),firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!==''),markViewDirty:()=>{},renderRequest:()=>{},paintFooterRequestBadgeOnly:()=>{}};
  const declarations=['resolveSuspendOwner','resolveExactSuspendOwner','getAssignedQueueOwner','queueAccessScope',
    'getQueueScopeFilter','getSuspendEvalUserFilter','buildSuspendEvalUserFilter','setSuspendEvalUserFilter',
    'normalizeSuspendOwnerCode','validSuspendOwner','suspendOwnerFromRow','resolveSuspendOwnerFallback','collectSuspendOwnerCandidates'];
  vm.runInNewContext([source.match(/const GLOBAL_LIVE_CHANGE_USER_KEYS = new Set\(\[[\s\S]*?\]\);/)[0],...declarations.map(n=>fn(source,n))].join('\n'),c);
  const row=to=>({unique_id:to,itemcode:'111111.030.1',suspend:'SUSPEND',suspend_to:to});
  assert.equal(c.resolveSuspendOwner(row('dc')),'other_eval');
  for(const to of ['ms','mk',' MS '])assert.equal(c.resolveSuspendOwner(row(to)),'other_eval');
  assert.equal(c.resolveSuspendOwner(row('av')),'other_eval');
  assert.equal(c.resolveSuspendOwner({...row('unknown'),itemcode:'missing'}),'Unassigned');
  assert.equal(c.getAssignedQueueOwner(row('ms')),'other_eval');
  assert.equal(c.getAssignedQueueOwner(row('third_eval')),'other_eval');
  for(const [user,role,initial] of [['dylan_collyge','ADMIN','dylan_collyge'],['megan_kelly','ADMIN','megan_kelly'],['jd_jones','SUPER-ADMIN','ALL'],['other_eval','EVAL','other_eval']]){c.currentUser=user;c.currentRole=role;assert.equal(c.getSuspendEvalUserFilter(),initial);}
  c.currentUser='megan_kelly';c.currentRole='ADMIN';assert.equal(c.getSuspendEvalUserFilter(),'megan_kelly');
  const rows=[row('dc'),...Array.from({length:24},()=>row('ms')),...Array.from({length:3},()=>row('mk')),row('av')];
  const html=c.buildSuspendEvalUserFilter(rows);assert.ok(html.includes('other_eval (29)'));assert.ok(html.includes('All Users (29)'));assert.ok(!html.includes('megan_kelly (27)'));assert.ok(html.includes('no_tags (0)'));assert.ok(c.buildSuspendEvalUserFilter(rows,'request-eval-user-filter').includes('no_tags (0)'));
  c.setSuspendEvalUserFilter('ALL');assert.equal(c.getSuspendEvalUserFilter(),'ALL');c.setSuspendEvalUserFilter('dylan_collyge');assert.equal(c.getSuspendEvalUserFilter(),'dylan_collyge');
  c.GncUserAccessControl={resolveUserAccessMatrix:()=>({role:'EVAL',view_all_suspend:'Y'})};assert.equal(c.queueAccessScope().all,false);assert.equal(c.getSuspendEvalUserFilter(),'megan_kelly');
  assert.ok(!isDockSuspendDcRequestSource.toString().includes("!== 'dc'"));
 }
}

export function assertSuspendExactOwnerReceipt() {
  const source = read('assets/suspend-exact-owner.js');
  const defaults = new Map([['003085.030.1', { assignedto: 'megan_kelly' }]]);
  const context = vm.createContext({
    getManagerAssignedColumnState: () => ({ itemcodeDefaultOwners: defaults }),
    buildManagerEvalAssignmentKey: value => String(value || '').trim().toUpperCase(),
    normalizeEvalAssignableUser: value => String(value || '').trim().toLowerCase(),
    isDockSuspendDcRequestSource: () => true,
    getCardEvalOwnerIndex: () => ({ exact: new Map(), family: new Map([['003085', 'other_owner']]) }),
  });
  vm.runInContext(source, context);
  const tag = { itemcode: '003085.030.', suspend_to: 'dc', assignedto: 'raw_erp', suspend_eval_owner: 'old_owner' };
  assert.equal(context.resolveSuspendOwner(tag), 'megan_kelly');
  defaults.set('003085.030.1', { assignedto: 'abigail_vazquez' });
  assert.equal(context.resolveSuspendOwner(tag), 'abigail_vazquez');
  defaults.set('003085.030.1', { assignedto: null });
  assert.equal(context.resolveSuspendOwner(tag), 'Unassigned');
  assert.equal(context.resolveSuspendOwner({ itemcode: '003085.050.1', suspend_to: 'dc' }), 'Unassigned');
}
