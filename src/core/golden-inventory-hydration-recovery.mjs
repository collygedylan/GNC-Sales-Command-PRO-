import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseExpressionAt } from 'acorn';
import { readComposedRuntimeSource } from '../../scripts/composed-app-source.mjs';

const readRepository = file => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');

function inventoryRows() {
  return Array.from({ length: 9600 }, (_, index) => ({
    unique_id: 'row-' + String(index).padStart(5, '0'),
    commonname: 'Name ' + (index < 1000 ? index % 9 : (index - 1000) % 1613)
  }));
}

function paginatorSource() {
  const runtime = readComposedRuntimeSource();
  const start = runtime.indexOf('async function fetchAllInventoryReadRows(');
  assert.ok(start >= 0, 'the composed runtime retains its canonical inventory paginator');
  const node = parseExpressionAt(runtime, start, { ecmaVersion: 'latest' });
  return runtime.slice(node.start, node.end);
}

function loadCoordinator(read) {
  const sandbox = { module: { exports: {} }, AbortController, Math, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('assets/live-sync-coordinator.js'), sandbox, {
    filename: 'assets/live-sync-coordinator.js'
  });
  vm.runInContext(read('assets/inventory-hydration-recovery.js'), sandbox, {
    filename: 'assets/inventory-hydration-recovery.js'
  });
  return sandbox;
}

function inventoryPage(state, _operation, _params, limit, offset) {
  if (offset === 1000 && state.options.failure === 'authorization') {
    throw Object.assign(new Error('Inventory access denied.'), { status: 403 });
  }
  const short = state.options.shortPageOnce && state.masterStages === 1 && offset === 1000;
  const fieldDrift = state.options.fieldCoverageDriftOnce && state.masterStages === 1 && offset > 0;
  const columns = state.options.failure === 'projection' || fieldDrift
    ? ['unique_id'] : ['unique_id', 'commonname'];
  return {
    rows: state.rows.slice(offset, offset + limit - (short ? 1 : 0)),
    total: null, hasMore: offset + limit < state.rows.length,
    projection: 'full', fieldCoverage: 'full', columns
  };
}

function loadPaginator(state, sandbox) {
  Object.assign(sandbox, {
    canUseProductionLiveSync: () => true,
    runDedupeSupabaseRead: (_key, work, options) => work({ signal: options.signal }),
    fetchAuthenticatedSupabaseReadPage: async () => ({ total: state.rows.length }),
    fetchInventoryReadPage: async (...args) => inventoryPage(state, ...args),
    yieldToUiFrame: async () => {}
  });
  vm.runInContext(paginatorSource(), sandbox);
  return sandbox.fetchAllInventoryReadRows;
}

function masterAdapter(state, paginate) {
  return {
    id: 'core:master', cacheKey: 'master/full', sourceKeys: ['ph_master_inventory'],
    stage: async ({ preview, signal } = {}) => {
      state.masterStages++;
      const rows = await paginate('master_page', { dataset: 'master', projection: 'full' }, {
        signal, requireComplete: true, limit: 1000, pageConcurrency: 2,
        onFirstPage: page => preview?.({ partial: true, rows: page })
      });
      if (rows.readMeta.columns.length !== 2) {
        throw new Error('Full inventory field coverage was missing or invalid; the partial snapshot was discarded.');
      }
      return { partial: false, rows, rowCompleteness: rows.readMeta.rowCompleteness };
    },
    commit: value => state.commits.push(value)
  };
}

function assignmentAdapter(state) {
  return {
    id: 'core:warehouseAssignedItems', cacheKey: 'assignments/all',
    sourceKeys: ['warehouse_assigned_items'],
    stage: async () => { state.assignmentStages++; return [{ master_unique_id: 'row-00000' }]; },
    commit: rows => state.assignmentCommits.push(rows)
  };
}

async function revisionMetadata(state, keys) {
  if (keys.includes('warehouse_assigned_items')) {
    state.backgroundMetadataReads++;
    if (state.options.backgroundFailureOnce && state.backgroundMetadataReads === 1) {
      throw Object.assign(new Error('Revision gateway timeout.'), { status: 504 });
    }
  }
  state.metadataReads++;
  return {
    contractVersion: 1, permissionVersion: 'permission-v1',
    sources: keys.map(key => ({ key, revision: '1', state: 'ready' }))
  };
}

function coordinatorOptions(state) {
  return {
    getContext: () => state.context, eventDrivenRevisions: true,
    now: () => state.clock, backgroundDelayMs: 0,
    readRevisions: keys => revisionMetadata(state, keys),
    previewSnapshots: entries => state.previews.push(entries[0].value),
    setTimeout: (callback, delay) => {
      const id = ++state.timerSerial;
      state.timers.set(id, { callback, at: state.clock + delay });
      return id;
    },
    clearTimeout: id => state.timers.delete(id)
  };
}

export function createInventoryHydrationRecoveryFixture(options = {}, read = readRepository) {
  const state = {
    options, clock: 0, timerSerial: 0, timers: new Map(), rows: inventoryRows(),
    masterStages: 0, assignmentStages: 0, backgroundMetadataReads: 0, metadataReads: 0,
    previews: [], commits: [], assignmentCommits: []
  };
  const sandbox = loadCoordinator(read);
  state.context = {
    scope: 'dylan:session-1', readIdentity: 'dylan:session-1', view: 'drive', viewKey: 'drive',
    visible: true, online: true, authenticated: true, accessDenied: false,
    progressive: true, dataPermissionVersion: 'permission-v1', dataPermissionSnapshotFresh: true,
    adapters: [masterAdapter(state, loadPaginator(state, sandbox))],
    backgroundAdapters: [assignmentAdapter(state)]
  };
  state.coordinator = sandbox.AgMetricLiveSync.createCoordinator(coordinatorOptions(state));
  return state;
}

async function settle() {
  for (let index = 0; index < 100; index++) await Promise.resolve();
}

function runDueTimers(state) {
  for (const [id, timer] of [...state.timers]) {
    if (timer.at > state.clock) continue;
    state.timers.delete(id);
    timer.callback();
  }
}

export async function advanceHydrationRecovery(state, milliseconds) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000) {
    state.clock += Math.min(1000, milliseconds - elapsed);
    runDueTimers(state);
    await settle();
  }
}

async function assertCompleteAndIdle(state) {
  assert.equal(state.commits.length, 1, 'publish one verified complete master');
  const complete = state.commits[0];
  assert.equal(complete.rows.length, 9600);
  assert.equal(new Set(complete.rows.map(row => row.unique_id)).size, 9600);
  assert.equal(new Set(complete.rows.map(row => row.commonname)).size, 1613);
  assert.equal(complete.rowCompleteness, 'complete');
  assert.equal(state.assignmentStages, 1, 'hydrate assignments once after recovery');
  assert.equal(state.assignmentCommits.length, 1);
  assert.equal(state.coordinator.getStatus().state, 'Up to date');
  const counts = [state.masterStages, state.assignmentStages, state.metadataReads];
  await advanceHydrationRecovery(state, 300000);
  assert.deepEqual([state.masterStages, state.assignmentStages, state.metadataReads], counts);
  assert.equal(state.timers.size, 0, 'complete event-driven hydration stays idle');
}

export async function verifyShortInventoryPageRecovery(read = readRepository) {
  const state = createInventoryHydrationRecoveryFixture({ shortPageOnce: true }, read);
  try {
    assert.equal(await state.coordinator.check('view-entry'), false);
    assert.equal(state.previews.at(-1).rows.length, 1000);
    assert.equal(new Set(state.previews.at(-1).rows.map(row => row.commonname)).size, 9);
    assert.equal(state.commits.length, 0, 'a short page never establishes completeness');
    await advanceHydrationRecovery(state, 60000);
    assert.equal(state.masterStages, 2, 'retry the discarded snapshot without navigation or revisions');
    await assertCompleteAndIdle(state);
  } finally { state.coordinator.reset(); }
}

export async function verifyBackgroundInventoryRevisionRecovery(read = readRepository) {
  const state = createInventoryHydrationRecoveryFixture({ backgroundFailureOnce: true }, read);
  try {
    assert.equal(await state.coordinator.check('view-entry'), true);
    await advanceHydrationRecovery(state, 60000);
    assert.equal(state.masterStages, 1, 'assignment recovery reuses the complete master');
    assert.ok(state.backgroundMetadataReads >= 2, 'retry the failed background revision read');
    await assertCompleteAndIdle(state);
  } finally { state.coordinator.reset(); }
}

export async function verifyFieldCoverageDriftRecovery(read = readRepository) {
  const state = createInventoryHydrationRecoveryFixture({ fieldCoverageDriftOnce: true }, read);
  try {
    assert.equal(await state.coordinator.check('view-entry'), false);
    assert.equal(state.previews.at(-1).rows.length, 1000);
    await advanceHydrationRecovery(state, 60000);
    assert.equal(state.masterStages, 2, 'retry one revision-inconsistent field-coverage page');
    await assertCompleteAndIdle(state);
  } finally { state.coordinator.reset(); }
}

function endOldHydrationOwner(state, transition) {
  if (transition === 'hidden') state.context.visible = false;
  if (transition === 'logout') Object.assign(state.context, { scope: '', authenticated: false });
  if (transition === 'account') {
    Object.assign(state.context, {
      scope: 'brian:session-2', readIdentity: 'brian:session-2', adapters: [], backgroundAdapters: []
    });
  }
  state.coordinator.signal(transition, 0);
}

async function verifyInventoryRecoveryOwnerChange(transition, background, read) {
  const options = background ? { backgroundFailureOnce: true } : { shortPageOnce: true };
  const state = createInventoryHydrationRecoveryFixture(options, read);
  try {
    await state.coordinator.check('view-entry');
    if (background) await advanceHydrationRecovery(state, 1000);
    assert.ok(state.timers.size > 0, 'prove a retry is pending before changing its owner');
    endOldHydrationOwner(state, transition);
    await advanceHydrationRecovery(state, 300000);
    assert.equal(state.masterStages, 1, transition + ' must stop the old master retry');
    assert.equal(state.assignmentStages, 0, transition + ' must stop old assignment hydration');
    assert.equal(state.commits.length, background ? 1 : 0);
    assert.equal(state.timers.size, 0);
  } finally { state.coordinator.reset(); }
}

export async function verifyInventoryRecoveryLifecycle(read = readRepository) {
  for (const transition of ['hidden', 'logout', 'account']) {
    await verifyInventoryRecoveryOwnerChange(transition, false, read);
    await verifyInventoryRecoveryOwnerChange(transition, true, read);
  }
}

export async function verifyInventoryRecoveryTerminalFailures(read = readRepository) {
  for (const failure of ['projection', 'authorization']) {
    const state = createInventoryHydrationRecoveryFixture({ failure }, read);
    try {
      await state.coordinator.check('view-entry');
      await advanceHydrationRecovery(state, 300000);
      assert.equal(state.masterStages, 1, failure + ' must not be treated as snapshot drift');
      assert.equal(state.commits.length, 0);
      assert.equal(state.assignmentStages, 0);
      assert.equal(state.timers.size, 0);
    } finally { state.coordinator.reset(); }
  }
}

export async function invariant547({ read = readRepository } = {}) {
  const shell = read('index.html');
  const coordinator = shell.indexOf('assets/live-sync-coordinator.js');
  const recovery = shell.indexOf('assets/inventory-hydration-recovery.js');
  const runtime = shell.indexOf('assets/app-runtime.js');
  assert.ok(coordinator >= 0 && coordinator < recovery && recovery < runtime,
    'the recovery decorator installs after the coordinator and before app runtime');
  await verifyShortInventoryPageRecovery(read);
  await verifyBackgroundInventoryRevisionRecovery(read);
  await verifyInventoryRecoveryLifecycle(read);
  await verifyInventoryRecoveryTerminalFailures(read);
}
