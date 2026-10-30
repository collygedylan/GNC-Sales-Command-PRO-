import { readComposedRuntimeSource } from '../scripts/composed-app-source.mjs';
// @test-group: requests
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readComposedRuntimeSource();

function functionSource(name, nextName) {
  const start = source.indexOf(`        function ${name}(`);
  const end = source.indexOf(`        function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} source`);
  return source.slice(start, end);
}

const liveRows = JSON.parse(readFileSync(new URL('./fixtures/ph-active-suspend-v2375.json', import.meta.url), 'utf8'));

test('all 17 active ph_active_suspend rows survive recognition and active filtering', () => {
  const context = vm.createContext({
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && String(value) !== '') || '',
    getDockSuspendValue: row => String(row?.suspend || row?.SUSPEND || '').trim().toUpperCase(),
    getDockSuspendToValue: row => String(row?.suspend_to || row?.suspendto || '').trim().toLowerCase(),
    getSuspendTagStatus: row => String(row?.status || 'Pending').toLowerCase(),
    isOptimisticallyCompletedRow: () => false
  });
  vm.runInContext(functionSource('isDockSuspendDcRequestSource', 'isDockSuspendDcRequestMirrorRow'), context);
  vm.runInContext(functionSource('isDockSuspendDcRequestMirrorRow', 'getDockSuspendDcRequestSourceUid'), context);
  vm.runInContext(functionSource('getSuspendTagRequestItems', 'countPendingSuspendTagQueueItems'), context);
  const visible = context.getSuspendTagRequestItems(liveRows, 'active');
  assert.equal(visible.length, 17);
  assert.ok(visible.every(row => context.isDockSuspendDcRequestMirrorRow(row)));
});

test('Suspend render plan keeps all 17 rows instead of a five-card mobile page', () => {
  assert.match(source, /const plan = \{[^]*rows: filteredItems,[^]*footerMarkup: ''/);
  assert.doesNotMatch(functionSource('buildSuspendTagRenderPlan', 'getRequestSuspendTagSearchInputState'), /buildRequestPagedRenderPlan/);
});

test('v2.3.75 view owns active eligibility and required browser aliases', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261026210000_agdata_v2375_suspend_17_cards_and_fast_batch_sync.sql', import.meta.url), 'utf8');
  assert.match(migration, /ph_active_suspend with \(security_invoker=true\)/);
  assert.match(migration, /'Pending'::text as status/);
  assert.match(migration, /'suspend_tag'::text as request_type/);
  assert.match(migration, /true as is_suspend_tag/);
  assert.match(migration, /coalesce\(nullif\(btrim\(soc\.dock::text\),''\),'Unassigned'\)/);
  assert.match(migration, /lower\(btrim\(coalesce\(soc\.suspend_to,''\)\)\)='dc'/);
});
