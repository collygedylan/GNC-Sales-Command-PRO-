import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: @v2314-parity
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource();
const start = html.indexOf('        function createSuspendTagPageRenderRow(');
const end = html.indexOf('        function renderSuspendTagPagedCards(', start);
const source = html.slice(start, end);
const rendererEnd = html.indexOf('        function shouldBumpRequestMainBeforeRender(', end);
const rendererSource = html.slice(end, rendererEnd);

function fixture() {
  let generated = 0;
  const authorization = { scope: 'session-a', readScope: 'read-a', permission: 'perm-a' };
  const inventory = { revision: '12', signal: { aborted: false } };
  const master = { initialLoaded: true, rowCompleteness: 'complete',
    liveVerifiedScope: 'session-a', liveVerifiedPermission: 'perm-a', liveVerifiedRevision: '12' };
  const revisions = new Map();
  const ctx = vm.createContext({
    isIOSDevice: () => true,
    generateCard: row => `${row.UNIQUE_ID}:${row.note || ''}:${++generated}`,
    getQueueCardInventoryAuthorizationContext: () => authorization,
    getQueueCardInventoryContext: () => inventory,
    getDatasetState: () => master,
    getDatasetLoadSignature: key => `${key}:${revisions.get(key) || 'r1'}`,
    isDockSuspendDcRequestMirrorPreparationPending: () => false,
    productionLiveSyncReadAuthEpoch: 1, resolvedViewStateEpoch: 1,
    queueCardInventoryRenderVersion: 1, fullInventory: [], avOpenInventory: []
  });
  vm.runInContext(source, ctx);
  const container = {};
  const rows = [{ UNIQUE_ID: 'a', note: 'first', SOURCE_TABLE: 'ph_soc_master' },
    { UNIQUE_ID: 'b', note: 'second', SOURCE_TABLE: 'ph_soc_master' }];
  const plan = { renderSignature: 'page-1', rows };
  const draw = () => {
    const render = ctx.createSuspendTagPageRenderRow(container, plan);
    return rows.map((row, index) => render(row, index));
  };
  return { ctx, authorization, inventory, master, revisions, plan, rows, container, draw,
    generated: () => generated };
}

function skippedRenderFixture() {
  const f = fixture();
  f.draw();
  const factory = f.ctx.createSuspendTagPageRenderRow;
  const before = factory.pages.get(f.container);
  let factoryCalls = 0;
  let renderRow;
  Object.assign(f.ctx, {
    createSuspendTagPageRenderRow: (...args) => { factoryCalls++; return factory(...args); },
    // An identical published DOM signature causes the shared chunk renderer
    // to return before generating rows. Preserve that observable contract.
    renderMarkupChunkedByKey: (...args) => { renderRow = args[5]; return false; },
    getPendingRequestChunkRenderOptions: options => options,
    syncRequestBrowseFooter() {},
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagDockFilter: 'all',
  });
  // The production function resolves its own static pages property through
  // the global binding, so the counting wrapper must retain that WeakMap.
  f.ctx.createSuspendTagPageRenderRow.pages = factory.pages;
  vm.runInContext(rendererSource, f.ctx);
  return { ...f, factory, before, factoryCalls: () => factoryCalls,
    skippedRender: () => f.ctx.renderSuspendTagPagedCards(f.container, {}, {}, null, 'Suspend Tag', f.plan),
    renderRow: (...args) => renderRow(...args) };
}

test('a no-op Suspend redraw preserves populated markup until actual generation checks current authorization', () => {
  const f = skippedRenderFixture();
  const beforeRows = [...f.before.rows.entries()];
  f.ctx.resolvedViewStateEpoch++;
  assert.equal(f.skippedRender(), false);
  assert.equal(f.factoryCalls(), 0, 'a skipped chunk render must not eagerly replace the populated page');
  assert.equal(f.factory.pages.get(f.container), f.before);
  assert.deepEqual([...f.before.rows.entries()], beforeRows);
  assert.equal(f.generated(), 2);

  // The callback may run later; construct its factory against the identity
  // and proof at generation time rather than those from render scheduling.
  f.authorization.scope = f.master.liveVerifiedScope = 'session-b';
  f.authorization.permission = f.master.liveVerifiedPermission = 'perm-b';
  f.inventory.revision = f.master.liveVerifiedRevision = '13';
  assert.equal(f.renderRow(f.rows[0], 0), 'a:first:3');
  assert.equal(f.renderRow(f.rows[1], 1), 'b:second:4');
  assert.equal(f.factoryCalls(), 1, 'one actual page generation shares one currently authorized factory');
  const current = f.factory.pages.get(f.container);
  assert.notEqual(current, f.before);
  assert.match(current.key, /session-b/);
  assert.match(current.key, /perm-b/);
  assert.equal(current.rows.size, 2);
});

test('deferred Suspend generation rechecks revoked proof before using prior cached rows', () => {
  const f = skippedRenderFixture();
  assert.equal(f.skippedRender(), false);
  assert.equal(f.factory.pages.get(f.container), f.before);
  f.inventory.signal.aborted = true;
  assert.equal(f.renderRow(f.rows[0], 0), 'a:first:3');
  assert.equal(f.renderRow(f.rows[0], 0), 'a:first:4');
  assert.equal(f.factoryCalls(), 1);
  assert.equal(f.factory.pages.has(f.container), false, 'revoked proof must delete the old cache at real generation');
});

test('verified Suspend page reuses markup while returning every physical row', () => {
  const f = fixture();
  const first = f.draw();
  assert.deepEqual(f.draw(), first);
  assert.equal(f.generated(), 2);
  f.plan.renderSignature = 'page-2';
  assert.notDeepEqual(f.draw(), first);
  assert.equal(f.generated(), 4);
});

test('Suspend markup invalidates for edited payload, source objects, data and authorization revisions', () => {
  const f = fixture();
  f.draw();
  const changes = [
    () => { f.rows[0].note = 'optimistic edit'; },
    () => { f.rows[0] = { ...f.rows[0] }; },
    () => { f.revisions.set('avOpen', 'r2'); },
    () => { f.ctx.fullInventory = []; },
    () => { f.ctx.avOpenInventory = []; },
    () => { f.ctx.resolvedViewStateEpoch++; },
    () => { f.ctx.queueCardInventoryRenderVersion++; },
    () => { f.ctx.productionLiveSyncReadAuthEpoch++; },
    () => { f.authorization.scope = f.master.liveVerifiedScope = 'session-b'; },
    () => { f.authorization.permission = f.master.liveVerifiedPermission = 'perm-b'; },
    () => { f.inventory.revision = f.master.liveVerifiedRevision = '13'; }
  ];
  for (const change of changes) {
    const before = f.generated();
    change(); f.draw();
    assert.equal(f.generated(), before + 2);
  }
});

test('revoked, incomplete and preparing snapshots never restore cached markup', () => {
  for (const invalidate of [
    f => { f.master.liveVerifiedPermission = 'old'; },
    f => { f.master.rowCompleteness = 'partial'; },
    f => { f.inventory.signal.aborted = true; },
    f => { f.ctx.getQueueCardInventoryAuthorizationContext = () => null; },
    f => { f.ctx.isDockSuspendDcRequestMirrorPreparationPending = () => true; }
  ]) {
    const f = fixture();
    f.draw(); invalidate(f); f.draw(); f.draw();
    assert.equal(f.generated(), 6);
  }
});

test('verified desktop pages reuse markup and oversized pages remain bounded', () => {
  const f = fixture();
  f.ctx.isIOSDevice = () => false;
  f.draw(); f.draw();
  assert.equal(f.generated(), 2);
  f.ctx.isIOSDevice = () => true;
  f.plan.rows = Array.from({ length: 101 }, (_, index) => ({ UNIQUE_ID: String(index) }));
  const render = f.ctx.createSuspendTagPageRenderRow({}, f.plan);
  const row = f.plan.rows[0];
  assert.notEqual(render(row, 0), render(row, 0));
});

test('master status-overlay cards always run their generation side effects', () => {
  const f = fixture();
  f.rows[0].SOURCE_TABLE = 'ph_master_inventory';
  f.draw(); f.draw();
  assert.equal(f.generated(), 4);
});
