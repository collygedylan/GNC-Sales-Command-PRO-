import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runPendingErpWorkerStep } from '../../src/core/erp-worker-step.mjs';
import { recoverErpCloudSliceFailure } from '../../src/services/erp-cloud-slice-recovery.ts';
import { isOperationalErpSyncComplete, stageFileContinuation } from '../../supabase/functions/_shared/erp-sync.mjs';
import { runSecondaryErpSyncStep, SECONDARY_ERP_STAGES } from '../../supabase/functions/_shared/erp-secondary-sync.mjs';
import { fixtureErpReceipt, withArchiveProof } from '../../src/core/erp-runtime-fetch-fixtures.mjs';

const stageOrder = ['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed'];

function manualStartFixture(runFunctions) {
  const writes = [], reads = [];
  const headers = Promise.withResolvers();
  const context = runFunctions('assets/erp-manual-continuation.js', ['runGoogleAppsScriptTrigger'], {
    isRunScriptActive: false, window: {}, currentUser: 'dylan_collyge',
    document: { hidden: false }, navigator: { onLine: true },
    manualSyncStatusState: null, manualSyncStatusPollInFlight: false, lastManualSyncStatusCheckedAt: 0,
    manualSyncStartPending: false, manualSyncStartGeneration: 0, nativeAuthRecoveryEpoch: 1,
    nativeAuthProfile: { id: 'fixture' }, MANUAL_ERP_SCAN_DEADLINE_MS: 25000,
    MANUAL_SYNC_STAGE_ORDER_CLIENT_DEFAULT: stageOrder, MANUAL_SYNC_STATUS_STALE_MS: 12000,
    releaseStaleManualSyncClientStateIfNeeded() {}, canRunManualInventoryImport: () => true,
    hasActiveManualSync: () => false, syncGoogleScriptButton() {}, showToast() {}, renderErpSyncProgressModal() {},
    getSupabaseReadIdentityScope: () => 'same-account', getNativeAuthRequestHeaders: () => headers.promise,
    applyManualSyncStatus: status => status, firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== ''),
    APP_API_FUNCTION_URL: '/app-api', crypto: { randomUUID: () => 'sync-command' },
    postAppFunctionJson: async (_url, payload) => {
      writes.push(payload);
      return { ok: true, data: { active: false, status: 'complete' } };
    },
    fetchManualSyncStatusFromScript: async () => { reads.push('status'); return { active: false, currentStage: 'idle' }; },
  });
  runFunctions('assets/erp-foreground-recovery.js', ['shouldIgnoreManualErpStatus'], context);
  runFunctions('assets/app-runtime.js', ['refreshManualSyncStatus'], context);
  return { context, writes, reads, headers };
}

export async function invariant83(runFunctions, functionSource) {
  const { context, writes, reads, headers } = manualStartFixture(runFunctions);
  const firstClick = context.runGoogleAppsScriptTrigger();
  assert.equal(context.isRunScriptActive, true);
  await context.runGoogleAppsScriptTrigger();
  headers.resolve({ Authorization: 'Bearer fixture-token' });
  await firstClick;
  assert.equal(writes.length, 1);
  assert.equal(writes[0].action, 'erp_sync');
  assert.equal(writes[0].operation, 'start');
  assert.equal(writes[0].commandId, 'sync-command');
  assert.equal(writes[0].maxAttemptsPerStage, 1);
  assert.equal(writes[0].force, true);
  assert.equal(context.isRunScriptActive, false);
  await context.refreshManualSyncStatus(true);
  await context.refreshManualSyncStatus(true);
  assert.deepEqual(reads, ['status', 'status']);
  assert.equal(writes.length, 1);
  for (const name of ['applyManualSyncStatus', 'releaseStaleManualSyncClientStateIfNeeded']) {
    assert.doesNotMatch(functionSource('assets/app-runtime.js', name), /postGoogleScriptJsonPayload|requestManualSyncServerStaleSweep|manual_continue/);
  }
  const hydration = runFunctions('assets/app-runtime.js', ['isDatasetFrozenDuringManualSync'], {
    hasActiveManualSync: () => true, MANUAL_SYNC_FROZEN_DATASET_KEYS: new Set(['master', 'cav']),
    manualSyncStatusState: { stageOrder, stageIndex: 1 },
    datasetLoadState: { master: { fullLoaded: true }, cav: { fullLoaded: true } },
  });
  assert.equal(hydration.isDatasetFrozenDuringManualSync('master', 'full'), false, 'published Drive data can hot-reload while later stages run');
  assert.equal(hydration.isDatasetFrozenDuringManualSync('cav', 'full'), true, 'current CAV import retains its completed snapshot');
}

function archiveDriveFixture({ file, bytes, destination, beforeMove, onMove }) {
  const fetcher = async (input, init = {}) => {
    const url = new URL(input);
    assert.ok(url.pathname.endsWith(`/files/${file.id}`));
    if (url.searchParams.get('alt') === 'media') return new Response(bytes);
    if (init.method !== 'PATCH') throw new Error(`Unexpected Drive request ${url}`);
    beforeMove();
    assert.equal(url.searchParams.get('removeParents'), file.parents.join(','));
    assert.equal(url.searchParams.get('addParents'), destination);
    onMove();
    return Response.json({ id: file.id });
  };
  return withArchiveProof(fetcher, bytes, file.parents);
}

function boundedDriveDatabase(file, bytes, counters) {
  const hash = createHash('sha256').update(bytes).digest('hex');
  return { async rpc(name, args) {
    if (name === 'check_erp_file_sync_needed_v1') return { data: { skip: false } };
    if (name === 'fast_erp_import_columns_v1') return { data: ['unique_id', 'itemcode', 'commonname', 'ptravailable'] };
    if (name === 'begin_pending_erp_stage_v3070') {
      assert.equal(args.p_expected_rows, 1201);
      assert.equal(args.p_file_meta.content_hash, hash);
      return { data: { stage_id: 'golden-stage', expected_rows: 1201, staged_rows: 0 } };
    }
    if (name === 'fast_append_erp_stage_batch_v1') {
      assert.equal(args.p_stage_id, 'golden-stage');
      assert.equal(args.p_start_row, counters.appended.reduce((total, size) => total + size, 0));
      counters.appended.push(args.p_rows.length);
      return { data: { staged_rows: args.p_start_row + args.p_rows.length } };
    }
    if (name === 'fast_commit_erp_stage_swap_v1') {
      assert.deepEqual(args, { p_stage_id: 'golden-stage', p_async: true });
      assert.deepEqual(counters.appended, [600, 600, 1]);
      counters.committed += 1;
      return { data: fixtureErpReceipt('ph_master_inventory', file.name, 1201) };
    }
    throw new Error(`Unexpected ERP RPC ${name}`);
  } };
}

export async function invariant155() {
  const lines = Array.from({ length: 1201 }, (_, index) => `item-${index},Plant ${index},1`).join('\n');
  const bytes = `itemcode,commonname,ptravailable\n${lines}\n`;
  const file = { id: 'golden-erp-bounded', name: 'Drive.csv', modifiedTime: '2026-10-29T12:00:00Z', parents: ['drop-folder', 'shared-folder'] };
  const counters = { appended: [], committed: 0, archived: false };
  const supabase = boundedDriveDatabase(file, bytes, counters);
  const fetcher = archiveDriveFixture({ file, bytes, destination: 'processed-folder',
    beforeMove: () => assert.equal(counters.committed, 1), onMove: () => { counters.archived = true; } });
  let state = null, result;
  for (let slice = 0; slice < 5; slice += 1) {
    result = await stageFileContinuation({ supabase, fetcher, token: 'fixture-token', file, dataset: 'drive_around', stageKey: 'drive',
      parentId: 'drop-folder', processedId: 'processed-folder', status: async () => {}, state, maxRowsPerSlice: 600 });
    if (result.done) break;
    state = result.state;
    assert.ok(state.processedRows < 1201 || state.phase === 'finalize' || state.phase === 'move');
  }
  assert.equal(result.done, true);
  assert.deepEqual(counters.appended, [600, 600, 1]);
  assert.equal(counters.committed, 1);
  assert.equal(counters.archived, true);
}

function secondaryDatabase(calls, digest, fileId) {
  return { async rpc(name, args) {
    calls.push(name);
    if (name === 'prepare_manager_order_import_v2') {
      assert.equal(args.p_content_sha256, digest);
      return { data: { status: 'importing', batchId: '00000000-0000-4000-8000-000000000001' } };
    }
    if (name === 'upsert_secondary_erp_delta_v23103') {
      assert.equal(args.p_rows.length, 1);
      assert.match(args.p_rows[0].row_state_hash, /^[a-f0-9]{64}$/);
      return { data: { changed: 1 } };
    }
    if (name === 'finalize_pikes_order_import') {
      assert.equal(args.p_content_sha256, digest);
      assert.equal(args.p_expected_row_count, 1);
      return { data: { status: 'archive_pending' } };
    }
    if (name === 'mark_pikes_order_file_archived') {
      assert.deepEqual(args, { p_drive_file_id: fileId, p_content_sha256: digest });
      return { data: { status: 'processed' } };
    }
    throw new Error(`Unexpected secondary RPC ${name}`);
  } };
}

export async function invariant158() {
  const stage = SECONDARY_ERP_STAGES.find(row => row.key === 'pikes'), calls = [];
  const folders = Object.fromEntries(SECONDARY_ERP_STAGES.map(row => [row.key, { files: [], listDurationMs: 0 }]));
  const file = { id: 'source-file', name: 'order.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    parents: ['actual-parent', 'pending-parent'] };
  folders.pikes.files = [file];
  const bytes = new Uint8Array([1, 2, 3]);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const supabase = secondaryDatabase(calls, digest, file.id);
  const fetcher = archiveDriveFixture({ file, bytes, destination: stage.processed,
    beforeMove: () => assert.ok(calls.includes('finalize_pikes_order_import')), onMove: () => calls.push('moved') });
  const args = { supabase, accessToken: 'fixture', env: () => '', status: async () => {} };
  const first = await runSecondaryErpSyncStep({ ...args, fetcher, cursor: { secondaryFolders: folders },
    parseWorkbook: async () => [{ name: 'Order', rows: [['Item', 'Order Tot', 'Pick Notes'], ['001', '4', 'North']] }] });
  assert.equal(first.done, false);
  assert.ok(calls.indexOf('moved') > calls.indexOf('finalize_pikes_order_import'));
  assert.ok(calls.indexOf('mark_pikes_order_file_archived') > calls.indexOf('moved'));
  const final = await runSecondaryErpSyncStep({ ...args, fetcher: () => { throw Error('No repeat download'); }, cursor: first.cursor });
  assert.equal(final.done, true);
}

export async function invariant232(runFunctions) {
  const file = { id: 'cav-232', name: 'CAV.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  for (const resumed of [false, true]) {
    let clock = 0, chunks = 0;
    const context = runFunctions('supabase/functions/_shared/erp-sync.mjs', ['runErpSyncWorkerStep'], {
      runPendingErpWorkerStep, STAGES: [{ key: 'cav', dataset: 'cav' }], ERP_SYNC_SOURCE_FOLDERS: {},
      prefetchErpFolders: async () => ({ cav: { files: [file], listDurationMs: 800 } }),
      resolveErpRowsPerSlice: () => 1500,
      stageFileContinuation: async options => {
        chunks += 1;
        assert.ok(clock >= 800);
        assert.ok(options.maxRowsPerSlice <= 1500);
        return { done: false, state: { nextOffset: (options.state?.nextOffset || 0) + 1500 } };
      },
      buildOperationalStageCheckpoint: () => assert.fail('A partial file cannot complete its stage'),
    });
    const cursor = resumed ? { stageIndex: 0, fileContinuation: { stageIndex: 0, file, state: { nextOffset: 1500 } } } : { stageIndex: 0 };
    const result = await context.runErpSyncWorkerStep({ supabase: {}, env: () => JSON.stringify({ cav: 'cav-folder' }),
      fetcher: async () => { throw Error('Unexpected fetch'); }, status: async () => { clock += 800; },
      cursor, accessToken: 'fixture-token', maxRowsPerSlice: 1500 });
    assert.equal(chunks, 1, 'one bounded chunk must run even after slow network status calls');
    assert.equal(result.cursor.fileContinuation.state.nextOffset, resumed ? 3000 : 1500);
  }
}

export async function invariant257(runFunctions, plain) {
  const writes = [], checks = [], checkedAt = '2026-11-13T12:00:00.000Z';
  const context = runFunctions('supabase/functions/app-api/index.ts', ['processCloudErpSyncStep'], {
    isOperationalErpSyncComplete, recoverErpCloudSliceFailure, jsonObject: value => value || {},
    mintCloudDriveAccessToken: async () => 'token', prefetchSecondaryFolders: async () => ({}), SECONDARY_ERP_STAGES: [],
    fetch: async () => { throw Error('Unexpected network read'); }, Deno: { env: { get: () => '' } },
    supabase: { async rpc(name, args) {
      if (name === 'assert_erp_sync_worker_v1') return { data: true };
      if (name === 'record_erp_stage_checked_v3070') {
        checks.push(plain(args));
        return { data: { ok: true, last_checked_at: checkedAt } };
      }
      if (name === 'update_erp_sync_job_v1') { writes.push(plain(args.p_status)); return { data: args.p_status }; }
      throw new Error(`Unexpected ERP RPC ${name}`);
    } },
    runErpSyncWorkerStep: async ({ status }) => {
      await status({ sourceProgressDelta: { key: 'drive', stage: 'complete', checked: true, percent: 100 } });
      await status({ stageResults: [{ key: 'drive', sourceFileName: 'exact.xlsx', outcome: 'processed', rowCount: 9498 }] });
      return { done: false, cursor: { stageIndex: 1 } };
    },
  });
  await context.processCloudErpSyncStep('run', 'owner', 1, { runId: 'run', active: true, status: 'running',
    sourceProgress: { drive: { fileName: 'exact.xlsx', stage: 'published', percent: 100, rowsPublished: 9498 } }, stageResults: [] });
  assert.deepEqual(checks, [{ p_run_id: 'run', p_worker_id: 'owner', p_stage_key: 'drive' }]);
  const checkpoint = writes.at(-1).sourceProgress.drive;
  assert.equal(checkpoint.stage, 'complete');
  assert.equal(checkpoint.checked, true);
  assert.equal(checkpoint.checkedAt, checkedAt);
  assert.equal(isOperationalErpSyncComplete(writes.at(-1)), false);
}
