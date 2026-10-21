import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: @home-role
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readComposedAppSource();
function source(name) {
  const start = html.search(new RegExp(`        function ${name}\\(`));
  assert.ok(start >= 0, `${name} exists`);
  const end = html.slice(start + 1).search(/\r?\n        (?:async )?function \w+\(/);
  return html.slice(start, start + end + 1);
}

function fixture() {
  const ctx = vm.createContext({
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') || '',
    getValidIsoTimestamp: value => value || ''
  });
  vm.runInContext(['dashboardFilenameTimestamp', 'selectDashboardSyncFilename', 'collectDashboardSyncSource', 'mergeDashboardSyncSummaries']
    .map(source).join('\n'), ctx);
  return ctx;
}

test('Home keeps one active Drive filename and selects the newer embedded import timestamp deterministically', () => {
  const ctx = fixture();
  const summary = ctx.collectDashboardSyncSource([
    { LAST_UPDATED:'2026-10-19T14:00:00Z', FILENAME:'DriveAroundMC-10-10320620261019103206.xlsx' },
    { LAST_UPDATED:'2026-10-19T14:00:00Z', FILENAME:'DriveAroundMC-10-16251320260916042513.xlsx' },
    { LAST_UPDATED:'2026-10-19T13:00:00Z', FILENAME:'older.xlsx' }
  ], 'Drive');
  assert.deepEqual(Array.from(summary.files), ['DriveAroundMC-10-10320620261019103206.xlsx']);
});

test('Home merge reduces tied Drive summaries to the one latest filename', () => {
  const ctx = fixture();
  const merged = ctx.mergeDashboardSyncSummaries([
    { label:'Drive', iso:'2026-10-19T14:00:00Z', ms:1792418400000, files:['DriveAroundMC-10-16251320260916042513.xlsx'] },
    { label:'Drive', iso:'2026-10-19T14:00:00Z', ms:1792418400000, files:['DriveAroundMC-10-10320620261019103206.xlsx'] }
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(Array.from(merged[0].files), ['DriveAroundMC-10-10320620261019103206.xlsx']);
});
