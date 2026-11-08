import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';

function registerWorksheet({ source, extractAppFunction }) {
test('optimistic move worksheet subtracts source stock and uses a temporary target identity', () => {
  const sourceRow = { ...source.identity, UNIQUE_ID: 'source-uid', ITEMCODE: 'ITEM-1', CONTSIZE: '#3', LOCATIONCODE: 'C.12.001',
    LOTCODE: '27.F1', SEASON: 'F1', PTRONHAND: '50', PTRAVAILABLE: '40' };
  const ctx = { getConfiguredCurrentSalesYearCode: () => 27, getConfiguredCurrentSeasonCode: () => 'F1', parseAppNumber: value => value == null || value === '' ? null : Number(String(value).replace(/,/g, '')),
    buildItemInquiryViewModel: (_item, rows) => ({ rows, locationRows: rows.map(row => ({ unique_id: row.UNIQUE_ID, sourceRow: row, values: row })) }) };
  vm.createContext(ctx);
  vm.runInContext(extractAppFunction('normalizeNcrSalesYearValue'), ctx);
  vm.runInContext(`${extractAppFunction('reclassStockSeason')}\n${extractAppFunction('buildOptimisticInventoryReclassMoveModel')}`, ctx);
  const result = ctx.buildOptimisticInventoryReclassMoveModel({ item: {}, inquiryModel: { rows: [sourceRow] } }, {
    commandId: 'reclass-command-0007', moves: [{ source: { uniqueId: 'source-uid' }, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }]
  });
  assert.equal(result.model.rows[0].ptronhand, '30');
  assert.equal(result.model.rows[0].ptravailable, '20');
  assert.equal(result.model.rows[1].lotcode, '27.U1');
  assert.equal(result.model.rows[1].ptronhand, '20');
  assert.match(result.model.rows[1].unique_id, /^pending-reclass-/);
  assert.notEqual(result.model.rows[1].unique_id, 'server-target-uid', 'the UI does not guess the server-owned target ID');
});

}

function registerSeason({ extractAppFunction }) {
test('optimistic season move inserts same-location destination with season Open Stock and stable location total', () => {
  const lineage = { warehousei: 'WH1', ITEMCODE: '004103.010.1', CONTSIZE: '#1', SOURCE: 'seed', DESIGITEM: 'D1' };
  const rows = [
    { ...lineage, UNIQUE_ID: 'source-s1', LOCATIONCODE: 'C.15.000', LOTCODE: '27.S1', SEASON: 'S1', PTRONHAND: '808', PTRAVAILABLE: '808', S_LTS: '529', LOC_ON_HAND: '878' },
    { ...lineage, UNIQUE_ID: 'other-c-lot', LOCATIONCODE: 'C.15.000', LOTCODE: '27.S2', SEASON: 'S2', PTRONHAND: '70', PTRAVAILABLE: '70', S_LTS: '0', LOC_ON_HAND: '878' },
    { ...lineage, UNIQUE_ID: 'f16-f1', LOCATIONCODE: 'F.16.000', LOTCODE: '27.F1', SEASON: 'F1', PTRONHAND: '113', PTRAVAILABLE: '113', S_LTS: '-276' },
    { ...lineage, UNIQUE_ID: 'h06-f1', LOCATIONCODE: 'H.06.000', LOTCODE: '27.F1', SEASON: 'F1', PTRONHAND: '1', PTRAVAILABLE: '1', S_LTS: '-276' }
  ];
  const ctx = { getConfiguredCurrentSalesYearCode: () => 27, getConfiguredCurrentSeasonCode: () => 'F1', parseAppNumber: value => value == null || value === '' ? null : Number(String(value).replace(/,/g, '')),
    buildItemInquiryViewModel: (_item, nextRows) => ({ rows: nextRows, locationRows: nextRows.map(row => ({ unique_id: row.UNIQUE_ID, sourceRow: row, values: row })) }) };
  vm.createContext(ctx);
  vm.runInContext(extractAppFunction('normalizeNcrSalesYearValue'), ctx);
  vm.runInContext(extractAppFunction('reclassStockSeason') + extractAppFunction('buildOptimisticInventoryReclassMoveModel'), ctx);
  const result = ctx.buildOptimisticInventoryReclassMoveModel({ item: {}, inquiryModel: { rows } }, {
    commandId: 'blue-dart-move', moves: [{ source: { uniqueId: 'source-s1' }, lines: [{ destinationSeason: 'F1', quantity: 276 }] }]
  }).model.rows;
  const sourceAfter = result.find(row => row.UNIQUE_ID === 'source-s1');
  const dest = result.find(row => String(row.UNIQUE_ID).startsWith('pending-reclass-'));
  assert.equal(sourceAfter.PTRONHAND, '532');
  assert.equal(sourceAfter.S_LTS, '253');
  assert.equal(dest.LOCATIONCODE, 'C.15.000');
  assert.equal(dest.LOTCODE, '27.F1');
  assert.equal(dest.PTRONHAND, '276');
  assert.equal(dest.PTRREVIEWED, '0');
  assert.equal(dest.PTRAVAILABLE, '276');
  assert.equal(dest.S_LTS, '390', 'current-season stock pools available physical rows after the move');
  assert.equal(dest.LOC_ON_HAND, '878');
  assert.deepEqual(result.filter(row => ['f16-f1','h06-f1'].includes(row.UNIQUE_ID)).map(row => row.S_LTS), ['390','390']);
});

}

function buildLineage(rows, extractAppFunction) {
    const ctx = { getConfiguredCurrentSalesYearCode: () => 27, getConfiguredCurrentSeasonCode: () => 'F1', parseAppNumber: value => value == null || value === '' ? null : Number(String(value).replace(/,/g, '')),
      buildItemInquiryViewModel: (_item, input) => ({ rows: input, locationRows: input.map(row => ({ unique_id: row.UNIQUE_ID, sourceRow: row, values: row })) }) };
    vm.createContext(ctx);
  vm.runInContext(extractAppFunction('normalizeNcrSalesYearValue'), ctx);
    vm.runInContext(`${extractAppFunction('reclassStockSeason')}\n${extractAppFunction('buildOptimisticInventoryReclassMoveModel')}`, ctx);
    return ctx.buildOptimisticInventoryReclassMoveModel({ item: {}, inquiryModel: { rows } }, {
      commandId: 'reclass-command-lineage-01', moves: [{ source: { uniqueId: 'source-uid' },
        lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }]
    });
}

function registerLineage({ source, extractAppFunction }) {
test('optimistic destination selection uses the canonical tuple and rejects duplicate targets', () => {
  const sourceLineage = { warehouseid: 'WH1', source: 'seed', desigitem: 'D1', desigcust: 'C1', desigloc: 'L1' };
  const sourceRow = { ...source.identity, ...sourceLineage, UNIQUE_ID: 'source-uid', ITEMCODE: 'ITEM-1', CONTSIZE: '#3',
    LOCATIONCODE: 'C.12.001', LOTCODE: '27.F1', SEASON: 'F1', PTRONHAND: '50', PTRAVAILABLE: '40' };
  const foreignTarget = { ...sourceRow, UNIQUE_ID: 'foreign-target', unique_id: 'foreign-target', LOTCODE: '27.U1', lotcode: '27.U1',
    SEASON: 'U1', season: 'U1', warehouseid: 'WH2', LOCATIONCODE: 'OTHER', locationcode: 'OTHER',
    PTRONHAND: '99', PTRAVAILABLE: '99' };
  const migration = fs.readFileSync('supabase/migrations/20261027013000_agdata_v2379_complete_reclass_destination_row_loop.sql', 'utf8');
  assert.match(migration, /AGDATA_V2379_DESTINATION_TUPLE_ANCHOR_MISMATCH/);
  assert.match(migration, /upper\(btrim\(coalesce\(m\.locationcode/);
  const result = buildLineage([sourceRow, foreignTarget], extractAppFunction);
  assert.equal(result.model.rows.find(row => row.unique_id === 'foreign-target').PTRONHAND, '99');
  assert.equal(result.model.rows.find(row => row.unique_id.startsWith('pending-reclass-')).ptronhand, '20');
  assert.throws(() => buildLineage([sourceRow, { ...foreignTarget, UNIQUE_ID: 'canonical-one', unique_id: 'canonical-one', LOCATIONCODE: 'C.12.001', locationcode: 'C.12.001', warehouseid: 'WH1' },
    { ...foreignTarget, UNIQUE_ID: 'canonical-two', unique_id: 'canonical-two', LOCATIONCODE: 'C.12.001', locationcode: 'C.12.001', warehouseid: 'WH1' }], extractAppFunction), /ambiguous/);
});

}

export function registerReclassOptimisticContracts(context) {
  registerWorksheet(context);
  registerSeason(context);
  registerLineage(context);
}
