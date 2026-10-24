import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { X509Certificate } from 'node:crypto';
import pg from 'pg';
import yaml from 'js-yaml';
import {
  validateDatabaseTarget, migrationBody, applyItemLowStockMigration, migrationName, managerReportReadV2MigrationName, managerListReadV2MigrationName, inventoryLocationOnHandMigrationName, masterInventoryRealtimeMigrationName, eval2SharedLowStockThresholdMigrationName, masterLineageCleanupMigrationName, seasonSalesCavLookupMigrationName, seasonSalesEmptyCleanupMigrationName, seasonSalesWorklistMigrationName, inventoryAssignmentBatchesMigrationName, inventoryAssignmentWitnessMigrationName, inventoryAssignmentInputGenerationMigrationName, customerAssignmentOverridesMigrationName, bulkMasterSnapshotMigrationName, importHistoryRoutingMigrationName, handoverMasterAssignmentFastPathMigrationName, bulkContextIndexPlanMigrationName, managerModuleRevisionSignalsMigrationName, inventoryReclassMovesMigrationName, inventoryReclassQuantityTriggerFastpathsMigrationName, inventoryReclassCompactTriggerIdentityMigrationName, inventoryReclassCompactBatchChildReceiptsMigrationName, inventoryReclassNullElisionRpcMigrationName, masterIdentityBatchReadMigrationName, bunchNoteMultiAssignmentRoutingMigrationName, bunchNoteBlueprintHeaderPdfDeliveryMigrationName, bunchNoteQueueExecutionMigrationName, bunchNoteSupervisorAssigneeFacetsMigrationName,
  perennialAssignmentMigrationName, passwordReconciliationMigrationName, productionScheduleMigrationName, auraHrCommandCenterMigrationName, scheduledHandoverMigrationName, requestArchiveMigrationName, handoverAssignmentMigrationName, readOptimizationMigrationName, auraInventoryV2MigrationName, nellyAccessAuditMigrationName, evalDeliveryArchiveHealthMigrationName, auraInventoryMatchMigrationName, auraLlmFreeTierMigrationName, suspendTagApprovalMigrationName, structuredBunchNotesMigrationName, bunchNoteCardsMigrationName, bunchNoteCardCommandsMigrationName, reclassSplitMoveMigrationName, reclassShearedMigrationName, reclassSmartShieldMigrationName, smartShieldRawImportMigrationName, requestQueueRemoveMigrationName, prompt25HotfixMigrationName, customerRepMappingMigrationName, bunchAutoCompletionMigrationName, fieldCountingMigrationName, customerRepMappingFinalizeTimeoutMigrationName, historicalRequestsMigrationName, auraVoiceRoleAccessMigrationName, auraVoiceSocReadsMigrationName, requestMappingIdentityMigrationName, historicalRequestsPriceFallbackMigrationName, reclassConcurrentHoldMigrationName, salesActorRoleBoundariesMigrationName, navigationRoleBoundariesMigrationName, reclassEvalSubmitGuardsMigrationName, inventoryRowAssignmentAuthorityMigrationName, itemcodeDefaultOwnersMigrationName, inventoryRowAssignmentFenceIntegrationMigrationName, inventoryRowAssignmentFutureSnapshotsMigrationName, inventoryRowAssignmentLiveConsumersMigrationName, auraInternalQueryMigrationName, auraCommonNamePriorityMigrationName, auraDynamicSeasonScopeMigrationName, auraInventoryExplicitProjectionMigrationName, sqlFunctionCorrectnessRepairsMigrationName, sqlLintRuntimeContextMigrationName, releaseDatabaseMigrations, requestHistoryDrilldownMigrationName, auraEnterpriseDomainVoiceMigrationName, migrationContractQuery, upsertVaultSecret,
  productionBaselineVersion,
  publishedLkgReadProofMigrationName, normalizeScopedMigrationPaths,
  suspendTagSenderIdentityMigrationName, canonicalUserAccessMigrationName, inventoryReclassMoveDeliveryMigrationName,
  masterSnapshotChunkedStagingMigrationName, masterIdentityBatchRetrySqlstateMigrationName,
  reclassEmailReportPolicyMigrationName, reclassServerRevisionMigrationName, reclassRepScopeMigrationName,
  auraDylanOwnerOnlyMigrationName, driveLocationEvidenceMigrationName, boundedRequestQueueReconciliationMigrationName, requestQuantityRecoveryMigrationName, inventoryLocationEvidenceLifecycleMigrationName, requestSalesImpactMigrationName, requestSalesImpactV2MigrationName, requestSalesImpactStrictDedupeMigrationName, requestQueuePendingReconciliationMigrationName, requestQueueLegacyOutboxReconciliationMigrationName, escapedDisplayTextNormalizationMigrationName, requestLifecycleStateMachineMigrationName,
  classifyDatabaseError, formatSafeFailure, runReadOnlySchemaDiagnostic, validateDiagnosticContext,
  createDatabaseClientOptions
} from '../scripts/apply-item-low-stock-migration.mjs';
import { perennialPreviewSql, runPerennialAssignmentPreview, getPerennialPreviewFailure } from '../scripts/preview-perennial-assignment.mjs';
import { readHistoricalMigrationManifest } from '../scripts/historical-database-fixture.mjs';
import { discoverTests } from '../scripts/test-discovery.mjs';

test('Reclass scope restoration is registered and verifies secure delegation to the current policy', () => {
  assert.equal(reclassRepScopeMigrationName, '20261020233500_reclass_rep_scope_preservation_v1.sql');
  assert.ok(releaseDatabaseMigrations.indexOf(reclassRepScopeMigrationName) < releaseDatabaseMigrations.indexOf(auraDylanOwnerOnlyMigrationName));
  assert.ok(releaseDatabaseMigrations.indexOf(auraDylanOwnerOnlyMigrationName) < releaseDatabaseMigrations.indexOf(requestSalesImpactMigrationName));
  assert.deepEqual(normalizeScopedMigrationPaths([`supabase/migrations/${reclassRepScopeMigrationName}`]),
    [reclassRepScopeMigrationName]);
  const sql = fs.readFileSync(new URL(`../supabase/migrations/${reclassRepScopeMigrationName}`, import.meta.url), 'utf8');
  assert.match(sql, /^begin;\s/i);
  assert.match(sql, /pg_get_functiondef/);
  assert.match(sql, /sales_rep_operation_scope_v1/);
  assert.match(sql, /exception when others then/);
  assert.doesNotMatch(sql, /update\s+public\.profiles|update\s+public\.user_access_control|drop\s+function\s+public\.enqueue_drive_reclass_inquiry_v7/i);
  const contract = migrationContractQuery(reclassRepScopeMigrationName);
  for (const marker of ['reclass-dylan-megan-submitter-v1', 'sales_rep_operation_scope_v1',
    'SALES_REP_OPERATION_FORBIDDEN', 'fieldEdits', 'app_access_user_overrides', 'previous_scope',
    'lock_ph_master_inventory_for_reclass_lkg_v1(true)', 'clear_current_ph_inventory_reclass_lkg_context_v1']) {
    assert.ok(contract.includes(marker), marker);
  }
  for (const earlier of [reclassEmailReportPolicyMigrationName, publishedLkgReadProofMigrationName]) {
    const query = migrationContractQuery(earlier);
    assert.match(query, /case when exists/);
    assert.match(query, /wrapper\.prosecdef/);
    assert.match(query, /result:=private\.enqueue_drive_reclass_inquiry_v7_rep_impl\(p_payload\);/);
    assert.match(query, /not has_function_privilege\('authenticated',wrapper\.oid,'execute'\)/);
    assert.match(query, /else to_regprocedure\('public\.enqueue_drive_reclass_inquiry_v7\(jsonb\)'\) end/);
  }
});

test('published LKG read proof migration is scoped, registered, and rejects untrusted receipt paths', () => {
  assert.ok(releaseDatabaseMigrations.includes(publishedLkgReadProofMigrationName));
  assert.equal(publishedLkgReadProofMigrationName, '20261020161833_published_lkg_read_proof_v1.sql');
  assert.deepEqual(normalizeScopedMigrationPaths([`supabase/migrations/${publishedLkgReadProofMigrationName}`]),
    [publishedLkgReadProofMigrationName]);
  assert.throws(() => normalizeScopedMigrationPaths([`../migrations/${publishedLkgReadProofMigrationName}`]),
    /LOW_STOCK_SCOPED_MIGRATION_PATH_INVALID/);
  assert.throws(() => normalizeScopedMigrationPaths(['supabase/migrations/20261020161833_unlisted.sql']),
    /LOW_STOCK_SCOPED_MIGRATION_NOT_ALLOWLISTED/);
  const sql = fs.readFileSync(new URL(`../supabase/migrations/${publishedLkgReadProofMigrationName}`, import.meta.url), 'utf8');
  assert.match(sql, /published_snapshot_read_proof\(text,\s*bigint\)/i);
  assert.match(sql, /mutationAllowed/);
  const contract = migrationContractQuery(publishedLkgReadProofMigrationName);
  assert.match(contract, /published_snapshot_read_proof/);
  assert.match(contract, /app_sync_private\.snapshot/);
  assert.match(contract, /lock_ph_master_inventory_for_reclass_lkg_v1/);
});
test('v2.2.1 Bunch Notes migration is selected and loadable by the production migration runner', () => {
  assert.ok(releaseDatabaseMigrations.includes(bunchNoteBlueprintHeaderPdfDeliveryMigrationName));
  assert.equal(bunchNoteBlueprintHeaderPdfDeliveryMigrationName, '20261018014347_bunch_note_blueprint_header_pdf_delivery.sql');
  const sourceUrl = new URL(`../supabase/migrations/${bunchNoteBlueprintHeaderPdfDeliveryMigrationName}`, import.meta.url);
  const source = fs.readFileSync(sourceUrl, 'utf8');
  assert.match(source, /^begin;\s/i);
  assert.match(source, /add column destination_qualifier/i);
  assert.match(source, /add column workflow_instructions/i);
  assert.match(source, /add column left_margin/i);
  const contract = migrationContractQuery(bunchNoteBlueprintHeaderPdfDeliveryMigrationName);
  assert.match(contract, /information_schema\.columns/);
  assert.match(contract, /recipients_for_reports/);
  assert.match(contract, /validate_blueprint_header/);
  assert.match(contract, /not p\.prosecdef and p\.proconfig/);
  assert.match(contract, /not has_function_privilege\('service_role',p\.oid,'execute'\)/);
  assert.match(contract, /as installed/);
});

test('v2.2.1 registered migration applies exact source and verifies idempotent replay', async () => {
  const source = fs.readFileSync(new URL(`../supabase/migrations/${bunchNoteBlueprintHeaderPdfDeliveryMigrationName}`, import.meta.url), 'utf8');
  const body = migrationBody(source);
  const contract = migrationContractQuery(bunchNoteBlueprintHeaderPdfDeliveryMigrationName);
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('select name, statements')) return { rows: [] };
    if (sql === contract) return { rows: [{ installed: true }] };
    return { rows: [] };
  } };
  assert.deepEqual(await applyItemLowStockMigration({ client, source, targetMigrationName: bunchNoteBlueprintHeaderPdfDeliveryMigrationName }), { status: 'applied' });
  assert.ok(calls.some(call => call.sql === body), 'runner executes the loaded canonical migration source');
  const history = calls.find(call => call.sql.startsWith('insert into supabase_migrations.schema_migrations'));
  assert.deepEqual(history.params.slice(0, 2), ['20261018014347', 'bunch_note_blueprint_header_pdf_delivery']);
  assert.deepEqual(history.params[2], [body]);
  assert.equal(calls.at(-1).sql, 'commit');

  const retryCalls = [];
  const retry = { query: async (sql) => {
    retryCalls.push(sql);
    if (sql.startsWith('select name, statements')) return { rows: [{
      name: 'bunch_note_blueprint_header_pdf_delivery', statements: [body]
    }] };
    if (sql === contract) return { rows: [{ installed: true }] };
    return { rows: [] };
  } };
  assert.deepEqual(await applyItemLowStockMigration({ client: retry, source, targetMigrationName: bunchNoteBlueprintHeaderPdfDeliveryMigrationName }), { status: 'already_applied' });
  assert.ok(!retryCalls.includes(body), 'an exact history replay does not rerun the SQL');
  assert.equal(retryCalls.at(-1), 'commit');
});

test('migration target is the configured Supabase project and never a browser key', () => {
  const api='https://testproject.supabase.co';
  assert.ok(validateDatabaseTarget('postgresql://postgres:example@db.testproject.supabase.co:5432/postgres',api));
  assert.ok(validateDatabaseTarget('postgresql://postgres.testproject:example@aws-0-us-east-1.pooler.supabase.com:5432/postgres',api));
  assert.equal(new URL(validateDatabaseTarget('postgresql://postgres.testproject:example@aws-0-us-east-1.pooler.supabase.com:6543/postgres',api)).port,'5432');
  assert.throws(()=>validateDatabaseTarget('',api),/DB_URL_MISSING/);
  assert.throws(()=>validateDatabaseTarget('postgresql://postgres:example@db.other.supabase.co/postgres',api),/TARGET_MISMATCH/);
  assert.throws(()=>validateDatabaseTarget('postgresql://postgres.other:example@aws-0-us-east-1.pooler.supabase.com/postgres',api),/TARGET_MISMATCH/);
  assert.match(validateDatabaseTarget('postgresql://postgres:example@db.testproject.supabase.co/postgres',api),/sslmode=verify-full/);
  assert.throws(()=>validateDatabaseTarget('postgresql://postgres:example@db.testproject.supabase.co/postgres?host=other.example',api),/TARGET_INVALID/);
  assert.throws(()=>validateDatabaseTarget('postgresql://postgres:example@db.testproject.supabase.co/postgres?sslmode=disable',api),/TLS_REQUIRED/);
});

test('Drive evidence reconciliation is registered with durable location and request contracts', () => {
  assert.equal(driveLocationEvidenceMigrationName, '20261023220000_drive_location_evidence_and_request_reconciliation_v1.sql');
  assert.ok(releaseDatabaseMigrations.indexOf(driveLocationEvidenceMigrationName)
    < releaseDatabaseMigrations.indexOf(boundedRequestQueueReconciliationMigrationName));
  assert.deepEqual(normalizeScopedMigrationPaths([`supabase/migrations/${driveLocationEvidenceMigrationName}`]),
    [driveLocationEvidenceMigrationName]);
  const query = migrationContractQuery(driveLocationEvidenceMigrationName);
  for (const marker of ['inventory_location_evidence_v1', 'save_drive_evidence_v3',
    'request_lifecycle_tombstones_v1', 'reconcile_active_requests_from_outbox_v1',
    "'''previewHasMore'',false", 'eval_work_natural_sort_key_v1(p.lotcode)']) assert.ok(query.includes(marker), marker);
});

test('bounded Request recovery is registered and preserves the atomic submission contract', () => {
  assert.equal(boundedRequestQueueReconciliationMigrationName, '20261023233000_bounded_request_queue_reconciliation_v2.sql');
  assert.ok(releaseDatabaseMigrations.indexOf(boundedRequestQueueReconciliationMigrationName)
    < releaseDatabaseMigrations.indexOf(requestQuantityRecoveryMigrationName));
  const sql = fs.readFileSync(new URL(`../supabase/migrations/${boundedRequestQueueReconciliationMigrationName}`, import.meta.url), 'utf8');
  assert.match(sql, /order by o\.created_at desc,o\.event_id desc\s+limit 100/);
  assert.match(sql, /regexp_matches/);
  assert.match(sql, /ATOMIC_REQUEST_SUBMISSION_CONTRACT_INVALID/);
  assert.doesNotMatch(sql, /update public\.ph_active_request set req_qty='1'/);
  const contract = migrationContractQuery(boundedRequestQueueReconciliationMigrationName);
  for (const marker of ['ph_request_delivery_outbox_request_created_recent_idx', 'limit 100',
    'private.insert_request_batch(uuid,jsonb,text)', 'app_dataset_revision_inserted']) assert.ok(contract.includes(marker), marker);
});

test('exact pending Request quantities are release-registered without rewriting delivery history', () => {
  assert.equal(requestQuantityRecoveryMigrationName, '20261023234500_request_quantity_recovery_v3.sql');
  assert.ok(releaseDatabaseMigrations.indexOf(requestQuantityRecoveryMigrationName)
    < releaseDatabaseMigrations.indexOf(inventoryLocationEvidenceLifecycleMigrationName));
  const sql = fs.readFileSync(new URL(`../supabase/migrations/${requestQuantityRecoveryMigrationName}`, import.meta.url), 'utf8');
  for (const marker of ['REQ-mvlgbfl7p8r8zxrj97j', 'REQ-mvlg4t85vlzf7053pv', 'REQ-mvlfib5eqwa3typzcqq',
    'REQ-mvlfib5evawvlvvx09', 'REQ-mvlex5bay7ngnehzi7', 'REQ-mvlbp5hkkk58akaubms', 'REQ-mvk1xgv2ty9fttuqj2']) assert.match(sql, new RegExp(marker));
  assert.match(sql, /lower\(btrim\(coalesce\(active\.req_status,''\)\)\)='pending'/);
  assert.match(sql, /app_dataset_revision_updated/);
  assert.doesNotMatch(sql, /update\s+public\.ph_request_delivery_outbox/i);
  const contract = migrationContractQuery(requestQuantityRecoveryMigrationName);
  for (const marker of ['app_dataset_revision_updated', 'REQ-mvlgbfl7p8r8zxrj97j', "'10'::text", "'4'::text"]) assert.ok(contract.includes(marker), marker);
});

test('location evidence lifecycle is release-registered with exact depletion and expiry contracts', () => {
  assert.equal(inventoryLocationEvidenceLifecycleMigrationName, '20261023235500_inventory_location_evidence_lifecycle_v2.sql');
  assert.ok(releaseDatabaseMigrations.indexOf(inventoryLocationEvidenceLifecycleMigrationName) < releaseDatabaseMigrations.indexOf(requestSalesImpactMigrationName));
  const sql = fs.readFileSync(new URL(`../supabase/migrations/${inventoryLocationEvidenceLifecycleMigrationName}`, import.meta.url), 'utf8');
  for (const marker of ['baseline_on_hand', 'loc_match_pct', 'initial_photo_match_qty', 'current_photo_match_qty',
    "America/Chicago", "time '23:59:59'", 'request-history-harvest-v2', 'inventory_location_evidence_lifecycle_v2']) assert.match(sql, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(sql, /greatest\(0,p_initial_photo_match_qty-greatest\(0,p_baseline_on_hand-p_current_on_hand\)\)/);
  assert.match(sql, /spec=null,match=null,loc_match_qty=null,av_note=null,pic_note=null,sales_note=null/);
  const contract = migrationContractQuery(inventoryLocationEvidenceLifecycleMigrationName);
  for (const marker of ['baseline_on_hand', 'current_photo_match_qty', 'America/Chicago',
    'inventory_location_evidence_lifecycle_v2']) assert.ok(contract.includes(marker), marker);
});

test('Request Sales Impact RPC is release-registered and service-role-only', () => {
  assert.equal(requestSalesImpactMigrationName, '20261023235900_request_sales_impact_v1.sql');
  assert.ok(releaseDatabaseMigrations.indexOf(requestSalesImpactMigrationName) < releaseDatabaseMigrations.indexOf(requestSalesImpactV2MigrationName));
  const sql = fs.readFileSync(new URL(`../supabase/migrations/${requestSalesImpactMigrationName}`, import.meta.url), 'utf8');
  for (const marker of ['get_request_sales_impact_v1', 'ph_request_history', 'ph_request_delivery_outbox',
    'coalesce(d.raw_qty,25::numeric)', 'request_key_norm,dedupe_item_key,location_key,lot_key']) assert.ok(sql.replaceAll(' ', '').includes(marker.replaceAll(' ', '')), marker);
  assert.match(sql, /revoke all on function public\.get_request_sales_impact_v1\(\) from public,anon,authenticated/);
  assert.match(sql, /grant execute on function public\.get_request_sales_impact_v1\(\) to service_role/);
  const contract = migrationContractQuery(requestSalesImpactMigrationName);
  for (const marker of ['get_request_sales_impact_v1', 'ph_request_history', 'ph_request_delivery_outbox', 'service_role']) assert.ok(contract.includes(marker), marker);
});

test('Request Sales Impact v2 audits full tables and preserves physical request rows', () => {
  assert.equal(requestSalesImpactV2MigrationName, '20261024010000_request_sales_impact_v2.sql');
  assert.ok(releaseDatabaseMigrations.indexOf(requestSalesImpactV2MigrationName) < releaseDatabaseMigrations.indexOf(requestSalesImpactStrictDedupeMigrationName));
  const sql = fs.readFileSync(new URL(`../supabase/migrations/${requestSalesImpactV2MigrationName}`, import.meta.url), 'utf8');
  for (const marker of ['get_request_sales_impact_v2', "set statement_timeout='60s'", 'jsonb_array_elements',
    'with ordinality', "regexp_matches(event.html,'<tr[^>]*>(.*?)</tr>','gis')", 'line_identity_key',
    'catalog_by_size', 'source_table_audit', 'duplicate_submitted_completed_pairs_merged']) assert.ok(sql.toLowerCase().includes(marker.toLowerCase()), marker);
  assert.doesNotMatch(sql, /\blimit\b/i);
  assert.match(sql, /revoke all on function public\.get_request_sales_impact_v2\(\) from public,anon,authenticated/);
  assert.match(sql, /grant execute on function public\.get_request_sales_impact_v2\(\) to service_role/);
  const contract = migrationContractQuery(requestSalesImpactV2MigrationName);
  for (const marker of ['get_request_sales_impact_v2', 'statement_timeout=60s', 'line_identity_key', 'source_table_audit', 'service_role']) assert.ok(contract.includes(marker), marker);

  assert.equal(requestSalesImpactStrictDedupeMigrationName, '20261024023000_request_sales_impact_strict_dedupe_v3.sql');
  assert.ok(releaseDatabaseMigrations.indexOf(requestSalesImpactStrictDedupeMigrationName) < releaseDatabaseMigrations.indexOf(requestQueuePendingReconciliationMigrationName));
  const strictSql = fs.readFileSync(new URL(`../supabase/migrations/${requestSalesImpactStrictDedupeMigrationName}`, import.meta.url), 'utf8');
  for (const marker of ['strict_9_field_cross_table_v1', 'strict_business_key', 'source_copy_ordinal',
    'exact_9_field_cross_table_mirrors_merged', 'outbox_event_types', 'previous_v2_merge_audit',
    'ph_request_email_threads']) assert.ok(strictSql.includes(marker), marker);
  assert.doesNotMatch(strictSql, /\blimit\b/i);
  assert.match(strictSql, /revoke all on function public\.get_request_sales_impact_v2\(\) from public,anon,authenticated/);
  const strictContract = migrationContractQuery(requestSalesImpactStrictDedupeMigrationName);
  for (const marker of ['strict_9_field_cross_table_v1', 'strict_business_key', 'source_copy_ordinal',
    'outbox_event_types', 'previous_v2_merge_audit', 'service_role']) assert.ok(strictContract.includes(marker), marker);
});

test('all-event Request reconciliation is release-registered and preserves only pending active rows', () => {
  assert.equal(requestQueuePendingReconciliationMigrationName, '20261024060000_request_queue_pending_reconciliation_v3.sql');
  assert.ok(releaseDatabaseMigrations.indexOf(requestQueuePendingReconciliationMigrationName) < releaseDatabaseMigrations.indexOf(requestQueueLegacyOutboxReconciliationMigrationName));
  const sql = fs.readFileSync(new URL(`../supabase/migrations/${requestQueuePendingReconciliationMigrationName}`, import.meta.url), 'utf8');
  for (const marker of ['request_completed', 'ph_request_queue_removal_commands', 'request_lifecycle_tombstones_v1',
    'REQUEST_TERMINAL_HISTORY_PRESERVATION_INCOMPLETE', 'REQUEST_CREATED_RECONCILIATION_INCOMPLETE',
    'delete from public.ph_active_request', 'request_queue_expected_pending_v3']) assert.ok(sql.includes(marker), marker);
  assert.doesNotMatch(sql, /order by o\.created_at desc,o\.event_id desc\s+limit 100/);
  assert.match(sql, /perform private\.upsert_request_history[^]*delete from public\.ph_active_request/);
  const contract = migrationContractQuery(requestQueuePendingReconciliationMigrationName);
  for (const marker of ['ph_request_delivery_outbox_request_completed_recent_idx', 'ph_request_queue_removal_commands_request_uid_idx',
    'request_completed', 'request_lifecycle_tombstones_v1', 'statement_timeout=30s', 'service_role']) assert.ok(contract.includes(marker), marker);
});

test('legacy Request outbox recovery ignores inferred removals and absent customer identity enrichment', () => {
  assert.equal(requestQueueLegacyOutboxReconciliationMigrationName, '20261024061500_request_queue_legacy_outbox_reconciliation_v4.sql');
  assert.ok(releaseDatabaseMigrations.indexOf(requestQueueLegacyOutboxReconciliationMigrationName) < releaseDatabaseMigrations.indexOf(escapedDisplayTextNormalizationMigrationName));
  const sql = fs.readFileSync(new URL(`../supabase/migrations/${requestQueueLegacyOutboxReconciliationMigrationName}`, import.meta.url), 'utf8');
  for (const marker of ['reconcile_legacy_pending_requests_from_outbox_v4', 'legacy-explicit-removal', 'outbox_recovery',
    'REQUEST_LEGACY_PENDING_ROWS_MISSING', 'REQUEST_FALSE_LEGACY_TOMBSTONES_REMAIN',
    'reconcile_active_requests_from_outbox_v1']) assert.ok(sql.includes(marker), marker);
  const functionBody = sql.slice(sql.indexOf('create or replace function private.reconcile_legacy_pending_requests_from_outbox_v4'), sql.indexOf('revoke all on function private.reconcile_legacy_pending_requests_from_outbox_v4'));
  assert.doesNotMatch(functionBody, /customeridentityid|consigneeidentityid/);
  const contract = migrationContractQuery(requestQueueLegacyOutboxReconciliationMigrationName);
  for (const marker of ['reconcile_legacy_pending_requests_from_outbox_v4', 'legacy-explicit-removal', 'outbox_recovery',
    'customeridentityid', 'request_completed', 'ph_request_queue_removal_commands', 'service_role']) assert.ok(contract.includes(marker), marker);
});

test('escaped display text cleanup is release-registered and guards every import table', () => {
  assert.equal(escapedDisplayTextNormalizationMigrationName, '20261024070000_escaped_display_text_normalization_v1.sql');
  assert.equal(releaseDatabaseMigrations.indexOf(requestLifecycleStateMachineMigrationName), releaseDatabaseMigrations.indexOf(escapedDisplayTextNormalizationMigrationName) + 1);
  const sql = fs.readFileSync(new URL(`../supabase/migrations/${escapedDisplayTextNormalizationMigrationName}`, import.meta.url), 'utf8');
  for (const marker of ['normalize_escaped_display_text_v1', 'Alexander', 'Alice', 'Endless Summer',
    'ph_master_inventory', 'ph_active_request', 'ph_request_history', 'ph_soc_master', 'ph_reserves', 'ph_cav_import',
    'ESCAPED_COMMONNAME_CLEANUP_INCOMPLETE']) assert.ok(sql.includes(marker), marker);
  assert.equal((sql.match(/create trigger a000_normalize_escaped_display_text_v1/g) || []).length, 6);
  assert.match(sql, /regexp_replace\(p_value/);
  const contract = migrationContractQuery(escapedDisplayTextNormalizationMigrationName);
  for (const marker of ['normalize_escaped_display_text_v1', 'a000_normalize_escaped_display_text_v1',
    'ph_master_inventory', 'ph_active_request', 'ph_request_history', 'ph_soc_master', 'ph_reserves', 'ph_cav_import']) assert.ok(contract.includes(marker), marker);
});

test('mapping publication is release-registered and protects raw source data and writes', () => {
  assert.ok(releaseDatabaseMigrations.includes(customerRepMappingMigrationName));
  assert.ok(releaseDatabaseMigrations.indexOf(customerRepMappingMigrationName) < releaseDatabaseMigrations.indexOf(bunchAutoCompletionMigrationName));
  const query = migrationContractQuery(customerRepMappingMigrationName);
  assert.match(query, /customer_rep_mapping_manage_v1\(uuid,text,jsonb\)/);
  assert.match(query, /finalize_customer_rep_mapping_import_v1\(uuid\)/);
  assert.match(query, /require_active_customer_mapping_for_request_v1/);
  assert.match(query, /require_active_customer_mapping_for_request_update_v1/);
  assert.match(query, /not has_column_privilege\('authenticated'.*'raw_data','select'\)/);
  assert.match(query, /not has_function_privilege\('anon'.*finalize_customer_rep_mapping_import_v1/);
  assert.match(query, /as installed/);
});

test('mapping finalizer timeout is function-scoped and retains trusted importer ACLs', () => {
  assert.ok(releaseDatabaseMigrations.includes(customerRepMappingFinalizeTimeoutMigrationName));
  const query = migrationContractQuery(customerRepMappingFinalizeTimeoutMigrationName);
  assert.match(query, /statement_timeout=55s/);
  assert.match(query, /has_function_privilege\('service_role'.*finalize_customer_rep_mapping_import_v1/);
  assert.match(query, /not has_function_privilege\('authenticated'.*finalize_customer_rep_mapping_import_v1/);
  assert.match(query, /not has_function_privilege\('anon'.*finalize_customer_rep_mapping_import_v1/);
});

test('customer assignment overrides deploy with private storage and protected manager operations', () => {
  assert.ok(releaseDatabaseMigrations.indexOf(customerAssignmentOverridesMigrationName)
    < releaseDatabaseMigrations.indexOf(bulkMasterSnapshotMigrationName));
  const query = migrationContractQuery(customerAssignmentOverridesMigrationName);
  for (const table of ['customer_rep_assignment_sources', 'customer_rep_assignment_overrides', 'customer_rep_assignment_receipts']) {
    assert.ok(query.includes(table));
  }
  assert.match(query, /bool_and\(c\.relrowsecurity\)/);
  assert.match(query, /not has_table_privilege\('authenticated'/);
  assert.match(query, /not has_table_privilege\('anon'/);
  assert.match(query, /has_function_privilege\('service_role'.*customer_rep_mapping_manage_v1/);
  assert.match(query, /not has_function_privilege\('authenticated'.*customer_rep_mapping_manage_v1/);
  assert.match(query, /not has_function_privilege\('anon'.*customer_rep_mapping_manage_v1/);
  assert.match(query, /statement_timeout=55s/);
  assert.match(query, /customer_rep_assignment_receipt_replay_v1/);
  assert.match(query, /customer_rep_assignment_apply_overrides_v1/);
});

test('bulk master ingestion deploys after assignment overrides with protected storage and bounded execution', () => {
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(customerAssignmentOverridesMigrationName) + 1], bulkMasterSnapshotMigrationName);
  const query = migrationContractQuery(bulkMasterSnapshotMigrationName);
  for (const marker of ['bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)',
    'ph_master_bulk_import_receipts_v1', 'ph_master_bulk_import_context_v1', 'ph_master_bulk_import_source_v1',
    'aa00_ph_master_bulk_raw_context_v1', 'aabz_ph_master_bulk_import_field_isolation_v1',
    'statement_timeout=55s', 'lock_timeout=5s', 'BULK_MASTER_IMPORT_REQUEST_ID_REUSED',
    'BULK_MASTER_IMPORT_FENCE_LOST', 'request_row.response', 'p.prosecdef', 'bool_and(c.relrowsecurity)',
    'ph_master_bulk_crop_roll_defer_active_v1()',
    'sync_ph_master_bulk_crop_roll_v1(uuid,uuid,text[])',
    'upsert_v2_crop_roll_drive_row_from_master()', 'trg_v2_master_inventory_crop_roll_drive_rows',
    'previous_crop_roll_marker', 'coalesce(previous_crop_roll_marker']) {
    assert.ok(query.includes(marker), marker);
  }
  assert.match(query, /has_function_privilege\('service_role'/);
  assert.match(query, /not has_function_privilege\('authenticated'/);
  assert.match(query, /not has_function_privilege\('anon'/);
  assert.match(query, /p\.proconfig\s*@>\s*array\['search_path=""'\]/);
  assert.match(query, /position\('ph_master_inventory_import_run_v1' in p\.prosrc\)>0/);
  assert.match(query, /position\('ph_master_bulk_import_context_v1' in p\.prosrc\)>0/);
  assert.match(query, /position\('v2_crop_roll_drive_row_from_json' in p\.prosrc\)>0/);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.ok(query.includes(`not has_table_privilege('${role}'`));
  }
});

test('import history routing is release-registered with private storage and bounded RPC contracts', () => {
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(bulkMasterSnapshotMigrationName) + 1], importHistoryRoutingMigrationName);
  const query = migrationContractQuery(importHistoryRoutingMigrationName);
  for (const marker of ['import_history_files','import_history_rows',
    'begin_import_history_v1(text,text,text,text,date,timestamptz,integer,text[],text)',
    'stage_import_history_rows_v1(uuid,jsonb)','publish_import_history_v1(uuid)',
    'list_import_history_v1(text,date,integer,integer)','get_import_history_rows_v1(uuid,integer,integer)',
    'statement_timeout=55s','IMPORT_HISTORY_RETRY_CONFLICT','IMPORT_HISTORY_ROW_RETRY_CONFLICT',
    'IMPORT_HISTORY_STAGE_GAP','IMPORT_HISTORY_ROWS_INCOMPLETE','can_manage_eval_assignments',
    'import_history_files_ready_page_idx','import_history_rows_pkey']) assert.ok(query.includes(marker), marker);
  for (const role of ['anon','authenticated','service_role']) assert.ok(query.includes(`not has_table_privilege('${role}'`));
  assert.match(query,/has_function_privilege\('service_role'/);
  assert.match(query,/not has_function_privilege\('authenticated'/);
  assert.match(query,/not has_function_privilege\('anon'/);
  assert.match(query,/has_function_privilege\('authenticated'.*execute/);
  const migration = fs.readFileSync(new URL('../supabase/migrations/' + importHistoryRoutingMigrationName, import.meta.url), 'utf8');
  assert.match(migration,/create schema if not exists import_private/);
  assert.match(migration,/alter table import_private\.import_history_files enable row level security/i);
  assert.match(migration,/alter table import_private\.import_history_rows enable row level security/i);
  assert.match(migration,/set search_path=''/i);
  assert.match(migration,/set statement_timeout='55s'/i);
  assert.match(migration,/grant execute on function public\.begin_import_history_v1[\s\S]*to service_role/i);
  assert.match(migration,/grant execute on function public\.list_import_history_v1[\s\S]*to authenticated,service_role/i);
});

test('typed handover assignment fast path deploys after import history routing and preserves the generic protected path', () => {
  const name = handoverMasterAssignmentFastPathMigrationName;
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(importHistoryRoutingMigrationName) + 1], name);
  const query = migrationContractQuery(name);
  for (const marker of ['handover_normalize_assignment_v1()', "tg_table_name=''ph_master_inventory''then", 'doc:=to_jsonb(new)', 'jsonb_populate_record(new,patch)', 'jsonb_populate_record(null::public.%i,$1)']) {
    assert.ok(query.includes(marker), marker);
  }
  assert.match(query, /prosecdef/);
  assert.match(query, /has_function_privilege\('service_role'/);
  assert.match(query, /not has_function_privilege\('authenticated'/);
  assert.match(query, /not has_function_privilege\('anon'/);
  const migration = fs.readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
  assert.match(migration, /if\s+tg_table_name\s*=\s*'ph_master_inventory'\s+then/i);
  assert.match(migration, /doc\s*:=\s*to_jsonb\(new\)/i);
  assert.match(migration, /jsonb_populate_record\(new,\s*patch\)/i);
  assert.match(migration, /security definer set search_path='' /i);
  assert.doesNotMatch(migration, /grant execute .* to (?:anon|authenticated)/i);
});

test('bulk context lookup deploys with indexed plans and unchanged protected identity branches', () => {
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(handoverMasterAssignmentFastPathMigrationName) + 1], bulkContextIndexPlanMigrationName);
  const query = migrationContractQuery(bulkContextIndexPlanMigrationName);
  for (const marker of ['ph_master_bulk_context_v1(uuid,text)', 'ph_master_bulk_context_analyze_v1()',
    'analyze app_sync_private.ph_master_bulk_import_context_v1', 't.tgtype=4', "t.tgenabled='O'",
    'ph_master_bulk_import_context_v1_pkey', 'ph_master_bulk_import_context_run_pid_xid_idx',
    'ph_master_bulk_import_context_request_canonical_idx', 'ph_master_inventory_import_lineage_seen',
    'ph_master_inventory_item6_alias_seen_v7']) assert.ok(query.includes(marker), marker);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.ok(query.includes(`not has_function_privilege('${role}'`));
  }
  assert.match(query, /prosecdef/);
  assert.match(query, /indisvalid and i\.indisready/);
});

test('manager module revision signals register with private-source and metadata-only realtime contracts', () => {
  const name = managerModuleRevisionSignalsMigrationName;
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(bulkContextIndexPlanMigrationName) + 1], name);
  const query = migrationContractQuery(name);
  for (const marker of ['app_sync_private.sources', "modules=array['managers']", "dylan_only=(key<>'production_schedule_active')",
    'count(*)=32', "t.tgenabled='O'", "p.proname='touch_source'", 't.tgtype=case t.tgname', 'public.app_dataset_revisions',
    'app_dataset_revision_read', 'not exists(select 1 from pg_publication_tables', "not has_table_privilege('anon'"]) {
    assert.ok(query.includes(marker), marker);
  }
  const sql = fs.readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
  assert.match(sql, /^begin;/i);
  assert.match(sql, /alter publication supabase_realtime add table public\.app_dataset_revisions/i);
  assert.doesNotMatch(sql, /alter publication supabase_realtime add table public\.(?:core_employees|hr_job_codes|labor_timesheets|ph_company_directory_|production_schedule_)/i);
  assert.doesNotMatch(sql, /create policy|grant .*authenticated/i);
  assert.match(sql, /commit;\s*$/i);
});

test('historical requests reporting is registered with a protected user-bound RPC contract', () => {
  assert.ok(releaseDatabaseMigrations.includes(historicalRequestsMigrationName));
  const query = migrationContractQuery(historicalRequestsMigrationName);
  for (const marker of ['historical_requests_read_v1(jsonb)', 'statement_timeout=10s',
    'historical_requests_number_v1(text)', 'historical-requests',
    "private.navigation_module_allowed_v1(actor_id,''historical-requests'')"]) {
    assert.ok(query.includes(marker), marker);
  }
  assert.match(query, /has_function_privilege\('authenticated'.*historical_requests_read_v1/);
  assert.match(query, /not has_function_privilege\('anon'.*historical_requests_read_v1/);
  assert.match(query, /not has_function_privilege\('service_role'.*historical_requests_read_v1/);
});

test('Aura SOC reads are release-registered with authenticated actor and scope guards', () => {
  assert.ok(releaseDatabaseMigrations.includes(auraVoiceSocReadsMigrationName));
  const query = migrationContractQuery(auraVoiceSocReadsMigrationName);
  for (const marker of ['aura_voice_context_v1()', 'aura_voice_soc_read_v1(text,jsonb,jsonb,integer)',
    'socReserves', 'socOpenOrders', 'requestedVariants', 'expectedSettingRevision',
    'candidateChoicesTruncated', "navigation_module_allowed_v1(p_actor_id,''reserves'')",
    "navigation_module_allowed_v1(p_actor_id,''docks'')"]) assert.ok(query.includes(marker), marker);
  assert.match(query, /has_function_privilege\('authenticated'.*aura_voice_soc_read_v1/);
  assert.match(query, /not has_function_privilege\('anon'.*aura_voice_soc_read_v1/);
  assert.match(query, /not has_function_privilege\('service_role'.*aura_voice_soc_read_v1/);
});

test('handover release requires an armed minute job or an already completed Auth ban', () => {
  const query = migrationContractQuery(scheduledHandoverMigrationName);
  assert.match(query, /completed_at is not null and auth_banned_at is not null/);
  assert.match(query, /jobname='scheduled_handover_kayla_nelly_20261002' and active and schedule='\* \* \* \* \*'/);
  assert.match(query, /command='select private\.scheduled_handover_dispatch_v1\(\);'/);
});

test('approved SQL repair contracts verify every repaired body and retain restricted execution', () => {
  assert.deepEqual(releaseDatabaseMigrations.slice(releaseDatabaseMigrations.indexOf(sqlLintRuntimeContextMigrationName)), [sqlLintRuntimeContextMigrationName, reclassShearedMigrationName, reclassSmartShieldMigrationName, smartShieldRawImportMigrationName, requestQueueRemoveMigrationName, prompt25HotfixMigrationName, customerRepMappingMigrationName, bunchAutoCompletionMigrationName, fieldCountingMigrationName, customerRepMappingFinalizeTimeoutMigrationName, historicalRequestsMigrationName, auraVoiceRoleAccessMigrationName, auraVoiceSocReadsMigrationName, requestMappingIdentityMigrationName, historicalRequestsPriceFallbackMigrationName, reclassConcurrentHoldMigrationName, salesActorRoleBoundariesMigrationName, navigationRoleBoundariesMigrationName, requestHistoryDrilldownMigrationName, auraEnterpriseDomainVoiceMigrationName, managerReportReadV2MigrationName, managerListReadV2MigrationName, inventoryLocationOnHandMigrationName, masterInventoryRealtimeMigrationName, eval2SharedLowStockThresholdMigrationName, masterLineageCleanupMigrationName,seasonSalesCavLookupMigrationName,seasonSalesEmptyCleanupMigrationName,seasonSalesWorklistMigrationName,inventoryAssignmentBatchesMigrationName,inventoryAssignmentWitnessMigrationName,inventoryAssignmentInputGenerationMigrationName, customerAssignmentOverridesMigrationName, bulkMasterSnapshotMigrationName, importHistoryRoutingMigrationName, handoverMasterAssignmentFastPathMigrationName, bulkContextIndexPlanMigrationName, managerModuleRevisionSignalsMigrationName, inventoryReclassMovesMigrationName, inventoryReclassQuantityTriggerFastpathsMigrationName, inventoryReclassCompactTriggerIdentityMigrationName, inventoryReclassCompactBatchChildReceiptsMigrationName, inventoryReclassNullElisionRpcMigrationName, masterIdentityBatchReadMigrationName,bunchNoteMultiAssignmentRoutingMigrationName,bunchNoteBlueprintHeaderPdfDeliveryMigrationName,bunchNoteQueueExecutionMigrationName,bunchNoteSupervisorAssigneeFacetsMigrationName,suspendTagSenderIdentityMigrationName,canonicalUserAccessMigrationName,inventoryReclassMoveDeliveryMigrationName,masterSnapshotChunkedStagingMigrationName,masterIdentityBatchRetrySqlstateMigrationName,reclassEmailReportPolicyMigrationName,publishedLkgReadProofMigrationName,reclassServerRevisionMigrationName, reclassRepScopeMigrationName]);
  const functions = migrationContractQuery(sqlFunctionCorrectnessRepairsMigrationName);
  for (const marker of ['inventory_rows.available', 'v_before_state_hash', 'AURA_BUNCH_CREATION_DATE_UNAVAILABLE',
    "card.row_ids @> (action->''row_ids'')", 'outbox.event_id']) assert.ok(functions.includes(marker), marker);
  const handover = migrationContractQuery(sqlLintRuntimeContextMigrationName);
  for (const marker of ['dynamic_row_key,dynamic_before_values', 'shear_entry', 'assignment_entry',
    'app.scheduled_handover_default_owner', 'gnc-reconcile-eval-itemcodes-v2']) assert.ok(handover.includes(marker), marker);
  for (const query of [functions, handover]) {
    assert.match(query, /not has_function_privilege\('anon'/);
    assert.match(query, /not has_function_privilege\('authenticated'/);
    assert.match(query, /has_function_privilege\('service_role'/);
  }
});
test('Smart Shield V6 migration is release-registered with semantic and ACL probes', () => {
  assert.equal(releaseDatabaseMigrations.indexOf(reclassSmartShieldMigrationName), releaseDatabaseMigrations.indexOf(reclassShearedMigrationName) + 1);
  const v5 = migrationContractQuery(reclassShearedMigrationName);
  assert.match(v5, /private\.submit_eval_work_v1_v5_impl/);
  assert.match(v5, /private\.submit_eval_work_v2_v5_impl/);
  assert.match(v5, /to_regprocedure\('private\.submit_eval_work_v1_v5_impl\([^)]*\)'\) is null/);
  assert.match(v5, /to_regprocedure\('private\.submit_eval_work_v2_v5_impl\([^)]*\)'\) is null/);
  assert.match(v5, /pg_get_functiondef\(to_regprocedure\('private\.submit_eval_work_v1_v5_impl/);
  assert.match(v5, /pg_get_functiondef\(to_regprocedure\('private\.submit_eval_work_v2_v5_impl/);
  const query = migrationContractQuery(reclassSmartShieldMigrationName);
  for (const marker of ['enqueue_drive_reclass_inquiry_v6', 'submit_manager_season_priority_v2',
    'guard_ph_master_inventory_priority_hold_v1', 'aaa_ph_master_inventory_priority_hold_shield',
    'ph_master_inventory_app_edits', 'ph_master_inventory_source_baselines',
    'v6FrozenRows', 'liveEdits', 'eval_work_smart_shield_v6_to_v5']) assert.ok(query.includes(marker), marker);
  assert.match(query, /not has_function_privilege\('anon'/);
  assert.match(query, /not has_function_privilege\('authenticated'/);
  assert.match(query, /has_function_privilege\('service_role'/);
  assert.match(query, /not has_table_privilege\('service_role'.*ph_master_inventory_app_edits/);
});

test('master lineage cleanup is release-registered and keeps housekeeping private and bounded', () => {
  assert.ok(releaseDatabaseMigrations.includes(masterLineageCleanupMigrationName));
  const contract = migrationContractQuery(masterLineageCleanupMigrationName);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.ok(contract.includes(`not has_function_privilege('${role}','private.prune_expired_master_lineage_v1(uuid)','execute')`));
  }
  const source = fs.readFileSync(new URL('../supabase/migrations/' + masterLineageCleanupMigrationName, import.meta.url), 'utf8');
  assert.doesNotThrow(() => migrationBody(source));
  assert.equal((source.match(/limit 500/g) || []).length, 2);
  assert.equal((source.match(/for update of expired skip locked/g) || []).length, 2);
  assert.equal((source.match(/expired\.run_id <> p_run_id/g) || []).length, 2);
  assert.match(source, /set_config\('gnc\.master_lineage_cleanup_run', p_run_id::text, true\)/);
  assert.match(source, /MASTER_LINEAGE_CLEANUP_GUARD_MISMATCH/);
});

test('inventory Reclass move ledger is release-registered with private access, import overlay, and non-cascading audit', () => {
  const name = inventoryReclassMovesMigrationName;
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(name) + 1], inventoryReclassQuantityTriggerFastpathsMigrationName);
  const contract = migrationContractQuery(name);
  for (const marker of ['ph_inventory_reclass_commands_v1', 'ph_inventory_reclass_batch_receipts_v1',
    'ph_inventory_reclass_movements_v1', 'ph_inventory_reclass_import_aliases_v1',
    'ph_inventory_reclass_import_conflicts_v1', 'bulk_import_master_snapshot_v1',
    'apply_inventory_reclass_import_overlay_v1', 'target_duplicate', 'operation_order',
    'ph_master_inventory_reclass_lineage_v1_idx', 'importStatus', "confdeltype='c'",
    'ph_warehouse_assigned_items', 'DRIVE_RECLASS_ROW_NOT_ASSIGNED', 'INVENTORY_RECLASS_DESTINATION_SEASON_MISMATCH']) {
    assert.ok(contract.includes(marker), marker);
  }
  assert.match(contract, /not exists\(select 1 from pg_constraint f[\s\S]*confdeltype='c'/);
  const source = fs.readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
  assert.doesNotThrow(() => migrationBody(source));
  assert.match(source, /enable row level security/i);
  assert.match(source, /apply_inventory_reclass_import_overlay_v1\(p_run_id,p_request_id\)/);
  assert.match(source, /status.{0,80}importStatus|importStatus.{0,80}status/s);
});

test('Reclass quantity trigger fastpaths are release-registered and data-preserving', () => {
  const name = inventoryReclassQuantityTriggerFastpathsMigrationName;
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(inventoryReclassMovesMigrationName) + 1], name);
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(name) + 1], inventoryReclassCompactTriggerIdentityMigrationName);
  const contract = migrationContractQuery(name);
  for (const marker of ['aaa_ph_master_inventory_priority_hold_shield', 'aab_ph_master_inventory_item6_guard_v7',
    'zzz_ph_master_inventory_item6_lineage_v7_update', 'trigger_inventory_changes',
    'sync_season_sales_av_note_reset', 'trigger_new_assignment', 'tgqual is not null']) {
    assert.ok(contract.includes(marker), marker);
  }
  const source = fs.readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
  assert.doesNotThrow(() => migrationBody(source));
  assert.match(source, /x-gnc-import-run-id/);
  assert.match(source, /rollback is data-preserving/i);
  assert.doesNotMatch(source, /\b(?:insert\s+into|update|delete\s+from)\s+public\.ph_master_inventory\b/i);
});

test('Reclass trigger identity helpers avoid full-row JSON materialization and preserve private ACLs', () => {
  const name = inventoryReclassCompactTriggerIdentityMigrationName;
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(name) + 1], inventoryReclassCompactBatchChildReceiptsMigrationName);
  const contract = migrationContractQuery(name);
  for (const marker of ['ph_master_inventory_lineage_key_v1(public.ph_master_inventory)',
    'ph_master_inventory_stable_identity_v7(public.ph_master_inventory)',
    "proconfig @> array['search_path=\"\"']", 'private.guard_ph_master_inventory_priority_hold_v1()',
    'private.refresh_ph_master_inventory_item6_lineage_v7()',
    'ph_master_inventory_lineage_key_v1(new)', 'ph_master_inventory_stable_identity_v7(new)']) {
    assert.ok(contract.includes(marker), marker);
  }
  const source = fs.readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
  assert.doesNotThrow(() => migrationBody(source));
  assert.match(source, /coalesce\(p_row\.warehouseid,p_row\.warehousei,''\)/);
  assert.match(source, /RECLASS_COMPACT_TRIGGER_IDENTITY_SOURCE_MISMATCH/);
  assert.match(source, /ph_master_inventory_lineage_key_v1\(new\)/);
  assert.match(source, /ph_master_inventory_stable_identity_v7\(new\)/);
});

test('Reclass batch child receipts resolve exact replay responses from parent receipt', () => {
  const name = inventoryReclassCompactBatchChildReceiptsMigrationName;
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(name) + 1], inventoryReclassNullElisionRpcMigrationName);
  const contract = migrationContractQuery(name);
  for (const marker of ['replay_inventory_reclass_batch_child_v1(uuid)',
    'replay_inventory_reclass_batch_child_v1(command_row.request_id)', '_batchResultReference',
    'batchRequestId', 'sourceIndex', 'b.request_id=parent_request_id',
    'batch_row.child_request_ids[source_index] is distinct from p_child_request_id',
    "sourceUniqueId''=source_uid",
    "not has_function_privilege('service_role'"]) {
    assert.ok(contract.includes(marker), marker);
  }
  const source = fs.readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
  assert.doesNotThrow(() => migrationBody(source));
  assert.ok(source.includes("command_row.result->>''_batchResultReference'' = ''true''"));
  assert.ok(source.includes("new_marker_count:=(length(definition)-length(replace(definition,new_marker,'')))/length(new_marker)"));
  assert.ok(source.includes("if new_marker_count=1 then return; end if"));
  assert.ok(source.includes("jsonb_build_object(''_batchResultReference'',true,''batchRequestId'',p_batch_request_id,''sourceIndex'',s.source_index)"));
  assert.ok(source.includes("position('batchRequestId' in definition)>0"));
  assert.ok(source.includes("position('sourceIndex' in definition)>0"));
  assert.match(source, /pg_temp\.reclass_batch_sources_v1 s where c\.request_id=s\.child_request_id/);
  assert.match(source, /where b\.request_id=parent_request_id/);
  assert.match(source, /batch_row\.child_request_ids\[source_index\] is distinct from p_child_request_id/);
  assert.match(source, /sourceUniqueId'=source_uid/);
  assert.doesNotMatch(source, /any\s*\(\s*batch_row\.child_request_ids/i);
  assert.match(source, /RECLASS_COMPACT_CHILD_RESULT_SOURCE_MISMATCH/);
});

test('Reclass batch keeps typed before/after snapshots flat and serializes only receipt-boundary JSON', () => {
  const contract = migrationContractQuery(inventoryReclassMovesMigrationName);
  for (const marker of ['reclass_batch_source_before_v1', 'reclass_batch_source_after_v1',
    'reclass_batch_target_before_v1', 'reclass_batch_target_after_v1', 'reclass_batch_source_json_v1',
    'reclass_batch_target_json_v1', 'returning m.*']) assert.ok(contract.includes(marker), marker);
  const source = fs.readFileSync(new URL('../supabase/migrations/' + inventoryReclassMovesMigrationName, import.meta.url), 'utf8');
  assert.match(source, /create temporary table if not exists reclass_batch_source_before_v1\(\s*source_index integer primary key,like public\.ph_master_inventory\)/i);
  assert.match(source, /create temporary table if not exists reclass_batch_target_after_v1\(\s*source_index integer,destination_season text,like public\.ph_master_inventory,/i);
  assert.match(source, /insert into pg_temp\.reclass_batch_source_after_v1/i);
  assert.match(source, /to_jsonb\(a\)-'source_index'/i);
  assert.doesNotMatch(source, /source_before jsonb not null,source_lineage/i);
});

test('Reclass compact RPCs preserve full receipt storage and encode exact row keysets', () => {
  const name = inventoryReclassNullElisionRpcMigrationName;
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(name) + 1], masterIdentityBatchReadMigrationName);
  const contract = migrationContractQuery(name);
  for (const marker of ['apply_inventory_reclass_moves_compact_v1(uuid,text,bigint,jsonb)',
    'get_inventory_reclass_move_status_compact_v1(uuid,text)', 'private.encode_inventory_reclass_rows_v1(jsonb)',
    'has_function_privilege(\'service_role\'', 'not has_function_privilege(\'authenticated\'']) {
    assert.ok(contract.includes(marker), marker);
  }
  assert.match(contract, /p\.provolatile='s'/);
  assert.doesNotMatch(contract, /p\.provolatile='i'/);
  const source = fs.readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
  assert.doesNotThrow(() => migrationBody(source));
  assert.match(source, /rowEncoding','master-null-elision-v1/);
  assert.match(source, /array_agg\(k\.key order by k\.key\)/);
  assert.match(source, /candidate_columns is distinct from f\.column_names/);
  assert.match(source, /s\.row_value-coalesce\(\(select array_agg\(v\.key\).*where v\.value='null'::jsonb/s);
  assert.match(source, /return p_receipt/);
  assert.match(source, /INVENTORY_RECLASS_ROW_SCHEMA_MISMATCH/);
});

test('season-sales CAV reconciliation lookup uses the exact normalized query expressions', () => {
  const source = fs.readFileSync(new URL('../supabase/migrations/20261014142125_season_sales_cav_lookup_index.sql', import.meta.url), 'utf8');
  assert.match(source, /create index if not exists ph_cav_import_season_sales_normalized_lookup_idx/i);
  assert.match(source, /upper\(btrim\(coalesce\(itemcode,\s*''\)\)\)/i);
  assert.match(source, /upper\(btrim\(coalesce\(season,\s*''\)\)\)/i);
  assert.match(source, /last_updated desc/i);
  assert.doesNotThrow(() => migrationBody(source));
});

test('raw importer acknowledgment follows V6 and probes the live trigger and restricted policy', () => {
  assert.equal(releaseDatabaseMigrations.indexOf(smartShieldRawImportMigrationName), releaseDatabaseMigrations.indexOf(reclassSmartShieldMigrationName) + 1);
  const query = migrationContractQuery(smartShieldRawImportMigrationName);
  for (const marker of ['x-gnc-master-tuple-policy', 'raw-priority-hold-v1', 'raw_master_tuple',
    "tgrelid='public.ph_master_inventory'::regclass", "tgenabled='O'",
    "tgfoid='private.guard_ph_master_inventory_priority_hold_v1()'::regprocedure"]) {
    assert.ok(query.includes(marker), marker);
  }
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.ok(query.includes(`not has_function_privilege('${role}','private.guard_ph_master_inventory_priority_hold_v1()','execute')`));
    assert.ok(query.includes(`not has_function_privilege('${role}','private.rearm_approved_hold_clear_shields_v1()','execute')`));
  }
});
test('Postgres client pins the Supabase CA and ignores URI TLS overrides while preserving connection identity', () => {
  const api='https://testproject.supabase.co';
  const raw='postgresql://postgres.testproject:p%40ss%2Fword@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require&sslrootcert=system&sslcert=%2Ftmp%2Fattacker.crt&sslkey=%2Ftmp%2Fattacker.key&uselibpqcompat=true&application_name=low-stock-test';
  const validated=validateDatabaseTarget(raw,api);
  assert.equal(new URL(validated).searchParams.get('sslmode'),'verify-full');
  const options=createDatabaseClientOptions(validated);
  const client=new pg.Client(options);
  const params=client.connectionParameters;
  assert.equal(params.host,'aws-0-us-east-1.pooler.supabase.com');
  assert.equal(params.port,5432);
  assert.equal(params.user,'postgres.testproject');
  assert.equal(params.password,'p@ss/word');
  assert.equal(params.database,'postgres');
  assert.equal(params.ssl.servername,'aws-0-us-east-1.pooler.supabase.com');
  assert.equal(params.ssl.rejectUnauthorized,true);
  assert.equal(params.ssl.checkServerIdentity,undefined,'retain the TLS library hostname verifier');
  assert.match(params.ssl.ca,/BEGIN CERTIFICATE/);
  assert.equal(params.application_name,'low-stock-test');
  assert.doesNotMatch(options.connectionString,/sslmode|sslrootcert|sslcert|sslkey|uselibpqcompat/i);

  const cert = new X509Certificate(params.ssl.ca);
  assert.equal(cert.fingerprint256,'80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
  assert.equal(cert.subject,cert.issuer);
  assert.match(cert.subject,/Supabase Root 2021 CA/);
  assert.equal(cert.ca,true);
  assert.equal(cert.verify(cert.publicKey),true);
  assert.ok(Date.parse(cert.validTo)>Date.now());
});
test('migration and history entry are atomic and a retry verifies the same contents', async () => {
  const source='begin;\nselect 42;\ncommit;';
  const queries=[];
  const client={query:async(sql,params)=>{queries.push({sql,params});return{rows:sql.startsWith('select name')?[]:sql.startsWith('select to_regprocedure')?[{installed:true}]:[]};}};
  assert.equal((await applyItemLowStockMigration({client,source})).status,'applied');
  assert.equal(queries[0].sql,'begin');assert.equal(queries.at(-1).sql,'commit');
  assert.equal(queries.find(q=>q.sql.startsWith('insert into')).params[2][0],migrationBody(source));
  const retry={query:async(sql)=>({rows:sql.startsWith('select name')?[{name:'item_low_stock_targets',statements:[migrationBody(source)]}]:sql.startsWith('select to_regprocedure')?[{installed:true}]:[]})};
  assert.equal((await applyItemLowStockMigration({client:retry,source})).status,'already_applied');
  assert.throws(()=>migrationBody('select 1'),/TRANSACTION_REQUIRED/);
});

test('consolidated production baseline satisfies archived migrations without replay or ledger writes', async () => {
  assert.equal(productionBaselineVersion, '20260929200000');
  for (const targetMigrationName of [migrationName, perennialAssignmentMigrationName, passwordReconciliationMigrationName]) {
    const queries = [];
    const client = { query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith('select name, statements')) return { rows: [] };
      if (sql === 'select name from supabase_migrations.schema_migrations where version = $1') {
        assert.deepEqual(params, [productionBaselineVersion]);
        return { rows: [{ name: 'production_baseline' }] };
      }
      if (sql === migrationContractQuery(targetMigrationName)) return { rows: [{ installed: true }] };
      return { rows: [] };
    } };
    const result = await applyItemLowStockMigration({ client, source: 'begin; select should_not_run; commit;', targetMigrationName });
    assert.equal(result.status, 'included_in_baseline');
    assert.equal(queries.at(-1).sql, 'commit');
    assert.ok(!queries.some(({ sql }) => sql.includes('should_not_run') || sql.startsWith('insert into')));
  }
});

test('Production Schedule migration applies additively after an older consolidated baseline', async () => {
  const queries = [];
  const client = { query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.startsWith('select name, statements')) return { rows: [] };
    if (sql === 'select name from supabase_migrations.schema_migrations where version = $1') {
      return { rows: [{ name: 'production_baseline' }] };
    }
    if (sql === migrationContractQuery(productionScheduleMigrationName)) return { rows: [{ installed: true }] };
    return { rows: [] };
  } };
  const result = await applyItemLowStockMigration({
    client, source: 'begin; select schedule_schema; commit;', targetMigrationName: productionScheduleMigrationName,
  });
  assert.equal(result.status, 'applied');
  assert.ok(queries.some(({ sql }) => sql === 'select schedule_schema;'));
  assert.ok(queries.some(({ sql, params }) => sql.startsWith('insert into supabase_migrations.schema_migrations') && params[0] === '20261001012038'));
});

test('release migration sources satisfy the atomic production runner contract', () => {
  for (const name of releaseDatabaseMigrations) {
    const directory = [migrationName, perennialAssignmentMigrationName, passwordReconciliationMigrationName].includes(name) ? 'archive_migrations' : 'migrations';
    const source = fs.readFileSync(new URL(`../supabase/${directory}/${name}`, import.meta.url), 'utf8');
    const body = migrationBody(source);
    assert.ok(body.trim().length > 0, `${name} contains a migration body`);
    assert.doesNotMatch(body, /^\s*(?:begin|commit)\s*;/i, `${name} has one outer transaction`);
  }
});

test('baseline path fails closed when its identity or required contract is missing', async () => {
  for (const [baselineName, installed, expected] of [
    ['unexpected_baseline', true, /MIGRATION_HISTORY_MISMATCH/],
    ['production_baseline', false, /DATABASE_CONTRACT_MISSING/]
  ]) {
    const queries = [];
    const client = { query: async (sql) => {
      queries.push(sql);
      if (sql.startsWith('select name, statements')) return { rows: [] };
      if (sql === 'select name from supabase_migrations.schema_migrations where version = $1') return { rows: [{ name: baselineName }] };
      if (sql === migrationContractQuery(migrationName)) return { rows: [{ installed }] };
      return { rows: [] };
    } };
    await assert.rejects(applyItemLowStockMigration({ client, source: 'begin; select should_not_run; commit;' }), expected);
    assert.equal(queries.at(-1), 'rollback');
    assert.ok(!queries.some(sql => sql.includes('should_not_run') || sql.startsWith('insert into')));
  }
});
test('multi-assignment Bunch Notes migrations are included in the production release runner', () => {
  const migration = bunchNoteMultiAssignmentRoutingMigrationName;
  assert.ok(releaseDatabaseMigrations.includes(migration), 'the production migration runner must apply the advanced Bunch Notes migration');
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(bunchNoteBlueprintHeaderPdfDeliveryMigrationName) - 1], migration, 'the blueprint migration follows its multi-assignment prerequisite');
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(bunchNoteQueueExecutionMigrationName) - 1], bunchNoteBlueprintHeaderPdfDeliveryMigrationName, 'the queue migration follows the blueprint/PDF prerequisite');
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(bunchNoteSupervisorAssigneeFacetsMigrationName) - 1], bunchNoteQueueExecutionMigrationName, 'the supervisor and assignee-facets migration follows queue execution');
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(bunchNoteSupervisorAssigneeFacetsMigrationName) + 1], suspendTagSenderIdentityMigrationName);
  const contract = migrationContractQuery(migration);
  for (const marker of ['workflow_action','destination_location','destination_house','bunch_note_card_assignees',
    'card_instruction_snapshot_map(jsonb)','bunch_note_command_v1(uuid,text,jsonb,uuid,bigint)',
    'bunch_note_batch_work_cards','bunch_note_job_work_cards']) assert.ok(contract.includes(marker), marker);
  const queueContract = migrationContractQuery(bunchNoteQueueExecutionMigrationName);
  for (const marker of ['workflow_commands','card_completions','count_reviews','bunch_note_workflow_command_v1',
    'bunch_note_delivery_lookup_v1','bunch_note_freeze_pdfs_v1','workflow_can_review','sharon_combs']) assert.ok(queueContract.includes(marker), marker);
  assert.match(queueContract, /bunch_note_workflow_command_v1/);
  assert.match(queueContract, /has_function_privilege\('service_role',p\.oid,'execute'\)/);
  assert.match(queueContract, /not has_function_privilege\('authenticated',p\.oid,'execute'\)/);
  assert.match(queueContract, /not has_function_privilege\('anon',p\.oid,'execute'\)/);
});

test('v2.3.2 Bunch supervisor permissions and assignee facets are registered with a strict installed contract', () => {
  const migration = bunchNoteSupervisorAssigneeFacetsMigrationName;
  assert.ok(releaseDatabaseMigrations.includes(migration), 'the release runner must apply the v2.3.2 queue permission/facets migration');
  assert.equal(migration, '20261019003759_bunch_note_supervisor_assignee_facets_v1.sql');
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(migration) - 1], bunchNoteQueueExecutionMigrationName);
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(migration) + 1], suspendTagSenderIdentityMigrationName);
  const source = fs.readFileSync(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8');
  assert.match(source, /^begin;\s/i);
  assert.match(source, /workflow_can_review\(public\.profiles\)/);
  const contract = migrationContractQuery(migration);
  for (const marker of ['dylan_collyge','dylan_college','sharon_combs','ADMIN','ADMINISTRATOR','SUPERVISOR','DATAENTRYSUPERVISOR','SENIORINVENTORYMANAGER',
    'assignee_options','unassigned_count','facet_people as (','count(*) card_count from facet_people','ca.user_id is distinct from a.owner_id','assigned_to','coalesce(p.active and p.status=',
    'coalesce(r.assigned_counter_id=actor.id or review_allowed,false)',
    'coalesce(v.assigned_counter_id=actor.id or review_allowed,false)',
    'if not coalesce(card.owner_id=actor.id']) assert.ok(contract.includes(marker), marker);
  for (const role of ['anon','authenticated']) assert.ok(contract.includes(`not has_function_privilege('${role}',p.oid,'execute')`));
  assert.ok(contract.includes("has_function_privilege('service_role',p.oid,'execute')"));
  assert.match(contract,/as installed$/);
});

test('release schema handoff applies the perennial override after low-stock and verifies its exact database contract',async()=>{
  assert.deepEqual(releaseDatabaseMigrations,[migrationName,perennialAssignmentMigrationName,passwordReconciliationMigrationName,productionScheduleMigrationName,auraHrCommandCenterMigrationName,scheduledHandoverMigrationName,requestArchiveMigrationName, handoverAssignmentMigrationName, readOptimizationMigrationName, auraInventoryV2MigrationName, nellyAccessAuditMigrationName, evalDeliveryArchiveHealthMigrationName, auraInventoryMatchMigrationName, auraLlmFreeTierMigrationName, suspendTagApprovalMigrationName, structuredBunchNotesMigrationName, bunchNoteCardsMigrationName, bunchNoteCardCommandsMigrationName,reclassSplitMoveMigrationName,reclassEvalSubmitGuardsMigrationName,inventoryRowAssignmentAuthorityMigrationName,itemcodeDefaultOwnersMigrationName,inventoryRowAssignmentFenceIntegrationMigrationName,inventoryRowAssignmentFutureSnapshotsMigrationName,inventoryRowAssignmentLiveConsumersMigrationName,auraInternalQueryMigrationName,auraCommonNamePriorityMigrationName,auraDynamicSeasonScopeMigrationName,auraInventoryExplicitProjectionMigrationName,sqlFunctionCorrectnessRepairsMigrationName,sqlLintRuntimeContextMigrationName,reclassShearedMigrationName,reclassSmartShieldMigrationName,smartShieldRawImportMigrationName, requestQueueRemoveMigrationName, prompt25HotfixMigrationName, customerRepMappingMigrationName, bunchAutoCompletionMigrationName, fieldCountingMigrationName, customerRepMappingFinalizeTimeoutMigrationName, historicalRequestsMigrationName,auraVoiceRoleAccessMigrationName,auraVoiceSocReadsMigrationName, requestMappingIdentityMigrationName, historicalRequestsPriceFallbackMigrationName, reclassConcurrentHoldMigrationName, salesActorRoleBoundariesMigrationName, navigationRoleBoundariesMigrationName, requestHistoryDrilldownMigrationName, auraEnterpriseDomainVoiceMigrationName,managerReportReadV2MigrationName,managerListReadV2MigrationName,inventoryLocationOnHandMigrationName,masterInventoryRealtimeMigrationName,eval2SharedLowStockThresholdMigrationName,masterLineageCleanupMigrationName,seasonSalesCavLookupMigrationName,seasonSalesEmptyCleanupMigrationName,seasonSalesWorklistMigrationName,inventoryAssignmentBatchesMigrationName,inventoryAssignmentWitnessMigrationName,inventoryAssignmentInputGenerationMigrationName, customerAssignmentOverridesMigrationName, bulkMasterSnapshotMigrationName, importHistoryRoutingMigrationName, handoverMasterAssignmentFastPathMigrationName, bulkContextIndexPlanMigrationName, managerModuleRevisionSignalsMigrationName,inventoryReclassMovesMigrationName, inventoryReclassQuantityTriggerFastpathsMigrationName,inventoryReclassCompactTriggerIdentityMigrationName,inventoryReclassCompactBatchChildReceiptsMigrationName,inventoryReclassNullElisionRpcMigrationName,masterIdentityBatchReadMigrationName,bunchNoteMultiAssignmentRoutingMigrationName,bunchNoteBlueprintHeaderPdfDeliveryMigrationName,bunchNoteQueueExecutionMigrationName,bunchNoteSupervisorAssigneeFacetsMigrationName,suspendTagSenderIdentityMigrationName,canonicalUserAccessMigrationName,inventoryReclassMoveDeliveryMigrationName,masterSnapshotChunkedStagingMigrationName,masterIdentityBatchRetrySqlstateMigrationName,reclassEmailReportPolicyMigrationName,publishedLkgReadProofMigrationName,reclassServerRevisionMigrationName, reclassRepScopeMigrationName]);
  assert.match(migrationContractQuery(reclassShearedMigrationName),/enqueue_drive_reclass_inquiry_v5/);
  assert.match(migrationContractQuery(reclassShearedMigrationName),/quantity_text/);
  assert.match(migrationContractQuery(auraCommonNamePriorityMigrationName),/common_score/);
  assert.match(migrationContractQuery(auraInventoryExplicitProjectionMigrationName),/m\.unique_id,m\.itemcode,m\.commonname/);
  assert.match(migrationContractQuery(auraVoiceRoleAccessMigrationName),/aura_voice_access_v1/);
  assert.match(migrationContractQuery(perennialAssignmentMigrationName),/reconcile_eval_itemcodes\(uuid\)/);
  assert.match(migrationContractQuery(productionScheduleMigrationName),/production_schedule_start_import_v1/);
  const queries=[];const client={query:async(sql,params)=>{
    queries.push({sql,params});
    if(sql.startsWith('select name'))return{rows:[]};
    if(sql.includes('zone_override_active'))return{rows:[{installed:true}]};
    return{rows:[]};
  }};
  assert.equal((await applyItemLowStockMigration({client,source:'begin; select 9; commit;',targetMigrationName:perennialAssignmentMigrationName})).status,'applied');
  const history=queries.find(entry=>entry.sql.startsWith('insert into supabase_migrations'));
  assert.equal(history.params[0],perennialAssignmentMigrationName.split('_')[0]);
  assert.equal(history.params[1],'perennial_zone_assignment_override');
  assert.ok(queries.some(entry=>entry.sql===migrationContractQuery(perennialAssignmentMigrationName)));
  assert.throws(()=>migrationContractQuery('unlisted.sql'),/MIGRATION_HISTORY_MISMATCH/);
});
test('HR migration contract verifies partitioned labor tables and the scheduled reminder action', async () => {
  const contract = migrationContractQuery(auraHrCommandCenterMigrationName);
  assert.match(contract, /hr_calendar_reminder_sweep/);
  assert.match(contract, /hr_claim_calendar_reminders_v1/);
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: sql === contract ? [{ installed: true }] : [] };
  } };
  const result = await applyItemLowStockMigration({ client, source: 'begin; select hr_schema; commit;', targetMigrationName: auraHrCommandCenterMigrationName });
  assert.equal(result.status, 'applied');
  assert.ok(calls.some(({ sql }) => sql === 'select hr_schema;'));
  assert.equal(calls.find(({ sql }) => sql.startsWith('insert into supabase_migrations')).params[1], 'aura_hr_command_center_v1');
});

test('Bunch card release contracts require private RLS storage and a service-only command', async () => {
  const storage=migrationContractQuery(bunchNoteCardsMigrationName), command=migrationContractQuery(bunchNoteCardCommandsMigrationName);
  assert.match(storage,/relrowsecurity/);assert.match(storage,/not has_table_privilege\('authenticated'/);
  assert.match(storage,/bunch_note_batch_v5_cards/);assert.match(command,/bunch_note_card_command_v1/);
  assert.match(command,/not has_function_privilege\('authenticated'/);assert.match(command,/not has_function_privilege\('anon'/);
  for(const name of [bunchNoteCardsMigrationName,bunchNoteCardCommandsMigrationName]) {
    const contract=migrationContractQuery(name),calls=[];
    const client={query:async(sql,params)=>{calls.push({sql,params});return {rows:sql===contract?[{installed:true}]:[]};}};
    assert.equal((await applyItemLowStockMigration({client,source:'begin; select 1; commit;',targetMigrationName:name})).status,'applied');
    assert.ok(calls.some(c=>c.sql===contract));
  }
});

test('Reclass split-move V4 release contract is service-only and preserves legacy validation', async () => {
  const contract = migrationContractQuery(reclassSplitMoveMigrationName);
  assert.match(contract, /enqueue_drive_reclass_inquiry_v4/);
  assert.match(contract, /not has_function_privilege\('authenticated'/);
  assert.match(contract, /validate_eval_work_inquiry_legacy_v1/);
  const calls = [];
  const client = { query: async (sql) => { calls.push(sql); return { rows: sql === contract ? [{ installed: true }] : [] }; } };
  assert.equal((await applyItemLowStockMigration({ client, source: 'begin; select v4; commit;', targetMigrationName: reclassSplitMoveMigrationName })).status, 'applied');
  assert.ok(calls.includes(contract));
});

test('Reclass EvalWork submit guards retain service-only entry points and V4 content binding', async () => {
  const contract = migrationContractQuery(reclassEvalSubmitGuardsMigrationName);
  assert.match(contract,/submission_request_fingerprint/);
  assert.match(contract,/submit_eval_work_legacy_v1/);
  assert.match(contract,/not has_function_privilege\('service_role'/);
  const calls=[];
  const client={query:async(sql)=>{calls.push(sql);return {rows:sql===contract?[{installed:true}]:[]};}};
  assert.equal((await applyItemLowStockMigration({client,source:'begin; select eval_submit_guard; commit;',targetMigrationName:reclassEvalSubmitGuardsMigrationName})).status,'applied');
  assert.ok(calls.includes(contract));
});

test('archive-only health repair remains private and fails closed before publication', async () => {
  assert.ok(releaseDatabaseMigrations.indexOf(evalDeliveryArchiveHealthMigrationName) < releaseDatabaseMigrations.indexOf(auraInventoryMatchMigrationName));
  const contract = migrationContractQuery(evalDeliveryArchiveHealthMigrationName);
  assert.match(contract, /request_folder_archive_only_completed_v1/);
  assert.match(contract, /not prosecdef and provolatile='s'/);
  assert.match(contract, /archive_only_completed_folder_count/);
  assert.match(contract, /not has_function_privilege\('anon'/);
  assert.match(contract, /not has_function_privilege\('authenticated'/);
  for (const installed of [true, false]) {
    const calls = [];
    const client = { query: async (sql) => {
      calls.push(sql);
      return { rows: sql === contract ? [{ installed }] : [] };
    } };
    const operation = applyItemLowStockMigration({ client, source: 'begin; select health_repair; commit;',
      targetMigrationName: evalDeliveryArchiveHealthMigrationName });
    if (installed) {
      assert.equal((await operation).status, 'applied');
      assert.equal(calls.at(-1), 'commit');
    } else {
      await assert.rejects(operation, /LOW_STOCK_DATABASE_CONTRACT_MISSING/);
      assert.equal(calls.at(-1), 'rollback');
    }
  }
});

test('AURA name-match migration requires the private bounded RPC, four-second limit, and indexes', () => {
  const contract = migrationContractQuery(auraInventoryMatchMigrationName);
  assert.match(contract, /aura_inventory_v2_match_v1/);
  assert.match(contract, /statement_timeout=4s/);
  assert.match(contract, /idx_ph_master_inventory_aura_name_trgm/);
  assert.match(contract, /idx_ph_master_inventory_aura_season_size/);
  assert.ok(releaseDatabaseMigrations.indexOf(auraInventoryMatchMigrationName) > releaseDatabaseMigrations.indexOf(auraInventoryV2MigrationName));
});

test('audit repair is registered after the AURA migration and verifies identity and baseline completeness', async () => {
  assert.ok(releaseDatabaseMigrations.indexOf(nellyAccessAuditMigrationName) > releaseDatabaseMigrations.indexOf(auraInventoryV2MigrationName));
  const contract = migrationContractQuery(nellyAccessAuditMigrationName);
  assert.match(contract, /961b0a0f-11a6-4db5-b066-582f772ab8e7/);
  assert.match(contract, /nelly_aguilar/);
  assert.match(contract, /get_effective_app_permissions_v1/);
  assert.match(contract, /b\.permission_key is null/);
  for (const installed of [true, false]) {
    const calls = [];
    const client = { query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: sql === contract ? [{ installed }] : [] };
    } };
    const operation = applyItemLowStockMigration({ client, source: 'begin; select audit_repair; commit;',
      targetMigrationName: nellyAccessAuditMigrationName });
    if (installed) {
      assert.equal((await operation).status, 'applied');
      assert.equal(calls.at(-1).sql, 'commit');
    } else {
      await assert.rejects(operation, /LOW_STOCK_DATABASE_CONTRACT_MISSING/);
      assert.equal(calls.at(-1).sql, 'rollback');
    }
  }
});

test('HR migration lets pg_cron and pg_net create their own schemas', () => {
  const source = fs.readFileSync(new URL('../supabase/migrations/20261001025638_aura_hr_command_center_v1.sql', import.meta.url), 'utf8');
  assert.match(source, /create extension if not exists pg_cron\s*;/i);
  assert.match(source, /create extension if not exists pg_net with schema extensions\s*;/i);
  assert.doesNotMatch(source, /create schema if not exists (?:cron|net)\s*;/i);
  assert.match(source, /do \$\$\s*declare month_start date := date '2025-01-01';\s*month_end date;\s*partition_name text;\s*begin/i);
  assert.doesNotMatch(source, /alter table realtime\.messages enable row level security/i);
  assert.match(source, /create policy alpha_dylan_chat_realtime_select on realtime\.messages/i);
  assert.match(source, /create policy alpha_dylan_chat_realtime_insert on realtime\.messages/i);
});

test('reminder credentials are written through Vault create/update APIs without logging their values', async () => {
  const calls = [];
  const createClient = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [] };
  } };
  assert.equal(await upsertVaultSecret({ client: createClient, name: 'hr_calendar_project_url', value: 'https://example.supabase.co', description: 'test' }), 'created');
  assert.match(calls.at(-1).sql, /vault\.create_secret/);
  assert.ok(calls.at(-1).params.includes('https://example.supabase.co'));
  const updateClient = { query: async (sql, params) => {
    calls.push({ sql, params });
    return sql.startsWith('select id') ? { rows: [{ id: 'secret-id' }] } : { rows: [] };
  } };
  assert.equal(await upsertVaultSecret({ client: updateClient, name: 'hr_calendar_project_url', value: 'https://new.example.supabase.co' }), 'updated');
  assert.match(calls.at(-1).sql, /vault\.update_secret/);
  await assert.rejects(upsertVaultSecret({ client: createClient, name: 'bad-name', value: 'secret' }), /VAULT_SECRET_INPUT_INVALID/);
});
test('perennial production preview is aggregate only and rolls back its read-only transaction',async()=>{
  const calls=[];
  const client={query:async sql=>{
    calls.push(sql);
    if(sql==='begin read only'||sql==='rollback')return{rows:[]};
    assert.equal(sql,perennialPreviewSql);
    return{rows:[{inventory_revision:'22',inventory_state:'ready',preview_ready:true,itemcode_genus_groups:12,rose_exempt_groups:2,in_zone_policy_groups:3,
      unresolved_groups:1,outside_groups:6,rose_override_rows:1,mitch_active_roster_rows:1,conflicting_defaults:0,zoe_active_roster_rows:1,current_owner_changes_estimate:3,
      affected_assignments:[{itemcode:'A1',genus:'perennial',previousOwner:'owner1',proposedOwner:'zoe_green',ownerChange:true,
        automaticAssignment:true,reason:'enforce_perennial_zone_owner'}]}]};
  }};
  const preview=await runPerennialAssignmentPreview({client,repositorySha:'a'.repeat(40),generatedAt:'2026-09-28T12:00:00.000Z'});
  assert.deepEqual(calls,['begin read only',perennialPreviewSql,'rollback']);
  assert.equal(preview.counts.in_zone_policy_groups,3);
  assert.equal(preview.previewMode,'read_only_aggregate');
  assert.equal(preview.policyActivation,'requires_complete_snapshot_and_verified_backfill');
  assert.equal(preview.previewReady,true);
  assert.equal(getPerennialPreviewFailure(preview),'');
  assert.deepEqual(preview.affectedAssignments,[{itemcode:'A1',genus:'perennial',previousOwner:'owner1',proposedOwner:'zoe_green',ownerChange:true,
    automaticAssignment:true,reason:'enforce_perennial_zone_owner'}]);
  assert.doesNotMatch(JSON.stringify(preview),/Customer Name/i);
  assert.match(perennialPreviewSql,/135_ROSES/);
  assert.match(perennialPreviewSql,/private\.eval_location_zone/);
  assert.match(perennialPreviewSql,/preview_ready/);
});

test('password reconciliation is additive and verified before the existing backend publication', async () => {
  const query = migrationContractQuery(passwordReconciliationMigrationName);
  assert.match(query, /prepare_password_change_profile\(text,uuid,text\)/);
  assert.match(query, /complete_password_change_profile\(uuid,uuid,text,text\)/);
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: sql === query ? [{ installed: true }] : [] };
  } };
  await applyItemLowStockMigration({ client, source: 'begin; select 11; commit;', targetMigrationName: passwordReconciliationMigrationName });
  assert.equal(calls.at(-1).sql, 'commit');
  assert.equal(calls.find(call => call.sql.startsWith('insert into supabase_migrations')).params[1], 'password_change_profile_reconciliation');
  const workflow = fs.readFileSync('.github/workflows/release-database.yml', 'utf8');
  assert.match(workflow, /node scripts\/historical-database-fixture\.mjs/);
  assert.ok(readHistoricalMigrationManifest().some(entry => entry.destination === passwordReconciliationMigrationName));
  assert.ok(discoverTests({ group: 'sql-isolated-supabase' }).includes('supabase/tests/password_change_profile_reconciliation_test.sql'));
});
test('perennial preview withholds proposed owner details while a master import is partial',async()=>{
  const client={query:async sql=>({rows:sql==='begin read only'||sql==='rollback'?[]:[{inventory_revision:'23',inventory_state:'importing',preview_ready:false,
    itemcode_genus_groups:7,rose_exempt_groups:0,in_zone_policy_groups:1,unresolved_groups:2,outside_groups:4,
    rose_override_rows:1,mitch_active_roster_rows:1,conflicting_defaults:0,zoe_active_roster_rows:1,current_owner_changes_estimate:1,affected_assignments:[{itemcode:'SHOULD_NOT_ESCAPE'}]}]})};
  const preview=await runPerennialAssignmentPreview({client,repositorySha:'b'.repeat(40)});
  assert.equal(preview.previewReady,false);
  assert.deepEqual(preview.affectedAssignments,[]);
  assert.equal(getPerennialPreviewFailure(preview),'PERENNIAL_PREVIEW_MASTER_NOT_READY');
});
test('perennial preview blocks activation when Zoe is inactive for qualifying keys',async()=>{
  const client={query:async sql=>({rows:sql==='begin read only'||sql==='rollback'?[]:[{inventory_revision:'24',inventory_state:'ready',preview_ready:true,
    itemcode_genus_groups:7,rose_exempt_groups:1,in_zone_policy_groups:2,unresolved_groups:1,outside_groups:3,
    rose_override_rows:1,mitch_active_roster_rows:1,conflicting_defaults:0,zoe_active_roster_rows:0,current_owner_changes_estimate:2,
    affected_assignments:[{itemcode:'SECRET-FREE-SYNTHETIC',genus:'perennial',previousOwner:'fixture',proposedOwner:'zoe_green',ownerChange:true,
      automaticAssignment:true,reason:'enforce_perennial_zone_owner'}]}]})};
  const preview=await runPerennialAssignmentPreview({client,repositorySha:'c'.repeat(40)});
  assert.equal(preview.previewReady,true);
  assert.equal(getPerennialPreviewFailure(preview),'PERENNIAL_PREVIEW_ZOE_INACTIVE');
  assert.equal(preview.affectedAssignments.length,1,'the failure artifact retains the preview impact for diagnosis');
});
test('pre-activation gate requires a valid ready preview and an active Zoe only when policy keys exist',()=>{
  assert.equal(getPerennialPreviewFailure({previewReady:true,inventoryState:'ready',counts:{in_zone_policy_groups:0,rose_override_rows:1,mitch_active_roster_rows:1,conflicting_defaults:0,zoe_active_roster_rows:0}}),'');
  assert.equal(getPerennialPreviewFailure({previewReady:true,inventoryState:'ready',counts:{in_zone_policy_groups:1,rose_override_rows:1,mitch_active_roster_rows:1,conflicting_defaults:0,zoe_active_roster_rows:1}}),'');
  assert.equal(getPerennialPreviewFailure({previewReady:true,inventoryState:'ready',counts:{in_zone_policy_groups:'bad',rose_override_rows:1,mitch_active_roster_rows:1,conflicting_defaults:0,zoe_active_roster_rows:1}}),'PERENNIAL_PREVIEW_RESULT_INVALID');
});
test('SQL errors roll back without committing the migration history', async()=>{
  const calls=[]; const client={query:async(sql)=>{calls.push(sql);if(sql==='select broken;')throw Error('failure');return{rows:[]};}};
  await assert.rejects(applyItemLowStockMigration({client,source:'begin;\nselect broken;\ncommit;'}));
  assert.equal(calls.at(-1),'rollback');assert.ok(!calls.includes('commit'));
});
test('migration failure reports a useful phase and safe code without leaking database error text',async()=>{
  const calls=[];let phase='database_connect';
  const secret='postgresql://postgres:secret-password@db.testproject.supabase.co:5432/postgres?sslmode=require';
  const hostile=new Error(`password=secret-password ${secret} internal stack detail`);
  hostile.code='28P01';
  const client={query:async(sql)=>{calls.push(sql);if(sql==='select broken;')throw hostile;return{rows:[]};}};
  await assert.rejects(applyItemLowStockMigration({client,source:'begin;\nselect broken;\ncommit;',onPhase:value=>{phase=value;}}));
  assert.equal(phase,'migration_sql');
  const line=formatSafeFailure({phase,error:hostile,connectionString:secret});
  assert.equal(line,'LOW_STOCK_SCHEMA_APPLY_FAILED phase=migration_sql error_class=postgres error_code=28P01 route=direct port=5432 sslmode=require');
  assert.ok(!line.includes('secret-password'));assert.ok(!line.includes('testproject'));assert.ok(!line.includes('internal stack'));
  assert.equal(calls.at(-1),'rollback');
});
test('sanitizer classifies only allowlisted transport/TLS codes and does not serialize malicious fields',()=>{
  assert.deepEqual(classifyDatabaseError(Object.assign(new Error('private message'),{code:'ENOTFOUND'})),{errorClass:'network',errorCode:'ENOTFOUND'});
  assert.deepEqual(classifyDatabaseError(Object.assign(new Error('private message'),{code:'ERR_TLS_CERT_ALTNAME_INVALID'})),{errorClass:'tls',errorCode:'ERR_TLS_CERT_ALTNAME_INVALID'});
  assert.deepEqual(classifyDatabaseError(Object.assign(new Error('private message'),{code:'ECONNRESET; token=secret'})),{errorClass:'other',errorCode:''});
  assert.deepEqual(classifyDatabaseError(Object.assign(new Error('private message'),{code:'EPIPE'})),{errorClass:'network',errorCode:'EPIPE'});
  const output=formatSafeFailure({phase:'schema_probe',error:new Error('postgres://user:password@secret.internal/stack')});
  assert.equal(output,'LOW_STOCK_SCHEMA_APPLY_FAILED phase=schema_probe error_class=other');
  assert.ok(!output.includes('secret'));
  const crafted=formatSafeFailure({phase:'schema_probe',error:new Error('LOW_STOCK_SECRET'),connectionString:'postgresql://u:p@attacker.invalid/postgres?sslmode=token'});
  assert.equal(crafted,'LOW_STOCK_SCHEMA_APPLY_FAILED phase=schema_probe error_class=other route=unknown port=5432 sslmode=other');
});
test('read-only diagnostic uses only a read-only transaction and preserves the probe error if rollback fails',async()=>{
  // Session-wide settings can persist on pooled backend connections. The
  // diagnostic must scope read-only behavior to its own transaction.
  const runner=fs.readFileSync('scripts/apply-item-low-stock-migration.mjs','utf8');
  assert.doesNotMatch(runner,/default_transaction_read_only|set session characteristics/i);
  const statements=[];
  const client={query:async(sql)=>{statements.push(sql);if(sql==='begin read only')return{rows:[]};if(sql.startsWith('select to_regprocedure'))return{rows:[{installed:true}]};if(sql==='rollback')return{rows:[]};throw new Error('unexpected write');}};
  const phases=[];
  assert.deepEqual(await runReadOnlySchemaDiagnostic({client,onPhase:phase=>phases.push(phase)}),{installed:true});
  assert.deepEqual(statements,['begin read only',"select to_regprocedure('public.get_eval_item_low_stock_targets_v1(text[],text,integer)') is not null as installed",'rollback']);
  assert.deepEqual(phases,['transaction_begin','schema_probe','transaction_rollback']);

  const original=Object.assign(new Error('sensitive probe details'),{code:'42501'});const failedPhases=[];
  const failing={query:async(sql)=>{if(sql==='begin read only')return{rows:[]};if(sql.startsWith('select to_regprocedure'))throw original;if(sql==='rollback')throw new Error('rollback secret');throw new Error('unexpected write');}};
  await assert.rejects(runReadOnlySchemaDiagnostic({client:failing,onPhase:phase=>failedPhases.push(phase)}),error=>error===original);
  assert.equal(failedPhases.at(-1),'schema_probe');
});
test('diagnostic guard accepts only cloud workflow_dispatch on main and binds diagnostic workflow identity',()=>{
  const env={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:'owner/repo',GITHUB_SHA:'a'.repeat(40),GITHUB_REF:'refs/heads/main',GITHUB_WORKFLOW_REF:'owner/repo/.github/workflows/apps-script-database-diagnostic.yml@refs/heads/main'};
  assert.equal(validateDiagnosticContext(env).sha,'a'.repeat(40));
  assert.throws(()=>validateDiagnosticContext({...env,GITHUB_EVENT_NAME:'push'}),/DIAGNOSTIC_CONTEXT_INVALID/);
  assert.throws(()=>validateDiagnosticContext({...env,GITHUB_REF:'refs/heads/feature/diagnose'}),/DIAGNOSTIC_CONTEXT_INVALID/);
  assert.throws(()=>validateDiagnosticContext({...env,GITHUB_REF:'refs/heads/codex/diagnose'}),/DIAGNOSTIC_CONTEXT_INVALID/);
  assert.throws(()=>validateDiagnosticContext({...env,GITHUB_SHA:'short'}),/DIAGNOSTIC_CONTEXT_INVALID/);
  assert.throws(()=>validateDiagnosticContext({...env,GITHUB_WORKFLOW_REF:'owner/repo/.github/workflows/apps-script-sync.yml@refs/heads/main'}),/DIAGNOSTIC_WORKFLOW_INVALID/);
});

test('failed migration rollback preserves the original SQL error', async()=>{
  const original=Object.assign(new Error('private SQL details'),{code:'42501'});
  const client={query:async(sql)=>{
    if(sql==='select broken;')throw original;
    if(sql==='rollback')throw new Error('private rollback details');
    return{rows:[]};
  }};
  await assert.rejects(applyItemLowStockMigration({client,source:'begin;\nselect broken;\ncommit;'}),error=>error===original);
});
test('backend rollout verifies current main and applies migrations before deploying functions',()=>{
  const workflow=fs.readFileSync('.github/workflows/apps-script-sync.yml','utf8');
  assert.ok(workflow.indexOf('Recheck exact current main before backend changes')<workflow.indexOf('Apply validated backend release migrations'));
  assert.ok(workflow.indexOf('Apply validated backend release migrations')<workflow.indexOf('Deploy changed Edge Functions'));
  assert.doesNotMatch(workflow,/Sync Code\.gs into Apps Script|Preview perennial policy impact|build the complete site|Push the verified static site/);
  assert.match(workflow,/EXPECTED_COMMIT: \$\{\{ inputs\.expected-commit \}\}/);
  assert.match(workflow,/changedReleasePaths\(\{ before: parent, after: commit \}\)/);
  assert.match(workflow,/classifyReleasePaths\(paths\)/);
  assert.doesNotMatch(workflow, /seed-production-schedule-release|Queue the initial signed workbook import/);
  const steps = yaml.load(workflow).jobs['deploy-supabase'].steps;
  const dependencyStep = steps.find(step => step.name === 'Install locked backend dependencies');
  const migrationStep = steps.find(step => step.name === 'Apply validated backend release migrations');
  const deployStep = steps.find(step => step.name === 'Deploy changed Edge Functions');
  assert.equal(dependencyStep.with['node-version'],20);
  assert.equal(migrationStep.run,'node scripts/apply-item-low-stock-migration.mjs');
  assert.equal(migrationStep.env.RELEASE_MIGRATIONS,'${{ needs.authorize-backend.outputs.migrations }}');
  assert.equal(deployStep.env.RELEASE_EDGE_FUNCTIONS,"${{ needs.authorize-backend.outputs['edge-functions'] }}");
  assert.match(deployStep.run,/for function_name in "\$\{selected_functions\[@\]\}"/);
  assert.match(deployStep.run,/supabase functions deploy "\$function_name" --use-api --project-ref/);
  assert.ok(steps.indexOf(migrationStep)<steps.indexOf(deployStep));
  for (const name of releaseDatabaseMigrations) {
    const directory = [migrationName,perennialAssignmentMigrationName,passwordReconciliationMigrationName].includes(name) ? 'archive_migrations' : 'migrations';
    assert.ok(fs.existsSync(new URL(`../supabase/${directory}/${name}`, import.meta.url)), `${name} is tracked in its canonical migration directory`);
  }
  assert.match(workflow,/SUPABASE_DB_URL: \$\{\{ secrets\.SUPABASE_DB_URL \}\}/);
  assert.match(workflow,/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
});


test('hybrid activation blocks conflicting saved owners and inactive rose owner', () => {
  const counts = {in_zone_policy_groups:1,zoe_active_roster_rows:1,rose_override_rows:1,mitch_active_roster_rows:1,conflicting_defaults:0};
  const preview = {previewReady:true,inventoryState:'ready',counts};
  assert.equal(getPerennialPreviewFailure(preview),'');
  assert.equal(getPerennialPreviewFailure({...preview,counts:{...counts,conflicting_defaults:1}}),'PERENNIAL_PREVIEW_DEFAULT_CONFLICT');
  assert.equal(getPerennialPreviewFailure({...preview,counts:{...counts,mitch_active_roster_rows:0}}),'PERENNIAL_PREVIEW_MITCH_INACTIVE');
  assert.match(perennialPreviewSql,/zone_override_prior_assignedto/);
  assert.match(perennialPreviewSql,/where a\.present_in_drive/);
});

test('every release migration probe names the result consumed by the deployment runner', () => {
  for (const name of releaseDatabaseMigrations) {
    const query = migrationContractQuery(name).replace(/'(?:[^']|'')*'/g, "''");
    let depth = 0;
    let outerQuery = '';
    for (const character of query) {
      if (character === '(') depth += 1;
      if (depth === 0) outerQuery += character;
      if (character === ')') depth -= 1;
    }
    assert.match(outerQuery, /\bas installed(?:\s+from\b|\s*;?\s*$)/i, name);
  }
});

test('master identity batch reader is registered for production release with a service-only install probe', () => {
  const name = masterIdentityBatchReadMigrationName;
  assert.ok(releaseDatabaseMigrations.includes(name));
  assert.equal(releaseDatabaseMigrations[releaseDatabaseMigrations.indexOf(name) + 1], bunchNoteMultiAssignmentRoutingMigrationName);
  const contract = migrationContractQuery(name);
  for (const marker of [
    'inventory_master_identity_batch_read_v1(uuid,jsonb,text)',
    "has_function_privilege('service_role'",
    "not has_function_privilege('anon'",
    "not has_function_privilege('authenticated'",
    'master_identity_item_key_v1(text)',
    'master_identity_location_key_v1(text)',
    'ph_master_inventory_identity_batch_v1_idx',
    'MASTER_IDENTITY_SOURCE_NOT_READY',
    'MASTER_IDENTITY_REVISION_CHANGED',
    'MASTER_IDENTITY_ACTOR_FORBIDDEN',
  ]) assert.ok(contract.includes(marker), marker);
  assert.match(contract, /\bas installed\s*$/i);
  const migration = fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
  assert.match(migration, /create or replace function public\.inventory_master_identity_batch_read_v1\(\s*p_actor_id uuid,\s*p_queue_identities jsonb,\s*p_expected_revision text/i);
  assert.match(migration, /grant execute on function public\.inventory_master_identity_batch_read_v1\(uuid,jsonb,text\) to service_role/i);
  assert.match(migration, /revoke all on function public\.inventory_master_identity_batch_read_v1\(uuid,jsonb,text\) from public,anon,authenticated/i);
  assert.match(migration, /create index if not exists ph_master_inventory_identity_batch_v1_idx/i);
});

test('queue removal deployment consumes the probe alias and rolls back a failed contract', async () => {
  const contract = migrationContractQuery(requestQueueRemoveMigrationName);
  const resultColumn = contract.match(/\bas\s+(\w+)\s*$/i)?.[1];
  const source = fs.readFileSync(new URL(`../supabase/migrations/${requestQueueRemoveMigrationName}`, import.meta.url), 'utf8');
  for (const installed of [true, false]) {
    const calls = [];
    const client = { query: async (sql) => {
      calls.push(sql);
      return { rows: sql === contract ? [{ [resultColumn]: installed }] : [] };
    } };
    const operation = applyItemLowStockMigration({ client, source, targetMigrationName: requestQueueRemoveMigrationName });
    if (installed) {
      assert.deepEqual(await operation, { status: 'applied' });
      assert.equal(calls.at(-1), 'commit');
    } else {
      await assert.rejects(operation, /LOW_STOCK_DATABASE_CONTRACT_MISSING/);
      assert.equal(calls.at(-1), 'rollback');
      assert.ok(!calls.includes('commit'));
    }
  }
});

test('queue removal migration is ordered after raw importer and has the guarded service-only contract', () => {
  assert.equal(releaseDatabaseMigrations.indexOf(requestQueueRemoveMigrationName), releaseDatabaseMigrations.indexOf(smartShieldRawImportMigrationName) + 1);
  assert.equal(releaseDatabaseMigrations.indexOf(requestQueueRemoveMigrationName), releaseDatabaseMigrations.indexOf(smartShieldRawImportMigrationName) + 1);
  const query = migrationContractQuery(requestQueueRemoveMigrationName);
  for (const marker of ['ph_request_queue_removal_commands', 'REQUEST_REMOVE_STALE_REVISION',
    'delete from public.ph_active_request']) assert.ok(query.includes(marker), marker);
  assert.match(query, /not has_function_privilege\('anon'/);
  assert.match(query, /not has_function_privilege\('authenticated'/);
  assert.match(query, /has_function_privilege\('service_role'/);
  assert.match(query, /not has_table_privilege\('service_role'.*ph_request_queue_removal_commands/);
  const migration = fs.readFileSync(new URL(`../supabase/migrations/${requestQueueRemoveMigrationName}`, import.meta.url), 'utf8');
  assert.match(migration, /private\.request_archive_actor_allowed_v1/);
  assert.match(migration, /REQUEST_REMOVE_IDEMPOTENCY_CONFLICT/);
  assert.match(migration, /REQUEST_REMOVE_PENDING_REQUIRED/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on private\.ph_request_queue_removal_commands from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.request_queue_remove_v1[\s\S]*to service_role/i);
});


test('Prompt 2.5 migration follows Queue removal and restricts the V7 mutation endpoint', () => {
  assert.equal(releaseDatabaseMigrations.indexOf(prompt25HotfixMigrationName), releaseDatabaseMigrations.indexOf(requestQueueRemoveMigrationName) + 1);
  const contract = migrationContractQuery(prompt25HotfixMigrationName);
  assert.match(contract, /enqueue_drive_reclass_inquiry_v7/);
  assert.match(contract, /not has_function_privilege\('authenticated'/);
  assert.match(contract, /not has_function_privilege\('anon'/);
  const source = fs.readFileSync(new URL(`../supabase/migrations/${prompt25HotfixMigrationName}`,import.meta.url),'utf8');
  assert.match(source,/^begin;/i);
  assert.match(source,/commit;\s*$/i);
  assert.equal((source.match(/^begin;\s*$/gmi) || []).length, 1, 'release migration has one atomic transaction');
  assert.equal((source.match(/^commit;\s*$/gmi) || []).length, 1, 'no partial migration can commit');
});

test('Smart Shield release probe follows the preserved private V6 Eval wrapper after V7 installation', () => {
  const query = migrationContractQuery(reclassSmartShieldMigrationName);
  for (const version of [1, 2]) {
    assert.ok(query.includes(`private.submit_eval_work_v${version}_v6_impl(uuid,text,integer,jsonb,jsonb,text)`));
    assert.ok(query.includes(`position('submit_eval_work_v${version}_v6_impl' in pg_get_functiondef('public.submit_eval_work_v${version}`));
    assert.ok(query.includes(`not has_function_privilege('service_role',to_regprocedure('private.submit_eval_work_v${version}_v6_impl`));
  }
  assert.ok(query.includes("position('eval_work_smart_shield_v6_to_v5' in pg_get_functiondef(to_regprocedure('private.submit_eval_work_"));
});

test('historical pricing fallback is registered and retains the protected RPC contract', () => {
  assert.ok(releaseDatabaseMigrations.includes(historicalRequestsPriceFallbackMigrationName));
  const query = migrationContractQuery(historicalRequestsPriceFallbackMigrationName);
  for (const marker of ['fallback_prices','current_master_found','min(price)=max(price)','has_function_privilege','statement_timeout=10s','navigation_module_allowed_v1']) assert.ok(query.includes(marker), marker);
});

test('navigation role repair is release-registered with an exact function-body contract', () => {
  assert.ok(releaseDatabaseMigrations.includes(navigationRoleBoundariesMigrationName));
  const query = migrationContractQuery(navigationRoleBoundariesMigrationName);
  assert.ok(query.includes('private.navigation_module_allowed_v1(uuid,text)'));
  assert.ok(query.includes('[[:space:]]'));
  const sql = fs.readFileSync(new URL('../supabase/migrations/' + navigationRoleBoundariesMigrationName, import.meta.url), 'utf8');
  assert.match(sql, /^begin;/);
  assert.match(sql, /if found and not override_value then return false/);
  assert.doesNotMatch(sql, /^\s*(?:update\s+public\.profiles|grant\s)/mi);
});

test('history drilldown release contract checks ownership, financial redaction, orders, catalog pricing, dates and restricted grants',()=>{assert.ok(releaseDatabaseMigrations.includes(requestHistoryDrilldownMigrationName));const query=migrationContractQuery(requestHistoryDrilldownMigrationName);for(const marker of ['ph_historical_orders','history-v3:','catalog_prices','date_from_stamp','request_financial_values_v1','history_redact_financial_v1','ph_request_history_owner_isolation','ph_active_request_rep_isolation',"permissive='RESTRICTIVE'"])assert.ok(query.includes(marker),marker);});

test('request lifecycle migration is registered with permanent history and active-only contracts',()=>{
  assert.equal(requestLifecycleStateMachineMigrationName,'20261024183000_request_lifecycle_state_machine_v1.sql');
  assert.equal(releaseDatabaseMigrations.at(-1),requestLifecycleStateMachineMigrationName);
  const source=fs.readFileSync(new URL(`../supabase/migrations/${requestLifecycleStateMachineMigrationName}`,import.meta.url),'utf8');
  for(const marker of ['request_master_has_valid_evidence_v1','persist_completed_request_history_v1','completed_history','line_dollar_value','enforce_request_lifecycle_v1','request-completed:auto-evidence:']) assert.ok(source.includes(marker),marker);
  const contract=migrationContractQuery(requestLifecycleStateMachineMigrationName);
  for(const marker of ['effective_qty','completed_history','enforce_request_lifecycle_v1','request_work_command_v1']) assert.ok(contract.includes(marker),marker);
  assert.match(source,/^begin;\s/i);
  assert.match(source,/commit;\s*$/i);
});

test('enterprise Aura release guards forced RLS, own preferences, normalized roles and private form predicates', () => {
  assert.ok(releaseDatabaseMigrations.includes(auraEnterpriseDomainVoiceMigrationName));
  const query = migrationContractQuery(auraEnterpriseDomainVoiceMigrationName);
  for (const marker of ['aura_domain_glossary', 'user_preferences', 'aura_voice_preferences_v1',
    'aura_domain_context_v1', 'aura_form_matches_v1', '[[:space:]]', 'auth.uid()']) assert.ok(query.includes(marker), marker);
});

test('manager report read RPC is registered with bounded projections and service-only execution', () => {
  assert.ok(releaseDatabaseMigrations.includes(managerReportReadV2MigrationName));
  const contract = migrationContractQuery(managerReportReadV2MigrationName);
  assert.match(contract, /manager_report_read_v2\(jsonb\)/);
  assert.match(contract, /manager_ncr_outbox_metadata_v1\(text,text\)/);
  assert.match(contract, /has_function_privilege\('service_role','public\.manager_ncr_outbox_metadata_v1/);
  assert.match(contract, /not has_function_privilege\('authenticated','public\.manager_ncr_outbox_metadata_v1/);
  assert.match(contract, /has_function_privilege\('service_role'/);
  assert.match(contract, /not has_function_privilege\('authenticated'/);
  assert.match(contract, /not i\.indisvalid/);
  assert.match(contract, /pg_get_indexdef/);
  assert.match(contract, /pg_get_expr/);
  assert.match(contract, /'idx_ph_master_inventory_eval_itemcode_lookup','public\.ph_master_inventory','upper\(btrim\(coalesce\(itemcode,''''::text\)\)\)'/);
  assert.match(contract, /position\(regexp_replace\(lower\(expected\.key_fragment\),'\[\[:space:\]/);
  assert.match(contract, /in lower\(regexp_replace\(pg_get_indexdef\(c\.oid\)/);
  assert.match(contract, /i\.indrelid<>expected\.table_name::regclass/);
  for (const indexName of ['idx_ph_master_inventory_eval_itemcode_lookup', 'idx_ph_master_inventory_eval_tasks',
    'ph_master_inventory_location_work_match_idx', 'ph_inventory_row_assignments_owner_idx',
    'ph_inventory_row_assignments_itemcode_idx']) assert.ok(contract.includes(indexName), indexName);
  const migration = fs.readFileSync(new URL('../supabase/migrations/' + managerReportReadV2MigrationName, import.meta.url), 'utf8');
  const indexMigration = fs.readFileSync(new URL('../supabase/migrations/' + managerListReadV2MigrationName, import.meta.url), 'utf8');
  const normalizedItemcodeIndexKey = "upper(btrim(coalesce(itemcode,''::text)))";
  assert.ok(indexMigration.includes(normalizedItemcodeIndexKey), 'index migration and probe target use the same normalized itemcode key');
  assert.match(migration, /least\(100,greatest\(1/);
  assert.match(migration, /coalesce\(policy\.source_revision::text,''\)/);
  assert.match(migration, /from private\.ph_inventory_row_assignment_policy_state policy where policy\.singleton/);
  assert.match(migration, /private\.inventory_effective_owner_v1\(m\.unique_id\)/);
  assert.match(migration, /private\.manager_report_grid_filter_v1/);
  assert.match(migration, /'projection','list'\)='card'/);
  assert.match(migration, /surface='eval1'/);
  assert.match(migration, /surface='eval2'/);
  assert.match(migration, /then to_jsonb\(m\) when coalesce\(filters->>'projection','list'\)='card' then jsonb_build_object/);
  assert.match(migration, /upper\(btrim\(coalesce\(m\.itemcode,''\)\)\)=upper\(btrim\(filters->>'itemCode'\)\)/);
  assert.match(migration, /grant execute on function public\.manager_report_read_v2\(jsonb\) to service_role/);
  assert.match(migration, /grant execute on function public\.manager_ncr_outbox_metadata_v1\(text,text\) to service_role/);
  assert.match(migration, /private\.manager_report_ncr_active_line_count_v1/);
  assert.doesNotMatch(migration, /alter table .*row level security|drop policy|create policy/i);
  const api = fs.readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
  assert.match(api, /action === "report_read_v2"/);
  assert.match(api, /manager_report_read_v2/);
  assert.match(api, /data: \{ version: "manager-report-read-v2", surfaces/);
  assert.match(api, /MANAGER_REPORT_SOURCE_REVISION_CHANGED/);
});

test('Eval2 shared low-stock threshold migration is registered and validates both qualification paths', () => {
  const name = eval2SharedLowStockThresholdMigrationName;
  assert.ok(releaseDatabaseMigrations.includes(name));
  assert.ok(releaseDatabaseMigrations.indexOf(name) > releaseDatabaseMigrations.indexOf(masterInventoryRealtimeMigrationName));
  const contract = migrationContractQuery(name);
  assert.match(contract, /eval_report2_item_qualifies_v1/);
  assert.match(contract, /manager_report_read_v2/);
  assert.match(contract, /low_stock_max_slts/);
  assert.match(contract, /eval_item_low_stock_target_stats_v1/);
  assert.match(contract, /private\.eval_report2_item_qualifies_v1\(text,text,timestamptz\)/);
  assert.match(contract, /has_function_privilege\('service_role'/);
  assert.match(contract, /not has_function_privilege\('authenticated'/);
  const migration = fs.readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
  assert.match(migration, /create or replace function private\.eval_report2_item_qualifies_v1/i);
  assert.match(migration, /create or replace function public\.manager_report_read_v2/i);
  assert.match(migration, /case when surface\s*=\s*'eval2' then st\.low_limit/i);
  assert.match(migration, /coalesce\(o\.manual_override_qty,t\.suggested_qty,st\.low_limit\)/);
  assert.match(migration, /left join private\.eval_item_low_stock_target_stats_v1 t on surface<>'eval2'/i);
  assert.match(migration, /left join private\.ph_eval_item_low_stock_overrides o on surface<>'eval2'/i);
  const normalizedMigration = migration.replace(/\s/g, '').toLowerCase();
  const definitionNeedles = Array.from(contract.matchAll(/position\('((?:''|[^'])*)'\s+in lower\(regexp_replace/g), match => match[1].replace(/''/g, "'"));
  assert.equal(definitionNeedles.length, 3, 'the threshold and both gated joins must be checked');
  for (const needle of definitionNeedles) {
    assert.ok(normalizedMigration.includes(needle), `deployment contract must match the installed function: ${needle}`);
  }
  assert.equal((migration.match(/\$function\$;/g) || []).length, 2, 'both replacement functions must end before their grants');
});

test('Eval2 threshold replacement preserves all existing Location On Hand report returns', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/' + eval2SharedLowStockThresholdMigrationName, import.meta.url), 'utf8');
  const reader = migration.split(/create or replace function public\.manager_report_read_v2/i)[1].split('$function$')[1];
  const normalize = value => value.replace(/\s/g, '').toLowerCase();
  const roleGuard = "regexp_replace(upper(coalesce(actor.role,'')), '[^A-Z0-9]+', '', 'g') like '%FOREMAN%'";
  const responseReturn = `return private.manager_report_enrich_location_on_hand_v1(response,${roleGuard});`;
  assert.equal(normalize(reader).split(normalize(responseReturn)).length - 1, 2, 'NCR and Eval report responses retain enrichment and Foreman redaction');
  for (const surface of ['assigned', 'season']) {
    assert.ok(normalize(reader).includes(normalize(`return private.manager_report_enrich_location_on_hand_v1(private.manager_report_${surface}_page_v2(actor.id,filters,operation,page_offset,page_limit,source_revision),${roleGuard});`)), `${surface} page responses retain enrichment and Foreman redaction`);
  }
  assert.doesNotMatch(reader, /return\s+response\s*;/i);
});

test('manager list readers follow the report boundary and remain private service-only helpers', () => {
  assert.ok(releaseDatabaseMigrations.includes(managerListReadV2MigrationName));
  const contract = migrationContractQuery(managerListReadV2MigrationName);
  for (const functionName of ['manager_report_assigned_page_v2', 'manager_report_season_page_v2']) {
    assert.ok(contract.includes(`private.${functionName}`), functionName);
  }
  assert.match(contract, /not has_function_privilege\('authenticated'/);
  assert.match(contract, /not has_function_privilege\('service_role'/);
  const migration = fs.readFileSync(new URL('../supabase/migrations/' + managerListReadV2MigrationName, import.meta.url), 'utf8');
  assert.match(migration, /revoke all on function private\.manager_report_assigned_page_v2/);
  assert.match(migration, /revoke all on function private\.manager_report_season_page_v2/);
  assert.match(migration, /private\.inventory_effective_owner_v1/);
  assert.match(migration, /p_limit\)/);
  assert.doesNotMatch(migration, /alter table .*row level security|drop policy|create policy/i);
});

test('Location On Hand migration is release-registered after bounded Manager readers', () => {
  assert.ok(releaseDatabaseMigrations.indexOf(inventoryLocationOnHandMigrationName) > releaseDatabaseMigrations.indexOf(managerListReadV2MigrationName));
  const contract = migrationContractQuery(inventoryLocationOnHandMigrationName);
  assert.match(contract, /inventory_location_on_hand_read_v1\(uuid,jsonb,text\)/);
  assert.match(contract, /has_function_privilege\('service_role'/);
  assert.match(contract, /not has_function_privilege\('authenticated'/);
  assert.match(contract, /ph_master_inventory_item_location_on_hand_idx/);
  const migration = fs.readFileSync(new URL('../supabase/migrations/' + inventoryLocationOnHandMigrationName, import.meta.url), 'utf8');
  assert.match(migration, /manager_report_enrich_location_on_hand_v1/);
  assert.match(migration, /partition|group by p\.item_key,p\.location_key/i);
});

test('master inventory realtime publication migration is release registered and preserves RLS', () => {
  assert.ok(releaseDatabaseMigrations.indexOf(masterInventoryRealtimeMigrationName) > releaseDatabaseMigrations.indexOf(inventoryLocationOnHandMigrationName));
  const contract = migrationContractQuery(masterInventoryRealtimeMigrationName);
  assert.match(contract, /pg_publication_tables/);
  assert.match(contract, /supabase_realtime/);
  assert.match(contract, /ph_master_inventory/);
  assert.match(contract, /relrowsecurity/);
  assert.match(contract, /pg_policies/);
  assert.match(contract, /authenticated/);
  const migration = fs.readFileSync(new URL('../supabase/migrations/' + masterInventoryRealtimeMigrationName, import.meta.url), 'utf8');
  assert.match(migration, /alter publication supabase_realtime add table public\.ph_master_inventory/i);
  assert.match(migration, /pg_publication_tables/);
  assert.doesNotMatch(migration, /alter table .*disable row level security|drop policy|grant select on/i);
  assert.match(migration, /grant select \(unique_id, itemcode, locationcode\)/i);
  assert.match(migration, /create policy inventory_status_realtime_read_v1/);
  assert.match(migration, /current_active_profile/);
  assert.match(migration, /must_change_password/);
  assert.match(migration, /FOREMAN/);
  assert.match(contract, /has_column_privilege/);
});

test('enterprise Aura initializes trigram settings before replaying reader definitions', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/' + auraEnterpriseDomainVoiceMigrationName, import.meta.url), 'utf8');
  const bootstrap = sql.indexOf("perform extensions.word_similarity('aura','aura');");
  const replay = sql.indexOf('foreach signature in array array[');
  assert.ok(bootstrap >= 0 && bootstrap < replay);
  assert.doesNotMatch(sql, /grant\s+(?:set|alter system)\s+on\s+parameter/i);
  assert.equal(sql.split("old_text:=replace(old_text,E'\\r\\n',E'\\n');").length - 1, 2);
  assert.ok(sql.includes("new_text:=replace(new_text,E'\\r\\n',E'\\n');"));
});
