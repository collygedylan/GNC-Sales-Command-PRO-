import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { inventoryReadFixture } from './fixtures/inventory-list-read-fixture.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const spec = readFileSync(new URL('./reclass-splits.e2e.spec.ts', import.meta.url), 'utf8');

test('large verified inventory fixture reuses the production browser snapshot without retransferring rows', () => {
  assert.match(spec, /rows: window\.eval\('fullInventory'\), snapshot, expectedRows, physicalColumns/);
  assert.match(spec, /fullInventory = verified\.rows/);
  assert.match(spec, /finally\s*\{\s*delete root\.__reclassFixtureBridge;/);
  assert.match(spec, /delete root\.__reclassVerifiedInventoryBridge;/);
  assert.doesNotMatch(spec, /JSON\.stringify\(retainedRows\)|formatFetchedRows\(retainedRows/);
  assert.match(spec, /commonname: `Synthetic volume row \$\{index\}`/);
  assert.match(spec, /uniqueCommonNames\)\.toBeGreaterThanOrEqual\(1200\)/);
  assert.match(spec, /root\.__reclassVerifiedSnapshot = snapshot/);
  assert.match(spec, /const snapshot = window\.__reclassVerifiedSnapshot/);
  assert.match(spec, /finally\s*\{\s*delete root\.__reclassVerifiedSnapshot;/);
  assert.match(spec, /String\(master\.liveVerifiedRevision \|\| ''\) !== snapshot\.revision/);
  assert.match(spec, /if \(action !== 'inventory_reclass_move' && status < 400\)/);
  assert.match(spec, /bodyCaptured: false, contentLength/);
  assert.match(spec, /const read = response\.text\(\)/);
});

test('full 10k fixture satisfies the production common-name partial-snapshot guard', () => {
  const getFunction = name => {
    const marker = `function ${name}(`;
    const start = html.indexOf(marker);
    assert.notEqual(start, -1, `${name} exists in production source`);
    const open = html.indexOf(') {', start) + 2;
    let depth = 0;
    for (let index = open; index < html.length; index++) {
      if (html[index] === '{') depth++;
      else if (html[index] === '}' && --depth === 0) return html.slice(start, index + 1);
    }
    throw new Error(`Unclosed production function ${name}`);
  };
  const context = {
    MIN_TRUSTED_MASTER_COMMON_NAME_CACHE_COUNT: 1200,
    shouldScopeMasterInventoryToCurrentEval: () => false,
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') ?? '',
  };
  vm.createContext(context);
  vm.runInContext(`${getFunction('countUniqueCacheCommonNames')}\n${getFunction('masterRowsLookPartialForCurrentScope')}`, context);

  const oldRows = Array.from({ length: 10_000 }, (_, index) => ({ commonname: index ? 'Synthetic volume row' : 'Synthetic Drive Card' }));
  const correctedRows = Array.from({ length: 10_000 }, (_, index) => ({ commonname: `Synthetic volume row ${index}` }));
  assert.equal(context.masterRowsLookPartialForCurrentScope(oldRows), true,
    'repeated common names cannot claim the verified broad-scope full inventory cache');
  assert.equal(context.masterRowsLookPartialForCurrentScope(correctedRows), false,
    'unique representative names satisfy the production threshold');

  const physicalRow = inventoryReadFixture.fromFixtureShape({ unique_id: 'fixture-source', itemcode: 'FIXTURE.001', commonname: 'Synthetic Drive Card' });
  assert.equal(Object.keys(physicalRow).length, inventoryReadFixture.physicalColumns.length,
    'the warm fixture still contains every physical inventory column');
});

test('production formatter elides null physical fields while retaining required formatted fields', () => {
  const marker = 'function formatFetchedRows(items, sourceTable) {';
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, 'formatFetchedRows exists in production source');
  let depth = 0;
  let end = -1;
  for (let index = html.indexOf('{', start); index < html.length; index++) {
    if (html[index] === '{') depth++;
    else if (html[index] === '}' && --depth === 0) { end = index + 1; break; }
  }
  assert.notEqual(end, -1, 'formatFetchedRows has a complete body');

  const context = {
    redactEvalSensitiveData: value => value,
    normalizeAppTableName: value => String(value || '').trim().toLowerCase(),
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') ?? '',
    parseAppNumber: value => value == null || value === '' ? null : Number(value),
    repairDisplayFieldsOnRow: () => {},
    normalizeRowPhotoFields: () => {},
    preserveConfirmedDriveEvidence: row => row,
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  const raw = inventoryReadFixture.fromFixtureShape({ unique_id: 'fixture-source', itemcode: 'FIXTURE.001', commonname: 'Synthetic Drive Card',
    contsize: '#3', locationcode: 'A.01.001', lotcode: '27.F1', season: 'F1', saleyear: '27', ptronhand: '610', ptravailable: '610' });
  assert.equal(Object.keys(raw).length, inventoryReadFixture.physicalColumns.length,
    'the raw verified fixture row includes every physical column, including null columns');
  const formatted = context.formatFetchedRows([raw], 'ph_master_inventory')[0];
  assert.equal(Object.hasOwn(formatted, 'PTRONHAND'), true);
  assert.equal(formatted.PTRONHAND, '610');
  assert.equal(formatted.PTRAVAILABLE, '610');
  assert.equal(Object.hasOwn(formatted, 'HOLD_RELEASE_REASON'), false,
    'null physical values are intentionally absent from formatted cache rows');
});
