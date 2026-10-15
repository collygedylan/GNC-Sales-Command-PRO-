// @test-group: foundation
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { databaseBridge } from './helpers/database-bridge.mjs';
import vm from 'node:vm';

const require = createRequire(new URL('../package.json', import.meta.url));
const built = buildSync({ entryPoints: ['services/requestArchivePages.ts'], bundle: true,
  platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(require, module, module.exports);
const { createRequestArchivePagesService } = module.exports;
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(source, name, nextName) {
  const syncStart = source.indexOf(`function ${name}(`);
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 && (syncStart < 0 || asyncStart < syncStart) ? asyncStart : syncStart;
  assert.ok(start >= 0, `${name} exists`);
  const end = source.indexOf(nextName, start);
  assert.ok(end > start, `${name} boundary exists`);
  return source.slice(start, end);
}

function page(offset, rows = [], total = rows.length, limit = 100) {
  return { offset, limit, total, hasMore: offset + rows.length < total, rows };
}

test('archive pages cache by identity, offset, and limit and replace stale content after refresh', async () => {
  const responses = [page(0, [{ unique_id: 'a', commonname: 'Old name' }], 101),
    page(0, [{ unique_id: 'a', commonname: 'Updated name' }], 101)];
  const calls = [];
  const service = createRequestArchivePagesService(async (input) => {
    calls.push(input);
    return responses.shift();
  });

  const first = await service.read('profile:a|permission:1', 0, 100);
  assert.deepEqual(service.peek('profile:a|permission:1', 0, 100), first);
  assert.equal(first.rows[0].commonname, 'Old name');
  assert.equal(service.peek('profile:b|permission:1', 0, 100), null);
  assert.equal(service.peek('profile:a|permission:2', 0, 100), null);
  assert.equal(service.peek('profile:a|permission:1', 100, 100), null);

  const refreshed = await service.read('profile:a|permission:1', 0, 100);
  assert.equal(refreshed.rows[0].commonname, 'Updated name');
  assert.deepEqual(service.peek('profile:a|permission:1', 0, 100), refreshed);
  assert.equal(calls.length, 2);
});

test('archive page reader validates offset and metadata before caching', async () => {
  const service = createRequestArchivePagesService(async () => page(100, [{ unique_id: 'wrong-page' }], 200));
  await assert.rejects(service.read('profile:a', 0, 100), /offset/i);
  assert.equal(service.peek('profile:a', 0, 100), null);
});

test('archive cache invalidation supports one page, one identity, and complete reset', async () => {
  const service = createRequestArchivePagesService(async ({ offset }) => page(offset, [{ unique_id: String(offset) }], 201));
  await service.read('profile:a', 0, 100);
  await service.read('profile:a', 100, 100);
  await service.read('profile:b', 0, 100);

  service.invalidate('profile:a', 100, 100);
  assert.ok(service.peek('profile:a', 0, 100));
  assert.equal(service.peek('profile:a', 100, 100), null);
  assert.ok(service.peek('profile:b', 0, 100));

  service.invalidate('profile:a');
  assert.equal(service.peek('profile:a', 0, 100), null);
  assert.ok(service.peek('profile:b', 0, 100));
  service.clear();
  assert.equal(service.peek('profile:b', 0, 100), null);
});

test('archive page cache is bounded and honors cancellation without caching late results', async () => {
  let resolveRead;
  const service = createRequestArchivePagesService(() => new Promise(resolve => { resolveRead = resolve; }), { maxEntries: 1 });
  const controller = new AbortController();
  const pending = service.read('profile:a', 0, 100, controller.signal);
  controller.abort();
  resolveRead(page(0, [{ unique_id: 'late' }]));
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(service.peek('profile:a', 0, 100), null);

  const filled = createRequestArchivePagesService(async ({ offset }) => page(offset, [{ unique_id: String(offset) }]), { maxEntries: 1 });
  await filled.read('profile:a', 0, 100);
  await filled.read('profile:a', 100, 100);
  assert.equal(filled.peek('profile:a', 0, 100), null);
  assert.ok(filled.peek('profile:a', 100, 100));
});

test('legacy database bridge exposes the archive page service without owning app rendering', async () => {
  const bridge = databaseBridge(async () => { throw new Error('The injected page reader owns transport.'); });
  const pages = bridge.createRequestArchivePagesService(async () => page(0, [{ unique_id: 'bridge-row' }]));
  const loaded = await pages.read('profile:bridge', 0, 100);
  assert.equal(loaded.rows[0].unique_id, 'bridge-row');
});

test('archive rendering keeps card identity signature stable during refresh and changes it for same-ID content edits', () => {
  const context = vm.createContext({
    Number, String, JSON, Math,
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
  });
  vm.runInContext([
    extractFunction(html, 'renderRequestArchivePageHtml', 'function buildRequestArchivePageRenderSignature('),
    extractFunction(html, 'buildRequestArchivePageRenderSignature', 'function syncRequestArchiveStatus('),
    extractFunction(html, 'syncRequestArchiveStatus', 'function getRequestArchiveClampedPageOffset('),
  ].join('\n'), context);
  const row = { UNIQUE_ID: 'arch-1', COMMONNAME: 'Hosta', CONTSIZE: '1 gal', LOCATIONCODE: 'A1', REQ_QTY: '2' };
  const state = { rows: [row], total: 101, offset: 0, limit: 100, hasMore: true, loading: false, refreshing: false, error: '' };
  const signature = context.buildRequestArchivePageRenderSignature(state);
  const markup = context.renderRequestArchivePageHtml(state);
  assert.match(markup, /id="request-archive-page-list"/);
  assert.match(markup, /id="request-archive-page-pager"/);
  assert.match(markup, /Next/);
  const status = { dataset: {}, innerHTML: '' };
  const list = { marker: 'the current card nodes stay mounted' };
  const container = { querySelector: selector => selector === '#request-archive-status' ? status : null, list };
  state.loading = true; state.refreshing = true;
  assert.equal(context.buildRequestArchivePageRenderSignature(state), signature, 'loading metadata does not force card replacement');
  context.syncRequestArchiveStatus(container, state);
  assert.match(status.innerHTML, /Refreshing archived request rows/);
  assert.equal(container.list, list);
  state.loading = false; state.refreshing = false; state.error = 'Temporary network failure';
  context.syncRequestArchiveStatus(container, state);
  assert.match(status.innerHTML, /role="alert"/);
  assert.match(status.innerHTML, /Retry/);
  assert.equal(container.list, list, 'error presentation updates independently of the cached cards');
  assert.notEqual(context.buildRequestArchivePageRenderSignature({ ...state, rows: [{ ...row, COMMONNAME: 'New hosta name' }] }), signature,
    'same-ID visible content changes invalidate card markup');
});

test('archive refresh errors retain the current page rows and offset for retry', async () => {
  const scopeKey = JSON.stringify(['account-a', 'rep-a', 'REP', 'permission-1', 'archive:allowed']);
  const state = { rows: [{ UNIQUE_ID: 'arch-1', COMMONNAME: 'Hosta' }], total: 101, offset: 0, limit: 100,
    hasMore: true, loading: false, refreshing: false, error: '', loaded: true, scopeKey, controller: null };
  let rejectRead;
  const events = [];
  const context = vm.createContext({
    Number, String, Math, JSON, AbortController, Promise,
    requestArchiveListState: state,
    requestArchivePagesService: { clear() {}, peek: () => null, invalidate() {}, read: () => new Promise((_resolve, reject) => { rejectRead = reject; }) },
    canCurrentUserArchiveRequestRows: () => true,
    getSupabaseReadIdentityScope: () => 'account-a',
    currentUser: 'rep-a', currentRole: 'REP', safeRole: 'REP',
    getProductionLiveSyncContext: () => ({ dataPermissionVersion: 'permission-1' }),
    resetRequestArchivePageState: () => {},
    isViewVisible: () => true, activeReqTab: 'archived',
    renderRequest: () => events.push('render'),
    normalizeArchivedRequestRow: row => row,
    updateFooterRequestBadge: () => events.push('badge'),
    getRequestArchivePagesService: () => context.requestArchivePagesService,
  });
  vm.runInContext(extractFunction(html, 'getRequestArchivePageScopeKey', 'function getRequestArchivePagesService(')
    + extractFunction(html, 'loadRequestArchivePage', 'function clearPendingRequestArchiveFlushTimer('), context);

  const pending = context.loadRequestArchivePage(0, true);
  assert.equal(context.requestArchiveListState.rows[0].UNIQUE_ID, 'arch-1');
  assert.equal(context.requestArchiveListState.offset, 0);
  assert.equal(context.requestArchiveListState.loading, true);
  assert.equal(context.requestArchiveListState.refreshing, true);
  rejectRead(new Error('Temporary network failure'));
  assert.equal(await pending, false);
  assert.equal(context.requestArchiveListState.rows[0].UNIQUE_ID, 'arch-1');
  assert.equal(context.requestArchiveListState.offset, 0);
  assert.equal(context.requestArchiveListState.loaded, true);
  assert.equal(context.requestArchiveListState.error, 'Temporary network failure');
  assert.ok(events.includes('render'));
  assert.equal(events.includes('badge'), false);
});
