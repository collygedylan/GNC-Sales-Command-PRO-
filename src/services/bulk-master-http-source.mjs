import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const ROW_COUNT = 9539;
// The positional ERP export includes SALESNOTE twice; retain both positions.
const APPROVED_MASTER_SOURCE_HEADERS = Object.freeze([
  'warehouseid','plantgroupcode','itemcode','qualitycode','contsize','commonname','lotcode','locationcode',
  'source','desigitem','desigcust','desigloc','priority','ptronhand','ptrreviewed','ptravailable',
  'holdstopcode','holdstopbegindate','holdstopreason','hsreasonbegin','season_supply','season_oh','season_demand',
  's_lts','oversellpercentage','itemspec','locationnote','locationnotedate','suspend','suspend_to',
  'specialpuller','pulltagnote1','pulltagnote2','fieldtagcolor','salesnote','inventorynote','locationptn1',
  'locationptn2','prisetby','priupdated','bypassloc','largeptrqty','maxorderquantity','lochold','listprice',
  'ext_ptronhand','varietycode','genusname','botanicalname','reversecommon','sortnamevariety','containersort',
  'saleyear','season','blockalpha','blocknumber','bay','pullerresponsibility','grower','si_lts','a_lts','ai_lts',
  'season_available','holdstopenddate','salesnote','fnsalesnote','warehousename','mcstatus','hz','intercopo',
  'insurancegroup','brand','printedcontainercode','salesnotebegindate','equiv_unit','ext_equiv_unit',
]);
// This fixture contains production-shape aggregates only; all generated row values are synthetic.
const ITEM6_FIELDS = Object.freeze([
  'locationnote', 'locationptn1', 'desigitem', 'desigcust', 'desigloc',
  'pullerresponsibility', 'oversellpercentage', 'salesnote', 'suspend',
]);
const META_FIELDS = new Set(['unique_id', 'assignedto', 'last_updated', 'filename', 'concat']);
// EXT_EQUIV_UNIT is retained by staging for raw audit, without a live column.
const SOURCE_ONLY_FIELDS = new Set(['ext_equiv_unit']);
const NUMERIC_TEXT_FIELDS = new Set([
  'quantityordered', 'quantityshipped', 'listprice', 'unitprice', 'retailprice',
  'ptravailable', 'ptronhand', 'ptrreviewed', 'season_supply', 's_lts', 'a_lts',
  'ai_lts', 'si_lts', 'season_oh', 'season_demand', 'oversellpercentage',
  'largeptrqty', 'maxorderquantity', 'ext_ptronhand', 'saleyear', 'blocknumber', 'bay', 'loc_match_qty',
]);
const DATE_TEXT_FIELDS = new Set([
  'date_completed', 'flyer_completed', 'hold_release_approved_at', 'av_rule_av_note_updated_at',
  'av_rule_bundle_updated_at', 'av_rule_caliper_updated_at', 'av_rule_last_cleared_at',
  'av_rule_match_updated_at', 'av_rule_photo_updated_at', 'av_rule_spec_updated_at',
  'eval_task_assigned_at', 'priupdated', 'locationnotedate', 'salesnotebegindate',
]);
const REQUIRED_SOURCE_FIELDS = Object.freeze([
  'itemcode', 'commonname', 'contsize', 'locationcode', 'lotcode', 'source', 'warehouseid',
  'desigitem', 'desigcust', 'desigloc', 'priority', 'holdstopcode', 'holdstopreason',
]);

function appScriptContext() {
  const code = readFileSync(new URL('../../Code.gs', import.meta.url), 'utf8');
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, value) => Array.from(createHash('sha256').update(value, 'utf8').digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
    },
  });
  new vm.Script(code, { filename: 'Code.gs' }).runInContext(ctx);
  return ctx;
}

function shapeRecordForColumn(shape, column) {
  return shape instanceof Map ? shape.get(column) || null : shape.find(item => item.column_name === column) || null;
}

function isPopulated(shape, column, rowIndex, rowCount) {
  const record = shapeRecordForColumn(shape, column);
  if (!record) return false;
  const count = Number(record.populated_rows);
  return Math.floor(((rowIndex + 1) * count) / rowCount) > Math.floor((rowIndex * count) / rowCount);
}

function syntheticColumnValue(column, rowIndex, length, variant, type) {
  const padded = String(rowIndex + 1).padStart(5, '0');
  if (column === 'itemcode') return `GNC_BULK_BENCH_${padded}`;
  if (column === 'commonname') return `Synthetic bulk plant ${padded} v${variant}`;
  if (column === 'contsize') return '#3';
  if (column === 'locationcode') return `A.${(rowIndex % 10) + 1}`;
  if (column === 'lotcode') return 'F1';
  if (column === 'source') return 'PH';
  if (column === 'warehouseid' || column === 'warehousei') return '10';
  if (column === 'desigitem') return 'D1';
  if (column === 'desigcust') return 'C1';
  if (column === 'desigloc') return 'L1';
  if (column === 'priority') return '1';
  if (column === 'holdstopcode') return rowIndex % 17 === 0 ? 'H' : '';
  if (column === 'holdstopreason') return rowIndex % 17 === 0 ? `Synthetic hold ${padded}` : '';
  if (column === 'last_updated' || type.includes('timestamp') || DATE_TEXT_FIELDS.has(column)) {
    const dateValue = '2026-10-14T12:34:56.123Z';
    return length > dateValue.length ? dateValue.padEnd(length, ' ') : dateValue.slice(0, length);
  }
  if (type === 'date') return '2026-10-14'.slice(0, length);
  if (type === 'boolean') return rowIndex % 2 === 0 ? 'true' : 'false';
  if (['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision'].includes(type) || NUMERIC_TEXT_FIELDS.has(column)) {
    const number = String((rowIndex % 997) + 1);
    return number.slice(-Math.max(1, length)).padStart(Math.max(1, length), '0');
  }
  if (type === 'json' || type === 'jsonb') return JSON.stringify({ synthetic: true, row: rowIndex + 1 });
  if (column === 'season') return 'F1'.slice(0, length).padEnd(length, '1');
  if (column === 'plantgroupcode') return '140_GRASS'.slice(0, length).padEnd(length, '0');
  if (column === 'locationnote') return `Note ${padded}`.padEnd(length, 'x').slice(0, length);
  if (column === 'salesnote') return `Sales note ${padded}`.padEnd(length, 'x').slice(0, length);
  const prefix = `SYNTH_${column}_${String((rowIndex + 1) % 100000).padStart(5, '0')}`;
  return prefix.padEnd(length, 'x').slice(0, length);
}

export function sourceRowsFromProductionShape({ shape, columns, rowCount = ROW_COUNT, variant = 0, syncTime = null }) {
  const ctx = appScriptContext();
  const columnTypes = new Map(columns.map(column => [column.column_name, column.data_type]));
  const shapeByColumn = new Map(shape.map(item => [item.column_name, item]));
  const targetLengthFor = (column, rowIndex) => {
    const entry = shapeRecordForColumn(shapeByColumn, column);
    if (!entry || Number(entry.populated_rows) <= 0) return 12;
    const count = Number(entry.populated_rows);
    const targetSum = Math.round(Number(entry.avg_text_length) * count);
    const base = Math.floor(targetSum / count);
    const extra = targetSum - base * count;
    const rank = Math.floor((rowIndex * extra) / count);
    const previousRank = Math.floor(((rowIndex - 1) * extra) / count);
    return Math.max(1, base + (rank > previousRank ? 1 : 0));
  };
  const headers = APPROVED_MASTER_SOURCE_HEADERS;
  assert.equal(headers.length, 76, 'the fixture retains every positional source column');
  for (const field of headers) assert.ok(columnTypes.has(field) || SOURCE_ONLY_FIELDS.has(field),
    `synthetic import field is a real column or an explicit raw source field: ${field}`);
  const rawData = [headers.map(name => name.toUpperCase())];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const values = headers.map(column => {
      const type = columnTypes.get(column) || 'text';
      if (!REQUIRED_SOURCE_FIELDS.includes(column) && !isPopulated(shapeByColumn, column, rowIndex, rowCount)) return '';
      return syntheticColumnValue(column, rowIndex, targetLengthFor(column, rowIndex), variant, type);
    });
    rawData.push(values);
  }
  const payload = vm.runInContext('buildMasterBulkSnapshotPayload_', ctx)(
    'ph_master_inventory', [{ fileName: 'synthetic-bulk-master.csv', rawData }],
    vm.runInContext('buildMasterPayload', ctx), syncTime || new Date(`2026-10-14T12:${String(variant).padStart(2, '0')}:00.000Z`).toISOString(),
  );
  const rows = JSON.parse(JSON.stringify(payload.rows));
  assert.equal(rows.length, rowCount, 'the GAS importer must produce the requested complete identity set');
  assert.ok(rows.every(row => row.values.unique_id.startsWith('GNC_BULK_BENCH_')));
  const expectedFields = [...new Set([...headers, 'unique_id', 'last_updated', 'filename', 'concat'])].sort();
  for (const row of rows) {
    assert.deepEqual(Object.keys(row.values).sort(), expectedFields,
      'the importer emits exactly the source fields and four canonical metadata fields');
    assert.deepEqual([...row.rawFields].sort(), [...ITEM6_FIELDS].sort(),
      'the complete export retains every Item6 raw-field acknowledgment');
  }
  assert.equal(new Set(rows.map(row => row.values.unique_id)).size, rowCount);
  return { rows, sourceDigest: payload.sourceDigest, context: ctx };
}

export function legacyBulkSource(source) {
  // The legacy direct RPC accepts physical columns only. The current GAS
  // staging path retains EXT_EQUIV_UNIT separately in its raw audit payload.
  const rows = source.rows.map(row => ({ ...row, values: Object.fromEntries(
    Object.entries(row.values).filter(([field]) => field !== 'ext_equiv_unit'),
  ) }));
  const canonicalRows = vm.runInContext('canonicalizeMasterBulkPayloadValue_', source.context)(rows);
  return { ...source, rows, sourceDigest: createHash('sha256').update(JSON.stringify(canonicalRows)).digest('hex') };
}

export function syntheticBulkMasterSnapshot({ rowCount = ROW_COUNT, variant = 0, columns: suppliedColumns = null } = {}) {
  const shape = JSON.parse(readFileSync(new URL('../../tests/fixtures/bulk-master-import-shape.json', import.meta.url), 'utf8'));
  const allowed = new Set(vm.runInContext('Array.from(ALLOWED_DB_COLUMNS)', appScriptContext()));
  const columns = suppliedColumns || [...new Set([...shape.map(item => item.column_name), ...allowed,
    ...APPROVED_MASTER_SOURCE_HEADERS.filter(field => !SOURCE_ONLY_FIELDS.has(field))])]
    .filter(column_name => !META_FIELDS.has(column_name)).map(column_name => ({ column_name, data_type: 'text' }));
  return sourceRowsFromProductionShape({ shape, columns, rowCount, variant });
}
