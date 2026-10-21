import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: suspend
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource();

function extractFunction(name) {
  const declaration = `function ${name}(`;
  const marker = html.indexOf(declaration);
  const start = marker < 0 ? -1 : html.lastIndexOf('\n', marker) + 1;
  assert.ok(start >= 0, `missing ${name}`);
  const end = html.slice(start + 1).search(/\r?\n        (?:async )?function \w+\(/);
  return html.slice(start, end < 0 ? undefined : start + end + 1);
}

function loadHelpers() {
  const context = vm.createContext({
    socRawSourceRows: [],
    getValidIsoTimestamp: value => {
      const stamp = Date.parse(String(value || ''));
      return Number.isFinite(stamp) ? new Date(stamp).toISOString() : '';
    },
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== ''),
    getDockSuspendValue: row => String(row?.SUSPEND ?? row?.suspend ?? '').trim().toUpperCase(),
    getDockSuspendToValue: row => String(row?.SUSPEND_TO ?? row?.suspend_to ?? '').trim().toLowerCase(),
    getItemUniqueId: row => String(row?.UNIQUE_ID ?? row?.unique_id ?? '').trim(),
  });
  vm.runInContext([
    extractFunction('getLatestSocImportFileWatermark'),
    extractFunction('getLatestSocSuspendTagSourceRows'),
  ].join('\n'), context);
  return context;
}

function loadAuthorizedSuspendTagPageReader() {
  const context = vm.createContext({
    getAuthorizedDatasetRead: () => ({ dataset: 'suspend_tag' }),
    buildAuthorizedDatasetReadParams: () => ({ offset: 0, limit: 500 }),
    getSupabaseReadIdentityScope: () => 'editor-session',
    appAccessSnapshotState: { snapshot: { dataPermissionVersion: 'perm-1' } },
    SUPABASE_READ_TIMEOUT_MS: 10000,
    APP_API_FUNCTION_URL: 'https://api.test/app-api',
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== ''),
    getValidIsoTimestamp: value => {
      const stamp = Date.parse(String(value || ''));
      return Number.isFinite(stamp) ? new Date(stamp).toISOString() : '';
    },
    response: null,
    postAppFunctionJson: async () => ({ ok: true, data: context.response }),
    acceptCardLocationOnHandSourceReceipt: () => false,
    stampCardLocationOnHandReceipt: () => {},
    staleSupabaseReadScopeError: () => new Error('stale read'),
    suspendTagSourceFreshness: { scope: '', permissionVersion: '', loaded: false, filename: '', lastUpdated: '' },
  });
  vm.runInContext([
    extractFunction('requestAuthorizedDatasetReadPage'),
    extractFunction('getCurrentSuspendTagSourceFreshness'),
    extractFunction('getLatestSocImportFileWatermark'),
  ].join('\n'), context);
  return context;
}

test('SOC metadata does not hide unchanged physical tags in the current authorized delta snapshot', () => {
  const ctx = loadHelpers();
  const fullSoc = [
    { FILENAME: 'SOC-older.xlsx', LAST_UPDATED: '2026-10-19T20:00:00Z', UNIQUE_ID: 'old-1' },
    { FILENAME: 'SOC-latest.xlsx', LAST_UPDATED: '2026-10-20T13:00:00Z', UNIQUE_ID: 'latest-plain' },
    { FILENAME: 'SOC-latest.xlsx', LAST_UPDATED: '2026-10-20T13:00:00Z', UNIQUE_ID: 'latest-tag', SUSPEND: 'SUSPEND', SUSPEND_TO: 'DC' },
  ];
  const suspendSourceRows = [
    { FILENAME: 'SOC-older.xlsx', LAST_UPDATED: '2026-10-19T20:00:00Z', UNIQUE_ID: 'old-1', SUSPEND: 'SUSPEND', SUSPEND_TO: 'DC' },
    { FILENAME: 'SOC-latest.xlsx', LAST_UPDATED: '2026-10-20T13:00:00Z', UNIQUE_ID: 'latest-tag', SUSPEND: 'SUSPEND', SUSPEND_TO: 'DC' },
    { FILENAME: 'SOC-latest.xlsx', LAST_UPDATED: '2026-10-20T13:00:00Z', UNIQUE_ID: 'latest-not-marked', SUSPEND: '', SUSPEND_TO: 'DC' },
  ];

  assert.deepEqual(JSON.parse(JSON.stringify(ctx.getLatestSocImportFileWatermark(fullSoc))), {
    filename: 'SOC-latest.xlsx', lastUpdated: '2026-10-20T13:00:00.000Z', timestampMs: Date.parse('2026-10-20T13:00:00Z'),
  });
  assert.deepEqual(Array.from(ctx.getLatestSocSuspendTagSourceRows(suspendSourceRows, fullSoc), row => row.UNIQUE_ID), ['old-1', 'latest-tag']);

  const latestFileWithoutAnyDockTags = [
    { FILENAME: 'SOC-older.xlsx', LAST_UPDATED: '2026-10-19T20:00:00Z', UNIQUE_ID: 'old-1' },
    { FILENAME: 'SOC-latest.xlsx', LAST_UPDATED: '2026-10-20T14:00:00Z', UNIQUE_ID: 'latest-unmarked', SUSPEND: '', SUSPEND_TO: 'DC' },
  ];
  assert.deepEqual(Array.from(ctx.getLatestSocSuspendTagSourceRows([], latestFileWithoutAnyDockTags)), [],
    'an empty authorized snapshot stays empty instead of resurrecting records from metadata');

  const authoritativeLatestFile = { loaded: true, filename: 'SOC-newest.xlsx', last_updated: '2026-10-20T15:00:00Z' };
  assert.deepEqual(Array.from(ctx.getLatestSocSuspendTagSourceRows(suspendSourceRows, fullSoc, authoritativeLatestFile), row => row.UNIQUE_ID), ['old-1', 'latest-tag'],
    'new import metadata does not imply deletion of unchanged rows returned by the server');
});

test('authorized Suspend page freshness is bound to its permission scope and an empty latest file is authoritative', async () => {
  const ctx = loadAuthorizedSuspendTagPageReader();
  ctx.response = {
    rows: [], total: 0, offset: 0, limit: 500,
    sourceFreshness: { filename: 'SOC-empty-newest.xlsx', last_updated: '2026-10-20T16:00:00Z' },
  };
  await ctx.requestAuthorizedDatasetReadPage('ph_soc_suspend_tag_rows');
  assert.equal(ctx.getCurrentSuspendTagSourceFreshness().filename, 'SOC-empty-newest.xlsx');

  ctx.response = { rows: [], total: 0, offset: 0, limit: 500, sourceFreshness: null };
  await ctx.requestAuthorizedDatasetReadPage('ph_soc_suspend_tag_rows');
  const freshness = ctx.getCurrentSuspendTagSourceFreshness();
  assert.equal(freshness.loaded, true);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.getLatestSocImportFileWatermark([
    { FILENAME: 'SOC-old.xlsx', LAST_UPDATED: '2026-10-19T12:00:00Z' },
  ], freshness))), { filename: '', lastUpdated: '', timestampMs: -1 });

  ctx.response = { rows: [], total: 0, offset: 0, limit: 500 };
  await ctx.requestAuthorizedDatasetReadPage('ph_soc_suspend_tag_rows');
  assert.equal(ctx.getCurrentSuspendTagSourceFreshness(), null,
    'a page response without the metadata contract must not retain a prior file watermark');
});

