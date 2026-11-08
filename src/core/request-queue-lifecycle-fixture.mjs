import assert from 'node:assert/strict';
import vm from 'node:vm';

export function requestQueueLifecycleFixture(html) {
    const calls = [], warnings = [];
    const ctx = { Error, Object, String, Array, AbortController, owner: 'user-a',
        productionLiveSyncNavigation: new AbortController(), ACTIVE_REQUEST_TABLE: 'ph_active_request',
        window: { GncRuntimeWatchdog: { capture: error => warnings.push(error) } },
        requestsInventory: [{ unique_id: 'cached-request' }],
        buildActiveRequestLiveRowsQuery: fields => `select=${fields}`,
        getSupabaseReadIdentityScope: () => ctx.owner,
        transport: async () => [{ unique_id: 'isolated-request' }],
        fetchAllSupabaseRows: (table, query, options) => {
            calls.push({ table, query, options });
            return ctx.transport(table, query, options);
        }
    };
    vm.createContext(ctx);
    const from = html.indexOf('async function fetchActiveRequestLiveRows(');
    const to = html.indexOf('async function fetchSupabasePage(', from);
    assert.ok(from > 0 && to > from);
    vm.runInContext(html.slice(from, to), ctx);
    return { ctx, calls, warnings };
}

