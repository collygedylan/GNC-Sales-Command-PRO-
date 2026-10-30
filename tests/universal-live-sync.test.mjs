import { readComposedRuntimeSource } from '../scripts/composed-app-source.mjs';
// @test-group: sync
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const runtime = readComposedRuntimeSource();
const coordinatorSource = readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8');

function declaration(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} declaration exists`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.ok(end > start, `${name} boundary exists`);
  return source.slice(start, end);
}

test('universal row patches keep an aliased active detail draft from restoring stale cache fields', () => {
  const patcher = declaration(runtime, 'applyUniversalLiveSyncPatch', 'getProductionLiveSyncCoordinator');
  const tables = declaration(runtime, 'getUniversalLiveSyncTables', 'applyUniversalLiveSyncPatch');
  const cached = { unique_id: 'm-1', ptravailable: 10, av_note: 'old cache', spec: 'unsaved draft' };
  const context = {
    ACTIVE_REQUEST_TABLE: 'ph_requests_pending', REQUEST_HISTORY_TABLE: 'ph_requests_completed_history',
    WAREHOUSE_ASSIGNED_ITEMS_TABLE: 'ph_warehouse_assigned_items', fullInventory: [cached], activeItem: cached,
    cartPanelOpen: false, getCurrentVisibleViewId: () => 'detail', captureProductionRefreshAnchor: () => ({ top: 42 }),
    hasProductionLiveSyncDraft: () => true, hasActiveTextEntryFocus: () => false,
    applyRealtimeChange: (_table, payload) => { Object.assign(context.fullInventory[0], payload.new); return true; },
    flushRealtimeDatasetUpdates: () => {}, rebuildMasterInventoryIndexes: () => {}, markViewDirty: () => {},
    isViewVisible: () => false, scheduleDocksRender: () => {}, updateGlobalActionBar: () => {},
    restoreProductionRefreshAnchor: anchor => { context.restoredAnchor = anchor; },
    scheduleProductionLiveSyncRender: () => {}
  };
  vm.runInNewContext(`${tables}\n${patcher}\nglobalThis.patchRow = applyUniversalLiveSyncPatch;`, context);
  assert.equal(context.patchRow('ph_master_inventory', { eventType: 'UPDATE', new: { ptravailable: 8, av_note: 'server value' } }), true);
  assert.equal(context.fullInventory[0].ptravailable, 8);
  assert.equal(context.fullInventory[0].av_note, 'server value', 'draft restoration must not overwrite the authoritative cache');
  assert.equal(context.activeItem.av_note, 'old cache', 'the open draft retains its pre-patch object values');
  assert.equal(context.activeItem.spec, 'unsaved draft');
  assert.notEqual(context.activeItem, context.fullInventory[0], 'the edited detail object is isolated from the cache row');
  assert.equal(context.restoredAnchor.top, 42, 'scroll anchor is restored after synchronous patching');
});

test('universal live-sync subscribes to base relations and consumes bounded row patches plus metadata wake hints', () => {
  const tables = declaration(runtime, 'getUniversalLiveSyncTables', 'applyUniversalLiveSyncPatch');
  const context = {
    ACTIVE_REQUEST_TABLE: 'ph_requests_pending', REQUEST_HISTORY_TABLE: 'ph_requests_completed_history',
    WAREHOUSE_ASSIGNED_ITEMS_TABLE: 'ph_inventory_row_assignments'
  };
  vm.runInNewContext(`${tables}\nglobalThis.tables = getUniversalLiveSyncTables();`, context);
  assert.deepEqual(Array.from(context.tables), [
    'ph_master_inventory', 'ph_location_sales_notes', 'ph_soc_master', 'ph_requests_pending',
    'ph_requests_completed_history', 'ph_reserves', 'ph_inventory_row_assignments', 'ph_warehouse_assigned_items'
  ]);
  const eventStart = runtime.indexOf(".on('broadcast', { event: 'dataset_change' }");
  const rowPatchStart = runtime.indexOf(".on('broadcast', { event: 'row_patch' }");
  const subscription = runtime.slice(eventStart, rowPatchStart > eventStart ? rowPatchStart : runtime.indexOf(".on('postgres_changes'", eventStart));
  assert.match(subscription, /changed\(\{ new: \{ key: String\(payload\?\.key \|\| ''\) \} \}\)/);
  assert.doesNotMatch(subscription, /payload\?\.(?:new|old|row|record)|eventType/);
  assert.match(runtime, /\.on\('broadcast', \{ event: 'row_patch' \}/,
    'the bounded server row-patch channel is consumed alongside RLS Postgres Changes');
  assert.ok(runtime.includes(".on('postgres_changes', { event: '*', schema: 'public', table: 'app_dataset_revisions' }"));
  assert.match(runtime, /getUniversalLiveSyncTables\(\)\.forEach\(table => channel\.on\('postgres_changes'/);
});

test('production subscription applies RLS row events only for the current owner and disposes listeners', async () => {
  const tables = declaration(runtime, 'getUniversalLiveSyncTables', 'applyUniversalLiveSyncPatch');
  const coordinatorFn = declaration(runtime, 'getProductionLiveSyncCoordinator', 'beginProductionVerifiedNavigation');
  assert.doesNotMatch(coordinatorFn, /channel\.send\(/, 'clients never publish authoritative row payloads');
  let options, owner = 'actor:epoch-1', removed = 0, patchCount = 0;
  const handlers = [], added = [], deleted = [], signals = [];
  const channel = {
    on: (kind, filter, callback) => { handlers.push({ kind, filter, callback }); return channel; },
    subscribe: callback => { channel.onState = callback; }
  };
  const ctx = {
    ACTIVE_REQUEST_TABLE: 'ph_requests_pending', REQUEST_HISTORY_TABLE: 'ph_requests_completed_history',
    WAREHOUSE_ASSIGNED_ITEMS_TABLE: 'ph_inventory_row_assignments',
    productionLiveSyncCoordinator: null,
    canUseProductionLiveSync: () => true,
    hasActiveManualSync: () => false,
    isTouchConstrainedDevice: () => false,
    getSupabaseBrowserClient: () => ctx.client,
    getInventoryStatusSync: () => ctx.statusSync, isRowPatchSourceReady: () => true,
    readProductionDisplaySnapshot: () => null, previewProductionSnapshots: () => {},
    retainAppliedProductionDisplay: () => {}, writeProductionVerifiedSnapshot: () => {},
    getCurrentVisibleViewId: () => 'docks',
    productionLiveSyncReadGeneration: 0, productionLiveSyncReadPermissionVersion: '',
    abortSupabaseReadsBeforeGeneration: () => {}, getProductionLiveSyncContext: () => ({ scope: owner, visible: true, online: true, adapters: [] }),
    updateProductionLiveSyncProofFromStatus: () => true,
    window: {
      AgMetricLiveSync: { createCoordinator: value => { options = value; return { signal: (...args) => signals.push(args) }; } },
      AgMetricLifecycle: { createScope: () => ({ timeout: () => () => {}, dispose: () => {} }) },
      addEventListener: (...args) => added.push(args), removeEventListener: (...args) => deleted.push(args)
    },
    document: { hidden: false, addEventListener: (...args) => added.push(args), removeEventListener: (...args) => deleted.push(args) },
    client: { channel: () => channel, removeChannel: async () => { removed++; } },
    getProductionRealtimeOwnerKey: () => owner, getSupabaseReadIdentityScope: () => owner,
    getProductionLiveSyncContext: () => ({ scope: owner, visible: true, online: true, adapters: [] }),
    readProductionVerifiedSnapshot: () => null,
    statusSync: { setSourceReady: () => {}, resume: () => {}, suspend: () => {}, handleUpdate: () => {} },
    ROW_SYNC_EVENT_NAME: 'agdata:row-sync', getUniversalLiveSyncTables: () => ctx.getTables(),
    getTables: () => ['ph_master_inventory', 'ph_location_sales_notes', 'ph_soc_master', 'ph_requests_pending',
      'ph_requests_completed_history', 'ph_reserves', 'ph_inventory_row_assignments', 'ph_warehouse_assigned_items'],
    applyUniversalLiveSyncPatch: () => { patchCount++; return true; },
    changed: () => {}, recordDatasetRevisionConnection: () => {},
    withProductionLiveSyncSignal: (_options, callback) => callback(new AbortController().signal),
    productionLiveSyncCoordinator: null
  };
  vm.runInNewContext(`${tables}\n${coordinatorFn}\nglobalThis.create = getProductionLiveSyncCoordinator;`, ctx);
  ctx.create();
  const changedEvents = [];
  const unsubscribe = await options.subscribe(payload => changedEvents.push(payload), () => {});
  channel.onState('SUBSCRIBED');
  const broadcast = handlers.find(item => item.kind === 'broadcast').callback;
  const rowPatch = handlers.find(item => item.kind === 'broadcast' && item.filter?.event === 'row_patch').callback;
  const revision = handlers.find(item => item.filter?.table === 'app_dataset_revisions').callback;
  const inventory = handlers.find(item => item.filter?.table === 'ph_master_inventory').callback;
  broadcast({ payload: { key: 'ph_master_inventory', rows: [{ secret: 'untrusted' }] } });
  assert.deepEqual(JSON.parse(JSON.stringify(changedEvents)), [{ new: { key: 'ph_master_inventory' } }], 'revision hints wake the coordinator with metadata only');
  changedEvents.length = 0;
  revision({ new: { key: 'ph_master_inventory', state: 'importing' } });
  rowPatch({ payload: { table: 'ph_master_inventory', eventType: 'UPDATE', rows: [{ unique_id: 'not-ready' }] } });
  assert.equal(patchCount, 0, 'a non-READY source is fenced from applying a Broadcast row');
  revision({ new: { key: 'ph_master_inventory', state: 'ready' } });
  rowPatch({ payload: { table: 'ph_master_inventory', eventType: 'UPDATE', rows: [{ unique_id: 'authorized-row' }] } });
  rowPatch({ payload: { table: 'not-allowlisted', eventType: 'UPDATE', rows: [{ unique_id: 'foreign-table' }] } });
  rowPatch({ payload: { table: 'ph_master_inventory', eventType: 'UPDATE', rows: Array.from({ length: 17 }, () => ({ unique_id: 'oversize' })) } });
  assert.equal(patchCount, 1, 'only bounded, allowlisted rows from READY sources are applied');
  owner = 'other-account:epoch-2';
  rowPatch({ payload: { table: 'ph_master_inventory', eventType: 'UPDATE', rows: [{ unique_id: 'stale-owner-row' }] } });
  inventory({ eventType: 'UPDATE', new: { unique_id: 'stale-owner-row' } });
  assert.equal(patchCount, 1, 'the old owner cannot repaint after an account switch');
  await unsubscribe();
  assert.equal(removed, 1);
  assert.equal(deleted.length, added.length, 'all installed event listeners are removed');
});

test('metadata subscription wake schedules a zero-delay check and reset disposes the channel', async () => {
  const sandbox = { module: { exports: {} }, setTimeout, clearTimeout, AbortController };
  vm.runInNewContext(coordinatorSource, sandbox);
  const { createCoordinator } = sandbox.module.exports;
  const scheduled = [];
  let wake;
  let unsubscribed = 0;
  const context = { scope: 'acct:epoch-1', readIdentity: 'acct:epoch-1', viewKey: 'docks', visible: true, online: true,
    authenticated: true, accessDenied: false,
    adapters: [{ id: 'core:soc', cacheKey: 'soc/all', sourceKeys: ['ph_soc_master'], stage: async () => [], commit: () => {} }] };
  const coordinator = createCoordinator({
    getContext: () => context,
    readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'p1', sources: keys.map(key => ({ key, revision: '1', state: 'ready' })) }),
    subscribe: callback => { wake = callback; return () => { unsubscribed++; }; },
    setTimeout: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; },
    clearTimeout: () => {}, now: () => 1000
  });
  await coordinator.check();
  scheduled.length = 0;
  wake({ new: { key: 'ph_soc_master' } });
  assert.equal(scheduled[0]?.delay, 0, 'revision notifications wake the coordinator immediately');
  coordinator.reset();
  assert.equal(unsubscribed, 1, 'reset closes the active subscription');
});
