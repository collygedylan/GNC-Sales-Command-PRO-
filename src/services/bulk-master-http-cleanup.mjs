import assert from 'node:assert/strict';
import { HANDOVER_TRANSITION_KEY } from './bulk-master-http-contract.mjs';

export async function closeBulkMasterFences(ctx) {
  const { state, db, activeRunIds, success, setDisposableDbClaims, runIds, restoreRevisionSnapshot } = ctx;
  if (state.failureTriggerInstalled) {
    await db.query('drop trigger if exists ci_bulk_master_atomic_failure on public.ph_master_inventory; drop function if exists private.ci_bulk_master_atomic_failure()');
  }
  const unfinishedRunIds = [...activeRunIds];
  for (const runId of unfinishedRunIds) {
    const failed = await success('fail_dataset_import_v1', { p_run_id: runId }, { 'x-gnc-import-run-id': runId });
    assert.equal(failed.ok, true, `unfinished harness import ${runId} is failed through the service-role HTTP path`);
  }

  // Fail finalization marks datasets interrupted. Clear only this harness's
  // private fence rows and restore captured revisions before guarded table DML.
  await db.query('begin');
  await setDisposableDbClaims();
  if (runIds.length) {
    await db.query('delete from app_sync_private.import_leases where run_id = any($1::uuid[])', [runIds]);
    await db.query('delete from app_sync_private.import_runs where id = any($1::uuid[])', [runIds]);
  }
  await restoreRevisionSnapshot();
  await db.query('commit');
}

export async function removeBulkMasterFixtures(ctx) {
  const { state, db, setDisposableDbClaims, runIds, seasonIdempotencyKeys, requestIds, restoreHandoverFixture, restoreRevisionSnapshot } = ctx;
  // Direct fixture cleanup runs with disposable service-role request context;
  // it does not fabricate an import token or alter the public guard functions.
  await db.query('begin');
  await setDisposableDbClaims();
  if (runIds.length) {
    await db.query('delete from app_sync_private.ph_master_inventory_import_lineage_seen where run_id = any($1::uuid[])', [runIds]);
    await db.query('delete from app_sync_private.ph_master_inventory_item6_alias_seen_v7 where run_id = any($1::uuid[])', [runIds]);
    await db.query('delete from app_sync_private.ph_master_bulk_import_context_v1 where run_id = any($1::uuid[])', [runIds]);
  }
  await db.query("delete from app_sync_private.ph_master_bulk_import_source_v1 where canonical_unique_id like 'GNC_BULK_BENCH_%'");
  await db.query("delete from app_sync_private.ph_master_inventory_source_baselines where canonical_unique_id like 'GNC_BULK_BENCH_%'");
  await db.query("delete from app_sync_private.ph_master_inventory_app_edits where canonical_unique_id like 'GNC_BULK_BENCH_%'");
  await db.query("delete from app_sync_private.inventory_live_overrides_v1 where starts_with(canonical_unique_id,'GNC_BULK_BENCH_')");
  await db.query("delete from private.ph_inventory_row_assignment_audit where master_unique_id like 'GNC_BULK_BENCH_%'");
  await db.query("delete from public.ph_inventory_row_assignments where master_unique_id like 'GNC_BULK_BENCH_%'");
  await db.query('delete from private.season_sales_office_idempotency where idempotency_key = any($1::text[])', [seasonIdempotencyKeys]);
  await db.query(`delete from public.ph_season_sales_office_events event
    using public.ph_season_sales_office_state state
    where event.state_id = state.id and state.itemcode_normalized like 'GNC_BULK_BENCH_%'`);
  await db.query("delete from public.ph_sales_office where unique_id like 'GNC_BULK_BENCH_%'");
  await db.query("delete from public.ph_season_sales_office_state where itemcode_normalized like 'GNC_BULK_BENCH_%'");
  await db.query('delete from app_sync_private.ph_master_bulk_import_receipts_v1 where request_id = any($1::uuid[])', [requestIds]);
  await db.query("delete from public.ph_master_inventory where unique_id like 'GNC_BULK_BENCH_%'");
  await restoreHandoverFixture();
  await db.query("delete from public.ph_app_settings where key='current_season_salesyear'");
  if (state.seasonSettingsSnapshot.length) {
    await db.query(`insert into public.ph_app_settings(key, value, updated_by, updated_at)
      select key, value, updated_by, updated_at
      from jsonb_to_recordset($1::jsonb) as snapshot(key text, value jsonb, updated_by text, updated_at timestamptz)`,
    [JSON.stringify(state.seasonSettingsSnapshot)]);
  }
  await restoreRevisionSnapshot();
  await db.query('commit');
}

export async function verifyBulkMasterCleanup(ctx) {
  const { state, queryValue, runIds, query, requestIds, seasonIdempotencyKeys } = ctx;
  assert.equal(Number((await queryValue('select count(*)::int as count from app_sync_private.import_runs where id = any($1::uuid[])', [runIds])).count), 0,
    'all harness-owned import runs are removed');
  assert.equal(Number((await queryValue('select count(*)::int as count from app_sync_private.import_leases where run_id = any($1::uuid[])', [runIds])).count), 0,
    'all harness-owned import leases are removed');
  assert.deepEqual(await query(`select key, revision, state, changed_at::text as changed_at from public.app_dataset_revisions
    where key = any($1::text[]) order by key`, [state.revisionKeys]), state.revisionSnapshot,
  'captured PH import revisions are restored exactly');
  assert.deepEqual(await query(`select key, value, updated_by, updated_at::text as updated_at
    from public.ph_app_settings where key='current_season_salesyear'`), state.seasonSettingsSnapshot,
  'season settings are restored exactly');
  await verifyHandoverCleanup(ctx);
  assert.equal(Number((await queryValue("select count(*)::int as count from public.ph_master_inventory where unique_id like 'GNC_BULK_BENCH_%'")).count), 0,
    'synthetic master inventory rows are removed');
  assert.equal(Number((await queryValue("select count(*)::int as count from app_sync_private.ph_master_inventory_source_baselines where canonical_unique_id like 'GNC_BULK_BENCH_%'")).count), 0,
    'synthetic source baselines are removed');
  assert.equal(Number((await queryValue("select count(*)::int as count from app_sync_private.ph_master_inventory_app_edits where canonical_unique_id like 'GNC_BULK_BENCH_%'")).count), 0,
    'synthetic app edits are removed');
  assert.equal(Number((await queryValue("select count(*)::int as count from app_sync_private.inventory_live_overrides_v1 where starts_with(canonical_unique_id,'GNC_BULK_BENCH_')")).count), 0,
    'synthetic live overrides are removed before another import can reuse the fixture identities');
  assert.equal(Number((await queryValue('select count(*)::int as count from app_sync_private.ph_master_bulk_import_receipts_v1 where request_id = any($1::uuid[])', [requestIds])).count), 0,
    'harness-owned RPC receipts are removed');
  assert.equal(Number((await queryValue("select count(*)::int as count from app_sync_private.ph_master_bulk_import_source_v1 where canonical_unique_id like 'GNC_BULK_BENCH_%'")).count), 0,
    'synthetic bulk source fingerprints are removed');
  assert.equal(Number((await queryValue('select count(*)::int as count from app_sync_private.ph_master_inventory_import_lineage_seen where run_id = any($1::uuid[])', [runIds])).count), 0,
    'harness lineage observations are removed');
  assert.equal(Number((await queryValue('select count(*)::int as count from app_sync_private.ph_master_inventory_item6_alias_seen_v7 where run_id = any($1::uuid[])', [runIds])).count), 0,
    'harness Item6 alias observations are removed');
  assert.equal(Number((await queryValue('select count(*)::int as count from app_sync_private.ph_master_bulk_import_context_v1 where run_id = any($1::uuid[])', [runIds])).count), 0,
    'harness bulk import context is removed');
  assert.equal(Number((await queryValue("select count(*)::int as count from app_sync_private.ph_master_inventory_item6_source_v7 where canonical_unique_id like 'GNC_BULK_BENCH_%'")).count), 0,
    'synthetic Item6 source fingerprints are removed');
  assert.equal(Number((await queryValue("select count(*)::int as count from app_sync_private.ph_master_inventory_item6_aliases_v7 where canonical_unique_id like 'GNC_BULK_BENCH_%' or imported_unique_id like 'GNC_BULK_BENCH_%'")).count), 0,
    'synthetic Item6 aliases are removed');
  assert.equal(Number((await queryValue("select count(*)::int as count from public.ph_inventory_row_assignments where master_unique_id like 'GNC_BULK_BENCH_%'")).count), 0,
    'synthetic row assignments are removed');
  assert.equal(Number((await queryValue("select count(*)::int as count from private.ph_inventory_row_assignment_audit where master_unique_id like 'GNC_BULK_BENCH_%'")).count), 0,
    'synthetic assignment audit entries are removed');
  assert.equal(Number((await queryValue("select count(*)::int as count from public.ph_season_sales_office_state where itemcode_normalized like 'GNC_BULK_BENCH_%'")).count), 0,
    'synthetic Season state is removed');
  assert.equal(Number((await queryValue("select count(*)::int as count from public.ph_sales_office where unique_id like 'GNC_BULK_BENCH_%'")).count), 0,
    'synthetic Sales Office mirrors are removed');
  assert.equal(Number((await queryValue('select count(*)::int as count from private.season_sales_office_idempotency where idempotency_key = any($1::text[])', [seasonIdempotencyKeys])).count), 0,
    'harness Season reconciliation idempotency rows are removed');
}

async function verifyHandoverCleanup(ctx) {
  const { state, queryValue, syntheticHandoverProfileId } = ctx;
  if (state.handoverStateCaptured) {
    const restoredHandover = await queryValue(`select departing_profile_id::text as departing_profile_id,
        successor_profile_id::text as successor_profile_id,effective_at::text as effective_at
      from private.scheduled_account_handover_v1 where transition_key=$1`, [HANDOVER_TRANSITION_KEY]);
    assert.deepEqual(restoredHandover, state.handoverSnapshot || undefined,
      'the pre-existing handover schedule is restored exactly or the fixture-created row is removed');
    assert.equal(Number((await queryValue('select count(*)::int as count from public.profiles where id=$1::uuid',
      [syntheticHandoverProfileId])).count), 0, 'the synthetic departing profile is removed');
    if (state.syntheticHandoverUserCreated) {
      assert.equal(Number((await queryValue('select count(*)::int as count from auth.users where id=$1::uuid',
        [syntheticHandoverProfileId])).count), 0, 'the synthetic departing auth user is removed');
    }
    assert.equal(Number((await queryValue(`select count(*)::int as count
      from private.scheduled_account_handover_audit_v1 where transition_key=$1
        and event_key like 'future:ph_master_inventory:GNC_BULK_BENCH_%'`,
    [HANDOVER_TRANSITION_KEY])).count), 0, 'synthetic handover audit entries are removed');
  }
}
