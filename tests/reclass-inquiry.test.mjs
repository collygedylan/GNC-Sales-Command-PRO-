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
    normalizeInventoryTransactionCompareText_: (value) => String(value ?? '').trim().toUpperCase(),
    getInventoryTransactionRowUid_: (row) => String(firstNonEmptyValue(row?.unique_id, row?.UNIQUE_ID, '')).trim(),
    getInventoryTransactionRowValue_: (row, aliases, fallback = '') => {
      for (const alias of aliases) if (Object.hasOwn(row || {}, alias)) return row[alias] ?? '';
      return fallback;
    },
    Utilities: {
      formatDate: () => '8/22/2026, 9:15:00 AM',
    },
    buildPhoneSizedEmailHtml_: (value) => String(value || ''),
    escapeEmailHtml_: (value) => String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;'),
  };
  vm.createContext(context);
  vm.runInContext(`${code.slice(start, end)}; this.applyReclassInquiryOverlays_ = applyReclassInquiryOverlays_; this.buildReclassInquiryReportModel_ = buildReclassInquiryReportModel_; this.buildReclassInquiryReportHtml_ = buildReclassInquiryReportHtml_; this.buildReclassInquiryReportText_ = buildReclassInquiryReportText_; this.buildReclassInquiryEmailHtml_ = buildReclassInquiryEmailHtml_;`, context);
  return context;
}

function loadClientPayloadBuilder(values = {}) {
  const start = html.indexOf('function buildArgosInventoryTransactionPayload');
  const end = html.indexOf('async function postArgosInventoryTransactionPayload', start);
  assert.ok(start > 0 && end > start);
  const context = {
    argosInventoryTransactionState: {
      idempotencyToken: 'reclass-token-123456',
      snapshot: {
        uniqueId: 'u1',
        sourceTable: 'ph_master_inventory',
        itemCode: 'A1',
        lotCode: '27.F1',
        locationCode: 'A.1',
        season: 'F1',
        salesYear: '2027',
      },
    },
    currentUser: 'tester',
    currentUserDisplay: 'Test User',
    APP_SHELL_VERSION: 'test',
    APP_SHELL_BUILD: 'test',
    getArgosInventoryTransactionInputValue: (id) => values[id] ?? '',
    parseAppNumber: (value) => Number(String(value).replaceAll(',', '')),
    normalizeArgosInventoryTransactionRequestAction: (value) => String(value || '').trim().toLowerCase(),
    isArgosInventoryTransactionMoveSeasonRequestAction: (value) => ['move_up', 'move_down'].includes(value),
    collectArgosReclassInquiryOverlays: () => [{ unique_id: 'u1', expected: {}, values: { holdstopcode: 'H' } }],
    generateArgosInventoryTransactionId: () => 'reclass-token-123456',
    getArgosInventoryTransactionActorEmail: () => 'tester@example.invalid',
    getCurrentRoleAccessValue: () => 'Manager',
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}; this.buildArgosInventoryTransactionPayload = buildArgosInventoryTransactionPayload;`, context);
  return context.buildArgosInventoryTransactionPayload;
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
  assert.equal(Array.from(result.rows[1].changedFields).sort().join('|'), 'holdstopcode|holdstopreason|locationnote|locationnotedate');
  assert.deepEqual(rows, before);
});

test('cleared and added Priority values are retained as changed fields and highlighted in the PDF', () => {
  const server = loadServerModel();
  const rows = [
    { unique_id: 'f14', itemcode: 'A1', lotcode: '27.F1', locationcode: 'F.14.000', priority: '3', commonname: 'Example', contsize: '#5' },
    { unique_id: 'd17', itemcode: 'A1', lotcode: '27.F1', locationcode: 'D.17.000', priority: '', commonname: 'Example', contsize: '#5' },
  ];
  const overlays = [
    { unique_id: 'f14', expected: { itemcode: 'A1', lotcode: '27.F1', locationcode: 'F.14.000' }, values: { priority: '' } },
    { unique_id: 'd17', expected: { itemcode: 'A1', lotcode: '27.F1', locationcode: 'D.17.000' }, values: { priority: '7' } },
  ];
  const result = server.applyReclassInquiryOverlays_(rows, overlays, new Date('2026-08-22T14:15:00Z'));
  assert.equal(result.ok, true);
  assert.equal(Array.from(result.rows[0].changedFields).join('|'), 'priority');
  assert.equal(Array.from(result.rows[1].changedFields).join('|'), 'priority');
  const model = server.buildReclassInquiryReportModel_(rows[0], rows, result.rows, { actor: { display: 'Tester' } }, new Date('2026-08-22T14:15:00Z'));
  const output = server.buildReclassInquiryReportHtml_(model, true);
  assert.match(output, /class="edited-cell" data-edited="true">&nbsp;<\/td>/);
  assert.match(output, /class="edited-cell" data-edited="true">7<\/td>/);
  assert.match(output, /Edited:<\/strong> 2 field\(s\) across 2 row\(s\)/);
});

test('Reclass identity validation uses the defined production comparison helper', () => {
  const overlayStart = code.indexOf('function applyReclassInquiryOverlays_');
  const overlayEnd = code.indexOf('function buildReclassInquiryReportModel_', overlayStart);
  const overlayHandler = code.slice(overlayStart, overlayEnd);
  assert.match(code, /function normalizeInventoryTransactionCompareText_\s*\(/);
  assert.match(overlayHandler, /normalizeInventoryTransactionCompareText_/);
  assert.doesNotMatch(overlayHandler, /normalizeInventoryTransactionComparable_/);
});

test('Reclass send uses an empty searchable picker and only explicitly selected recipients', () => {
  const start = html.indexOf('async function applyArgosInventoryTransactionEmailRecipients');
  const end = html.indexOf('function generateArgosInventoryTransactionId', start);
  const recipientHandler = html.slice(start, end);
  assert.match(recipientHandler, /openGroupedBloomNcrRecipientModal/);
  assert.match(recipientHandler, /openGroupedBloomNcrRecipientModal\(previewRows, \[\]/);
  assert.doesNotMatch(recipientHandler, /requiredEmails|requiredRecipients|getDefaultArgosInventoryTransactionRecipients/);
  assert.doesNotMatch(recipientHandler, /window\.prompt/);
  assert.match(html, /placeholder="Type a name or email address\.\.\."/);
});

test('Reclass server delivery uses only recipients explicitly selected in the picker', () => {
  const helperStart = code.indexOf('function getReclassInquiryEmailRecipients_');
  const helperEnd = code.indexOf('function getInventoryTransactionEmailRowValue_', helperStart);
  const helper = code.slice(helperStart, helperEnd);
  const handlerStart = code.indexOf('function handleReclassInquiryEmail_');
  const handlerEnd = code.indexOf('function handleInventoryTransaction_', handlerStart);
  const handler = code.slice(handlerStart, handlerEnd);
  assert.match(helper, /safePayload\.recipientEmails/);
  assert.match(helper, /safePayload\.recipients/);
  assert.doesNotMatch(helper, /actorEmail|INVENTORY_TRANSACTION_REQUIRED_RECIPIENT_EMAILS_/);
  assert.match(handler, /getReclassInquiryEmailRecipients_\(safePayload\)/);
  assert.doesNotMatch(handler, /getInventoryTransactionEmailRecipients_/);
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

test('blank quantity display dashes remain blank while true negative quantities are rejected', () => {
  const server = loadServerModel();
  const rows = [
    { unique_id: 'u1', itemcode: 'A1', lotcode: '27.F1', locationcode: 'A.1' },
    { unique_id: 'u2', itemcode: 'A1', lotcode: '27.S1', locationcode: 'B.1' },
  ];
  const overlays = rows.map((row, index) => ({
    unique_id: row.unique_id,
    expected: { itemcode: row.itemcode, lotcode: row.lotcode, locationcode: row.locationcode },
    values: { ptravailable: index ? '—' : '-' },
  }));
  const result = server.applyReclassInquiryOverlays_(rows, overlays, new Date());
  assert.equal(result.ok, true);
  assert.equal(Array.from(result.rows, (row) => row.values.ptravailable).join('|'), '|');
  assert.throws(() => server.applyReclassInquiryOverlays_([rows[0]], [{ ...overlays[0], values: { ptravailable: '-1' } }], new Date()), /non-negative/);
});

test('Reclass server fetch paginates every current row for the selected ITEMCODE', () => {
  const start = code.indexOf('function fetchReclassInquiryItemRows_');
  const end = code.indexOf('function normalizeReclassInquiryOverlayValue_', start);
  const fetcher = code.slice(start, end);
  assert.match(fetcher, /itemcode=eq\./);
  assert.match(fetcher, /const pageSize = 1000/);
  assert.match(fetcher, /offset=' \+ offset/);
  assert.match(fetcher, /rows = rows\.concat\(pageRows\)/);
  assert.match(fetcher, /if \(pageRows\.length < pageSize\) break/);
});

test('1-row, 8-row, and 41-row PDFs are escaped, simplified, highlighted, landscape, and repeat-header capable', () => {
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
      changedFields: index === 0 ? ['holdstopcode', 'holdstopreason'] : [],
    }));
    const output = server.buildReclassInquiryReportHtml_({ ...baseModel, rows }, true);
    assert.match(output, /@page\{size:Letter landscape/);
    assert.match(output, /thead\{display:table-header-group\}/);
    assert.match(output, /font-size:8pt/);
    assert.match(output, /background:#fff/);
    assert.match(output, /\.edited-cell\{background:#fff176!important\}/);
    assert.match(output, /class="edited-cell" data-edited="true">H<\/td>/);
    assert.doesNotMatch(output, /<img/i);
    assert.doesNotMatch(output, /Reclass Request/);
    assert.doesNotMatch(output, /Season Summary/);
    assert.doesNotMatch(output, /Field Notes/);
    assert.doesNotMatch(output, /Abbreviations:/);
    assert.match(output, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(output, /Pull Tag 1/);
    assert.match(output, /Loc PTN 2/);
    assert.equal((output.match(/<tr>/g) || []).length, rowCount + 1, `${rowCount}-row report should include every detail row plus one table header`);
  }
});

test('Reclass email body is a short attachment summary without duplicated row report sections', () => {
  const server = loadServerModel();
  const model = {
    identity: { commonname: 'Example', itemcode: 'A1', contsize: '#5' },
    actorDisplay: 'Tester',
    submittedAt: '8/22/2026, 9:15:00 AM',
    editSummary: { rowCount: 2, fieldCount: 2 },
  };
  const text = server.buildReclassInquiryReportText_(model);
  const htmlBody = server.buildReclassInquiryEmailHtml_(model);
  assert.match(text, /Edited Rows: 2/);
  assert.match(text, /Edited Fields: 2/);
  assert.match(htmlBody, /PDF attached:/);
  assert.match(htmlBody, /Edited cells are highlighted yellow/);
  for (const removed of ['Reclass Request', 'Season Summary', 'Location \/ Lot Item Inquiry', '<table']) {
    assert.doesNotMatch(htmlBody, new RegExp(removed));
  }
});

test('Reclass editor marks changed and cleared controls plus Location Note date in the app', () => {
  assert.match(html, /function syncArgosReclassRowEditUi\s*\(/);
  assert.match(html, /isArgosReclassRowFieldChanged/);
  assert.match(html, /data-reclass-field-wrapper/);
  assert.match(html, /data-reclass-system-field-wrapper="locationnotedate"/);
  assert.match(html, /argos-reclass-row-field--edited/);
  assert.match(html, /data-reclass-row-edit-count/);
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

test('hold-only Reclass inquiry does not require a quantity or move destination', () => {
  const buildPayload = loadClientPayloadBuilder({
    'argos-inventory-transaction-qty': '0',
    'argos-inventory-transaction-new-item': 'A1',
    'argos-inventory-transaction-new-lot': '27.F1',
    'argos-inventory-transaction-new-location': 'A.1',
    'argos-inventory-transaction-hold-action': 'hold',
    'argos-inventory-transaction-hold-reason': 'Field review',
  });
  const payload = buildPayload();
  assert.equal(payload.type, 'reclass_inquiry_email');
  assert.equal(payload.transaction.requestAction, 'hold');
  assert.equal(payload.transaction.quantity, null);
});

test('a proposed move still requires a positive quantity', () => {
  const buildPayload = loadClientPayloadBuilder({
    'argos-inventory-transaction-qty': '0',
    'argos-inventory-transaction-new-item': 'A1',
    'argos-inventory-transaction-new-lot': '27.F1',
    'argos-inventory-transaction-new-location': 'B.2',
    'argos-inventory-transaction-hold-action': 'none',
  });
  assert.throws(() => buildPayload(), /greater than 0 when proposing a move/);
});
