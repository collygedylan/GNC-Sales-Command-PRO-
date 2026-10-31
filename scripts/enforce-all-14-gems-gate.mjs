import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import * as scope from 'eslint-scope';
import { readComposedRuntimeSource } from './composed-app-source.mjs';
import test from 'node:test';
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

test('v2.3.119 keeps all 12 release version surfaces synchronized', () => {
  const manifest = JSON.parse(read('package.json'));
  const version = manifest.version;
  assert.equal(version, '2.3.119');
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
test('Permanent Lock 5: Y/N matrix and synchronous rep roster honor aliases and denials',()=>{
 const ctx=vm.createContext({});vm.runInContext(read('assets/user-access-control.js'),ctx);const access=ctx.GncUserAccessControl;
 for(const username of ['dylan_collyge','megan_kelly','jd_jones','mitch_kaiser','nelly_aguilar','nally_aguilar','morgan_anderson']){const matrix=access.resolveUserAccessMatrix(username);assert.equal(matrix.edit_any_row,'Y');assert.equal(matrix.flyer_folder_access,'Y');}
 access.setAccessMatrixRows([{username:'nelly_aguilar',make_request:'N',can_make_request:'N'}]);assert.equal(access.canRequestSalesRep(access.resolveUserAccessMatrix('Nally Aguilar'),'Abbey Burka'),false);assert.ok(access.getAccessSalesReps().length>0);assert.match(lockedFunction('resolveRequestRepSelectionForCurrentUser'),/canRequestSalesRep/);assert.doesNotMatch(lockedFunction('filterRepList'),/Loading active users/);assert.doesNotMatch(lockedFunction('openRequestModal'),/await getRequestSubmissionController/);
});
test('Permanent Lock 6: Home Print and Run Script retain the centered progress dialog',()=>{
 assert.match(read('index.html'),/Print/);assert.match(runtime,/Run Script/);const ui=read('assets/erp-sync-ui-functions.js');assert.match(ui,/erp-sync-progress-modal/);assert.match(ui,/sourceProgress|progress/);assert.match(read('index.html'),/id="erp-sync-progress-modal" class="modal hidden"/);assert.match(read('assets/erp-sync-progress.css'),/#erp-sync-progress-modal[^}]*align-items:center;justify-content:center/);
});
test('Permanent Lock 7: local weekday colors and Suspend canonical inventory publication remain intact',()=>{
 assert.match(lockedFunction('getDockSuspendDcRequestPlanstartInfo'),/getDay/);assert.match(runtime,/purple/);assert.match(runtime,/red/);assert.match(runtime,/green/);assert.match(runtime,/blue/);assert.match(mutationSql,/result:=public.save_drive_evidence_v3/);assert.match(mutationSql,/inventoryRows/);assert.match(lockedFunction('applySuspendTagInventoryReceipt'),/reconcileConfirmedDriveEvidence/);
});
test('Permanent Lock 8: owner saves use last-write-wins and thumbnails use object URLs',()=>{
 const sql=read('supabase/migrations/20261030220000_agdata_v23117_itemcode_owner_lww.sql');assert.doesNotMatch(sql,/ITEMCODE_DEFAULT_OWNER_REVISION_CONFLICT/);assert.match(sql,/last-write-wins/);const image=lockedFunction('buildSupabaseStorageThumbnailUrl');assert.match(image,/nextUrl.pathname = objectPrefix \+ publicPath/);assert.doesNotMatch(image,/nextUrl.pathname = renderPrefix \+ publicPath/);
});
