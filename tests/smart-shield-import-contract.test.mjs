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
});
