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
    assert.deepEqual(JSON.parse(request.payload), rows, 'the database receives original legacy values to compare and acknowledge');
    const retry = context.buildSupabaseUpsertRequest_(table, rows.slice(0, 1));
    assert.equal(retry.headers['x-gnc-import-run-id'], runId);
  }
  vm.runInContext('datasetImportFenceContext_ = null;', context);
  assert.equal(Object.hasOwn(context.getSupabaseHeaders_(), 'x-gnc-import-run-id'), false,
    'ordinary app writes do not impersonate import acknowledgments');
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
