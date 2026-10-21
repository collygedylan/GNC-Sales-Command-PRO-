import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readComposedAppSource().replace(/\r\n/g, '\n');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = source.indexOf('\n        function ', start + 1);
  assert.ok(end > start);
  return source.slice(start, end);
}

test('AV initially renders 20 cards and advances bounded slices without losing full cohort', () => {
  const context = vm.createContext({ Math, Number });
  vm.runInContext(extract('getAvCardWindowEnd'), context);
  const end = context.getAvCardWindowEnd;
  assert.equal(end(3236, 0), 20);
  assert.equal(end(3236, 20), 40);
  assert.equal(end(100, 90), 100);
  assert.equal(end(5, 0), 5);
  assert.equal(end(0, 0), 0);
  const seen = [];
  for (let start = 0; start < 3236;) {
    const next = end(3236, start);
    for (let index = start; index < next; index++) seen.push(index);
    start = next;
  }
  assert.equal(new Set(seen).size, 3236);
  assert.equal(seen.at(-1), 3235);
});

test('AV export preserves the complete input and ordering with two reusable collators', () => {
  let collators = 0;
  const context = vm.createContext({ activeAVTab: 'open', activeAvOpenTab: 'all', String, Array,
    Intl: { Collator: class { constructor(...args) { collators++; return new Intl.Collator(...args); } } },
  });
  vm.runInContext(extract('buildAVExportContext'), context);
  const rows = Array.from({ length: 3236 }, (_, index) => ({ COMMONNAME: `Plant ${index % 12}`,
    CONTSIZE: `#${index % 20}`, LOCATIONCODE: `C.${3236 - index}` }));
  const original = rows.slice();
  const expected = rows.slice().sort((a, b) => a.COMMONNAME.localeCompare(b.COMMONNAME)
    || a.CONTSIZE.localeCompare(b.CONTSIZE, undefined, { numeric: true })
    || a.LOCATIONCODE.localeCompare(b.LOCATIONCODE, undefined, { numeric: true }));
  const result = context.buildAVExportContext(rows).rows;
  assert.equal(result.length, 3236);
  assert.deepEqual(Array.from(result), expected);
  assert.deepEqual(rows, original);
  assert.equal(collators, 2);
});

test('AV reserve decoration caches a shared reserve group once per derivation', () => {
  let calls = 0;
  const context = vm.createContext({ Map, Array, Object,
    decorateAvReserveLocationRow: (row, matches) => { calls++; row.AV_RESERVE_QTY_TOTAL = matches.length; return row; },
  });
  vm.runInContext(extract('decorateAvSalesReserveRow'), context);
  const reserves = [{ ITEMCODE: 'A' }];
  const cache = new Map();
  const first = context.decorateAvSalesReserveRow({ LOCATIONCODE: 'A' }, reserves, cache);
  const second = context.decorateAvSalesReserveRow({ LOCATIONCODE: 'B' }, reserves, cache);
  assert.equal(calls, 1);
  assert.equal(first.AV_RESERVE_QTY_TOTAL, 1);
  assert.equal(second.LOCATIONCODE, 'B');
  assert.equal(second.AV_RESERVE_MATCHED, 'YES');
  context.decorateAvSalesReserveRow({}, reserves, new Map());
  assert.equal(calls, 2, 'new snapshot invalidates summary cache');
});

test('AV lazy continuation is guarded by retained snapshot identity and supports a button fallback', () => {
  const render = extract('renderAVOpenCardsChunked');
  assert.match(render, /getAvCardWindowEnd\(total, 0\)/);
  assert.match(render, /installAvCardWindowContinuation/);
  const continuation = extract('installAvCardWindowContinuation');
  assert.match(continuation, /container\._avCardWindow !== state/);
  assert.match(continuation, /IntersectionObserver/);
  assert.match(continuation, /addEventListener\('click'/);
  assert.match(continuation, /insertAdjacentHTML\('beforebegin'/);
  assert.match(continuation, /getCurrentVisibleViewId\(\) !== 'av'/);
  assert.doesNotMatch(continuation, /getActiveView/);
});

test('AV lazy continuation appends the next 20 cards through the real view guard', () => {
  let click;
  let markup = '';
  const button = { isConnected: true, disabled: false,
    addEventListener: (event, callback) => { if (event === 'click') click = callback; },
    insertAdjacentHTML: (_position, html) => { markup += html; }, remove: () => {},
  };
  const container = { querySelector: () => button, dataset: {} };
  const context = vm.createContext({ Math, Number,
    getCurrentVisibleViewId: () => 'av',
    generateCard: row => `[${row.DOM_ID}]`,
    requestAnimationFrame: callback => callback(),
    refreshCartButtons: () => {}, scheduleDeferredCardPhotoHydration: () => {},
  });
  vm.runInContext(extract('getAvCardWindowEnd') + '\n' + extract('installAvCardWindowContinuation'), context);
  const rows = Array.from({ length: 100 }, (_, i) => ({ DOM_ID: `row-${i}` }));
  context.installAvCardWindowContinuation(container, rows, 'av', 20, 'snapshot');
  click();
  assert.equal(container.dataset.avWindowCount, '40');
  assert.equal(markup, rows.slice(20, 40).map(row => `[${row.DOM_ID}]`).join(''));
});

test('one derivation snapshots season settings and indexes row facts for stock and current eligibility', () => {
  let settingsReads = 0;
  let factReads = 0;
  const context = vm.createContext({ WeakMap,
    getAvConfiguredCurrentSeasonCode: () => { settingsReads++; return 'F1'; },
    getAvConfiguredCurrentSalesYearCode: () => { settingsReads++; return 27; },
    getAvNextUpSeasonTarget: () => { settingsReads++; return { season: 'S1' }; },
    normalizeNcrSeasonCode: value => String(value || '').trim().toUpperCase(),
    getAvSalesSeasonValue: row => { factReads++; return row.season; },
    getAvSalesYearNumber: row => row.year,
    AV_OPEN_ALLOWED_SEASONS: ['F1', 'S1', 'U1', 'U2'],
  });
  vm.runInContext(extract('createAvSalesWindowPredicates'), context);
  const predicates = context.createAvSalesWindowPredicates();
  const cases = [
    [{ season: 'F1', year: 26 }, true, true], [{ season: 'F1', year: 27 }, true, true],
    [{ season: 'F1', year: 28 }, false, false], [{ season: 'S1', year: 28 }, true, false],
    [{ season: 'U1', year: 27 }, true, false], [{ season: 'U2', year: 28 }, false, false],
    [{ season: 'Y', year: 27 }, false, false], [{ season: 'F1', year: null }, false, false],
  ];
  for (const [row, open, current] of cases) {
    assert.equal(!!predicates.open(row), open);
    assert.equal(predicates.current(row), current);
    assert.equal(!!predicates.open(row), open);
  }
  assert.equal(settingsReads, 3);
  assert.equal(factReads, cases.length);
});

test('current-season preparation narrows once before stock indexing and retains only identity-scoped previews', () => {
  const derive = extract('createAvSalesRowsDerivation');
  assert.ok(derive.indexOf('allSourceRows.filter') < derive.indexOf('sourceRows.forEach'));
  const render = extract('getAvSalesRowsForRendering');
  assert.match(render, /avDerivedPreviewCache\?\.key === identity\.key && avDerivedPreviewCache\.scope === identity\.scope/);
  assert.match(render, /service\.clearScope\(avDerivedRowsActiveScope\);\s*avDerivedPreviewCache = null/);
  assert.ok(render.indexOf('avDerivedPreviewCache?.key') < render.indexOf('const previewDerivation'));
  assert.match(render, /rows: avDerivedPreviewCache\.rows, partial: true/);
});

test('AV verified revisions reuse preparation across publication timestamps while local changes remain invalidating', () => {
  const rows = [{}];
  const state = { fullLoaded: true, fieldCoverage: 'full', liveVerifiedScope: 'owner',
    liveVerifiedPermission: 'permission', liveVerifiedRevision: '8', lastLoadedAt: 'first' };
  const context = vm.createContext({ JSON, String, Array,
    getDatasetState: () => state,
    getProductionLiveSyncContext: () => ({ scope: 'owner', dataPermissionVersion: 'permission' }),
    getAvDerivedRowsArrayId: value => value === rows ? 'first-array' : 'replacement-array',
    getDatasetLoadSignature: () => state.lastLoadedAt,
  });
  vm.runInContext(extract('getAvDerivationSourceVersion'), context);
  const first = context.getAvDerivationSourceVersion('master', rows);
  state.lastLoadedAt = 'second';
  assert.equal(context.getAvDerivationSourceVersion('master', [{}]), first);
  state.liveVerifiedRevision = '9';
  assert.notEqual(context.getAvDerivationSourceVersion('master', rows), first);
  state.liveVerifiedScope = 'different-owner';
  assert.notEqual(context.getAvDerivationSourceVersion('master', rows),
    context.getAvDerivationSourceVersion('master', [{}]), 'unverified rows retain array identity');
  const identity = extract('getAvSalesDerivationIdentity');
  assert.match(identity, /avDerivationMutationEpoch/);
  assert.doesNotMatch(identity, /resolvedViewStateEpoch|warehouseAssignedItems/);
  assert.match(identity, /safeBucket === 'hot-price'/);
  assert.match(extract('invalidateResolvedViewStateCaches'), /preserveAvPreparation !== true\) avDerivationMutationEpoch \+= 1/);
});

test('same-count realtime reserve changes invalidate AV preparation before publication', () => {
  const context = vm.createContext({ Date, avDerivationMutationEpoch: 3,
    getDatasetKeysForTable: table => [table], getDatasetState: () => ({}),
  });
  vm.runInContext(extract('touchRealtimeDatasetState'), context);
  context.touchRealtimeDatasetState(['ph_reserves']);
  assert.equal(context.avDerivationMutationEpoch, 4);
  context.touchRealtimeDatasetState(['ph_soc_master']);
  assert.equal(context.avDerivationMutationEpoch, 4);
  context.touchRealtimeDatasetState(['ph_master_inventory']);
  assert.equal(context.avDerivationMutationEpoch, 5);
});

test('all-stock first paint does not format photo URLs for the full cohort', () => {
  assert.match(extract('createAvSalesRowsDerivation'), /preparePhotos && avItemHasPhotos\(decorated\)/);
  const rows = [{ id: 1 }, { id: 2 }];
  const prepared = { epoch: 1, all: { rows } };
  let checks = 0;
  const context = vm.createContext({ Array, avDerivationMutationEpoch: 1,
    avPreparedRawTabRows: new WeakMap([[rows, prepared]]), photoMode: 'all',
    getAvPhotoMode: () => context.photoMode,
    avItemHasPhotos: row => { checks++; return row.id === 2; },
  });
  vm.runInContext(extract('getAvRawTabItems'), context);
  assert.equal(context.getAvRawTabItems('open', { salesRows: rows }), rows);
  assert.equal(checks, 0);
  context.photoMode = 'photos';
  assert.deepEqual(Array.from(context.getAvRawTabItems('open', { salesRows: rows })), [rows[1]]);
  context.getAvRawTabItems('open', { salesRows: rows });
  assert.equal(checks, 2, 'photo selection caches the same complete cohort');
});
