import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = readComposedAppSource();
const start = source.indexOf('        function applyArgosInventoryTransactionReturnedRow(');
const body = source.slice(start, source.indexOf('        const confirmedArgosReclassLiveEditRevisions', start));

test('confirmed reclass receipt updates shared inventory and removes an obsolete AV-season copy', () => {
  const ctx = vm.createContext({
    fullInventory: [{ UNIQUE_ID:'source', SEASON:'F1', PTRONHAND:234 }],
    avOpenInventory: [{ UNIQUE_ID:'source', SEASON:'F1', PTRONHAND:234 }],
    firstNonEmptyValue: (...values) => values.find(v => v !== '' && v != null),
    formatFetchedRows: rows => rows.map(row => ({ ...row, UNIQUE_ID: row.unique_id })),
    findItemByUniqueId: () => ({ DOM_ID:'source-dom' }),
    getCanonicalMasterInventoryRowByUniqueId: () => ({ DOM_ID:'source-dom' }),
    upsertRealtimeRow: (rows, row) => { const i=rows.findIndex(x=>x.UNIQUE_ID===row.UNIQUE_ID); if(i<0)rows.push(row);else rows[i]=row; },
    removeRealtimeRow: (rows, uid) => { const i=rows.findIndex(x=>x.UNIQUE_ID===uid);if(i>=0)rows.splice(i,1); },
    shouldIncludeMasterItemInAvSeasonView: row => row.SEASON === 'F1',
    rebuildMasterInventoryIndexes: () => {}, refreshRealtimeDetailLookupIndexes: () => {},
    getDatasetKeysForTable: () => ['master'], getVisibleAffectedViewIds: () => ['av','drive','request'],
    propagateCommittedEdit: () => {}, refreshLiveLocMatchQuantityPreviews: () => {}
  });
  vm.runInContext(body, ctx);
  ctx.applyArgosInventoryTransactionReturnedRow({ unique_id:'source', SEASON:'U1', PTRONHAND:200 });
  assert.equal(ctx.fullInventory[0].PTRONHAND,200);
  assert.equal(ctx.avOpenInventory.length,0);
  ctx.applyArgosInventoryTransactionReturnedRow({ unique_id:'destination', SEASON:'F1', PTRONHAND:34 });
  assert.equal(ctx.fullInventory.length,2);
  assert.equal(ctx.avOpenInventory[0].PTRONHAND,34);
});
