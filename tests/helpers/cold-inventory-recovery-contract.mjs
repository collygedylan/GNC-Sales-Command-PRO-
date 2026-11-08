import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fetchInventoryPreviewWithRetry } from '../../src/core/inventory-hydration-recovery.js';

export async function verifyColdInventoryPreviewRecovery(recoverySource) {
  for (const [view, user] of [['drive', 'dylan_collyge'], ['drive', 'brian_hatfield'], ['av', 'brian_hatfield']]) {
    let requests = 0, previews = 0, continued = 0, fullHydrations = 0;
    const load = {};
    const scope = { signal: new AbortController().signal, isCurrent: () => true, dispose() {} };
    const ctx = { authenticated: true, accessDenied: false, visible: true, dataPermissionVersion: 'p1',
      adapters: [{ id: 'core:master' }] };
    const context = vm.createContext({ productionLiveSyncViewLoad: load,
      GncInventoryHydrationRecovery: { fetchInventoryPreviewWithRetry,
        ensureCompleteMasterInventorySnapshot: async () => { fullHydrations++; return true; } },
      window: { AgMetricLifecycle: { createScope: () => scope } }, APP_API_FUNCTION_URL: '/app-api',
      getCurrentVisibleViewId: () => view, getSupabaseReadIdentityScope: () => user,
      getProductionLiveSyncContext: () => ctx, hasProgressiveViewData: () => false,
      getProductionCoreLiveProjection: () => view === 'av' ? 'full' : 'browse',
      fetchDirectMasterInventoryPage: async (params, limit) => {
        requests++;
        assert.equal(params.dataset, 'master');
        assert.equal(limit, 200);
        if (requests === 1) throw Object.assign(new Error('Temporary unavailable'), { status: 503 });
        return { rows: [{ unique_id: 'authorized' }] };
      },
      isSupabaseReadRetryable: error => error.status === 503, validateInventoryReadProjection() {},
      prepareProductionMasterSnapshot: async rows => ({ payload: { data: rows }, rowCount: rows.length }),
      previewProductionSnapshots: snapshots => { previews++; assert.equal(snapshots[0].value.rowCompleteness, 'partial'); },
      getProductionLiveSyncCoordinator: () => ({ signal: () => continued++ }),
      showAvReadUnavailableState: error => assert.fail(error.message)
    });
    vm.runInContext(recoverySource, context);
    const started = performance.now();
    await context.recoverColdInventoryView(view, load);
    assert.ok(performance.now() - started < 2500);
    assert.deepEqual([requests, previews, continued, fullHydrations], [2, 1, 1, 1]);
    await context.recoverColdInventoryView(view, load);
    assert.deepEqual([requests, fullHydrations], [2, 1], 'one bounded recovery per view load');
  }
}
