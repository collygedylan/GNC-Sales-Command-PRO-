import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const code = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');

function firstNonEmptyValue(...values) {
  return values.find((value) => value !== null && value !== undefined && String(value).trim() !== '') ?? '';
}

function loadClientModel() {
  const start = html.indexOf('const ITEM_INQUIRY_IDENTITY_FIELDS');
  const end = html.indexOf('function isCropRollShiftRow', start);
  assert.ok(start > 0 && end > start);
  const context = {
    firstNonEmptyValue,
    getItemInquiryRows: () => [],
    getItemInquiryItemCode: (row) => String(firstNonEmptyValue(row?.ITEMCODE, row?.itemcode, '')).trim().toUpperCase(),
    compareItemInquiryRows: (a, b) => String(a?.LOCATIONCODE || '').localeCompare(String(b?.LOCATIONCODE || ''), undefined, { numeric: true }),
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}; this.buildItemInquiryViewModel = buildItemInquiryViewModel;`, context);
  return context.buildItemInquiryViewModel;
}

function loadServerModel() {
  const start = code.indexOf('const RECLASS_INQUIRY_ROW_FIELDS_');
  const end = code.indexOf('function handleInventoryTransaction_', start);
  assert.ok(start > 0 && end > start);
  const context = {
    Map,
    Number,
    Object,
    String,
    Date,
    JSON,
    console,
    firstNonEmptyRequestValue_: firstNonEmptyValue,
    normalizeInventoryTransactionText_: (value) => String(value ?? '').trim(),
    normalizeInventoryTransactionComparable_: (value) => String(value ?? '').trim().toUpperCase(),
    getInventoryTransactionRowUid_: (row) => String(firstNonEmptyValue(row?.unique_id, row?.UNIQUE_ID, '')).trim(),
    getInventoryTransactionRowValue_: (row, aliases, fallback = '') => {
      for (const alias of aliases) if (Object.hasOwn(row || {}, alias)) return row[alias] ?? '';
      return fallback;
    },
    Utilities: {
      formatDate: () => '8/22/2026, 9:15:00 AM',
    },
    escapeEmailHtml_: (value) => String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;'),
  };
  vm.createContext(context);
  vm.runInContext(`${code.slice(start, end)}; this.applyReclassInquiryOverlays_ = applyReclassInquiryOverlays_; this.buildReclassInquiryReportModel_ = buildReclassInquiryReportModel_; this.buildReclassInquiryReportHtml_ = buildReclassInquiryReportHtml_;`, context);
  return context;
}

test('shared Item Inquiry model deduplicates seasons, normalizes years, preserves zero, and sorts rows', () => {
  const buildModel = loadClientModel();
  const rows = [
    { UNIQUE_ID: 'b', ITEMCODE: 'A1', COMMONNAME: 'Example', LOCATIONCODE: 'B.2', LOTCODE: '27.S1', SALEYEAR: '27', SEASON: 'S1', S_LTS: 0, SEASON_SUPPLY: 12, SEASON_OH: 8, SEASON_DEMAND: 4 },
    { UNIQUE_ID: 'a', ITEMCODE: 'A1', COMMONNAME: 'Example', LOCATIONCODE: 'A.1', LOTCODE: '27.S1', SALEYEAR: '27', SEASON: 'S1', S_LTS: 0, SEASON_SUPPLY: 12, SEASON_OH: 8, SEASON_DEMAND: 4 },
    { UNIQUE_ID: 'c', ITEMCODE: 'A1', COMMONNAME: 'Example', LOCATIONCODE: 'C.1', LOTCODE: '26.F1', SALEYEAR: '26', SEASON: 'F1', S_LTS: 5, SEASON_SUPPLY: 10, SEASON_OH: 6, SEASON_DEMAND: 4 },
  ];
  const model = buildModel(rows[0], rows);
  assert.equal(model.identity.commonname, 'Example');
  assert.equal(model.seasons.length, 2);
  assert.equal(model.seasons[0].saleyear, '2027');
  assert.equal(model.seasons[0].s_lts, '0');
  assert.equal(model.locationRows[0].unique_id, 'a');
});

test('temporary row overlays stamp changed and cleared Location Notes without mutating source rows', () => {
  const server = loadServerModel();
  const rows = [
    { unique_id: 'u1', itemcode: 'A1', lotcode: '27.F1', locationcode: 'A.1', locationnote: 'Keep', locationnotedate: '8/1/2026', ptronhand: 9 },
    { unique_id: 'u2', itemcode: 'A1', lotcode: '27.S1', locationcode: 'B.1', locationnote: 'Clear me', locationnotedate: '8/2/2026', ptronhand: 0 },
  ];
  const overlays = rows.map((row, index) => ({
    unique_id: row.unique_id,
    expected: { itemcode: row.itemcode, lotcode: row.lotcode, locationcode: row.locationcode },
    values: {
      lotcode: row.lotcode,
      locationcode: row.locationcode,
      ptronhand: index ? '0' : '9',
      ptrreviewed: '',
      ptravailable: '',
      locationnote: index ? '' : 'Keep',
      holdstopcode: index ? 'S' : '',
      holdstopreason: index ? 'Review' : '',
    },
  }));
  const before = structuredClone(rows);
  const result = server.applyReclassInquiryOverlays_(rows, overlays, new Date('2026-08-22T14:15:00Z'));
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].values.locationnotedate, '8/1/2026');
  assert.equal(result.rows[1].values.locationnotedate, '8/22/2026, 9:15:00 AM');
  assert.equal(result.rows[1].values.locationnote, '');
  assert.equal(result.rows[1].values.ptronhand, '0');
  assert.deepEqual(rows, before);
});

test('temporary overlays reject invalid hold codes, negative quantities, and stale identities', () => {
  const server = loadServerModel();
  const row = { unique_id: 'u1', itemcode: 'A1', lotcode: '27.F1', locationcode: 'A.1' };
  const base = { unique_id: 'u1', expected: { itemcode: 'A1', lotcode: '27.F1', locationcode: 'A.1' }, values: {} };
  assert.throws(() => server.applyReclassInquiryOverlays_([row], [{ ...base, values: { holdstopcode: 'X' } }], new Date()), /blank, H, or S/);
  assert.throws(() => server.applyReclassInquiryOverlays_([row], [{ ...base, values: { ptronhand: '-1' } }], new Date()), /non-negative/);
  const conflict = server.applyReclassInquiryOverlays_([row], [{ ...base, expected: { ...base.expected, locationcode: 'Z.9' } }], new Date());
  assert.equal(conflict.status, 'conflict');
});

test('1-row, 8-row, and 41-row print outputs are escaped, monochrome, landscape, and repeat-header capable', () => {
  const server = loadServerModel();
  const baseModel = {
    identity: { commonname: '<Unsafe & Name>', itemcode: 'A1' },
    seasons: [{ saleyear: '2027', season: 'F1', s_lts: '1', season_supply: '2', season_oh: '2', season_demand: '0' }],
    transaction: { quantity: 1, newItemCode: 'A2', newLotCode: '27.S1', newLocationCode: 'B.1' },
    actorDisplay: 'Tester',
    submittedAt: '8/22/2026, 9:15:00 AM',
  };
  for (const rowCount of [1, 8, 41]) {
    const rows = Array.from({ length: rowCount }, (_, index) => ({
      unique_id: `u${index + 1}`,
      values: Object.fromEntries([
        ['lotcode', `27.${index % 2 ? 'S1' : 'F1'}`],
        ['locationcode', `A.${index + 1}`],
        ['locationnote', index === 0 ? '<script>alert(1)</script>' : `Row ${index + 1}`],
        ['holdstopcode', index === 0 ? 'H' : ''],
        ['holdstopreason', index === 0 ? 'Check' : ''],
      ]),
    }));
    const output = server.buildReclassInquiryReportHtml_({ ...baseModel, rows }, true);
    assert.match(output, /@page\{size:Letter landscape/);
    assert.match(output, /thead\{display:table-header-group\}/);
    assert.match(output, /font-size:8pt/);
    assert.match(output, /background:#fff/);
    assert.doesNotMatch(output, /#[0-9a-f]{6}/i);
    assert.doesNotMatch(output, /<img/i);
    assert.match(output, /Field Notes/);
    assert.match(output, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(output, /Pull Tag 1/);
    assert.match(output, /Loc PTN 2/);
    assert.equal((output.match(/<tr>/g) || []).length, rowCount + 3, `${rowCount}-row report should include every detail row plus the two table headers and one season row`);
  }
});

test('Reclass send path contains no inventory, audit, History, cache-row, or live-event write', () => {
  const start = code.indexOf('function handleReclassInquiryEmail_');
  const end = code.indexOf('function handleInventoryTransaction_', start);
  const handler = code.slice(start, end);
  for (const forbidden of ['patchEmailApprovalMasterRow_', 'insertInventoryTransactionAudit_', 'emitAppLiveEvent_', 'propagateCommittedEdit', 'ph_request_history']) {
    assert.doesNotMatch(handler, new RegExp(forbidden));
  }
  assert.match(handler, /GmailApp\.sendEmail/);
  assert.match(handler, /attachments: \[pdfBlob\]/);
});
