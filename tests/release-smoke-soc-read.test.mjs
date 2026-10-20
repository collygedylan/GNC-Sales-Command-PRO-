import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { readReleaseSmokeSocPage } from './helpers/release-smoke-soc-read.mjs';

const snapshot = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/suspend-v2314.json.gz', import.meta.url))).toString('utf8'));
const older = snapshot.suspendRows.filter(row => row.SUSPEND === 'SUSPEND').slice(0, 3).map((row, index) => ({
  ...row, UNIQUE_ID: `isolated-older-source-${index}`, FILENAME: 'SOC-10 Open Orders-12250920261019122509.xlsx', LAST_UPDATED: '2026-10-19T22:00:00.000Z',
}));
const sourceRows = [...snapshot.suspendRows, ...older];
const params = (changes = {}) => ({ limit: 500, offset: 0, projection: 'default', filters: [], order: [{ field: 'unique_id', ascending: true }], ...changes });

test('SOC reads preserve the same 70 physical source rows seeded into the release fixture', () => {
  const before = structuredClone(sourceRows);
  const result = readReleaseSmokeSocPage(sourceRows, 'soc', params());
  assert.equal(result.total, 70);
  assert.equal(result.rows.length, 70);
  assert.equal(result.offset, 0);
  assert.equal(result.limit, 500);
  assert.equal(result.hasMore, false);
  assert.deepEqual(result.rows.map(row => row.unique_id).sort(), sourceRows.map(row => row.UNIQUE_ID).sort());
  assert.ok(result.rows.every(row => Object.keys(row).every(key => key === key.toLowerCase())));
  const first = result.rows.find(row => row.unique_id === snapshot.suspendRows[0].UNIQUE_ID);
  assert.equal(first.suspend_to, 'dc');
  assert.equal(first.filename, snapshot.suspendRows[0].FILENAME);
  assert.equal(first.last_updated, snapshot.suspendRows[0].LAST_UPDATED);
  assert.equal(Object.hasOwn(first, 'suspendto'), false);
  assert.equal(Object.hasOwn(first, 'sourcerowkey'), false);
  assert.equal(Object.hasOwn(result, 'sourceFreshness'), false);
  assert.deepEqual(sourceRows, before);
});

test('Suspend reads enforce physical DC eligibility and retain the full SOC source watermark', () => {
  const result = readReleaseSmokeSocPage(sourceRows, 'suspend_tag', params());
  assert.equal(result.total, 40);
  assert.ok(result.rows.every(row => String(row.suspend).toUpperCase() === 'SUSPEND' && row.suspend_to === 'dc'));
  assert.deepEqual(result.sourceFreshness, { filename: snapshot.suspendRows[0].FILENAME, last_updated: snapshot.suspendRows[0].LAST_UPDATED });
  const later = readReleaseSmokeSocPage(sourceRows, 'suspend_tag', params({ offset: 30, limit: 10 }));
  assert.equal(later.rows.length, 10);
  assert.equal(later.hasMore, false);
  assert.equal(Object.hasOwn(later, 'sourceFreshness'), false);
});

test('SOC filters and anyOf apply before exact totals and ids projection', () => {
  const wanted = sourceRows.slice(0, 3);
  const result = readReleaseSmokeSocPage(sourceRows, 'soc', params({
    projection: 'ids', filters: [{ field: 'last_updated', op: 'not.is', value: null }],
    anyOf: wanted.map(row => ({ field: 'unique_id', op: 'eq', value: row.UNIQUE_ID })),
  }));
  assert.equal(result.total, 3);
  assert.deepEqual(result.rows, wanted.map(row => ({ unique_id: row.UNIQUE_ID })).sort((a, b) => a.unique_id.localeCompare(b.unique_id)));
});

test('SOC descending freshness order and deterministic identity ties precede pagination', () => {
  const rows = [
    { UNIQUE_ID: 'c', LAST_UPDATED: null, FILENAME: 'old.xlsx' },
    { UNIQUE_ID: 'b', LAST_UPDATED: '2026-10-20T13:00:00Z', FILENAME: 'new.xlsx' },
    { UNIQUE_ID: 'a', LAST_UPDATED: '2026-10-20T13:00:00Z', FILENAME: 'new.xlsx' },
    { UNIQUE_ID: 'd', LAST_UPDATED: '2026-10-19T13:00:00Z', FILENAME: 'old.xlsx' },
  ];
  const result = readReleaseSmokeSocPage(rows, 'soc', params({ projection: 'ids', limit: 1, offset: 1,
    filters: [{ field: 'last_updated', op: 'not.is', value: null }], order: [{ field: 'last_updated', ascending: false }],
  }));
  assert.equal(result.total, 3);
  assert.deepEqual(result.rows, [{ unique_id: 'b' }]);
  assert.equal(result.hasMore, true);
});

test('unsupported SOC signature projection is rejected instead of inventing a successful page', () => {
  for (const dataset of ['soc', 'suspend_tag']) assert.throws(() => readReleaseSmokeSocPage(sourceRows, dataset, params({ projection: 'signature' })), /PROJECTION_INVALID/);
});

test('Suspend source freshness includes unmarked SOC rows independently of eligible-page rows', () => {
  const newer = { ...sourceRows[0], UNIQUE_ID: 'unmarked-new-file', SUSPEND: '', FILENAME: 'SOC-newer.xlsx', LAST_UPDATED: '2026-10-21T00:00:00.000Z' };
  const result = readReleaseSmokeSocPage([...sourceRows, newer], 'suspend_tag', params({ limit: 1 }));
  assert.equal(result.total, 40);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.sourceFreshness, { filename: newer.FILENAME, last_updated: newer.LAST_UPDATED });
});
