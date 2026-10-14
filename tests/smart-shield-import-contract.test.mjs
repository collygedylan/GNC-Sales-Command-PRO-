import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
const runId = '90000000-0000-4000-8000-000000000001';
function importer() {
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, value) => Array.from(createHash(algorithm).update(value, 'utf8').digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
    },
  });
  new vm.Script(source, { filename: 'Code.gs' }).runInContext(context);
  context.testRunId = runId;
  vm.runInContext('datasetImportFenceContext_ = {runId:testRunId};', context);
  return context;
}
const plain = value => JSON.parse(JSON.stringify(value));

function stubSeasonReconciliation(context, responses) {
  const calls = [];
  context.Utilities.sleep = () => {};
  context.callDatasetImportFenceRpc_ = name => ({ ok: true, state: 'active', name });
  context.callSupabaseRpc_ = (name, payload) => {
    calls.push({ name, payload: plain(payload) });
    const response = responses.shift();
    if (!response) throw new Error('Unexpected Season Sales RPC call');
    if (response instanceof Error) throw response;
    const output = plain(response);
    if (vm.runInContext('Boolean(datasetImportFenceContext_)', context) && output &&
        (output.status === 'completed' || output.status === 'dry_run')) {
      if (!Object.hasOwn(output, 'seasonCode')) output.seasonCode = 'F1';
      if (!Object.hasOwn(output, 'salesYear')) output.salesYear = 27;
    }
    return output;
  };
  return calls;
}

function seasonPlan(itemcodes, overrides = {}) {
  return {
    ok: true, status: 'dry_run', scopeCount: itemcodes.length, itemcodes,
    seasonCode: 'F1', salesYear: 27,
    winnerCount: itemcodes.length, openCount: 0, doneCount: 0,
    newStateCount: 0, winnerChangeCount: 0, reopenCount: 0, retireCount: 0,
    mirrorUpsertCount: 0, scopeHash: 'a'.repeat(64), ...overrides,
  };
}

test('master writes start with bounded chunks and preserve every source row and mask', () => {
  const context = importer();
  const rows = Array.from({ length: 153 }, (_, index) => ({ unique_id: `bounded-${index}`, locationnote: `note-${index}` }));
  rows.forEach(row => context.setMasterItem6RawFieldMask_(row, ['locationnote']));
  const requests = context.buildSupabaseUpsertRequests_('ph_master_inventory', rows);
  assert.deepEqual(plain(requests.map(request => JSON.parse(request.payload).length)), [75, 75, 3]);
  assert.deepEqual(plain(requests.flatMap(request => JSON.parse(request.payload))).map(row => row.unique_id), rows.map(row => row.unique_id));
  requests.forEach(request => assert.deepEqual(JSON.parse(request.headers['x-gnc-master-item6-fields']), ['locationnote']));
  const auxiliary = context.buildSupabaseUpsertRequests_('ph_soc_master', rows);
  assert.equal(auxiliary.length, 1, 'auxiliary sources retain their existing request size');
});

test('daily source upserts and retries carry the validated import identity used by the database shield', () => {
  const context = importer();
  for (const table of ['ph_master_inventory', 'ph_soc_master', 'ph_reserves']) {
    const rows = [{ unique_id: 'fixture-row', priority: '2', holdstopcode: 'H', holdstopreason: 'Legacy reason' }];
    const request = context.buildSupabaseUpsertRequest_(table, rows);
    assert.equal(request.headers['x-gnc-import-run-id'], runId);
    assert.equal(request.headers['x-gnc-master-tuple-policy'], 'raw-priority-hold-v1');
    assert.deepEqual(JSON.parse(request.payload), rows, 'the database receives original legacy values to compare and acknowledge');
    const retry = context.buildSupabaseUpsertRequest_(table, rows.slice(0, 1));
    assert.equal(retry.headers['x-gnc-import-run-id'], runId);
    assert.equal(retry.headers['x-gnc-master-tuple-policy'], 'raw-priority-hold-v1');
  }
  vm.runInContext('datasetImportFenceContext_ = null;', context);
  assert.equal(Object.hasOwn(context.getSupabaseHeaders_(), 'x-gnc-import-run-id'), false,
    'ordinary app writes do not impersonate import acknowledgments');
  assert.equal(Object.hasOwn(context.getSupabaseHeaders_(), 'x-gnc-master-tuple-policy'), false);
});

test('daily snapshot pruning preserves the import identity needed for priority alias protection', () => {
  const context = importer();
  const requests = [];
  context.executeFetchAllBatches = batch => {
    requests.push(...plain(batch));
    return batch.map(() => ({ getResponseCode: () => 204, getContentText: () => '' }));
  };
  context.deleteFromSupabase('ph_master_inventory', ['fixture-old-priority-2']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'delete');
  assert.equal(requests[0].headers['x-gnc-import-run-id'], runId);
  assert.equal(requests[0].headers['x-gnc-master-tuple-policy'], 'raw-priority-hold-v1');
  assert.match(requests[0].url, /ph_master_inventory\?unique_id=in\./);
});

test('invalidating the legacy comparison hash forces the next unchanged export through SQL acknowledgment', () => {
  const context = importer();
  const data = [
    ['ITEMCODE', 'COMMONNAME', 'CONTSIZE', 'LOCATIONCODE', 'LOTCODE', 'SOURCE', 'PRIORITY', 'HOLDSTOPCODE', 'HOLDSTOPREASON'],
    ['00001', 'Synthetic shrub', '#3', 'C.06.001', 'fixture-lot', 'PH', '2', 'H', 'Legacy reason'],
  ];
  const build = existing => context.buildMasterPayload(data, 'ph_master_inventory', existing,
    '2026-10-09T12:00:00Z', 'synthetic-smart-shield.csv');
  const imported = plain(build([]).upserts[0]);
  assert.equal(build([imported]).upserts.length, 0);
  // Empty hashes fall back to field equality. A nonempty pending marker makes
  // even A -> B -> A edits revalidate against the next legacy snapshot.
  const pendingAcknowledgment = { ...imported, concat: 'smart-shield-pending:synthetic-edit' };
  const replay = build([pendingAcknowledgment]);
  assert.equal(replay.upserts.length, 1);
  assert.equal(replay.upserts[0].priority, '2');
  assert.equal(replay.upserts[0].holdstopcode, 'H');
  assert.equal(replay.upserts[0].holdstopreason, 'Legacy reason');
  assert.equal(replay.seenIds.has(imported.unique_id), true);
});

test('PH importer preserves raw legacy holds for SQL acknowledgment even after an approved release', () => {
  const context = importer();
  const data = [
    ['ITEMCODE', 'COMMONNAME', 'CONTSIZE', 'LOCATIONCODE', 'LOTCODE', 'SOURCE', 'PRIORITY', 'HOLDSTOPCODE', 'HOLDSTOPREASON'],
    ['00001', 'Synthetic shrub', '#3', 'C.06.001', 'fixture-lot', 'PH', '2', 'H', 'Legacy reason'],
  ];
  const build = existing => context.buildMasterPayload(data, 'ph_master_inventory', existing,
    '2026-10-09T12:00:00Z', 'synthetic-smart-shield.csv');
  const imported = plain(build([]).upserts[0]);
  const released = { ...imported, holdstopcode: null, holdstopreason: null,
    hold_release_approved_at: '2026-10-08T12:00:00Z', concat: 'smart-shield-pending:released' };
  const next = build([released]).upserts[0];
  assert.equal(next.holdstopcode, 'H', 'a cleared source tuple would falsely drop the pending shield');
  assert.equal(next.holdstopreason, 'Legacy reason');
  assert.equal(next.priority, '2');

  const otherSite = { holdstopcode: 'H', holdstopreason: 'Legacy reason' };
  context.applyMasterImportAppFieldRules_(otherSite, released, 'tx_master_inventory');
  assert.equal(otherSite.holdstopcode, null, 'non-PH importer behavior is unchanged');
});

test('master CSV source presence survives payload normalization as a per-chunk editable-field mask', () => {
  const context = importer();
  const headers = ['ITEMCODE', 'COMMONNAME', 'CONTSIZE', 'LOCATIONCODE', 'LOTCODE', 'SOURCE',
    'LOCATIONNOTE', 'LOCATIONPTN1', 'DESIGITEM', 'DESIGCUST', 'DESIGLOC', 'PULLERRESPONSIBILITY',
    'OVERSELLPERCENTAGE', 'SALESNOTE', 'SUSPEND'];
  const data = [headers, ['00001', 'Café plant', '#3', 'A.1.001', 'lot-1', 'PH', 'Note', 'PTN', 'DI', 'DC', 'DL', 'puller', '12', 'Sales', 'AB']];
  const built = context.buildMasterPayload(data, 'ph_master_inventory', [], '2026-10-09T12:00:00Z', 'item6.csv');
  const payloadRow = built.upserts[0];
  assert.equal(Object.keys(payloadRow).includes('__gncMasterItem6RawFields'), false, 'presence is non-enumerable and never enters the database row');
  assert.deepEqual(plain(context.getMasterItem6RawFieldMask_(payloadRow)), [
    'locationnote', 'locationptn1', 'desigitem', 'desigcust', 'desigloc',
    'pullerresponsibility', 'oversellpercentage', 'salesnote', 'suspend',
  ]);
  const request = context.buildSupabaseUpsertRequests_('ph_master_inventory', [payloadRow])[0];
  assert.deepEqual(JSON.parse(request.headers['x-gnc-master-item6-fields']), plain(context.getMasterItem6RawFieldMask_(payloadRow)));
  assert.equal(JSON.stringify(JSON.parse(request.payload)).includes('__gncMasterItem6RawFields'), false);

  const partial = {};
  context.setMasterItem6RawFieldMask_(partial, ['locationnote', 'salesnote', 'suspend']);
  const intersection = context.buildSupabaseUpsertRequests_('ph_master_inventory', [payloadRow, partial])[0];
  assert.deepEqual(JSON.parse(intersection.headers['x-gnc-master-item6-fields']), ['locationnote', 'salesnote', 'suspend']);
  const pruned = context.removeSupabaseColumnsFromPayload_([payloadRow], ['salesnote']);
  assert.deepEqual(plain(context.getMasterItem6RawFieldMask_(pruned[0])), [
    'locationnote', 'locationptn1', 'desigitem', 'desigcust', 'desigloc', 'pullerresponsibility', 'oversellpercentage', 'suspend',
  ], 'a missing-column retry cannot acknowledge the removed source field');
  assert.equal(Object.hasOwn(context.buildSupabaseUpsertRequests_('ph_soc_master', [payloadRow])[0].headers, 'x-gnc-master-item6-fields'), false);
});

test('master timeout split retries retain the original chunk presence mask', () => {
  const context = importer();
  const rows = Array.from({ length: 101 }, (_, index) => {
    const row = { unique_id: `split-${index}` };
    context.setMasterItem6RawFieldMask_(row, ['locationnote', 'suspend']);
    return row;
  });
  const request = context.buildSupabaseUpsertRequests_('ph_master_inventory', rows)[0];
  const retryRequests = [];
  const heartbeatCalls = [];
  context.callDatasetImportFenceRpc_ = name => {
    heartbeatCalls.push(name);
    return { ok: true, state: 'active' };
  };
  context.console = { warn() {}, error() {}, log() {} };
  context.UrlFetchApp = { fetch(url, options) {
    retryRequests.push(options);
    return { getResponseCode: () => 204, getContentText: () => '' };
  } };
  const initialResponse = { getResponseCode: () => 500, getContentText: () => JSON.stringify({ code: '57014' }) };
  const failures = context.executeSupabaseUpsertRequestWithRecovery_('ph_master_inventory', request, initialResponse, 1, 0);
  assert.deepEqual(plain(failures), []);
  assert.equal(retryRequests.length, 2);
  retryRequests.forEach((retry) => assert.deepEqual(JSON.parse(retry.headers['x-gnc-master-item6-fields']), ['locationnote', 'suspend']));
  assert.ok(heartbeatCalls.includes('heartbeat_dataset_import_v1'));
});

test('bounded master upsert split recovery heartbeats between slow network chunks', () => {
  const context = importer();
  let now = 1_000_000;
  const events = [];
  context.Date = { now: () => now };
  vm.runInContext('datasetImportFenceContext_.lastHeartbeatAt = Date.now();', context);
  context.callDatasetImportFenceRpc_ = (name) => {
    events.push(name);
    return { ok: true, state: 'active' };
  };
  const rows = Array.from({ length: 101 }, (_, index) => ({ unique_id: `heartbeat-split-${index}` }));
  const request = context.buildSupabaseUpsertRequests_('ph_master_inventory', rows)[0];
  context.UrlFetchApp = { fetch() {
    events.push('fetch');
    now += 61_000;
    return { getResponseCode: () => 204, getContentText: () => '' };
  } };

  const failures = context.executeSupabaseUpsertRequestWithRecovery_(
    'ph_master_inventory', request,
    { getResponseCode: () => 500, getContentText: () => JSON.stringify({ code: '57014' }) },
    1, 0,
  );

  assert.deepEqual(plain(failures), []);
  const firstFetch = events.indexOf('fetch');
  const secondFetch = events.indexOf('fetch', firstFetch + 1);
  assert.notEqual(firstFetch, -1);
  assert.notEqual(secondFetch, -1);
  assert.ok(events.slice(firstFetch + 1, secondFetch).includes('heartbeat_dataset_import_v1'),
    'a fetch taking longer than the 60-second heartbeat interval must refresh the import lease before the next split chunk');
});

test('bounded master upsert transport retries refresh an expired import heartbeat first', () => {
  const context = importer();
  let now = 2_000_000;
  const events = [];
  context.Date = { now: () => now };
  vm.runInContext('datasetImportFenceContext_.lastHeartbeatAt = Date.now();', context);
  context.callDatasetImportFenceRpc_ = (name) => {
    events.push(name);
    return { ok: true, state: 'active' };
  };
  context.Utilities.sleep = delay => { now += delay; };
  const request = context.buildSupabaseUpsertRequests_('ph_master_inventory', [{ unique_id: 'heartbeat-transport-retry' }])[0];
  context.UrlFetchApp = { fetch() {
    events.push('fetch');
    return { getResponseCode: () => 204, getContentText: () => '' };
  } };

  // The first request spent more than the heartbeat interval before returning
  // its transient failure, so the subsequent transport retry must refresh.
  now += 61_000;
  const response = context.retrySupabaseUpsertRequest_(
    'ph_master_inventory', request,
    { getResponseCode: () => 503, getContentText: () => '' },
    1,
  );

  assert.equal(response.getResponseCode(), 204);
  assert.deepEqual(events, ['heartbeat_dataset_import_v1', 'fetch']);
});

test('fenced Season reconciliation uses the server worklist in bounded, stable-idempotency batches', () => {
  const context = importer();
  const itemcodes = Array.from({ length: 27 }, (_, index) => `ITEM-${String(index).padStart(3, '0')}`);
  itemcodes.push('RETIRED-ITEM');
  itemcodes.sort();
  const deferredThenDone = { ok: true, status: 'maintenance_deferred', code: 'MAINTENANCE_DEFERRED' };
  const completed = { ok: true, status: 'completed', winnerCount: 25, openCount: 20, doneCount: 5,
    newStateCount: 0, winnerChangeCount: 0, reopenCount: 0, retireCount: 0,
    mirrorUpsertCount: 20, scopeHash: 'chunk-hash' };
  const finalPlan = seasonPlan(itemcodes, { winnerCount: 28 });
  const calls = stubSeasonReconciliation(context, [
    seasonPlan(itemcodes, { winnerCount: 28 }), deferredThenDone, completed,
    { ...completed, winnerCount: 3, openCount: 3, doneCount: 0, mirrorUpsertCount: 3 }, finalPlan,
  ]);

  const result = context.reconcileSeasonSalesOfficeAfterImport_('revision-27', 'canonical_import');

  const writes = calls.filter(call => call.payload.p_dry_run === false);
  assert.deepEqual(plain(writes.map(call => call.payload.p_itemcodes)), [itemcodes.slice(0, 25), itemcodes.slice(0, 25), itemcodes.slice(25)]);
  assert.equal(writes[0].payload.p_idempotency_key, writes[1].payload.p_idempotency_key,
    'retrying a deferred chunk must reuse its stable idempotency key');
  assert.notEqual(writes[1].payload.p_idempotency_key, writes[2].payload.p_idempotency_key,
    'different chunks must have distinct idempotency keys');
  assert.equal(writes.every(call => call.payload.p_import_revision === 'canonical_import:revision-27'), true);
  assert.equal(writes.flatMap(call => call.payload.p_itemcodes).includes('RETIRED-ITEM'), true,
    'the server worklist must include scope items without a current winner');
  assert.equal(calls.filter(call => call.payload.p_dry_run === true).length, 2,
    'one full-scope dry run plans chunks and one verifies convergence');
  assert.equal(result.status, 'completed');
});

test('fenced Season reconciliation fails closed on missing or malformed server worklists', () => {
  for (const plan of [
    { ok: true, status: 'dry_run', scopeCount: 1 },
    seasonPlan([' item ']),
    seasonPlan(['DUP', 'DUP']),
    seasonPlan(['A', ' A']),
    seasonPlan(['A'], { scopeCount: 2 }),
  ]) {
    const context = importer();
    const calls = stubSeasonReconciliation(context, [plan]);
    assert.throws(() => context.reconcileSeasonSalesOfficeAfterImport_('revision-bad', 'canonical_import'), /SEASON_SALES_RECONCILIATION/);
    assert.equal(calls.length, 1, 'invalid plans must fail before any writes');
  }
});

test('fenced Season reconciliation sorts a unique server worklist without assuming database collation order', () => {
  const context = importer();
  const databaseOrder = ['ITEM-2', 'ITEM-10', 'ITEM-1'];
  const completed = { ok: true, status: 'completed', winnerCount: 3, openCount: 3, doneCount: 0,
    newStateCount: 0, winnerChangeCount: 0, reopenCount: 0, retireCount: 0, mirrorUpsertCount: 3 };
  const calls = stubSeasonReconciliation(context, [
    seasonPlan(databaseOrder), completed, seasonPlan(['ITEM-1', 'ITEM-2', 'ITEM-10']),
  ]);

  context.reconcileSeasonSalesOfficeAfterImport_('revision-collation', 'canonical_import');

  const batch = calls.find(call => call.payload.p_dry_run === false);
  assert.deepEqual(plain(batch.payload.p_itemcodes), ['ITEM-1', 'ITEM-10', 'ITEM-2']);
});

test('Season batch idempotency hashing preserves itemcode boundaries', () => {
  const context = importer();
  const first = context.getSeasonSalesBatchIdempotencyKey_('same-base', 0, ['A|B', 'C']);
  const second = context.getSeasonSalesBatchIdempotencyKey_('same-base', 0, ['A', 'B|C']);
  assert.notEqual(first, second);
});

test('fenced Season reconciliation never reports success after a failed batch or failed convergence check', () => {
  const itemcodes = ['A', 'B'];
  const failedChunkContext = importer();
  const failedChunkCalls = stubSeasonReconciliation(failedChunkContext, [
    seasonPlan(itemcodes), { ok: false, status: 'failed' },
  ]);
  assert.throws(() => failedChunkContext.reconcileSeasonSalesOfficeAfterImport_('revision-fail', 'canonical_import'), /SEASON_SALES_RECONCILIATION/);
  assert.equal(failedChunkCalls.filter(call => call.payload.p_dry_run === true).length, 1,
    'a failed chunk must prevent final verification and success');

  for (const finalPlan of [
    seasonPlan(['A', 'CHANGED']),
    seasonPlan(itemcodes, { newStateCount: 1 }),
    seasonPlan(itemcodes, { winnerChangeCount: 1 }),
    seasonPlan(itemcodes, { retireCount: 1 }),
    seasonPlan(itemcodes, { reopenCount: 1 }),
    seasonPlan(itemcodes, { seasonCode: 'S1', scopeHash: 'b'.repeat(64) }),
    seasonPlan(itemcodes, { salesYear: 28, scopeHash: 'b'.repeat(64) }),
  ]) {
    const context = importer();
    const calls = stubSeasonReconciliation(context, [seasonPlan(itemcodes),
      { ok: true, status: 'completed', winnerCount: 2, openCount: 2, doneCount: 0,
        newStateCount: 0, winnerChangeCount: 0, reopenCount: 0, retireCount: 0, mirrorUpsertCount: 2 },
      finalPlan]);
    assert.throws(() => context.reconcileSeasonSalesOfficeAfterImport_('revision-converge', 'canonical_import'), /SEASON_SALES_RECONCILIATION/);
    assert.equal(calls.filter(call => call.payload.p_dry_run === true).length, 2);
  }

  const shiftedBatchContext = importer();
  const shiftedBatchCalls = stubSeasonReconciliation(shiftedBatchContext, [
    seasonPlan(itemcodes),
    { ok: true, status: 'completed', winnerCount: 2, openCount: 2, doneCount: 0,
      newStateCount: 0, winnerChangeCount: 0, reopenCount: 0, retireCount: 0, mirrorUpsertCount: 2,
      seasonCode: 'S1', salesYear: 27 },
  ]);
  assert.throws(() => shiftedBatchContext.reconcileSeasonSalesOfficeAfterImport_('revision-batch-scope', 'canonical_import'), /SCOPE_CHANGED/);
  assert.equal(shiftedBatchCalls.filter(call => call.payload.p_dry_run === true).length, 1,
    'a batch that ran under changed season settings must fail before final success');
});

test('unfenced Season reconciliation preserves its original single full-scope call', () => {
  const context = importer();
  vm.runInContext('datasetImportFenceContext_ = null;', context);
  const expected = { ok: true, status: 'completed', winnerCount: 2 };
  const calls = stubSeasonReconciliation(context, [expected]);

  const result = context.reconcileSeasonSalesOfficeAfterImport_('revision-plain', 'manual');

  assert.deepEqual(plain(result), expected);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.p_itemcodes, null);
  assert.equal(calls[0].payload.p_dry_run, false);
});
