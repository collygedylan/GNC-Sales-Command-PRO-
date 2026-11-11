import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readComposedRuntimeSource} from '../../scripts/composed-app-source.mjs';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export function requestVisibilityContract(){
 const apiContext=vm.createContext({});vm.runInContext((read('assets/access-matrix-policy.js')+'\n'+read('assets/user-access-control.js')),apiContext);const api=apiContext.GncUserAccessControl;
 for(const name of ['dylan_collyge','nelly_aguilar','nally_aguilar','nelly_aguliar','jd_jones','megan_kelly','morgan_anderson'])assert.equal(api.canViewAllRequests(name),false,name);
 for(const role of ['super-admin','ADMIN','manager','CSR','REP','sales-rep'])assert.equal(api.canViewAllRequests('new_user',role),false,role);
 for (const name of ['kayla_knapp','mitch_kaiser','melissa_dowty']) assert.equal(api.canViewAllRequests(name),false,name);
 for(const name of ['jorge_colunga','bobby_adair','charlie_robertson','abigail_vasquez','christa_fisher','shateqa_robertson','josh_vann'])assert.equal(api.canViewAllRequests(name,'evaluator'),false,name);
 api.setAccessMatrixRows([{username:'test_eval',role:'EVAL',view_all_requests:'N',view_permissions:{view_all_requests:'Y'}}]);assert.equal(api.canViewAllRequests('test_eval'),false);
 const patched=api.patchAccessPermission(api.resolveUserAccessMatrix('test_eval'),'view_all_requests','Y');assert.equal(patched.view_all_requests,'Y');api.setAccessMatrixRows([patched]);assert.equal(api.canViewAllRequests('test_eval'),true);
 api.setAccessMatrixRows([{username:'megan_kelly',role:'admin',view_all_requests:'N'}]);assert.equal(api.canViewAllRequests('megan_kelly'),false,'explicit non-exempt N');
 for(const category of ['all','actions'])assert.ok(api.accessPermissionColumns(category).some(([key,label])=>key==='view_all_requests'&&label==='View All Requests'));
 const source=readComposedRuntimeSource();const fn=name=>{const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);const indent=source.slice(source.lastIndexOf('\n',start)+1,start),end=source.indexOf('\n'+indent+'}',start);return source.slice(start,end+indent.length+2)};
 const rows=[{UNIQUE_ID:'owned',ITEMCODE:'A'},{UNIQUE_ID:'mine',ITEMCODE:'B',submitted_by:'test_eval'},{UNIQUE_ID:'uuid',ITEMCODE:'C',submitted_by:'profile-eval'},{UNIQUE_ID:'other',ITEMCODE:'D',REQUEST_SELECTED_REP_USERNAME:'test_eval'},{UNIQUE_ID:'unassigned',ITEMCODE:'E',ASSIGNEDTO:'test_eval'}];
 const ctx=vm.createContext({window:{GncUserAccessControl:api},currentUser:'test_eval',currentRole:'EVAL',normalizeEvalAssignableUser:v=>v,getManagerAssignedColumnState:()=>({dataEpoch:1}),getCardEvalOwnerIndex:()=>({codesByOwner:new Map([['test_eval',new Set(['A'])]])}),currentUserDisplay:'Test Eval',nativeAuthProfile:{id:'profile-eval'},requestsInventory:rows,getRoleAccessState:()=>({}),getRequestCapabilities:()=>({canViewQueue:true,scope:'global'}),getManagerAssignedItemsDisplayRows:()=>[{ITEMCODE:' a ',effective_worker:'test_eval'},{ITEMCODE:'D',effective_worker:'someone_else'}],isAssignedToCurrentUser:v=>v==='test_eval',doesCurrentUserMatchRequestCreatorValue:v=>v==='test_eval',resolvedViewStateEpoch:1,getDatasetLoadSignature:()=>1,activeReqTab:'pending',safeRole:'EVAL',canCurrentUserViewDockSuspendDcRequests:()=>false,requestScopedItemsCacheKey:'',requestScopedItemsCache:null,incrementInternalPerfCounter:()=>{}});
 vm.runInContext(['canViewAllRequests','getRequestAssignedItemcodeScope','doesCurrentUserOwnCreatedRequestItem','getScopedRequestItems'].map(fn).join('\n'),ctx);
 api.setAccessMatrixRows([{username:'test_eval',role:'EVAL',view_all_requests:'N'}]);assert.deepEqual(Array.from(ctx.getScopedRequestItems(rows),r=>r.UNIQUE_ID),['owned','mine','uuid']);
 api.setAccessMatrixRows([{username:'test_eval',role:'EVAL',view_all_requests:'Y'}]);assert.equal(ctx.getScopedRequestItems(rows).length,5,'toggle invalidates cached scope immediately');
 api.setAccessMatrixRows([{username:'test_eval',role:'EVAL',view_all_requests:'N'}]);assert.equal(ctx.getScopedRequestItems(rows).length,3);ctx.getRequestCapabilities=()=>({canViewQueue:false});ctx.resolvedViewStateEpoch++;assert.equal(ctx.getScopedRequestItems(rows).length,0,'confirmed queue denial stays authoritative');
}
