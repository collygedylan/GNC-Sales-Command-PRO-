import assert from 'node:assert/strict';
import {assignedItemsHydrationContract,assignedItemsOwnerOptionsContract} from '../tests/helpers/assigned-items-hydration-contract.mjs';
import {depletionContract,completionLockContract,optimisticCompletionContract,fixedKeypadContract,inventoryScrollContract,ownerAndSuspendContract,keyboardCloseDoesNotMeasureContract} from '../tests/helpers/completed-row-contract.mjs';
import { assertVersionParity } from './sync-all-version-surfaces.mjs';
import vm from 'node:vm';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import * as scope from 'eslint-scope';
import { readComposedRuntimeSource } from './composed-app-source.mjs';
import test from 'node:test';
import '../tests/canonical-row-workflow.test.mjs';
import {assignmentFallbackContract,rosterParityContract,requestSchemaContract,avCardDetailContract} from '../tests/helpers/table-roster-contract.mjs';
import { assertBunchOptimisticContract } from '../tests/helpers/bunch-note-approval-contract.mjs';
import fs from 'node:fs';
import {requestVisibilityContract} from '../tests/helpers/request-visibility-contract.mjs';
import {queueOwnerContract} from '../tests/helpers/queue-owner-contract.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const runtime = readComposedRuntimeSource();
const codeGs = read('Code.gs');
const migration = read('supabase/migrations/20261026170000_agdata_v2371_request_suspend_email_and_lock_cleanup.sql');
const reclassMigration = read('supabase/migrations/20261015230000_inventory_reclass_moves_v1.sql');
const reclassDeliveryMigration = read('supabase/migrations/20261020150827_v2315_reclass_email_report_policy.sql');

test('v2.3.178 keeps all 12 release version surfaces synchronized', () => {
  const manifest = JSON.parse(read('package.json'));
  const version = manifest.version;
  assert.equal(version, '2.3.178');
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
test('Permanent Lock 2: committed exact-row receipts preserve full AV Note and explicit completion locks',()=>{
  completionLockContract();optimisticCompletionContract();fixedKeypadContract();keyboardCloseDoesNotMeasureContract();
 const ctx=lockContext(['getCommittedDriveEvidenceReceipt','firstNonEmptyValue']);const item={UNIQUE_ID:'row-a',ITEMCODE:'item',LOCATIONCODE:'A.1.000',LOTCODE:'27.F1'},row={unique_id:'row-a',itemcode:'item',locationcode:'A.1.000',lotcode:'27.F1',av_note:'FULL BODY / SPEC - 16-18" H'};
 assert.equal(ctx.getCommittedDriveEvidenceReceipt({ok:true,row},item).row.av_note,row.av_note);assert.throws(()=>ctx.getCommittedDriveEvidenceReceipt({ok:true,row:{...row,unique_id:'row-b'}},item),/IDENTITY/);
});
test('Permanent Lock 3: positive stock honors one-for-one Available depletion',()=>{
  depletionContract();
 const ctx=lockContext(['getEditorLocMatchQtyValue','firstNonEmptyValue','parseAppNumber'],{findLinkedMasterRow:()=>({PTRONHAND:0,on_hand:51}),getCardLocationOnHandValue:()=>91,calculateLocMatchQtyValue:(row,pct)=>Math.round(Number(row.PTRAVAILABLE)*Number(pct)/100)});
 assert.equal(ctx.getEditorLocMatchQtyValue({PTRONHAND:0,on_hand:51},80),41);
});
test('Permanent Lock 4: shared square media keeps the date outside its border',()=>{
 const css=read('assets/app-shell-style-05.css');assert.match(css,/app-inline-thumb-box[^}]*width:84px!important/);assert.match(css,/height:84px!important/);assert.match(css,/object-fit:cover!important/);assert.match(lockedFunction('ensurePhotoTakenDateBadges'),/insertAdjacentHTML|insertAdjacentElement|insertBefore|append|after/);assert.match(runtime,/avQuantityRowHtml[^]*avSpecHtml[^]*avNoteCatalogHtml/);
});
test('Permanent Lock 5: super-admin is supreme while Y/N matrix and synchronous rep roster honor aliases and denials',()=>{
 rosterParityContract();
 requestVisibilityContract();
queueOwnerContract();
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
test('Permanent Lock 8: owner saves use last-write-wins and thumbnails use object URLs',async()=>{
  await assignmentFallbackContract();
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

test('v2.3.178 pending requests survive superseded empty reads and retire only on lifecycle proof',async()=>{const {requestContract}=await import('../tests/helpers/operational-resilience-contract.mjs');await requestContract();});

test('v2.3.178 Request email preserves core, submitter, selected rep and extra recipients without replacing remote routes',async()=>{const {emailContract}=await import('../tests/helpers/operational-resilience-contract.mjs');await emailContract();});

test('v2.3.178 Nelly account aliases resolve identically across Request capability checks',async()=>{const {aliasContract}=await import('../tests/helpers/operational-resilience-contract.mjs');await aliasContract();});

test('v2.3.178 durable exact-row photos win over failed blob stubs across Drive and AV',async()=>{const {photoContract}=await import('../tests/helpers/operational-resilience-contract.mjs');await photoContract();});

test('v2.3.178 iOS custom keypads isolate native input and AV search renders during typing',async()=>{const {touchContract}=await import('../tests/helpers/operational-resilience-contract.mjs');await touchContract();});

test('v2.3.178 SOC startup avoids cascading retention and confirmed progress reports real row counts',async()=>{const {syncContract}=await import('../tests/helpers/operational-resilience-contract.mjs');await syncContract();});

test('v2.3.178 specialist Gems are registered',()=>{for(const name of ['agdata-request-queue-and-email-delivery-fortress','agdata-mobile-touch-and-keypad-guardian']){assert.match(read('.codex/skills/'+name+'/SKILL.md'),/Forbidden Anti-Patterns/);assert.ok(read('scripts/run-tooling-release-checks.mjs').includes(name));assert.ok(read('AGENTS.md').includes(name));}});

test('v2.3.178 Apps Script dispatcher patches include event-type dependencies',async()=>{const {dispatcherContract}=await import('../tests/helpers/operational-resilience-contract.mjs');dispatcherContract();});

test('Request schema and AV Item Detail retain operational access',()=>{requestSchemaContract();avCardDetailContract();});

test('Invariant 374 (finalize retries preserve all staged rows through repeated lock contention)',async()=>{const {finalizeResilienceContract}=await import('../tests/helpers/finalize-resilience-contract.mjs');await finalizeResilienceContract();});
test('Invariant 375 (unassigned code sets emit only one summary until the set changes)',async()=>{const {summaryNotificationContract}=await import('../tests/helpers/finalize-resilience-contract.mjs');summaryNotificationContract();});
test('Invariant 376 (Apps Script health requires the deployed source fingerprint)',async()=>{const {fingerprintHealthContract}=await import('../tests/helpers/finalize-resilience-contract.mjs');fingerprintHealthContract();});

test('Invariant 377 (photo health checks exact scoped derivatives and still rejects missing thumbnails)',async()=>{const {photoHealthScopeContract}=await import('../tests/helpers/health-progress-contract.mjs');photoHealthScopeContract();});
test('Invariant 378 (sync modal percentages count the same sources as its rendered cards)',async()=>{const {syncModalPercentageContract}=await import('../tests/helpers/health-progress-contract.mjs');syncModalPercentageContract();});

// Permanent photo/Suspend/Reclass locks; all existing locks remain active.
test('photo quota fallback retains native row authorization',async()=>{const m=await import('../tests/helpers/photo-suspend-contract.mjs');await m.photoRecoveryContract();});
test('Reclass keeps multiple staged rows accessible',async()=>{const m=await import('../tests/helpers/photo-suspend-contract.mjs');m.stagedReclassContract();});
test('Suspend uses canonical evidence and exact-order location commands',async()=>{const m=await import('../tests/helpers/photo-suspend-contract.mjs');m.suspendLocationContract();});

test('Invariant 395 (Storage gateway cooldown skips probes, expires and preserves exact-row authorization)',async()=>{const m=await import('../tests/helpers/photo-suspend-contract.mjs');await m.photoCooldownContract();await m.persistentPhotoWarmupContract();const field=await import('../tests/helpers/photo-field-lifecycle-contract.mjs');await field.photoFieldLifecycleContract();});
test('Invariant 396 (database fallback photos share the authorized history catalog with bucket and Drive archives)',async()=>{const m=await import('../tests/helpers/photo-suspend-contract.mjs');await m.fallbackHistoryContract();});
test('Invariant 397 (cache metadata repair uses bounded skipped-lock batches and retains the storage deletion guard)',async()=>{const m=await import('../tests/helpers/photo-suspend-contract.mjs');await m.boundedCacheContract();});
test('Explicit edit-any-row grants and assigned-only denials remain authoritative',async()=>{const m=await import('../tests/helpers/completed-row-contract.mjs');m.rowCapabilityInitializationContract();});
test('Invariant 398 (photo attachment patch retains remote-only production routes)',async()=>{const m=await import('../tests/helpers/photo-suspend-contract.mjs');await m.historyPatchContract();});

test('Assigned Items retains post-fetch plant groups and canonical owner options',async()=>{await assignedItemsHydrationContract();assignedItemsOwnerOptionsContract();});

// Permanent six-role charter: deterministic behavior checks; full audit is one-shot only.
test('Role 1 Nursery Business/Product: dormant families retain source metadata and owners',async()=>{const m=await import('../tests/helpers/fast-release-contract.mjs');m.dormantFamilyContract();});
test('Role 2 Photo Lifecycle: unlimited photos, completion-only locks, authorized unlock and Docks exemption',async()=>{const m=await import('../tests/helpers/photo-field-lifecycle-contract.mjs');await m.photoFieldLifecycleContract();});
test('Role 3 Dark-Emerald Touch: fixed keypad and immediate field updates',()=>{fixedKeypadContract();keyboardCloseDoesNotMeasureContract();for(const color of ['#113221','#0a2015','#22c55e'])assert.ok((read('index.html')+read('assets/theme-tokens.css')+read('assets/app-shell-style-16.css')).toLowerCase().includes(color));});
test('Role 4 Tables/Roster/Access: synchronous shared owner options and cached filters',async()=>{await assignedItemsHydrationContract();assignedItemsOwnerOptionsContract();});
test('Role 5 Database/Storage: additive reads retain strict writes and guarded storage',async()=>{const m=await import('../tests/helpers/fast-release-contract.mjs');m.additiveReadContract();const photo=await import('../tests/helpers/photo-suspend-contract.mjs');await photo.boundedCacheContract();});
test('Role 6 Fast Snapshot QA: permanent parallel default, one-shot reset and verified source fingerprints',async()=>{const m=await import('../tests/helpers/fast-release-contract.mjs');m.fastDefaultContract();m.sourceFingerprintContract();});

test('Invariant 405 (Assigned Items accepts canonical owners and empty checkbox selection restores All)',async()=>{const m=await import('../tests/helpers/assigned-owner-save-contract.mjs');m.assignedFilterResetContract();m.assignedOwnerSaveContract();});

test('Invariant 406 (warm group lookups reuse the inventory index and split worker health rejects drift)',async()=>{await (await import('../tests/helpers/assigned-items-hydration-contract.mjs')).assignedItemsHydrationContract();await (await import('../tests/helpers/fast-release-contract.mjs')).verifiedHeadOnlyContract();});

test('Invariant 407 (morning capture dates remain current and bulk owner resolution preserves row auditing)',async()=>{(await import('../tests/helpers/assigned-owner-save-contract.mjs')).earlyPhotoAndBatchContract();});

test('Invariant 408 (hosted health verifies the pinned deployment using projected identity and the full trigger digest)',async()=>{await (await import('../tests/helpers/fast-release-contract.mjs')).projectedDeploymentHealthContract();});

test('Invariant 409 (hosted OAuth reads BOM-prefixed, flat and account-mapped clasp credentials)',async()=>{(await import('../tests/helpers/fast-release-contract.mjs')).hostedClaspCredentialContract();});

test('Inventory cards allow native vertical gestures and resolve scoped Suspend owners', async () => {
  await ownerAndSuspendContract();
  await (await import('../tests/helpers/completed-row-contract.mjs')).suspendOwnerHydrationContract();
  inventoryScrollContract();
  const css = read('assets/app-shell-style-16.css');
  assert.match(css, /\.card-eval-owner[^{}]*\{[^}]*pointer-events: none/);
  assert.match(css, /background: rgba\(16, 48, 32, 0\.9\)/);
  assert.match(css, /#request-suspend-tag-results[^{}]*\{[^}]*touch-action: pan-y/);
  const cardRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([,selector]) => /card-eval-owner|app-smart-card|app-inventory-card/.test(selector));
  for (const [, ,body] of cardRules) assert.doesNotMatch(body,/overscroll-behavior-y:\s*contain|touch-action:\s*none/);
  assert.match(css,/#main-scroll-area[^{}]*\{[^}]*overscroll-behavior-y:\s*contain/);
  assert.match(lockedFunction('finalizeLogin'), /loadManagerItemcodeDefaultOwners/);
  assert.match(lockedFunction('loadManagerItemcodeDefaultOwners'), /state\.itemcodeDefaultOwners/);
  const { showroomContract } = await import('../tests/helpers/field-parity-contract.mjs');
  await showroomContract();
});

test('Suspend includes all operational destinations across loaders',async()=>{await (await import('../tests/helpers/completed-row-contract.mjs')).allSuspendDestinationsContract();});

test('Invariant 416 (captured field photos survive stale refresh and stopped completion)', async () => {
    const { fieldPhotoContract } = await import('../tests/helpers/field-photo-contract.mjs');
    fieldPhotoContract();
});

test('Invariant 417 (live queues use physical assignments and server pending state; Assigned Items opens in code order)', async () => {
    const { liveQueueAssignmentContract } = await import('../tests/helpers/completed-row-contract.mjs');
    liveQueueAssignmentContract();
});

test('Invariant 418 (Assigned Items activates before reading inventory and prepares a bounded first viewport)', async () => {
    const { firstAssignedFrameContract } = await import('../tests/helpers/completed-row-contract.mjs');
    await firstAssignedFrameContract();
});

test('Invariant 419 (background hydration retains visible nodes and iOS height changes preserve layout)', async () => {
    (await import('../tests/helpers/ios-frame-contract.mjs')).iosFrameContract();
});
test('Invariant 420 (worker and manifest updates share one version reload and a sixty-second cooldown)', async () => {
    (await import('../tests/helpers/ios-frame-contract.mjs')).iosReloadContract();
});

test('Invariant 423 (all eight Queue tabs switch synchronously for authorized accounts)', async () => {
    const { queueTabContract } = await import('../tests/helpers/queue-table-interaction-contract.mjs');
    await queueTabContract();
});

test('Invariant 424 (personal Queue badges deduplicate active request and physical suspend identities)', async () => {
    const { queueCountContract } = await import('../tests/helpers/queue-table-interaction-contract.mjs');
    await queueCountContract();
});

test('Invariant 425 (Assigned Items appends 150 rows within 400 pixels through the complete dataset)', async () => {
    const { assignedPagingContract } = await import('../tests/helpers/queue-table-interaction-contract.mjs');
    await assignedPagingContract();
});

test('Invariant 426 (row and bulk saves update full-dataset assignments before the canonical RPC resolves)', async () => {
    const { assignedOwnerContract } = await import('../tests/helpers/queue-table-interaction-contract.mjs');
    await assignedOwnerContract();
});

test('Invariant 427 (mobile Request titles and the horizontal Queue rail retain readable layout)', async () => {
    const { mobileQueueLayoutContract } = await import('../tests/helpers/queue-table-interaction-contract.mjs');
    await mobileQueueLayoutContract();
});

test('Invariant 428 (verified worker installs activate with open clients and upgrade only stale AgData windows)', async () => {
    const { upgradeOpenWindows } = await import('../tests/helpers/pwa-shell-upgrade-contract.mjs');
    await upgradeOpenWindows();
});

test('Invariant 429 (network-first shell and release descriptors refresh stable offline copies)', async () => {
    const { networkFirstShell } = await import('../tests/helpers/pwa-shell-upgrade-contract.mjs');
    await networkFirstShell();
});

test('Invariant 430 (authenticated screens share a visible fixed footer outside their scroll area)', async () => {
    const { authenticatedFooter } = await import('../tests/helpers/pwa-shell-upgrade-contract.mjs');
    await authenticatedFooter();
});

test("Suspend close retries the same command through four transient lock errors", async () => {
    const { suspendCloseRetryContract } = await import('../tests/helpers/queue-table-interaction-contract.mjs');
    await suspendCloseRetryContract();
});

test("Queue renders exact counts, compact pills and clean measurement text", async () => {
    const { queuePillAndTextContract } = await import('../tests/helpers/queue-table-interaction-contract.mjs');
    await queuePillAndTextContract();
});

test('Invariant 433 (requires confirmation before changing the exact Suspend and Dock pull location)', async () => {
    const { confirmedPullLocationContract } = await import('../tests/helpers/queue-table-interaction-contract.mjs');
    await confirmedPullLocationContract();
});

test('Invariant 434 (coalesces identical row writes and defers background paint through touch and dialogs)', async () => {
    const { serializedQueueInteractionContract } = await import('../tests/helpers/queue-table-interaction-contract.mjs');
    await serializedQueueInteractionContract();
});

test('Invariant 435 (field failures, geometry and personal Queue mismatches reach the sanitized Watchdog)', async () => {
    const { fieldWatchdogContract } = await import('../tests/helpers/watchdog-field-contract.mjs');
    await fieldWatchdogContract();
});

test('Invariant 436 (Watchdog reviews seven days of unresolved fingerprints and routes all three named administrators)', async () => {
    const { watchdogReviewContract } = await import('../tests/helpers/watchdog-field-contract.mjs');
    await watchdogReviewContract();
});

test('Invariant 437 (Complete Tag closes blank False Block rows on the first paint)', async () => {
    const { closeUnreviewedContract } = await import('../tests/helpers/suspend-field-release-contract.mjs');
    await closeUnreviewedContract();
});

test('Invariant 438 (confirmed pulls preview the exact Dock, Drop, Drive and AV allocation)', async () => {
    const { confirmedLocationContract } = await import('../tests/helpers/suspend-field-release-contract.mjs');
    await confirmedLocationContract();
});

test('Invariant 439 (canonical SOC membership excludes stale and completed lines and honors resolved owners)', async () => {
    const { activeSocContract } = await import('../tests/helpers/suspend-field-release-contract.mjs');
    await activeSocContract();
});

test('Invariant 440 (priority-independent location photos serve the queue, detail and AV search)', async () => {
    const { mediaParity } = await import('../tests/helpers/field-parity-contract.mjs');
    await mediaParity();
});

test('Invariant 441 (queue scope settings govern both tabs, counts and empty membership)', async () => {
    const { queueParity } = await import('../tests/helpers/field-parity-contract.mjs');
    await queueParity();
});

test('Invariant 442 (search coalesces and completion preserves the mounted list)', async () => {
    const { interactionParity } = await import('../tests/helpers/field-parity-contract.mjs');
    await interactionParity();
});

test('Invariant 443 (incident copy emits one current release brief)', async () => {
    const { watchdogParity } = await import('../tests/helpers/field-parity-contract.mjs');
    await watchdogParity();
});

test('Invariant 444 (authenticated Watchdog review sends the exact remote-only command)', async () => {
    const { reviewerParity } = await import('../tests/helpers/field-parity-contract.mjs');
    await reviewerParity();
});

test('Invariant 445 (AV Photos hydrates named matches when the local catalog lacks their media)', async () => {
    const { avNameParity } = await import('../tests/helpers/field-parity-contract.mjs');
    await avNameParity();
});

test('Invariant 447 (measurement keypad owns the draft cursor and displays exact dimension tokens)', async () => {
    (await import('../tests/helpers/mobile-detail-continuity-contract.mjs')).keypadContract();
});
test('Invariant 448 (queue refresh retains cards and a hydrated detail opens its local AV options)', async () => {
    await (await import('../tests/helpers/mobile-detail-continuity-contract.mjs')).queueDetailContract();
});
test('Invariant 449 (Watchdog distinguishes cancelled reads and mobile viewport geometry)', async () => {
    (await import('../tests/helpers/mobile-detail-continuity-contract.mjs')).watchdogViewportContract();
});

test('Invariant 450 (owned Request outbox commands retire only against exact durable receipts)', async () => {
    await (await import('../tests/helpers/request-receipt-contract.mjs')).receiptContract();
});
test('Invariant 451 (Request work reconciles exact completion versions and preserves newer edits)', async () => {
    await (await import('../tests/helpers/request-receipt-contract.mjs')).workReceiptContract();
});
test('Invariant 452 (required Request fields stay actionable and genuine errors remain observable)', async () => {
    (await import('../tests/helpers/request-receipt-contract.mjs')).requestGuidanceContract();
});

test('Invariant 453 (operator-retained Request drafts remain individually reviewable without dispatch)', async () => {
    await (await import('../tests/helpers/request-receipt-contract.mjs')).retainedDraftContract();
});

test('Invariant 454 (exact item candidates and confirmed order selection)', async () => {
    await (await import('../tests/helpers/suspend-location-release-contract.mjs')).suspendSelectionContract();
});
test('Invariant 455 (indexed assignment metadata and append-only measurement keypad)', async () => {
    await (await import('../tests/helpers/suspend-location-release-contract.mjs')).assignmentKeypadContract();
});
test('Invariant 456 (foreground revision budget, direct photos and pinned navigation)', async () => {
    await (await import('../tests/helpers/suspend-location-release-contract.mjs')).quotaContract();
});
