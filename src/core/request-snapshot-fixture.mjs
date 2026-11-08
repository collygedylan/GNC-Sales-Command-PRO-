import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readComposedAppSource } from '../../scripts/composed-app-source.mjs';

export function requestHarness() {
  const source = readComposedAppSource();
  const start = source.indexOf('async function fetchActiveRequestLiveRows(');
  const end = source.indexOf('\n        async function fetchSupabasePage(', start);
  assert.ok(start > 0 && end > start);
  const ctx = { AbortController, Object, Array, Error, window: {}, ACTIVE_REQUEST_TABLE: 'active',
    productionLiveSyncNavigation: { signal: new AbortController().signal }, owner: 'a',
    requestsInventory: [{ id: 'cached' }, { id: 'history', REQUEST_HISTORY: true }],
    getSupabaseReadIdentityScope() { return ctx.owner; }, buildActiveRequestLiveRowsQuery: () => '',
    fetchAllSupabaseRows: async () => { throw Object.assign(new Error('denied'), { status: 403 }); }
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  return ctx;
}

export function deferredRead(outcome) {
  let finish;
  const promise = new Promise((resolve, reject) => {
    finish = () => outcome === 'success' ? resolve([{ id: 'old' }]) : reject(new Error('denied'));
  });
  return { promise, finish: () => finish() };
}
