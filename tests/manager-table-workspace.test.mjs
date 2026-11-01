import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { readComposedRuntimeSource } from '../scripts/composed-app-source.mjs';

const read = file => fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const source=readComposedRuntimeSource(),tree=ts.createSourceFile('runtime.js',source,ts.ScriptTarget.Latest,true),functions=new Map();
function visit(node){if(ts.isFunctionDeclaration(node)&&node.name)functions.set(node.name.text,node.getText(tree));ts.forEachChild(node,visit);}visit(tree);
const nurseryWindow={};vm.runInNewContext(read('assets/nursery-command-model.js'),{window:nurseryWindow});
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
function context(names,extra={}){const ctx=vm.createContext({GncNurseryModel:nurseryWindow.GncNurseryModel,esc:escape,...extra});vm.runInContext(names.map(n=>functions.get(n)).join('\n'),ctx);return ctx;}
const routeNames=['getManagerTableManagementKey','getManagerTableManagementLegacyTab'];

test('all consolidated route aliases select the exact existing table controller',()=>{
  const ctx=context(routeNames);
  const aliases={'assigned-items-export':'assigned-items','access-control':'user-role-access','customer-rep-map':'customer-assignments','item-inquiry-coverage':'inquiry-coverage','av-blanks-photo-bypass':'av-note-users','season-settings':'season','crop-roll':'crop-roll','production-schedule':'production-schedule'};
  for(const [route,key] of Object.entries(aliases))assert.equal(ctx.getManagerTableManagementKey(route),key);
  assert.equal(ctx.getManagerTableManagementKey('orders'),'');
  assert.equal(ctx.getManagerTableManagementLegacyTab('assigned-items'),'assigned-items-export');
  assert.equal(ctx.getManagerTableManagementLegacyTab('user-role-access'),'access-control');
  assert.equal(ctx.getManagerTableManagementKey('president-command-center'),'president-command-center');
});

test('selector renders authorized Admin and Nursery pills while preserving explicit denial',()=>{
  const access={canViewAssignedItemsExport:true,canManageCustomerRepMappings:true,canManageAccessControl:true,canManageAvBlanksPhotoBypass:true,canManageSeasonSettings:true,canViewSeasonPriority:true,canViewCropRoll:true,canViewProductionSchedule:true};
  let nursery=true;
  const ctx=context(['getManagerTableManagementItems','renderManagerTableManagementWorkspace'],{getManagersToolAccess:()=>access,canViewNurseryCommandTables:()=>nursery,canUseHistoricalRequests:()=>true,canOpenPhotoHistory:()=>true});
  const dom=new JSDOM(ctx.renderManagerTableManagementWorkspace('<div id="full-editor">Full editor</div>','assigned-items'));
  const pills=[...dom.window.document.querySelectorAll('[data-manager-table-pill]')];
  for(const key of ['assigned-items','user-role-access','company-directory','customer-assignments','inquiry-coverage','av-note-users','season','season-priority','crop-roll',...nurseryWindow.GncNurseryModel.TABLES.map(t=>t.id)]){
    const pill=pills.find(p=>p.dataset.managerTablePill===key);assert.ok(pill,key);assert.ok(pill.textContent.trim());assert.match(pill.getAttribute('onclick'),/openManagerTableManagement/);
  }
  assert.equal(dom.window.document.querySelector('[data-manager-table-pill="assigned-items"]').getAttribute('aria-pressed'),'true');
  assert.equal(dom.window.document.querySelector('[data-table-workspace] #full-editor')?.textContent,'Full editor');
  nursery=false;access.canManageAccessControl=false;
  const denied=ctx.renderManagerTableManagementWorkspace('','');
  assert.doesNotMatch(denied,/data-manager-table-pill="president-command-center"|data-manager-table-pill="user-role-access"/);
  dom.window.close();
});

test('Manager module grid filters only consolidated tables and retains operational modules',()=>{
  const ctx=context([...routeNames,'renderManagerModulePicker'],{getManagersToolAccess:()=>({}),getManagerModuleOptions:()=>[{id:'assigned-items-export',label:'Assigned Items'},{id:'company-directory',label:'Company Directory'},{id:'table-management',label:'Table Management'},{id:'orders',label:'Orders'}],normalizeSearchValue:s=>s,managersSearchTerm:'',getManagerModuleMeta:()=>({}),getManagerUnassignedItemcodes:()=>[],MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW:'assigned-items-export',MANAGER_RUNTIME_WATCHDOG_VIEW:'runtime-watchdog',escJsAttrValue:escape});
  const html=ctx.renderManagerModulePicker({});
  assert.doesNotMatch(html,/data-manager-module="assigned-items-export"|data-manager-module="company-directory"/);
  assert.match(html,/data-manager-module="table-management"/);assert.match(html,/data-manager-module="orders"/);
});

test('managed table header and controls are emerald before a network response',()=>{
  const dom=new JSDOM('<!doctype html><head></head><body><div id="manager-table-management-root"></div></body>',{url:'https://agmetricapp.com/'});
  vm.runInNewContext(read('assets/manager-table-management.js'),{window:dom.window,document:dom.window.document,setTimeout,clearTimeout,CSS:{escape:v=>v}});
  const root=dom.window.document.getElementById('manager-table-management-root');
  const view=dom.window.GncManagerTableManagement.mountManagerTableManagement(root,{selected:'company-directory',tables:['company-directory'],request:()=>new Promise(()=>{}),openTable(){}});
  assert.ok(root.querySelector('.tm-scroll table thead'));
  for(const node of root.querySelectorAll('header,.tm-toolbar,.tm-scroll,footer'))assert.notEqual(dom.window.getComputedStyle(node).backgroundColor,'rgb(255, 255, 255)');
  view.destroy();dom.window.close();
});

test('workspace CSS pins selector, filters and headers while table rows own scrolling',()=>{
  const css=read('assets/app-shell-style-16.css');
  assert.match(css,/#view-table-management\{[^}]*overflow:hidden!important/);
  assert.match(css,/\.table-management-selector\{[^}]*flex:0 0 auto;z-index:25/);
  assert.match(css,/\.tm-scroll,\.nursery-scroll,\.ai-desktop-scroll[^}]*overflow:auto!important/);
  assert.match(css,/#view-table-management thead th\{position:sticky!important;top:0!important/);
  assert.match(css,/\.tm-scroll,\.agdata-access-matrix\) tr>:first-child\{position:sticky;left:0;z-index:30/);
});

test('Customer Assignments honors native verified super-admin while preserving Manager view denial',()=>{
  let allowed=true,admin=true;
  const ctx=context(['canManageCustomerRepMappings'],{canAccessView:()=>allowed,isFullAppAdministrator:()=>admin,normalizeRoleAccessToken:v=>String(v).toUpperCase(),currentRole:'super_admin'});
  assert.equal(ctx.canManageCustomerRepMappings(),true);admin=false;assert.equal(ctx.canManageCustomerRepMappings(),false);ctx.currentRole='MANAGER';assert.equal(ctx.canManageCustomerRepMappings(),true);allowed=false;admin=true;assert.equal(ctx.canManageCustomerRepMappings(),false);
});

test('consolidated editors render their shell before unrelated Manager dataset hydration',()=>{
  assert.match(functions.get('renderManagers'),/!\(typeof getManagerTableManagementKey === 'function' && getManagerTableManagementKey\(activeHomeTab\)\) && activeHomeTab !== MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW && ensureViewDataForRender/);
});

test('Season Priority accepts canonical super-admin and retains explicit audited denial',()=>{
  let permission=null;
  const ctx=context(['canViewManagerSeasonPriority'],{canAccessView:()=>true,isFullAppAdministrator:()=>true,normalizeRoleAccessToken:String,currentRole:'SUPER_ADMIN',getAuditedAppPermission:()=>permission});
  assert.equal(ctx.canViewManagerSeasonPriority(),true);permission={allowed:false};assert.equal(ctx.canViewManagerSeasonPriority(),false);
});
