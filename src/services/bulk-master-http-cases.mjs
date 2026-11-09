import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { ROW_COUNT, legacyBulkSource, sourceRowsFromProductionShape } from './bulk-master-http-source.mjs';
import { EXPECTED_MASTER_PRODUCTION_TRIGGER_COUNT } from './bulk-master-http-contract.mjs';
import { errorText } from './bulk-master-http-transport.mjs';

async function assertBulkPublishBoundaries(ctx, initialRequest) {
  const { rpc, values, requestIds } = ctx;
  const mismatchHeader = await rpc('bulk_import_master_snapshot_v1', initialRequest, values.SERVICE_ROLE_KEY,
    { 'x-gnc-import-run-id': randomUUID() });
  assert.notEqual(mismatchHeader.status, 200, 'a forged import fence header is rejected');
  assert.match(errorText(mismatchHeader.body), /BULK_MASTER_IMPORT_FENCE_MISMATCH/);

  const wrongFence = { ...initialRequest, p_run_id: randomUUID(), p_request_id: randomUUID() };
  requestIds.push(wrongFence.p_request_id);
  const missingFence = await rpc('bulk_import_master_snapshot_v1', wrongFence);
  assert.notEqual(missingFence.status, 200, 'an RPC cannot publish outside its active fence');
  assert.match(errorText(missingFence.body), /MASTER_PRIORITY_HOLD_IMPORT_TOKEN_INVALID/);

  const denied = await rpc('bulk_import_master_snapshot_v1', initialRequest, values.ANON_KEY);
  assert.ok([401, 403, 404].includes(denied.status), 'anon must not execute the service-only RPC');

  const rawOnlyRequestId = randomUUID();
  requestIds.push(rawOnlyRequestId);
  const rawOnlyColumn = await rpc('bulk_import_master_snapshot_v1', { ...initialRequest,
    p_request_id: rawOnlyRequestId,
    p_rows: initialRequest.p_rows.map((row, index) => index === 0
      ? { ...row, values: { ...row.values, ext_equiv_unit: null } } : row),
  });
  assert.notEqual(rawOnlyColumn.status, 200, 'raw-only staging fields cannot become legacy live columns');
  assert.match(errorText(rawOnlyColumn.body), /BULK_MASTER_IMPORT_COLUMN_INVALID/);
}

async function assertAlteredBulkRetry(ctx, initialRequest) {
  const { state, rpc } = ctx;
  const alteredRetry = {
    ...initialRequest,
    p_rows: state.initial.rows.map((row, index) => index === 0
      ? { ...row, values: { ...row.values, commonname: `${row.values.commonname} altered` } } : row),
  };
  const altered = await rpc('bulk_import_master_snapshot_v1', alteredRetry);
  assert.notEqual(altered.status, 200, 'same request UUID with different JSONB is rejected');
  assert.match(errorText(altered.body), /BULK_MASTER_IMPORT_REQUEST_ID_REUSED/);
}

export async function assertInitialBulkPublication(ctx) {
  const { state, begin, bulkPayload, measuredBulk, queryValue, finish, success } = ctx;
  const runId = await begin();
  const initialRequest = bulkPayload(runId, state.initial);
  await assertBulkPublishBoundaries(ctx, initialRequest);
  const first = await measuredBulk(initialRequest, 'initial 9,539-row insert');
  process.stdout.write(`[bulk-master-http] insert RPC ${Math.round(first.elapsedMs)}ms` + '\n');
  assert.deepEqual(first.result, {
    published: true, runId, requestId: initialRequest.p_request_id, sourceDigest: state.initial.sourceDigest,
    sourceRows: ROW_COUNT, inserted: ROW_COUNT, updated: 0, deleted: 1, unchanged: 0,
  });
  assert.equal(Number((await queryValue('select count(*)::int as count from public.ph_master_inventory')).count), ROW_COUNT);
  await finish(runId);
  const replayStart = performance.now();
  const replay = await success('bulk_import_master_snapshot_v1', initialRequest);
  const replayElapsedMs = performance.now() - replayStart;
  assert.ok(replayElapsedMs < 55000, `exact replay RPC exceeded the 55-second database budget (${Math.round(replayElapsedMs)} ms)`);
  process.stdout.write(`[bulk-master-http] exact replay RPC ${Math.round(replayElapsedMs)}ms` + '\n');
  assert.deepEqual(replay, first.result, 'an exact request retry replays the saved response after the import fence closes');
  await assertAlteredBulkRetry(ctx, initialRequest);
  return { insert: first.elapsedMs, replay: replayElapsedMs };
}

export async function assertChangedBulkPublication(ctx) {
  const { state, withDisposableDbClaims, db, queryValue, begin, bulkPayload, measuredBulk, finish } = ctx;
  const protectedId = state.initial.rows[0].values.unique_id;
  await withDisposableDbClaims(() => db.query(`update public.ph_master_inventory set holdstopcode='APP_HOLD', holdstopreason='Synthetic app hold',
    locationnote='Synthetic app location note' where unique_id=$1`, [protectedId]));
  const protectedBefore = await queryValue(`select holdstopcode, holdstopreason, locationnote
    from public.ph_master_inventory where unique_id=$1`, [protectedId]);
  assert.deepEqual(protectedBefore, {
    holdstopcode: 'APP_HOLD', holdstopreason: 'Synthetic app hold', locationnote: 'Synthetic app location note',
  });

  const changed = legacyBulkSource(sourceRowsFromProductionShape({ shape: state.shape, columns: state.tableColumns, variant: 1 }));
  const changedRun = await begin();
  const changedRequest = bulkPayload(changedRun, changed);
  const changedResult = await measuredBulk(changedRequest, 'changed 9,539-row snapshot');
  process.stdout.write(`[bulk-master-http] changed snapshot RPC ${Math.round(changedResult.elapsedMs)}ms` + '\n');
  assert.equal(changedResult.result.inserted, 0);
  assert.equal(changedResult.result.updated, ROW_COUNT);
  assert.equal(changedResult.result.deleted, 0);
  assert.equal(changedResult.result.unchanged, 0);
  const protectedAfter = await queryValue(`select holdstopcode, holdstopreason, locationnote
    from public.ph_master_inventory where unique_id=$1`, [protectedId]);
  assert.deepEqual(protectedAfter, protectedBefore, 'imported source values cannot overwrite live app hold/location fields');
  await finish(changedRun);
  const baselineRows = changed.rows.map(({ values: { unique_id, priority, holdstopcode, holdstopreason } }) =>
    ({ unique_id, priority, holdstopcode, holdstopreason }));
  return { protectedId, protectedBefore, changedName: changed.rows[0].values.commonname,
    milliseconds: changedResult.elapsedMs, baselineRows };
}

export async function assertUnchangedBulkPublication(ctx) {
  const { state, begin, bulkPayload, measuredBulk, finish, rpc } = ctx;
  const unchanged = legacyBulkSource(sourceRowsFromProductionShape({ shape: state.shape, columns: state.tableColumns, variant: 1, syncTime: '2026-10-14T12:02:00.000Z' }));
  const unchangedRun = await begin();
  const unchangedRequest = bulkPayload(unchangedRun, unchanged);
  const unchangedResult = await measuredBulk(unchangedRequest, 'unchanged 9,539-row snapshot with fresh sync metadata');
  process.stdout.write(`[bulk-master-http] unchanged snapshot RPC ${Math.round(unchangedResult.elapsedMs)}ms` + '\n');
  assert.equal(unchangedResult.result.inserted, 0);
  assert.equal(unchangedResult.result.updated, 0, 'last_updated and filename metadata do not force a business-row update');
  assert.equal(unchangedResult.result.unchanged, ROW_COUNT);
  await finish(unchangedRun);

  const noFenceRequest = bulkPayload(randomUUID(), unchanged);
  const noFence = await rpc('bulk_import_master_snapshot_v1', noFenceRequest);
  assert.notEqual(noFence.status, 200, 'publishing without an active canonical fence is forbidden');
  assert.match(errorText(noFence.body), /MASTER_PRIORITY_HOLD_IMPORT_TOKEN_INVALID/);
  return unchangedResult.elapsedMs;
}

export async function assertAtomicBulkRollback(ctx, { protectedId, changedName }) {
  const { state, begin, bulkPayload, db, rpc, queryValue, fail } = ctx;
  const atomicRun = await begin();
  const atomicSource = legacyBulkSource(sourceRowsFromProductionShape({ shape: state.shape, columns: state.tableColumns, rowCount: 2, variant: 2 }));
  atomicSource.rows[0].values.commonname = 'Changed before intentional atomic failure';
  atomicSource.rows[0].values.concat = 'changed-hash';
  const newRow = { ...atomicSource.rows[1], values: { ...atomicSource.rows[1].values } };
  newRow.values.unique_id = 'GNC_BULK_BENCH_ATOMIC_NEW';
  newRow.values.itemcode = 'GNC_BULK_BENCH_ATOMIC_NEW_ITEM';
  atomicSource.rows = [atomicSource.rows[0], newRow];
  const canonicalAtomicRows = vm.runInContext('canonicalizeMasterBulkPayloadValue_', atomicSource.context)(atomicSource.rows);
  atomicSource.sourceDigest = createHash('sha256').update(JSON.stringify(canonicalAtomicRows)).digest('hex');
  const atomicPayload = bulkPayload(atomicRun, atomicSource);
  state.failureTriggerInstalled = true;
  await db.query(`create function private.ci_bulk_master_atomic_failure() returns trigger language plpgsql as $$
    begin
      if coalesce(current_setting('request.headers', true)::jsonb->>'x-gnc-import-run-id','') <> '' then
        raise exception using errcode='P0001', message='CI_BULK_MASTER_ATOMIC_FAILURE';
      end if;
      return null;
    end $$;
    create trigger ci_bulk_master_atomic_failure after insert or update on public.ph_master_inventory
    for each statement execute function private.ci_bulk_master_atomic_failure();`);
  const atomicFailure = await rpc('bulk_import_master_snapshot_v1', atomicPayload);
  assert.notEqual(atomicFailure.status, 200, 'the injected post-write failure must abort the snapshot');
  assert.match(errorText(atomicFailure.body), /CI_BULK_MASTER_ATOMIC_FAILURE/);
  assert.equal(Number((await queryValue(`select count(*)::int as count from public.ph_master_inventory where unique_id=$1`, [newRow.values.unique_id])).count), 0);
  assert.equal((await queryValue(`select commonname from public.ph_master_inventory where unique_id=$1`, [protectedId])).commonname,
    changedName, 'an earlier upsert in the failed statement is rolled back');
  await db.query('drop trigger ci_bulk_master_atomic_failure on public.ph_master_inventory; drop function private.ci_bulk_master_atomic_failure()');
  state.failureTriggerInstalled = false;
  await fail(atomicRun);
}

async function seedLegacyBulkSourceBaselines(db, baselineRows) {
  await db.query(`insert into app_sync_private.ph_master_inventory_source_baselines(
      canonical_unique_id,lineage_key,priority,holdstopcode,holdstopreason)
    select live.unique_id,private.ph_master_inventory_lineage_key_v1(live),
      raw.priority,raw.holdstopcode,raw.holdstopreason
    from jsonb_to_recordset($1::jsonb) raw(unique_id text,priority text,holdstopcode text,holdstopreason text)
    join public.ph_master_inventory live on live.unique_id=raw.unique_id
    on conflict(canonical_unique_id) do nothing`, [JSON.stringify(baselineRows)]);
}

async function assertLegacyBulkPreconditions(ctx, baselineRows) {
  const { db, runIds, queryValue } = ctx;
  // Reproduce the production legacy-bootstrap path: all 9,539 live rows and
  // their source baselines exist, but no bulk-import source hashes exist yet.
  // The first full publication must update the pre-existing rows in one RPC.
  await seedLegacyBulkSourceBaselines(db, baselineRows);
  await db.query(`delete from app_sync_private.ph_master_bulk_import_context_v1
    where run_id = any($1::uuid[])`, [runIds]);
  await db.query('analyze app_sync_private.ph_master_bulk_import_context_v1');
  const emptyContextState = await queryValue(`select
      (select count(*)::int from app_sync_private.ph_master_bulk_import_context_v1) as context_count,
      c.reltuples::bigint as estimated_rows
    from pg_class c where c.oid='app_sync_private.ph_master_bulk_import_context_v1'::regclass`);
  assert.equal(emptyContextState.context_count, 0, 'legacy bootstrap starts with an empty bulk context table');
  assert.equal(Number(emptyContextState.estimated_rows), 0,
    'ANALYZE records zero-row planner statistics for the empty context table');
  await db.query("delete from app_sync_private.ph_master_bulk_import_source_v1 where canonical_unique_id like 'GNC_BULK_BENCH_%'");
  assert.equal(Number((await queryValue("select count(*)::int as count from app_sync_private.ph_master_bulk_import_source_v1 where canonical_unique_id like 'GNC_BULK_BENCH_%'")).count), 0,
    'legacy bootstrap begins with no saved bulk-source hashes');
  assert.equal(Number((await queryValue("select count(*)::int as count from app_sync_private.ph_master_inventory_source_baselines where canonical_unique_id like 'GNC_BULK_BENCH_%'")).count), ROW_COUNT,
    'legacy bootstrap preserves a source baseline for every existing row');
  assert.equal(Number((await queryValue(`select count(*)::int as count
    from app_sync_private.ph_master_inventory_source_baselines b
    join public.ph_master_inventory m on m.unique_id=b.canonical_unique_id
    where b.canonical_unique_id like 'GNC_BULK_BENCH_%'`)).count), ROW_COUNT,
  'every pre-existing live identity has its matching source baseline');
  const legacyTriggerState = await queryValue(`select count(*)::int as total,
      count(*) filter (where tgenabled <> 'D')::int as enabled
    from pg_trigger where tgrelid='public.ph_master_inventory'::regclass and not tgisinternal`);
  assert.deepEqual(legacyTriggerState, {
    total: EXPECTED_MASTER_PRODUCTION_TRIGGER_COUNT,
    enabled: EXPECTED_MASTER_PRODUCTION_TRIGGER_COUNT,
  }, 'all production triggers remain enabled for the legacy bootstrap RPC');
}

export async function assertLegacyBulkBootstrap(ctx, { protectedId, protectedBefore, baselineRows }) {
  const { state, begin, bulkPayload, measuredBulk, queryValue, finish } = ctx;
  await assertLegacyBulkPreconditions(ctx, baselineRows);
  const legacyBootstrap = legacyBulkSource(sourceRowsFromProductionShape({ shape: state.shape, columns: state.tableColumns, variant: 2 }));
  const legacyRun = await begin();
  const legacyRequest = bulkPayload(legacyRun, legacyBootstrap);
  const legacyResult = await measuredBulk(legacyRequest, 'first full 9,539-row snapshot over legacy existing rows');
  process.stdout.write(`[bulk-master-http] legacy bootstrap RPC ${Math.round(legacyResult.elapsedMs)}ms` + '\n');
  assert.equal(legacyResult.result.inserted, 0);
  assert.equal(legacyResult.result.updated, ROW_COUNT);
  assert.equal(legacyResult.result.deleted, 0);
  assert.equal(legacyResult.result.unchanged, 0);
  assert.equal(Number((await queryValue("select count(*)::int as count from app_sync_private.ph_master_bulk_import_source_v1 where canonical_unique_id like 'GNC_BULK_BENCH_%'")).count), ROW_COUNT,
    'the first full publication bootstraps a source hash for every existing row');
  assert.deepEqual(await queryValue(`select holdstopcode, holdstopreason, locationnote
    from public.ph_master_inventory where unique_id=$1`, [protectedId]), protectedBefore,
  'legacy bootstrap updates cannot overwrite live app hold/location fields');
  await finish(legacyRun);
  return legacyResult.elapsedMs;
}
