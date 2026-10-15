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
const HANDOVER_TRANSITION_KEY = 'kayla_knepp_to_nelly_aguilar_20261002';
const HANDOVER_SUCCESSOR_ID = '961b0a0f-11a6-4db5-b066-582f772ab8e7';
const EXPECTED_MASTER_PRODUCTION_TRIGGER_COUNT = 24;

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

export function syntheticBulkMasterSnapshot({ rowCount = ROW_COUNT, variant = 0, columns: suppliedColumns = null } = {}) {
  const shape = JSON.parse(readFileSync(new URL('../../tests/fixtures/bulk-master-import-shape.json', import.meta.url), 'utf8'));
  const allowed = new Set(vm.runInContext('Array.from(ALLOWED_DB_COLUMNS)', appScriptContext()));
  const columns = suppliedColumns || [...new Set([...shape.map(item => item.column_name), ...allowed])]
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
  const activeRunIds = new Set();
  const requestIds = [];
  const seasonIdempotencyKeys = [];
  let failureTriggerInstalled = false;
  let shape;
  let tableColumns;
  let initial;
  let sourceByteCount;
  let masterImportFieldCount;
  let masterProductionTriggerCount;
  let revisionSnapshot;
  let seasonSettingsSnapshot;
  let fenceDatasetKeys;
  let revisionKeys;
  let handoverSnapshot;
  let handoverStateCaptured = false;
  let handoverScheduleTouched = false;
  const syntheticHandoverProfileId = randomUUID();
  const syntheticHandoverEmail = `kayla.bulk-fixture.${syntheticHandoverProfileId}@local.invalid`;
  let syntheticHandoverUserCreated = false;
  let syntheticHandoverProfileCreated = false;
  let testFailure;
  let testFailed = false;

  const setDisposableDbClaims = async () => {
    await db.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
    await db.query("select set_config('request.jwt.claim.role', 'service_role', true)");
    await db.query("select set_config('request.headers', '{}', true)");
  };
  const withDisposableDbClaims = async callback => {
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
  };
  const restoreRevisionSnapshot = async () => {
    const snapshotKeys = (revisionSnapshot || []).map(row => row.key);
    await db.query(`delete from public.app_dataset_revisions current
      where not (current.key = any($1::text[]))`, [snapshotKeys]);
    const restored = await db.query(`insert into public.app_dataset_revisions(key,revision,state,changed_at)
      select snapshot.key,snapshot.revision,snapshot.state,snapshot.changed_at
      from jsonb_to_recordset($1::jsonb) as snapshot(key text, revision bigint, state text, changed_at timestamptz)
      on conflict(key) do update set revision=excluded.revision,state=excluded.state,changed_at=excluded.changed_at
      returning key`, [JSON.stringify(revisionSnapshot || [])]);
    assert.equal(restored.rowCount, revisionSnapshot?.length || 0,
      'all captured dataset revision rows are restored exactly after fixture triggers');
  };
  const restoreHandoverFixture = async () => {
    if (!handoverStateCaptured) return;
    if (handoverScheduleTouched) {
      await db.query(`delete from private.scheduled_account_handover_audit_v1
        where transition_key=$1 and event_key like 'future:ph_master_inventory:GNC_BULK_BENCH_%'`,
      [HANDOVER_TRANSITION_KEY]);
      if (handoverSnapshot) {
        await db.query(`update private.scheduled_account_handover_v1
          set departing_profile_id=$2::uuid,successor_profile_id=$3::uuid,effective_at=$4::timestamptz
          where transition_key=$1`, [HANDOVER_TRANSITION_KEY, handoverSnapshot.departing_profile_id,
          handoverSnapshot.successor_profile_id, handoverSnapshot.effective_at]);
      } else {
        await db.query('delete from private.scheduled_account_handover_v1 where transition_key=$1', [HANDOVER_TRANSITION_KEY]);
      }
    }
    if (syntheticHandoverProfileCreated) {
      await db.query('delete from public.profiles where id=$1::uuid', [syntheticHandoverProfileId]);
    }
    if (syntheticHandoverUserCreated) {
      await db.query('delete from auth.users where id=$1::uuid', [syntheticHandoverProfileId]);
    }
  };

  try {
    shape = JSON.parse(readFileSync(new URL('../../tests/fixtures/bulk-master-import-shape.json', import.meta.url), 'utf8'));
    tableColumns = await query(`select column_name, data_type from information_schema.columns
      where table_schema='public' and table_name='ph_master_inventory' order by ordinal_position`);
    assert.equal(tableColumns.length, 213, 'the disposable schema includes all 213 production master columns');
    initial = sourceRowsFromProductionShape({ shape, columns: tableColumns });
    masterImportFieldCount = Object.keys(initial.rows[0].values).length;
    assert.equal(masterImportFieldCount, 171,
      'the importer exercises all 171 production fields it currently emits');
    sourceByteCount = Buffer.byteLength(JSON.stringify(initial.rows));
    const triggerState = await queryValue(`select count(*)::int as total,
        count(*) filter (where tgenabled <> 'D')::int as enabled,
        count(*) filter (where tgname='scheduled_handover_normalize_assignment')::int as handover,
        count(*) filter (where tgname='scheduled_handover_normalize_assignment' and tgenabled <> 'D')::int as handover_enabled
      from pg_trigger where tgrelid='public.ph_master_inventory'::regclass and not tgisinternal`);
    assert.equal(triggerState.total, EXPECTED_MASTER_PRODUCTION_TRIGGER_COUNT,
      'the HTTP benchmark contains every expected production master trigger');
    assert.equal(triggerState.enabled, EXPECTED_MASTER_PRODUCTION_TRIGGER_COUNT,
      'all production master triggers are enabled during the HTTP benchmark');
    assert.equal(triggerState.handover, 1, 'the scheduled assignment handover trigger is installed');
    assert.equal(triggerState.handover_enabled, 1, 'the scheduled assignment handover trigger is enabled');
    masterProductionTriggerCount = triggerState.total;

    fenceDatasetKeys = vm.runInContext("getDatasetImportFenceSources_('ph_master_inventory')", initial.context);
    // Snapshot the small revision catalog before the synthetic departing profile
    // is inserted: its production profile refresh trigger can touch dependencies
    // outside the master import fence, and cleanup must not poison later SQL checks.
    revisionSnapshot = await query(`select key, revision, state, changed_at::text as changed_at
      from public.app_dataset_revisions order by key`);
    revisionKeys = revisionSnapshot.map(row => row.key);
    seasonSettingsSnapshot = await query(`select key, value, updated_by, updated_at::text as updated_at
      from public.ph_app_settings where key='current_season_salesyear'`);
  } catch (error) {
    await db.end();
    throw error;
  }

  const begin = async () => {
    const runId = randomUUID();
    const result = await success('begin_dataset_import_v1', {
      p_dataset_keys: fenceDatasetKeys, p_run_id: runId, p_canonical_keys: ['ph_master_inventory'],
    });
    assert.equal(result.ok, true, 'the complete canonical PH fence must be active before bulk writes');
    runIds.push(runId);
    activeRunIds.add(runId);
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
    activeRunIds.delete(runId);
  };
  const fail = async runId => {
    const result = await success('fail_dataset_import_v1', { p_run_id: runId }, { 'x-gnc-import-run-id': runId });
    assert.equal(result.ok, true);
    activeRunIds.delete(runId);
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
    seasonIdempotencyKeys.push(baseKey);
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
      const heartbeat = await fencedSuccess('heartbeat_dataset_import_v1', { p_run_id: runId }, runId);
      assert.equal(heartbeat.ok, true);
      const key = vm.runInContext('getSeasonSalesBatchIdempotencyKey_', initial.context)(baseKey, batchIndex, batch);
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
    handoverSnapshot = await queryValue(`select departing_profile_id::text as departing_profile_id,
        successor_profile_id::text as successor_profile_id, effective_at::text as effective_at
      from private.scheduled_account_handover_v1 where transition_key=$1`, [HANDOVER_TRANSITION_KEY]) || null;
    handoverStateCaptured = true;
    const existingSyntheticIdentity = await queryValue('select id::text as id from public.profiles where id=$1::uuid',
      [syntheticHandoverProfileId]);
    assert.equal(existingSyntheticIdentity, undefined, 'the synthetic departing profile UUID is unique');
    assert.equal(await queryValue(`select id from public.profiles where lower(btrim(username))='kayla_knepp'`), undefined,
      'the disposable canonical fixture has no departing account that could collide with the synthetic identity');
    const successor = await queryValue(`select id::text as id from public.profiles
      where id=$1::uuid and lower(btrim(username))='nelly_aguilar'`, [HANDOVER_SUCCESSOR_ID]);
    assert.equal(successor?.id, HANDOVER_SUCCESSOR_ID, 'the canonical synthetic successor identity is present');

    syntheticHandoverProfileCreated = true;
    const syntheticUser = await db.query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
        raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values($1::uuid,'authenticated','authenticated',$2,'',clock_timestamp(),
        '{"provider":"email","providers":["email"],"fixture":true}'::jsonb,
        '{"fixture":"bulk-master-http-handover"}'::jsonb,clock_timestamp(),clock_timestamp())
      on conflict(id) do nothing`, [syntheticHandoverProfileId, syntheticHandoverEmail]);
    syntheticHandoverUserCreated = syntheticUser.rowCount === 1;
    await db.query(`insert into public.profiles(id,username,display_name,role,must_change_password)
      values($1::uuid,'kayla_knepp','Synthetic Bulk Handover Source','Admin',false)
      on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,
        role=excluded.role,must_change_password=excluded.must_change_password`, [syntheticHandoverProfileId]);

    handoverScheduleTouched = true;
    if (handoverSnapshot) {
      await db.query(`update private.scheduled_account_handover_v1
        set departing_profile_id=$2::uuid,successor_profile_id=$3::uuid
        where transition_key=$1`, [HANDOVER_TRANSITION_KEY, syntheticHandoverProfileId, HANDOVER_SUCCESSOR_ID]);
    } else {
      await db.query(`insert into private.scheduled_account_handover_v1(
        transition_key,departing_profile_id,successor_profile_id,effective_at)
        values($1,$2::uuid,$3::uuid,'2026-10-03 04:00:00+00'::timestamptz)`,
      [HANDOVER_TRANSITION_KEY, syntheticHandoverProfileId, HANDOVER_SUCCESSOR_ID]);
    }
    const activeHandover = await queryValue(`select h.departing_profile_id::text as departing_profile_id,
        h.successor_profile_id::text as successor_profile_id,
        h.effective_at <= clock_timestamp() as is_due,
        lower(btrim(source.username)) as departing_username,
        lower(btrim(successor.username)) as successor_username
      from private.scheduled_account_handover_v1 h
      join public.profiles source on source.id=h.departing_profile_id
      join public.profiles successor on successor.id=h.successor_profile_id
      where h.transition_key=$1`, [HANDOVER_TRANSITION_KEY]);
    assert.deepEqual(activeHandover, {
      departing_profile_id: syntheticHandoverProfileId,
      successor_profile_id: HANDOVER_SUCCESSOR_ID,
      is_due: true,
      departing_username: 'kayla_knepp',
      successor_username: 'nelly_aguilar',
    }, 'the exact scheduled handover is due and active in the disposable benchmark');
    // The season reconciliation is part of the canonical import contract and
    // reads this application setting; seed a complete, test-only value and
    // restore the exact original row in finally.
    await withDisposableDbClaims(() => db.query(`insert into public.ph_app_settings(key, value, updated_by, updated_at)
      values ('current_season_salesyear', '{"seasonCode":"F1","salesYear":"27"}'::jsonb, 'bulk_master_http_fixture', clock_timestamp())
      on conflict (key) do update set value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at`));

    // Seed the stale row before the canonical fence is active. The direct PG
    // fixture connection has no PostgREST context, so set disposable service
    // claims for this transaction without fabricating an import token.
    const obsolete = { ...initial.rows[0].values, unique_id: 'GNC_BULK_BENCH_OBSOLETE', itemcode: 'GNC_BULK_BENCH_OBSOLETE_ITEM' };
    await withDisposableDbClaims(() => db.query(
      'insert into public.ph_master_inventory select (jsonb_populate_record(null::public.ph_master_inventory,$1::jsonb)).*',
      [JSON.stringify(obsolete)],
    ));

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

    const first = await measuredBulk(initialRequest, 'initial 9,539-row insert');
    console.log(`[bulk-master-http] insert RPC ${Math.round(first.elapsedMs)}ms`);
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
    console.log(`[bulk-master-http] exact replay RPC ${Math.round(replayElapsedMs)}ms`);
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
    await withDisposableDbClaims(() => db.query(`update public.ph_master_inventory set holdstopcode='APP_HOLD', holdstopreason='Synthetic app hold',
      locationnote='Synthetic app location note' where unique_id=$1`, [protectedId]));
    const protectedBefore = await queryValue(`select holdstopcode, holdstopreason, locationnote
      from public.ph_master_inventory where unique_id=$1`, [protectedId]);
    assert.deepEqual(protectedBefore, {
      holdstopcode: 'APP_HOLD', holdstopreason: 'Synthetic app hold', locationnote: 'Synthetic app location note',
    });

    const changed = sourceRowsFromProductionShape({ shape, columns: tableColumns, variant: 1 });
    const changedRun = await begin();
    const changedRequest = bulkPayload(changedRun, changed);
    const changedResult = await measuredBulk(changedRequest, 'changed 9,539-row snapshot');
    console.log(`[bulk-master-http] changed snapshot RPC ${Math.round(changedResult.elapsedMs)}ms`);
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
    console.log(`[bulk-master-http] unchanged snapshot RPC ${Math.round(unchangedResult.elapsedMs)}ms`);
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

    console.log(`[bulk-master-http] ${ROW_COUNT} rows, ${tableColumns.length} production columns, ${masterImportFieldCount} importer fields, ${masterProductionTriggerCount} enabled production triggers including due handover, ${(sourceByteCount / 1024 / 1024).toFixed(2)} MiB request; insert ${Math.round(first.elapsedMs)}ms, changed ${Math.round(changedResult.elapsedMs)}ms, unchanged ${Math.round(unchangedResult.elapsedMs)}ms, exact replay ${Math.round(replayElapsedMs)}ms; local disposable Docker/Postgres, shared OS cache (cold-cache state not controlled).`);
  } catch (error) {
    testFailure = error;
    testFailed = true;
  } finally {
    let cleanupError;
    try {
      if (failureTriggerInstalled) {
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
      if (seasonSettingsSnapshot.length) {
        await db.query(`insert into public.ph_app_settings(key, value, updated_by, updated_at)
          select key, value, updated_by, updated_at
          from jsonb_to_recordset($1::jsonb) as snapshot(key text, value jsonb, updated_by text, updated_at timestamptz)`,
        [JSON.stringify(seasonSettingsSnapshot)]);
      }
      await restoreRevisionSnapshot();
      await db.query('commit');

      assert.equal(Number((await queryValue('select count(*)::int as count from app_sync_private.import_runs where id = any($1::uuid[])', [runIds])).count), 0,
        'all harness-owned import runs are removed');
      assert.equal(Number((await queryValue('select count(*)::int as count from app_sync_private.import_leases where run_id = any($1::uuid[])', [runIds])).count), 0,
        'all harness-owned import leases are removed');
      assert.deepEqual(await query(`select key, revision, state, changed_at::text as changed_at from public.app_dataset_revisions
        where key = any($1::text[]) order by key`, [revisionKeys]), revisionSnapshot,
      'captured PH import revisions are restored exactly');
      assert.deepEqual(await query(`select key, value, updated_by, updated_at::text as updated_at
        from public.ph_app_settings where key='current_season_salesyear'`), seasonSettingsSnapshot,
      'season settings are restored exactly');
      if (handoverStateCaptured) {
        const restoredHandover = await queryValue(`select departing_profile_id::text as departing_profile_id,
            successor_profile_id::text as successor_profile_id,effective_at::text as effective_at
          from private.scheduled_account_handover_v1 where transition_key=$1`, [HANDOVER_TRANSITION_KEY]);
        assert.deepEqual(restoredHandover, handoverSnapshot || undefined,
          'the pre-existing handover schedule is restored exactly or the fixture-created row is removed');
        assert.equal(Number((await queryValue('select count(*)::int as count from public.profiles where id=$1::uuid',
          [syntheticHandoverProfileId])).count), 0, 'the synthetic departing profile is removed');
        if (syntheticHandoverUserCreated) {
          assert.equal(Number((await queryValue('select count(*)::int as count from auth.users where id=$1::uuid',
            [syntheticHandoverProfileId])).count), 0, 'the synthetic departing auth user is removed');
        }
        assert.equal(Number((await queryValue(`select count(*)::int as count
          from private.scheduled_account_handover_audit_v1 where transition_key=$1
            and event_key like 'future:ph_master_inventory:GNC_BULK_BENCH_%'`,
        [HANDOVER_TRANSITION_KEY])).count), 0, 'synthetic handover audit entries are removed');
      }
      assert.equal(Number((await queryValue("select count(*)::int as count from public.ph_master_inventory where unique_id like 'GNC_BULK_BENCH_%'")).count), 0,
        'synthetic master inventory rows are removed');
      assert.equal(Number((await queryValue("select count(*)::int as count from app_sync_private.ph_master_inventory_source_baselines where canonical_unique_id like 'GNC_BULK_BENCH_%'")).count), 0,
        'synthetic source baselines are removed');
      assert.equal(Number((await queryValue("select count(*)::int as count from app_sync_private.ph_master_inventory_app_edits where canonical_unique_id like 'GNC_BULK_BENCH_%'")).count), 0,
        'synthetic app edits are removed');
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
    } catch (error) {
      cleanupError = error;
      await db.query('rollback').catch(() => {});
    } finally {
      await db.end().catch(error => { cleanupError ||= error; });
    }
    if (cleanupError) {
      if (testFailed && testFailure && typeof testFailure === 'object') testFailure.cleanupError = cleanupError;
      else if (testFailed) testFailure = new AggregateError([testFailure, cleanupError], 'BULK_MASTER_HTTP_AND_CLEANUP_FAILED');
      else testFailure = new Error(`BULK_MASTER_HTTP_CLEANUP_FAILED: ${cleanupError.message}`, { cause: cleanupError });
      testFailed = true;
    }
  }
  if (testFailed) throw testFailure;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node supabase/ci/bulk_master_import_http.mjs <verified-workspace>');
  await runBulkMasterImportHttpRegression(process.argv[2]);
}
