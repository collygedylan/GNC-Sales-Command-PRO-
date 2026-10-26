import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { installDatabaseBridge } from './helpers/database-bridge.mjs';

const html = readComposedAppSource().replace(/\r\n/g, '\n');
const lifecycle = readFileSync(new URL('../assets/app-lifecycle.js', import.meta.url), 'utf8');
const evalSecurityStart = html.indexOf('        function isEvalSensitiveDataRestricted(');
const evalSecurityEnd = html.indexOf('        function runDedupeSupabaseRead(', evalSecurityStart);
assert.ok(evalSecurityStart >= 0 && evalSecurityEnd > evalSecurityStart, 'Eval security helpers should exist');
const evalSecurityHelpers = html.slice(evalSecurityStart, evalSecurityEnd);
const inventoryContractContext = {};
vm.runInNewContext(readFileSync(new URL('../assets/inventory-list-contract.js', import.meta.url), 'utf8'), inventoryContractContext);
const inventoryContract = inventoryContractContext.AgMetricInventoryList;
const liveSyncContext = {};
vm.runInNewContext(readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8'), liveSyncContext);
const liveSync = liveSyncContext.AgMetricLiveSync;
test('the inventory list contract script loads before inline live-sync consumers', () => {
    const contractScript = html.indexOf('src="./assets/inventory-list-contract.js');
    const coordinatorScript = html.indexOf('src="./assets/live-sync-coordinator.js');
    assert.ok(contractScript >= 0, 'inventory list contract must be loaded by the production shell');
    assert.ok(coordinatorScript > contractScript, 'inventory list contract must execute before live-sync coordinator consumers');
    assert.ok(inventoryContract && Array.isArray(inventoryContract.physicalColumns));
});
const start = html.indexOf('const supabaseReadInFlight = new Map();');
const end = html.indexOf('async function getResponseError(', start);
assert.ok(start > 0 && end > start);
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function extractAppFunction(name) {
    const match = html.match(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(match, name);
    const end = html.indexOf('\n        function ', match.index + match[0].length);
    assert.ok(end > match.index, `${name} boundary`);
    return html.slice(match.index, end);
}

function extractMasterPagingFunction() {
    const start = html.indexOf('        async function fetchAllInventoryReadRows(');
    const end = html.indexOf('\n        let inventorySchemaCapabilitiesPromise', start);
    assert.ok(start >= 0 && end > start, 'fetchAllInventoryReadRows boundaries');
    return html.slice(start, end);
}

test('AV sorting preserves numeric locale order with one reusable collator per sort', () => {
    let collators = 0;
    const ctx = { Intl: { Collator: function(locale, options) {
        collators += 1;
        return new Intl.Collator(locale, options);
    } }, activeAvOpenTab: 'name' };
    vm.createContext(ctx);
    vm.runInContext(extractAppFunction('sortAvOpenItems'), ctx);
    const rows = ['Plant 10', 'plant 2', 'Érable', 'Åcer', 'Plant 2', 'Plant 2'].map((COMMONNAME, index) => ({
        COMMONNAME, CONTSIZE: index % 2 ? '#10' : '#2', LOCATIONCODE: `A.${10 - index}`,
    }));
    const compare = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true });
    const expected = rows.slice().sort((a, b) => compare(a.COMMONNAME, b.COMMONNAME)
        || compare(a.CONTSIZE, b.CONTSIZE) || compare(a.LOCATIONCODE, b.LOCATIONCODE));
    assert.deepEqual(Array.from(ctx.sortAvOpenItems(rows)), expected);
    assert.equal(collators, 1, 'collation settings are constructed once, not for every row comparison');
    assert.notEqual(ctx.sortAvOpenItems(rows), rows, 'sorting retains source ownership');
});

test('closed AV filter controls skip hidden option markup and header scans', () => {
    const controls = extractAppFunction('renderAvTopControls');
    assert.match(controls, /const genusOptionsHtml = avGenusFilterOpen && !collapseDetailFilters\s*\? buildAvMultiChoiceOptionsHtml/);
    assert.match(controls, /const contSizeOptionsHtml = avContSizeFilterOpen && !collapseDetailFilters\s*\? buildAvMultiChoiceOptionsHtml/);
    assert.match(extractAppFunction('buildAvTopControlsSignature'), /avColumnFilterDropdownOpen\s*\? getAvColumnFilterFields/);
});

test('AV page keys use ordered membership while visible card signatures retain content changes', () => {
    const ctx = { firstNonEmptyValue: (...values) => values.find(value => value != null && value !== '') };
    vm.createContext(ctx);
    vm.runInContext(extractAppFunction('normalizeRenderSignature')
        + extractAppFunction('updateRenderSignatureHash')
        + extractAppFunction('buildAVBrowsePageKey'), ctx);
    const rows = [{ UNIQUE_ID: 'a', COMMONNAME: 'A' }, { UNIQUE_ID: 'b', COMMONNAME: 'B' }];
    const original = ctx.buildAVBrowsePageKey('open', rows);
    assert.equal(ctx.buildAVBrowsePageKey('open', rows.map(row => ({ ...row, LOCATIONNOTE: 'new note' }))), original);
    assert.notEqual(ctx.buildAVBrowsePageKey('open', rows.slice().reverse()), original);
    assert.notEqual(ctx.buildAVBrowsePageKey('photos', rows), original);
    assert.notEqual(ctx.buildAVBrowsePageKey('open', rows.slice(0, 1)), original);
    const render = extractAppFunction('renderAV');
    assert.match(render, /buildRowsRenderSignature\(pageKey, browsePage\.rows/);
    assert.match(render, /buildRowsRenderSignature\(pageKey, reserveBrowsePage\.rows/);
});

function avCardChunkFixture({ ios = false, total = 100, firstPreviewCardSync = false } = {}) {
    const generated = [], batches = [], frames = [], footers = [];
    let loadMoreButton = null;
    const container = { classList: { add() {} }, style: {}, dataset: {}, signature: '',
        querySelector: () => loadMoreButton,
        insertAdjacentHTML: (_position, markup) => {
            footers.push(markup);
            if (markup.includes('data-av-load-more')) loadMoreButton = {
                isConnected: true, disabled: false, click: null,
                addEventListener: (_event, callback) => { loadMoreButton.click = callback; },
                insertAdjacentHTML: (_position, html) => batches.push(html),
                remove: () => { loadMoreButton.isConnected = false; },
            };
        } };
    const crumb = {};
    const ctx = {
        avRenderChunkToken: 0, CHUNK_RENDER_INTERACTION_HOLD_MAX_MS: 1000,
        CLIENT_BROWSE_PAGE_SIZE: 100, canUseProductionLiveSync: () => false, shouldUseRepAvOpenDataset: () => false,
        getCurrentVisibleViewId: () => 'av', refreshCartButtons() {}, scheduleDeferredCardPhotoHydration() {},
        IOS_CHUNK_FRAME_BUDGET_MS: 4, IOS_CHUNK_SYNC_ROW_LIMIT: 48,
        window: { innerHeight: 800, matchMedia: () => ({ matches: false }) },
        document: { documentElement: { clientHeight: 800 } }, performance: { now: () => 0 },
        beginInternalPerfMeasure: () => 0, recordInternalPerfDuration() {}, incrementInternalPerfCounter() {},
        clearChunkRenderTimersByKey() {},
        buildRowsRenderSignature: (prefix, rows, fields = []) => JSON.stringify([prefix,
            rows.map(row => [row.id, ...fields.map(field => row[field])])]),
        isAdaptivePerformanceMode: () => false, getAdaptivePerformanceLevel: () => 0,
        isIOSDevice: () => ios, isStandaloneApp: () => false, getIsAvPhotoSubview: () => false,
        getContainerRenderSignature: target => target.signature,
        setContainerRenderSignature: (target, signature) => { target.signature = signature; },
        setContainerHtml: (_target, markup) => { batches.push(markup); },
        setContainerHtmlWithSignature: (target, markup, signature) => { batches.push(markup); target.signature = signature; },
        appendHtmlFragment: (_target, markup) => { batches.push(markup); },
        generateCard: (row, source, status, options) => {
            generated.push({ id: row.id, source, status, rowIndex: options.rowIndex });
            return `<card>${row.id}</card>`;
        },
        getChunkRenderPacing: target => ({ batchTarget: target, timeBudget: 5, frameDelayMs: 0 }),
        requestAnimationFrame: callback => frames.push(callback),
        scheduleChunkRenderTimeout: (_key, callback) => frames.push(callback),
        shouldHoldFollowupChunkFramesForInteraction: () => false,
        isUserInLiveTouchScrollGesture: () => false, getIosChunkFrameDelay: () => 0,
    };
    vm.createContext(ctx);
    vm.runInContext(extractAppFunction('shouldUseChunkedAVOpenRender')
        + extractAppFunction('getAvCardWindowEnd') + extractAppFunction('installAvCardWindowContinuation')
        + extractAppFunction('renderAVOpenCardsChunked'), ctx);
    const rows = Array.from({ length: total }, (_value, id) => ({ id }));
    const start = () => ctx.renderAVOpenCardsChunked(container, crumb, rows, 'av', 'AV rows', '<footer/>', { firstPreviewCardSync });
    const flush = () => {
        let callbacks = 0;
        while (frames.length || loadMoreButton?.isConnected) {
            assert.ok(callbacks++ < 1000, 'chunk queue must finish');
            if (frames.length) frames.shift()();
            else loadMoreButton.click();
        }
    };
    return { ctx, rows, generated, batches, footers, container, crumb, start, flush, flushOne: () => frames.shift()?.() };
}

test('partial AV preview publishes one prepared card immediately then completes the full page in cancellable chunks', () => {
    const fixture = avCardChunkFixture({ total: 20, firstPreviewCardSync: true });
    fixture.start();
    assert.deepEqual(fixture.generated.map(row => row.id), [0], 'the partial preview immediately replaces Loading with one card');
    assert.deepEqual(fixture.batches, ['<card>0</card>']);
    assert.deepEqual(fixture.footers, [], 'the page footer waits for the complete visible page');
    fixture.flush();
    assert.deepEqual(fixture.generated.map(row => row.id), fixture.rows.map(row => row.id));
    assert.deepEqual(fixture.footers, ['<footer/>']);
    assert.ok(fixture.container.signature);
});

test('AV paginated cards render in bounded batches while preserving every row and footer', () => {
    for (const ios of [false, true]) {
        for (const total of [20, 100]) {
            const fixture = avCardChunkFixture({ ios, total });
            assert.equal(fixture.ctx.shouldUseChunkedAVOpenRender(fixture.rows), true);
            assert.equal(fixture.ctx.shouldUseChunkedAVOpenRender(fixture.rows.slice(0, 12)), true);
            assert.equal(fixture.ctx.shouldUseChunkedAVOpenRender([]), false);
            fixture.start();
            assert.equal(fixture.generated.length, 0, 'rich cards are deferred out of the publication turn');
            fixture.flushOne();
            assert.equal(fixture.generated.length, 4, 'first paint fills the viewport without synchronously rendering extra screens');
            assert.equal(fixture.footers.length, 0, 'footer waits for the full page');
            fixture.flush();
            assert.deepEqual(fixture.generated.map(row => row.id), fixture.rows.map(row => row.id));
            assert.deepEqual(fixture.generated.map(row => row.rowIndex), fixture.rows.map(row => row.id));
            assert.ok(fixture.batches.every(markup => (markup.match(/<card>/g) || []).length <= 20), 'continuation appends at most one bounded 20-card window');
            assert.equal(fixture.footers.length, 1);
            assert.ok(fixture.footers[0].endsWith('<footer/>'));
            assert.equal(fixture.footers[0].includes('data-av-load-more'), total > 20);
            assert.equal(fixture.crumb.innerText, 'AV rows');
            assert.ok(fixture.container.signature);
        }
    }
});

test('a single filtered AV card also yields before replacing the retained display', () => {
    for (const ios of [false, true]) {
        const fixture = avCardChunkFixture({ ios, total: 1 });
        assert.equal(fixture.ctx.shouldUseChunkedAVOpenRender(fixture.rows), true);
        fixture.start();
        assert.equal(fixture.generated.length, 0);
        assert.equal(fixture.batches.length, 0);
        fixture.flush();
        assert.deepEqual(fixture.generated.map(row => row.id), [0]);
        assert.deepEqual(fixture.footers, ['<footer/>']);
    }
});

test('AV navigation cancellation stops pending card batches and footer publication', () => {
    const fixture = avCardChunkFixture();
    fixture.start();
    const initialCount = fixture.generated.length;
    fixture.ctx.avRenderChunkToken += 1;
    fixture.flush();
    assert.equal(fixture.generated.length, initialCount);
    assert.deepEqual(fixture.footers, []);
    assert.equal(fixture.container.signature, '');
});

test('chunked AV cards refresh when customer reserve summaries change', () => {
    const fixture = avCardChunkFixture();
    fixture.start(); fixture.flush();
    const initial = fixture.generated.length;
    fixture.start(); fixture.flush();
    assert.equal(fixture.generated.length, initial, 'unchanged visible page keeps its existing cards');
    for (const field of ['AV_RESERVE_CUSTOMER_PREVIEW', 'AV_RESERVE_CONSIGNEE_PREVIEW',
        'AV_RESERVE_SALESREP_PREVIEW', 'AV_RESERVE_ROW_COUNT', 'AV_RESERVE_CUSTOMER_COUNT', 'AV_RESERVE_QTY_TOTAL']) {
        const previous = fixture.generated.length;
        fixture.rows[0][field] = 'updated';
        fixture.start(); fixture.flush();
        assert.equal(fixture.generated.length, previous + fixture.rows.length, `${field} invalidates the visible cards`);
    }
});

function dashboardMetadataFixture() {
    const calls = [];
    const ctx = { Error, Object, String, Number, Array, Set, Map, Math, JSON, Promise, Date, encodeURIComponent, AbortController,
        currentUser: 'metadata-user-a', owner: 'metadata-scope-a', allowed: true,
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

test('dashboard metadata cancellation between reads prevents the next request and commit, then fresh reads resume and cache', async () => {
    const { ctx, calls } = dashboardMetadataFixture(), uiGate = deferred();
    ctx.yieldToUiFrame = () => uiGate.promise;
    const pending = ctx.refreshDashboardSyncMetadata(true);
    await settle();
    assert.equal(calls.length, 1);
    assert.equal(ctx.commits, 0);
    ctx.productionLiveSyncNavigation.abort(); uiGate.resolve();
    assert.equal(await pending, false);
    assert.equal(calls.length, 1, 'the next metadata source must not start after unload');
    assert.equal(ctx.commits, 0);
    assert.equal(ctx.metadataState().summaries.length, 0);
    assert.equal(ctx.metadataState().fetchedAt, 0);
    assert.equal(ctx.metadataState().pending, null);
    ctx.productionLiveSyncNavigation = new AbortController();
    ctx.yieldToUiFrame = async () => {};
    assert.equal(await ctx.refreshDashboardSyncMetadata(), true);
    assert.equal(calls.length, 5);
    assert.equal(ctx.commits, 1);
    assert.equal(ctx.metadataState().summaries.length, 4);
    assert.ok(ctx.metadataState().fetchedAt > 0);
    for (const call of calls) {
        const query = new URLSearchParams(call.query);
        assert.equal(query.get('select'), 'filename,last_updated');
        assert.equal(query.get('last_updated'), 'not.is.null');
        assert.equal(query.get('order'), 'last_updated.desc');
        assert.equal(query.get('limit'), '30');
        assert.equal(query.get('offset'), '0');
        assert.equal(call.options.timeoutMs, 1000);
        assert.ok(call.options.signal);
    }
    assert.equal(await ctx.refreshDashboardSyncMetadata(), true);
    assert.equal(calls.length, 5, 'same-owner metadata reuses its valid TTL cache');
});

test('current-proof export guard blocks stale native inventory while preserving non-native behavior', () => {
    const helperStart = html.indexOf('function hasCurrentProductionLiveSyncProof(');
    const helperEnd = html.indexOf('const productionLiveSyncReadSignalIds', helperStart);
    assert.ok(helperStart > 0 && helperEnd > helperStart);
    const calls = { toasts: [], signals: [] };
    const ctx = { runtime: true, profileUsername: 'alice', currentUser: 'alice', proof: '', key: 'fresh-key', permissionVersion: 'access-v1' };
    const sandbox = {
        canUseProductionLiveSync: () => ctx.runtime && ctx.profileUsername.toLowerCase() === ctx.currentUser.toLowerCase(),
        nativeAuthSessionActive: true,
        nativeAuthProfile: { id: 'native-account' },
        productionLiveSyncVerifiedView: ctx.proof,
        getProductionLiveSyncContext: () => ({ viewKey: 'drive', dataPermissionVersion: ctx.permissionVersion }),
        productionVerifiedViewKey: () => ctx.key,
        showToast: (...args) => calls.toasts.push(args),
        signalProductionLiveSync: (...args) => calls.signals.push(args)
    };
    vm.createContext(sandbox);
    vm.runInContext(html.slice(helperStart, helperEnd), sandbox);
    assert.equal(sandbox.hasCurrentProductionLiveSyncProof(), false);
    assert.equal(sandbox.requireCurrentProductionLiveSyncProof('exporting inventory'), false);
    assert.equal(calls.toasts.length, 1);
    assert.equal(calls.signals[0][0], 'action-proof-required');
    sandbox.productionLiveSyncVerifiedView = 'fresh-key';
    assert.equal(sandbox.requireCurrentProductionLiveSyncProof('exporting inventory'), true);
    ctx.permissionVersion = '';
    assert.equal(sandbox.hasCurrentProductionLiveSyncProof(), false, 'native proof requires the canonical access permission version');
    ctx.permissionVersion = 'access-v1';
    ctx.currentUser = 'different-user';
    assert.equal(sandbox.hasCurrentProductionLiveSyncProof(), false, 'a native identity mismatch must fail closed');
    ctx.currentUser = 'alice';
    ctx.runtime = false;
    assert.equal(sandbox.hasCurrentProductionLiveSyncProof(), false, 'native session without the live-sync runtime must fail closed');
    sandbox.nativeAuthSessionActive = false;
    sandbox.nativeAuthProfile = null;
    ctx.runtime = false;
    sandbox.productionLiveSyncVerifiedView = '';
    assert.equal(sandbox.requireCurrentProductionLiveSyncProof('exporting inventory'), true);

    for (const name of ['exportCurrentAVToExcel', 'exportSalesOfficeRowsToExcel', 'exportCurrentDriveModeToExcel', 'exportCurrentDriveReportToExcel']) {
        const start = html.indexOf(`function ${name}(`);
        const end = html.indexOf('\n        function ', start + 12);
        assert.ok(start > 0 && end > start, name);
        assert.match(html.slice(start, end), /requireCurrentProductionLiveSyncProof\(/, `${name} must recheck current proof before exporting`);
    }
});

test('dashboard metadata never starts transport after navigation is already aborted', async () => {
    const { ctx, calls } = dashboardMetadataFixture();
    ctx.productionLiveSyncNavigation.abort();
    assert.equal(await ctx.refreshDashboardSyncMetadata(true), false);
    assert.equal(calls.length, 0);
    assert.equal(ctx.commits, 0);
    assert.equal(ctx.metadataState().fetchedAt, 0);
    assert.equal(ctx.metadataState().pending, null);
});

test('dashboard metadata aborts an in-flight authenticated request while preserving the same-owner cache', async () => {
    const { ctx, calls } = dashboardMetadataFixture();
    assert.equal(await ctx.refreshDashboardSyncMetadata(), true);
    const prior = ctx.metadataState();
    assert.equal(calls.length, 4);
    ctx.transport = (_, __, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    });
    const pending = ctx.refreshDashboardSyncMetadata(true);
    await settle();
    assert.equal(calls.length, 5);
    ctx.productionLiveSyncNavigation.abort();
    assert.equal(await pending, false);
    assert.equal(calls.at(-1).options.signal.aborted, true);
    assert.equal(calls.length, 5);
    assert.equal(ctx.commits, 1, 'only the earlier successful read committed');
    assert.equal(ctx.metadataState().fetchedAt, prior.fetchedAt);
    assert.equal(ctx.metadataState().summaries, prior.summaries);
});

test('dashboard metadata never shares or commits an old account request over a new owner', async () => {
    const { ctx, calls } = dashboardMetadataFixture(), oldGate = deferred(), freshGate = deferred();
    let freshReads = 0;
    ctx.transport = table => ctx.owner === 'metadata-scope-a' ? oldGate.promise
        : ++freshReads === 1 ? freshGate.promise
        : Promise.resolve({ rows: [{ filename: `new-${table}.csv`, last_updated: '2026-09-12T12:00:00Z' }] });
    const old = ctx.refreshDashboardSyncMetadata(true);
    await settle();
    ctx.currentUser = 'metadata-user-b'; ctx.owner = 'metadata-scope-b';
    const fresh = ctx.refreshDashboardSyncMetadata(), shared = ctx.refreshDashboardSyncMetadata();
    await settle();
    assert.equal(calls.length, 2, 'the new owner starts once and coalesces only its own reads');
    oldGate.resolve({ rows: [{ filename: 'old-account.csv', last_updated: '2026-09-12T13:00:00Z' }] });
    assert.equal(await old, false);
    assert.equal(ctx.commits, 0);
    const stillShared = ctx.refreshDashboardSyncMetadata();
    await settle();
    assert.equal(calls.length, 2, 'old completion cannot clear the new pending request');
    freshGate.resolve({ rows: [{ filename: 'new-master.csv', last_updated: '2026-09-12T12:00:00Z' }] });
    assert.deepEqual(await Promise.all([fresh, shared, stillShared]), [true, true, true]);
    assert.equal(calls.length, 5);
    assert.equal(ctx.commits, 1);
    assert.ok(ctx.metadataState().summaries.every(entry => entry.files.every(file => file.startsWith('new-'))));
    assert.equal(await ctx.refreshDashboardSyncMetadata(), true);
    assert.equal(calls.length, 5);
});

test('dashboard metadata permission loss at the final UI yield prevents a completed batch from committing', async () => {
    const { ctx, calls } = dashboardMetadataFixture();
    let yields = 0;
    ctx.yieldToUiFrame = async () => { if (++yields === 4) ctx.allowed = false; };
    assert.equal(await ctx.refreshDashboardSyncMetadata(true), false);
    assert.equal(calls.length, 4);
    assert.equal(ctx.commits, 0);
    assert.equal(ctx.metadataState().summaries.length, 0);
    assert.equal(ctx.metadataState().fetchedAt, 0);
});

test('Home coordinator ownership prevents an older legacy metadata request from overwriting its committed snapshot', async () => {
    const { ctx, calls } = dashboardMetadataFixture(), gate = deferred();
    ctx.transport = () => gate.promise;
    const old = ctx.refreshDashboardSyncMetadata(true);
    await settle();
    assert.equal(calls.length, 1);
    ctx.coordinatorOwnsMetadata = true;
    gate.resolve({ rows: [{ filename: 'legacy-stale.csv', last_updated: '2026-09-12T12:00:00Z' }] });
    assert.equal(await old, false);
    assert.equal(ctx.commits, 0);
    assert.equal(ctx.metadataState().summaries.length, 0);
    assert.equal(await ctx.refreshDashboardSyncMetadata(true), true);
    assert.deepEqual(ctx.coordinatorSignals, [['home-metadata-refresh', 0]]);
    assert.equal(calls.length, 1, 'the coordinator owns Home metadata transport');
});

test('dashboard metadata discards an in-flight request when the same user receives a new permission version', async () => {
    const { ctx, calls } = dashboardMetadataFixture(), gate = deferred();
    ctx.transport = () => gate.promise;
    const pending = ctx.refreshDashboardSyncMetadata(true);
    await settle();
    assert.equal(calls.length, 1);
    ctx.appAccessSnapshotState.snapshot.dataPermissionVersion = 'metadata-permission-b';
    gate.resolve({ rows: [{ filename: 'old-policy.csv', last_updated: '2026-09-12T12:00:00Z' }] });
    assert.equal(await pending, false);
    assert.equal(ctx.commits, 0);
    assert.equal(ctx.metadataState().summaries.length, 0);
    assert.equal(ctx.metadataState().fetchedAt, 0);
});

test('health telemetry cancels across navigation during authentication and in flight, then resumes normally', async () => {
    const auth = deferred(), calls = [];
    const sampleMath = Object.create(Math); sampleMath.random = () => 0;
    const ctx = { Error, Object, String, Number, Set, Math: sampleMath, JSON, Promise, encodeURIComponent,
        AbortController, currentUser: 'fixture', navigator: { onLine: true }, APP_SHELL_BUILD: 'fixture',
        SUPABASE_URL: 'https://fixture.invalid', SUPABASE_WRITE_TIMEOUT_MS: 1000,
        productionLiveSyncNavigation: new AbortController(), getNativeAuthRequestHeaders: () => auth.promise,
        sanitizeHealthMetadata: value => value,
        fetchWithTimeout: async (_, options) => { calls.push(options); return new Response('1', { headers: { 'content-type': 'application/json' } }); }
    };
    vm.createContext(ctx);
    const signalStart = html.indexOf('async function withProductionLiveSyncSignal(');
    vm.runInContext(html.slice(signalStart, html.indexOf('function ', signalStart + 15)).trim(), ctx);
    installDatabaseBridge(ctx);
    const rpcStart = html.indexOf('async function supabaseRpc(');
    vm.runInContext(evalSecurityHelpers, ctx);
    vm.runInContext(html.slice(rpcStart, html.indexOf('const SECURE_DRIVE_EVIDENCE_PREFIXES', rpcStart)), ctx);
    const healthStart = html.indexOf('function reportSemanticHealthEvent(');
    vm.runInContext(html.slice(healthStart, html.indexOf('window.reportSemanticHealthEvent', healthStart)), ctx);
    const reports = () => [ctx.reportSemanticHealthEvent('fixture', 'test'), ctx.reportPerformanceHealthEvent('fixture', 'test', 1)];
    let pending = reports();
    ctx.productionLiveSyncNavigation.abort(); auth.resolve({ Authorization: 'synthetic' });
    assert.deepEqual(await Promise.all(pending), [false, false]);
    assert.equal(calls.length, 0, 'unloading during auth preparation must not start telemetry requests');
    ctx.productionLiveSyncNavigation = new AbortController();
    ctx.fetchWithTimeout = (_, options) => new Promise((_, reject) => {
        calls.push(options); options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    });
    pending = reports(); await settle();
    assert.equal(calls.length, 2);
    ctx.productionLiveSyncNavigation.abort();
    assert.deepEqual(await Promise.all(pending), [false, false]);
    assert.ok(calls.every(options => options.signal.aborted));
    ctx.productionLiveSyncNavigation = new AbortController();
    ctx.fetchWithTimeout = async () => new Response('1', { headers: { 'content-type': 'application/json' } });
    assert.deepEqual(await Promise.all(reports()), [true, true], 'active-document health reporting remains enabled');
});

test('a revision read cancelled during auth preparation never starts its RPC', async () => {
    const from = html.indexOf('async function supabaseRpc(');
    const to = html.indexOf('const SECURE_DRIVE_EVIDENCE_PREFIXES', from);
    const gate = deferred(), controller = new AbortController(); let calls = 0;
    const ctx = { Error, Object, String, Number, Math, JSON, encodeURIComponent,
        SUPABASE_URL: 'https://fixture.invalid', SUPABASE_WRITE_TIMEOUT_MS: 1000,
        getNativeAuthRequestHeaders: () => gate.promise,
        fetchWithTimeout: async () => { calls++; return new Response('{}', { headers: { 'content-type': 'application/json' } }); }
    };
    installDatabaseBridge(ctx);
    vm.createContext(ctx);
    vm.runInContext(evalSecurityHelpers, ctx);
    vm.runInContext(extractAppFunction('validateInventoryReadProjection'), ctx);
    vm.runInContext(html.slice(from, to), ctx);
    const pending = ctx.supabaseRpc('get_my_dataset_revisions_v1', { p_dataset_keys: [] }, { signal: controller.signal });
    controller.abort(); gate.resolve({ Authorization: 'synthetic' });
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED');
    assert.equal(calls, 0);
    await ctx.supabaseRpc('get_my_dataset_revisions_v1', { p_dataset_keys: [] }, { signal: new AbortController().signal });
    assert.equal(calls, 1, 'new document/account reads retain normal authentication');
});

test('cancellation during proxy preparation prevents a native fetch', async () => {
    const from = html.indexOf('async function fetchWithTimeout(');
    const to = html.indexOf('const supabaseReadInFlight', from);
    const gate = deferred(), controller = new AbortController(); let calls = 0;
    const ctx = { Error, Object, AbortController, setTimeout, clearTimeout, SUPABASE_WRITE_TIMEOUT_MS: 1000,
        fetchSupabaseRestViaAppApiIfNeeded: () => gate.promise,
        fetch: async () => { calls++; return {}; }
    };
    vm.createContext(ctx); vm.runInContext(extractAppFunction('validateInventoryReadProjection'), ctx); vm.runInContext(html.slice(from, to), ctx);
    const pending = ctx.fetchWithTimeout('https://fixture.invalid', { signal: controller.signal });
    controller.abort(); gate.resolve(null);
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED');
    assert.equal(calls, 0);
});

function requestQueueLifecycleFixture() {
    const calls = [], warnings = [];
    const ctx = { Error, Object, String, AbortController,
        productionLiveSyncNavigation: new AbortController(),
        REQUEST_QUEUE_LIVE_ROWS_TABLE: 'ph_request_queue_live_rows', ACTIVE_REQUEST_TABLE: 'ph_active_request', ACTIVE_REQUEST_LIVE_ROWS_TABLE: 'ph_active_request_live_rows',
        isRequestQueueLiveRowsViewMissingError: error => error?.code === '42P01' && /ph_request_queue_live_rows/i.test(error?.message || ''),
        console: { warn: (...args) => warnings.push(args) },
        transport: async () => [{ unique_id: 'isolated-request' }],
        fetchAllSupabaseRows: (table, query, options) => {
            calls.push({ table, query, options });
            return ctx.transport(table, query, options);
        }
    };
    vm.createContext(ctx);
    const from = html.indexOf('let activeRequestLiveRowsViewReady =');
    const to = html.indexOf('async function fetchSupabasePage(', from);
    assert.ok(from > 0 && to > from);
    vm.runInContext(html.slice(from, to), ctx);
    return { ctx, calls, warnings, ready: () => vm.runInContext('activeRequestLiveRowsViewReady', ctx) };
}

test('request queue reads do not start after navigation or poison view availability on cancellation', async () => {
    const { ctx, calls, warnings, ready } = requestQueueLifecycleFixture();
    ctx.productionLiveSyncNavigation.abort();
    await assert.rejects(ctx.fetchActiveRequestLiveRows(), error => error.code === 'REQUEST_ABORTED');
    assert.equal(calls.length, 0);
    assert.equal(ready(), null);
    assert.equal(warnings.length, 0);
});

test('navigation during a request queue read aborts the same read and never launches the fallback', async () => {
    const { ctx, calls, warnings, ready } = requestQueueLifecycleFixture();
    const gate = deferred();
    ctx.transport = async () => { await gate.promise; throw new TypeError('Load failed'); };
    const pending = ctx.fetchActiveRequestLiveRows();
    await settle();
    const signal = ctx.productionLiveSyncNavigation.signal;
    ctx.productionLiveSyncNavigation.abort();
    gate.resolve();
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED');
    assert.equal(calls.length, 1, 'a teardown failure must not launch an authenticated fallback');
    assert.equal(calls[0].options.signal, signal);
    assert.equal(signal.aborted, true);
    assert.equal(ready(), null, 'navigation is not evidence the database view is missing');
    assert.equal(warnings.length, 0);
    ctx.productionLiveSyncNavigation = new AbortController();
    ctx.transport = async () => [{ unique_id: 'restored-request' }];
    assert.equal((await ctx.fetchActiveRequestLiveRows())[0].unique_id, 'restored-request');
    assert.equal(calls[1].table, 'ph_request_queue_live_rows');
    assert.equal(ready(), true);
});

test('request queue navigation rejects late successful data without changing view availability', async () => {
    const { ctx, calls, ready } = requestQueueLifecycleFixture();
    const gate = deferred();
    ctx.transport = () => gate.promise;
    const pending = ctx.fetchActiveRequestLiveRows();
    await settle();
    ctx.productionLiveSyncNavigation.abort();
    gate.resolve([{ unique_id: 'old-document' }]);
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED');
    assert.equal(calls.length, 1);
    assert.equal(ready(), null);
});

test('active request queue still falls back for real view failures and shares its navigation signal', async () => {
    const { ctx, calls, warnings, ready } = requestQueueLifecycleFixture();
    ctx.transport = async table => {
        if (table === 'ph_request_queue_live_rows') throw Object.assign(new Error('relation ph_request_queue_live_rows does not exist'), { code: '42P01' });
        return [{ unique_id: 'pending-request' }];
    };
    assert.equal((await ctx.fetchActiveRequestLiveRows())[0].unique_id, 'pending-request');
    assert.deepEqual(calls.map(call => call.table), ['ph_request_queue_live_rows', 'ph_active_request_live_rows']);
    assert.ok(calls.every(call => call.options.signal === ctx.productionLiveSyncNavigation.signal));
    assert.equal(ready(), false);
    assert.equal(warnings.length, 1);
    assert.equal((await ctx.fetchActiveRequestLiveRows())[0].unique_id, 'pending-request');
    assert.equal(calls[2].table, 'ph_active_request_live_rows');
    assert.equal(warnings.length, 1);
});

test('navigation stops visible-document reads until restoration or trusted interaction', () => {
    const handlers = new Map(), signals = [], suspends = [];
    const listen = target => (name, callback) => {
        const key = `${target}:${name}`;
        handlers.set(key, [...(handlers.get(key) || []), callback]);
    };
    const dispatch = (target, name, isTrusted = true) => {
        for (const callback of handlers.get(`${target}:${name}`) || []) callback({ type: name, isTrusted });
    };
    const coordinator = { suspend: () => suspends.push('suspend'), signal: reason => signals.push(reason) };
    const document = { hidden: false, addEventListener: listen('document'), body: { classList: { contains: () => true } } };
    const window = { document, AbortController, console, addEventListener: listen('window'),
        setTimeout, clearTimeout, requestIdleCallback: callback => setTimeout(callback, 0), cancelIdleCallback: clearTimeout };
    const ctx = { AbortController, console, document, window, inventoryStatusPendingSaves: new Map(),
        invalidateProductionLiveSyncProofForSuspend() {},
        appAccessSnapshotState: { status: 'ready', stale: false, username: 'fixture' }, currentUser: 'fixture', getRequestCapabilityUsernameKey: value => value,
        productionLiveSyncCoordinator: coordinator,
        getProductionLiveSyncCoordinator: () => coordinator, canUseProductionLiveSync: () => false,
        observeHlOrderVerificationContext: value => value, navigator: { onLine: true }
    };
    vm.createContext(ctx);
    vm.runInContext(lifecycle, ctx, { filename: 'assets/app-lifecycle.js' });
    ctx.productionLiveSyncNavigation = { get signal() { return ctx.window.AgMetricLifecycle.getSignal('session'); } };
    const original = ctx.productionLiveSyncNavigation.signal;
    const contextStart = html.indexOf('function getProductionLiveSyncContext()');
    vm.runInContext(html.slice(contextStart, html.indexOf('function renderProductionDataFreshness(', contextStart)), ctx);
    const from = html.indexOf('function signalProductionLiveSync(');
    vm.runInContext(html.slice(from, html.indexOf("document.addEventListener('focusout'", from)), ctx);
    dispatch('window', 'beforeunload');
    assert.equal(original.aborted, true);
    assert.equal(ctx.getProductionLiveSyncContext().visible, false, 'beforeunload precedes document.hidden');
    ctx.signalProductionLiveSync('loader');
    dispatch('document', 'pointerdown', false);
    dispatch('window', 'focus', false);
    assert.deepEqual(signals, []);
    dispatch('document', 'pointerdown');
    assert.equal(ctx.getProductionLiveSyncContext().visible, true);
    assert.deepEqual(signals, ['pointerdown']);
    assert.equal(original.aborted, true, 'old reads cannot inherit the resumed signal');
    dispatch('window', 'pagehide');
    ctx.document.hidden = true;
    dispatch('window', 'pageshow');
    assert.equal(ctx.getProductionLiveSyncContext().visible, false);
    ctx.document.hidden = false;
    dispatch('window', 'pageshow');
    assert.equal(ctx.getProductionLiveSyncContext().visible, true);
    assert.deepEqual(signals, ['pointerdown', 'pageshow']);
    assert.equal(suspends.length, 3, 'both navigations and a blocked loader suspend the coordinator');
});
function fixture(concurrency = 3) {
    const ctx = { Map, Promise, JSON, String, Number, Math, Date, Error, AbortController, setTimeout, clearTimeout, SUPABASE_READ_CONCURRENCY_LIMIT: concurrency,
        SUPABASE_URL: 'https://fixture.invalid', currentUser: 'dylan_collyge', currentRole: 'Admin', currentUserDivision: '10',
        nativeAuthSessionActive: true, nativeAuthProfile: { id: 'user-a' }, incrementInternalPerfCounter() {}, getCurrentLoginCacheScopeKey: () => 'scope'
    };
    vm.createContext(ctx);
    vm.runInContext(evalSecurityHelpers + html.slice(start, end) + '\nthis.generation = () => { productionLiveSyncReadGeneration++; abortSupabaseReadsBeforeGeneration(productionLiveSyncReadGeneration); }; this.permission = value => { productionLiveSyncReadPermissionVersion = value; }; this.resetAuth = () => { productionLiveSyncReadAuthEpoch++; }; this.reads = supabaseReadInFlight;', ctx);
    return ctx;
}

test('identical same-scope reads within one verified generation share a request', async () => {
    const ctx = fixture(); const gate = deferred(); let calls = 0;
    const one = ctx.runDedupeSupabaseRead('all:soc:query', async () => { calls++; return gate.promise; });
    const two = ctx.runDedupeSupabaseRead('all:soc:query', async () => { calls++; return ['wrong']; });
    assert.equal(one, two); gate.resolve(['rows']);
    assert.deepEqual(await one, ['rows']); assert.equal(calls, 1); assert.equal(ctx.reads.size, 0);
});

test('a fresh snapshot generation cannot join a pre-revision inventory read', async () => {
    const ctx = fixture(); const gate = deferred(); let calls = 0;
    const old = ctx.runDedupeSupabaseRead('all:soc:query', ({ signal } = {}) => {
        calls++;
        return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'REQUEST_ABORTED' })), { once: true });
            gate.promise.then(resolve, reject);
        });
    });
    const oldRejected = assert.rejects(old, error => error.code === 'REQUEST_ABORTED');
    await settle(); ctx.generation();
    const fresh = ctx.runDedupeSupabaseRead('all:soc:query', async () => { calls++; return ['new-generation']; });
    assert.notEqual(old, fresh);
    await oldRejected;
    await new Promise(resolve => setTimeout(resolve, 0));
    await settle();
    assert.equal(calls, 2, 'new generation starts only after the old signal aborts and its request settles');
    assert.deepEqual(await fresh, ['new-generation']);
});

test('account switching rejects old in-flight data and never shares it with the new account', async () => {
    const ctx = fixture(); const gate = deferred();
    const old = ctx.runDedupeSupabaseRead('all:requests:query', () => gate.promise);
    const rejected = assert.rejects(old, /account or data permissions changed/);
    await settle(); ctx.currentUser = 'other'; ctx.nativeAuthProfile = { id: 'user-b' };
    const fresh = ctx.runDedupeSupabaseRead('all:requests:query', async () => ['user-b-rows']);
    assert.deepEqual(await fresh, ['user-b-rows']);
    gate.resolve(['user-a-rows']); await rejected;
});

test('a read captured under an old account is rejected if identity changes before dispatch', async () => {
    const ctx = fixture(); let oldCalls = 0;
    const pending = ctx.runDedupeSupabaseRead('before-dispatch', async () => { oldCalls++; return []; });
    const rejected = assert.rejects(pending, /permissions changed/);
    ctx.currentUserDivision = '20';
    await rejected;
    assert.equal(oldCalls, 0);
});

test('same-role permission changes and logout-login epochs discard earlier reads', async () => {
    for (const change of [(ctx) => ctx.permission('new-policy'), (ctx) => ctx.resetAuth()]) {
        const ctx = fixture(); const gate = deferred();
        const pending = ctx.runDedupeSupabaseRead('request', () => gate.promise);
        const rejected = assert.rejects(pending, /permissions changed/);
        await settle(); change(ctx); gate.resolve(['stale']); await rejected;
    }
});

test('generation handoff leaves one in-flight request for a dataset', async () => {
    const ctx = fixture(); const oldGate = deferred(); const freshGate = deferred(); let calls = 0;
    const old = ctx.runDedupeSupabaseRead('same', ({ signal } = {}) => {
        calls++;
        return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'REQUEST_ABORTED' })), { once: true });
            oldGate.promise.then(resolve, reject);
        });
    });
    const oldRejected = assert.rejects(old, error => error.code === 'REQUEST_ABORTED');
    await settle(); ctx.generation();
    const fresh = ctx.runDedupeSupabaseRead('same', async () => { calls++; return freshGate.promise; });
    await oldRejected;
    await new Promise(resolve => setTimeout(resolve, 0));
    await settle();
    assert.equal(calls, 2, 'the fresh request starts after the old generation has settled');
    assert.equal(ctx.reads.size, 1);
    const duplicate = ctx.runDedupeSupabaseRead('same', async () => { calls++; return ['wrong']; });
    assert.equal(ctx.reads.size, 1);
    assert.equal(calls, 2, 'a duplicate joins the current generation rather than starting a second fetch');
    freshGate.resolve([]); await fresh; assert.equal(ctx.reads.size, 0);
    assert.deepEqual(await duplicate, []);
});

test('settings-only updates rebuild current-season collections from verified inventory without a download', () => {
    const marker = 'commitSnapshots: (snapshots, context, metadata) => {';
    const from = html.indexOf(marker);
    const to = html.indexOf('\n                subscribe:', from);
    assert.ok(from > 0 && to > from);
    const callback = html.slice(from + 'commitSnapshots: '.length, to).trim().replace(/,$/, '');
    const previous = [{ UNIQUE_ID: 'spring', SEASON: 'S1' }, { UNIQUE_ID: 'fall', SEASON: 'F1' }];
    const calls = [], state = { fullLoaded: false, fieldCoverage: 'browse', rowCompleteness: 'complete', liveVerifiedScope: 'actor-a', liveVerifiedPermission: 'policy-a', liveVerifiedRevision: '10' };
    const context = { scope: 'actor-a' }, metadata = { permissionVersion: 'policy-a', sources: new Map([['ph_master_inventory', { state: 'ready', revision: '10' }]]) };
    const ctx = { Object, Array, Date, fullInventory: previous, season: 'S1', calls,
        getSupabaseReadIdentityScope: () => context.scope,
        getProductionLiveSyncContext: () => ({ adapters: [{ id: 'side:settings' }] }),
        getDatasetState: () => state, TRACKED_VIEW_IDS: [], invalidateResolvedViewStateCaches() {}, markViewDirty() {}, persistCurrentCache() {}, scheduleProductionLiveSyncRender() {},
        refreshLiveLocMatchQuantityPreviews() {},
        processAndLoadData: (payload) => { calls.push(payload); ctx.visibleRows = payload.data.filter((row) => row.SEASON === ctx.season); }
    };
    vm.createContext(ctx);
    const queueRevisionStart = html.indexOf('function acceptQueueInventorySourceRevision(');
    const queueRevisionEnd = html.indexOf('\n        function ', queueRevisionStart + 10);
    assert.ok(queueRevisionStart > 0 && queueRevisionEnd > queueRevisionStart, 'queue revision helper boundary');
    vm.runInContext(`let queueCardInventoryHydrator = null; let queueCardInventoryIndex = null; let queueCardInventoryRevisionReceipt = null;\n`
        + html.slice(queueRevisionStart, queueRevisionEnd)
        + `\nthis.commit = ${callback}`, ctx);
    ctx.commit([{ adapter: { id: 'side:settings', commit: () => { ctx.season = 'F1'; } }, value: {} }], context, metadata);
    assert.deepEqual(ctx.visibleRows.map((row) => row.UNIQUE_ID), ['fall']);
    assert.equal(calls[0]._verifiedLiveSync, true);
    assert.notEqual(calls[0].data[0], previous[0]);
    assert.deepEqual(previous.map((row) => row.SEASON), ['S1', 'F1']);
    calls.length = 0; state.rowCompleteness = 'unknown';
    ctx.commit([{ adapter: { id: 'side:settings', commit() {} }, value: {} }], context, metadata);
    assert.equal(calls.length, 0, 'an incomplete master cache is not promoted to a verified source');
    state.rowCompleteness = 'complete';
    for (const field of ['liveVerifiedScope', 'liveVerifiedPermission', 'liveVerifiedRevision']) {
        const saved = state[field]; state[field] = 'stale';
        ctx.commit([{ adapter: { id: 'side:settings', commit() {} }, value: {} }], context, metadata);
        assert.equal(calls.length, 0, `${field} prevents stale cache promotion`);
        state[field] = saved;
    }
});

test('AV and inventory resolve to one identical authoritative read descriptor', async () => {
    const from = html.indexOf('const productionLiveSyncReadSignalIds');
    const to = html.indexOf('function getProductionLiveSyncContext()', from);
    const ctx = { JSON, Error, Array, AbortController, productionLiveSyncNavigation: new AbortController(), DATASET_DEFINITIONS: {
        master: { table: 'ph_master_inventory', fullQuery: 'select=*&order=unique_id.asc' },
        avOpen: { table: 'ph_master_inventory', fullQuery: 'select=*&season=in.(F1,S1,U1,U2)' }
    }, window: { AgMetricLiveSyncRegistry: { getSourceKeys: () => ['ph_master_inventory'] }, AgMetricInventoryList: inventoryContract },
        season: { seasonCode: 'S1', salesYear: 27 }, getCurrentAppSeasonSettings: () => ctx.season,
        fetchAllSupabaseRows: async () => [], fetchInventoryReadPage: async (operation, params) => {
            ctx.inventoryRead = { operation, params };
            return { rows: [], total: 0, projection: params.projection, fieldCoverage: params.projection, columns: params.projection === 'full' ? inventoryContract.physicalColumns : inventoryContract.columns };
        }, yieldToUiFrame: async () => {}, buildDatasetPayload: (key, rows) => ({ key, rows }),
        getSupabaseReadIdentityScope: () => 'owner', appAccessSnapshotState: { snapshot: { dataPermissionVersion: 'policy-a' } },
        currentMasterPreparationSeasonKey: () => 'season-a',
        prepareProductionMasterSnapshot: async (rows, options = {}) => ({
            rawRows: options.includeRawRows === false ? [] : JSON.parse(JSON.stringify(rows)),
            payload: { data: rows }, rowCount: rows.length
        }),
        canUseHlOrder: () => false }; // This original AV fixture is outside the Dylan-only HL surface.
    vm.createContext(ctx); vm.runInContext(extractAppFunction('validateInventoryReadProjection'), ctx); vm.runInContext(html.slice(from, to), ctx);
    const master = ctx.createProductionCoreLiveAdapter('master'), av = ctx.createProductionCoreLiveAdapter('avOpen');
    assert.equal(av.id, 'core:master'); assert.equal(av.cacheKey, master.cacheKey);
    const staged = await av.stage();
    assert.equal(staged.key, 'master');
    assert.equal(staged.rowCompleteness, 'complete', 'browse rows become complete only after requireComplete pagination succeeds');
    assert.equal(staged.hlOrderInventory, null, 'ordinary AV staging does not acquire an HL snapshot');
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.inventoryRead)), { operation: 'master_page', params: { dataset: 'master', projection: 'browse' } });
    ctx.season = { seasonCode: 'F1', salesYear: 27 };
    assert.notEqual(ctx.createProductionCoreLiveAdapter('master').cacheKey, master.cacheKey,
        'season changed off-screen cannot retain old derived inventory under unchanged stock revisions');
    assert.equal(ctx.createProductionCoreLiveAdapter('master').projection, 'browse', 'ordinary tab entry stays on the compact browse contract');
    const full = ctx.createProductionCoreLiveAdapter('master', 'full');
    assert.equal(full.projection, 'full');
    assert.notEqual(ctx.createProductionCoreLiveAdapter('master', 'browse').cacheKey, full.cacheKey,
        'an explicit full-read adapter does not change the ordinary browse descriptor');
    assert.equal(ctx.createProductionCoreLiveAdapter('master', 'browse').projection, 'browse');
});

test('foreground full-master consumers keep live refreshes full without widening ordinary browse views', () => {
    const ctx = { Array, JSON, activeAVTab: 'open', shouldUseRepAvOpenDataset: () => false,
        pendingMasterFullHydrations: new Map(), getSupabaseReadIdentityScope: () => 'owner' };
    vm.createContext(ctx);
    vm.runInContext(extractAppFunction('getProductionCoreLiveProjection'), ctx);
    assert.equal(ctx.getProductionCoreLiveProjection('master', 'production-workflow'), 'full');
    assert.equal(ctx.getProductionCoreLiveProjection('master', 'managers', { surfaces: ['managers:eval-reports-2'] }), 'full');
    assert.equal(ctx.getProductionCoreLiveProjection('master', 'managers', { surfaces: ['managers:eval-reports'] }), 'full');
    assert.equal(ctx.getProductionCoreLiveProjection('master', 'drive'), 'browse');
    assert.equal(ctx.getProductionCoreLiveProjection('master', 'av'), 'full');
    assert.equal(ctx.getProductionCoreLiveProjection('requests', 'production-workflow'), 'browse');
    for (const view of ['sales-office', 'moves', 'tasks', 'low-stock', 'review', 'move-up', 'advertisement', 'grower', 'shear-list', 'weather-hold', 'reports']) {
        assert.equal(ctx.getProductionCoreLiveProjection('master', view), 'full', `${view} retains its full snapshot during live refresh`);
    }
    assert.equal(ctx.getProductionCoreLiveProjection('master', 'sales-inventory'), 'browse');
    assert.equal(ctx.getProductionCoreLiveProjection('master', 'sales-inventory', { surfaces: ['sales-inventory:counting'] }), 'full');
    assert.equal(ctx.getProductionCoreLiveProjection('master', 'request', { surfaces: ['request:pending'] }), 'browse');
    assert.equal(ctx.getProductionCoreLiveProjection('master', 'request', { surfaces: ['request:eval-work'] }), 'full');
});

test('AV canonicalizes its master aliases before building live adapters', () => {
    const context = { Array, Set };
    vm.createContext(context);
    vm.runInContext(extractAppFunction('canonicalizeProductionCoreLiveKeys'), context);
    assert.deepEqual(Array.from(context.canonicalizeProductionCoreLiveKeys(['avOpen', 'master', 'reserves', 'master'])),
        ['master', 'reserves']);
    assert.match(extractAppFunction('getProductionLiveSyncContext'),
        /canonicalizeProductionCoreLiveKeys\(registry\.getCoreKeys\(targetView, targetContext\)\)/);
});

test('full row hydration pins its projection across refreshes and clears after success, failure, and scope changes', async () => {
    for (const outcome of ['success', 'failure', 'account-change', 'navigation-change']) {
        const gate = deferred(), map = new Map();
        const ctx = { Array, JSON, String, console, pendingMasterFullHydrations: map, owner: 'owner-a', view: 'drive', ready: false,
            activeAVTab: 'open', shouldUseRepAvOpenDataset: () => false,
            isMasterFullProjectionReady: () => ctx.ready,
            getSupabaseReadIdentityScope: () => ctx.owner, getCurrentVisibleViewId: () => ctx.view, showToast() {},
            ensureDatasetLoaded: async () => { await gate.promise; if (outcome === 'failure') return false; ctx.ready = true; return true; } };
        vm.createContext(ctx);
        vm.runInContext(extractAppFunction('getProductionCoreLiveProjection'), ctx);
        vm.runInContext(extractAppFunction('ensureMasterFullProjection'), ctx);
        const pending = ctx.ensureMasterFullProjection('editing Item Inquiry fields');
        assert.equal(ctx.getProductionCoreLiveProjection('master', 'drive'), 'full');
        assert.equal(ctx.getProductionCoreLiveProjection('master', 'av'), 'browse');
        if (outcome === 'account-change') ctx.owner = 'owner-b';
        if (outcome === 'navigation-change') ctx.view = 'av';
        assert.equal(ctx.getProductionCoreLiveProjection('master', ctx.view), outcome.includes('change') ? 'browse' : 'full');
        gate.resolve();
        assert.equal(await pending, outcome === 'success');
        assert.equal(map.size, 0);
        assert.equal(ctx.getProductionCoreLiveProjection('master', 'drive'), 'browse');
    }
});

test('a metadata refresh during Reclass hydration cannot replace the full proof with browse rows', async () => {
    const sandbox = { module: { exports: {} }, setTimeout, clearTimeout, AbortController };
    vm.runInNewContext(readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8'), sandbox);
    const { createCoordinator } = sandbox.module.exports;
    const reads = [], ctx = { Array, JSON, console, pendingMasterFullHydrations: new Map(),
        getSupabaseReadIdentityScope: () => 'owner', getCurrentVisibleViewId: () => 'drive', showToast() {},
        isMasterFullProjectionReady: () => ctx.coverage === 'full', coverage: 'browse' };
    vm.createContext(ctx);
    vm.runInContext(extractAppFunction('getProductionCoreLiveProjection'), ctx);
    vm.runInContext(extractAppFunction('ensureMasterFullProjection'), ctx);
    let coordinator, queued = false;
    const adapter = projection => ({ id: 'core:master', cacheKey: projection, sourceKeys: ['master'],
        stage: async () => { reads.push(projection); if (projection === 'full' && !queued) {
            queued = true; void coordinator.check('metadata');
        } return { projection }; }, commit: value => { ctx.coverage = value.projection; } });
    coordinator = createCoordinator({ getContext: () => ({ scope: 'owner', viewKey: 'drive', visible: true, online: true,
        adapters: [adapter(ctx.getProductionCoreLiveProjection('master', 'drive'))] }),
        readRevisions: async () => ({ contractVersion: 1, permissionVersion: 'p1', sources: [{ key: 'master', revision: '1', state: 'ready' }] }),
        setTimeout: () => 1, clearTimeout() {} });
    ctx.ensureDatasetLoaded = async () => coordinator.ensure(adapter('full'), true);
    assert.equal(await ctx.ensureMasterFullProjection('editing Reclass'), true);
    assert.deepEqual(reads, ['full']);
    assert.equal(ctx.coverage, 'full');
    assert.equal(ctx.pendingMasterFullHydrations.size, 0);
    assert.equal(ctx.getProductionCoreLiveProjection('master', 'drive'), 'browse');
});

test('inventory read metadata must exactly match the requested browse or full contract', () => {
    const ctx = { String, Array, window: { AgMetricInventoryList: inventoryContract } };
    vm.createContext(ctx); vm.runInContext(extractAppFunction('validateInventoryReadProjection'), ctx);
    assert.equal(ctx.validateInventoryReadProjection({ projection: 'full', fieldCoverage: 'full', columns: inventoryContract.physicalColumns }, { projection: 'full' }), true);
    assert.equal(ctx.validateInventoryReadProjection({ projection: 'browse', fieldCoverage: 'browse', columns: inventoryContract.columns }, { projection: 'browse' }), true);
    for (const response of [
        { fieldCoverage: 'full', columns: inventoryContract.physicalColumns },
        { projection: 'full', fieldCoverage: 'full', columns: inventoryContract.physicalColumns.slice(0, -1) },
        { projection: 'browse', fieldCoverage: 'full', columns: inventoryContract.physicalColumns }
    ]) assert.throws(() => ctx.validateInventoryReadProjection(response, { projection: 'full' }), /missing or invalid/i);
});

test('a master snapshot without proven full coverage is not usable as a full dataset', () => {
    let state = { fullLoaded: true };
    const ctx = { getDatasetState: () => state };
    vm.createContext(ctx); vm.runInContext(extractAppFunction('isDatasetLoaded'), ctx);
    assert.equal(ctx.isDatasetLoaded('master', 'full'), false);
    state = { fullLoaded: true, fieldCoverage: 'browse' };
    assert.equal(ctx.isDatasetLoaded('master', 'full'), false);
    state = { fullLoaded: true, fieldCoverage: 'full' };
    assert.equal(ctx.isDatasetLoaded('master', 'full'), true);
});

test('HL cards accept a complete verified browse snapshot without treating browse fields as full coverage', () => {
    const owner = { readIdentity: 'native:dylan' };
    const context = { scope: 'scope-a', viewKey: 'hl-order', adapters: [{ id: 'core:master' }, { id: 'core:soc' }] };
    const status = { state: 'Up to date', lastVerifiedAt: 'verified-1' };
    const states = {
        master: { rowCompleteness: 'complete', fieldCoverage: 'browse', fullLoaded: false, liveVerifiedScope: 'scope-a', liveVerifiedPermission: 'policy-a', liveVerifiedRevision: '7' },
        soc: { fullLoaded: true, liveVerifiedScope: 'scope-a', liveVerifiedPermission: 'policy-a', liveVerifiedRevision: '3' }
    };
    const ctx = {
        document: { hidden: false }, navigator: { onLine: true },
        hlOrderInventorySnapshot: { owner, scope: 'scope-a', permission: 'policy-a', revision: '7', rows: new Map() },
        hlOrderVerificationContext: { key: 'hl-context', owner, lastVerifiedAt: 'verified-1' },
        canUseHlOrder: () => true, isHlOrderOwnershipCurrent: candidate => candidate === owner,
        canUseProductionLiveSync: () => true, getProductionLiveSyncContext: () => context,
        getProductionLiveSyncCoordinator: () => ({ getStatus: () => status }),
        getHlOrderVerificationContextKey: () => 'hl-context', getDatasetState: key => states[key]
    };
    vm.createContext(ctx);
    vm.runInContext(extractAppFunction('canUseHlOrderVerifiedData'), ctx);
    vm.runInContext(extractAppFunction('isDatasetLoaded'), ctx);
    assert.equal(ctx.canUseHlOrderVerifiedData(['master']), true);
    assert.equal(ctx.isDatasetLoaded('master', 'full'), false, 'browse rows do not satisfy full-projection consumers');
    states.master.rowCompleteness = 'partial';
    assert.equal(ctx.canUseHlOrderVerifiedData(['master']), false, 'a partial browse set cannot authorize HL display');
    states.master.rowCompleteness = 'complete'; states.master.fieldCoverage = 'initial';
    assert.equal(ctx.canUseHlOrderVerifiedData(['master']), false, 'unknown field coverage cannot authorize HL display');
});

test('an explicit full coordinator read does not turn later ordinary refreshes into full downloads', async () => {
    const projections = [];
    const adapterStart = html.indexOf('const productionLiveSyncReadSignalIds');
    const adapterEnd = html.indexOf('function getProductionLiveSyncContext()', adapterStart);
    const ctx = {
        JSON, Error, Array, AbortController, Promise, Set, Map,
        productionLiveSyncNavigation: new AbortController(),
        DATASET_DEFINITIONS: { master: { table: 'ph_master_inventory', initialQuery: 'select=browse', fullQuery: 'select=full' } },
        window: { AgMetricLiveSyncRegistry: { getSourceKeys: () => ['ph_master_inventory'] } },
        getCurrentAppSeasonSettings: () => ({ seasonCode: 'F1', salesYear: 27 }),
        getProductionLiveSyncCoordinator: () => ({ ensure: async adapter => { projections.push(adapter.projection); return true; } }),
        canUseProductionLiveSync: () => true, RETIRED_DATASET_KEYS: new Set()
        , getProductionLiveSyncContext: () => ({ scope: 'owner', dataPermissionVersion: 'policy', adapters: [] })
    };
    vm.createContext(ctx);
    vm.runInContext(html.slice(adapterStart, adapterEnd), ctx);
    vm.runInContext(extractAppFunction('ensureDatasetLoaded'), ctx);
    await ctx.ensureDatasetLoaded('master', 'full', { force: true });
    await ctx.ensureDatasetLoaded('master', 'initial', { force: true });
    assert.deepEqual(projections, ['full', 'browse']);
});

test('detail hydration applies only to compact master rows, never Request or other source identities', () => {
    let full = false;
    const ctx = { String, isMasterFullProjectionReady: () => full };
    vm.createContext(ctx);
    vm.runInContext(extractAppFunction('needsMasterDetailHydration'), ctx);
    assert.equal(ctx.needsMasterDetailHydration({ SOURCE_TABLE: 'ph_master_inventory', UNIQUE_ID: 'shared-id' }), true);
    assert.equal(ctx.needsMasterDetailHydration({ source_table: 'ph_master_inventory', unique_id: 'shared-id' }), true);
    for (const table of ['ph_active_request', 'ph_request_history', 'ph_reserves', 'ph_soc_master', 'ph_cav_inventory']) {
        assert.equal(ctx.needsMasterDetailHydration({ SOURCE_TABLE: table, UNIQUE_ID: 'shared-id' }), false, table);
    }
    assert.equal(ctx.needsMasterDetailHydration(null), false);
    assert.equal(ctx.needsMasterDetailHydration({ UNIQUE_ID: 'unknown-source' }), false);
    full = true;
    assert.equal(ctx.needsMasterDetailHydration({ SOURCE_TABLE: 'ph_master_inventory' }), false);
    assert.match(extractAppFunction('openDetail'), /const detailListItem =[\s\S]*resolveDetailItemBySource\(uid, resolvedSourceView, openOptions\);[\s\S]*needsMasterDetailHydration\(detailListItem\)/);
    assert.match(extractAppFunction('openInventoryEditRequestModal'), /const compactEditItem =[\s\S]*findInventoryEditMockItemByUid\(uid\)[\s\S]*needsMasterDetailHydration\(compactEditItem\)/);
});

test('master detail hydration selects exactly one full row inside a stable permission and revision fence', async () => {
    const revisions = ['revision-8', 'revision-8'];
    const calls = [];
    const identity = { value: 'account-a' };
    const context = { scope: identity.value, dataPermissionVersion: 'access-v1' };
    const revisionResponse = revision => ({ permissionVersion: 'access-v1', sources: new Map([['ph_master_inventory', { state: 'ready', revision }]]) });
    const ctx = {
        String, Error, Object, Set, Map, Array, AbortController,
        firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') || '',
        getSupabaseReadIdentityScope: () => identity.value,
        withProductionLiveSyncSignal: async (_signal, operation) => operation(new AbortController().signal),
        canUseProductionLiveSync: () => true,
        getProductionLiveSyncContext: () => context,
        supabaseRpc: async (name, params, options) => { calls.push({ name, params, options }); return revisionResponse(revisions.shift()); },
        fetchInventoryReadPage: async (...args) => {
            calls.push(args);
            return { total: 1, rows: [{ unique_id: 'uid-1', itemcode: '003955.030.1', ptravailable: 12 }], projection: 'full', fieldCoverage: 'full', columns: inventoryContract.physicalColumns };
        },
        formatFetchedRows: rows => rows.map(row => ({ UNIQUE_ID: row.unique_id, ITEMCODE: row.itemcode, PTRAVAILABLE: row.ptravailable })),
        window: { AgMetricLiveSync: { snapshot: (value, keys) => {
            assert.equal(JSON.stringify(keys), '["ph_master_inventory"]');
            assert.equal(value.permissionVersion, 'access-v1');
            return value;
        }, isReadableSource: source => source?.state === 'ready',
        readSourceToken: source => JSON.stringify([source?.revision || '', source?.state || '']) }, AgMetricInventoryList: inventoryContract },
        staleSupabaseReadScopeError: () => Object.assign(new Error('scope changed'), { code: 'DATASET_READ_SCOPE_CHANGED' })
    };
    vm.createContext(ctx);
    vm.runInContext(extractAppFunction('validateInventoryReadProjection'), ctx);
    vm.runInContext(extractAppFunction('loadExactMasterDetailRow'), ctx);
    const row = await ctx.loadExactMasterDetailRow('uid-1');
    assert.deepEqual(JSON.parse(JSON.stringify(row)), { UNIQUE_ID: 'uid-1', ITEMCODE: '003955.030.1', PTRAVAILABLE: 12 });
    assert.equal(JSON.stringify(calls[1].slice(0, 4)), '["master_page",{"dataset":"lookup","projection":"full","uniqueId":"uid-1"},1,0]');
    assert.ok(calls[1][4]?.signal);
    assert.equal(calls[1][4]?.label, 'Inventory row details');
    assert.equal(calls.length, 3, 'the exact row is bracketed by two revision reads');
});

test('openDetail opens the authorized current master card immediately and fills only untouched fields after one revision-race retry', async () => {
    let view = 'drive';
    const identity = 'account-a';
    const fallback = { UNIQUE_ID: 'uid-rosy', SOURCE_TABLE: 'ph_master_inventory', ITEMCODE: '010539.030.1', LOCATIONCODE: 'F.16.000', LOTCODE: '27.F1', COMMONNAME: 'Rosy Muhly' };
    const secondRead = deferred();
    let exactReads = 0;
    const renderCalls = [];
    const ctx = {
        String, Object, Set, Math, Date,
        firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') || '',
        activeItem: null, activeDetailSourceView: '', lastView: 'drive', pendingDetailTapStartedAt: 0,
        detailHydrationToken: 0, DETAIL_HYDRATION_DELAY_MS: 180,
        getSupabaseReadIdentityScope: () => identity,
        getCurrentVisibleViewId: () => view,
        getProductionLiveSyncContext: () => ({ scope: identity, dataPermissionVersion: 'access-v1' }),
        isMasterInventoryRowVisibleToCurrentUser: row => row === fallback || String(row?.UNIQUE_ID || '') === 'uid-rosy',
        needsMasterDetailHydration: row => row?.SOURCE_TABLE === 'ph_master_inventory',
        resolveDetailItemBySource: () => fallback,
        loadExactMasterDetailRow: async () => {
            exactReads += 1;
            if (exactReads === 1) throw new Error('Inventory changed while opening this row. Reopen it to load a consistent copy.');
            return secondRead.promise;
        },
        beginInternalPerfMeasure: () => 1, recordInternalPerfDuration() {}, beginDirectNavigationActivity() {},
        rememberDetailReturnPosition() {}, armDetailCameraInputGuard() {}, clearPendingDetailHydration() {},
        markDetailTransitionActivity() {}, resetDriveCustomerOutreachState() {}, resetDetailOverviewFieldSearch() {},
        getPrimaryDetailTabForItemContext: () => 'overview', resolveVisibleDetailTab: value => value || 'overview',
        renderDetailShellView() {}, showPrimaryViewWithScrollPolicy: () => { view = 'detail'; },
        schedulePrimaryViewChromeRefresh() {}, scheduleDeferredDetailHydration() {}, shouldShowRequestOpenInfoModal: () => false,
        isTouchConstrainedDevice: () => false, getCurrentPrimaryViewId: () => 'detail',
        populateDetailSummaryValues: (row) => renderCalls.push(['summary', row.COMMONNAME]),
        renderDriveDetailOverviewFields: () => renderCalls.push(['overview']), refreshProtectedSections: () => renderCalls.push(['protected']),
        renderSavedPhotos: () => renderCalls.push(['photos']), scheduleUiRender: (_key, callback) => callback(),
        hasActiveTextEntryFocus: () => false, showToast: (...args) => renderCalls.push(['toast', ...args]),
        currentRole: 'Admin', currentUserDivision: '10'
    };
    vm.createContext(ctx);
    vm.runInContext(extractAppFunction('mergeExactMasterDetailFieldsPreservingLocalChanges'), ctx);
    vm.runInContext(extractAppFunction('openDetail'), ctx);

    ctx.openDetail('uid-rosy', 'drive');
    assert.equal(view, 'detail', 'the card detail shell opens synchronously without waiting for network refresh');
    assert.equal(ctx.activeItem.UNIQUE_ID, 'uid-rosy');
    assert.equal(ctx.activeItem.COMMONNAME, 'Rosy Muhly');
    await settle();
    assert.equal(exactReads, 2, 'only the explicit source-revision race retries once');
    ctx.activeItem.COMMONNAME = 'Unsaved draft name';
    secondRead.resolve({ UNIQUE_ID: 'uid-rosy', SOURCE_TABLE: 'ph_master_inventory', ITEMCODE: '010539.030.1', LOCATIONCODE: 'F.16.000', LOTCODE: '27.F1', COMMONNAME: 'Rosy Muhly (Full)', PTRAVAILABLE: 88 });
    await settle();
    assert.equal(ctx.activeItem.COMMONNAME, 'Unsaved draft name', 'a field edited while refresh was pending is preserved');
    assert.equal(ctx.activeItem.PTRAVAILABLE, 88, 'untouched full-row fields are added from the exact read');
    assert.ok(renderCalls.some(call => call[0] === 'summary'), 'the expanded detail is refreshed after safe merge');
    assert.ok(!renderCalls.some(call => call[0] === 'toast' && call[1] === 'Row Details Unavailable'));
});

test('master detail hydration discards a lookup when its source revision changes mid-read', async () => {
    let revision = 8;
    const ctx = {
        String, Error, Object, Set, Map, Array, AbortController,
        firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') || '',
        getSupabaseReadIdentityScope: () => 'account-a',
        withProductionLiveSyncSignal: async (_signal, operation) => operation(new AbortController().signal),
        canUseProductionLiveSync: () => true,
        getProductionLiveSyncContext: () => ({ scope: 'account-a', dataPermissionVersion: 'access-v1' }),
        supabaseRpc: async () => ({ permissionVersion: 'access-v1', sources: new Map([['ph_master_inventory', { state: 'ready', revision: String(revision++) }]]) }),
        fetchInventoryReadPage: async () => ({ total: 1, rows: [{ unique_id: 'uid-1' }], projection: 'full', fieldCoverage: 'full', columns: inventoryContract.physicalColumns }),
        formatFetchedRows: rows => rows.map(row => ({ UNIQUE_ID: row.unique_id })),
        window: { AgMetricLiveSync: { ...liveSync, snapshot: value => value }, AgMetricInventoryList: inventoryContract },
        staleSupabaseReadScopeError: () => Object.assign(new Error('scope changed'), { code: 'DATASET_READ_SCOPE_CHANGED' })
    };
    vm.createContext(ctx); vm.runInContext(extractAppFunction('validateInventoryReadProjection'), ctx); vm.runInContext(extractAppFunction('loadExactMasterDetailRow'), ctx);
    await assert.rejects(ctx.loadExactMasterDetailRow('uid-1'), /changed while opening/i);
});

function permissionFixture(options = {}) {
    const from = html.indexOf('async function refreshNativeRoleAndCapabilities(');
    const to = html.indexOf('function installNativeRoleRefreshWatchers()', from);
    const calls = [];
    const ctx = { String, Promise, Error, console: { warn() {} }, calls,
        NATIVE_AUTH_ENABLED: true, nativeAuthSessionActive: true, nativeRoleRefreshPromise: null,
        nativeAuthProfile: { id: 'account-a' }, captureProductionPermissionDrafts() {}, restoreProductionPermissionDrafts: async () => {},
        setProductionPermissionCheckState: () => {}, getCurrentVisibleViewId: () => 'home',
        currentUser: 'dylan_collyge', currentUserDisplay: 'Dylan', currentRole: 'Admin', currentUserDivision: '10', currentUserLanguage: 'English',
        loadNativeAuthProfile: async () => ({ id: 'account-a', username: 'dylan_collyge', role: options.role || 'Admin', division: options.division || '10' }),
        normalizeRoleAccessToken: (value) => String(value).toLowerCase(), normalizeAppUserLanguage: (value) => value,
        localStorage: { setItem() {} }, persistAppSessionRecord() {}, ensureNativeAppSessionBridge: async () => { calls.push('bridge'); return null; },
        clearRoleScopedClientCaches: () => { calls.push('clear'); ctx.appAccessSnapshotState = {}; ctx.requestCapabilityState = {}; },
        configureCanonicalUserAccess: async () => { calls.push('canonical'); },
        initializeAppAccessSnapshot: async () => { calls.push('access'); ctx.appAccessSnapshotState = options.failure
            ? { status: 'error', username: 'dylan_collyge', profileId: 'account-a' }
            : { status: 'ready', stale: false, snapshot: options.accessSnapshot || {}, username: 'dylan_collyge', profileId: 'account-a' }; },
        initializeRequestCapabilities: async () => { calls.push('capabilities'); ctx.requestCapabilityState = options.capabilityFailure
            ? { status: 'error', stale: true, capabilities: null }
            : { status: 'ready', stale: false, capabilities: {} }; },
        ensureAssignableAppUsers: async () => {}, ensureFlyerAssignableUsers: async () => {},
        applyCurrentUserMasterInventoryScope: () => { calls.push('master-scope'); },
        applyRolePermissions: () => { calls.push('apply'); ctx.renderedRole = ctx.currentRole; ctx.renderedAccess = ctx.appAccessSnapshotState.snapshot?.marker; },
        refreshProtectedSections: () => { calls.push('protected'); }, markViewDirty() {}, renderHome() {}, reportSemanticHealthEvent() {}
    };
    vm.createContext(ctx); vm.runInContext(html.slice(from, to), ctx);
    return ctx;
}

function appAccessSnapshotVm({ username = 'brian_hatfield', profileId = 'profile-a', snapshot = null,
    diskSnapshot = null, rpc = async () => null } = {}) {
    const calls = { cacheReads: 0, persisted: 0, health: [] };
    const normalizedUser = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const ctx = {
        Promise, String, Object, Number, Date, Error, navigator: { onLine: true },
        currentUser: username, currentRole: 'Sales Rep', nativeAuthProfile: { id: profileId }, nativeAuthSessionActive: true,
        productionLiveSyncReadAuthEpoch: 4, appAccessSnapshotLoadPromise: null,
        appAccessSnapshotState: { status: 'error', snapshot, stale: !!snapshot, errorCode: 'PREVIOUS_REFRESH_FAILED',
            loadedAt: 123, username: normalizedUser(username), profileId },
        getRequestCapabilityUsernameKey: normalizedUser, getAppAccessCacheKey: user => `access:${normalizedUser(user)}`,
        readCachedAppAccessSnapshot: () => { calls.cacheReads++; return diskSnapshot ? { snapshot: diskSnapshot, profileId, loadedAt: 456 } : null; },
        normalizeAppAccessSnapshot: (value, expected) => value && normalizedUser(value.username) === expected ? value : null,
        persistAppAccessSnapshot: () => { calls.persisted++; },
        supabaseRpc: rpc, calls, reportSemanticHealthEvent: (...args) => calls.health.push(args),
        activeHomeTab: '', MANAGER_ACCESS_CONTROL_VIEW: 'manager-access',
        getRoleAccessState: () => null, setTimeout, localStorage: { getItem: () => null, setItem() {} }
    };
    vm.createContext(ctx);
    vm.runInContext(extractAppFunction('getSupabaseReadErrorCode'), ctx);
    vm.runInContext(extractAppFunction('isSupabaseReadTerminalDenial'), ctx);
    vm.runInContext(extractAppFunction('initializeAppAccessSnapshot'), ctx);
    return ctx;
}

function legacyAppAccessCacheVm({ envelope = null, username = 'brian_hatfield', currentRole = 'Sales Rep',
    profile = null, sessionUserId = 'profile-a', rpc = async () => { throw Object.assign(new Error('temporary network failure'), { status: 503 }); } } = {}) {
    const normalizedUser = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const stored = new Map();
    if (envelope) stored.set(`access:${normalizedUser(username)}`, JSON.stringify(envelope));
    const localStorage = {
        getItem: key => stored.get(key) || null,
        setItem: (key, value) => stored.set(key, value),
        removeItem: key => stored.delete(key)
    };
    const ctx = {
        Promise, String, Object, Number, Date, Error, Array, JSON, Math, navigator: { onLine: true }, localStorage,
        APP_ACCESS_CONTRACT_VERSION: 'app-access-v1', currentUser: username, currentRole,
        nativeAuthProfile: profile || { id: 'profile-a', username: 'Brian_Hatfield', role: 'Sales Rep', disabled_at: null, must_change_password: false },
        nativeAuthSessionActive: true, nativeAuthSessionUserId: sessionUserId,
        productionLiveSyncReadAuthEpoch: 2, appAccessSnapshotLoadPromise: null,
        appAccessSnapshotState: { status: 'idle', snapshot: null, stale: false, errorCode: '', loadedAt: 0, username: '', profileId: '', authEpoch: 0 },
        getRequestCapabilityUsernameKey: normalizedUser, getAppAccessCacheKey: value => `access:${normalizedUser(value)}`,
        firstNonEmptyValue: (...values) => values.find(value => value != null && value !== ''),
        normalizeRoleAccessToken: value => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ''),
        supabaseRpc: rpc, reportSemanticHealthEvent() {}, activeHomeTab: '', MANAGER_ACCESS_CONTROL_VIEW: 'manager-access',
        getRoleAccessState: () => null, setTimeout: () => 0
    };
    vm.createContext(ctx);
    vm.runInContext(extractAppFunction('getSupabaseReadErrorCode'), ctx);
    vm.runInContext(extractAppFunction('isSupabaseReadTerminalDenial'), ctx);
    vm.runInContext(extractAppFunction('normalizeAppAccessSnapshot'), ctx);
    vm.runInContext(extractAppFunction('readCachedAppAccessSnapshot'), ctx);
    vm.runInContext(extractAppFunction('initializeAppAccessSnapshot'), ctx);
    vm.runInContext(extractAppFunction('getAppAccessSnapshot'), ctx);
    vm.runInContext(extractAppFunction('hasRetainedAuthenticatedAppAccess'), ctx);
    return { ctx, stored, localStorage };
}

test('v2.3.15 legacy access cache is adopted only for the matching enabled authenticated profile and stays display-only', async () => {
    const gate = deferred();
    const legacySnapshot = { contractVersion: 'app-access-v1', enforcementMode: 'enforced', username: 'Brian_Hatfield',
        role: 'Sales Rep', dataPermissionVersion: 'legacy-v2315', permissions: [] };
    const { ctx, stored } = legacyAppAccessCacheVm({ envelope: { snapshot: legacySnapshot, loadedAt: 123 }, rpc: () => gate.promise });
    const adopted = ctx.readCachedAppAccessSnapshot('brian_hatfield');
    assert.equal(adopted.profileId, 'profile-a');
    assert.equal(adopted.stale, true, 'the adoption result is stale even before any refresh starts');
    const pending = ctx.initializeAppAccessSnapshot({ force: true, reason: 'legacy-cache-upgrade' });
    await settle();
    assert.equal(ctx.appAccessSnapshotState.status, 'loading');
    assert.equal(ctx.appAccessSnapshotState.stale, true);
    assert.equal(ctx.appAccessSnapshotState.profileId, 'profile-a');
    assert.equal(ctx.appAccessSnapshotState.snapshot.dataPermissionVersion, 'legacy-v2315');
    const adoptedEnvelope = JSON.parse(stored.get('access:brian_hatfield'));
    assert.equal(adoptedEnvelope.profileId, 'profile-a', 'legacy ownership is stamped only after binding to the active session subject');
    assert.equal(adoptedEnvelope.stale, true);
    assert.equal(adoptedEnvelope.adoptedLegacyProfileBinding, true);
    assert.equal(ctx.hasRetainedAuthenticatedAppAccess(), true, 'verified same-account ownership can keep the already-loaded workspace visible');
    gate.reject(Object.assign(new Error('temporary network failure'), { status: 503 }));
    const settled = await pending;
    assert.equal(settled.dataPermissionVersion, 'legacy-v2315');
    assert.equal(ctx.appAccessSnapshotState.status, 'ready');
    assert.equal(ctx.appAccessSnapshotState.stale, true, 'a transient permission failure never makes adopted cache fresh');
    assert.equal(ctx.appAccessSnapshotState.profileId, 'profile-a');
    assert.equal(ctx.hasRetainedAuthenticatedAppAccess(), true);
});

test('legacy access cache adoption rejects mismatched username, role, session subject, explicit owner, disabled, and password-change-required profiles', () => {
    const baseEnvelope = { snapshot: { contractVersion: 'app-access-v1', enforcementMode: 'enforced', username: 'Brian_Hatfield',
        role: 'Sales Rep', dataPermissionVersion: 'legacy-v2315', permissions: [] }, loadedAt: 123 };
    const cases = [
        ['wrong cached username', { envelope: { ...baseEnvelope, snapshot: { ...baseEnvelope.snapshot, username: 'someone_else' } } }],
        ['wrong active profile username', { profile: { id: 'profile-a', username: 'someone_else', role: 'Sales Rep', disabled_at: null, must_change_password: false } }],
        ['wrong current role', { currentRole: 'Manager' }],
        ['previously adopted cache after role change', { currentRole: 'Manager', envelope: { ...baseEnvelope, profileId: 'profile-a', adoptedLegacyProfileBinding: true } }],
        ['wrong session subject', { sessionUserId: 'profile-other' }],
        ['mismatched explicit profile ID', { envelope: { ...baseEnvelope, profileId: 'profile-other' } }],
        ['disabled profile', { profile: { id: 'profile-a', username: 'Brian_Hatfield', role: 'Sales Rep', disabled_at: '2026-10-19', must_change_password: false } }],
        ['password-change-required profile', { profile: { id: 'profile-a', username: 'Brian_Hatfield', role: 'Sales Rep', disabled_at: null, must_change_password: true } }]
    ];
    for (const [label, overrides] of cases) {
        const envelope = overrides.envelope || baseEnvelope;
        const { ctx, stored } = legacyAppAccessCacheVm({ envelope, ...overrides });
        assert.equal(ctx.readCachedAppAccessSnapshot('brian_hatfield'), null, `${label} must not adopt the cache`);
        assert.equal(JSON.parse(stored.get('access:brian_hatfield')).profileId || '', overrides.envelope?.profileId || '', `${label} is not rewritten or rebound`);
    }
});

test('same-profile in-memory access snapshot stays available while refresh is pending and after transient failure', async () => {
    const gate = deferred();
    const memorySnapshot = { username: 'brian_hatfield', dataPermissionVersion: 'memory-v1', role: 'Sales Rep' };
    const diskSnapshot = { username: 'brian_hatfield', dataPermissionVersion: 'disk-v0', role: 'Sales Rep' };
    const ctx = appAccessSnapshotVm({ snapshot: memorySnapshot, diskSnapshot, rpc: () => gate.promise });
    const pending = ctx.initializeAppAccessSnapshot({ force: true, reason: 'test-refresh' });
    await settle();
    assert.equal(ctx.appAccessSnapshotState.status, 'loading');
    assert.equal(ctx.appAccessSnapshotState.snapshot.dataPermissionVersion, 'memory-v1', 'same-profile memory beats persisted cache during the RPC');
    assert.equal(ctx.appAccessSnapshotState.profileId, 'profile-a');
    assert.equal(ctx.appAccessSnapshotState.stale, true);
    assert.equal(ctx.calls.cacheReads, 0, 'the matching in-memory snapshot is preferred without consulting disk');
    gate.reject(new Error('temporary network failure'));
    const result = await pending;
    assert.equal(result.dataPermissionVersion, 'memory-v1');
    assert.equal(ctx.appAccessSnapshotState.status, 'ready');
    assert.equal(ctx.appAccessSnapshotState.stale, true, 'transient failure retains the snapshot as stale display state');
    assert.equal(ctx.appAccessSnapshotState.profileId, 'profile-a');
    assert.equal(ctx.calls.persisted, 0);
});

test('an actual access RPC 403 drops the retained snapshot', async () => {
    const memorySnapshot = { username: 'brian_hatfield', dataPermissionVersion: 'memory-v1', role: 'Sales Rep' };
    const ctx = appAccessSnapshotVm({ snapshot: memorySnapshot,
        rpc: async () => { throw Object.assign(new Error('Forbidden'), { status: 403, code: '42501' }); } });
    assert.equal(await ctx.initializeAppAccessSnapshot({ force: true }), null);
    assert.equal(ctx.appAccessSnapshotState.status, 'error');
    assert.equal(ctx.appAccessSnapshotState.snapshot, null);
    assert.equal(ctx.appAccessSnapshotState.stale, false);
    assert.equal(ctx.appAccessSnapshotState.profileId, 'profile-a');
    assert.equal(ctx.calls.health.length, 1);
});

test('a late access snapshot response after an account switch cannot overwrite the new account state', async () => {
    const gate = deferred();
    const ctx = appAccessSnapshotVm({ snapshot: { username: 'brian_hatfield', dataPermissionVersion: 'memory-v1' }, rpc: () => gate.promise });
    const pending = ctx.initializeAppAccessSnapshot({ force: true });
    await settle();
    const nextAccountState = { status: 'ready', snapshot: { username: 'sharon_combs', dataPermissionVersion: 'sharon-v1' },
        stale: false, errorCode: '', loadedAt: 789, username: 'sharon_combs', profileId: 'profile-b' };
    ctx.currentUser = 'sharon_combs';
    ctx.nativeAuthProfile = { id: 'profile-b' };
    ctx.productionLiveSyncReadAuthEpoch++;
    ctx.appAccessSnapshotState = nextAccountState;
    ctx.appAccessSnapshotLoadPromise = null;
    gate.resolve({ username: 'brian_hatfield', dataPermissionVersion: 'late-brian-v2' });
    assert.equal(await pending, null);
    assert.equal(ctx.appAccessSnapshotState, nextAccountState, 'the late response cannot replace the current owner’s state');
    assert.equal(ctx.appAccessSnapshotState.profileId, 'profile-b');
    assert.equal(ctx.calls.persisted, 0, 'discarded responses are not persisted');
});

test('same-account forced permission refreshes coalesce into one authenticated RPC', async () => {
    const gate = deferred(); let rpcCalls = 0;
    const ctx = appAccessSnapshotVm({ snapshot: { username: 'brian_hatfield', dataPermissionVersion: 'memory-v1' },
        rpc: () => { rpcCalls++; return gate.promise; } });
    const first = ctx.initializeAppAccessSnapshot({ force: true, reason: 'first' });
    const second = ctx.initializeAppAccessSnapshot({ force: true, reason: 'second' });
    await settle();
    assert.equal(rpcCalls, 1, 'overlapping same-profile forced refreshes share the active request');
    assert.equal(ctx.appAccessSnapshotState.profileId, 'profile-a');
    gate.resolve({ username: 'brian_hatfield', dataPermissionVersion: 'access-v2', role: 'Sales Rep' });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult.dataPermissionVersion, 'access-v2');
    assert.equal(secondResult.dataPermissionVersion, 'access-v2');
    assert.equal(ctx.appAccessSnapshotState.stale, false);
    assert.equal(ctx.calls.persisted, 1);
});

test('a same-profile auth epoch change starts a new refresh and stale completion cannot clear it', async () => {
    const firstGate = deferred(), secondGate = deferred(); let rpcCalls = 0;
    const ctx = appAccessSnapshotVm({ snapshot: { username: 'brian_hatfield', dataPermissionVersion: 'memory-v1' },
        rpc: () => (++rpcCalls === 1 ? firstGate.promise : secondGate.promise) });
    const oldRequest = ctx.initializeAppAccessSnapshot({ force: true, reason: 'before-token-refresh' });
    await settle();
    assert.equal(ctx.appAccessSnapshotState.authEpoch, 4);
    ctx.productionLiveSyncReadAuthEpoch = 5;
    const currentRequest = ctx.initializeAppAccessSnapshot({ force: true, reason: 'after-token-refresh' });
    await settle();
    assert.equal(rpcCalls, 2, 'same username/profile at a new auth epoch must not coalesce the old JWT request');
    assert.equal(ctx.appAccessSnapshotState.authEpoch, 5);
    const currentPromise = ctx.appAccessSnapshotLoadPromise;
    firstGate.resolve({ username: 'brian_hatfield', dataPermissionVersion: 'old-token-response' });
    assert.equal(await oldRequest, null, 'the stale epoch response is discarded');
    assert.equal(ctx.appAccessSnapshotLoadPromise, currentPromise, 'the old finally block cannot clear the current request');
    assert.equal(ctx.appAccessSnapshotState.authEpoch, 5);
    secondGate.resolve({ username: 'brian_hatfield', dataPermissionVersion: 'new-token-response', role: 'Sales Rep' });
    const result = await currentRequest;
    assert.equal(result.dataPermissionVersion, 'new-token-response');
    assert.equal(ctx.appAccessSnapshotState.authEpoch, 5);
    assert.equal(ctx.appAccessSnapshotState.stale, false);
});

test('same-role policy changes reload and apply authoritative permissions before returning', async () => {
    const ctx = permissionFixture();
    assert.equal(await ctx.refreshNativeRoleAndCapabilities('foreground'), false);
    assert.equal(ctx.calls.length, 0);
    assert.equal(await ctx.refreshNativeRoleAndCapabilities('live-permissions'), true);
    assert.deepEqual(ctx.calls, ['bridge', 'canonical', 'capabilities', 'access', 'master-scope', 'apply', 'protected', 'master-scope', 'apply', 'protected'], 'fresh denials apply before draft restoration and final same-account UI refresh');
});

test('division changes refresh capability scope even without a role change', async () => {
    const ctx = permissionFixture({ division: '20' });
    assert.equal(await ctx.refreshNativeRoleAndCapabilities('foreground'), true);
    assert.equal(ctx.currentUserDivision, '20');
    assert.ok(ctx.calls.includes('clear'), 'a confirmed division change clears role-scoped caches');
    assert.ok(ctx.calls.includes('apply'));
});

test('confirmed role changes still clear role-scoped caches', async () => {
    const ctx = permissionFixture({ role: 'Manager' });
    assert.equal(await ctx.refreshNativeRoleAndCapabilities('foreground'), true);
    assert.ok(ctx.calls.includes('clear'));
    assert.ok(ctx.calls.includes('master-scope'));
});

test('a confirmed role downgrade updates the retained DOM before bridge or permission requests resolve', async () => {
    const ctx = permissionFixture({ role: 'Sales Rep' }); const bridgeGate = deferred();
    ctx.renderedRole = 'Admin';
    ctx.ensureNativeAppSessionBridge = () => { ctx.calls.push('bridge'); return bridgeGate.promise; };
    const pending = ctx.refreshNativeRoleAndCapabilities('foreground');
    await settle();
    assert.equal(ctx.currentRole, 'Sales Rep');
    assert.equal(ctx.renderedRole, 'Sales Rep', 'old admin UI is replaced as soon as the profile downgrade is confirmed');
    assert.deepEqual(ctx.calls.slice(0, 4), ['clear', 'master-scope', 'apply', 'protected']);
    assert.equal(ctx.calls[4], 'bridge', 'the bridge wait begins only after restrictive role UI is applied');
    bridgeGate.resolve(null);
    assert.equal(await pending, true);
});

test('fresh access denial applies even when the separate request-capability refresh fails', async () => {
    const ctx = permissionFixture({ capabilityFailure: true, accessSnapshot: { marker: 'confirmed-denied' } });
    await assert.rejects(ctx.refreshNativeRoleAndCapabilities('live-permissions'), /permissions could not be verified/);
    assert.equal(ctx.renderedAccess, 'confirmed-denied', 'the fresh access decision is rendered before refresh failure is reported');
    assert.ok(ctx.calls.includes('master-scope'));
    assert.ok(ctx.calls.includes('apply'));
    assert.ok(ctx.calls.includes('protected'));
});

test('a failed updated policy check rejects instead of granting fallback access', async () => {
    const ctx = permissionFixture({ failure: true });
    await assert.rejects(ctx.refreshNativeRoleAndCapabilities('live-permissions'), /permissions could not be verified/);
    assert.ok(!ctx.calls.includes('apply'));
    assert.equal(ctx.mask, undefined, 'a failed background permission refresh does not add a blocking screen curtain');
});

test('live permission signal arriving during a foreground check performs a full refresh afterwards', async () => {
    const ctx = permissionFixture(); const gate = deferred();
    const getProfile = ctx.loadNativeAuthProfile;
    ctx.loadNativeAuthProfile = async () => { await gate.promise; return getProfile(); };
    const foreground = ctx.refreshNativeRoleAndCapabilities('foreground');
    const policy = ctx.refreshNativeRoleAndCapabilities('live-permissions');
    gate.resolve();
    assert.equal(await foreground, false); assert.equal(await policy, true);
    assert.deepEqual(ctx.calls, ['bridge', 'canonical', 'capabilities', 'access', 'master-scope', 'apply', 'protected', 'master-scope', 'apply', 'protected']);
});

test('permission-change coordinator callback returns the permission refresh promise', () => {
    const code = html.match(/onPermissionChange: (\(\) => refreshNativeRoleAndCapabilities\('live-permissions'\)),/)[1];
    const promise = Promise.resolve(true); const groups = new Set(['prior']); const ctx = { productionDisplayGroups: groups, refreshNativeRoleAndCapabilities: () => promise,
        resetDashboardSyncMetadataForPermissionChange: () => { ctx.reset = true; } };
    vm.createContext(ctx); vm.runInContext(`this.callback = ${code}`, ctx);
    assert.equal(ctx.callback(), promise);
    assert.deepEqual(Array.from(ctx.productionDisplayGroups), ['prior'], 'a pending permission refresh does not eagerly clear same-account display');
    assert.equal(ctx.reset, undefined, 'display clearing waits for confirmed identity/access changes or server denial');
});

test('footer refresh skips static and navigation-only screens but renders data-backed Managers tabs', () => {
    const from = html.indexOf('function scheduleProductionLiveSyncRender(');
    const to = html.indexOf('function getProductionLiveSyncCoordinator()', from);
    const run = ({ view, kind, adapters }) => {
        let renders = 0;
        const ctx = { productionVerifiedViewKey: () => 'visit', VIEW_LOAD_UI: { managers: { container: 'managers-content' } },
            productionLiveSyncRenderTimer: null, productionLiveSyncRenderGeneration: 0, productionLiveSyncRenderPending: false,
            productionLiveSyncActiveRender: null, productionLiveSyncRendering: false,
            document: { hidden: false, getElementById: () => ({}), activeElement: null },
            setTimeout: (callback) => { callback(); return 1; }, clearTimeout() {},
            scheduleTypingAwareUiRender: (_key, callback) => { callback(); }, canUseProductionLiveSync: () => true,
            getCurrentVisibleViewId: () => view, getProductionLiveSyncContext: () => ({ adapters }),
            getContainerUiState: () => 'content', hasProductionLiveSyncDraft: () => false,
            captureProductionRefreshAnchor: () => null, restoreProductionRefreshAnchor() {}, isProductionRefreshCurrent: () => true,
            finishProductionRefresh() {}, bumpLatestViewRenderToken: () => 1, latestViewRenderTokensByView: { managers: 1 },
            markViewDirty() {}, renderViewContent: () => { renders++; },
            window: { AgMetricLiveSyncRegistry: { views: { [view]: { kind } } } }
        };
        vm.createContext(ctx); vm.runInContext(html.slice(from, to), ctx);
        assert.doesNotThrow(() => ctx.scheduleProductionLiveSyncRender());
        return renders;
    };
    assert.equal(run({ view: 'hours', kind: 'static', adapters: [] }), 0);
    assert.equal(run({ view: 'home', kind: 'navigation', adapters: [] }), 0);
    assert.equal(run({ view: 'managers', kind: 'navigation', adapters: [] }), 0);
    assert.equal(run({ view: 'managers', kind: 'navigation', adapters: [{ id: 'core:master' }] }), 1);
});

test('focused live search defers one redraw without scheduling a busy retry timer', () => {
    const from = html.indexOf('function scheduleProductionLiveSyncRender(');
    const to = html.indexOf('function getProductionLiveSyncCoordinator()', from);
    const queued = [];
    const ctx = { productionVerifiedViewKey: () => 'visit', VIEW_LOAD_UI: {}, productionLiveSyncRenderTimer: null, productionLiveSyncDraftChanged: false,
        productionLiveSyncRenderGeneration: 0, productionLiveSyncRenderPending: false,
        scheduleTypingAwareUiRender: (_key, callback) => { queued.push(callback); },
        setTimeout: (callback) => { queued.push(callback); return queued.length; }, document: { hidden: false, activeElement: { matches: () => true } },
        canUseProductionLiveSync: () => true, getCurrentVisibleViewId: () => 'docks', hasProductionLiveSyncDraft: () => false,
        window: { AgMetricLiveSyncRegistry: { views: { docks: { kind: 'data' } } } }
    };
    vm.createContext(ctx); vm.runInContext(html.slice(from, to), ctx);
    ctx.scheduleProductionLiveSyncRender(); queued[0]();
    assert.equal(queued.length, 1); assert.equal(ctx.productionLiveSyncDraftChanged, true); assert.equal(ctx.productionLiveSyncRenderTimer, null);
});

function draftFixture() {
    const from = html.indexOf('let productionPermissionCheckElements = []');
    const to = html.indexOf('async function refreshNativeRoleAndCapabilities(', from);
    const editor = { targetType: 'user', targetKey: 'fixture-user', reason: 'unsaved reason', decision: 'deny' };
    const ctx = { String, Array, Object, Error, currentUser: 'dylan_collyge', nativeAuthProfile: { id: 'account-a' },
        accessControlAdminState: { editor, publishReason: 'my review' },
        codexOpsState: { composeOpen: true, draft: 'unsent issue', attachments: [{ id: 'local-file' }], messageDraft: 'unsent reply', activeTaskId: 'my-task' },
        canAccessView: () => true, isKaylaLimitedAccessManagerUser: () => false, normalizeAccessControlMatrix: (value) => value,
        supabaseRpc: async () => ({ capabilities: { canView: true, canEdit: true, canPublish: true, editScope: 'all' } }),
        invokeCodexOpsApi: async () => ({ canView: true, submissionEnabled: true })
    };
    vm.createContext(ctx); vm.runInContext(html.slice(from, to), ctx);
    return ctx;
}

test('only same-account draft fields are restored after authoritative feature permission checks', async () => {
    const ctx = draftFixture(); ctx.captureProductionPermissionDrafts();
    ctx.accessControlAdminState = {}; ctx.codexOpsState = {};
    await ctx.restoreProductionPermissionDrafts();
    assert.equal(ctx.accessControlAdminState.editor.reason, 'unsaved reason');
    assert.equal(ctx.accessControlAdminState.publishReason, 'my review');
    assert.equal(ctx.codexOpsState.draft, 'unsent issue');
    assert.equal(ctx.codexOpsState.messageDraft, 'unsent reply');
    assert.equal(ctx.codexOpsState.tasks, undefined, 'stale server records are not restored');
});

test('revoked feature permissions and account switches redact saved drafts', async () => {
    for (const switchAccount of [false, true]) {
        const ctx = draftFixture(); ctx.captureProductionPermissionDrafts();
        ctx.accessControlAdminState = {}; ctx.codexOpsState = {};
        ctx.supabaseRpc = async () => ({ capabilities: { canView: false, canEdit: false } });
        ctx.invokeCodexOpsApi = async () => ({ canView: false, submissionEnabled: false });
        if (switchAccount) ctx.nativeAuthProfile = { id: 'account-b' };
        await ctx.restoreProductionPermissionDrafts();
        assert.equal(ctx.accessControlAdminState.editor, undefined); assert.equal(ctx.codexOpsState.draft, undefined);
    }
});

test('limited-access manager drafts restore only for a currently permitted user target', async () => {
    for (const allowed of [true, false]) {
        const ctx = draftFixture(); ctx.captureProductionPermissionDrafts();
        ctx.accessControlAdminState = {}; ctx.codexOpsState = {};
        ctx.supabaseRpc = async () => ({ capabilities: { canView: true, canEdit: true, canPublish: false, editScope: 'limited-users' }, users: allowed ? [{ username: 'fixture-user' }] : [] });
        await ctx.restoreProductionPermissionDrafts();
        assert.equal(!!ctx.accessControlAdminState.editor, allowed);
        assert.equal(ctx.accessControlAdminState.publishReason, undefined);
    }
});

test('a failed feature-permission read retains the draft privately for a later safe retry', async () => {
    const ctx = draftFixture(); ctx.captureProductionPermissionDrafts();
    ctx.accessControlAdminState = {}; ctx.codexOpsState = {};
    const read = ctx.supabaseRpc;
    ctx.supabaseRpc = async () => { throw new Error('network unavailable'); };
    await assert.rejects(ctx.restoreProductionPermissionDrafts(), /network/);
    assert.equal(ctx.accessControlAdminState.editor, undefined);
    ctx.captureProductionPermissionDrafts(); // Retry must not replace saved draft with reset caches.
    ctx.supabaseRpc = read; await ctx.restoreProductionPermissionDrafts();
    assert.equal(ctx.accessControlAdminState.editor.reason, 'unsaved reason');
});

test('background permission refresh removes a legacy overlay and restores prior inert state without blocking the app', () => {
    const ctx = draftFixture(); const signals = [];
    const existing = [{ inert: false, isConnected: true }, { inert: true, isConnected: true }];
    let overlay = null;
    ctx.signalProductionLiveSync = (...args) => signals.push(args);
    ctx.document = {
        getElementById: () => overlay,
        body: { children: existing, appendChild: (node) => { overlay = node; existing.push(node); } },
        createElement: () => {
            const button = { focus() {} }, status = {};
            return { style: {}, setAttribute() {}, querySelector: (selector) => selector === 'button' ? button : status, remove: () => { existing.splice(existing.indexOf(overlay), 1); overlay = null; } };
        }
    };
    for (const phase of ['checking', 'failed', '']) {
        ctx.setProductionPermissionCheckState(phase);
        assert.equal(existing[0].inert, false); assert.equal(existing[1].inert, true); assert.equal(overlay, null);
    }
    overlay = { remove: () => { overlay = null; } };
    existing[0].inert = true;
    vm.runInContext('productionPermissionCheckElements = [{ element: document.body.children[0], inert: false }]', ctx);
    ctx.setProductionPermissionCheckState('checking');
    assert.equal(existing[0].inert, false); assert.equal(overlay, null);
    assert.deepEqual(signals, [], 'cleanup never manufactures a permission retry or authorization result');
});

test('native Codex live updates do not start the redundant fifteen-second timer', () => {
    const from = html.indexOf('function scheduleCodexOpsPoll()');
    const to = html.indexOf('function stopCodexOpsPoll()', from);
    let stopped = false;
    const ctx = { stopCodexOpsPoll: () => { stopped = true; }, shouldUseProductionLiveSyncSideLoad: () => true, setTimeout: () => { throw new Error('redundant poll'); } };
    vm.createContext(ctx); vm.runInContext(html.slice(from, to), ctx);
    assert.equal(ctx.scheduleCodexOpsPoll(), false); assert.equal(stopped, true);
});

test('Reclass delivery checks issue no requests while hidden and discard responses after suspension', async () => {
    const from = html.indexOf('async function pollReclassDeliveryJobs()');
    const to = html.indexOf('async function retryReclassDeliveryJob(', from);
    const ctx = { document: { hidden: true }, reclassDeliveryPollActive: false, requests: 0, updates: 0,
        getCurrentReclassDeliveryActor: () => 'fixture', renderReclassDeliveryStatusTray() {},
        readReclassDeliveryJobs: () => [{ actorUsername: 'fixture', sourceView: 'drive', status: 'queued', token: 'fixture' }],
        driveReclassApi: async () => { ctx.requests++; ctx.document.hidden = true; return { status: 'delivered' }; },
        upsertReclassDeliveryJob: () => { ctx.updates++; }
    };
    vm.createContext(ctx); vm.runInContext(html.slice(from, to), ctx);
    assert.equal(await ctx.pollReclassDeliveryJobs(), false); assert.equal(ctx.requests, 0);
    ctx.document.hidden = false; await ctx.pollReclassDeliveryJobs();
    assert.equal(ctx.requests, 1); assert.equal(ctx.updates, 0); assert.equal(ctx.reclassDeliveryPollActive, false);
});

test('Reclass delivery status reconciles immediately when visibility returns', () => {
    assert.match(html, /document\.addEventListener\('visibilitychange', \(\) => \{\s+if \(document\.hidden\) clearReclassDeliveryPollTimer\(\);\s+else startReclassDeliveryPolling\(\);/);
});

test('Reclass delivery polling uses a foreground-only timer', () => {
    const timers = new Map(); let nextId = 0, visibilityHandler, polls = 0;
    const ctx = { document: { hidden: true, addEventListener: (_, fn) => { visibilityHandler = fn; } },
        window: { setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, delay }); return id; },
            clearTimeout: id => timers.delete(id) }, reclassDeliveryPollTimer: null,
        clearTimeout: id => timers.delete(id),
        renderReclassDeliveryStatusTray() {}, pollReclassDeliveryJobs: async () => { polls++; } };
    vm.createContext(ctx);
    const from = html.indexOf('function clearReclassDeliveryPollTimer()');
    vm.runInContext(html.slice(from, html.indexOf('let inventoryStatusSync = null;', from)), ctx);
    ctx.startReclassDeliveryPolling();
    assert.equal(timers.size, 0, 'hidden startup does not arm a recurring poll');
    ctx.document.hidden = false; visibilityHandler();
    assert.equal(polls, 1, 'foreground entry checks pending jobs immediately');
    assert.equal([...timers.values()].some(timer => timer.delay === 5000), true, 'foreground polling uses one timeout');
    ctx.document.hidden = true; visibilityHandler();
    assert.equal(timers.size, 0, 'backgrounding clears the pending poll timer');
});

function nativeRecoveryFixture() {
    const gate = deferred(); let sessions = 0, refreshes = 0;
    const session = { access_token: 'native-token', user: { id: 'account-a' } };
    const ctx = { Error, Object, String, Promise, window: {}, NATIVE_AUTH_ENABLED: true, SUPABASE_KEY: 'public-key',
        nativeAuthProfile: { id: 'account-a' }, nativeAuthSessionActive: true, nativeAuthAccessToken: '',
        getSupabaseBrowserClient: () => ({ auth: {
            getSession: async () => { sessions++; return { data: { session: null } }; },
            refreshSession: async () => { refreshes++; await gate.promise; return { data: { session } }; }
        } })
    };
    vm.createContext(ctx);
    vm.runInContext(html.slice(html.indexOf('let nativeAuthSessionRead ='), html.indexOf('function readCachedNativeAuthProfile')), ctx);
    return { ctx, gate, session, get sessions() { return sessions; }, get refreshes() { return refreshes; } };
}

test('native module reads share one restoration and refresh without changing auth mode', async () => {
    const f = nativeRecoveryFixture();
    const reads = Array.from({ length: 12 }, () => f.ctx.getNativeAuthRequestHeaders());
    await settle();
    assert.equal(f.sessions, 1); assert.equal(f.refreshes, 1);
    assert.equal(f.ctx.nativeAuthSessionActive, true);
    f.gate.resolve();
    const headers = await Promise.all(reads);
    assert.ok(headers.every(value => value.Authorization === 'Bearer native-token'));
});

test('logout and account changes invalidate delayed native token restoration', async () => {
    for (const change of ['nativeAuthRecoveryEpoch++', "nativeAuthProfile = { id: 'account-b' }"]) {
        const f = nativeRecoveryFixture(); const pending = f.ctx.getNativeAuthRequestHeaders();
        await settle(); vm.runInContext(change, f.ctx); f.gate.resolve();
        assert.equal(await pending, null);
        assert.equal(f.ctx.nativeAuthAccessToken, '');
    }
});

test('native database helpers never fall through to the prohibited legacy proxy', async () => {
    const calls = [], ctx = { Error, Object, String, Number, Math, JSON, Array, Promise,
        SUPABASE_READ_TIMEOUT_MS: 1000, SUPABASE_URL: 'https://test.invalid',
        normalizeAppTableName: value => value, nativeReadRequiresRls: () => true,
        nativeSessionRecoveryError: () => Object.assign(new Error('Recover session'), { code: 'NATIVE_SESSION_RECOVERY_REQUIRED' }),
        getNativeAuthRequestHeaders: async () => null,
        fetchWithTimeout: async (_, options) => { calls.push(options); return { ok: true, text: async () => '[{"unique_id":"one"}]' }; },
        parseSupabaseContentRangeTotal: () => 1
    };
    vm.createContext(ctx);
    vm.runInContext(html.slice(html.indexOf('async function fetchAuthenticatedSupabaseReadPage('), html.indexOf('async function fetchSupabaseRowsPage(')), ctx);
    vm.runInContext(html.slice(html.indexOf('async function runAppApiSupabaseWrite('), html.indexOf('async function supabaseFetch(')), ctx);
    await assert.rejects(ctx.runAppApiSupabaseWrite('ph_master_inventory', 'GET', null, 'select=*'), /Raw browser inventory reads are disabled/);
    assert.equal(calls.length, 0);
    ctx.getNativeAuthRequestHeaders = async () => ({ Authorization: 'Bearer native-token' });
    await assert.rejects(ctx.runAppApiSupabaseWrite('ph_master_inventory', 'GET', null, 'select=*', { count: true }), /Raw browser inventory reads are disabled/);
    assert.equal(calls.length, 0, 'native and legacy sessions cannot issue a raw browser inventory GET');
});


test('progressive disk display accepts an older revision only with the same account, query and permissions', async () => {
    const meta = { contractVersion: 1, scope: 'account-a', adapterId: 'core:master', cacheKey: 'master/all', dataPermissionVersion: 'permission-a', signature: JSON.stringify(['permission-a', ['master', '2', 'ready']]) };
    let saved = { format: 'verified-raw-v1', meta: { ...meta, signature: JSON.stringify(['permission-a', ['master', '1', 'ready']]) },
        rawRows: Array.from({ length: 1300 }, (_, index) => ({ unique_id: `old-${index}`, commonname: `Plant ${index % 432}` })), rowCount: 1300, sourceRowCount: 1300,
        rowCompleteness: 'complete', projection: 'browse', fieldCoverage: 'browse', columns: inventoryContract.columns };
    const ctx = { JSON, Array, Map, getSupabaseReadIdentityScope: () => 'account-a',
        appAccessSnapshotState: { snapshot: { dataPermissionVersion: 'permission-a' } },
        currentMasterPreparationSeasonKey: () => 'season-a',
        MIN_TRUSTED_MASTER_COMMON_NAME_CACHE_COUNT: 1200, shouldScopeMasterInventoryToCurrentEval: () => false,
        firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
        prepareProductionMasterSnapshot: async (rows) => ({ payload: { data: rows }, rowCount: rows.length }),
        productionDisplaySnapshotTimes: new Map(),
        productionDisplayGroupKey: () => 'cohort', loadCacheValue: async () => saved,
        verifiedSnapshotCacheKey: () => 'scope-key', buildDatasetPayload: (_, rows) => ({ data: rows }),
        window: { AgMetricInventoryList: inventoryContract } };
    vm.createContext(ctx);
    vm.runInContext([extractAppFunction('countUniqueCacheCommonNames'), extractAppFunction('masterRowsLookPartialForCurrentScope'),
        extractAppFunction('validateInventoryReadProjection')].join('\n'), ctx);
    const from = html.indexOf('async function readProductionDisplaySnapshot(');
    vm.runInContext(html.slice(from, html.indexOf('function previewProductionSnapshots(', from)), ctx);
    const read = () => ctx.readProductionDisplaySnapshot({ id: 'core:master', projection: 'browse' }, meta);
    assert.equal((await read()).cached, true);
    const original = saved;
    for (const change of [
        { meta: { ...saved.meta, scope: 'account-b' } },
        { meta: { ...saved.meta, cacheKey: 'other/query' } },
        { meta: { ...saved.meta, dataPermissionVersion: 'permission-b' } },
        { meta: { ...saved.meta, contractVersion: 2 } },
        { meta: { ...saved.meta, dataPermissionVersion: undefined } },
        { rowCompleteness: 'partial' },
        { rawRows: saved.rawRows.slice(0, 12), rowCount: 12 },
        { columns: undefined }, { fieldCoverage: 'full' }, { projection: 'full' },
        { format: 'legacy-unscoped' }, { rowCount: 2 }
    ]) { saved = { ...original, ...change }; assert.equal(await read(), null); }
});

test('progressive previews wait while Assigned Items has a low-stock draft or focused target input', () => {
    const start = html.indexOf('function hasProductionLiveSyncDraft(');
    const end = html.indexOf('\n        function captureProductionRefreshAnchor(', start);
    assert.ok(start >= 0 && end > start);
    const context = {
        document: { activeElement: null, querySelectorAll: () => [] },
        getCurrentVisibleViewId: () => 'managers', activeHomeTab: 'assigned',
        MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW: 'assigned', MANAGER_EVAL_REPORTS_2_VIEW: 'eval2',
        managerEvalReport2EditsByRowKey: new Map(), getManagerItemLowStockTargetsState: () => ({ drafts: new Map(), saving: new Set() })
    };
    vm.createContext(context);
    vm.runInContext(`${html.slice(start, end)};globalThis.hasDraft = hasProductionLiveSyncDraft;`, context);
    assert.equal(context.hasDraft(), false);
    context.getManagerItemLowStockTargetsState = () => ({ drafts: new Map([['ITEM.1', '12']]), saving: new Set() });
    assert.equal(context.hasDraft(), true);
    context.getManagerItemLowStockTargetsState = () => ({ drafts: new Map(), saving: new Set() });
    context.document.activeElement = { matches: selector => selector === 'input[data-low-stock-override]' };
    assert.equal(context.hasDraft(), true);
});

test('AV primary previews render inventory without promoting write proof or joined lookup data', () => {
    const payloads = [], renders = [], invalidations = [], freshness = [], groups = new Set();
    const state = { fullLoaded: false, rowCompleteness: 'unknown', liveVerifiedRevision: '' };
    const context = { view: 'av', progressive: true, visible: true, partialCohort: true };
    const preparedMasterRows = [{ UNIQUE_ID: 'first-page' }], preparedAvRows = [{ UNIQUE_ID: 'av-first-page' }];
    const preparedMaster = { avOpenRows: preparedAvRows };
    const ctx = { activeAVTab: 'open', fullInventory: preparedMasterRows, avOpenInventory: preparedAvRows,
        getCurrentPreparedMasterRows: rows => rows === preparedMasterRows && ctx.avOpenInventory === preparedAvRows ? preparedMaster : null,
        hasProductionLiveSyncDraft: () => false,
        confirmedArgosReclassLiveEditRevisions: new Map(), getArgosReclassLiveEditIdentityKey: () => 'actor',
        productionDisplayGroups: groups, productionDisplaySnapshotTimes: new Map(), productionDisplayVerifiedAt: new Map(),
        productionDisplayGroupKey: () => 'av-cohort', productionLiveSyncCoordinator: { getStatus: () => ({ state: 'Syncing' }) },
        processAndLoadData: value => payloads.push(value), renderProductionDataFreshness: status => freshness.push(status),
        invalidateResolvedViewStateCaches: () => invalidations.push('invalidated'),
        scheduleProductionLiveSyncRender: (...args) => renders.push(args), getDatasetState: () => state
    };
    vm.createContext(ctx); vm.runInContext(extractAppFunction('previewProductionSnapshots'), ctx);
    const entries = [{ adapter: { id: 'core:master' }, value: { partial: true, payload: { data: preparedMasterRows } } }];
    ctx.previewProductionSnapshots(entries, context);
    assert.equal(payloads.length, 0, 'the exact current prepared arrays are already displayed');
    assert.equal(invalidations.length, 0, 'reusing the prepared arrays keeps resolved view state intact');
    assert.equal(renders.length, 1, 'the display still schedules its AV render');
    assert.deepEqual(freshness, [{ state: 'Syncing' }], 'reuse still publishes the current freshness status');
    assert.equal(groups.has('av-cohort'), true);
    assert.deepEqual(state, { fullLoaded: false, rowCompleteness: 'unknown', liveVerifiedRevision: '' });
    assert.equal(ctx.productionDisplayVerifiedAt.size, 0, 'a partial cohort has no complete verified timestamp');

    const newRows = [{ UNIQUE_ID: 'new-preview' }];
    ctx.previewProductionSnapshots([{ adapter: { id: 'core:master' }, value: { partial: true, payload: { data: newRows } } }], context);
    assert.equal(payloads.length, 1, 'a new array still goes through master preparation and publication');
    assert.equal(payloads[0]._fromCache, true); assert.equal(payloads[0]._locOnHandReceiptRevision, undefined);
    assert.equal(invalidations.length, 1, 'new display data invalidates resolved view state');
    assert.equal(renders.length, 2);
    assert.deepEqual(freshness, [{ state: 'Syncing' }, { state: 'Syncing' }]);
    assert.deepEqual(state, { fullLoaded: false, rowCompleteness: 'unknown', liveVerifiedRevision: '' }, 'preview data never promotes proof');

    ctx.activeAVTab = 'reserves'; ctx.previewProductionSnapshots(entries, context);
    ctx.activeAVTab = 'open'; ctx.hasProductionLiveSyncDraft = () => true; ctx.previewProductionSnapshots(entries, context);
    ctx.hasProductionLiveSyncDraft = () => false;
    ctx.previewProductionSnapshots([{ adapter: { id: 'side:settings', commit() { throw new Error('partial side commit'); } }, value: {} }], context);
    assert.equal(payloads.length, 1, 'tab changes, drafts and non-primary cohorts do not paint');
    assert.equal(invalidations.length, 1);
});

test('only AV Open opts into the primary preview subset and its tab belongs to context identity', () => {
    const ctx = { currentUser: 'actor', currentRole: 'Manager', nativeAuthProfile: { id: 'actor' }, activeAVTab: 'open',
        appAccessSnapshotState: { status: 'ready', stale: false, username: 'actor', snapshot: { dataPermissionVersion: 'policy' } },
        getRequestCapabilityUsernameKey: value => value, document: { hidden: false, body: { classList: { contains: () => true } } },
        productionLiveSyncNavigation: new AbortController(), navigator: { onLine: true }, canUseProductionLiveSync: () => true,
        view: 'av', surfaces: [], getActiveManagerReportPageSurface: () => '', getCurrentLoginCacheScopeKey: () => 'actor',
        getProductionLiveSyncSideContext: () => ({ view: ctx.view, surfaces: ctx.surfaces }),
        productionLiveSyncSideAdapters: { getViewAdapters: () => [{ id: 'side:settings' }] },
        RETIRED_DATASET_KEYS: new Set(), getProductionCoreLiveProjection: () => 'browse',
        createProductionCoreLiveAdapter: key => ({ id: `core:${key}` }),
        window: { AgMetricLiveSyncRegistry: { views: { av: { kind: 'data' }, drive: { kind: 'data' }, home: { kind: 'static' } },
            getCoreKeys: view => view === 'home' ? [] : ['reserves', 'master'] } },
        appendSuspendTagBackgroundCustomerRepMap() {}, productionLiveSyncNavigationGeneration: 1, observeHlOrderVerificationContext: value => value
    };
    vm.createContext(ctx); vm.runInContext(extractAppFunction('getProductionLiveSyncContext'), ctx);
    const open = ctx.getProductionLiveSyncContext();
    assert.deepEqual(Array.from(open.previewAdapterIds), ['core:master']);
    assert.equal(open.adapters[0].id, 'core:master');
    ctx.activeAVTab = 'reserves'; const reserves = ctx.getProductionLiveSyncContext();
    assert.equal(reserves.previewAdapterIds, undefined); assert.notEqual(reserves.viewKey, open.viewKey);
    ctx.activeAVTab = 'open'; ctx.surfaces = ['dialog:request']; assert.deepEqual(Array.from(ctx.getProductionLiveSyncContext().previewAdapterIds), ['core:master']);
    ctx.view = 'drive'; ctx.surfaces = []; assert.equal(ctx.getProductionLiveSyncContext().previewAdapterIds, undefined);
});

test('production proof key matches the coordinator identity including sorted preview adapter IDs', () => {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(extractAppFunction('productionVerifiedViewKey'), ctx);
    const context = { scope: 'actor-scope', dataPermissionVersion: 'policy-v1', viewKey: 'av-open',
        adapters: [{ id: 'core:master', cacheKey: 'master/browse' }, { id: 'side:settings', cacheKey: 'settings/v1' }],
        previewAdapterIds: ['side:settings', 'core:master'] };
    const proofKey = ctx.productionVerifiedViewKey(context);
    const coordinatorKey = JSON.stringify([context.scope, context.dataPermissionVersion, context.viewKey,
        context.adapters.map(adapter => [adapter.id, adapter.cacheKey]), ['core:master', 'side:settings']]);
    assert.equal(proofKey, coordinatorKey);
    assert.notEqual(proofKey, ctx.productionVerifiedViewKey({ ...context, previewAdapterIds: ['core:master'] }));
    assert.notEqual(proofKey, ctx.productionVerifiedViewKey({ ...context, previewAdapterIds: undefined }));
    assert.equal(ctx.productionVerifiedViewKey({ ...context, previewAdapterIds: [] }), JSON.stringify([
        context.scope, context.dataPermissionVersion, context.viewKey,
        context.adapters.map(adapter => [adapter.id, adapter.cacheKey]), []
    ]), 'an explicit empty preview subset remains distinct, matching coordinator identity semantics');
});

test('AV filter-field union preserves Drive resolver parity and caches by dataset and access context', () => {
    const calls = [];
    let owner = 'account-a';
    const ctx = { activeDriveTab: 'name', resolvedViewStateEpoch: 3,
        appAccessSnapshotState: { snapshot: { dataPermissionVersion: 'policy-a' } },
        getSupabaseReadIdentityScope: () => owner,
        DRIVE_COLUMN_FILTER_ALLOWED_HEADERS: [
            { key: 'ITEMCODE', label: 'Item Code' }, { key: 'COMMONNAME', label: 'Common Name' },
            { key: 'LOCATIONCODE', label: 'Location' }, { key: 'ASSIGNEDTO', label: 'Assigned To' }
        ],
        DRIVE_COLUMN_FILTER_ALLOWED_HEADER_KEYS: new Set(['ITEMCODE', 'COMMONNAME', 'LOCATIONCODE', 'ASSIGNEDTO']),
        DRIVE_COLUMN_FILTER_COMMON_HEADERS: ['ITEMCODE', 'COMMONNAME', 'LOCATIONCODE', 'ASSIGNEDTO'],
        normalizeDriveColumnFilterKey: value => { calls.push(String(value)); return String(value || '').trim().toUpperCase(); },
        formatDriveColumnHeaderLabel: key => key,
        Array, Object, Map, Set, String, Number, JSON
    };
    vm.createContext(ctx);
    vm.runInContext(`let avColumnFilterFieldsCache = null;\n${extractAppFunction('getDriveColumnFilterFields')}\n${extractAppFunction('getAvColumnFilterFields')}`, ctx);
    const items = [
        { itemcode: 'A', 'Common Name': 'Rose', assignedto: 'Rep 1' },
        { ITEMCODE: 'B', 'Location Code': 'North', assignedto: 'Rep 2' }
    ];
    const baseline = JSON.stringify(ctx.getDriveColumnFilterFields(items));
    calls.length = 0;
    assert.equal(JSON.stringify(ctx.getAvColumnFilterFields(items)), baseline);
    assert.equal(calls.filter(value => value === 'itemcode').length, 1, 'a repeated source header is normalized once across all rows');
    assert.equal(calls.filter(value => value === 'Common Name').length, 1);
    assert.equal(calls.filter(value => value === 'assignedto').length, 1);
    const callsAfterBuild = calls.length;
    ctx.getAvColumnFilterFields(items);
    assert.equal(calls.length, callsAfterBuild, 'a same-context lookup reuses the bounded AV cache');

    owner = 'account-b';
    ctx.getAvColumnFilterFields(items);
    assert.ok(calls.length > callsAfterBuild, 'identity changes invalidate cached field metadata');
    const afterOwner = calls.length;
    ctx.appAccessSnapshotState.snapshot.dataPermissionVersion = 'policy-b';
    ctx.getAvColumnFilterFields(items);
    assert.ok(calls.length > afterOwner, 'permission changes invalidate cached field metadata');
    const afterPermission = calls.length;
    ctx.resolvedViewStateEpoch += 1;
    ctx.getAvColumnFilterFields(items);
    assert.ok(calls.length > afterPermission, 'resolved dataset changes invalidate cached field metadata');
    const afterEpoch = calls.length;
    ctx.activeDriveTab = 'season-sales-notes';
    const seasonal = ctx.getAvColumnFilterFields(items);
    assert.ok(calls.length > afterEpoch, 'the source tab is part of cache identity');
    assert.ok(seasonal.some(field => field.key === 'ASSIGNEDTO'), 'Assigned To remains exposed only for its established tab');
    assert.equal(JSON.stringify(ctx.getAvColumnFilterFields([...items])), JSON.stringify(ctx.getDriveColumnFilterFields(items)));
});

test('revision reads gate status refreshes only for current identity and matching data permissions', async () => {
    const from = html.indexOf('readRevisions: (keys, options = {}) => withProductionLiveSyncSignal');
    const to = html.indexOf('\n                readCachedSnapshot:', from);
    assert.ok(from > 0 && to > from);
    const source = html.slice(from + 'readRevisions: '.length, to).trim().replace(/,$/, '');
    const readiness = [], gate = deferred();
    let owner = 'actor-a';
    const metadata = { contractVersion: 1, permissionVersion: 'policy-a', sources: [{ key: 'ph_master_inventory', revision: '7', state: 'ready' }] };
    const ctx = { getSupabaseReadIdentityScope: () => owner, withProductionLiveSyncSignal: (_signal, action) => action(new AbortController().signal),
        supabaseRpc: async () => metadata, inventoryStatusSync: { setSourceReady: value => readiness.push(value) },
        appAccessSnapshotState: { snapshot: { dataPermissionVersion: 'policy-a' } } };
    vm.createContext(ctx); const read = vm.runInContext(`(${source})`, ctx);
    await read(['ph_master_inventory']); assert.deepEqual(readiness, [true]);
    metadata.sources[0].state = 'importing'; await read(['ph_master_inventory']);
    metadata.sources[0].state = 'ready'; metadata.permissionVersion = 'policy-b'; await read(['ph_master_inventory']);
    assert.deepEqual(readiness, [true, false, false]);
    ctx.supabaseRpc = () => gate.promise;
    const pending = read(['ph_master_inventory']); owner = 'actor-b'; gate.resolve(metadata); await pending;
    assert.equal(readiness.length, 3, 'late metadata from the prior identity is discarded');
    ctx.supabaseRpc = async () => { throw new Error('metadata timeout'); };
    await assert.rejects(read(['ph_master_inventory']), /metadata timeout/);
    assert.deepEqual(readiness, [true, false, false, false], 'failed metadata fences pair retries');
});

test('SIGNED_OUT watcher invalidates pending native recovery before clearing the session', () => {
    const calls = []; let callback;
    const ctx = { window: {}, nativeAuthProfile: { id: 'account-a' }, nativeAuthSessionActive: true, nativeAuthAccessToken: 'old',
        currentUser: 'alice', hasExplicitLogoutMarker: () => false,
        getSupabaseBrowserClient: () => ({ auth: { onAuthStateChange: fn => { callback = fn; return {}; } } }),
        invalidateNativeAuthRecovery: () => calls.push('invalidate'), resetProductionLiveSync: () => calls.push('reset'),
    disposeAuraWidget: () => calls.push('dispose-aura'),
        closeBloomscapesPendingOrders: () => calls.push('close'),
        clearInMemorySessionIdentity: () => { calls.push('clear-identity'); ctx.currentUser = ''; },
        clearCachedNativeAuthProfile: () => calls.push('clear-profile-cache'), resetLoginUiState: () => calls.push('show-login') };
    vm.createContext(ctx);
    const from = html.indexOf('function installNativeRoleRefreshWatchers()');
    vm.runInContext(html.slice(from, html.indexOf("document.addEventListener('visibilitychange'", from)), ctx);
    ctx.installNativeRoleRefreshWatchers(); callback('SIGNED_OUT', null);
    assert.deepEqual(calls.slice(0, 3), ['dispose-aura', 'invalidate', 'reset']);
    assert.equal(ctx.nativeAuthSessionActive, false); assert.equal(ctx.nativeAuthAccessToken, '');
    assert.equal(ctx.currentUser, '', 'confirmed sign-out clears the prior account identity');
    assert.ok(calls.includes('show-login'), 'confirmed sign-out routes back to login');
});

test('native profile transport failures remain retryable and are distinct from a denied profile', async () => {
    const cachedProfile = { id: 'account-a', username: 'alice', role: 'User' };
    const ctx = { Error, String, Date, Promise, navigator: { onLine: true },
        nativeAuthProfile: null, nativeAuthSessionActive: true, nativeAuthAccessToken: 'valid-token', nativeAuthRecoveryEpoch: 1,
        nativeAuthSessionUserId: 'account-a',
        getSupabaseBrowserClient: () => ({}), getNativeAuthSession: async () => ({ user: { id: 'account-a' } }),
        window: { GncDatabase: { readProfile: async () => ({ data: null, error: Object.assign(new Error('service unavailable'), { status: 503 }) }) } },
        localStorage: { getItem: () => JSON.stringify(cachedProfile), setItem() {}, removeItem() {} },
        NATIVE_AUTH_PROFILE_CACHE_KEY: 'native-profile', historicalRequestsOwner: '',
        getHistoricalRequestsOwnerKey: profile => profile.id, destroyHistoricalRequestsIsland() {},
        closeBloomscapesPendingOrders() {}, syncPasskeyPilotUi() {}, auraWidgetHandle: null,
        isAuraProfileCandidate: () => false, disposeAuraWidget() {}, nativeAuthProfileRestorePending: false };
    vm.createContext(ctx);
    vm.runInContext(`${extractAppFunction('isTransientNativeAuthReadFailure')}\n${extractAppFunction('nativeAuthReadRetryError')}\n${extractAppFunction('loadNativeAuthProfile')}`, ctx);
    await assert.rejects(ctx.loadNativeAuthProfile(true), error => error.code === 'NATIVE_PROFILE_RETRY_REQUIRED');
    assert.equal(ctx.nativeAuthProfile, null, 'cached permissions are not installed as verified profile state');
    assert.equal(ctx.nativeAuthProfileRestorePending, true, 'a valid SDK session remains eligible for foreground retry');

    ctx.nativeAuthSessionActive = false;
    ctx.getNativeAuthSession = async () => { throw Object.assign(new Error('session read timed out'), { code: 'NATIVE_PROFILE_RETRY_REQUIRED' }); };
    ctx.nativeAuthProfileRestorePending = false;
    await assert.rejects(ctx.loadNativeAuthProfile(true), error => error.code === 'NATIVE_PROFILE_RETRY_REQUIRED');
    assert.equal(ctx.nativeAuthProfileRestorePending, true, 'an unavailable session read remains eligible for a later verification attempt');

    ctx.getNativeAuthSession = async () => ({ user: { id: 'account-a' } });
    ctx.window.GncDatabase.readProfile = async () => ({ data: { id: 'account-a', disabled_at: '2026-10-01' }, error: null });
    assert.equal(await ctx.loadNativeAuthProfile(true), null, 'an authoritative disabled profile remains denied');
});

test('native profile read cannot install an account after sign-out changes the auth epoch', async () => {
    const gate = deferred(), readStarted = deferred();
    const ctx = { Error, String, Date, Promise, navigator: { onLine: true }, nativeAuthProfile: null,
        nativeAuthSessionActive: true, nativeAuthAccessToken: 'token-a', nativeAuthRecoveryEpoch: 7,
        nativeAuthSessionUserId: 'account-a', getSupabaseBrowserClient: () => ({}),
        getNativeAuthSession: async () => ({ user: { id: 'account-a' } }),
        window: { GncDatabase: { readProfile: () => { readStarted.resolve(); return gate.promise; } } },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, NATIVE_AUTH_PROFILE_CACHE_KEY: 'native-profile',
        cacheNativeAuthProfile() {},
        historicalRequestsOwner: '', getHistoricalRequestsOwnerKey: profile => profile.id,
        destroyHistoricalRequestsIsland() {}, closeBloomscapesPendingOrders() {}, syncPasskeyPilotUi() {},
        auraWidgetHandle: null, isAuraProfileCandidate: () => false, disposeAuraWidget() {} };
    vm.createContext(ctx);
    vm.runInContext(`${extractAppFunction('isTransientNativeAuthReadFailure')}\n${extractAppFunction('nativeAuthReadRetryError')}\n${extractAppFunction('loadNativeAuthProfile')}`, ctx);
    const pending = ctx.loadNativeAuthProfile(true);
    await readStarted.promise;
    ctx.nativeAuthRecoveryEpoch++;
    ctx.nativeAuthSessionActive = false;
    ctx.nativeAuthAccessToken = '';
    gate.resolve({ data: { id: 'account-a', username: 'alice', role: 'Admin' }, error: null });
    await assert.rejects(pending, error => error.code === 'NATIVE_AUTH_PROFILE_READ_STALE');
    assert.equal(ctx.nativeAuthProfile, null, 'the late profile is not installed after the session changes');
});

test('native session bridge cannot persist a prior subject after logout or account switch', async () => {
    const makeContext = () => {
        const gate = deferred(), persisted = [];
        const ctx = { NATIVE_AUTH_ENABLED: true, nativeAuthSessionActive: true,
            nativeAuthRecoveryEpoch: 4, nativeAuthSessionUserId: 'account-a',
            nativeAuthProfile: { id: 'account-a', username: 'alice', display_name: 'Alice', role: 'Admin' },
            currentUser: 'alice', currentUserDisplay: 'Alice', currentRole: 'Admin',
            APP_API_FUNCTION_URL: 'https://api.example.invalid',
            postAppFunctionJson: () => gate.promise,
            getCurrentAppSessionToken: () => '',
            persistAppSessionRecord: record => { persisted.push(record); },
            firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') || '' };
        vm.createContext(ctx);
        vm.runInContext(extractAppFunction('ensureNativeAppSessionBridge'), ctx);
        return { ctx, gate, persisted };
    };

    for (const transition of ['logout', 'account-b']) {
        const { ctx, gate, persisted } = makeContext();
        const pending = ctx.ensureNativeAppSessionBridge(true);
        // A routine refresh for the same subject remains within the bridge owner.
        ctx.nativeAuthAccessToken = 'refreshed-access-token';
        if (transition === 'logout') {
            ctx.nativeAuthRecoveryEpoch++;
            ctx.nativeAuthSessionActive = false;
            ctx.nativeAuthSessionUserId = '';
            ctx.nativeAuthProfile = null;
        } else {
            ctx.nativeAuthRecoveryEpoch++;
            ctx.nativeAuthSessionUserId = 'account-b';
            ctx.nativeAuthProfile = { id: 'account-b', username: 'bob', role: 'User' };
        }
        gate.resolve({ ok: true, session: { token: 'old-account-session-token', expiresAt: Date.now() + 60000,
            username: 'alice', role: 'Admin' } });
        assert.equal(await pending, null, `stale bridge result is discarded after ${transition}`);
        assert.deepEqual(persisted, [], `old account token is never persisted after ${transition}`);
    }

    {
        const { ctx, persisted } = makeContext();
        ctx.nativeAuthRecoveryEpoch++;
        ctx.nativeAuthSessionUserId = 'account-b';
        ctx.nativeAuthProfile = { id: 'account-b', username: 'bob', role: 'User' };
        ctx.currentUser = 'bob';
        ctx.getCurrentAppSessionToken = () => 'old-account-session-token';
        ctx.readPersistedAppSessionRecord = () => ({ token: 'old-account-session-token', username: 'alice' });
        let bridgeRequests = 0;
        ctx.postAppFunctionJson = async () => {
            bridgeRequests++;
            return { ok: true, session: { token: 'new-account-session-token', expiresAt: Date.now() + 60000,
                username: 'bob', role: 'User' } };
        };
        const result = await ctx.ensureNativeAppSessionBridge(false);
        assert.equal(result && result.token, 'new-account-session-token', 'cached token owned by another username is bypassed');
        assert.equal(bridgeRequests, 1);
        assert.equal(persisted[0].username, 'bob');
    }

    const { ctx, gate, persisted } = makeContext();
    const pending = ctx.ensureNativeAppSessionBridge(true);
    ctx.nativeAuthAccessToken = 'refreshed-access-token';
    gate.resolve({ ok: true, session: { token: 'same-account-session-token', expiresAt: Date.now() + 60000,
        username: 'alice', role: 'Admin' } });
    const result = await pending;
    assert.equal(result && result.ok, true);
    assert.equal(result && result.token, 'same-account-session-token');
    assert.equal(result && result.source, 'native-bridge');
    assert.equal(persisted.length, 1, 'same-subject token refresh does not invalidate the bridge result');
    assert.equal(persisted[0].username, 'alice');
});

test('native startup restore fences profile, bridge, and finalize continuations to their original subject', async () => {
    const profileA = { id: 'account-a', username: 'alice', display_name: 'Alice', role: 'Admin', division: '10', language: 'English' };
    const profileB = { id: 'account-b', username: 'bob', display_name: 'Bob', role: 'User', division: '20', language: 'English' };
    const makeContext = ({ loadProfile, bridge, finalize } = {}) => {
        const calls = [];
        const ctx = { Error, String, Promise, NATIVE_AUTH_ENABLED: true, nativeAuthRecoveryEpoch: 11,
            nativeAuthSessionUserId: 'account-a', nativeAuthSessionActive: true, nativeAuthProfile: profileA,
            nativeAuthAccessToken: 'token-a', nativeAuthProfileRestorePending: true, nativeAuthRestoreRetryPromise: null,
            document: { hidden: false, getElementById: () => null }, window: {}, navigator: { onLine: true },
            hasExplicitLogoutMarker: () => false, startLoginNetworkTrace() {}, loadNativeAuthProfile: loadProfile || (async () => profileA),
            beginInitialAppLoad() {}, scheduleLoginStartupWatchdog() {}, normalizeAppUserLanguage: value => value,
            ensureNativeAppSessionBridge: bridge || (async () => ({ ok: true })),
            finalizeLogin: finalize || (async (...args) => { calls.push(['finalize', ...args]); }),
            getSupabaseBrowserClient: () => ({ auth: { signOut: async () => {} } }),
            finishInitialAppLoad: () => calls.push(['finish-load']),
            clearInMemorySessionIdentity: () => { calls.push(['clear-identity']); ctx.currentUser = ''; },
            resetLoginUiState: () => calls.push(['reset-login']),
            currentUser: '', currentUserDisplay: '', currentRole: '', currentUserDivision: '10', currentUserLanguage: 'English', safeRole: '' };
        vm.createContext(ctx);
        vm.runInContext(extractAppFunction('restoreNativeAuthSessionOnStartup'), ctx);
        return { ctx, calls };
    };

    {
        const profileRead = deferred(), readStarted = deferred();
        const { ctx, calls } = makeContext({ loadProfile: () => { readStarted.resolve(); return profileRead.promise; } });
        const restore = ctx.restoreNativeAuthSessionOnStartup();
        await readStarted.promise;
        ctx.nativeAuthRecoveryEpoch++;
        ctx.nativeAuthSessionActive = false;
        ctx.nativeAuthSessionUserId = '';
        ctx.nativeAuthProfile = null;
        profileRead.resolve(profileA);
        assert.equal(await restore, false, 'logout while profile loading prevents identity restoration');
        assert.equal(ctx.currentUser, '', 'stale profile does not repopulate the logged-out identity');
        assert.equal(calls.some(call => call[0] === 'finalize'), false);
    }

    for (const transition of ['logout', 'account-b']) {
        const bridge = deferred(), bridgeStarted = deferred();
        const { ctx, calls } = makeContext({ bridge: () => { bridgeStarted.resolve(); return bridge.promise; } });
        const restore = ctx.restoreNativeAuthSessionOnStartup();
        await bridgeStarted.promise;
        ctx.nativeAuthRecoveryEpoch++;
        if (transition === 'logout') {
            ctx.nativeAuthSessionActive = false;
            ctx.nativeAuthSessionUserId = '';
            ctx.nativeAuthProfile = null;
            ctx.currentUser = '';
        } else {
            ctx.nativeAuthSessionActive = true;
            ctx.nativeAuthSessionUserId = 'account-b';
            ctx.nativeAuthProfile = profileB;
            ctx.currentUser = 'bob';
        }
        bridge.resolve(null);
        assert.equal(await restore, false, `${transition} while bridge is pending cancels the old restore`);
        assert.equal(calls.some(call => call[0] === 'finalize'), false, 'stale bridge continuation never finalizes');
        assert.equal(ctx.currentUser, transition === 'logout' ? '' : 'bob', 'stale restore does not overwrite the newer identity');
        assert.equal(calls.some(call => call[0] === 'clear-identity' || call[0] === 'reset-login'), false,
            'stale restore does not clear or reset the newer session UI');
    }

    {
        const finalizeGate = deferred(), finalizeStarted = deferred();
        const { ctx, calls } = makeContext({ finalize: () => { finalizeStarted.resolve(); return finalizeGate.promise; } });
        const restore = ctx.restoreNativeAuthSessionOnStartup();
        await finalizeStarted.promise;
        ctx.nativeAuthRecoveryEpoch++;
        ctx.nativeAuthSessionUserId = 'account-b';
        ctx.nativeAuthProfile = profileB;
        ctx.currentUser = 'bob';
        finalizeGate.reject(new Error('old account finalize failed after switch'));
        assert.equal(await restore, false, 'a stale finalize failure is not reported as a successful restore');
        assert.equal(ctx.currentUser, 'bob');
        assert.equal(calls.some(call => call[0] === 'clear-identity' || call[0] === 'reset-login'), false,
            'stale finalize failure does not reset the new account UI');
    }

    {
        const calls = [];
        const { ctx } = makeContext({ bridge: async () => null,
            finalize: async (...args) => { calls.push(args); } });
        assert.equal(await ctx.restoreNativeAuthSessionOnStartup(), true,
            'same-subject startup can continue when the legacy app-session bridge is temporarily unavailable');
        assert.equal(calls.length, 1);
        assert.equal(calls[0][0], 'alice');
    }
});

test('native password sign-in does not revoke a valid SDK session for a retryable profile failure', async () => {
    let signOuts = 0;
    const session = { access_token: 'valid-token', user: { id: 'account-a' } };
    const ctx = { Error, String, Promise, NATIVE_AUTH_ENABLED: true, SUPABASE_KEY: 'public-key',
        navigator: { onLine: true }, window: {}, nativeAuthProfile: null, nativeAuthSessionActive: false,
        nativeAuthAccessToken: '', inventoryFieldCountingMode: false,
        getSupabaseBrowserClient: () => ({ auth: { signInWithPassword: async () => ({ data: { session }, error: null }),
            signOut: async () => { signOuts++; } } }), normalizeNativeAuthAlias: () => 'alice@example.invalid',
        invalidateNativeAuthRecovery() {}, destroyFieldCountingIsland() {}, destroyHistoricalRequestsIsland() {},
        loadNativeAuthProfile: async () => { throw Object.assign(new Error('profile endpoint unavailable'), { code: 'NATIVE_PROFILE_RETRY_REQUIRED' }); },
        clearCachedNativeAuthProfile() {}, closeBloomscapesPendingOrders() {},
        BunchNote: { reset() {} }, SalesWorkspace: { reset() {} }, LocationCode: { reset() {} } };
    vm.createContext(ctx); vm.runInContext(extractAppFunction('tryNativeAuthPasswordLogin'), ctx);
    await assert.rejects(ctx.tryNativeAuthPasswordLogin('alice', 'secret'), error => error.code === 'NATIVE_PROFILE_RETRY_REQUIRED');
    assert.equal(signOuts, 0, 'transient profile failure must not destroy the SDK session');
    assert.equal(ctx.nativeAuthSessionActive, true);
    assert.equal(ctx.nativeAuthAccessToken, 'valid-token');
});

test('native profile restore retries only in foreground and coalesces resume signals', async () => {
    const gate = deferred(); let restores = 0;
    const ctx = { Promise, nativeAuthProfileRestorePending: true, nativeAuthSessionActive: false,
        document: { hidden: true }, restoreNativeAuthSessionOnStartup: () => { restores++; return gate.promise; },
        nativeAuthRestoreRetryPromise: null };
    vm.createContext(ctx); vm.runInContext(extractAppFunction('retryNativeAuthRestoreOnForeground'), ctx);
    assert.equal(await ctx.retryNativeAuthRestoreOnForeground(), false);
    assert.equal(restores, 0, 'hidden state does not start auth restoration');
    ctx.document.hidden = false;
    const first = ctx.retryNativeAuthRestoreOnForeground();
    const joined = ctx.retryNativeAuthRestoreOnForeground();
    await Promise.resolve();
    assert.equal(restores, 1, 'focus and visibility signals share one restore attempt');
    gate.resolve(true);
    assert.deepEqual(await Promise.all([first, joined]), [true, true]);
});

test('legacy realtime suspension clears queued work and rejects late channel callbacks', () => {
    const calls = [];
    const channel = { id: 'legacy-channel' };
    const ctx = { document: { hidden: true }, realtimeSubscriptionGeneration: 8,
        realtimeChannels: [channel], supabaseClient: { removeChannel: value => calls.push(['remove-channel', value]) },
        realtimeChangeTimer: 11, realtimeChangeQueue: [{ tableName: 'ph_master_inventory' }],
        pendingRealtimeDatasetFlushTimer: 12, pendingRealtimeDatasetFlushTables: new Set(['ph_master_inventory']),
        fallbackSyncInterval: 13, syncCatchupTimer: 14, foregroundRefreshTimer: 15, foregroundRefreshQueuedAt: 1234,
        realtimeFallbackStartTimer: 16, realtimeTableStatus: {}, appLiveEventAreaStatus: {}, liveSyncMode: 'realtime',
        clearTimeout: value => calls.push(['clear-timeout', value]), clearInterval: value => calls.push(['clear-interval', value]),
        clearRealtimeReconnectTimer() {}, clearVisibleViewPollSync() {}, clearRequestViewLiveSync() {}, updateSyncDiagnostics() {},
        canUseProductionLiveSync: () => false };
    vm.createContext(ctx);
    vm.runInContext(`${extractAppFunction('cleanupRealtime')}
        ${extractAppFunction('isCurrentLegacyRealtimeSubscription')}`, ctx);
    const staleGeneration = ctx.realtimeSubscriptionGeneration;
    assert.equal(ctx.isCurrentLegacyRealtimeSubscription(staleGeneration), false, 'hidden pages reject legacy realtime callbacks');
    ctx.document.hidden = false;
    assert.equal(ctx.isCurrentLegacyRealtimeSubscription(staleGeneration), true, 'visible legacy callbacks remain enabled before suspension');
    ctx.cleanupRealtime();
    assert.equal(ctx.realtimeSubscriptionGeneration, staleGeneration + 1, 'cleanup invalidates in-flight channel callbacks');
    assert.equal(ctx.isCurrentLegacyRealtimeSubscription(staleGeneration), false, 'late subscription status/events are discarded');
    assert.deepEqual(calls.find(call => call[0] === 'remove-channel'), ['remove-channel', channel]);
    for (const id of [11, 12, 14, 15, 16]) assert.ok(calls.some(call => call[0] === 'clear-timeout' && call[1] === id), `queued timeout ${id} is cleared`);
    assert.ok(calls.some(call => call[0] === 'clear-interval' && call[1] === 13), 'fallback polling interval is stopped');
    assert.equal(ctx.pendingRealtimeDatasetFlushTables.size, 0, 'missed realtime deltas are recovered from the visible refresh, not replayed later');
    assert.equal(ctx.foregroundRefreshQueuedAt, 0);
    assert.equal(ctx.realtimeChannels.length, 0);
});

test('legacy foreground and realtime work cannot be queued while hidden', () => {
    const scheduled = [];
    const ctx = { document: { hidden: true }, navigator: { onLine: true }, currentUser: { id: 'alice' },
        realtimeSubscriptionGeneration: 2, realtimeChangeQueue: [], realtimeChangeTimer: null,
        pendingRealtimeDatasetFlushTables: new Set(), pendingRealtimeDatasetFlushTimer: null,
        foregroundRefreshTimer: null, foregroundRefreshQueuedAt: 0,
        setTimeout: callback => { scheduled.push(callback); return scheduled.length; }, clearTimeout() {},
        canUseProductionLiveSync: () => true, signalProductionLiveSync: () => scheduled.push('native-signal') };
    vm.createContext(ctx);
    vm.runInContext(`${extractAppFunction('queueForegroundRefresh')}\n${extractAppFunction('queueRealtimeChange')}`, ctx);
    ctx.queueForegroundRefresh(0);
    ctx.queueRealtimeChange('ph_master_inventory', { eventType: 'UPDATE' });
    assert.deepEqual(scheduled, [], 'hidden legacy work does not start a timer or signal the native coordinator');
    assert.deepEqual(ctx.realtimeChangeQueue, []);
    assert.equal(ctx.foregroundRefreshTimer, null);
});

test('late legacy SUBSCRIBED, CLOSED and row events are inert after suspension', () => {
    let rowCallback; let statusCallback; let sideEffects = 0;
    const channel = { on(_type, _options, callback) { rowCallback = callback; return this; },
        subscribe(callback) { statusCallback = callback; return this; } };
    const ctx = { document: { hidden: false }, navigator: { onLine: true }, Date, Promise,
        REALTIME_STARTUP_GRACE_MS: 5000, APP_LIVE_EVENTS_TABLE: 'app_live_events',
        realtimeSubscriptionGeneration: 0, realtimeChannels: [], realtimeChangeTimer: null,
        realtimeChangeQueue: [], realtimeDirtyIdsByTable: new Map(), realtimeTableStatus: {},
        pendingRealtimeDatasetFlushTables: new Set(), pendingRealtimeDatasetFlushTimer: null,
        fallbackSyncInterval: null, realtimeFallbackStartTimer: null, syncCatchupTimer: null,
        foregroundRefreshTimer: null, foregroundRefreshQueuedAt: 0, activeRealtimeTables: [],
        activeRealtimeContextViewId: 'home', activeVisibleViewPollMs: 0, liveSyncMode: 'idle',
        appLiveEventAreaStatus: {}, realtimeStartupUntil: 0,
        clearTimeout() {}, clearInterval() {}, clearRealtimeReconnectTimer() {}, clearVisibleViewPollSync() {},
        clearRequestViewLiveSync() {}, updateSyncDiagnostics() {},
        canUseProductionLiveSync: () => false, normalizeRealtimeTableList: tables => tables,
        shouldUseRealtime: () => true, getSupabaseBrowserClient: () => ({ channel: () => channel }),
        buildRealtimeChannelName: () => 'legacy-test', buildRealtimeChangeOptions: () => ({}),
        setRealtimeTableStatus() { sideEffects++; }, queueRealtimeChange() { sideEffects++; },
        isRealtimeRequiredTableForCurrentView() { sideEffects++; return true; },
        getLiveSyncPolicy() { sideEffects++; return { realtimeTables: [] }; } };
    vm.createContext(ctx);
    vm.runInContext(`${extractAppFunction('cleanupRealtime')}\n${extractAppFunction('isCurrentLegacyRealtimeSubscription')}\n${extractAppFunction('initializeRealtime')}`, ctx);
    ctx.initializeRealtime(['ph_master_inventory']);
    assert.equal(typeof rowCallback, 'function');
    assert.equal(typeof statusCallback, 'function');
    ctx.document.hidden = true;
    ctx.cleanupRealtime();
    const sideEffectsBeforeLateCallbacks = sideEffects;
    rowCallback({ eventType: 'UPDATE' });
    statusCallback('SUBSCRIBED');
    statusCallback('CLOSED');
    assert.equal(sideEffects, sideEffectsBeforeLateCallbacks, 'removed channel callbacks cannot queue catchup or change subscription state');
    assert.equal(ctx.liveSyncMode, 'idle', 'late CLOSED/SUBSCRIBED statuses cannot replace the suspended state');
});

test('visible legacy foreground refresh remains coalesced to one recovery read', async () => {
    const scheduled = []; const reads = [];
    const ctx = { document: { hidden: false }, navigator: { onLine: true }, currentUser: { id: 'alice' },
        foregroundRefreshTimer: null, foregroundRefreshQueuedAt: 0, lastForegroundRefreshRunAt: 0,
        backgroundRefreshInFlight: false, lastBackgroundRefreshAt: 0,
        setTimeout: callback => { scheduled.push(callback); return scheduled.length; }, clearTimeout() {},
        isTouchConstrainedDevice: () => false, shouldSkipPassiveRefreshAfterLocalSave: () => false,
        updateSyncDiagnostics() {}, getCurrentVisibleViewId: () => 'home',
        resolveRealtimeContextViewId: value => value, getLiveSyncPolicy: () => ({ realtimeTables: [], pollMs: 0 }),
        shouldDeferInteractiveBackgroundWork: () => false, shouldUseRealtime: () => false,
        isIOSDevice: () => false, isStandaloneApp: () => false,
        fetchBackgroundData: async source => { reads.push(source); } };
    vm.createContext(ctx);
    vm.runInContext(extractAppFunction('queueForegroundRefresh'), ctx);
    ctx.queueForegroundRefresh(0);
    ctx.queueForegroundRefresh(0);
    assert.equal(scheduled.length, 1, 'repeated visible resume signals coalesce');
    await scheduled[0]();
    assert.deepEqual(reads, ['background'], 'the visible legacy path performs one recovery read');
});


test('native background validation refreshes the existing session without signing in again or persisting a password', async () => {
    let callback; const calls = [];
    const ctx = { String, currentUser: 'alice', nativeAuthRecoveryEpoch: 4, navigator: { onLine: true },
        normalizeSessionIdentity: value => value.trim().toLowerCase(), nativeReadRequiresRls: () => true,
        setTimeout: fn => { callback = fn; }, getNativeAuthRequestHeaders: async () => { calls.push('headers'); return {}; },
        refreshNativeRoleAndCapabilities: async () => { calls.push('roles'); },
        fetchRemoteLoginUser: async () => { calls.push('forbidden-password-login'); },
        persistVerifiedLoginRecord: () => { calls.push('forbidden-password-storage'); } };
    vm.createContext(ctx);
    const from = html.indexOf('function scheduleBackgroundLoginValidation(');
    vm.runInContext(html.slice(from, html.indexOf('function getLoginReadHeaders()', from)), ctx);
    ctx.scheduleBackgroundLoginValidation('alice', 'synthetic'); await callback();
    assert.deepEqual(calls, ['headers', 'roles']);
    calls.length = 0; ctx.scheduleBackgroundLoginValidation('alice', 'synthetic'); ctx.currentUser = 'bob'; await callback();
    assert.deepEqual(calls, []);
});


test('initial restored auth event keeps its pending session read while a known account change invalidates it', () => {
    const calls = []; let callback;
    const ctx = { window: {}, nativeAuthProfile: null, nativeAuthSessionUserId: '',
        getSupabaseBrowserClient: () => ({ auth: { onAuthStateChange: fn => { callback = fn; return {}; } } }),
        invalidateNativeAuthRecovery: () => calls.push('invalidate'), resetProductionLiveSync: () => calls.push('reset'),
        disposeAuraWidget: () => calls.push('dispose-aura'),
        closeBloomscapesPendingOrders: () => {}, setTimeout: () => {} };
    vm.createContext(ctx);
    const from = html.indexOf('function installNativeRoleRefreshWatchers()');
    vm.runInContext(html.slice(from, html.indexOf("document.addEventListener('visibilitychange'", from)), ctx);
    ctx.installNativeRoleRefreshWatchers(); callback('INITIAL_SESSION', { user: { id: 'account-a' } });
    assert.deepEqual(calls, []);
    ctx.nativeAuthProfile = { id: 'account-a' };
    callback('SIGNED_IN', { user: { id: 'account-b' } });
    assert.deepEqual(calls, ['dispose-aura', 'invalidate', 'reset']);
});

test('native account switch clears old app identity before restoring the new SDK account', async () => {
    const calls = []; let callback; let deferredAuthCallback;
    const ctx = { window: {}, nativeAuthProfile: { id: 'account-a' }, nativeAuthSessionActive: true,
        nativeAuthAccessToken: 'token-a', nativeAuthProfileRestorePending: false,
        currentUser: 'alice', hasExplicitLogoutMarker: () => false,
        getSupabaseBrowserClient: () => ({ auth: { onAuthStateChange: fn => { callback = fn; return {}; } } }),
        invalidateNativeAuthRecovery: () => calls.push('invalidate'), resetProductionLiveSync: () => calls.push('reset'),
        disposeAuraWidget() {}, closeBloomscapesPendingOrders() {},
        clearInMemorySessionIdentity: () => { calls.push('clear-identity'); ctx.currentUser = ''; },
        clearCachedNativeAuthProfile: () => calls.push('clear-profile-cache'), resetLoginUiState: () => calls.push('show-login'),
        retryNativeAuthRestoreOnForeground: async () => { calls.push('restore-account-b'); },
        setTimeout: fn => { deferredAuthCallback = fn; } };
    vm.createContext(ctx);
    const from = html.indexOf('function installNativeRoleRefreshWatchers()');
    vm.runInContext(html.slice(from, html.indexOf("document.addEventListener('visibilitychange'", from)), ctx);
    ctx.installNativeRoleRefreshWatchers();
    callback('SIGNED_IN', { access_token: 'token-b', user: { id: 'account-b' } });
    assert.equal(ctx.currentUser, '', 'account A is removed before account B starts restoring');
    assert.equal(ctx.nativeAuthProfile, null);
    assert.equal(ctx.nativeAuthSessionActive, true);
    assert.equal(ctx.nativeAuthAccessToken, 'token-b');
    assert.ok(calls.includes('show-login'));
    await deferredAuthCallback();
    assert.ok(calls.includes('restore-account-b'));
});

test('iOS runtime self-heal timers are canceled while hidden and rearmed on foreground', () => {
    const timers = new Map(), listeners = new Map(); let nextTimer = 0;
    const ctx = { Date, Math, Promise, iosRuntimeSelfHealInitialized: false, iosRuntimeSelfHealTimer: null,
        iosRuntimeSelfHealMonitorTimer: null, document: { hidden: true, addEventListener: (type, fn) => listeners.set(`document:${type}`, fn) },
        window: { visualViewport: null, addEventListener: (type, fn) => listeners.set(`window:${type}`, fn) },
        isIOSDevice: () => true, isStandaloneApp: () => false, isRecentCameraActivity: () => false,
        scheduleSettledIosRuntimeSelfHeal() {}, runIosRuntimeSelfHeal: async () => {},
        setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
        clearTimeout: id => timers.delete(id) };
    vm.createContext(ctx);
    vm.runInContext(`${extractAppFunction('scheduleIosRuntimeSelfHeal')}\n${extractAppFunction('clearIosRuntimeSelfHealMonitor')}\n${extractAppFunction('scheduleIosRuntimeSelfHealMonitor')}\n${extractAppFunction('initializeIosRuntimeSelfHeal')}`, ctx);
    ctx.initializeIosRuntimeSelfHeal();
    assert.equal(timers.size, 0, 'initialization while hidden does not arm timers');
    ctx.document.hidden = false; listeners.get('document:visibilitychange')();
    assert.equal([...timers.values()].some(timer => timer.delay === 140), true, 'foreground repair is scheduled');
    assert.equal([...timers.values()].some(timer => timer.delay === 30000), true, 'visible runtime gets one bounded monitor');
    ctx.document.hidden = true; listeners.get('document:visibilitychange')();
    assert.equal(timers.size, 0, 'backgrounding cancels pending repair and monitor timers');
});
// @test-group: foundation

test('independent reads start together without the global two-read bottleneck', async () => {
  const ctx = fixture();
  ctx.SUPABASE_READ_CONCURRENCY_LIMIT = 2;
  const gate = deferred();
  let started = 0;
  const reads = Array.from({ length: 5 }, (_, index) => ctx.runDedupeSupabaseRead(`parallel:${index}`, async () => {
    started += 1;
    await gate.promise;
    return [];
  }));
  await settle();
  const observed = started;
  gate.resolve();
  await Promise.all(reads);
  assert.equal(observed, 5, 'unrelated reads do not wait for a global slot');
});

test('raw version conflict codes and messages are terminal to generic read retries', () => {
  const ctx = fixture();
  for (const error of [
    { code: '40001', message: 'conflict' },
    { code: 'PT409', message: 'conflict' },
    { code: 'REQUEST_VERSION_CONFLICT' },
    { message: 'REQUEST_VERSION_CONFLICT' },
    { code: 'LOC_ON_HAND_REVISION_CHANGED' },
    { code: 'LOC_ON_HAND_SOURCE_NOT_READY' }
  ]) assert.equal(ctx.isSupabaseReadRetryable(error), false, JSON.stringify(error));
});

function makeRequestSaveHarness(waitForRetry) {
  const ctx = { window: {}, waitForSupabaseReadRetry: waitForRetry, REQUEST_WORK_CONFLICT_RETRY_LIMIT: 1 };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../assets/request-submission.js', import.meta.url), 'utf8'), ctx);
  const start = html.indexOf('async function saveRequestWorkWithReconciliation(');
  const end = html.indexOf('const REQUEST_WORK_DRAFT_FIELDS', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(html.slice(start, end), ctx);
  return ctx;
}

const requestDraft = () => ({
  requestId: 'request-1', baseVersion: 4,
  baseValues: { req_spec: 'base spec', req_comments: 'base comments' },
  dirtyValues: { req_spec: 'local spec' }, complete: false
});
const requestCanonical = () => ({
  rowVersion: 5, values: { req_spec: 'base spec', req_comments: 'remote comments' }
});
const requestConflict = () => Object.assign(new Error('REQUEST_VERSION_CONFLICT'), { code: 'PT409', status: 409 });

test('request conflicts allow one canonical read and one delayed rebase, preserving the blocked draft', async () => {
  const gate = deferred();
  const delays = [];
  const ctx = makeRequestSaveHarness(ms => { delays.push(ms); return gate.promise; });
  let reads = 0;
  const sends = [];
  const pending = ctx.saveRequestWorkWithReconciliation({
    draft: requestDraft(), expectedVersion: 4, initialPatch: { req_spec: 'local spec' },
    maxRebases: 100, assertScope() {},
    readCanonical: async () => { reads += 1; return requestCanonical(); },
    send: async input => { sends.push(input); throw requestConflict(); }
  });
  await settle();
  assert.equal(sends.length, 1, 'no immediate conflict retry');
  assert.equal(reads, 1);
  assert.deepEqual(delays, [1000]);
  gate.resolve();
  const outcome = await pending;
  assert.equal(sends.length, 2);
  assert.equal(sends[1].expectedVersion, 5);
  assert.deepEqual({ ...sends[1].patch }, { req_spec: 'local spec' });
  assert.equal(reads, 1, 'second conflict cannot dispatch another canonical read');
  assert.equal(outcome.status, 'review-required');
  assert.deepEqual({ ...outcome.draft.dirtyValues }, { req_spec: 'local spec' });
  assert.match(html, /requestSaveOutcome\.status === 'review-required'[\s\S]*?await blockRequestWorkConflict/);
  assert.match(html, /reconciliation\.status === 'review-required'[\s\S]*?entry\.autoRetryBlocked = true/);
  assert.match(html, /if \(entry && entry\.autoRetryBlocked === true\) continue;/);
});

test('identity or permission changes during rebase delay cancel dispatch and preserve local edits', async () => {
  const gate = deferred();
  const ctx = makeRequestSaveHarness(() => gate.promise);
  let currentScope = true;
  let sends = 0;
  const pending = ctx.saveRequestWorkWithReconciliation({
    draft: requestDraft(), expectedVersion: 4, initialPatch: { req_spec: 'local spec' },
    assertScope() { if (!currentScope) throw Object.assign(new Error('Scope changed'), { code: 'DATASET_READ_SCOPE_CHANGED' }); },
    readCanonical: async () => requestCanonical(),
    send: async () => { sends += 1; throw requestConflict(); }
  });
  await settle();
  currentScope = false;
  gate.resolve();
  const outcome = await pending;
  assert.equal(sends, 1);
  assert.equal(outcome.status, 'error');
  assert.equal(outcome.error.code, 'DATASET_READ_SCOPE_CHANGED');
  assert.deepEqual({ ...outcome.draft.dirtyValues }, { req_spec: 'local spec' });
});

test('successful request saves remain immediate and require no canonical reread', async () => {
  const ctx = makeRequestSaveHarness(() => assert.fail('successful save must not back off'));
  let sends = 0;
  const outcome = await ctx.saveRequestWorkWithReconciliation({
    draft: requestDraft(), expectedVersion: 4, initialPatch: { req_spec: 'local spec' }, assertScope() {},
    readCanonical: async () => assert.fail('successful save must not reread'),
    send: async () => { sends += 1; return { row: { unique_id: 'request-1', req_spec: 'local spec' }, row_version: 5 }; }
  });
  assert.equal(outcome.status, 'saved');
  assert.equal(sends, 1);
  assert.equal(outcome.result.row_version, 5);
});

test('AV complete paging uses a 50-row preview followed by concurrent 500-row inventory pages', async () => {
  const sourceRows = Array.from({ length: 1200 }, (_, index) => ({ unique_id: `inventory-${index + 1}` }));
  const calls = [];
  const ctx = {
    fetchInventoryReadPage: async (operation, params, limit, offset) => {
      calls.push({ operation, limit, offset });
      const rows = sourceRows.slice(offset, offset + limit);
      return { rows, total: sourceRows.length, hasMore: offset + rows.length < sourceRows.length,
        projection: 'browse', fieldCoverage: 'browse', columns: ['unique_id'] };
    },
    yieldToUiFrame: async () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(extractMasterPagingFunction(), ctx);
  let previewMeta = null;
  const rows = await ctx.fetchAllInventoryReadRows('master_page', { dataset: 'master', projection: 'browse' }, {
    firstPageLimit: 50, limit: 500, pageConcurrency: 2, requireComplete: true,
    onFirstPage: (pageRows, meta) => { previewMeta = { count: pageRows.length, ...meta }; }
  });

  assert.deepEqual(calls.slice(0, 2).map(({ offset, limit }) => [offset, limit]), [[0, 50], [50, 500]]);
  assert.deepEqual(calls.slice(2).map(({ offset, limit }) => [offset, limit]).sort((a, b) => a[0] - b[0]), [[550, 500], [1050, 500]]);
  assert.equal(previewMeta.count, 50);
  assert.equal(previewMeta.limit, 50);
  assert.equal(rows.length, 1200);
  assert.equal(rows[0].unique_id, 'inventory-1');
  assert.equal(rows.at(-1).unique_id, 'inventory-1200');
  assert.equal(rows.readMeta.fieldCoverage, 'browse');
});

test('AV small cold preview continues from its exact first-page offset and verifies every row', async () => {
  const sourceRows = Array.from({ length: 1200 }, (_, index) => ({ unique_id: `inventory-${index + 1}` }));
  const calls = [];
  const ctx = {
    fetchInventoryReadPage: async (_operation, _params, limit, offset) => {
      calls.push({ limit, offset });
      const rows = sourceRows.slice(offset, offset + limit);
      return { rows, total: sourceRows.length, hasMore: offset + rows.length < sourceRows.length,
        projection: 'browse', fieldCoverage: 'browse', columns: ['unique_id'] };
    },
    yieldToUiFrame: async () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(extractMasterPagingFunction(), ctx);
  let previewCount = 0;
  const rows = await ctx.fetchAllInventoryReadRows('master_page', { dataset: 'master', projection: 'browse' }, {
    firstPageLimit: 16, limit: 500, requireComplete: true,
    onFirstPage: pageRows => { previewCount = pageRows.length; }
  });

  assert.deepEqual(calls.slice(0, 3).map(({ offset, limit }) => [offset, limit]), [[0, 16], [16, 500], [516, 500]]);
  assert.equal(previewCount, 16);
  assert.equal(rows.length, sourceRows.length);
  assert.deepEqual(Array.from(rows, row => row.unique_id), sourceRows.map(row => row.unique_id));
  assert.equal(rows.readMeta.fieldCoverage, 'browse');
});

test('AV no-count paging finds the terminal page through ordered keyset reads', async () => {
  const sourceRows = Array.from({ length: 9638 }, (_, index) => ({ unique_id: `inventory-${String(index + 1).padStart(5, '0')}` }));
  const calls = [];
  let activeReads = 0;
  let maximumActiveReads = 0;
  const ctx = {
    fetchInventoryReadPage: async (_operation, _params, limit, offset, options = {}) => {
      calls.push({ limit, offset, afterUniqueId: options.afterUniqueId || '' });
      activeReads += 1;
      maximumActiveReads = Math.max(maximumActiveReads, activeReads);
      await new Promise(resolve => setTimeout(resolve, 1));
      activeReads -= 1;
      const start = options.afterUniqueId
        ? sourceRows.findIndex(row => row.unique_id > options.afterUniqueId)
        : offset;
      const rows = sourceRows.slice(start < 0 ? sourceRows.length : start, (start < 0 ? sourceRows.length : start) + limit);
      return { rows, total: null, hasMore: rows.length === limit,
        projection: 'full', fieldCoverage: 'full', columns: ['unique_id'] };
    },
    yieldToUiFrame: async () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(extractMasterPagingFunction(), ctx);
  const rows = await ctx.fetchAllInventoryReadRows('master_page', { dataset: 'master', projection: 'full' }, {
    firstPageLimit: 200, limit: 1000, pageConcurrency: 2, requireComplete: true
  });

  assert.deepEqual(calls.slice(0, 2).map(({ offset, limit }) => [offset, limit]), [[0, 200], [200, 1000]]);
  assert.equal(calls[1].afterUniqueId, 'inventory-00200');
  assert.equal(maximumActiveReads, 1);
  assert.ok(calls.some(call => call.afterUniqueId === 'inventory-09200' && call.limit === 1000));
  assert.equal(rows.length, sourceRows.length);
  assert.equal(rows.at(-1).unique_id, 'inventory-09638');
  assert.equal(rows.readMeta.total, sourceRows.length);
  assert.equal(rows.readMeta.rowCompleteness, 'complete');
});

test('AV exact item hydration uses a bounded full-field keyset read', async () => {
  const sourceRows = Array.from({ length: 125 }, (_, index) => ({
    unique_id: `item-${String(index + 1).padStart(3, '0')}`,
    itemcode: '008866.031.1'
  }));
  const calls = [];
  const ctx = {
    fetchDirectMasterInventoryPage: async (params, limit, _offset, options = {}) => {
      calls.push({ params, limit, afterUniqueId: options.afterUniqueId || '' });
      const start = options.afterUniqueId
        ? sourceRows.findIndex(row => row.unique_id > options.afterUniqueId)
        : 0;
      return { rows: sourceRows.slice(start < 0 ? sourceRows.length : start, (start < 0 ? sourceRows.length : start) + limit),
        limit, projection: 'full', fieldCoverage: 'full', columns: ['unique_id', 'itemcode'] };
    },
    validateInventoryReadProjection: () => true,
    yieldToUiFrame: async () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(extractAppFunction('fetchDirectMasterInventoryItemRows'), ctx);
  const rows = await ctx.fetchDirectMasterInventoryItemRows('008866.031.1');
  assert.equal(rows.length, 125);
  assert.deepEqual(calls.map(call => [call.params.projection, call.params.itemCode, call.limit, call.afterUniqueId]), [
    ['full', '008866.031.1', 100, ''],
    ['full', '008866.031.1', 100, 'item-100']
  ]);
});

test('AV exact item overlay survives the first partial master preview for the same account', () => {
  const ctx = {
    exactAvSearchHydrationRows: [{ UNIQUE_ID: 'alice-1', ITEMCODE: '008866.031.1' }],
    exactAvSearchHydrationOwner: 'owner-1',
    exactAvSearchHydrationPermission: 'permission-1',
    exactAvSearchHydrationItemCode: '008866.031.1',
    getSupabaseReadIdentityScope: () => 'owner-1',
    appAccessSnapshotState: { snapshot: { dataPermissionVersion: 'permission-1' } },
    document: { getElementById: () => ({ value: '008866.031.1' }) },
    getExactAvSearchItemCode: value => String(value || '').trim(),
    firstNonEmptyValue: (...values) => values.find(value => value != null && value !== '')
  };
  vm.createContext(ctx);
  vm.runInContext(`${extractAppFunction('getCurrentExactAvSearchHydrationRows')}\n${extractAppFunction('mergeExactAvSearchRowsIntoPreview')}`, ctx);
  const merged = ctx.mergeExactAvSearchRowsIntoPreview([{ UNIQUE_ID: 'preview-1' }], {
    readIdentity: 'owner-1', dataPermissionVersion: 'permission-1'
  });
  assert.deepEqual(Array.from(merged, row => row.UNIQUE_ID), ['preview-1', 'alice-1']);
  assert.equal(ctx.mergeExactAvSearchRowsIntoPreview([{ UNIQUE_ID: 'preview-1' }], {
    readIdentity: 'owner-2', dataPermissionVersion: 'permission-1'
  }).length, 1);
});

test('complete concurrent paging rejects a short continuation page instead of publishing a partial snapshot', async () => {
  const sourceRows = Array.from({ length: 1200 }, (_, index) => ({ unique_id: `inventory-${index + 1}` }));
  const ctx = {
    fetchInventoryReadPage: async (operation, params, limit, offset) => {
      const end = offset === 550 ? offset + limit - 1 : offset + limit;
      return { rows: sourceRows.slice(offset, end), total: sourceRows.length, hasMore: offset + limit < sourceRows.length,
        projection: 'browse', fieldCoverage: 'browse', columns: ['unique_id'] };
    },
    yieldToUiFrame: async () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(extractMasterPagingFunction(), ctx);

  await assert.rejects(ctx.fetchAllInventoryReadRows('master_page', { dataset: 'master', projection: 'browse' }, {
    firstPageLimit: 50, limit: 500, pageConcurrency: 2, requireComplete: true
  }), /Inventory page was incomplete/);
});


test('Drive Common Names finishes all 9486 rows after a small preview and keeps complete 432-name proof', async () => {
  const sourceRows = Array.from({ length: 9486 }, (_, index) => ({ unique_id: `drive-${index}`, commonname: `Plant ${index % 432}` }));
  const offsets = [];
  const ctx = {
    fetchInventoryReadPage: async (_operation, _params, limit, offset) => {
      offsets.push(offset);
      return { rows: sourceRows.slice(offset, offset + limit), total: sourceRows.length, hasMore: offset + limit < sourceRows.length,
        projection: 'browse', fieldCoverage: 'browse', columns: ['unique_id', 'commonname'] };
    }, yieldToUiFrame: async () => {}, shouldScopeMasterInventoryToCurrentEval: () => false,
    MIN_TRUSTED_MASTER_COMMON_NAME_CACHE_COUNT: 1200,
    firstNonEmptyValue: (...values) => values.find(value => value != null && value !== '')
  };
  vm.createContext(ctx);
  vm.runInContext(extractMasterPagingFunction() + extractAppFunction('countUniqueCacheCommonNames')
    + extractAppFunction('masterRowsLookPartialForCurrentScope'), ctx);
  const rows = await ctx.fetchAllInventoryReadRows('master_page', { projection: 'browse' }, { firstPageLimit: 75, limit: 500, requireComplete: true });
  assert.equal(rows.length, 9486);
  assert.equal(new Set(rows.map(row => row.commonname)).size, 432);
  assert.equal(rows.readMeta.rowCompleteness, 'complete');
  assert.equal(ctx.masterRowsLookPartialForCurrentScope(rows), false);
  assert.equal(ctx.masterRowsLookPartialForCurrentScope(rows.slice(0, 75)), true);
  assert.equal(offsets[1], 75);
  assert.equal(rows.at(-1).unique_id, 'drive-9485');
});

test('sequential full inventory paging rejects changing source totals', async () => {
  const ctx = {
    fetchInventoryReadPage: async (_operation, _params, limit, offset) => ({
      rows: Array.from({ length: limit }, (_, index) => ({ unique_id: `row-${offset + index}` })),
      total: offset === 0 ? 1000 : 1001, hasMore: true, projection: 'browse', fieldCoverage: 'browse', columns: ['unique_id']
    }), yieldToUiFrame: async () => {}
  };
  vm.createContext(ctx); vm.runInContext(extractMasterPagingFunction(), ctx);
  await assert.rejects(ctx.fetchAllInventoryReadRows('master_page', {}, { requireComplete: true }), /Inventory total changed/);
});
