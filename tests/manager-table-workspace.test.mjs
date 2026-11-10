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
function context(names,extra={}){const ctx=vm.createContext({GncNurseryModel:nurseryWindow.GncNurseryModel,esc:escape,...extra});vm.runInContext(read('assets/manager-table-workspace.js'),ctx);vm.runInContext(names.map(n=>functions.get(n)).join('\n'),ctx);return ctx;}
const routeNames=['getManagerTableManagementKey','getManagerTableManagementLegacyTab'];

test('all consolidated route aliases select the exact existing table controller',()=>{
  const ctx=context(routeNames);
  const aliases={'assigned-items-export':'assigned-items','access-control':'user-role-access','customer-rep-map':'customer-assignments','item-inquiry-coverage':'inquiry-coverage','av-blanks-photo-bypass':'av-note-users','season-settings':'season','production-schedule':'production-schedule'};
  for(const [route,key] of Object.entries(aliases))assert.equal(ctx.getManagerTableManagementKey(route),key);
  assert.equal(ctx.getManagerTableManagementKey('orders'),'');
  assert.equal(ctx.getManagerTableManagementKey('crop-roll'),'');
  assert.equal(ctx.getManagerTableManagementLegacyTab('assigned-items'),'assigned-items-export');
  assert.equal(ctx.getManagerTableManagementLegacyTab('user-role-access'),'access-control');
  assert.equal(ctx.getManagerTableManagementKey('president-command-center'),'president-command-center');
});

test('selector renders authorized dropdown options while preserving explicit denial',()=>{
 const access={canViewAssignedItemsExport:true,canManageCustomerRepMappings:true,canManageAccessControl:true,canManageAvBlanksPhotoBypass:true,canManageSeasonSettings:true,canViewSeasonPriority:true,canViewCropRoll:true,canViewProductionSchedule:true};let nursery=true;
 const ctx=context(['getManagerTableManagementItems','renderManagerTableManagementWorkspace'],{getManagersToolAccess:()=>access,canViewNurseryCommandTables:()=>nursery,canUseHistoricalRequests:()=>true,canOpenPhotoHistory:()=>true});
 const dom=new JSDOM(ctx.renderManagerTableManagementWorkspace('<div id="full-editor">Full editor</div>','assigned-items'));
 try{for(const key of ['assigned-items','user-role-access','company-directory','customer-assignments','inquiry-coverage','av-note-users','season','season-priority',...nurseryWindow.GncNurseryModel.TABLES.map(t=>t.id)])assert.ok(dom.window.document.querySelector('[data-table-switch] option[value="'+key+'"]'),key);assert.equal(dom.window.document.querySelector('[data-table-workspace] #full-editor').textContent,'Full editor');nursery=false;access.canManageAccessControl=false;assert.doesNotMatch(ctx.renderManagerTableManagementWorkspace('',''),/data-manager-table-card="president-command-center"|data-manager-table-card="user-role-access"/);}finally{dom.window.close();}
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
  assert.match(functions.get('renderManagers'), /keepManagerModuleSurface\(container\)[\s\S]+renderManagerTableManagementWorkspace/);
  assert.match(functions.get('keepManagerModuleSurface'),/!\(typeof getManagerTableManagementKey === 'function' && getManagerTableManagementKey\(activeHomeTab\)\) && activeHomeTab !== MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW && ensureViewDataForRender/);
});

test('Season Priority accepts canonical super-admin and retains explicit audited denial',()=>{
  let permission=null;
  const ctx=context(['canViewManagerSeasonPriority'],{canAccessView:()=>true,isFullAppAdministrator:()=>true,normalizeRoleAccessToken:String,currentRole:'SUPER_ADMIN',getAuditedAppPermission:()=>permission});
  assert.equal(ctx.canViewManagerSeasonPriority(),true);permission={allowed:false};assert.equal(ctx.canViewManagerSeasonPriority(),false);
});

const fullTableAccess={canViewAssignedItemsExport:true,canManageCustomerRepMappings:true,canManageAccessControl:true,canManageAvBlanksPhotoBypass:true,canManageSeasonSettings:true,canViewSeasonPriority:true,canViewCropRoll:true,canViewProductionSchedule:true};
function directoryContext(extra={}){return context(['getManagerTableManagementItems','renderManagerTableManagementWorkspace'],{getManagersToolAccess:()=>fullTableAccess,canViewNurseryCommandTables:()=>true,canUseHistoricalRequests:()=>true,canOpenPhotoHistory:()=>true,...extra});}
test('two-level directory has 17 full table names and no duplicate schedule or pill wall',()=>{
 const ctx=directoryContext(),dom=new JSDOM(ctx.renderManagerTableManagementWorkspace('<div id="old-directory"></div>',''));
 try{const doc=dom.window.document,cards=[...doc.querySelectorAll('[data-manager-table-card]')];assert.equal(cards.length,17);assert.equal(doc.querySelector('[data-manager-table-card="crop-roll"]'),null);assert.equal(doc.querySelectorAll('[data-table-directory]').length,1);assert.equal(doc.querySelectorAll('[data-table-workspace],.table-management-pills,#old-directory').length,0);assert.equal(cards.filter(c=>/SCHEDULE/i.test(c.textContent)).length,1);for(const t of nurseryWindow.GncNurseryModel.TABLES)assert.ok(cards.some(c=>c.textContent.trim()===t.label),t.label);assert.doesNotMatch(doc.body.textContent,/Maintained nursery reference data/);}finally{dom.window.close();}
});
test('two-level drill-down retains each editor with one bar and an authorized switch dropdown',()=>{
 const ctx=directoryContext();for(const key of ['company-directory','assigned-items','user-role-access','president-command-center']){const dom=new JSDOM(ctx.renderManagerTableManagementWorkspace('<div id="existing-editor">rows</div>',key));try{const doc=dom.window.document;assert.equal(doc.querySelector('[data-table-directory]'),null);assert.equal(doc.querySelectorAll('[data-table-selector]').length,1);assert.ok(doc.querySelector('[data-table-all]'));assert.ok(doc.querySelector('select[data-table-switch]'));assert.ok(doc.querySelector('[data-table-workspace] #existing-editor'));assert.equal(doc.querySelectorAll('.table-management-pills').length,0);}finally{dom.window.close();}}
});
test('All Tables and global Back synchronously return to the directory before Manager Modules',()=>{
 let renders=0,modules=0;const ctx=context([...routeNames,'getManagerTableManagementItems','openManagerTableManagement','goBackUniversal'],{getManagersToolAccess:()=>fullTableAccess,canViewNurseryCommandTables:()=>true,canUseHistoricalRequests:()=>true,canOpenPhotoHistory:()=>true,managerTableManagementSelection:'assigned-items',managerTableManagementDirectOpen:false,managersSearchTerm:'old',activeHomeTab:'assigned-items-export',MANAGER_TABLE_MANAGEMENT_VIEW:'table-management',MANAGER_EVAL_REPORTS_2_VIEW:'eval-reports-2',getCurrentVisibleViewId:()=> 'managers',destroyManagerTableManagement(){},setHomeTab(tab){ctx.activeHomeTab=tab;},renderManagers(){renders++;},getVisibleSecondaryBack:()=>null,getManagerAssignedColumnState:()=>({}),isDrawerOpen:()=>false,closeOpenInteractiveSurfaceForBack:()=>false,updateGlobalBackButton(){},openManagersModules(){modules++;return false;}});
 assert.equal(ctx.openManagerTableManagement(),false);assert.equal(ctx.managerTableManagementSelection,'');assert.equal(ctx.activeHomeTab,'table-management');assert.equal(renders,1);
 ctx.managerTableManagementSelection='company-directory';assert.equal(ctx.goBackUniversal(),false);assert.equal(ctx.managerTableManagementSelection,'');assert.equal(renders,2);assert.equal(modules,0);ctx.goBackUniversal();assert.equal(modules,1);
});

test('directory search filters full table names synchronously without opening an editor',()=>{
 const dom=new JSDOM('<input id="managers-search" value="president"><button data-manager-table-card="one">PRESIDENT_COMMAND_CENTER</button><button data-manager-table-card="two">Company Directory</button>');
 try{const ctx=context(['handleManagersSearch'],{document:dom.window.document,activeHomeTab:'table-management',MANAGER_TABLE_MANAGEMENT_VIEW:'table-management',managerTableManagementSelection:'',managersSearchTerm:'',syncManagersHeaderChrome(){}});assert.equal(ctx.handleManagersSearch(),false);assert.equal(dom.window.document.querySelector('[data-manager-table-card="one"]').hidden,false);assert.equal(dom.window.document.querySelector('[data-manager-table-card="two"]').hidden,true);}finally{dom.window.close();}
});


function bunchFixture(){
 const row={unique_id:'bunch-exact-1',warehousei:'10',itemcode:'A.030.1',commonname:'Hydrangea',contsize:'#3',locationcode:'G.10.010',lotcode:'27.F1',source:'LD',saleyear:'2027',ptronhand:100,ptravailable:90,locationnote:'Haul to ??'};
 const refs={ph_nursery_locations:[{location_code:'G.10.000',total_beds:10,house_count:2,permanent_shade:'N',house_orientation:'East-West'},{location_code:'G.11.000',total_beds:10,house_count:2,permanent_shade:'N',house_orientation:'East-West'}],ph_nursery_items_cpb:[{itemcode:'A.030.1',cpb:100}],ph_nursery_water_rating:[{common_name:'Hydrangea',dwu_3:'500',hydro_zone:'2'}],ph_dylan_decisions_store:[]};
 return {row,refs,inventory:[row]};
}
test('Bunch Notes audits thirteen rules without inventing destinations or matching sibling UIDs',()=>{
 const M=nurseryWindow.GncNurseryModel,{row,refs,inventory}=bunchFixture(),c=M.buildBunchNoteContext(inventory,refs),p=M.evaluateBunchNoteRowAndIssues(row,c);
 assert.equal(M.BUNCH_RULES.length,13);assert.equal(M.BUNCH_THREADS.length,7);assert.equal(p.target,'G.10.000');assert.equal(p.bunchNoteIssues.some(i=>i.category==='destination'),true);assert.match(p.autoSuggestedBunchNote,/Leave out 1 row at house edge for inside drape plastic/);assert.match(p.autoSuggestedBunchNote,/Spread space/);
 assert.equal(M.evaluateBunchNoteRowAndIssues(row,c,{...p.choices,note:p.autoSuggestedBunchNote}).bunchNoteIssues.length,0);
 assert.equal(M.evaluateBunchNoteRowAndIssues(row,c,{target:'G.99.000'}).canApprove,false);
 M.publishBunchDecisions('actor',[{plan_id:p.plan_id,decision:M.DECISIONS[0],notes:'exact saved note'}]);assert.equal(M.approvedBunchNote(row,'actor'),'exact saved note');assert.equal(M.approvedBunchNote({...row,unique_id:'sibling'},'actor'),'');assert.equal(M.approvedBunchNote(row,'different-actor'),'');
});
test('Bunch audit enforces water threshold, carryover, planting reservations, shade and shift protection',()=>{
 const M=nurseryWindow.GncNurseryModel,{row,refs}=bunchFixture();const peer={...row,unique_id:'target',locationcode:'G.11.000',ptronhand:300,water_ml_day:'751'};
 let c=M.buildBunchNoteContext([row,peer],refs);assert.ok(M.evaluateBunchNoteRowAndIssues(row,c,{target:'G.11.000'}).blockers.some(b=>b[0]===5));
 peer.water_ml_day='750';c=M.buildBunchNoteContext([row,peer],refs);assert.equal(M.evaluateBunchNoteRowAndIssues(row,c,{target:'G.11.000'}).blockers.some(b=>b[0]===5),false);
 peer.saleyear='2026';peer.holdstopcode='PATH';refs.ph_nursery_locations[1].permanent_shade='Y';refs.ph_prod_schedule_active=[{line_id:'.27.1',itemcode:row.itemcode,commonname:row.commonname,source:'LD',planned_qty:900,target_loc:'G.11.000',cpb:100}];c=M.buildBunchNoteContext([row,peer],refs);const rules=M.evaluateBunchNoteRowAndIssues(row,c,{target:'G.11.000'}).blockers.map(b=>b[0]);for(const n of [1,3,4,6,7])assert.ok(rules.includes(n),'Gate '+n);
 row.locationnote='TA; no report; make fit; shift 20';row.lotcode='27.Y';c=M.buildBunchNoteContext([row],refs);const bad=M.evaluateBunchNoteRowAndIssues(row,c);assert.ok(bad.bunchNoteIssues.some(i=>i.category==='inventory'));assert.ok(bad.bunchNoteIssues.some(i=>i.category==='partial'));assert.match(bad.autoSuggestedBunchNote,/Can-tight countable/);
});

test('Bunch approval updates immediately, rolls back failed writes, and persists across remount',async()=>{
 const dom=new JSDOM('<div id="workspace"></div>',{url:'https://agmetricapp.com/'}),window=dom.window,{row,refs,inventory}=bunchFixture();let saves=0,committed=0,authorized=true,finish,fail;
 vm.runInContext(read('assets/nursery-command-model.js'),vm.createContext({window}));vm.runInNewContext(read('assets/nursery-command-tables.js'),{window,document:window.document,setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout});
 window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};window.HTMLDialogElement.prototype.close=function(){this.dispatchEvent(new window.Event('close'));};
 const root=window.document.getElementById('workspace'),requests=[],request=async({table,operation,payload})=>{if(operation==='read')return {rows:refs[table]||[]};saves++;requests.push(payload);return new Promise((resolve,reject)=>{finish=()=>resolve({row:{...payload.row,updated_at:'2026-11-02T00:00:00Z'}});fail=()=>reject(Error('Network unavailable'));});};
 const options={selected:'bunch-notes-simulator',identity:'test-actor',inventory:()=>inventory,authorized:()=>authorized,request,onBunchNoteSaved(){committed++;},back(){}};let mounted=window.GncNurseryTables.mount(root,options);const settle=()=>new Promise(resolve=>setImmediate(resolve));
 try{await settle();root.querySelector('[data-bunch-subview="issues"]').click();root.querySelector('[data-bunch-open]').click();let modal=window.document.getElementById('bunch-note-issue-modal');const start=performance.now();modal.querySelector('[data-bunch-approve]').click();assert.ok(performance.now()-start<50);assert.equal(window.document.getElementById('bunch-note-issue-modal'),null);assert.equal(root.querySelectorAll('[data-bunch-card]').length,0);assert.match(window.localStorage.getItem('gnc_bunch_decisions:test-actor'),/"_optimistic":true/);assert.equal(committed,1);
  await settle();fail();await settle();assert.equal(root.querySelectorAll('[data-bunch-card]').length,1);assert.equal(window.GncNurseryModel.approvedBunchNote(row,'test-actor'),'');assert.match(root.textContent,/Previous values restored/);
  root.querySelector('[data-bunch-open]').click();modal=window.document.getElementById('bunch-note-issue-modal');assert.ok(modal.querySelector('textarea').value);modal.querySelector('[data-bunch-approve]').click();await settle();assert.equal(saves,2);assert.equal(requests[0].commandId,requests[1].commandId);
  mounted.destroy();mounted=window.GncNurseryTables.mount(root,{...options,selected:'approved-execution-plan'});assert.match(root.querySelector('tbody').textContent,/Center House/);finish();await settle();assert.doesNotMatch(window.localStorage.getItem('gnc_bunch_decisions:test-actor'),/_optimistic/);
  mounted.destroy();mounted=window.GncNurseryTables.mount(root,options);root.querySelector('[data-bunch-subview="issues"]').click();root.querySelector('[data-bunch-filter="approved"]').click();assert.match(root.textContent,/Approved Bunch Note Created/);root.querySelector('[data-bunch-subview="rules"]').click();assert.equal(root.querySelectorAll('[data-bunch-rule]').length,13);
 }finally{mounted.destroy();dom.window.close();}
});

test('Bunch generated separation instructions retain the selected crew on re-audit',()=>{
 const M=nurseryWindow.GncNurseryModel,{row,refs}=bunchFixture();row.fieldtagcolor='Blue';const other={...row,unique_id:'other-variety',itemcode:'B.030.1',commonname:'Abelia'};
 const c=M.buildBunchNoteContext([row,other],refs),p=M.evaluateBunchNoteRowAndIssues(row,c);assert.match(p.autoSuggestedBunchNote,/same-color tags/);
 const audited=M.evaluateBunchNoteRowAndIssues(row,c,{...p.choices,note:p.autoSuggestedBunchNote});assert.equal(audited.bunchNoteIssues.length,0);assert.equal(audited.crew,p.crew);
});


test('Bunch open blocks never invent houses and inside drape still requires a covered destination',()=>{
 const M=nurseryWindow.GncNurseryModel,{row,refs}=bunchFixture();refs.ph_nursery_locations[0].house_count=0;row.commonname='Gold Mop Falsecypress';const c=M.buildBunchNoteContext([row],refs),p=M.evaluateBunchNoteRowAndIssues(row,c);assert.match(p.autoSuggestedBunchNote,/Open block \(no house\)/);assert.doesNotMatch(p.autoSuggestedBunchNote,/1 house — Center House/);assert.equal(p.canApprove,true);row.commonname='Hydrangea';assert.equal(M.evaluateBunchNoteRowAndIssues(row,c).canApprove,false);
});


test('historical identities normalize every supplied block and preserve physical live lots',()=>{
 const M=nurseryWindow.GncNurseryModel;for(const [raw,expected] of [['2B','B.02'],['8C West','C.08'],['8C East','C.08'],['2I South','I.02'],['E.01','E.01'],['6E','E.06'],['22G','G.22'],['A05 West','A.05'],['G26','G.26'],['F15 South','F.15'],['9C','C.09'],['9H','H.09'],['23E','E.23'],['H.11','H.11'],['14E','E.14'],['20E','E.20'],['8A','A.08'],['17D','D.17'],['G15','G.15'],['E15','E.15'],['10G','G.10'],['22D','D.22'],['3E','E.03'],['15C','C.15'],['31D','D.31'],['32D','D.32']])assert.equal(M.normalizeBunchBlock(raw),expected+'.000');
 const live=[{unique_id:'live-b',locationcode:'B.02.010',itemcode:'001.070.1',lotcode:'27.F1',commonname:'Peggy Martin Rose Espalier',contsize:'#7'},{unique_id:'live-a',locationcode:'B.02.000',itemcode:'001.070.1',lotcode:'26.F1',commonname:'Peggy Martin Rose Espalier',contsize:'#7'}];
 const def={block:'2B',commonname:'Peggy Martin Espalier',contsize:'#7'};const a=M.resolveBunchNoteExceptionRowIdentity(def,live,[]),b=M.resolveBunchNoteExceptionRowIdentity(def,[...live].reverse(),[]);assert.equal(a.unique_id,b.unique_id);assert.equal(a.matches.length,2);assert.equal(a.synthetic,false);
 for(const size of ['#7','3DP','#15','#25','#3','#5','#1D','8DP','2DP','5DP']){const ghost=M.resolveBunchNoteExceptionRowIdentity({block:'2B',commonname:'Jane Magnolia Clump',contsize:size,notes:'Not on inventory'},live,[]);for(const key of ['unique_id','locationcode','itemcode','lotcode','commonname','contsize'])assert.ok(ghost[key]);assert.equal(ghost.lotcode,'GHOST_LOT');assert.equal(ghost.synthetic,true);assert.ok(!live.some(r=>r.unique_id===ghost.unique_id));}
 const moved=M.resolveBunchNoteExceptionRowIdentity({...def,block:'8C West'},live,[]);assert.equal(moved.itemcode,'001.070.1');assert.equal(moved.locationcode,'C.08.000');assert.equal(moved.lotcode,'HISTORICAL_LOT');assert.notEqual(moved.unique_id,live[0].unique_id);
});
test('every installed historical source definition resolves to a complete identity without stock insertion',()=>{
 const M=nurseryWindow.GncNurseryModel,sql=read('supabase/migrations/20261102020000_v23134_bunch_note_historical_identities.sql'),defs=JSON.parse(sql.split('$bunch_catalog$')[1]);assert.equal(defs.length,750);assert.equal(new Set(defs.map(d=>d.from_loc)).size,25);const inventory=[];
 const context=M.buildBunchNoteContext(inventory,{ph_dylan_decisions_store:defs});assert.equal(context.historicalIdentities.length,defs.length);assert.equal(inventory.length,0);for(const identity of context.historicalIdentities)for(const key of ['unique_id','locationcode','itemcode','lotcode'])assert.ok(identity[key]);
 const row=[...context.byUid.values()][0],p=M.evaluateBunchNoteRowAndIssues(row,context);assert.equal(p.canApprove,true);assert.match(p.autoSuggestedBunchNote,/reconciliation/);assert.equal(M.evaluateBunchNoteRowAndIssues(row,context,{note:p.autoSuggestedBunchNote}).bunchNoteIssues.length,0);
});

test('all eleven nursery Gems route to the canonical issue and optimistic approval engine',async()=>{
 for(const name of ["gnc-president-master-orchestrator","gnc-cross-sheet-bunch-notes-linker","gnc-consolidation-agent","gnc-bed-and-hydro-supervisor","gnc-planting-location-fallback-shield","gnc-f1-sy27-movement-manager","gnc-bunch-notes-and-schedule-ingest","agdata-field-ops-and-qc","gnc-bunch-notes-rule-and-issue-auditor","gnc-bunch-notes-multi-hop-sequencer","gnc-bunch-notes-crew-and-ribbon-dispatcher"]){const skill=read('.codex/skills/'+name+'/SKILL.md');for(const token of ['BUNCH_NOTES_SIMULATOR','Issues','Drive Mode Card','13-Rule','goBackUniversal'])assert.ok(skill.includes(token),name+': '+token);}
 const {assertBunchOptimisticContract}=await import('./helpers/bunch-note-approval-contract.mjs');await assertBunchOptimisticContract();
});

test('Bunch simulator drills through A-L and exact block lots, then approves before durable PDF email',async()=>{const {assertBunchDrillContract}=await import('./helpers/bunch-drill-contract.mjs');await assertBunchDrillContract();});


test('nursery PDF requires exact committed decisions and rejects stale, sibling or unapproved rows',async()=>{
 const {default:ts}=await import('typescript');const module={exports:{}};vm.runInNewContext(ts.transpileModule(read('supabase/functions/_shared/nursery-bunch-pdf.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:()=>({})});
 const {validateNurseryPdfInput,assertNurseryPdfApprovals}=module.exports;
 const card={plan_id:'BN-exact',itemcode:'A.030.1',commonname:'Gold Mop',contsize:'#3',lotcode:'27.F1',notes:'BOB verified note',target:'F.05.000',crew:'BOB',tape:'None',direction:'W > E',qty:100,available:90,updated_at:'2026-11-02T00:00:00Z'},input={locationCode:'F.05.000',cards:[card],metrics:{total:101,occupied:2,reserved:0,open:99}},saved={...card,decision:'✅ APPROVE',from_loc:'F.05.000',lot_date:card.lotcode};
 assert.doesNotThrow(()=>assertNurseryPdfApprovals(validateNurseryPdfInput(input),[saved]));
 for(const change of [{notes:'other'},{updated_at:'old'},{lot_date:'sibling'},{from_loc:'G.10.010'},{from_loc:'F.05.010'},{decision:'⏳ HOLD / ANCHOR'}])assert.throws(()=>assertNurseryPdfApprovals(input,[{...saved,...change}]),/APPROVAL_CHANGED/);
 assert.throws(()=>validateNurseryPdfInput({...input,cards:[card,card]}),/CARD_INVALID/);
});


test('signed nursery PDF mail resolves only Dylan and a replay reuses its Gmail receipt',async()=>{
 const {assertNurseryPdfRecipientContract}=await import('./helpers/bunch-drill-contract.mjs');assertNurseryPdfRecipientContract();
});

 test('View All Requests controls pending item ownership independently of module visibility',async()=>{const {requestVisibilityContract}=await import('./helpers/request-visibility-contract.mjs');requestVisibilityContract();});
test('View All Requests saves cascade by role and isolate by user with rollback',async()=>{const {requestVisibilitySaveContract}=await import('./helpers/request-visibility-save-contract.mjs');await requestVisibilitySaveContract();});

test('View All Requests migration keeps exact authorized save paths and reruns preserve choices',()=>{const sql=read('supabase/migrations/20261102190000_v23139_view_all_requests_toggle.sql');assert.match(sql,/view_all_requests text not null default 'N' check/);assert.match(sql,/if not exists[^]*column_name='view_all_requests'/);assert.match(sql,/p_permission like 'view_%' and p_permission<>'view_all_requests'/);assert.match(sql,/view_all_requests=coalesce\(p_patch->>'view_all_requests',view_all_requests\)/);assert.match(sql,/USER_ACCESS_MANAGER_REQUIRED/);assert.match(sql,/USER_ACCESS_REVISION_CONFLICT/);assert.match(sql,/USER_ACCESS_COMMAND_CONFLICT/);assert.doesNotMatch(sql,/\b(?:update|delete from|insert into) public\.(?:ph_requests_pending|ph_active_request|ph_itemcode_default_owners)\b/i);});
