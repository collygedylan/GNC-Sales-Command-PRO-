import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const runtime = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .find(match => match[1].includes('function recoverDriveCommonNameCacheInvalidation'))?.[1];
assert.ok(runtime, 'recovery helpers are inside a runtime script');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

function extractPrepareGuard(source) {
  const batchStart = source.indexOf('const prepareBatch = () => {');
  assert.notEqual(batchStart, -1, 'Common Name preparation batch exists');
  const start = source.indexOf('if (!isDriveCommonNamePreparationCurrent(pending)) {', batchStart);
  assert.notEqual(start, -1, 'prepareBatch uses the real currentness guard');
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error('Unclosed prepareBatch guard');
}

const currentnessFunction = extractFunction(runtime, 'isDriveCommonNamePreparationCurrent');
const recoveryFunctions = [
  extractFunction(runtime, 'canRecoverDriveCommonNameCacheInvalidation'),
  extractFunction(runtime, 'recoverDriveCommonNameCacheInvalidation'),
].join('\n');
const prepareGuard = extractPrepareGuard(runtime);
const fixtureScript = `${currentnessFunction}\n${recoveryFunctions}\nfunction runPrepareBatchGuard(pending) {\n${prepareGuard}\nreturn 'continued';\n}`;
new vm.Script(fixtureScript, { filename: 'drive-preparation-functions.js' });

function makeFixture(overrides = {}) {
  const calls = { scheduled: [], canceled: 0, rebuilt: 0, network: 0, ui: [] };
  const container = { dataset: { driveCommonnameState: 'preparing' }, setAttribute(name, value) { this[name] = value; } };
  const pending = {
    container,
    filterKey: 'filter:A',
    renderKey: 'render:A',
    selection: 'selection:A',
    search: 'query:A',
    user: 'user:A',
    role: 'ADMIN',
    token: 17,
    native: true,
    proof: 'proof:A',
    generation: 31,
    frame: 9,
    fragment: { stale: true },
  };
  const context = {
    WeakMap,
    document: { hidden: false, getElementById: id => id === 'drive-content' ? container : ({ value: 'query:A' }) },
    driveCommonNamePreparation: pending,
    driveVisibleItemsStateCacheKey: '',
    driveCommonNameRecoveryKeys: new WeakMap(),
    activeDriveTab: 'name',
    currentUser: 'user:A',
    currentRole: 'ADMIN',
    productionLiveSyncReadGeneration: 31,
    pending,
    ...overrides,
    getCurrentVisibleViewId: () => 'drive',
    getDriveDrillSelectionStateKey: () => 'selection:A',
    isChunkRenderCurrentForContainer: (_container, _key, token) => token === 17,
    canUseProductionLiveSync: () => true,
    productionVerifiedViewKey: () => 'proof:A',
    buildDriveVisibleItemsState() {
      calls.rebuilt += 1;
      context.driveVisibleItemsStateCacheKey = 'filter:A';
      return { resolvedStateKey: 'filter:A', visibleItems: [{ id: 'fresh-row' }] };
    },
    cancelDriveCommonNamePreparation() {
      calls.canceled += 1;
      context.driveCommonNamePreparation = null;
      pending.frame = 0;
      pending.fragment = null;
      container.dataset.driveCommonnameState = 'cancelled';
    },
    cancelAnimationFrame() {},
    setContainerUiState(_container, state) { calls.ui.push(state); },
    scheduleDriveFilterRender(...args) { calls.scheduled.push(args); },
    fetch() { calls.network += 1; throw new Error('recovery must not fetch'); },
  };
  context.document.hidden = overrides.hidden ?? false;
  if (overrides.currentView) context.getCurrentVisibleViewId = () => overrides.currentView;
  if (overrides.selection) context.getDriveDrillSelectionStateKey = () => overrides.selection;
  if (overrides.search) context.document.getElementById = id => id === 'drive-content' ? container : ({ value: overrides.search });
  if (overrides.chunkCurrent === false) context.isChunkRenderCurrentForContainer = () => false;
  if (overrides.proof) context.productionVerifiedViewKey = () => overrides.proof;
  if (overrides.generation != null) context.productionLiveSyncReadGeneration = overrides.generation;
  if (overrides.role) context.currentRole = overrides.role;
  if (overrides.user) context.currentUser = overrides.user;
  if (overrides.nextStateKey) {
    context.buildDriveVisibleItemsState = () => {
      calls.rebuilt += 1;
      context.driveVisibleItemsStateCacheKey = overrides.nextStateKey;
      return { resolvedStateKey: overrides.nextStateKey, visibleItems: [{ id: 'changed-row' }] };
    };
  }
  const sandbox = vm.createContext(context);
  new vm.Script(fixtureScript).runInContext(sandbox);
  return { sandbox, calls, pending, container };
}

test('cleared same-signature cache rebuilds fresh memory-backed state and schedules one existing filter render', () => {
  const { sandbox, calls, pending, container } = makeFixture();
  assert.equal(sandbox.runPrepareBatchGuard(pending), undefined, 'successful recovery returns from the active batch');
  assert.equal(calls.rebuilt, 1);
  assert.equal(calls.canceled, 1);
  assert.deepEqual(calls.scheduled, [[0, 32, true]]);
  assert.equal(calls.network, 0);
  assert.equal(container.dataset.driveCommonnameState, undefined);
  assert.equal(container['aria-busy'], 'false');
  assert.equal(pending.fragment, null, 'the stale fragment is discarded');

  sandbox.driveCommonNamePreparation = { ...pending, container };
  sandbox.driveVisibleItemsStateCacheKey = '';
  assert.equal(sandbox.runPrepareBatchGuard(sandbox.driveCommonNamePreparation), undefined);
  assert.equal(calls.scheduled.length, 1, 'the same filter/render state cannot schedule recursively');
  assert.equal(calls.canceled, 2, 'a repeat invalidation fails closed through ordinary cancellation');
});

for (const [reason, override] of [
  ['a different nonempty filter signature', { cacheKey: 'filter:B' }],
  ['a hidden document', { hidden: true }],
  ['navigation away', { currentView: 'home' }],
  ['Drive tab change', { activeDriveTab: 'location' }],
  ['selection change', { selection: 'selection:B' }],
  ['search change', { search: 'query:B' }],
  ['identity change', { user: 'user:B' }],
  ['role change', { role: 'QC' }],
  ['chunk-token replacement', { chunkCurrent: false }],
  ['native proof change', { proof: 'proof:B' }],
  ['native read-generation change', { generation: 32 }],
]) {
  test(`cache recovery fails closed on ${reason}`, () => {
    const { sandbox, calls, pending } = makeFixture(override);
    if (override.cacheKey) sandbox.driveVisibleItemsStateCacheKey = override.cacheKey;
    assert.equal(sandbox.runPrepareBatchGuard(pending), undefined);
    assert.equal(calls.scheduled.length, 0);
    assert.equal(calls.rebuilt, 0, 'no state rebuild occurs before all safety checks pass');
    assert.equal(calls.canceled, 1);
    assert.equal(calls.network, 0);
  });
}

test('a recomputed filter signature change cancels without scheduling recovery', () => {
  const { sandbox, calls, pending } = makeFixture({ nextStateKey: 'filter:B' });
  assert.equal(sandbox.runPrepareBatchGuard(pending), undefined);
  assert.equal(calls.rebuilt, 1);
  assert.equal(calls.scheduled.length, 0);
  assert.equal(calls.canceled, 1);
  assert.equal(calls.network, 0);
});

test('changed render data gets a bounded recovery under its own signature', () => {
  const { sandbox, calls, pending, container } = makeFixture();
  sandbox.runPrepareBatchGuard(pending);
  const next = { ...pending, renderKey: 'render:B', fragment: { fresh: true } };
  sandbox.driveCommonNamePreparation = next;
  sandbox.driveVisibleItemsStateCacheKey = '';
  sandbox.runPrepareBatchGuard(next);
  assert.equal(calls.scheduled.length, 2);
  assert.equal(sandbox.driveCommonNameRecoveryKeys.get(container), 'filter:A::render:B');
  assert.equal(calls.network, 0);
});

test('navigation changed during rebuilding cancels without scheduling recovery', () => {
  const { sandbox, calls, pending } = makeFixture();
  sandbox.buildDriveVisibleItemsState = () => {
    calls.rebuilt += 1;
    sandbox.getDriveDrillSelectionStateKey = () => 'selection:B';
    return { resolvedStateKey: 'filter:A' };
  };
  sandbox.runPrepareBatchGuard(pending);
  assert.equal(calls.rebuilt, 1);
  assert.equal(calls.scheduled.length, 0);
  assert.equal(calls.canceled, 1);
});

test('completed Common Name rendering releases its recovery marker', () => {
  assert.match(runtime, /driveCommonnameState = 'complete';[\s\S]{0,200}driveCommonNameRecoveryKeys\.delete\(container\)/);
});
