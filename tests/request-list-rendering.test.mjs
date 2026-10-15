// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function source(name) {
  const start = html.search(new RegExp(`        function ${name}\\(`));
  assert.ok(start >= 0, `${name} exists`);
  const next = html.slice(start + 1).search(/\r?\n        (?:async )?function \w+\(/);
  assert.ok(next > 0, `${name} boundary`);
  return html.slice(start, start + next + 1);
}

function fixture() {
  const signatures = [];
  const pageKeys = [];
  const ctx = vm.createContext({
    signatures, pageKeys, pageIndex: 0,
    isRequestPendingVisible: () => true,
    isRegularRequestQueueItem: () => true,
    compareRequestLocationCodes: (a, b) => String(a).localeCompare(String(b)),
    getItemUniqueId: row => row.UNIQUE_ID,
    buildRequestChunkRenderKey: (mode, crumb, rows) => {
      signatures.push(rows.length);
      return JSON.stringify([mode, crumb, rows.map(row => [row.UNIQUE_ID, row.label])]);
    },
    getClientBrowsePage: (_view, key, rows) => {
      pageKeys.push(key);
      const pageIndex = Math.min(ctx.pageIndex, Math.max(0, Math.ceil(rows.length / 100) - 1));
      return { key, pageIndex, rows: rows.slice(pageIndex * 100, (pageIndex + 1) * 100) };
    },
    renderClientBrowsePageFooter: (_view, _key, total, page) => `${page.pageIndex}:${total}`
  });
  for (const name of ['buildRequestBrowseMembershipKey', 'buildRequestPagedRenderPlan']) {
    if (html.includes(`function ${name}(`)) vm.runInContext(source(name), ctx);
  }
  vm.runInContext(source('buildPendingRequestRenderPlan'), ctx);
  return ctx;
}

const rows = (count) => Array.from({ length: count }, (_, i) => ({ UNIQUE_ID: `request-${i}`, LOCATIONCODE: String(i).padStart(5, '0'), label: `Row ${i}` }));

test('reused Suspend collators preserve dock, stop, location, and Unicode name ordering', () => {
  const ctx = vm.createContext({
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') || '',
    getRequestSuspendTagDockFilterOptionForItem: row => ({ value: row.dock, label: row.dock })
  });
  for (const name of ['compareRequestSuspendTagDockOptions', 'compareLocationCodeValues', 'compareRequestSuspendTagRows', 'sortRequestSuspendTagRows']) {
    vm.runInContext(source(name), ctx);
  }
  const collators = { text: new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare,
    location: new Intl.Collator(undefined, { numeric: true }).compare };
  const data = Array.from({ length: 120 }, (_, id) => ({
    id, dock: ['Dock 2', 'Dock 10', 'no-dock'][id % 3], STOPNUMBER: ['', '2', '10'][id % 3],
    LOCATIONCODE: ['A.2', 'A.10', 'B.2.1', 'A.2.1', 'A-2'][id % 5],
    COMMONNAME: ['Érable 2', 'érable 10', 'Oak 3', 'Oak 12'][id % 4]
  }));
  const original = data.slice().sort((a, b) => ctx.compareRequestSuspendTagRows(a, b));
  const optimized = data.slice().sort((a, b) => ctx.compareRequestSuspendTagRows(a, b, collators));
  assert.deepEqual(optimized.map(row => row.id), original.map(row => row.id));
  assert.deepEqual(ctx.sortRequestSuspendTagRows(data, collators).map(row => row.id), optimized.map(row => row.id));
});

test('Pending computes rich card signatures for only its 100-row page at production scale', () => {
  const ctx = fixture();
  const plan = ctx.buildPendingRequestRenderPlan(rows(9539));
  assert.equal(plan.items.length, 9539);
  assert.equal(plan.rows.length, 100);
  assert.deepEqual(ctx.signatures, [100]);
  assert.equal(plan.footerMarkup, '0:9539');
});

test('visible content changes invalidate the render while keeping the current page', () => {
  const ctx = fixture(); ctx.pageIndex = 2;
  const data = rows(350);
  const first = ctx.buildPendingRequestRenderPlan(data);
  data[201].label = 'Updated photo and quantity';
  const second = ctx.buildPendingRequestRenderPlan(data);
  assert.equal(second.pageIndex, 2);
  assert.equal(ctx.pageKeys[0], ctx.pageKeys[1]);
  assert.notEqual(first.renderSignature, second.renderSignature);
  assert.equal(second.rows[1], data[201]);
  data[0].label = 'Off-page update';
  assert.equal(ctx.buildPendingRequestRenderPlan(data).renderSignature, second.renderSignature);
});

test('membership keys track order and filters without delimiter collisions', () => {
  const ctx = fixture();
  const data = rows(2);
  const key = ctx.buildRequestBrowseMembershipKey('pending', data);
  assert.notEqual(ctx.buildRequestBrowseMembershipKey('suspend-tag', data), key);
  assert.notEqual(ctx.buildRequestBrowseMembershipKey('pending', [...data].reverse()), key);
  assert.notEqual(ctx.buildRequestBrowseMembershipKey('pending', [{ UNIQUE_ID: 'a|b' }, { UNIQUE_ID: 'c' }]),
    ctx.buildRequestBrowseMembershipKey('pending', [{ UNIQUE_ID: 'a' }, { UNIQUE_ID: 'b|c' }]));
});

test('Request chrome shares one queue-count snapshot across badge and tabs', () => {
  const calls = [];
  const counts = { pending: 2, 'suspend-tag': 1 };
  const ctx = vm.createContext({
    activeReqTab: 'pending', normalizeRequestTabValue: value => value,
    getRequestTabQueueCounts: () => { calls.push('counts'); return counts; },
    updateFooterRequestBadge: snapshot => calls.push(['badge', snapshot]),
    updateFooterChatBadge: () => calls.push('chat'),
    syncRequestTabButtons: snapshot => calls.push(['tabs', snapshot]),
    syncRequestHeaderSearchChrome: () => calls.push('search'),
  });
  vm.runInContext(source('syncRequestRenderChrome'), ctx);
  ctx.syncRequestRenderChrome();
  assert.deepEqual(calls, ['counts', ['badge', counts], 'chat', ['tabs', counts], 'search']);
});

test('Suspend filter shell builds filter markup once per render', () => {
  const calls = { render: 0, update: 0 };
  const cardList = {};
  const footerHost = {};
  const resultsShell = { querySelector: selector => selector === '#request-suspend-tag-card-list' ? cardList
    : selector === '#request-suspend-tag-footer' ? footerHost : null };
  const container = {
    mounted: false,
    querySelector(selector) {
      if (!this.mounted) return null;
      return selector === '#request-suspend-tag-filter-shell' ? {} : selector === '#request-suspend-tag-results' ? resultsShell : null;
    }
  };
  const ctx = vm.createContext({
    document: { activeElement: { id: '' } },
    setContainerHtml: target => { target.mounted = true; },
    renderRequestSuspendTagFilters: () => { calls.render += 1; return '<filters>'; },
    updateRequestSuspendTagFiltersInPlace: () => { calls.update += 1; },
  });
  vm.runInContext(source('ensureRequestSuspendTagRenderShell'), ctx);
  const crumb = {};
  assert.equal(ctx.ensureRequestSuspendTagRenderShell(container, crumb, 'Suspend Tag', [], [], [], [], []), cardList);
  assert.equal(calls.render, 1);
  assert.equal(calls.update, 0);
  assert.equal(ctx.ensureRequestSuspendTagRenderShell(container, crumb, 'Suspend Tag', [], [], [], [], []), cardList);
  assert.equal(calls.render, 2);
  assert.equal(calls.update, 0);
});

test('Suspend pagination footer is mounted before deferred chunk completion', () => {
  const calls = [];
  let renderOptions;
  const ctx = vm.createContext({
    renderMarkupChunkedByKey: (...args) => { calls.push('render'); renderOptions = args[6]; calls.push(`crumb:${args[4]}`); return true; },
    generateCard: () => '<card>',
    isDockSuspendDcRequestMirrorPreparationPending: () => false,
    getPendingRequestChunkRenderOptions: options => options,
    repairVisibleDockSuspendDcPlanstartCardTones: () => calls.push('tones'),
    decorateRequestRows: () => calls.push('decorate'),
    syncRequestBrowseFooter: (_container, markup) => calls.push(`footer:${markup}`),
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagDockFilter: 'all',
  });
  vm.runInContext(source('renderSuspendTagPagedCards'), ctx);
  const plan = { rows: [{ UNIQUE_ID: 'suspend-1' }], renderSignature: 'suspend-signature',
    footerMarkup: '<footer>Rows 1–100 of 1000</footer>', crumbText: 'Suspend Tag' };
  assert.equal(ctx.renderSuspendTagPagedCards({}, {}, {}, null, 'Suspend Tag Filter', plan), true);
  assert.deepEqual(calls, ['render', 'crumb:Suspend Tag Filter', `footer:${plan.footerMarkup}`]);
  assert.equal(renderOptions.onCompleteAfterInteractive, true);
  renderOptions.onComplete();
  assert.deepEqual(calls, ['render', 'crumb:Suspend Tag Filter', `footer:${plan.footerMarkup}`, 'tones', 'decorate', `footer:${plan.footerMarkup}`]);
});

test('cold Suspend mirror preparation renders a loading state instead of an empty queue', () => {
  let renderOptions;
  const ctx = vm.createContext({
    renderMarkupChunkedByKey: (...args) => { renderOptions = args[6]; return true; },
    generateCard: () => '<card>', getPendingRequestChunkRenderOptions: options => options,
    isDockSuspendDcRequestMirrorPreparationPending: () => true,
    repairVisibleDockSuspendDcPlanstartCardTones() {}, decorateRequestRows() {}, syncRequestBrowseFooter() {},
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagDockFilter: 'all',
  });
  vm.runInContext(source('renderSuspendTagPagedCards'), ctx);
  ctx.renderSuspendTagPagedCards({}, {}, {}, null, 'Suspend Tag', { rows: [], renderSignature: 'loading', footerMarkup: '' });
  assert.match(renderOptions.emptyHtml, /Loading Suspend Tag rows/);
});

test('Suspend queue counts scan source status without constructing rich mirror rows', () => {
  let mirrorBuilds = 0;
  const ctx = vm.createContext({
    getSuspendTagRequestItems: items => items.filter(row => row.DOCK_SUSPEND_DC_REQUEST),
    getDockSuspendDcRequestSourceUid: row => row.DOCK_SUSPEND_SOURCE_UID || row.UNIQUE_ID,
    isDockSuspendDcRequestSource: row => row.SUSPEND === 'SUSPEND' && row.SUSPENDTO === 'dc',
    getSuspendTagStatus: row => row.status,
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') || '',
    buildDockSuspendDcRequestMirrorRow: () => { mirrorBuilds += 1; throw new Error('counts must not build cards'); },
  });
  vm.runInContext(source('countPendingSuspendTagQueueItems'), ctx);
  const sourceRows = Array.from({ length: 1000 }, (_, index) => ({
    UNIQUE_ID: `source-${index}`, SUSPEND: 'SUSPEND', SUSPENDTO: 'dc', status: index === 1 ? 'completed' : 'pending'
  }));
  sourceRows[2].status = 'denied';
  const existingMirror = { UNIQUE_ID: 'dock_suspend_dc_source-0', DOCK_SUSPEND_DC_REQUEST: true,
    DOCK_SUSPEND_SOURCE_UID: 'source-0', status: 'pending' };
  const count = ctx.countPendingSuspendTagQueueItems([existingMirror], sourceRows);
  assert.equal(count, 999);
  assert.equal(mirrorBuilds, 0);
});

test('Dock Suspend source lookup is indexed by source snapshot and can be invalidated after row mutation', () => {
  const rows = [{ UNIQUE_ID: 'source-a', status: 'pending' }, { UNIQUE_ID: 'source-b', status: 'pending' }];
  const otherRows = [];
  const ctx = vm.createContext({
    sourceRows: rows, socInventory: otherRows, revision: 'r1', resolvedViewStateEpoch: 4,
    currentUser: 'manager', dockSuspendDcRequestSourceRowLookupCache: { sourceRows: null, revision: '', byId: new Map() },
    requestScopedItemsCacheKey: 'stale', requestScopedItemsCache: ['stale'],
    dockSuspendDcRequestMirrorRowsCacheKey: '', dockSuspendDcRequestMirrorRowsCacheSource: null,
    dockSuspendDcRequestMirrorRowsByIdCache: null, dockSuspendDcRequestMirrorRowsByDomIdCache: null,
    dockSuspendDcRequestMirrorRowsPreparation: null,
    getDockSuspendDcSourceRows: () => ctx.sourceRows,
    getDockSuspendDcRequestSourceUid: item => item?.DOCK_SUSPEND_SOURCE_UID || '',
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') || '',
    getDatasetLoadSignature: name => `${name}:${ctx.revision}`,
    getSupabaseReadIdentityScope: () => 'manager-scope',
    normalizePushUsername: value => value,
  });
  vm.runInContext(`${source('getDockSuspendDcSourceRowLookupRevision')}\n${source('getDockSuspendDcSourceRowLookup')}\n${source('invalidateDockSuspendDcSourceRowLookup')}\n${source('findDockSuspendDcRequestSourceRow')}`, ctx);
  const firstIndex = ctx.getDockSuspendDcSourceRowLookup();
  assert.equal(firstIndex.get('source-a'), rows[0]);
  assert.equal(ctx.getDockSuspendDcSourceRowLookup(), firstIndex);
  rows[0].status = 'completed';
  ctx.invalidateDockSuspendDcSourceRowLookup(rows);
  assert.equal(ctx.requestScopedItemsCacheKey, '');
  assert.equal(ctx.requestScopedItemsCache, null);
  const refreshedIndex = ctx.getDockSuspendDcSourceRowLookup();
  assert.notEqual(refreshedIndex, firstIndex);
  assert.equal(ctx.findDockSuspendDcRequestSourceRow({ DOCK_SUSPEND_SOURCE_UID: 'source-a' }), rows[0]);
  assert.equal(ctx.findDockSuspendDcRequestSourceRow({ DOCK_SUSPEND_SOURCE_UID: 'missing' }), null);
  ctx.revision = 'r2';
  ctx.sourceRows = [{ UNIQUE_ID: 'source-a', status: 'new snapshot' }];
  assert.equal(ctx.findDockSuspendDcRequestSourceRow({ DOCK_SUSPEND_SOURCE_UID: 'source-a' }).status, 'new snapshot');
});

test('Suspend mirrors prepare in bounded slices, publish atomically, retain same-scope rows, and cancel stale jobs', () => {
  const sourceRows = Array.from({ length: 1000 }, (_, index) => ({ UNIQUE_ID: `source-${index}`, SUSPEND: 'SUSPEND', SUSPENDTO: 'dc' }));
  let builtRows = 0;
  const timers = [];
  const scheduled = [];
  const identity = { scope: 'manager-scope' };
  const setTimer = callback => { const timer = { callback, cleared: false }; timers.push(timer); return timer; };
  const runNextTimer = () => {
    while (timers.length) {
      const timer = timers.shift();
      if (!timer.cleared) { timer.callback(); return true; }
    }
    return false;
  };
  const drainTimers = () => { while (runNextTimer()) { /* Drain queued preparation slices. */ } };
  const ctx = vm.createContext({
    sourceRows, socInventory: [], currentUser: 'manager', activeReqTab: 'suspend-tag', resolvedViewStateEpoch: 5, revision: 'r1',
    dockSuspendDcRequestSourceRowLookupCache: { sourceRows: null, revision: '', byId: new Map() },
    dockSuspendDcRequestMirrorRowsCacheKey: '', dockSuspendDcRequestMirrorRowsCacheSource: null,
    dockSuspendDcRequestMirrorRowsCache: [], dockSuspendDcRequestMirrorRowsByIdCache: null,
    dockSuspendDcRequestMirrorRowsByDomIdCache: null, dockSuspendDcRequestMirrorRowsCacheOwner: '',
    dockSuspendDcRequestMirrorRowsPreparation: null, DOCK_SUSPEND_MIRROR_PREPARATION_CHUNK_SIZE: 64,
    requestScopedItemsCacheKey: 'stale', requestScopedItemsCache: ['stale'],
    canCurrentUserViewDockSuspendDcRequests: () => true,
    getDockSuspendDcSourceRows: () => ctx.sourceRows,
    getDatasetLoadSignature: name => `${name}:${ctx.revision}`,
    getSupabaseReadIdentityScope: () => identity.scope,
    normalizePushUsername: value => value,
    setTimeout: setTimer, clearTimeout: timer => { if (timer) timer.cleared = true; },
    isViewVisible: view => view === 'request',
    scheduleRequestRender: (...args) => scheduled.push(args),
    isDockSuspendDcRequestSource: row => row.SUSPEND === 'SUSPEND' && row.SUSPENDTO === 'dc',
    buildDockSuspendDcRequestMirrorRow: row => { builtRows += 1; return row.SUSPEND === 'SUSPEND' && row.SUSPENDTO === 'dc' ? { UNIQUE_ID: `mirror-${row.UNIQUE_ID}` } : null; },
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') || '',
  });
  vm.runInContext(`${source('getDockSuspendDcSourceRowLookupRevision')}\n${source('getDockSuspendDcRequestMirrorRowsOwner')}\n${source('scheduleDockSuspendDcRequestMirrorRowsPreparation')}\n${source('getDockSuspendDcRequestMirrorRows')}`, ctx);
  assert.equal(ctx.getDockSuspendDcRequestMirrorRows().length, 0, 'cold preparation does not expose a partial queue');
  assert.equal(builtRows, 0, 'the first render does no row mapping synchronously');
  runNextTimer();
  assert.equal(builtRows, 64, 'each scheduled slice maps at most 64 rows');
  assert.equal(ctx.dockSuspendDcRequestMirrorRowsCache.length, 0, 'partial slices are never published');
  drainTimers();
  assert.equal(builtRows, 1000);
  assert.equal(ctx.getDockSuspendDcRequestMirrorRows().length, 1000);
  assert.deepEqual(scheduled, [[0, 0, true]]);

  const previousRows = ctx.dockSuspendDcRequestMirrorRowsCache;
  ctx.revision = 'r2';
  ctx.sourceRows = Array.from({ length: 1000 }, (_, index) => ({ UNIQUE_ID: `replacement-${index}`, SUSPEND: 'SUSPEND', SUSPENDTO: 'dc' }));
  assert.equal(ctx.getDockSuspendDcRequestMirrorRows()[0].UNIQUE_ID, previousRows[0].UNIQUE_ID, 'same-scope refresh keeps the previous complete rows visible');
  runNextTimer();
  assert.equal(builtRows, 1064);
  ctx.revision = 'r3';
  ctx.sourceRows = [{ UNIQUE_ID: 'latest-source', SUSPEND: 'SUSPEND', SUSPENDTO: 'dc' }];
  runNextTimer();
  assert.equal(ctx.dockSuspendDcRequestMirrorRowsCache, previousRows, 'a stale job cannot publish after source replacement');
  assert.equal(ctx.getDockSuspendDcRequestMirrorRows()[0].UNIQUE_ID, previousRows[0].UNIQUE_ID);
  drainTimers();
  assert.equal(Array.from(ctx.getDockSuspendDcRequestMirrorRows(), row => row.UNIQUE_ID).join(','), 'mirror-latest-source');
  assert.equal(ctx.requestScopedItemsCacheKey, '');
  assert.equal(ctx.requestScopedItemsCache, null);
  assert.equal(scheduled.length, 3, 'complete refreshes and stale-job recovery schedule a render');

  identity.scope = 'manager-permission-version-2';
  ctx.dockSuspendDcRequestMirrorRowsByIdCache = new Map([['old-account-row', {}]]);
  ctx.dockSuspendDcRequestMirrorRowsByDomIdCache = new Map([['old-account-dom-row', {}]]);
  assert.equal(ctx.getDockSuspendDcRequestMirrorRows().length, 0, 'a changed auth scope never receives previous-scope rows');
  assert.equal(ctx.dockSuspendDcRequestMirrorRowsByIdCache, null);
  assert.equal(ctx.dockSuspendDcRequestMirrorRowsByDomIdCache, null);
  drainTimers();
  assert.equal(Array.from(ctx.getDockSuspendDcRequestMirrorRows(), row => row.UNIQUE_ID).join(','), 'mirror-latest-source');
  assert.equal(scheduled.length, 4);
});

test('Suspend keeps all filter totals while bounding cards and plan-start signatures to its page', () => {
  const ctx = fixture();
  const planstartReads = [];
  Object.assign(ctx, {
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagDockFilter: 'all',
    getSuspendTagRequestItems: values => values.slice(),
    compareRequestSuspendTagRows: (a, b) => a.LOCATIONCODE.localeCompare(b.LOCATIONCODE),
    applyRequestSuspendTagCommonNameSearchFilter: values => values,
    applyRequestSuspendTagAssignedToFilter: values => values,
    applyRequestSuspendTagContSizeFilter: values => values,
    applyRequestSuspendTagDockFilter: values => values,
    normalizeSearchValue: value => value,
    normalizeRequestSuspendTagAssignedToFilterValue: value => value,
    normalizeRequestSuspendTagContSizeFilterValue: value => value,
    getDockSuspendDcRequestPlanstartInfo: row => { planstartReads.push(row.UNIQUE_ID); return { value: row.date || '', tone: 'monday', valid: true }; }
  });
  ctx.sortRequestSuspendTagRows = values => values.slice().sort(ctx.compareRequestSuspendTagRows);
  vm.runInContext(source('buildSuspendTagRenderPlan'), ctx);
  const data = rows(9539);
  const first = ctx.buildSuspendTagRenderPlan(data);
  assert.equal(first.allItems.length, 9539);
  assert.equal(first.items.length, 9539);
  assert.equal(first.rows.length, 100);
  assert.equal(first.footerMarkup, '0:9539');
  assert.deepEqual(ctx.signatures, [100]);
  assert.equal(planstartReads.length, 100);
  data[0].date = '2026-10-19';
  assert.notEqual(ctx.buildSuspendTagRenderPlan(data).renderSignature, first.renderSignature);
  ctx.pageIndex = 95;
  assert.equal(ctx.buildSuspendTagRenderPlan(data).rows.length, 39);
});
