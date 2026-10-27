import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readComposedAppSource();
const rowStart = html.indexOf('        function applyArgosInventoryTransactionReturnedRow(');
const rowsSource = html.slice(rowStart, html.indexOf('        const confirmedArgosReclassLiveEditRevisions', rowStart));
const moveStart = html.indexOf('        async function applyArgosInventoryReclassMoveCommand(');
const moveSource = html.slice(moveStart, html.indexOf('        function hasRemainingArgosReclassInquiry(', moveStart));

function fixture({ revision = '41', identity = 'actor', failUid = '' } = {}) {
  const work = { rebuilds: 0, detailRefreshes: 0, previews: 0, persisted: [], publications: [] };
  const fullInventory = [{ UNIQUE_ID: 'source', DOM_ID: 'source-dom', PTRONHAND: '50' }];
  const index = new Map([['source', fullInventory[0]]]);
  const receipt = { revision: '42', rows: [
    { row: { unique_id: 'source', ptronhand: '30' } },
    { row: { unique_id: 'destination', ptronhand: '20' } },
  ] };
  const masterState = { liveVerifiedRevision: revision, liveVerifiedScope: 'scope', liveVerifiedPermission: 'permission' };
  const ctx = vm.createContext({
    fullInventory, avOpenInventory: [], cavInventory: [],
    reclassStockSeason: row => String(row?.season || row?.SEASON || ''),
    firstNonEmptyValue: (...values) => values.find(value => value !== '' && value != null),
    formatFetchedRows: rows => rows.map(row => {
      if (row.unique_id === failUid) throw new Error('Synthetic formatting failure');
      return { ...row, UNIQUE_ID: row.unique_id, PTRONHAND: row.ptronhand };
    }),
    getCanonicalMasterInventoryRowByUniqueId: uid => index.get(uid),
    findItemByUniqueId: uid => index.get(uid),
    upsertRealtimeRow: (rows, row) => {
      const position = rows.findIndex(existing => existing.UNIQUE_ID === row.UNIQUE_ID);
      if (position < 0) rows.push(row); else rows[position] = row;
    },
    shouldIncludeMasterItemInAvSeasonView: () => true,
    rebuildMasterInventoryIndexes: () => {
      work.rebuilds++;
      index.clear(); fullInventory.forEach(row => index.set(row.UNIQUE_ID, row));
    },
    refreshRealtimeDetailLookupIndexes: () => { work.detailRefreshes++; },
    getDatasetKeysForTable: () => ['master'], getVisibleAffectedViewIds: () => ['drive'],
    propagateCommittedEdit: (_table, row) => {
      assert.equal(index.get(row.UNIQUE_ID), row, 'publication must see rebuilt canonical indexes');
      work.publications.push({ uid: row.UNIQUE_ID, source: index.get('source')?.PTRONHAND,
        destination: index.get('destination')?.PTRONHAND });
    },
    refreshLiveLocMatchQuantityPreviews: () => { work.previews++; },
    getArgosReclassLiveEditIdentityKey: () => identity,
    getInventoryReclassMovesService: () => ({ status: async () => ({ status: 'applied', receipt }), submit: async () => receipt }),
    getDatasetState: () => masterState,
    getProductionLiveSyncContext: () => ({ scope: 'scope', dataPermissionVersion: 'permission' }),
    confirmedArgosReclassLiveEditRevisions: new Map(),
    persistPendingArgosInventoryReclassMove() {}, readPendingArgosInventoryReclassMove: () => null,
    invalidateArgosReclassLiveEditCaches() {}, retireConfirmedArgosReclassMoveProposals() {},
    persistCurrentCache: async (immediate, reason) => { work.persisted.push({ immediate, reason }); return true; },
    setArgosReclassMoveInputsLocked() {}, isInventoryStatusOutcomeUncertain: () => false,
  });
  vm.runInContext(rowsSource + '\n' + moveSource, ctx);
  const state = { pendingReclassMove: { command: { commandId: 'receipt-batch' }, movedUids: ['source'], uncertain: true }, inquiryModel: {} };
  return { ctx, work, fullInventory, state, receipt, index, masterState };
}

test('two returned movement rows rebuild indexes and preview once before coherent publication', async () => {
  const f = fixture();
  await f.ctx.applyArgosInventoryReclassMoveCommand(f.state, {}, 'actor');
  assert.equal(f.work.rebuilds, 1);
  assert.equal(f.work.detailRefreshes, 1);
  assert.equal(f.work.previews, 1);
  assert.deepEqual(f.work.persisted, [{ immediate: true, reason: 'inventory-reclass-move-confirmed' }]);
  assert.equal(f.masterState.liveVerifiedRevision, '42');
  assert.deepEqual(f.work.publications, [
    { uid: 'source', source: '30', destination: '20' },
    { uid: 'destination', source: '30', destination: '20' },
  ]);
  assert.equal(f.index.get('source').DOM_ID, 'source-dom');
  assert.equal(f.state.pendingReclassMove, null);
});

test('committed receipt revision and rows are persisted before later revision polling', async () => {
  const f = fixture({ revision: '41' });
  await f.ctx.applyArgosInventoryReclassMoveCommand(f.state, {}, 'actor');
  assert.equal(f.masterState.liveVerifiedRevision, f.receipt.revision);
  assert.equal(f.index.get('source').PTRONHAND, '30');
  assert.equal(f.index.get('destination').PTRONHAND, '20');
  assert.deepEqual(f.work.persisted, [{ immediate: true, reason: 'inventory-reclass-move-confirmed' }]);
});

test('partial receipt formatting failure finalizes changed rows and retains pending recovery', async () => {
  const f = fixture({ failUid: 'destination' });
  await assert.rejects(f.ctx.applyArgosInventoryReclassMoveCommand(f.state, {}, 'actor'), error => error.inventoryMovePending === true);
  assert.equal(f.work.rebuilds, 1);
  assert.equal(f.work.previews, 1);
  assert.equal(f.index.get('source').PTRONHAND, '30');
  assert.equal(f.index.has('destination'), false);
  assert.equal(f.work.publications.length, 1);
  assert.equal(f.state.pendingReclassMove.uncertain, true);
});

test('single returned-row callers retain immediate index and preview publication', () => {
  const f = fixture();
  f.ctx.applyArgosInventoryTransactionReturnedRow({ unique_id: 'source', ptronhand: '35' });
  assert.equal(f.work.rebuilds, 1);
  assert.equal(f.work.previews, 1);
  assert.equal(f.work.publications.length, 1);
  assert.equal(f.index.get('source').PTRONHAND, '35');
});

test('account and monotonic revision fences reject receipt publication before mutations', async () => {
  for (const options of [{ identity: 'other-account' }, { revision: '43' }]) {
    const f = fixture(options);
    await f.ctx.applyArgosInventoryReclassMoveCommand(f.state, {}, 'actor');
    assert.equal(f.work.rebuilds, 0);
    assert.equal(f.work.previews, 0);
    assert.equal(f.work.publications.length, 0);
    assert.equal(f.fullInventory[0].PTRONHAND, '50');
  }
});
