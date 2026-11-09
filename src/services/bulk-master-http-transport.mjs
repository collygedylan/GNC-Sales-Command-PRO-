import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { Client } from 'pg';
import { inspectDisposableSupabaseWorkspace } from '../../scripts/disposable-supabase-container.mjs';
import { packageBin, runNode } from '../../scripts/tooling-process.mjs';
import { HANDOVER_TRANSITION_KEY } from './bulk-master-http-contract.mjs';

function parseStatusEnvironment(output) {
  return Object.fromEntries(String(output).split(/\r?\n/)
    .map(line => line.match(/^([A-Z_]+)="(.*)"$/)).filter(Boolean).map(match => [match[1], match[2]]));
}

export function errorText(body) {
  return String(body && (body.message || body.error || body.hint) || JSON.stringify(body));
}

export async function connectBulkMasterFixture(workspaceRoot) {
  const cli = packageBin('supabase', 'supabase');
  const workspace = inspectDisposableSupabaseWorkspace({ workspaceRoot, cli });
  const values = parseStatusEnvironment(runNode([cli, '--workdir', workspace.absolute, 'status', '--output', 'env'], { capture: true }));
  const api = new URL(values.API_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname) && api.protocol === 'http:' && values.SERVICE_ROLE_KEY,
    'Only a verified disposable Supabase HTTP endpoint is accepted');
  assert.ok(values.ANON_KEY, 'The disposable workspace must expose its local anon key for authorization denial checks');

  const db = new Client({ connectionString: workspace.dbUrl.href, connectionTimeoutMillis: 10000 });
  await db.connect();
  const rpc = async (name, payload, key = values.SERVICE_ROLE_KEY, headers = {}, timeoutMs = 65000) => {
    const response = await fetch(new URL(`/rest/v1/rpc/${name}`, api), {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
    });
    const responseText = await response.text();
    let body;
    try { body = responseText ? JSON.parse(responseText) : null; } catch { body = responseText; }
    return { status: response.status, body };
  };
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const queryValue = async (sql, params = []) => (await query(sql, params))[0];
  const success = async (name, payload, headers = {}) => {
    const result = await rpc(name, payload, values.SERVICE_ROLE_KEY, headers);
    assert.equal(result.status, 200, `${name}: ${errorText(result.body)}`);
    return result.body;
  };
  const syntheticHandoverProfileId = randomUUID();
  return { db, rpc, query, queryValue, success, values, state: {}, runIds: [],
    activeRunIds: new Set(), requestIds: [], seasonIdempotencyKeys: [],
    syntheticHandoverProfileId, syntheticHandoverEmail: 'kayla.bulk-fixture.'+syntheticHandoverProfileId+'@local.invalid' };
}

async function setDisposableDbClaims(ctx) {
  const { db } = ctx;
  await db.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
  await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
  await db.query("select set_config('request.headers', '{}', true)");
}

async function withDisposableDbClaims(ctx, callback) {
  const { db, setDisposableDbClaims } = ctx;
  await db.query('begin');
  try {
    await setDisposableDbClaims();
    const result = await callback();
    await db.query('commit');
    return result;
  } catch (error) {
    await db.query('rollback').catch(() => {});
    throw error;
  }
}

async function restoreRevisionSnapshot(ctx) {
  const { state, db } = ctx;
  const snapshotKeys = (state.revisionSnapshot || []).map(row => row.key);
  await db.query(`delete from public.app_dataset_revisions current
    where not (current.key = any($1::text[]))`, [snapshotKeys]);
  const restored = await db.query(`insert into public.app_dataset_revisions(key,revision,state,changed_at)
    select snapshot.key,snapshot.revision,snapshot.state,snapshot.changed_at
    from jsonb_to_recordset($1::jsonb) as snapshot(key text, revision bigint, state text, changed_at timestamptz)
    on conflict(key) do update set revision=excluded.revision,state=excluded.state,changed_at=excluded.changed_at
    returning key`, [JSON.stringify(state.revisionSnapshot || [])]);
  assert.equal(restored.rowCount, state.revisionSnapshot?.length || 0,
    'all captured dataset revision rows are restored exactly after fixture triggers');
}

async function restoreHandoverFixture(ctx) {
  const { state, db, syntheticHandoverProfileId } = ctx;
  if (!state.handoverStateCaptured) return;
  if (state.handoverScheduleTouched) {
    await db.query(`delete from private.scheduled_account_handover_audit_v1
      where transition_key=$1 and event_key like 'future:ph_master_inventory:GNC_BULK_BENCH_%'`,
    [HANDOVER_TRANSITION_KEY]);
    if (state.handoverSnapshot) {
      await db.query(`update private.scheduled_account_handover_v1
        set departing_profile_id=$2::uuid,successor_profile_id=$3::uuid,effective_at=$4::timestamptz
        where transition_key=$1`, [HANDOVER_TRANSITION_KEY, state.handoverSnapshot.departing_profile_id,
        state.handoverSnapshot.successor_profile_id, state.handoverSnapshot.effective_at]);
    } else {
      await db.query('delete from private.scheduled_account_handover_v1 where transition_key=$1', [HANDOVER_TRANSITION_KEY]);
    }
  }
  if (state.syntheticHandoverProfileCreated) {
    await db.query('delete from public.profiles where id=$1::uuid', [syntheticHandoverProfileId]);
  }
  if (state.syntheticHandoverUserCreated) {
    await db.query('delete from auth.users where id=$1::uuid', [syntheticHandoverProfileId]);
  }
}

async function begin(ctx) {
  const { state, success, runIds, activeRunIds } = ctx;
  const runId = randomUUID();
  const result = await success('begin_dataset_import_v1', {
    p_dataset_keys: state.fenceDatasetKeys, p_run_id: runId, p_canonical_keys: ['ph_master_inventory'],
  });
  assert.equal(result.ok, true, 'the complete canonical PH fence must be active before bulk writes');
  runIds.push(runId);
  activeRunIds.add(runId);
  return runId;
}

async function finish(ctx, runId) {
  const { reconcileSeasonSales, fencedSuccess, reconcileAssignments, success, activeRunIds } = ctx;
  await reconcileSeasonSales(runId);
  const evalResult = await fencedSuccess('reconcile_eval_report2_work_v1', {
    p_import_revision: new Date().toISOString(), p_dry_run: false, p_limit: 5000,
  }, runId);
  assert.equal(evalResult.status, 'completed', 'Eval Reports #2 reconciliation completes before fence finalization');
  await reconcileAssignments(runId);
  const result = await success('finish_dataset_import_v1', { p_run_id: runId });
  assert.equal(result.ok, true);
  activeRunIds.delete(runId);
}

async function fail(ctx, runId) {
  const { success, activeRunIds } = ctx;
  const result = await success('fail_dataset_import_v1', { p_run_id: runId }, { 'x-gnc-import-run-id': runId });
  assert.equal(result.ok, true);
  activeRunIds.delete(runId);
}

function bulkPayload(ctx, runId, source, requestId = randomUUID()) {
  const { requestIds } = ctx;
  requestIds.push(requestId);
  return { p_run_id: runId, p_request_id: requestId, p_rows: source.rows, p_source_digest: source.sourceDigest };
}

async function measuredBulk(ctx, payload, label, headers = {}) {
  const { success } = ctx;
  const start = performance.now();
  const result = await success('bulk_import_master_snapshot_v1', payload, headers);
  const elapsedMs = performance.now() - start;
  assert.ok(elapsedMs < 55000, `${label} RPC exceeded the 55-second database budget (${Math.round(elapsedMs)} ms)`);
  return { result, elapsedMs };
}

async function fencedSuccess(ctx, name, payload, runId) {
  const { rpc, values } = ctx;
  const result = await rpc(name, payload, values.SERVICE_ROLE_KEY, {
    'x-gnc-import-run-id': runId, 'x-gnc-master-tuple-policy': 'raw-priority-hold-v1',
  });
  assert.equal(result.status, 200, `${name}: ${errorText(result.body)}`);
  return result.body;
}

async function reconcileSeasonSales(ctx, runId) {
  const { state, seasonIdempotencyKeys, fencedSuccess } = ctx;
  const safeRevision = new Date().toISOString();
  const importRevision = `master_inventory:${safeRevision}`;
  const baseKey = `season-sales-${createHash('sha256').update(`master_inventory|${safeRevision}`).digest('base64url').slice(0, 80)}`;
  seasonIdempotencyKeys.push(baseKey);
  const dry = await fencedSuccess('reconcile_season_sales_office_v1', {
    p_itemcodes: null, p_dry_run: true, p_import_revision: importRevision, p_idempotency_key: null,
  }, runId);
  const plan = { ...dry, status: dry.status === 'dry_run' && dry.ok === true ? 'completed' : dry.status };
  const scope = vm.runInContext('validateSeasonSalesReconciliationPlan_', state.initial.context)(plan, 'SEASON_SALES_RECONCILIATION');
  if (!scope.itemcodes.length) {
    const result = await fencedSuccess('reconcile_season_sales_office_v1', {
      p_itemcodes: null, p_dry_run: false, p_import_revision: importRevision, p_idempotency_key: baseKey,
    }, runId);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');
    return;
  }
  const totals = { winnerCount: 0, openCount: 0, doneCount: 0, newStateCount: 0,
    winnerChangeCount: 0, reopenCount: 0, retireCount: 0, mirrorUpsertCount: 0 };
  const batchSize = 25;
  for (let offset = 0, batchIndex = 0; offset < scope.itemcodes.length; offset += batchSize, batchIndex++) {
    const batch = scope.itemcodes.slice(offset, offset + batchSize);
    const heartbeat = await fencedSuccess('heartbeat_dataset_import_v1', { p_run_id: runId }, runId);
    assert.equal(heartbeat.ok, true);
    const key = vm.runInContext('getSeasonSalesBatchIdempotencyKey_', state.initial.context)(baseKey, batchIndex, batch);
    seasonIdempotencyKeys.push(key);
    const result = await fencedSuccess('reconcile_season_sales_office_v1', {
      p_itemcodes: batch, p_dry_run: false, p_import_revision: importRevision, p_idempotency_key: key,
    }, runId);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'completed');
    assert.equal(result.seasonCode, scope.seasonCode);
    assert.equal(result.salesYear, scope.salesYear);
    for (const keyName of Object.keys(totals)) {
      assert.ok(Number.isInteger(result[keyName]) && result[keyName] >= 0, `season reconciliation ${keyName} is valid`);
      totals[keyName] += result[keyName];
    }
  }
  const finalDry = await fencedSuccess('reconcile_season_sales_office_v1', {
    p_itemcodes: null, p_dry_run: true, p_import_revision: importRevision, p_idempotency_key: null,
  }, runId);
  const finalPlan = { ...finalDry, status: finalDry.status === 'dry_run' && finalDry.ok === true ? 'completed' : finalDry.status };
  const finalScope = vm.runInContext('validateSeasonSalesReconciliationPlan_', state.initial.context)(finalPlan, 'SEASON_SALES_RECONCILIATION');
  assert.equal(finalScope.scopeHash, scope.scopeHash);
  assert.equal(JSON.stringify(finalScope.itemcodes), JSON.stringify(scope.itemcodes));
  for (const keyName of ['newStateCount', 'winnerChangeCount', 'retireCount', 'reopenCount']) assert.equal(finalPlan[keyName], 0);
}

async function reconcileAssignments(ctx, runId) {
  const { fencedSuccess } = ctx;
  let expectedTotal = null;
  let previousProcessed = -1;
  let resetCount = 0;
  for (let call = 0; call < 500; call++) {
    const heartbeat = await fencedSuccess('heartbeat_dataset_import_v1', { p_run_id: runId }, runId);
    assert.equal(heartbeat.ok, true);
    const result = await fencedSuccess('reconcile_inventory_row_assignments_batch_v1', {
      p_import_run_id: runId, p_batch_size: 100,
    }, runId);
    assert.equal(result.ok, true);
    assert.ok(Number.isSafeInteger(result.processed) && Number.isSafeInteger(result.total));
    if (result.status === 'reset') {
      assert.equal(result.processed, 0);
      assert.equal(result.cursor, null);
      assert.ok(++resetCount <= 1);
      expectedTotal = result.total;
      previousProcessed = 0;
      continue;
    }
    if (expectedTotal === null) expectedTotal = result.total;
    assert.equal(result.total, expectedTotal);
    if (result.status === 'completed') {
      assert.equal(result.processed, result.total);
      return;
    }
    assert.equal(result.status, 'in_progress');
    assert.ok(result.processed > previousProcessed && result.processed < result.total);
    previousProcessed = result.processed;
  }
  throw new Error('ASSIGNMENT_RECONCILIATION_CALL_LIMIT');
}

export function attachBulkMasterOperations(ctx) {
  Object.assign(ctx, {
    setDisposableDbClaims: () => setDisposableDbClaims(ctx),
    withDisposableDbClaims: (...args) => withDisposableDbClaims(ctx, ...args),
    restoreRevisionSnapshot: () => restoreRevisionSnapshot(ctx),
    restoreHandoverFixture: () => restoreHandoverFixture(ctx),
    begin: () => begin(ctx),
    finish: (...args) => finish(ctx, ...args),
    fail: (...args) => fail(ctx, ...args),
    bulkPayload: (...args) => bulkPayload(ctx, ...args),
    measuredBulk: (...args) => measuredBulk(ctx, ...args),
    fencedSuccess: (...args) => fencedSuccess(ctx, ...args),
    reconcileSeasonSales: (...args) => reconcileSeasonSales(ctx, ...args),
    reconcileAssignments: (...args) => reconcileAssignments(ctx, ...args),
  });
}
