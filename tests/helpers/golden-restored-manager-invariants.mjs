import assert from 'node:assert/strict';
import vm from 'node:vm';
import {read, functionSource, runFunctions} from './golden-test-environment.mjs';
import {readNurseryControllerSource} from './nursery-controller-source.mjs';

export function invariant312() {
 const ctx=vm.createContext({});
 vm.runInContext(read('assets/access-matrix-policy.js')+'\n'+read('assets/user-access-control.js'),ctx);
 const access=ctx.GncUserAccessControl;
 access.setAccessMatrixRows([{username:'dylan_collyge',role:'super-admin'}]);
 assert.equal(access.resolveUserAccessMatrix('dylan_collyge').view_nursery_command_tables,'Y');
 assert.equal(access.resolveUserAccessMatrix('megan_kelly','ADMIN').view_nursery_command_tables,'N');
 access.setAccessMatrixRows([{username:'megan_kelly',role:'Admin',view_permissions:{view_nursery_command_tables:'N'}}]);
 assert.equal(access.resolveUserAccessMatrix('megan_kelly').view_nursery_command_tables,'N');
}

export function invariant327() {
 const c=runFunctions('assets/app-runtime.js',['getManagerTableManagementKey','getManagerTableManagementLegacyTab'],{});
 for(const [route,key] of Object.entries({'assigned-items-export':'assigned-items','customer-rep-map':'customer-assignments','access-control':'user-role-access','item-inquiry-coverage':'inquiry-coverage','av-blanks-photo-bypass':'av-note-users','season-settings':'season'}))assert.equal(c.getManagerTableManagementKey(route),key);
 assert.equal(c.getManagerTableManagementLegacyTab('assigned-items'),'assigned-items-export');assert.equal(c.getManagerTableManagementLegacyTab('user-role-access'),'access-control');assert.equal(c.getManagerTableManagementKey('orders'),'');
 assert.match(functionSource('assets/app-runtime.js','renderManagerModulePicker'),/filter\(option => !getManagerTableManagementKey\(option.id\)\)/);
 const renderOwner = 'assets/manager-module-render.js';
 assert.match(functionSource(renderOwner,'keepManagerModuleSurface'),/getManagerTableManagementKey\(activeHomeTab\)\) && activeHomeTab !== MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW && ensureViewDataForRender/);
 const auth=runFunctions('assets/app-runtime.js',['canManageCustomerRepMappings'],{canAccessView:()=>true,isFullAppAdministrator:()=>true,normalizeRoleAccessToken:String,currentRole:'SUPER_ADMIN'});assert.equal(auth.canManageCustomerRepMappings(),true);auth.canAccessView=()=>false;assert.equal(auth.canManageCustomerRepMappings(),false);
 const season=runFunctions('assets/app-runtime.js',['canViewManagerSeasonPriority'],{canAccessView:()=>true,isFullAppAdministrator:()=>true,normalizeRoleAccessToken:String,currentRole:'SUPER_ADMIN',getAuditedAppPermission:()=>({allowed:true})});assert.equal(season.canViewManagerSeasonPriority(),true);season.getAuditedAppPermission=()=>({allowed:false});assert.equal(season.canViewManagerSeasonPriority(),false);
}

export async function invariant330() {
 const {JSDOM}=await import('jsdom');const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only'});let calls=0;
 dom.window.GncNurseryModel={TABLES:[{id:'water-rating',label:'Water_Rating',relation:'water'}],FIELDS:{water:['id']},DECISIONS:[],compile(){calls++;throw Error('Reference view must not compile plans');}};
 dom.window.eval(readNurseryControllerSource());
 const table=dom.window.GncNurseryTables.mount(dom.window.document.getElementById('root'),{identity:'verified-account',selected:'water-rating',inventory:()=>[],authorized:()=>true,request:async()=>({rows:[{id:'row-1'}]})});
 try{await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);assert.equal(dom.window.document.querySelectorAll('tbody tr').length,1);assert.match(dom.window.document.querySelector('h2').textContent,/Water_Rating/);}finally{table.destroy();dom.window.close();}
}

export function invariant332() {
 const nursery={};vm.runInNewContext(read('assets/nursery-command-model.js'),{window:nursery});
 const c=runFunctions('assets/app-runtime.js',['getManagerTableManagementItems','renderManagerTableManagementWorkspace'],{GncNurseryModel:nursery.GncNurseryModel,getManagersToolAccess:()=>({canViewAssignedItemsExport:true,canManageCustomerRepMappings:true,canManageAccessControl:true,canManageAvBlanksPhotoBypass:true,canManageSeasonSettings:true,canViewSeasonPriority:true,canViewCropRoll:true,canViewProductionSchedule:true,canViewTableManagement:true}),canViewNurseryCommandTables:()=>true,canUseHistoricalRequests:()=>true,canOpenPhotoHistory:()=>true,esc:String});
 const html=c.renderManagerTableManagementWorkspace('OLD_EDITOR','');assert.equal((html.match(/data-manager-table-card=/g)||[]).length,18);assert.equal((html.match(/PROD SCHEDULE 102726/g)||[]).length,1);assert.doesNotMatch(html,/OLD_EDITOR|table-management-pills|Maintained nursery reference data/);
 for(const key of ['company-directory','assigned-items','user-role-access','president-command-center']){const table=c.renderManagerTableManagementWorkspace('FULL_EDITOR',key);assert.match(table,/data-table-all/);assert.match(table,/data-table-switch/);assert.match(table,/data-table-workspace>FULL_EDITOR/);assert.doesNotMatch(table,/data-table-directory>|data-manager-table-card=/);}
}
