// @test-runtime: canonical-http
// Full-size canonical PH snapshot through the disposable local PostgREST API.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { Client } from 'pg';
import { inspectDisposableSupabaseWorkspace } from '../../scripts/disposable-supabase-container.mjs';
import { packageBin, runNode } from '../../scripts/tooling-process.mjs';

const ROW_COUNT = 9539;
// This fixture contains production-shape aggregates only; all generated row values are synthetic.
const ITEM6_FIELDS = Object.freeze([
  'locationnote', 'locationptn1', 'desigitem', 'desigcust', 'desigloc',
  'pullerresponsibility', 'oversellpercentage', 'salesnote', 'suspend',
]);
const META_FIELDS = new Set(['unique_id', 'assignedto', 'last_updated', 'filename', 'concat']);
const NUMERIC_TEXT_FIELDS = new Set([
  'quantityordered', 'quantityshipped', 'listprice', 'unitprice', 'retailprice',
  'ptravailable', 'ptronhand', 'ptrreviewed', 'season_supply', 's_lts', 'a_lts',
  'ai_lts', 'si_lts', 'season_oh', 'season_demand', 'oversellpercentage',
  'largeptrqty', 'maxorderquantity', 'ext_ptronhand', 'saleyear', 'blocknumber', 'bay', 'loc_match_qty',
]);
const DATE_TEXT_FIELDS = new Set([
  'date_completed', 'flyer_completed', 'hold_release_approved_at', 'av_rule_av_note_updated_at',
  'av_rule_bundle_updated_at', 'av_rule_caliper_updated_at', 'av_rule_last_cleared_at',
  'av_rule_match_updated_at', 'av_rule_photo_updated_at', 'av_rule_spec_updated_at',
  'eval_task_assigned_at', 'priupdated', 'locationnotedate', 'salesnotebegindate',
]);
const REQUIRED_SOURCE_FIELDS = Object.freeze([
  'itemcode', 'commonname', 'contsize', 'locationcode', 'lotcode', 'source', 'warehouseid',
  'desigitem', 'desigcust', 'desigloc', 'priority', 'holdstopcode', 'holdstopreason',
]);

function appScriptContext() {
  const code = readFileSync(new URL('../../Code.gs', import.meta.url), 'utf8');
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, value) => Array.from(createHash('sha256').update(value, 'utf8').digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
    },
  });
  new vm.Script(code, { filename: 'Code.gs' }).runInContext(ctx);
  return ctx;
}

function shapeRecordForColumn(shape, column) {
  return shape instanceof Map ? shape.get(column) || null : shape.find(item => item.column_name === column) || null;
}

function isPopulated(shape, column, rowIndex, rowCount) {
  const record = shapeRecordForColumn(shape, column);
  if (!record) return false;
  const count = Number(record.populated_rows);
  return Math.floor(((rowIndex + 1) * count) / rowCount) > Math.floor((rowIndex * count) / rowCount);
}

function syntheticColumnValue(column, rowIndex, length, variant, type) {
  const padded = String(rowIndex + 1).padStart(5, '0');
  if (column === 'itemcode') return `GNC_BULK_BENCH_${padded}`;
  if (column === 'commonname') return `Synthetic bulk plant ${padded} v${variant}`;
  if (column === 'contsize') return '#3';
  if (column === 'locationcode') return `A.${(rowIndex % 10) + 1}`;
  if (column === 'lotcode') return 'F1';
  if (column === 'source') return 'PH';
  if (column === 'warehouseid' || column === 'warehousei') return '10';
  if (column === 'desigitem') return 'D1';
  if (column === 'desigcust') return 'C1';
  if (column === 'desigloc') return 'L1';
  if (column === 'priority') return '1';
  if (column === 'holdstopcode') return rowIndex % 17 === 0 ? 'H' : '';
  if (column === 'holdstopreason') return rowIndex % 17 === 0 ? `Synthetic hold ${padded}` : '';
  if (column === 'last_updated' || type.includes('timestamp') || DATE_TEXT_FIELDS.has(column)) {
    const dateValue = '2026-10-14T12:34:56.123Z';
    return length > dateValue.length ? dateValue.padEnd(length, ' ') : dateValue.slice(0, length);
  }
  if (type === 'date') return '2026-10-14'.slice(0, length);
  if (type === 'boolean') return rowIndex % 2 === 0 ? 'true' : 'false';
  if (['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision'].includes(type) || NUMERIC_TEXT_FIELDS.has(column)) {
    const number = String((rowIndex % 997) + 1);
    return number.slice(-Math.max(1, length)).padStart(Math.max(1, length), '0');
  }
  if (type === 'json' || type === 'jsonb') return JSON.stringify({ synthetic: true, row: rowIndex + 1 });
  if (column === 'season') return 'F1'.slice(0, length).padEnd(length, '1');
  if (column === 'plantgroupcode') return '140_GRASS'.slice(0, length).padEnd(length, '0');
  if (column === 'locationnote') return `Note ${padded}`.padEnd(length, 'x').slice(0, length);
  if (column === 'salesnote') return `Sales note ${padded}`.padEnd(length, 'x').slice(0, length);
  const prefix = `SYNTH_${column}_${String((rowIndex + 1) % 100000).padStart(5, '0')}`;
  return prefix.padEnd(length, 'x').slice(0, length);
}

function sourceRowsFromProductionShape({ shape, columns, rowCount = ROW_COUNT, variant = 0, syncTime = null }) {
  const ctx = appScriptContext();
  const allowed = new Set(vm.runInContext('Array.from(ALLOWED_DB_COLUMNS)', ctx));
  const columnTypes = new Map(columns.map(column => [column.column_name, column.data_type]));
  const shapeByColumn = new Map(shape.map(item => [item.column_name, item]));
  const targetLengthFor = (column, rowIndex) => {
    const entry = shapeRecordForColumn(shapeByColumn, column);
    if (!entry || Number(entry.populated_rows) <= 0) return 12;
    const count = Number(entry.populated_rows);
    const targetSum = Math.round(Number(entry.avg_text_length) * count);
    const base = Math.floor(targetSum / count);
    const extra = targetSum - base * count;
    const rank = Math.floor((rowIndex * extra) / count);
    const previousRank = Math.floor(((rowIndex - 1) * extra) / count);
    return Math.max(1, base + (rank > previousRank ? 1 : 0));
  };
  const sourceColumns = columns.map(column => column.column_name)
    .filter(column => allowed.has(column) && !META_FIELDS.has(column));
  const headers = Array.from(new Set([...sourceColumns, ...REQUIRED_SOURCE_FIELDS]));
  for (const field of headers) assert.ok(columnTypes.has(field), `synthetic import field is a real column: ${field}`);
  const rawData = [headers.map(name => name.toUpperCase())];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const values = headers.map(column => {
      const type = columnTypes.get(column) || 'text';
      if (!REQUIRED_SOURCE_FIELDS.includes(column) && !isPopulated(shapeByColumn, column, rowIndex, rowCount)) return '';
      return syntheticColumnValue(column, rowIndex, targetLengthFor(column, rowIndex), variant, type);
    });
    rawData.push(values);
  }
  const payload = vm.runInContext('buildMasterBulkSnapshotPayload_', ctx)(
    'ph_master_inventory', [{ fileName: 'synthetic-bulk-master.csv', rawData }],
    vm.runInContext('buildMasterPayload', ctx), syncTime || new Date(`2026-10-14T12:${String(variant).padStart(2, '0')}:00.000Z`).toISOString(),
  );
  const rows = JSON.parse(JSON.stringify(payload.rows));
  assert.equal(rows.length, rowCount, 'the GAS importer must produce the requested complete identity set');
  assert.ok(rows.every(row => row.values.unique_id.startsWith('GNC_BULK_BENCH_')));
  assert.ok(rows.every(row => row.rawFields.every(field => ITEM6_FIELDS.includes(field))));
  assert.equal(new Set(rows.map(row => row.values.unique_id)).size, rowCount);
  return { rows, sourceDigest: payload.sourceDigest, context: ctx };
}

export function syntheticBulkMasterSnapshot({ rowCount = ROW_COUNT, variant = 0 } = {}) {
  const shape = JSON.parse(readFileSync(new URL('../../tests/fixtures/bulk-master-import-shape.json', import.meta.url), 'utf8'));
  const allowed = new Set(vm.runInContext('Array.from(ALLOWED_DB_COLUMNS)', appScriptContext()));
  const columns = [...new Set([...shape.map(item => item.column_name), ...allowed])]
    .filter(column_name => !META_FIELDS.has(column_name)).map(column_name => ({ column_name, data_type: 'text' }));
  return sourceRowsFromProductionShape({ shape, columns, rowCount, variant });
}

function parseStatusEnvironment(output) {
  return Object.fromEntries(String(output).split(/\r?\n/)
    .map(line => line.match(/^([A-Z_]+)="(.*)"$/)).filter(Boolean).map(match => [match[1], match[2]]));
}

function errorText(body) {
  return String(body && (body.message || body.error || body.hint) || JSON.stringify(body));
}

export async function runBulkMasterImportHttpRegression(workspaceRoot) {
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
  const runIds = [];
  const requestIds = [];
  let failureTriggerInstalled = false;
  let shape;
  let tableColumns;
  let initial;
  let sourceByteCount;

  try {
    shape = JSON.parse(readFileSync(new URL('../../tests/fixtures/bulk-master-import-shape.json', import.meta.url), 'utf8'));
    tableColumns = await query(`select column_name, data_type from information_schema.columns
      where table_schema='public' and table_name='ph_master_inventory' order by ordinal_position`);
    initial = sourceRowsFromProductionShape({ shape, columns: tableColumns });
    sourceByteCount = Buffer.byteLength(JSON.stringify(initial.rows));
  } catch (error) {
    await db.end();
    throw error;
  }

  const begin = async () => {
    const runId = randomUUID();
    runIds.push(runId);
    const datasetKeys = vm.runInContext("getDatasetImportFenceSources_('ph_master_inventory')", initial.context);
    const result = await success('begin_dataset_import_v1', {
      p_dataset_keys: datasetKeys, p_run_id: runId, p_canonical_keys: ['ph_master_inventory'],
    });
    assert.equal(result.ok, true, 'the complete canonical PH fence must be active before bulk writes');
    return runId;
  };
  const finish = async runId => {
    await reconcileSeasonSales(runId);
    const evalResult = await fencedSuccess('reconcile_eval_report2_work_v1', {
      p_import_revision: new Date().toISOString(), p_dry_run: false, p_limit: 5000,
    }, runId);
    assert.equal(evalResult.status, 'completed', 'Eval Reports #2 reconciliation completes before fence finalization');
    await reconcileAssignments(runId);
    const result = await success('finish_dataset_import_v1', { p_run_id: runId });
    assert.equal(result.ok, true);
  };
  const fail = async runId => {
    const result = await success('fail_dataset_import_v1', { p_run_id: runId });
    assert.equal(result.ok, true);
  };
  const bulkPayload = (runId, source, requestId = randomUUID()) => {
    requestIds.push(requestId);
    return { p_run_id: runId, p_request_id: requestId, p_rows: source.rows, p_source_digest: source.sourceDigest };
  };
  const measuredBulk = async (payload, label, headers = {}) => {
    const start = performance.now();
    const result = await success('bulk_import_master_snapshot_v1', payload, headers);
    const elapsedMs = performance.now() - start;
    assert.ok(elapsedMs < 55000, `${label} RPC exceeded the 55-second database budget (${Math.round(elapsedMs)} ms)`);
    return { result, elapsedMs };
  };
  const fencedSuccess = async (name, payload, runId) => {
    const result = await rpc(name, payload, values.SERVICE_ROLE_KEY, {
      'x-gnc-import-run-id': runId, 'x-gnc-master-tuple-policy': 'raw-priority-hold-v1',
    });
    assert.equal(result.status, 200, `${name}: ${errorText(result.body)}`);
    return result.body;
  };
  const reconcileSeasonSales = async runId => {
    const safeRevision = new Date().toISOString();
    const importRevision = `master_inventory:${safeRevision}`;
    const baseKey = `season-sales-${createHash('sha256').update(`master_inventory|${safeRevision}`).digest('base64url').slice(0, 80)}`;
    const dry = await fencedSuccess('reconcile_season_sales_office_v1', {
      p_itemcodes: null, p_dry_run: true, p_import_revision: importRevision, p_idempotency_key: null,
    }, runId);
    const plan = { ...dry, status: dry.status === 'dry_run' && dry.ok === true ? 'completed' : dry.status };
    const scope = vm.runInContext('validateSeasonSalesReconciliationPlan_', initial.context)(plan, 'SEASON_SALES_RECONCILIATION');
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
      const key = vm.runInContext('getSeasonSalesBatchIdempotencyKey_', initial.context)(baseKey, batchIndex, batch);
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
    const finalScope = vm.runInContext('validateSeasonSalesReconciliationPlan_', initial.context)(finalPlan, 'SEASON_SALES_RECONCILIATION');
    assert.equal(finalScope.scopeHash, scope.scopeHash);
    assert.equal(JSON.stringify(finalScope.itemcodes), JSON.stringify(scope.itemcodes));
    for (const keyName of ['newStateCount', 'winnerChangeCount', 'retireCount', 'reopenCount']) assert.equal(finalPlan[keyName], 0);
  };
  const reconcileAssignments = async runId => {
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
  };

  try {
    assert.equal((await queryValue('select marker from private.ci_schema_workspace_guard')).marker, 'canonical-baseline-replay');
    assert.ok((await queryValue(`select proconfig from pg_proc where oid='public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)'::regprocedure`))
      .proconfig.includes('statement_timeout=55s'), 'the bulk RPC keeps its 55-second statement timeout');
    const initialLiveCount = Number((await queryValue('select count(*)::int as count from public.ph_master_inventory')).count);
    assert.equal(initialLiveCount, 0, 'the disposable canonical HTTP workspace must begin without live inventory rows');

    const runId = await begin();
    const initialRequest = bulkPayload(runId, initial);
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

    const obsolete = { ...initial.rows[0].values, unique_id: 'GNC_BULK_BENCH_OBSOLETE', itemcode: 'GNC_BULK_BENCH_OBSOLETE_ITEM' };
    await db.query('insert into public.ph_master_inventory select (jsonb_populate_record(null::public.ph_master_inventory,$1::jsonb)).*', [JSON.stringify(obsolete)]);
    const first = await measuredBulk(initialRequest, 'initial 9,539-row insert');
    assert.deepEqual(first.result, {
      published: true, runId, requestId: initialRequest.p_request_id, sourceDigest: initial.sourceDigest,
      sourceRows: ROW_COUNT, inserted: ROW_COUNT, updated: 0, deleted: 1, unchanged: 0,
    });
    assert.equal(Number((await queryValue('select count(*)::int as count from public.ph_master_inventory')).count), ROW_COUNT);
    await finish(runId);
    const replayStart = performance.now();
    const replay = await success('bulk_import_master_snapshot_v1', initialRequest);
    const replayElapsedMs = performance.now() - replayStart;
    assert.ok(replayElapsedMs < 55000, `exact replay RPC exceeded the 55-second database budget (${Math.round(replayElapsedMs)} ms)`);
    assert.deepEqual(replay, first.result, 'an exact request retry replays the saved response after the import fence closes');

    const alteredRetry = {
      ...initialRequest,
      p_rows: initial.rows.map((row, index) => index === 0
        ? { ...row, values: { ...row.values, commonname: `${row.values.commonname} altered` } } : row),
    };
    const altered = await rpc('bulk_import_master_snapshot_v1', alteredRetry);
    assert.notEqual(altered.status, 200, 'same request UUID with different JSONB is rejected');
    assert.match(errorText(altered.body), /BULK_MASTER_IMPORT_REQUEST_ID_REUSED/);

    const protectedId = initial.rows[0].values.unique_id;
    await db.query(`update public.ph_master_inventory set holdstopcode='APP_HOLD', holdstopreason='Synthetic app hold',
      locationnote='Synthetic app location note' where unique_id=$1`, [protectedId]);
    const protectedBefore = await queryValue(`select holdstopcode, holdstopreason, locationnote
      from public.ph_master_inventory where unique_id=$1`, [protectedId]);
    assert.deepEqual(protectedBefore, {
      holdstopcode: 'APP_HOLD', holdstopreason: 'Synthetic app hold', locationnote: 'Synthetic app location note',
    });

    const changed = sourceRowsFromProductionShape({ shape, columns: tableColumns, variant: 1 });
    const changedRun = await begin();
    const changedRequest = bulkPayload(changedRun, changed);
    const changedResult = await measuredBulk(changedRequest, 'changed 9,539-row snapshot');
    assert.equal(changedResult.result.inserted, 0);
    assert.equal(changedResult.result.updated, ROW_COUNT);
    assert.equal(changedResult.result.deleted, 0);
    assert.equal(changedResult.result.unchanged, 0);
    const protectedAfter = await queryValue(`select holdstopcode, holdstopreason, locationnote
      from public.ph_master_inventory where unique_id=$1`, [protectedId]);
    assert.deepEqual(protectedAfter, protectedBefore, 'imported source values cannot overwrite live app hold/location fields');
    await finish(changedRun);

    const unchanged = sourceRowsFromProductionShape({ shape, columns: tableColumns, variant: 1, syncTime: '2026-10-14T12:02:00.000Z' });
    const unchangedRun = await begin();
    const unchangedRequest = bulkPayload(unchangedRun, unchanged);
    const unchangedResult = await measuredBulk(unchangedRequest, 'unchanged 9,539-row snapshot with fresh sync metadata');
    assert.equal(unchangedResult.result.inserted, 0);
    assert.equal(unchangedResult.result.updated, 0, 'last_updated and filename metadata do not force a business-row update');
    assert.equal(unchangedResult.result.unchanged, ROW_COUNT);
    await finish(unchangedRun);

    const noFenceRequest = bulkPayload(randomUUID(), unchanged);
    const noFence = await rpc('bulk_import_master_snapshot_v1', noFenceRequest);
    assert.notEqual(noFence.status, 200, 'publishing without an active canonical fence is forbidden');
    assert.match(errorText(noFence.body), /MASTER_PRIORITY_HOLD_IMPORT_TOKEN_INVALID/);

    const atomicRun = await begin();
    const atomicSource = sourceRowsFromProductionShape({ shape, columns: tableColumns, rowCount: 2, variant: 2 });
    atomicSource.rows[0].values.commonname = 'Changed before intentional atomic failure';
    atomicSource.rows[0].values.concat = 'changed-hash';
    const newRow = { ...atomicSource.rows[1], values: { ...atomicSource.rows[1].values } };
    newRow.values.unique_id = 'GNC_BULK_BENCH_ATOMIC_NEW';
    newRow.values.itemcode = 'GNC_BULK_BENCH_ATOMIC_NEW_ITEM';
    atomicSource.rows = [atomicSource.rows[0], newRow];
    const canonicalAtomicRows = vm.runInContext('canonicalizeMasterBulkPayloadValue_', atomicSource.context)(atomicSource.rows);
    atomicSource.sourceDigest = createHash('sha256').update(JSON.stringify(canonicalAtomicRows)).digest('hex');
    const atomicPayload = bulkPayload(atomicRun, atomicSource);
    failureTriggerInstalled = true;
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
      changed.rows[0].values.commonname, 'an earlier upsert in the failed statement is rolled back');
    await db.query('drop trigger ci_bulk_master_atomic_failure on public.ph_master_inventory; drop function private.ci_bulk_master_atomic_failure()');
    failureTriggerInstalled = false;
    await fail(atomicRun);

    console.log(`[bulk-master-http] ${ROW_COUNT} rows, ${initial.rows.length ? Object.keys(initial.rows[0].values).length : 0} normalized columns, ${(sourceByteCount / 1024 / 1024).toFixed(2)} MiB request; insert ${Math.round(first.elapsedMs)}ms, changed ${Math.round(changedResult.elapsedMs)}ms, unchanged ${Math.round(unchangedResult.elapsedMs)}ms, exact replay ${Math.round(replayElapsedMs)}ms; local disposable Docker/Postgres, shared OS cache (cold-cache state not controlled).`);
  } finally {
    if (failureTriggerInstalled) {
      await db.query('drop trigger if exists ci_bulk_master_atomic_failure on public.ph_master_inventory; drop function if exists private.ci_bulk_master_atomic_failure()').catch(() => {});
    }
    if (runIds.length) await db.query('select public.fail_dataset_import_v1(id) from unnest($1::uuid[]) as id', [runIds]).catch(() => {});
    await db.query("delete from app_sync_private.ph_master_inventory_source_baselines where canonical_unique_id like 'GNC_BULK_BENCH_%'").catch(() => {});
    await db.query("delete from app_sync_private.ph_master_inventory_app_edits where canonical_unique_id like 'GNC_BULK_BENCH_%'").catch(() => {});
    await db.query('delete from app_sync_private.ph_master_bulk_import_receipts_v1 where request_id = any($1::uuid[])', [requestIds]).catch(() => {});
    await db.query("delete from public.ph_master_inventory where unique_id like 'GNC_BULK_BENCH_%'").catch(() => {});
    await db.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node supabase/ci/bulk_master_import_http.mjs <verified-workspace>');
  await runBulkMasterImportHttpRegression(process.argv[2]);
}
