import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const contractContext = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('../assets/inventory-list-contract.js', import.meta.url), 'utf8'), contractContext);
const contract = contractContext.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
function helper(name) {
    const match = html.match(new RegExp(`        (?:async )?function ${name}\\([^]*?\\n        \\}`));
    assert.ok(match, `Real helper ${name} exists`);
    return match[0];
}
function canonicalRows(count) {
    return Array.from({ length: count }, (_, index) => ({
        ...Object.fromEntries(Array.from(contract.columns, (name) => [name, null])),
        unique_id: `synthetic-${index}`, commonname: 'Synthetic Maple', itemcode: `ITEM-${index % 3}`,
        locationcode: 'A.01.001', lotcode: '27.F1', source: 'LD', contsize: '#3', ptravailable: '12',
        sales_note: '', photo_link: null, photo_name: null
    }));
}
function wireRows(rows) {
    return rows.map((row) => Object.fromEntries(Array.from(contract.columns, (name, index) => [contract.aliases[index], row[name]])));
}
function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}
function fixture() {
    const calls = { formats: 0, yields: 0, reads: [], order: [] };
    const ctx = {
        window: { AgMetricInventoryList: contract, AgMetricLiveSyncRegistry: { getSourceKeys: () => ['ph_master_inventory'] } },
        performance: { now: () => 0 }, identity: 'account-a:permission-1', productionLiveSyncReadGeneration: 7,
        getSupabaseReadIdentityScope: () => ctx.identity,
        normalizeAppTableName: (name) => name,
        parseAppNumber: (value) => value === '' || value == null ? null : Number(value),
        repairDisplayFieldsOnRow: (row) => row,
        // Only photo normalization's external behavior is a small boundary here;
        // the actual formatter, search builder, map key builders and stage execute.
        normalizeRowPhotoFields: (row) => { calls.formats++; row.PHOTO_NORMALIZED = true; return row; },
        getMasterInventorySourceCode: (row) => String(row.SOURCE || '').toUpperCase(),
        yieldToUiFrame: async () => { calls.yields++; },
        DATASET_DEFINITIONS: {
            master: { table: 'ph_master_inventory', sourceTable: 'ph_master_inventory', fullQuery: () => 'select=*' },
            soc: { table: 'ph_soc_master', sourceTable: 'ph_soc_master', fullQuery: 'select=*&order=unique_id.asc' }
        },
        fetchAllSupabaseRows: async (table, query) => { calls.reads.push({ table, query }); return ctx.wire; },
        fullInventory: [{ UNIQUE_ID: 'previous' }], masterInventoryById: new Map([['previous', {}]]),
        masterInventoryByExactKey: new Map(), masterInventoryByItemCode: new Map()
    };
    vm.createContext(ctx);
    vm.runInContext([
        'firstNonEmptyValue', 'normalizeSearchValue', 'buildSearchIndex', 'formatFetchedRows',
        'scopeMasterInventoryRowsForCurrentUser', 'getMasterInventoryExactKey', 'getItemInquiryItemCode',
        'staleSupabaseReadScopeError', 'prepareMasterListDatasetPayload', 'buildDatasetPayload',
        'createProductionCoreLiveAdapter'
    ].map(helper).join('\n'), ctx);
    return { ctx, calls };
}

test('detached staging yields by row budget and preserves canonical values and index reference identity', async () => {
    const { ctx, calls } = fixture(), canonical = canonicalRows(260), wire = wireRows(canonical);
    const original = JSON.stringify(wire), previous = ctx.fullInventory, previousMap = ctx.masterInventoryById;
    ctx.yieldToUiFrame = async () => {
        calls.yields++;
        assert.equal(ctx.fullInventory, previous, 'no partial array publication at a yield');
        assert.equal(ctx.masterInventoryById, previousMap, 'no partial index publication at a yield');
        assert.equal(calls.formats, calls.yields * 128, 'fixed upper bound even when clock does not advance');
    };
    const payload = await ctx.prepareMasterListDatasetPayload(wire);
    assert.equal(calls.yields, 2); assert.equal(calls.formats, 260);
    assert.equal(JSON.stringify(wire), original, 'raw wire snapshot was never mutated');
    assert.equal(ctx.fullInventory, previous);
    assert.equal(payload.data.length, 260);
    const prepared = payload._preparedMasterList;
    assert.equal(prepared.rows, payload.data); assert.equal(prepared.version, contract.version);
    assert.equal(prepared.byId.size, 260); assert.equal(prepared.byExactKey.size, 3);
    for (const [index, row] of payload.data.entries()) {
        assert.equal(row.DOM_ID, `fi_${index}`); assert.equal(row.PTRAVAILABLE, '12');
        assert.equal(row.SALES_NOTE, ''); assert.equal(row.PHOTO_LINK, null);
        assert.equal(Object.hasOwn(row, 'QUANTITYORDERED'), false);
        assert.equal(contract.isListRow(row), true);
        assert.equal(prepared.byId.get(row.UNIQUE_ID), row);
        assert.ok(row._searchCandidates.includes('synthetic maple'));
    }
    assert.equal(prepared.byExactKey.get('ITEM-0__A.01.001__27.F1__LD'), payload.data[0], 'exact-key index stays first-wins');
    assert.deepEqual(Array.from(prepared.byItemCode.get('ITEM-0'), (row) => row.UNIQUE_ID), canonical.filter((row) => row.itemcode === 'ITEM-0').map((row) => row.unique_id));
    const cloned = structuredClone(payload);
    assert.equal(cloned._preparedMasterList.rows, cloned.data);
    assert.equal(cloned._preparedMasterList.byId.get('synthetic-0'), cloned.data[0]);
    assert.equal(contract.getCompleteness(cloned.data[0]), null, 'publication explicitly retags after cloning');
});

test('elapsed-time budget yields before the maximum row count', async () => {
    const { ctx, calls } = fixture(); let time = 0, previousCount = 0;
    ctx.performance.now = () => { time += 3; return time; };
    ctx.yieldToUiFrame = async () => {
        calls.yields++;
        assert.ok(calls.formats - previousCount <= 3);
        previousCount = calls.formats;
    };
    await ctx.prepareMasterListDatasetPayload(wireRows(canonicalRows(10)));
    assert.equal(calls.yields, 3);
});

test('scope and generation changes discard detached work at the next yield', async () => {
    for (const change of ['identity', 'generation']) {
        const { ctx, calls } = fixture(), previous = ctx.fullInventory;
        ctx.yieldToUiFrame = async () => {
            calls.yields++;
            if (change === 'identity') ctx.identity = 'account-b:permission-2';
            else ctx.productionLiveSyncReadGeneration++;
        };
        await assert.rejects(ctx.prepareMasterListDatasetPayload(wireRows(canonicalRows(260))), { code: 'DATASET_READ_SCOPE_CHANGED' });
        assert.equal(calls.yields, 1); assert.equal(calls.formats, 128);
        assert.equal(ctx.fullInventory, previous);
    }
});

test('duplicate identities across chunks and malformed late rows fail without publication', async () => {
    for (const corrupt of ['duplicate', 'missing-alias']) {
        const { ctx, calls } = fixture(), wire = wireRows(canonicalRows(130)), previous = ctx.fullInventory;
        if (corrupt === 'duplicate') wire[129] = { ...wire[0] };
        else delete wire[129].f0;
        await assert.rejects(ctx.prepareMasterListDatasetPayload(wire), { code: 'INVENTORY_LIST_CONTRACT_INVALID' });
        assert.equal(calls.yields, 1); assert.equal(ctx.fullInventory, previous);
    }
    const { ctx } = fixture();
    const payload = await ctx.prepareMasterListDatasetPayload([]);
    assert.equal(payload.data.length, 0); assert.equal(payload._preparedMasterList.byId.size, 0);
});

test('native master adapter alone selects compact aliases and versions its cache identity', async () => {
    const { ctx, calls } = fixture(); ctx.wire = wireRows(canonicalRows(2));
    const adapter = ctx.createProductionCoreLiveAdapter('master');
    const avAdapter = ctx.createProductionCoreLiveAdapter('avOpen');
    assert.equal(adapter.id, 'core:master'); assert.equal(avAdapter.cacheKey, adapter.cacheKey);
    assert.deepEqual(JSON.parse(adapter.cacheKey), ['master', 'ph_master_inventory', contract.buildQuery(), contract.version]);
    const result = await adapter.stage();
    assert.equal(result.listProjectionVersion, contract.version); assert.equal(result.rowCount, 2);
    assert.equal(result.payload.data[1].UNIQUE_ID, 'synthetic-1');
    assert.deepEqual(calls.reads, [{ table: 'ph_master_inventory', query: contract.buildQuery() }]);
    const soc = ctx.createProductionCoreLiveAdapter('soc');
    assert.deepEqual(JSON.parse(soc.cacheKey), ['soc', 'ph_soc_master', 'select=*&order=unique_id.asc']);
    const gate = deferred();
    ctx.fetchAllSupabaseRows = async () => { await gate.promise; return ctx.wire; };
    const stale = adapter.stage();
    ctx.productionLiveSyncReadGeneration++;
    gate.resolve();
    await assert.rejects(stale, { code: 'DATASET_READ_SCOPE_CHANGED' });
    delete ctx.window.AgMetricInventoryList;
    assert.throws(() => ctx.createProductionCoreLiveAdapter('master'), /contract is unavailable/);
});

test('real paginator retains all aliased identities across unknown-count concurrent pages', async () => {
    const { ctx } = fixture(), wire = wireRows(canonicalRows(260)), offsets = [];
    Object.assign(ctx, {
        runDedupeSupabaseRead: (_key, fn) => fn(), startGlobalProgress() {}, stopGlobalProgress() {},
        beginInternalPerfMeasure: () => 0, getFullDatasetPageLimit: () => 64, getFullDatasetPageConcurrency: () => 2,
        incrementInternalPerfCounter() {}, recordInternalPerfDuration() {},
        fetchSupabaseRowsPage: async (_table, query, limit, offset) => {
            assert.equal(query, contract.buildQuery()); offsets.push(offset);
            return { offset, rows: wire.slice(offset, offset + limit), total: null };
        }
    });
    vm.runInContext([helper('fetchSupabaseRowsPageBatch'), helper('fetchAllSupabaseRows')].join('\n'), ctx);
    const all = await ctx.fetchAllSupabaseRows('ph_master_inventory', contract.buildQuery());
    assert.equal(all.length, 260);
    assert.deepEqual(plain(contract.decodeRows(all)).map((row) => row.unique_id), canonicalRows(260).map((row) => row.unique_id));
    assert.deepEqual(offsets, [0, 64, 128, 192, 256]);
});

test('actual preview and commit callbacks carry list completeness version without marking previews verified', async () => {
    const { ctx } = fixture(), states = new Map(), applied = [];
    Object.assign(ctx, {
        getProductionDataScope: () => 'account-a',
        getDatasetState: (key) => { if (!states.has(key)) states.set(key, {}); return states.get(key); },
        processAndLoadData: (payload) => applied.push(payload), scheduleProductionLiveSyncRender() {},
        invalidateResolvedViewStateCaches() {}, TRACKED_VIEW_IDS: [], markViewDirty() {}, productionSeasonDerivationPending: false
    });
    vm.runInContext(helper('previewProductionDatasetSnapshots'), ctx);
    const start = html.indexOf('commitSnapshots: (snapshots, context, metadata) => {');
    const end = html.indexOf('                subscribe:', start);
    assert.ok(start >= 0 && end > start);
    const callback = html.slice(start, end).replace(/^commitSnapshots:\s*/, '').trim().replace(/,$/, '');
    vm.runInContext(`this.commitFixture = (${callback});`, ctx);
    const payload = await ctx.prepareMasterListDatasetPayload(wireRows(canonicalRows(1)));
    const snapshots = [{ adapter: { id: 'core:master' }, value: { key: 'master', payload, listProjectionVersion: contract.version } }];
    const metadata = { permissionVersion: 'permission-a', sources: new Map([['ph_master_inventory', { state: 'ready', revision: '9007199254740993' }]]) };
    ctx.previewProductionDatasetSnapshots(snapshots, { scope: 'account-a' }, metadata);
    assert.equal(states.get('master').listProjectionVersion, contract.version);
    assert.equal(states.get('master').fullLoaded, false);
    assert.equal(states.get('master').liveVerifiedRevision, undefined);
    assert.equal(states.get('master').cachedPreview, true);
    assert.equal(applied[0]._fromCache, true);
    ctx.commitFixture(snapshots, { scope: 'account-a' }, metadata);
    assert.equal(states.get('master').listProjectionVersion, contract.version);
    assert.equal(states.get('master').fullLoaded, true);
    assert.equal(states.get('master').cachedPreview, false);
    assert.equal(states.get('master').liveVerifiedRevision, '9007199254740993');
    assert.equal(states.get('avOpen').listProjectionVersion, contract.version);
    assert.equal(applied[1]._verifiedLiveSync, true);
    assert.equal(applied[1].data, payload.data);
});

test('prepared master publication reuses maps atomically before season/inheritance and retains legacy fallback', async () => {
    const { ctx, calls } = fixture();
    const preparedPayload = structuredClone(await ctx.prepareMasterListDatasetPayload(wireRows(canonicalRows(3))));
    // Structured clones cross this test VM boundary; use its Map constructors so
    // the production instanceof validation behaves as it does in the browser.
    ctx.clonePayload = preparedPayload;
    vm.runInContext(`for (const key of ['byId','byExactKey','byItemCode']) clonePayload._preparedMasterList[key] = new Map(clonePayload._preparedMasterList[key]);`, ctx);
    Object.assign(ctx, {
        requestsInventory: [], salesOfficeInventory: [], flyerFolderInventory: [], socInventory: [], reservesInventory: [],
        applyMasterAppTabAssignments: (rows) => {
            calls.order.push('assign');
            assert.equal(ctx.fullInventory, rows);
            assert.equal(ctx.masterInventoryById.get(rows[0].UNIQUE_ID), rows[0]);
        },
        collectMasterAvRuleClearOps: () => { throw new Error('Verified publish must not clear server evidence'); },
        rebuildMasterInventoryIndexes: () => { calls.order.push('rebuild'); ctx.masterInventoryById = new Map(ctx.fullInventory.map((row) => [row.UNIQUE_ID, row])); },
        hydrateNcrCurrentCropRowsFromSources: (opts) => { assert.equal(opts.remote, false); calls.order.push('ncr'); },
        hydrateMovedSeasonCurrentRowsFromSources: (opts) => { assert.equal(opts.remote, false); calls.order.push('moved'); },
        invalidateMasterDerivedInventories: () => calls.order.push('invalidate'),
        invalidateInventoryDomIdLookup() {}, buildAvOpenInventoryFromMasterItems: () => [],
        rebuildDetailLookupIndexes() {}, invalidateResolvedViewStateCaches() {}, applyLocalEdits() {},
        applyPendingRequestArchives() {}, scheduleTaskHotCacheWarmup() {}, updateDashboardSyncSummary() {}
    });
    vm.runInContext(helper('processAndLoadData'), ctx);
    const beforeFormats = calls.formats;
    ctx.processAndLoadData({ ...preparedPayload, _verifiedLiveSync: true });
    assert.equal(ctx.fullInventory, preparedPayload.data);
    assert.equal(ctx.masterInventoryByExactKey, preparedPayload._preparedMasterList.byExactKey);
    assert.equal(ctx.masterInventoryByItemCode, preparedPayload._preparedMasterList.byItemCode);
    assert.equal(calls.formats, beforeFormats, 'prepared rows were not normalized a second time');
    assert.deepEqual(calls.order, ['assign', 'ncr', 'moved', 'invalidate']);
    assert.equal(contract.isListRow(ctx.fullInventory[0]), true);
    calls.order.length = 0;
    // Invalid prepared identity must never install maps for a different array.
    const legacy = ctx.formatFetchedRows(canonicalRows(1), 'ph_master_inventory');
    ctx.applyMasterAppTabAssignments = () => calls.order.push('assign');
    ctx.processAndLoadData({ data: legacy, _preparedMasterList: preparedPayload._preparedMasterList, _verifiedLiveSync: true });
    assert.deepEqual(calls.order, ['assign', 'rebuild', 'ncr', 'moved', 'invalidate']);
    assert.equal(ctx.fullInventory.length, 1);
});
