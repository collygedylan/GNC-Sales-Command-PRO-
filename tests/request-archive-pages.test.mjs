import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: foundation
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { databaseBridge } from './helpers/database-bridge.mjs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const require = createRequire(new URL('../package.json', import.meta.url));
const built = buildSync({ entryPoints: ['services/requestArchivePages.ts'], bundle: true,
  platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(require, module, module.exports);
const { createRequestArchivePagesService } = module.exports;
const html = readComposedAppSource();

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

test('archive cache preserves the server page metadata and rejects a late read after invalidation', async () => {
  let resolveRead;
  const service = createRequestArchivePagesService(() => new Promise(resolve => { resolveRead = resolve; }));
  const controller = new AbortController();
  const pending = service.read('profile:a', 50, 50, controller.signal);
  service.invalidate('profile:a', 50, 50);
  resolveRead({ offset: 50, limit: 50, total: 123, hasMore: true, rows: [{ unique_id: 'page-2' }] });
  await assert.rejects(pending, error => error.name === 'StaleArchivePageError');
  assert.equal(service.peek('profile:a', 50, 50), null);

  const metadataService = createRequestArchivePagesService(async () => ({
    offset: 50, limit: 50, total: 123, hasMore: true, rows: [{ unique_id: 'page-2' }],
  }));
  assert.deepEqual(await metadataService.read('profile:a', 50, 50), {
    offset: 50, limit: 50, total: 123, hasMore: true, rows: [{ unique_id: 'page-2' }],
  });
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

test('archived page refresh and failure keep the existing card DOM mounted while status and retry update', () => {
  const dom = new JSDOM('<main id="request-content"></main><div id="request-crumb"></div>');
  const context = vm.createContext({
    Number, String, JSON, Math, document: dom.window.document, window: dom.window,
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    isIosPhoneRequestFlowView: () => false,
    scheduleStickyRailOffsetSync: () => {},
    incrementInternalPerfCounter: () => {},
    getContainerRenderSignature: container => container.dataset.renderSignature || '',
    setContainerHtmlWithSignature: (container, markup, signature) => {
      if (container.dataset.renderSignature === signature) return false;
      container.innerHTML = markup;
      container.dataset.renderSignature = signature;
      return true;
    },
  });
  vm.runInContext([
    extractFunction(html, 'renderRequestArchivePageHtml', 'function buildRequestArchivePageRenderSignature('),
    extractFunction(html, 'buildRequestArchivePageRenderSignature', 'function syncRequestArchiveStatus('),
    extractFunction(html, 'syncRequestArchiveStatus', 'function getRequestArchiveClampedPageOffset('),
    extractFunction(html, 'syncRequestCrumb', 'function applyRequestRenderMarkup('),
    extractFunction(html, 'applyRequestRenderMarkup', 'function renderRequestQueueFallbackCard('),
  ].join('\n'), context);

  const state = { rows: [{ UNIQUE_ID: 'a-1', COMMONNAME: 'Hosta', CONTSIZE: '1 gal', LOCATIONCODE: 'A1' }],
    total: 101, offset: 0, limit: 100, hasMore: true, loading: false, refreshing: false, error: '' };
  const container = dom.window.document.getElementById('request-content');
  const crumb = dom.window.document.getElementById('request-crumb');
  const render = () => {
    const markup = context.renderRequestArchivePageHtml(state);
    context.applyRequestRenderMarkup(container, crumb, 'Archived Requests', markup,
      context.buildRequestArchivePageRenderSignature(state));
    context.syncRequestArchiveStatus(container, state);
  };
  render();
  const originalCard = container.querySelector('.request-archive-card');
  const originalPager = container.querySelector('#request-archive-page-pager');
  assert.ok(originalCard);
  assert.match(originalPager.textContent, /1 \/ 2 · 101 rows/);

  state.loading = true; state.refreshing = true;
  render();
  assert.equal(container.querySelector('.request-archive-card'), originalCard, 'refresh keeps the row node mounted');
  assert.equal(container.querySelector('#request-archive-page-pager'), originalPager, 'refresh keeps pager nodes mounted');
  assert.match(container.querySelector('#request-archive-status').textContent, /Refreshing/);
  assert.doesNotMatch(container.querySelector('#request-archive-page-list').textContent, /Loading archived/);

  state.loading = false; state.refreshing = false; state.error = 'Temporary failure';
  render();
  assert.equal(container.querySelector('.request-archive-card'), originalCard, 'failure preserves the stale card');
  assert.equal(container.querySelector('#request-archive-page-pager'), originalPager);
  assert.match(container.querySelector('#request-archive-status').textContent, /Temporary failure/);
  assert.ok(container.querySelector('#request-archive-status button[onclick*="loadRequestArchivePage(0, true)"]'));

  state.error = ''; state.rows = [{ ...state.rows[0], COMMONNAME: 'Updated Hosta' }];
  render();
  assert.notEqual(container.querySelector('.request-archive-card'), originalCard, 'same-ID server content updates the card DOM');
  assert.match(container.querySelector('.request-archive-card').textContent, /Updated Hosta/);
  dom.window.close();
});

test('archive scope key changes with account, data permission revision, role, and archive authorization', () => {
  let identity = 'account-a';
  let role = 'REP';
  let permissionRevision = 'permission-1';
  let allowed = true;
  const context = vm.createContext({
    String, JSON,
    getSupabaseReadIdentityScope: () => identity,
    currentUser: 'rep-a', get currentRole() { return role; }, safeRole: 'REP',
    getProductionLiveSyncContext: () => ({ dataPermissionVersion: permissionRevision }),
    canCurrentUserArchiveRequestRows: () => allowed,
  });
  vm.runInContext(extractFunction(html, 'getRequestArchivePageScopeKey', 'function getRequestArchivePagesService('), context);
  const initial = context.getRequestArchivePageScopeKey();
  identity = 'account-b'; assert.notEqual(context.getRequestArchivePageScopeKey(), initial);
  identity = 'account-a'; permissionRevision = 'permission-2'; assert.notEqual(context.getRequestArchivePageScopeKey(), initial);
  permissionRevision = 'permission-1'; role = 'MANAGER'; assert.notEqual(context.getRequestArchivePageScopeKey(), initial);
  role = 'REP'; allowed = false; assert.notEqual(context.getRequestArchivePageScopeKey(), initial);
});

test('archive refresh errors retain the current page rows and offset for retry', async () => {
  const scopeKey = JSON.stringify(['account-a', 'rep-a', 'REP', 'permission-1', 'archive:allowed']);
  const state = { rows: [{ UNIQUE_ID: 'arch-1', COMMONNAME: 'Hosta' }], total: 101, offset: 0, limit: 100,
    hasMore: true, loading: false, refreshing: false, error: '', loaded: true, scopeKey, controller: null };
  const reads = [];
  const events = [];
  const context = vm.createContext({
    Number, String, Math, JSON, AbortController, Promise,
    requestArchiveListState: state,
    requestArchivePagesService: { clear() {}, peek: () => null, invalidate() {}, read: () => new Promise((resolve, reject) => { reads.push({ resolve, reject }); }) },
    canCurrentUserArchiveRequestRows: () => true,
    getSupabaseReadIdentityScope: () => 'account-a',
    currentUser: 'rep-a', currentRole: 'REP', safeRole: 'REP',
    getProductionLiveSyncContext: () => ({ dataPermissionVersion: 'permission-1' }),
    resetRequestArchivePageState: () => {},
    isViewVisible: () => true, activeReqTab: 'archived',
    renderRequest: () => events.push('render'),
    buildSearchIndex: () => {},
    updateFooterRequestBadge: () => events.push('badge'),
    getRequestArchivePagesService: () => context.requestArchivePagesService,
  });
  vm.runInContext(extractFunction(html, 'normalizeArchivedRequestRow', 'function renderRequestArchivePageHtml(')
    + extractFunction(html, 'getRequestArchivePageScopeKey', 'function getRequestArchivePagesService(')
    + extractFunction(html, 'loadRequestArchivePage', 'function clearPendingRequestArchiveFlushTimer('), context);

  const pending = context.loadRequestArchivePage(0, true);
  assert.equal(context.requestArchiveListState.rows[0].UNIQUE_ID, 'arch-1');
  assert.equal(context.requestArchiveListState.offset, 0);
  assert.equal(context.requestArchiveListState.loading, true);
  assert.equal(context.requestArchiveListState.refreshing, true);
  reads[0].reject(new Error('Temporary network failure'));
  assert.equal(await pending, false);
  assert.equal(context.requestArchiveListState.rows[0].UNIQUE_ID, 'arch-1');
  assert.equal(context.requestArchiveListState.offset, 0);
  assert.equal(context.requestArchiveListState.loaded, true);
  assert.equal(context.requestArchiveListState.error, 'Temporary network failure');
  assert.ok(events.includes('render'));
  assert.equal(events.includes('badge'), false);

  const retry = context.loadRequestArchivePage(0, true);
  assert.equal(context.requestArchiveListState.rows[0].UNIQUE_ID, 'arch-1', 'retry continues to show the retained page');
  reads[1].resolve(page(0, [{ unique_id: 'arch-1', commonname: 'Hosta updated' }], 101));
  assert.equal(await retry, true);
  assert.equal(context.requestArchiveListState.error, '');
  assert.equal(context.requestArchiveListState.rows[0].COMMONNAME, 'Hosta updated');
});
