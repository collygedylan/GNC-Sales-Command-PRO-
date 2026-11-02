import assert from 'node:assert/strict';
import { assertVersionParity } from './sync-all-version-surfaces.mjs';
import vm from 'node:vm';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import * as scope from 'eslint-scope';
import { readComposedRuntimeSource } from './composed-app-source.mjs';
import test from 'node:test';
import { assertBunchOptimisticContract } from '../tests/helpers/bunch-note-approval-contract.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const runtime = readComposedRuntimeSource();
const codeGs = read('Code.gs');
const migration = read('supabase/migrations/20261026170000_agdata_v2371_request_suspend_email_and_lock_cleanup.sql');
const reclassMigration = read('supabase/migrations/20261015230000_inventory_reclass_moves_v1.sql');
const reclassDeliveryMigration = read('supabase/migrations/20261020150827_v2315_reclass_email_report_policy.sql');

test('v2.3.137 keeps all 12 release version surfaces synchronized', () => {
  const manifest = JSON.parse(read('package.json'));
  const version = manifest.version;
  assert.equal(version, '2.3.137');
  const release = `AgData v${version}`;
  const surfaces = [
    'assets/app-runtime.js', 'index.html', 'manifest.json', 'sw.js',
    'scripts/build-live-shell.mjs', 'v2/public/manifest.webmanifest', 'v2/src/services/api.ts',
    'tests/code-health-governance.test.mjs', 'tests/release-app-lifecycle.test.mjs',
    'tests/agdata-governance.test.mjs',
  ];
  for (const file of surfaces) {
    const source = read(file);
    assert.ok(source.includes(release) || source.includes(version), `${file}: ${version}`);
    assert.doesNotMatch(source, /2\.3\.71/, file);
  }
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);
});

test('Apps Script imports and email workers require private service-role credentials', () => {
  assert.match(codeGs, /function resolveSupabaseServiceRoleKey_\(sourceFallbackKey\)/);
  assert.match(codeGs, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(codeGs.match(/function resolveSupabaseServiceRoleKey_\(sourceFallbackKey\)[\s\S]*?\n\}/)?.[0] || '', /SUPABASE_KEY|SUPABASE_API_KEY/);
  assert.match(codeGs, /setProperty\('SUPABASE_SERVICE_ROLE_KEY', candidateKey\)/);
  assert.match(migration, /grant all privileges on table public\.ph_request_delivery_outbox to service_role/i);
  assert.match(migration, /revoke all privileges on table public\.ph_request_delivery_outbox from public, anon, authenticated/i);
  assert.match(migration, /revoke all privileges on table public\.ph_app_users from public, anon, authenticated/i);
  assert.match(migration, /revoke all privileges on table public\.user_access_control from public, anon, authenticated/i);
});

test('Que Request remains pending-only without approval or conflict banners', () => {
  assert.match(runtime, /function isRequestPendingVisible[\s\S]*?\['', 'pending', 'open'\]/);
  assert.match(runtime, /const actionBadge = '';/);
  assert.match(runtime, /function updateRequestWorkConflictReview[\s\S]*?panel\.replaceChildren\(\);[\s\S]*?panel\.classList\.add\('hidden'\);[\s\S]*?return;/);
  assert.match(migration, /lower\(btrim\(coalesce\(pending\.req_status, 'Pending'\)\)\) in \('', 'pending', 'open'\)/);
});

test('Suspend decisions remain assigned-rep or Admin only', () => {
  const suspendSql = read('supabase/migrations/20261021170000_suspend_candidates_request_preload_v1.sql');
  assert.match(runtime, /const canDecide = result\.canDecide && canonicalFeaturePermission\('can_approve_deny_suspend'\) !== false/);
  assert.match(suspendSql, /a\.rep_id=actor\.id or private\.is_full_app_administrator_v1\(actor\.username\)/);
  assert.match(runtime, /Approve this location/);
  assert.match(runtime, /Deny all locations/);
});

test('published Drive and AV data locks only non-Admin users', () => {
  assert.match(runtime, /if \(prefix === 'req-'\) return false/);
  assert.match(runtime, /if \(isDriveModePhotoDataEditContext\(prefix, item\)\) \{[\s\S]*?if \(getRoleAccessState\(\)\?\.isAdmin\) return false;[\s\S]*?return sectionHasProtectedData/);
  assert.match(runtime, /Published Data/);
});

test('Reclass auto-creates destination lots and ignores mutable draft quantities', () => {
  assert.match(reclassMigration, /insert into public\.ph_master_inventory/);
  assert.match(reclassMigration, /destination_uid/);
  assert.match(migration, /RECLASS_STALE_QUANTITY_GUARD_NOT_FOUND/);
  assert.match(migration, /source_identity->>''ptronhand'' is distinct from/);
  assert.match(reclassDeliveryMigration, /apply_inventory_reclass_moves_with_delivery_v1/);
});

test('AV Note load and save preserve manually entered SPEC and CALIPER text', () => {
  assert.match(runtime, /function sanitizeAvNoteWithoutSpecCaliper/);
  assert.match(runtime, /globalAvNote\.value = sanitizeAvNoteWithoutSpecCaliper\(getItemDisplayValue/);
  assert.match(runtime, /itemToSave\.AV_NOTE = sanitizeAvNoteWithoutSpecCaliper\(avEl\.value, \{ preserveEnteredText: true \}\)/);
  assert.match(migration, /sanitize_av_note_without_spec_caliper\(av_note\)/);
  assert.match(migration, /sanitize_av_note_without_spec_caliper\(salesnote\)/);
});

test('Table Management skill registers ten catalog entries and strict archive write rejection', () => {
  const catalog = read('assets/manager-table-management.js');
  const manifest = read('.codex/skills/agdata-table-management-and-directory/SKILL.md');
  assert.equal((catalog.match(/section: 'editable'/g) || []).length, 5);
  assert.equal((catalog.match(/section: 'archive'/g) || []).length, 5);
  assert.match(manifest, /Forbidden Anti-Patterns/);
  assert.match(read('scripts/run-tooling-release-checks.mjs'), /agdata-table-management-and-directory/);
  assert.match(read('supabase/functions/_shared/table-management.ts'), /READ_ONLY_TABLES\.has\(table\)[^\n]*MANAGER_TABLE_READ_ONLY/);
});

const mutationSql=read('supabase/migrations/20261031010000_agdata_v23119_access_matrix_and_publication.sql');
let lockFunctions;
function lockedFunction(name) {
  if(!lockFunctions){lockFunctions=new Map();walk.simple(acorn.parse(runtime,{ecmaVersion:'latest',sourceType:'script'}),{FunctionDeclaration(node){if(node.id)lockFunctions.set(node.id.name,runtime.slice(node.start,node.end));}});}
  assert.ok(lockFunctions.has(name),name);return lockFunctions.get(name);
}
function lockContext(names,values={}){const ctx=vm.createContext(values);vm.runInContext(names.map(lockedFunction).join('\n'),ctx);return ctx;}
test('Permanent Lock 1: masterUid identifiers always have lexical declarations',()=>{
 const sources=fs.readdirSync(path.join(root,'assets')).filter(name=>name.endsWith('.js')).map(name=>['assets/'+name,read('assets/'+name)]);
 for(const match of read('index.html').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))sources.push(['index.html',match[1]]);
 for(const [file,source] of sources){if(!/\bmasterUid\b/.test(source))continue;const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:/^\s*(?:import|export)\s/m.test(source)?'module':'script',ranges:true});const analysis=scope.analyze(ast,{ecmaVersion:2024,sourceType:ast.sourceType,optimistic:true,ignoreEval:true});assert.deepEqual(analysis.globalScope.through.filter(ref=>ref.identifier.name==='masterUid').map(ref=>ref.identifier.start),[],file);}
});
test('Permanent Lock 2: committed exact-row receipts preserve full AV Note',()=>{
 const ctx=lockContext(['getCommittedDriveEvidenceReceipt','firstNonEmptyValue']);const item={UNIQUE_ID:'row-a',ITEMCODE:'item',LOCATIONCODE:'A.1.000',LOTCODE:'27.F1'},row={unique_id:'row-a',itemcode:'item',locationcode:'A.1.000',lotcode:'27.F1',av_note:'FULL BODY / SPEC - 16-18" H'};
 assert.equal(ctx.getCommittedDriveEvidenceReceipt({ok:true,row},item).row.av_note,row.av_note);assert.throws(()=>ctx.getCommittedDriveEvidenceReceipt({ok:true,row:{...row,unique_id:'row-b'}},item),/IDENTITY/);
});
test('Permanent Lock 3: positive stock and match yield a positive photo quantity',()=>{
 const ctx=lockContext(['getEditorLocMatchQtyValue','firstNonEmptyValue','parseAppNumber'],{findLinkedMasterRow:()=>({PTRONHAND:0,on_hand:51}),getCardLocationOnHandValue:()=>91,calculateLocMatchQtyValue:(row,pct)=>Math.round(Number(row.PTRAVAILABLE)*Number(pct)/100)});
 assert.equal(ctx.getEditorLocMatchQtyValue({PTRONHAND:0,on_hand:51},80),41);
});
test('Permanent Lock 4: shared square media keeps the date outside its border',()=>{
 const css=read('assets/app-shell-style-05.css');assert.match(css,/app-inline-thumb-box[^}]*width:84px!important/);assert.match(css,/height:84px!important/);assert.match(css,/object-fit:cover!important/);assert.match(lockedFunction('ensurePhotoTakenDateBadges'),/insertAdjacentHTML|insertAdjacentElement|insertBefore|append|after/);assert.match(runtime,/avQuantityRowHtml[^]*avSpecHtml[^]*avNoteCatalogHtml/);
});
test('Permanent Lock 5: super-admin is supreme while Y/N matrix and synchronous rep roster honor aliases and denials',()=>{
 const source=read('assets/user-access-control.js'),css=read('assets/user-access-control.css');assert.match(source,/data-access-edit-mode/);assert.match(source,/saveAccessPermission/);assert.match(css,/position:sticky;left:0/);assert.match(css,/position:sticky;top:0/);assert.doesNotMatch(css,/#fff(?:fff)?(?:[;}])/i);
 const ctx=vm.createContext({});vm.runInContext(read('assets/user-access-control.js'),ctx);const access=ctx.GncUserAccessControl;
  assert.equal(access.isSuperAdminRole('super-admin'),true);assert.equal(access.isSuperAdminRole('SUPER_ADMIN'),true);assert.equal(access.isSuperAdminRole('admin'),false);assert.match(source,/super_admin:\s*\['SUPER-ADMIN'/);assert.match(lockedFunction('getRoleAccessState'),/isSuperAdmin/);
  access.setAccessMatrixRows([{username:'dylan_collyge',role:'super-admin',manage_user_access:'Y',use_weather_hold_risk_tools:'Y',use_aura_assistant:'Y',view_permissions:{view_smart_moves:'Y',view_nursery_command_tables:'Y'}}]);const supreme=access.resolveUserAccessMatrix('dylan_collyge');assert.equal(supreme.manage_user_access,'Y');assert.equal(supreme.use_weather_hold_risk_tools,'Y');assert.equal(supreme.use_aura_assistant,'Y');assert.equal(supreme.view_nursery_command_tables,'Y');assert.equal(access.isAuraOwner('dylan_collyge'),true);
  assert.match(lockedFunction('isAuthenticatedExecutiveUser'),/isSuperAdminRoleValue[^]*matrixValue === 'Y'/);assert.doesNotMatch(lockedFunction('isAuraProfileCandidate'),/dylan_collyge/);assert.doesNotMatch(lockedFunction('canUseWeatherHoldRiskTools'),/Dylan|dylan_collyge/);
 assert.equal(access.getAccessSalesReps().filter(rep=>rep.label==='Chance Alldredge').length,1);assert.equal(access.getAccessSalesReps().filter(rep=>/South TX/i.test(rep.label)).length,0);assert.equal(access.normalizeSalesRepKey('Alldredge, Chance - South TX'),'chance_alldredge');
 for(const username of ['dylan_collyge','megan_kelly','jd_jones','mitch_kaiser','nelly_aguilar','nally_aguilar','morgan_anderson']){const matrix=access.resolveUserAccessMatrix(username);assert.equal(matrix.edit_any_row,'Y');assert.equal(matrix.flyer_folder_access,'Y');}
 access.setAccessMatrixRows([{username:'nelly_aguilar',make_request:'N',can_make_request:'N'}]);assert.equal(access.canRequestSalesRep(access.resolveUserAccessMatrix('Nally Aguilar'),'Abbey Burka'),false);assert.ok(access.getAccessSalesReps().length>0);assert.match(lockedFunction('resolveRequestRepSelectionForCurrentUser'),/canRequestSalesRep/);assert.doesNotMatch(lockedFunction('filterRepList'),/Loading active users/);assert.doesNotMatch(lockedFunction('openRequestModal'),/await getRequestSubmissionController/);
});
test('Permanent Lock 6: Home Print and Run Script retain the centered progress dialog',()=>{
 assert.match(read('index.html'),/Print/);assert.match(runtime,/Run Script/);const ui=read('assets/erp-sync-ui-functions.js');assert.match(ui,/erp-sync-progress-modal/);assert.match(ui,/sourceProgress|progress/);assert.match(read('index.html'),/id="erp-sync-progress-modal" class="modal hidden"/);assert.match(read('assets/erp-sync-progress.css'),/#erp-sync-progress-modal[^}]*align-items:center;justify-content:center/);
 const cards=vm.runInNewContext(lockedFunction('erpSyncProgressCards')+';erpSyncProgressCards')({stageResults:['drive','cav','reserves','soc','hl_po_parsed'].map(key=>({key,outcome:'UP_TO_DATE'})),sourceProgress:{order_history:{percent:0}}});
 assert.deepEqual(Array.from(cards,card=>card.key),['drive','cav','reserves','soc','hl_po']);assert.equal(cards.filter(card=>card.key==='order_history').length,0);assert.equal(cards.reduce((sum,card)=>sum+card.percent,0)/5,100);
 assert.match(read('assets/erp-sync-progress.css'),/width:min\(94vw,480px\);max-width:100%;margin:0 auto;box-sizing:border-box/);
 const context=vm.createContext({});vm.runInContext(lockedFunction('erpSyncProgressCards')+'\n'+lockedFunction('completeOperationalErpSyncStatus'),context);
 const partial=context.completeOperationalErpSyncStatus({active:true,status:'running',startedAt:'2020-01-01',sourceProgress:{drive:{fileName:'exact.xlsx',publishedFileName:'exact.xlsx',publicationConfirmed:true,rowsPublished:9498,percent:95,stage:'downloading'}}});
 assert.equal(partial.active,true);assert.notEqual(partial.status,'complete');assert.equal(partial.percent,20);const partialCards=context.erpSyncProgressCards(partial);assert.equal(partialCards[0].percent,100);assert.equal(partialCards[0].stage,'published');assert.equal(partialCards.slice(1).every(card=>card.percent===0),true);
 assert.doesNotMatch(ui,/state.percent === 100 \? 100/);assert.match(ui,/Checked Drive — Up to date in App/);
});
test('Permanent Lock 7: local weekday colors and Suspend canonical inventory publication remain intact',()=>{
 assert.match(lockedFunction('saveDockSuspendDcRequestMirrorData'),/runSuspendTagRowCommand\('save', row, patch\)/);assert.doesNotMatch(lockedFunction('saveDockSuspendDcRequestMirrorData'),/runSuspendTagRowCommand\([^\n]*'complete'/);
 assert.match(lockedFunction('getDockSuspendDcRequestPlanstartInfo'),/getDay/);assert.match(runtime,/purple/);assert.match(runtime,/red/);assert.match(runtime,/green/);assert.match(runtime,/blue/);assert.match(mutationSql,/result:=public.save_drive_evidence_v3/);assert.match(mutationSql,/inventoryRows/);assert.match(lockedFunction('applySuspendTagInventoryReceipt'),/reconcileConfirmedDriveEvidence/);
});
test('Permanent Lock 8: owner saves use last-write-wins and thumbnails use object URLs',()=>{
 const sql=read('supabase/migrations/20261030220000_agdata_v23117_itemcode_owner_lww.sql');assert.doesNotMatch(sql,/ITEMCODE_DEFAULT_OWNER_REVISION_CONFLICT/);assert.match(sql,/last-write-wins/);const image=lockedFunction('buildSupabaseStorageThumbnailUrl');assert.match(image,/nextUrl.pathname = objectPrefix \+ publicPath/);assert.doesNotMatch(image,/nextUrl.pathname = renderPrefix \+ publicPath/);
});


test('Permanent Lock 9: one-card layout and custom GDD load guard retain their contracts',()=>{
 const css=read('assets/app-styles.css');assert.match(css,/#smart-moves-intelligence-panel \.sales-intelligence-cards[^}]*grid-template-columns:minmax\(0,1fr\)!important/);assert.match(css,/height:86px/);assert.match(css,/height:92px/);assert.match(css,/height:38px/);
 for(const label of ['All Moves','Hold','Photo Bottleneck','Geo Surplus','Move Up','Hold Risk (GDD)','Shear Load Guard'])assert.ok(lockedFunction('renderSmartMovesIntelligence').includes(label));
 const ctx=vm.createContext({Intl,Date});vm.runInContext(read('assets/smart-hold-intelligence.js'),ctx);const H=ctx.AgDataHoldIntelligence;assert.equal(H.nurseryStages.length,12);assert.equal(H.nurseryStages[2].label,'Consolidate Inventory');assert.equal(H.nurseryStages[3].label,'Can Filling');assert.equal(H.isShiftLot({lotcode:'27.Y'}),true);assert.equal(H.dailyGdd(70,50),35);assert.equal(H.dailyGdd(20,20),0);assert.equal(H.holdReason({holdreason:'size',spec:'sheared'}).exact,'size');assert.equal(H.holdRisk({itemcode:'A',holdreason:'size'}).recovery,null);
 const row={itemcode:'A',locationcode:'L',lotcode:'X'};assert.equal(H.shearGuard(row,H.buildLoadIndex([{...row,quantityordered:10}])).conflict,true);
 assert.match(lockedFunction('submitShearList'),/await confirmSmartShearLoadGuard/);assert.match(lockedFunction('completeShearLocationInquiry'),/await confirmSmartShearLoadGuard/);
});
test('Permanent Lock 10: selection shares visible filters and explicit owners update effective workers',async()=>{
  const {assertBunchDrillContract}=await import('../tests/helpers/bunch-drill-contract.mjs');await assertBunchDrillContract();
  const gems = ["gnc-president-master-orchestrator","gnc-cross-sheet-bunch-notes-linker","gnc-consolidation-agent","gnc-bed-and-hydro-supervisor","gnc-planting-location-fallback-shield","gnc-f1-sy27-movement-manager","gnc-bunch-notes-and-schedule-ingest","agdata-field-ops-and-qc","gnc-bunch-notes-rule-and-issue-auditor","gnc-bunch-notes-multi-hop-sequencer","gnc-bunch-notes-crew-and-ribbon-dispatcher"];
  for(const name of gems){const skill=read('.codex/skills/'+name+'/SKILL.md');for(const token of ['BUNCH_NOTES_SIMULATOR','Issues','Drive Mode Card','13-Rule','goBackUniversal'])assert.ok(skill.includes(token),name+': '+token);assert.ok(read('AGENTS.md').includes(name));assert.ok(read('.codex/skills/agdata-skill-learner/SKILL.md').includes(name));}
  const context={};vm.runInNewContext(read('assets/nursery-command-model.js'),context);const defs=JSON.parse(read('supabase/migrations/20261102020000_v23134_bunch_note_historical_identities.sql').split('$bunch_catalog$')[1]);
  for(const def of defs){const row=context.GncNurseryModel.resolveBunchNoteExceptionRowIdentity(def,[],[]);for(const key of ['unique_id','locationcode','itemcode','lotcode','commonname','contsize'])assert.ok(row[key],def.plan_id+': '+key);assert.match(row.locationcode,/^[A-L]\.[0-9]{2}\.000$/);}
  await assertBunchOptimisticContract();
  const bunch=read('assets/nursery-command-tables.js');for(const control of ['data-bunch-subview="table"','data-bunch-subview="issues"','data-bunch-subview="rules"','INACCURATE BUNCH NOTE REASON','Approve &amp; Create New Bunch Note','ph_dylan_decisions_store'])assert.ok(bunch.includes(control),control);const nursery={};vm.runInNewContext(read('assets/nursery-command-model.js'),nursery);assert.equal(nursery.GncNurseryModel.BUNCH_RULES.length,13);assert.equal(typeof nursery.GncNurseryModel.evaluateBunchNoteRowAndIssues,'function');
 assert.match(lockedFunction('renderManagerModulePicker'),/filter\(option => !getManagerTableManagementKey\(option.id\)\)/);
 assert.match(lockedFunction('renderManagerTableManagementWorkspace'),/data-table-directory/);
 assert.match(lockedFunction('renderManagerTableManagementWorkspace'),/data-table-all/);assert.match(lockedFunction('renderManagerTableManagementWorkspace'),/data-table-switch/);
 assert.doesNotMatch(lockedFunction('renderManagerTableManagementWorkspace'),/table-management-pills/);
 const directoryContext=lockContext(['renderManagerTableManagementWorkspace'],{getManagerTableManagementItems:()=>[{id:'assigned-items',label:'Assigned Items'},{id:'company-directory',label:'Company Directory'}],esc:String});const directory=directoryContext.renderManagerTableManagementWorkspace('EDITOR','');assert.match(directory,/data-manager-table-card/);assert.doesNotMatch(directory,/EDITOR|data-table-workspace/);const table=directoryContext.renderManagerTableManagementWorkspace('EDITOR','assigned-items');assert.match(table,/data-table-workspace>EDITOR/);assert.doesNotMatch(table,/data-table-directory>|data-manager-table-card=/);
 const workspaceCss=read('assets/app-shell-style-16.css');assert.match(workspaceCss,/table-management-selector\{flex:0 0 auto;z-index:25/);assert.match(workspaceCss,/thead th\{position:sticky!important;top:0!important/);
 assert.doesNotMatch(read('assets/manager-table-management.js'),/background:#fff(?:[;}])/);
 assert.match(read('scripts/verify-table-management-browser.mjs'),/scrollTop=1000/);
 assert.match(lockedFunction('assignManagerCheckedItemcodes'),/checked.length > 1 \? checked : \[code\]/);assert.match(read('assets/app-shell-style-05.css'),/assigned-items-workspace[^}]*overflow:hidden!important/);
 assert.match(lockedFunction('getManagerAssignedItemsViewProps'),/getFilteredManagerAssignedItemsExportRows\(allRows\)/);assert.doesNotMatch(lockedFunction('getManagerAssignedItemsViewProps'),/Array\.isArray\(rows\) \? rows/);
 assert.match(lockedFunction('selectAllFilteredManagerAssignedItems'),/getManagerAssignedSelectionSnapshot/);assert.match(lockedFunction('assignEvalItemcodes'),/p_itemcodes: codes/);assert.match(lockedFunction('assignEvalItemcodes'),/applyOptimisticItemcodeOwners/);
 const rows=[{ITEMCODE:'A',ASSIGNEDTO:'zoe_green'}],state={};const ctx=lockContext(['applyOptimisticItemcodeOwners'],{warehouseAssignedItemsInventory:rows,fullInventory:[],getManagerAssignedColumnState:()=>state,buildManagerEvalAssignmentKey:x=>x,clearWarehouseAssignedItemCaches:()=>{},invalidateManagerEvalReport2Cache:()=>{}});
 const undo=ctx.applyOptimisticItemcodeOwners(['A'],'morgan_anderson');assert.equal(rows[0].default_owner,'morgan_anderson');assert.equal(rows[0].effective_worker,'morgan_anderson');undo();assert.equal(rows[0].ASSIGNEDTO,'zoe_green');
 const sql=read('supabase/migrations/20261031210000_agdata_v23122_smart_hold_and_explicit_owners.sql');assert.ok(sql.indexOf('if default_row.updated_by is not null')<sql.indexOf("elsif zone_state = 'inside'"));assert.match(sql,/SECURITY INVOKER/);
});


test('Lock 11: normalized public photo cache and zero verbose Edge stdout',()=>{
 const sw=read('sw.js');assert.match(sw,/agdata-photo-cache-v1/);assert.match(sw,/IMAGE_CACHE_MAX_ENTRIES = 500/);assert.match(sw,/normalizeStoragePhotoRequest/);assert.match(sw,/runtimeImageCacheQueue/);
 assert.match(runtime,/function normalizeStoragePublicUrl/);assert.match(runtime,/memoryOnly: true/);assert.match(runtime,/isQuotaBackgroundPollingAllowed/);
 for(const file of ['supabase/functions/app-api/index.ts','supabase/functions/_shared/observability.ts',...fs.readdirSync(path.join(root,'supabase/functions/_shared')).filter(f=>f.endsWith('.mjs')).map(f=>'supabase/functions/_shared/'+f)])assert.doesNotMatch(read(file),/console[.](log|info|debug)\s*[(]/,file);
});
test('Lock 12: public RLS and invoker views preserve protected grants and origin authorization',()=>{
 const sql=read('supabase/migrations/20261101060000_v23130_supabase_quota_and_rls_security.sql');assert.match(sql,/enable row level security/);assert.match(sql,/security_invoker = true/);assert.match(sql,/has_table_privilege/);assert.match(sql,/ph_app_users.*user_access_control/);assert.doesNotMatch(sql,/grant all.*to anon/i);
 assert.match(read('supabase/functions/app-api/index.ts'),/if \(!isAllowedAppOrigin\(origin\)\)/);assert.match(runtime,/isAllowedAppHostname/);
});
test('Lock 13: CI receipts verify installed contracts and fast release uses registered quota skills',()=>{
 const runner=read('scripts/apply-item-low-stock-migration.mjs');assert.match(runner,/agdataV23130QuotaSecurityMigrationName/);assert.match(runner,/statements[.]trim\(\)/);assert.match(runner,/LOW_STOCK_DATABASE_CONTRACT_MISSING/);
 const skill=read('.codex/skills/agdata-fast-release-and-ci-pipeline-guard/SKILL.md');assert.match(skill,/npx deno/);assert.match(skill,/Never use gh run rerun --failed/);
});

test('Pre-commit all-surface version parity includes the prepared artifact',()=>{
 assertVersionParity({root,requireSite:process.env.GNC_PRECOMMIT==='1'||fs.existsSync(path.join(root,'_site/version-parity.json'))});
});
