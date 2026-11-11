import assert from 'node:assert/strict';
import vm from 'node:vm';

export function createDashboardMetadataFixture(html) {
    const calls = [];
    const ctx = { Error, Object, String, Number, Array, Set, Map, Math, JSON, Promise, Date, encodeURIComponent, AbortController,
        currentUser: 'metadata-user-a', owner: 'metadata-scope-a', allowed: true,
        nativeAuthProfile: { id: 'metadata-native-a' }, window: {}, revisionReads: 0,
        supabaseRpc: async () => {
            ctx.revisionReads++;
            return { contractVersion: 1, sources: [{ key: 'ph_master_inventory', state: 'ready',
                revision: 2, sourceFileName: 'current-drive.xlsx', sourceImportedAt: '2026-11-10T20:07:13Z' }] };
        },
        appAccessSnapshotState: { status: 'ready', stale: false, snapshot: { dataPermissionVersion: 'metadata-permission-a' } },
        coordinatorOwnsMetadata: false, coordinatorSignals: [],
        navigator: { onLine: true }, document: { hidden: false },
        productionLiveSyncNavigation: new AbortController(),
        DASHBOARD_SYNC_METADATA_LIMIT: 30, DASHBOARD_SYNC_METADATA_TTL_MS: 60000, SUPABASE_READ_TIMEOUT_MS: 1000,
        canViewDashboardSyncStatus: () => ctx.allowed,
        canUseProductionLiveSync: () => ctx.coordinatorOwnsMetadata,
        getCurrentVisibleViewId: () => ctx.coordinatorOwnsMetadata ? 'home' : 'legacy',
        getProductionLiveSyncContext: () => ({ surfaces: ctx.coordinatorOwnsMetadata ? ['home:sync-metadata'] : [], adapters: ctx.coordinatorOwnsMetadata ? [{ id: 'side:homeSyncMetadata' }] : [] }),
        signalProductionLiveSync: (...args) => { ctx.coordinatorSignals.push(args); },
        getSupabaseReadIdentityScope: () => ctx.owner,
        firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') || '',
        getValidIsoTimestamp: value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '',
        formatFetchedRows: rows => rows,
        yieldToUiFrame: async () => {}, commits: 0,
        updateDashboardSyncSummary: () => { ctx.commits++; },
        runDedupeSupabaseRead: async (_key, task, options = {}) => task({ signal: options.signal }),
        transport: async table => ({ rows: [{ filename: `${ctx.owner}-${table}.csv`, last_updated: '2026-09-12T12:00:00Z' }] }),
        fetchAuthenticatedSupabaseReadPage: (table, query, options) => {
            calls.push({ table, query, options, owner: ctx.owner });
            return ctx.transport(table, query, options);
        }
    };
    vm.createContext(ctx);
    const stateStart = html.indexOf('let dashboardSyncMetadataSummaries =');
    const stateEnd = html.indexOf('let pendingRequestArchiveFlushTimer', stateStart);
    const signalStart = html.indexOf('async function withProductionLiveSyncSignal(');
    const metadataStart = html.indexOf('function dashboardFilenameTimestamp(');
    const metadataEnd = html.indexOf('function updateDashboardSyncSummary()', metadataStart);
    assert.ok(stateStart > 0 && stateEnd > stateStart && metadataEnd > metadataStart);
    vm.runInContext(html.slice(stateStart, stateEnd)
        + html.slice(signalStart, html.indexOf('function ', signalStart + 15)).trim()
        + html.slice(metadataStart, metadataEnd)
        + '\nthis.metadataState = () => ({ summaries: dashboardSyncMetadataSummaries, fetchedAt: dashboardSyncMetadataFetchedAt, pending: dashboardSyncMetadataInFlight });', ctx);
    return { ctx, calls };
}
