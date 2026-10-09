import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
const source = scripts.find(script => script.includes('async function removeRequestQueueRow('));
const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
const names = ['removeRequestQueueRow', 'rebuildRequestInventoryIndexes', 'isRequestArchiveTerminalFailure'];
const code = ast.body.filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name))
  .map(node => source.slice(node.start, node.end)).join('\n');

function setup(options = {}) {
  const row = { UNIQUE_ID: 'req-1', MASTER_ID: 'master-1', COMMONNAME: 'Hosta', REQ_ARCHIVED: false,
    ROW_VERSION: 7, UPDATED_AT: '2026-10-09T15:00:00.123456+00:00' };
  const calls = [], notices = [];
  let scope = 'user-a';
  const context = vm.createContext({
    Set, Map, crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    requestsInventory: [row], requestsInventoryById: new Map(), requestsInventoryByMasterId: new Map(),
    requestQueueRemovalInFlight: new Set(), requestQueueRemovedByScope: new Map(),
    requestArchiveListState: { loaded: true }, APP_API_FUNCTION_URL: 'https://example.invalid/app-api',
    getSupabaseReadIdentityScope: () => scope, getItemUniqueId: item => item?.UNIQUE_ID || '',
    findRequestInventoryRowByUniqueId: () => row, canCurrentUserArchiveRequestRow: () => !options.denied,
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && value !== ''),
    showAppConfirm: async () => { if (options.confirmScopeChange) scope = 'user-b'; return options.confirm !== false; },
    showToast: (...args) => notices.push(args), closeAllRequestSwipes() {},
    triggerRequestRealtimeUiRefresh() {}, invalidateInventoryDomIdLookup() {},
    refreshRequestViewAfterArchive() {}, persistCurrentCache() {},
    rebuildInventoryByIdMap: rows => new Map(rows.map(item => [item.UNIQUE_ID, item])),
    createRequestArchiveError: payload => Object.assign(new Error(payload.error || 'invalid response'), { status: payload.status || 0 }),
    waitForRequestArchiveRetry: async () => {},
    postAppFunctionJson: async (_url, command) => {
      calls.push({ ...command });
      if (options.responseScopeChange) scope = 'user-b';
      if (options.failure) throw Object.assign(new Error('Not saved'), { status: options.failure });
      if (options.failOnce && calls.length === 1) throw new Error('Transient connection');
      return { ok: true, data: { uid: command.uid, state: 'removed', idempotencyKey: command.idempotencyKey, replayed: calls.length > 1 } };
    },
  });
  vm.runInContext(code, context);
  return { context, calls, notices, row, run: () => context.removeRequestQueueRow(row.UNIQUE_ID) };
}

test('successful removal deletes only the confirmed active row, without archiving or undo', async () => {
  const f = setup();
  await f.run();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].action, 'request_queue_remove');
  assert.equal(f.calls[0].expectedRowVersion, 7);
  assert.equal(f.calls[0].expectedUpdatedAt, f.row.UPDATED_AT);
  assert.equal(f.row.REQ_ARCHIVED, false);
  assert.equal(f.context.requestsInventory.length, 0);
  assert.equal(f.context.requestsInventoryById.size, 0);
  assert.equal(f.context.requestQueueRemovalInFlight.size, 0);
  assert.equal(f.notices.at(-1)[0], 'Removed');
  // A stale read cannot replace the confirmed deletion, but another row stays.
  f.context.requestsInventory = [f.row, { UNIQUE_ID: 'other', MASTER_ID: 'master-1' }];
  f.context.rebuildRequestInventoryIndexes();
  assert.deepEqual(Array.from(f.context.requestsInventory, row => row.UNIQUE_ID), ['other']);
});

test('retry uses the same revision and command key; terminal failures never hide the row', async () => {
  const retry = setup({ failOnce: true }); await retry.run();
  assert.equal(retry.calls.length, 2); assert.deepEqual(retry.calls[0], retry.calls[1]);
  for (const failure of [403, 404, 409, 503]) {
    const f = setup({ failure }); await f.run();
    assert.equal(f.calls.length, failure === 503 ? 3 : 1);
    assert.equal(f.context.requestsInventory.length, 1);
    assert.equal(f.context.requestQueueRemovedByScope.size, 0);
    assert.equal(f.notices.at(-1)[0], 'Removal Not Confirmed');
  }
});

test('denial, cancelled confirmation, missing revision and identity changes do not mutate current state', async () => {
  for (const options of [{ denied: true }, { confirm: false }, { confirmScopeChange: true }, { responseScopeChange: true }]) {
    const f = setup(options); await f.run();
    assert.equal(f.calls.length, options.responseScopeChange ? 1 : 0);
    assert.equal(f.context.requestsInventory.length, 1);
    assert.equal(f.context.requestQueueRemovedByScope.size, 0);
  }
  const f = setup(); delete f.row.ROW_VERSION; await f.run();
  assert.equal(f.calls.length, 0); assert.equal(f.notices.at(-1)[0], 'Refresh Required');
});

test('repeat gestures share a single in-flight confirmation and mutation', async () => {
  const f = setup(); await Promise.all([f.run(), f.run()]);
  assert.equal(f.calls.length, 1);
});
