import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function testStorage() {
  const records = new Map();
  return {
    get length() { return records.size; },
    getItem: key => records.get(key) || null,
    setItem: (key, value) => records.set(key, value),
    removeItem: key => records.delete(key),
    key: index => [...records.keys()][index] || null,
  };
}

function loadReclassOutboxFixture(storage, service) {
  const state = { identity: 'actor-a', hidden: false, online: true, timer: null };
  const applied = [], toasts = [];
  const context = vm.createContext({
    window: {}, localStorage: storage, sessionStorage: testStorage(),
    navigator: { get onLine() { return state.online; } }, document: { get hidden() { return state.hidden; } },
    getArgosReclassLiveEditIdentityKey: () => state.identity,
    getInventoryReclassMovesService: () => service, canUseProductionLiveSync: () => true,
    confirmedArgosReclassLiveEditRevisions: new Map(),
    getDatasetState: () => ({}), getProductionLiveSyncContext: () => ({}),
    publishOptimisticReclassRows: () => [], applyReclassSeasonStocks: () => {},
    applyArgosInventoryTransactionReturnedRow: row => row,
    publishArgosInventoryTransactionReturnedRows: rows => applied.push(...rows),
    invalidateArgosReclassLiveEditCaches: () => {},
    showToast: title => toasts.push(title),
    isInventoryStatusOutcomeUncertain: error => error.status === 503,
    setTimeout: task => { state.timer = task; return 1; },
    clearTimeout: () => { state.timer = null; },
  });
  for (const name of ['reclass-move-outbox', 'reclass-move-command']) {
    const source = readFileSync(new URL(`../../assets/${name}.js`, import.meta.url), 'utf8');
    vm.runInContext(source, context);
  }
  return { context, state, applied, toasts };
}

export async function invariant591() {
  const storage = testStorage();
  const command = { commandId: 'reclass-move-golden-591', moves: [{ source: { uniqueId: 'source' } }] };
  const receipt = { revision: '42', rows: [
    { row: { unique_id: 'source', ptronhand: '900' } },
    { row: { unique_id: 'target', ptronhand: '1500' } },
  ] };
  const calls = [];
  const service = {
    status: async (id, saved) => {
      calls.push('status');
      assert.equal(id, command.commandId);
      assert.equal(JSON.stringify(saved), JSON.stringify(command));
      return { status: 'applied', receipt };
    },
    submit: async saved => {
      calls.push('submit');
      assert.equal(saved.commandId, command.commandId);
      throw Object.assign(new Error('Reclass recovery cancelled.'), { code: 'REQUEST_ABORTED' });
    },
  };
  const original = loadReclassOutboxFixture(storage, service);
  const edit = { backgroundSubmission: true, pendingReclassMove: { command, movedUids: ['source'] } };
  await assert.rejects(original.context.applyArgosInventoryReclassMoveCommand(edit, null, 'actor-a'),
    error => error.inventoryMovePending === true);
  assert.equal(storage.length, 1);
  assert.ok(original.state.timer);
  const reloaded = loadReclassOutboxFixture(storage, service);
  reloaded.state.identity = 'actor-b';
  reloaded.context.queueArgosReclassMoveRecovery();
  assert.equal(reloaded.state.timer, null);
  reloaded.state.identity = 'actor-a';
  reloaded.state.hidden = true;
  reloaded.context.queueArgosReclassMoveRecovery();
  assert.equal(reloaded.state.timer, null);
  reloaded.state.hidden = false;
  reloaded.context.queueArgosReclassMoveRecovery();
  reloaded.state.timer();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['submit', 'status']);
  assert.deepEqual(reloaded.toasts, ['Moves Saved']);
  assert.deepEqual(reloaded.applied, receipt.rows.map(entry => entry.row));
  assert.equal(storage.length, 0);
}
