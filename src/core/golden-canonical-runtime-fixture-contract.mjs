import assert from 'node:assert/strict';
import path from 'node:path';
import {committedFixtureRoots} from './database-tooling-canonical-contract.mjs';
import {compileCanonicalRuntimeFixture} from '../services/canonical-runtime-fixtures.mjs';
import {grantCanonicalFixtureAuthority} from '../services/canonical-fixture-authority.mjs';
import {replaceFixtureText,currentSmartPublicContract,currentReclassLedgerContract} from '../services/canonical-fixture-contracts.mjs';

export function assertReclassImportProvenance(read) {
  const file='supabase/tests/inventory_reclass_moves_v1_test.sql';
  const source=read(file).replaceAll('\r\n','\n');
  const current=compileCanonicalRuntimeFixture(file,source,read);
  const calls=[...current.matchAll(/public\.bulk_import_master_snapshot_v1\(run_id,'b4000000-0000-4000-8000-00000000000[1-9]',pg_temp\.reclass_erp_file_rows_v1\((?:imported_rows|pre_rows|intermediate_rows)\)/g)];
  assert.equal(calls.length,9,'all real canonical RPC calls receive the complete synthetic ERP envelope');
  assert.equal((current.match(/CREATE FUNCTION pg_temp\.reclass_erp_file_rows_v1/g)||[]).length,1);
  const helper=read('src/services/canonical-runtime-fixtures/import-envelope.sql');
  assert.match(helper,/IMMUTABLE STRICT/);
  assert.match(helper,/CASE WHEN nullif\(btrim\(entry\.value#>>'\{values,filename\}'\),''\) IS NULL/);
  assert.match(helper,/ELSE entry\.value END ORDER BY entry\.ordinality/);
  assert.match(helper,/'canonical-reclass-ledger.xlsx'/);
  assert.throws(()=>currentReclassLedgerContract(source.replace(",imported_rows,repeat('a',64)",",unregistered_rows,repeat('a',64)"),read),/ENVELOPE_COUNT_CHANGED/);
}

export function assertExplicitReclassFixtureStock(read) {
  const source=read('supabase/tests/inventory_reclass_moves_v1_test.sql').replaceAll('\r\n','\n');
  const current=currentReclassLedgerContract(source,read);
  const start=current.indexOf("select 'reclass-existing-u1-'");
  assert.ok(start>0);
  assert.match(current.slice(start-120,start),/ptronhand,ptravailable,s_lts,source,season,saleyear/);
  assert.match(current.slice(start,start+230),/'10','8','8','PH','U1','27'/);
  assert.doesNotMatch(current,/set\s+s_lts\s*=\s*(?:ptronhand|ptravailable)/i);
  assert.match(current,/INVENTORY_RECLASS_OVERLAP_INVALID/,'the overlap rejection remains strict');
  assert.match(current,/reclass-target-chain-command-00002/,'the destination-to-source lifecycle still executes');
}

export function assertCurrentReclassCohorts(read) {
  const smart=read('supabase/tests/smart_priority_hold_shield_v6_test.sql').replaceAll('\r\n','\n');
  const current=currentSmartPublicContract(smart);
  const start=smart.indexOf('create function pg_temp.v6_public_rpc_payload(');
  assert.equal(current.slice(0,start),smart.slice(0,start),'pure legacy V6 validators retain their exact inputs');
  const end=current.indexOf('-- Eval Work uses the same V6 live transaction',start);
  assert.match(current.slice(start,end),/public\.enqueue_drive_reclass_inquiry_v7\(/);
  assert.doesNotMatch(current.slice(start,end),/public\.enqueue_drive_reclass_inquiry_v6\(/);
  assert.match(current.slice(end),/jsonb_set\(pg_temp\.v6_public_rpc_payload/);
  assert.match(current.slice(end),/'reclass-action-workflow-v6-smart-shield-20261009','Eval Work final state preserves/);
  assert.throws(()=>currentSmartPublicContract(smart.replace('-- Eval Work uses the same V6 live transaction','changed')),/BOUNDARY_CHANGED/);
  const ledger=currentReclassLedgerContract(read('supabase/tests/inventory_reclass_moves_v1_test.sql').replaceAll('\r\n','\n'),read);
  assert.match(ledger,/e\.value->'row' is distinct from to_jsonb\(master\)/);
  assert.match(ledger,/master\.unique_id is null/);
  assert.match(ledger,/or exists\(select 1 from public\.ph_crop_roll_drive_rows crop/);
  assert.match(ledger,/count\(\*\)=3 and bool_and\(tgenabled='D'\)/);
  assert.doesNotMatch(ledger,/set-based crop-roll projection differs from full authoritative mapper output/);
  assert.throws(()=>currentReclassLedgerContract('unregistered ledger'),/BOUNDARY_CHANGED/);
}

export function assertPortableCommittedFixtureRoots() {
  for(const [temporary,paths] of [['C:\\fixture tmp',path.win32],['/tmp/fixture',path.posix]]) {
    const roots=committedFixtureRoots(temporary,paths);
    assert.equal(paths.isAbsolute(roots.production),true);
    assert.equal(paths.isAbsolute(roots.sandbox),true);
    assert.equal(paths.dirname(roots.production),temporary);
    assert.equal(paths.dirname(roots.sandbox),temporary);
    assert.notEqual(roots.production,roots.sandbox);
    assert.equal(paths.isAbsolute(paths.join(roots.production,'canonical-fixtures','fixture.sql')),true);
  }
}

export function assertCanonicalRuntimeFixtures(read) {
  const names=['application_conflict_http_status','bulk_master_snapshot_v1','indexed_photo_evidence_lookup',
    'inventory_reclass_move_delivery_v1','inventory_reclass_moves_v1','prompt25_editable_fields_v7',
    'reclass_server_revision','reclass_sheared_action_v5','request_queue_remove_v1','sales_rep_inventory_operations',
    'smart_priority_hold_shield_v6','suspend_tag_close_contract','v2315_reclass_email_delivery','v2315_reclass_email_runtime'];
  const compiled=new Map();
  for(const name of names) {
    const file='supabase/tests/'+name+'_test.sql',original=read(file);
    const current=compileCanonicalRuntimeFixture(file,original,read);
    assert.notEqual(current,original,file);
    assert.match(current,/CANONICAL_RUNTIME_FIXTURE_REQUIRES_DISPOSABLE_SCHEMA/);
    assert.throws(()=>compileCanonicalRuntimeFixture(file,original+'\n',read),/canonical fixture source changed/);
    compiled.set(name,current);
  }
  const ordinary='begin; select 1; rollback;';
  assert.equal(compileCanonicalRuntimeFixture('supabase/tests/unregistered_test.sql',ordinary,read),ordinary);
  const template=read('src/services/canonical-runtime-fixtures/actor-matrix.sql');
  const denied="insert into private.app_access_user_overrides(policy_id,profile_id,permission_key,allowed,access_scope) select null,id,'drive.reclass.submit',false,'global' from actors;";
  assert.throws(()=>grantCanonicalFixtureAuthority(denied,template,'reclass'),/ANCHOR_MISSING/);
  assert.throws(()=>grantCanonicalFixtureAuthority(denied.replace("false,'global'","true,'assigned'"),template,'reclass'),/ANCHOR_MISSING/);
  assert.match(compiled.get('inventory_reclass_moves_v1'),/RETURNING profile_id[\s\S]*JOIN fixture_admitted admitted ON admitted.profile_id=p.id/);
  assert.match(template,/CASE WHEN upper\(p.role\) LIKE '%EVAL%' THEN 'N' ELSE 'Y' END/);
  assert.match(compiled.get('sales_rep_inventory_operations'),/"can_access_manager_tab":false/);
  assert.match(compiled.get('reclass_server_revision'),/'42501','DRIVE_RECLASS_FORBIDDEN','missing global watermark/);
  assert.match(compiled.get('request_queue_remove_v1'),/customer_consignee_label,last_event\)/);
  assert.match(compiled.get('indexed_photo_evidence_lookup'),/CI-PHOTO-INDEX-1/);
  assert.doesNotMatch(compiled.get('indexed_photo_evidence_lookup'),/'missing','\[\]'/);
  assert.match(compiled.get('inventory_reclass_move_delivery_v1'),/run_scoped_reclass_inquiry_v3076/);
  assert.match(compiled.get('suspend_tag_close_contract'),/close_branch !~\*/);
  assert.match(compiled.get('bulk_master_snapshot_v1'),/exactly three crop hooks disabled/);
  assert.throws(()=>replaceFixtureText('duplicate duplicate','duplicate','safe'),/ANCHOR_CHANGED/);
  assert.throws(()=>replaceFixtureText('missing','duplicate','safe'),/ANCHOR_CHANGED/);
}

export function assertFourCallerRecovery(read,functionSource) {
  const migrationName = '20261026140000_agdata_v2369_emergency_recovery.sql';
  const migration = read(`supabase/migrations/${migrationName}`);
  const runtime = read('assets/app-runtime.js');
  const appApi = read('supabase/functions/app-api/index.ts');
  const appsScript = read('Code.gs');
  for (const relation of ['ph_master_inventory', 'ph_cav_import', 'ph_reserves', 'ph_soc_master',
    'ph_customer_consignee_sales_reps', 'ph_request_delivery_outbox', 'ph_request_delivery_worker_state',
    'ph_request_email_threads', 'ph_requests_pending', 'ph_requests_completed_history']) {
    assert.ok(migration.includes(relation), relation);
  }
  for (const marker of ['grant select on table public.%I to anon,authenticated',
    'agdata_v2369_operational_read', 'security_invoker=true', 'claim_request_delivery_events(integer,text)',
    'safe_parse_timestamptz', "status='pending',attempt_count=0", "event_type<>'delivery_canary'",
    'old.photo_url is distinct from new.photo_url', 'old.ptronhand is distinct from new.ptronhand',
    'when (old is distinct from new)']) assert.ok(migration.includes(marker), marker);
  assert.doesNotMatch(migration, /\b(?:drop\s+table|truncate)\b/i);
  assert.match(migration, /revoke all on table public\.ph_app_users from anon[^]*revoke all on table public\.user_access_control from anon/);
  for (const marker of ['DIRECT_POSTGREST_READ_TABLES', 'fetchDirectPostgrestReadPage',
    'fetchDirectMasterInventoryPage', 'skipCustomerMapShortcut', "scheduleRequestDeliveryWake('request_created')",
    "scheduleRequestDeliveryWake('request_completed')"]) assert.ok(runtime.includes(marker), marker);
  assert.doesNotMatch(functionSource('assets/app-runtime.js', 'getLoginWarmupPlan'), /avNotes|requestHistory|reserves|soc|cav/);
  assert.doesNotMatch(functionSource('assets/app-runtime.js', 'getLoginReadyDatasetTargets'), /avNotes|requestHistory|reserves|soc|cav/);
  for (const name of ['filterEvalWorkAvNotes', 'filterPaperNcrSalesNotes', 'filterAvNotes']) {
    assert.doesNotMatch(functionSource('assets/app-runtime.js', name), /ensureDatasetLoaded\('avNotes'/);
  }
  for (const marker of ['delivery_wake', 'wake_delivery_worker', 'dispatchAuthenticatedDeliveryWake',
    'dispatchRequestDeliveryWorkerNow', 'eval_work_', 'shear_location_', 'location_work_']) assert.ok(appApi.includes(marker), marker);
  assert.match(appsScript, /payload\.type === 'wake_delivery_worker'[^]*processRequestDeliveryOutbox_/);
  const manifest = JSON.parse(read('package.json'));
  for (const name of ['verifyAppsScriptActionEnvelope_', 'doPost']) assert.ok(manifest.appsScriptPatchFunctions.includes(name), name);
  assert.match(read('scripts/apps-script-function-patch.mjs'), /mergeRequestDeliveryWakeDispatch[^]*DELIVERY_WAKE_REMOTE_ANCHOR/);
  const impactHeading = 'Mandatory 4-Caller & All-11-Gems Impact Contract';
  assert.ok(read('AGENTS.md').includes(impactHeading));
  for (const skill of ['agdata-app-shell-and-navigation', 'agdata-aura-assistant',
    'agdata-bloom-and-request-specialist', 'agdata-docks-and-orders-specialist',
    'agdata-drive-and-av-specialist', 'agdata-field-ops-and-qc',
    'agdata-queue-and-reclass-specialist', 'agdata-release-governor',
    'agdata-runtime-watchdog', 'agdata-skill-learner',
    'agdata-sync-and-supabase-architect', 'agdata-zero-lockout-guard']) {
    const body = read(`.codex/skills/${skill}/SKILL.md`);
    assert.ok(body.includes(impactHeading), skill);
    assert.ok(body.includes("Never approve a cross-layer change from one caller's tests alone"), skill);
  }
  const runner = read('scripts/apply-item-low-stock-migration.mjs');
  assert.match(runner, /agdataV2369EmergencyRecoveryMigrationName[^]*registeredReleaseDatabaseMigrations/);
  assert.ok(runner.includes(migrationName));
}

export async function assertSelectedRepHydration(read,runFunctions,functionSource) {
  const calls = [];
  const context = runFunctions('assets/app-runtime.js', ['fetchRequestCustomerMapRowsForRepName'], {
    resolveCanonicalRequestRepName: value => value,
    normalizeRepDisplayOrder: value => String(value || '').trim(),
    normalizeRepMatchToken: value => String(value || '').trim().toLowerCase(),
    fetchAllSupabaseRows: async (table, query, options) => {
      calls.push({ table, query, options });
      if (calls.length === 1) throw Object.assign(new Error('direct read cancelled'), { code: 'REQUEST_ABORTED' });
      return [
        { unique_id: 'one', salesrepid: 'S27', salesrepname: 'Josh Ringleb' },
        { unique_id: 'two', salesrepid: 'S27', salesrepname: 'Josh Ringleb' },
      ];
    },
    isActiveRequestCustomerMapping: () => true,
    getCustomerRepMapRepValue: row => row.salesrepname,
    matchSalesRepIdentity: (left, right) => String(left || '').toLowerCase() === String(right || '').toLowerCase(),
    window: { setTimeout },
  });
  const result = await context.fetchRequestCustomerMapRowsForRepName('Josh Ringleb');
  assert.equal(result.salesrepId, 'S27');
  assert.equal(result.rows.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].table, 'ph_customer_consignee_sales_reps');
  assert.match(calls[1].query, /salesrepname=eq\.Josh%20Ringleb/);
  assert.match(calls[1].query, /customerstatus=eq\.A&consigneestatus=eq\.A/);
  assert.equal(calls[1].options.requireComplete, true);
  assert.equal(calls[1].options.skipCustomerMapShortcut, true);
  assert.equal(calls[1].options.forceFresh, true);
  const ensureSource = functionSource('assets/app-runtime.js', 'ensureRequestModalCustomerOptionsReady');
  assert.match(ensureSource, /if \(!rep\) await prefetchRequestModalCustomerOptions\(force\)/);
  assert.ok(ensureSource.indexOf('await loadRequestModalCustomerOptionsForRep') < ensureSource.indexOf('const id = getRequestSelectedSalesrepId'));
  assert.match(read('.codex/skills/agdata-bloom-and-request-specialist/SKILL.md'), /Never block Customer\/Consignee selection on a full mapping download/);
}

export async function assertTypedSuspendBoundary(read,databaseBridge) {
  const calls = [];
  const bridge = databaseBridge(async (...args) => {
    calls.push(args);
    return new Response('[]');
  });
  await bridge.fetchTable('https://fixture.invalid', 'ph_active_suspend',
    'select=unique_id,commonname,locationcode&order=unique_id.asc&limit=1', { method: 'GET' }, 1000, 'suspend queue');
  assert.equal(new URL(calls[0][0]).pathname, '/rest/v1/ph_active_suspend');
  await assert.rejects(bridge.fetchTable('https://fixture.invalid', 'ph_active_suspend',
    'select=unknown_suspend_field', { method: 'GET' }, 1000, 'suspend queue'), /Unknown.*column/);
  assert.equal(calls.length, 1);
  assert.match(read('.codex/skills/agdata-queue-and-reclass-specialist/SKILL.md'), /Never add a direct operational view to the runtime allowlist without a finite typed browser alias/);
}

export function assertSingleMasterHydration(read,runFunctions,functionSource) {
  const context = runFunctions('assets/app-runtime.js', ['canonicalizeProductionCoreLiveKeys'], { Array, Set });
  assert.deepEqual(Array.from(context.canonicalizeProductionCoreLiveKeys(['avOpen', 'master', 'reserves', 'master'])),
    ['master', 'reserves']);
  const liveContext = functionSource('assets/app-runtime.js', 'getProductionLiveSyncContext');
  assert.match(liveContext, /canonicalizeProductionCoreLiveKeys\(registry\.getCoreKeys\(targetView, targetContext\)\)/);
  assert.match(read('.codex/skills/agdata-drive-and-av-specialist/SKILL.md'), /Never let `avOpen` and `master` create duplicate live-sync adapters/);
}

export function assertBoundedMasterHydration(read,functionSource) {
  const directSource = functionSource('assets/app-runtime.js', 'fetchDirectMasterInventoryPage');
  const pagingSource = functionSource('assets/app-runtime.js', 'fetchAllInventoryReadRows');
  const adapterSource = functionSource('assets/app-runtime.js', 'createProductionCoreLiveAdapter');
  assert.match(directSource, /count:\s*false/);
  assert.doesNotMatch(directSource, /count:\s*true/);
  assert.match(directSource, /unique_id=gt\.\$\{encodeURIComponent\(afterUniqueId\)\}/);
  assert.match(pagingSource, /afterUniqueId \? \{ \.\.\.options, afterUniqueId \} : options/);
  assert.match(pagingSource, /nextUniqueId = String\(page\.rows\.at\(-1\)\?\.unique_id/);
  assert.match(adapterSource, /Math\.min\(2, Math\.max\(1, Math\.floor\(Number\(stageOptions\.pageConcurrency\) \|\| 1\)\)\)/);
  assert.match(read('.codex/skills/agdata-drive-and-av-specialist/SKILL.md'), /Never request `count=exact` or use deep offsets on wide `ph_master_inventory` pages/);
}

export function assertExactAvHydration(read,functionSource) {
  const directSource = functionSource('assets/app-runtime.js', 'fetchDirectMasterInventoryItemRows');
  const scheduleSource = functionSource('assets/app-runtime.js', 'scheduleExactAvSearchHydration');
  const searchSource = functionSource('assets/app-runtime.js', 'handleAVSearch');
  assert.match(directSource, /fetchDirectMasterInventoryPage\(\{ projection: 'full', itemCode: safeItemCode \}, 100/);
  assert.match(directSource, /new Set\(ids\)\.size !== ids\.length/);
  assert.match(scheduleSource, /invalidateResolvedViewStateCaches\(\{ preserveAvPreparation: true \}\)/);
  assert.match(scheduleSource, /owner === getSupabaseReadIdentityScope\(\)/);
  assert.match(scheduleSource, /installExactAvSearchHydrationRows\(rows, owner, permissionVersion, itemCode\)/);
  assert.match(scheduleSource, /isViewVisible\('av'\) && remainsCurrent\(\)\) renderAV\(\)/);
  assert.match(scheduleSource, /preferAnon: true/);
  assert.doesNotMatch(scheduleSource, /setTimeout\(async/);
  assert.match(searchSource, /scheduleExactAvSearchHydration\(term\)/);
  assert.match(functionSource('assets/app-runtime.js', 'fetchDirectPostgrestReadPage'), /opts\.preferAnon === true \? null : await getNativeAuthRequestHeaders/);
  assert.match(functionSource('assets/app-runtime.js', 'canUseDatasetForImmediateRender'), /hasCurrentExactAvSearchHydration\(\)/);
  assert.match(functionSource('assets/app-runtime.js', 'previewProductionSnapshots'), /mergeExactAvSearchRowsIntoPreview\(payload\.data, context\)/);
  assert.match(functionSource('assets/app-runtime.js', 'getCurrentExactAvSearchHydrationRows'), /context\.readIdentity/);
  assert.match(functionSource('assets/app-runtime.js', 'buildResolvedAVBaseState'), /getAvSalesRowsForBucket\(activeAvSalesBucket, exactSearchRows\)/);
  assert.match(read('.codex/skills/agdata-drive-and-av-specialist/SKILL.md'), /Never make an exact AV itemcode search wait for a near-tail full-cohort page/);
}
