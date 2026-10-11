import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function previewProductionSnapshots(');
const end = html.indexOf('\n        function writeProductionVerifiedSnapshot(', start);
assert.ok(start >= 0 && end > start, 'previewProductionSnapshots source is present');

function makePreviewContext(confirmedRevision = '') {
  const commits = [], processed = [], scheduled = [], groups = new Set();
  const currentIdentity = 'identity-a';
  const ctx = {
    hasProductionLiveSyncDraft: () => false,
    confirmedArgosReclassLiveEditRevisions: new Map(confirmedRevision ? [[currentIdentity, confirmedRevision]] : []),
    getArgosReclassLiveEditIdentityKey: () => currentIdentity,
    invalidateResolvedViewStateCaches: () => {},
    scheduleProductionLiveSyncRender: (...args) => scheduled.push(args),
    processAndLoadData: payload => processed.push(payload),
    productionDisplayGroupKey: () => 'display-key',
    productionDisplaySnapshotTimes: new Map(),
    productionDisplayVerifiedAt: new Map(),
    productionDisplayGroups: groups,
    renderProductionDataFreshness: () => {},
    productionLiveSyncCoordinator: { getStatus: () => ({ state: 'Syncing' }) },
    Date, JSON, Array, Set, Map,
  };
  vm.createContext(ctx);
  vm.runInContext(`${html.slice(start, end)}; globalThis.preview = previewProductionSnapshots;`, ctx);
  return { ctx, commits, processed, scheduled, groups };
}

const progressiveContext = { progressive: true, visible: true };
const plain = value => JSON.parse(JSON.stringify(value));

test('confirmed local revision skips only the cached master preview and still commits other adapters', () => {
  const fixture = makePreviewContext('501');
  const sideValue = { currentSeason: 'F1' };
  fixture.ctx.preview([
    { adapter: { id: 'core:master' }, value: { cached: true, payload: { data: [{ unique_id: 'row-1', priority: 'old' }] } } },
    { adapter: { id: 'side:settings', commit: value => fixture.commits.push(value) }, value: sideValue },
  ], progressiveContext);

  assert.deepEqual(fixture.commits, [sideValue]);
  assert.equal(fixture.processed.length, 0, 'stale master cache is never passed to processAndLoadData');
  assert.equal(fixture.groups.size, 0, 'partial display cache does not claim a complete preview cohort');
  assert.equal(fixture.scheduled.length, 1, 'other available display data can still refresh the view');
});

test('confirmed local revision permits a fresh master preview and ordinary caches remain unchanged', () => {
  const fixture = makePreviewContext('501');
  const freshRows = [{ unique_id: 'row-1', priority: 'confirmed' }];
  fixture.ctx.preview([
    { adapter: { id: 'core:master' }, value: { payload: { data: freshRows } } },
  ], progressiveContext);
  assert.deepEqual(plain(fixture.processed), [{ _verifiedLiveSync: true, _fromCache: true, data: freshRows }]);
  assert.equal(fixture.groups.has('display-key'), true);

  const ordinary = makePreviewContext();
  ordinary.ctx.preview([
    { adapter: { id: 'core:master' }, value: { cached: true, payload: { data: freshRows } } },
  ], progressiveContext);
  assert.deepEqual(plain(ordinary.processed), [{ _verifiedLiveSync: true, _fromCache: true, data: freshRows }]);
  assert.equal(ordinary.groups.has('display-key'), true);
});
