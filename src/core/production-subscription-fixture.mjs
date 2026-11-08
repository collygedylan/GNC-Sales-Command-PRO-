import vm from 'node:vm';

export function createProductionSubscriptionFixture(tables, coordinatorFn) {
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
    abortSupabaseReadsBeforeGeneration: () => {},
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
  };
  ctx.supabaseClient = ctx.client;
  vm.runInNewContext(`${tables}\n${coordinatorFn}\nglobalThis.create = getProductionLiveSyncCoordinator;`, ctx);
  ctx.create();
  return { ctx, handlers, added, deleted, channel, get options() { return options; }, get patchCount() { return patchCount; },
    get removed() { return removed; }, set owner(value) { owner = value; } };
}
