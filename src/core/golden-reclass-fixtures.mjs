import assert from 'node:assert/strict';
import vm from 'node:vm';

export function reclassSeasonContract(runFunctions,read) {
  const row = (id, location, lot, onHand, available, stock) => ({ UNIQUE_ID: id, ITEMCODE: '010018.031.1', LOCATIONCODE: location, LOTCODE: lot, SEASON: lot.split('.').pop(), PTRONHAND: String(onHand), PTRAVAILABLE: String(available), S_LTS: String(stock), MATCH: '80' });
  const rows = [row('source', 'A.03.000', '27.S1', 330, 330, 330), row('target', 'A.03.000', '27.F1', 114, 104, 104), row('sibling', 'A.02.000', '28.F1', 40, 40, 375)];
  const context = runFunctions('assets/app-runtime.js', ['normalizeNcrSalesYearValue','reclassStockSeason', 'buildOptimisticInventoryReclassMoveModel'], {
    getConfiguredCurrentSalesYearCode:()=>2027,getConfiguredCurrentSeasonCode:()=> 'F1',getNcrExplicitSalesYear:()=>null,parseAppNumber: value => value == null ? null : Number(value), buildItemInquiryViewModel: (_item, nextRows) => ({ rows: nextRows }),
    avInventory: [], fullInventory: rows, cavInventory: [{ ITEMCODE: '010018.031.1', SEASON: 'F1', OPEN_STOCK: '375' }, { ITEMCODE: '010018.031.1', SEASON: 'S1', OPEN_STOCK: '330' }],
  });
  const result = context.buildOptimisticInventoryReclassMoveModel({ item: rows[0], inquiryModel: { rows } }, { commandId: 'golden-stock', moves: [{ source: { uniqueId: 'source' }, lines: [{ quantity: 55, destinationSeason: 'F1' }] }] }).model.rows;
  const target = result.find(rowValue => rowValue.UNIQUE_ID === 'target');
  assert.equal(target.PTRONHAND, '169');
  assert.equal(target.S_LTS, '159');
  assert.equal(result.find(rowValue => rowValue.UNIQUE_ID === 'sibling').S_LTS, '375','future-year stock remains independent');
  assert.equal(target.__reclassSeasonOpenStock, '159','current season uses available current/carryover rows');
  assert.equal(Math.round(Number(target.PTRONHAND) * Number(target.MATCH) / 100), 135);
  assert.match(read('supabase/migrations/20261021220000_reclass_season_stock_and_recipients.sql'), /inventory_location_match_qty|loc_match_qty/i);
}

export function reclassDestinationContract(functionSource) {
  const lineage = { ITEMCODE: '004103.010.1', CONTSIZE: '#1', SOURCE: 'Drive' };
  const rows = [
    { ...lineage, UNIQUE_ID: 'source', LOCATIONCODE: 'C.15.000', LOTCODE: '27.S1', SEASON: 'S1', PTRONHAND: '808', PTRAVAILABLE: '808', S_LTS: '529' },
    { ...lineage, UNIQUE_ID: 'other', LOCATIONCODE: 'C.15.000', LOTCODE: '27.U1', SEASON: 'U1', PTRONHAND: '70', PTRAVAILABLE: '70', S_LTS: '70' },
    { ...lineage, UNIQUE_ID: 'dest-sibling', LOCATIONCODE: 'F.16.000', LOTCODE: '27.F1', SEASON: 'F1', PTRONHAND: '113', PTRAVAILABLE: '113', S_LTS: '-276' }
  ];
  const context = vm.createContext({
    getConfiguredCurrentSalesYearCode:()=>2027,getConfiguredCurrentSeasonCode:()=> 'F1',getNcrExplicitSalesYear:()=>null,parseAppNumber: value => value == null || value === '' ? null : Number(String(value).replace(/,/g, '')),
    buildItemInquiryViewModel: (_item, nextRows) => ({ rows: nextRows, locationRows: [] })
  });
  vm.runInContext(functionSource('assets/app-runtime.js','normalizeNcrSalesYearValue') + '\n' + functionSource('assets/app-runtime.js', 'reclassStockSeason') + '\n'
    + functionSource('assets/app-runtime.js', 'buildOptimisticInventoryReclassMoveModel'), context);
  const result = context.buildOptimisticInventoryReclassMoveModel({ item: {}, inquiryModel: { rows } }, {
    commandId: 'golden-reclass-destination', moves: [{ source: { uniqueId: 'source' },
      lines: [{ direction: 'move_up', destinationSeason: 'F1', quantity: 276 }] }]
  }).model.rows;
  const destination = result.find(row => row.LOCATIONCODE === 'C.15.000' && row.LOTCODE === '27.F1');
  assert.ok(destination, 'same-location destination is inserted into the visible model');
  assert.deepEqual([destination.PTRONHAND, destination.PTRREVIEWED, destination.PTRAVAILABLE, destination.S_LTS, destination.LOC_ON_HAND],
    ['276', '0', '276', '389', '878']);
  assert.equal(result.find(row => row.UNIQUE_ID === 'source').S_LTS, '253');
  assert.equal(result.find(row => row.UNIQUE_ID === 'dest-sibling').S_LTS, '389','current-season rows share physical available stock');
  assert.equal(rows[0].PTRONHAND, '808', 'the canonical source remains available for rollback');
}

