import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {readComposedRuntimeSource} from '../../scripts/composed-app-source.mjs';
import {contracts} from '../../services/database-contracts.generated.ts';
import {matchesSchema} from '../../services/database-contract-runtime.ts';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8'),source=readComposedRuntimeSource();
function fn(name){const start=source.search(new RegExp('(?:async )?function '+name+'\\('));assert.ok(start>=0,name);const indent=source.slice(source.lastIndexOf('\n',start)+1,start),end=source.indexOf('\n'+indent+'}',start);assert.ok(end>start,name);return source.slice(start,end+indent.length+2);}
export async function assignmentFallbackContract(){
 const state={filters:{},viewModule:Promise.reject(Error('offline'))},host={isConnected:true,dataset:{},innerHTML:''};
 const c=vm.createContext({getManagerAssignedColumnState:()=>state,canViewAssignedItemsExport:()=>true,getManagerAssignedItemsDisplayRows:()=>[{ITEMCODE:'A'}],getFilteredManagerAssignedItemsExportRows:r=>r,isDatasetLoaded:()=>true,destroyManagerAssignedItemsView:()=>{},document:{getElementById:()=>({})},getManagerAssignedItemsViewProps:()=>({rows:[{ITEMCODE:'A'}]}),renderManagerAssignedFallbackRows:r=>'<table>'+r.map(x=>x.ITEMCODE).join('')+'</table>',updateManagerAssignedItemsView:()=>{},normalizeEvalAssignableUser:v=>String(v||'').toLowerCase(),scheduleManagersRender:()=>{}});
 vm.runInContext(fn('mountManagerAssignedItemsView')+';'+fn('getManagerAssignedColumnValue')+';'+fn('setManagerAssignedPlantGroupFilter'),c);
 await c.mountManagerAssignedItemsView(host,[{ITEMCODE:'A'}],1);assert.match(host.innerHTML,/<table>A/);assert.equal(host.dataset.logicalRowCount,'1');assert.equal(typeof state.view.update,'function');
 c.setManagerAssignedPlantGroupFilter('140 GRASS');assert.equal(state.filters.PLANTGROUPCODE[0],c.getManagerAssignedColumnValue({PLANTGROUPCODE:'140_GRASS'},'PLANTGROUPCODE'));
 const calls=[];Object.assign(c,{getManagerAssignedSelectionSnapshot:()=>({selectedRows:[{ITEMCODE:'A'},{ITEMCODE:'B'}]}),buildManagerEvalAssignmentKey:v=>String(v).toUpperCase(),assignEvalItemcodes:(codes,owner)=>calls.push({codes:[...codes],owner})});
 vm.runInContext(fn('assignManagerCheckedItemcodes'),c);c.assignManagerCheckedItemcodes('A','jd_jones');c.assignManagerCheckedItemcodes('C','jd_jones');assert.deepEqual(calls.map(x=>x.codes),[['A','B'],['C']]);
}
export function rosterParityContract(){
 const ctx={exports:{}};vm.runInNewContext(ts.transpileModule(read('supabase/functions/_shared/user-access-matrix.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,ctx);
 const rows=ctx.exports.mergeAccessRosterDirectory([{username:'nally_aguilar',id:'id-1',active:true,role:'Admin',permission_overrides:{can_submit_reclass:false}}],[{username:'nelly_aguilar',role:'ADMIN'},{username:'chris_fisher',role:'EVAL'}]);
 assert.equal(rows.length,2);assert.equal(rows[0].id,'id-1');assert.equal(rows[0].role,'ADMIN');assert.equal(rows[0].permission_overrides.can_submit_reclass,false);assert.equal(rows[1].active,false);assert.equal(rows[1].id,'');
 const c=vm.createContext({});vm.runInContext(read('assets/user-access-control.js'),c);for(const [a,b] of [['EVAL','evaluator'],['REP','sales-rep'],['ADMIN','admin'],['QC Supervisor','qc_supervisor'],['data entry supervisor','supervisor']])assert.equal(c.GncUserAccessControl.normalizeRole(a),c.GncUserAccessControl.normalizeRole(b));
}
export function requestSchemaContract(){
 const schema=contracts.tables.ph_requests_pending.row,field=schema.object.submitted_by;assert.ok(field);assert.equal(matchesSchema(field.schema,'dylan_collyge'),true);assert.equal(matchesSchema(field.schema,null),true);assert.equal(matchesSchema(field.schema,{}),false);assert.equal(matchesSchema({object:{submitted_by:field}},{submitted_by:'dylan_collyge',access_code:'secret'}),false);
}
export function avCardDetailContract(){
 const calls=[],c=vm.createContext({beginDirectNavigationActivity:()=>{},beginInternalPerfMeasure:()=>0,pendingDetailTapStartedAt:0,openDetail:(...v)=>calls.push(v),findItemByUniqueId:()=>({}),openAvGallery:()=>{throw Error('AV card body must open Item Detail')}});vm.runInContext(fn('handleCardClick'),c);c.handleCardClick('fi_1','row-1','av');assert.equal(calls[0][0],'row-1');assert.equal(calls[0][1],'av');
 assert.doesNotMatch(fn('processAndLoadData'),/masterState.liveVerifiedScope === currentScope/);
}

export function avDisplayContinuityContract(){
 const raw=[{unique_id:'first'}];Object.defineProperty(raw,'readMeta',{value:{rowCompleteness:'complete',total:1}});
 const payload=vm.createContext({DATASET_DEFINITIONS:{master:{sourceTable:'ph_master_inventory'}},formatFetchedRows:r=>r.map(v=>({...v}))});vm.runInContext(fn('buildDatasetPayload'),payload);assert.equal(payload.buildDatasetPayload('master',raw).data.readMeta,raw.readMeta,'row formatting retains server pagination proof');
 const rows=[{UNIQUE_ID:'row-1'}],context={visible:true,progressive:false,view:'av',dataPermissionVersion:'refreshed'};
 const c=vm.createContext({fullInventory:rows,productionDisplayMasterReceipt:{rows,readScope:'account-a',permission:'previous'},getSupabaseReadIdentityScope:()=> 'account-a'});
 vm.runInContext(fn('hasProgressiveViewDataForContext'),c);
 assert.equal(c.hasProgressiveViewDataForContext(context),true,'background permission refresh retains this account display');
 assert.equal(c.hasProgressiveViewDataForContext({...context,accessDeniedConfirmed:true}),false);
 c.productionDisplayMasterReceipt.readScope='account-b';assert.equal(c.hasProgressiveViewDataForContext(context),false);
 assert.match(source,/if \(completeMasterDisplay\) \{/);
 assert.doesNotMatch(source,/if \(completeMasterDisplay && hasCompletePreview\)/);
 const nav=vm.createContext({fullInventory:rows,isDatasetLoaded:()=>true});vm.runInContext(fn('shouldRenderViewSynchronouslyOnSwitch'),nav);assert.equal(nav.shouldRenderViewSynchronouslyOnSwitch('av'),true);
}

export function avPreparationAndAuraProbeContract(){
 const identity={key:'current',scope:'actor-a',sourceKey:'r1',signature:'actor-a:current:r1'},rows=[{COMMONNAME:'Oak'},{COMMONNAME:'Big Hit'}];let term='Oak',prepares=0;
 const c=vm.createContext({window:{AgMetricAvDerivedRows:{peek:()=>null,prepare:()=>{prepares++;return new Promise(()=>{});}}},getAvSearchTerm:()=>term,filterBySearch:(r,t)=>r.filter(v=>v.COMMONNAME===t),normalizeAvSalesBucket:v=>v,getAvSalesDerivationIdentity:()=>identity,AV_DERIVED_ROWS_CHUNK_SIZE:512,AV_DERIVED_PREVIEW_SOURCE_LIMIT:200,createAvSalesRowsDerivation:()=>({sourceRows:rows,mapRow:r=>r,finalize:r=>r}),avDerivedRowsActiveScope:'',avDerivedRowsPendingSignature:'',avDerivedPreviewCache:null});
 vm.runInContext(fn('getAvSalesRowsForRendering'),c);assert.equal(c.getAvSalesRowsForRendering('current').rows[0].COMMONNAME,'Oak');term='Big Hit';assert.equal(c.getAvSalesRowsForRendering('current').rows[0].COMMONNAME,'Big Hit');assert.equal(prepares,1,'typing reuses the same bounded full preparation');
 let allowed='N';const a=vm.createContext({nativeAuthSessionActive:true,nativeAuthProfile:{id:'actor',username:'nelly_aguilar',role:'ADMIN'},currentUser:'nelly_aguilar',window:{GncUserAccessControl:{getSelfState:()=>({denied:false}),resolveUserAccessMatrix:()=>({use_aura_assistant:allowed})}}});vm.runInContext(fn('isAuraRouterProfileCandidate'),a);assert.equal(a.isAuraRouterProfileCandidate(),false);allowed='Y';assert.equal(a.isAuraRouterProfileCandidate(),true,'authorized per-account rollout remains available');
}
