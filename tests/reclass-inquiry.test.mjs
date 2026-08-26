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
  const pilotProperties = new Map();
  const pilotMessages = [];
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
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => pilotProperties.get(key) || '',
        setProperty: (key, value) => pilotProperties.set(key, String(value)),
      }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
    },
    HtmlService: {
      createHtmlOutput: (htmlOutput) => ({
        getBlob: () => ({
          htmlOutput,
          name: '',
          getAs() { return this; },
          setName(name) { this.name = name; return this; },
        }),
      }),
    },
    MimeType: { PDF: 'application/pdf' },
    GmailApp: {
      sendEmail: (...args) => pilotMessages.push(args),
    },
    buildPhoneSizedEmailHtml_: (value) => String(value || ''),
    escapeEmailHtml_: (value) => String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;'),
  };
  vm.createContext(context);
  vm.runInContext(`${code.slice(start, end)}; this.applyReclassInquiryOverlays_ = applyReclassInquiryOverlays_; this.buildReclassInquiryActionRowsV2_ = buildReclassInquiryActionRowsV2_; this.buildReclassInquiryActionRowsV3_ = buildReclassInquiryActionRowsV3_; this.buildReclassInquiryReportModel_ = buildReclassInquiryReportModel_; this.buildReclassInquiryReportHtml_ = buildReclassInquiryReportHtml_; this.buildReclassInquiryReportText_ = buildReclassInquiryReportText_; this.buildReclassInquiryEmailHtml_ = buildReclassInquiryEmailHtml_; this.getReclassInquiryActionLabel_ = getReclassInquiryActionLabel_; this.getReclassInquiryCompactFields_ = getReclassInquiryCompactFields_; this.buildReclassInquiryCompactReportHtml_ = buildReclassInquiryCompactReportHtml_; this.getReclassInquiryCompactPilotRows_ = getReclassInquiryCompactPilotRows_; this.buildReclassInquiryCompactPilotOverlays_ = buildReclassInquiryCompactPilotOverlays_; this.buildReclassInquiryCompactPilotModel_ = buildReclassInquiryCompactPilotModel_; this.RECLASS_ACTION_WORKFLOW_V2_ENABLED_ = RECLASS_ACTION_WORKFLOW_V2_ENABLED_; this.RECLASS_ACTION_WORKFLOW_V2_POLICY_VERSION_ = RECLASS_ACTION_WORKFLOW_V2_POLICY_VERSION_; this.RECLASS_ACTION_WORKFLOW_V3_ENABLED_ = RECLASS_ACTION_WORKFLOW_V3_ENABLED_; this.RECLASS_ACTION_WORKFLOW_V3_POLICY_VERSION_ = RECLASS_ACTION_WORKFLOW_V3_POLICY_VERSION_; this.RECLASS_INQUIRY_ACTION_RULES_V2_ = RECLASS_INQUIRY_ACTION_RULES_V2_; this.RECLASS_INQUIRY_ACTION_ORDER_V3_ = RECLASS_INQUIRY_ACTION_ORDER_V3_;`, context);
  context.__pilotMessages = pilotMessages;
  context.__pilotProperties = pilotProperties;
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
    RECLASS_ACTION_WORKFLOW_V3_ENABLED: true,
    RECLASS_ACTION_WORKFLOW_V3_POLICY_VERSION: 'reclass-action-workflow-v3-row-actions-20260826',
    RECLASS_ACTION_WORKFLOW_V2_ENABLED: true,
    RECLASS_ACTION_WORKFLOW_V2_POLICY_VERSION: 'reclass-action-workflow-v2-live-20260826',
    getReclassActionWorkflowV2Config: (value) => ({ hold: { kind: 'hold_on' }, recount: { kind: 'recount' }, move_up: { kind: 'move' } }[value] || null),
    getArgosInventoryTransactionInputValue: (id) => values[id] ?? '',
    parseAppNumber: (value) => Number(String(value).replaceAll(',', '')),
    normalizeArgosInventoryTransactionRequestAction: (value) => String(value || '').trim().toLowerCase(),
    isArgosInventoryTransactionMoveSeasonRequestAction: (value) => ['move_up', 'move_down'].includes(value),
    collectArgosReclassV3Draft: () => ({
      requestActions: ['hold', 'priority_change'],
      holdStopProposals: [],
      scope: {},
      rowOverlays: [{ unique_id: 'u1', expected: {}, proposals: [
        { action: 'hold', holdstopcode: 'H', holdstopreason: 'Field review' },
        { action: 'priority_change', priority: '2' },
      ] }],
    }),
    collectArgosReclassInquiryOverlays: () => [],
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
  assert.match(recipientHandler, /restoredRecipients[\s\S]*: \[\]/);
  assert.match(recipientHandler, /openGroupedBloomNcrRecipientModal\(previewRows, restoredRecipients/);
  assert.doesNotMatch(recipientHandler, /requiredEmails|requiredRecipients|getDefaultArgosInventoryTransactionRecipients/);
  assert.doesNotMatch(recipientHandler, /window\.prompt/);
  assert.match(html, /placeholder="Type a name or email address\.\.\."/);
});

test('Reclass server delivery uses only recipients explicitly selected in the picker', () => {
  const helperStart = code.indexOf('function getReclassInquiryEmailRecipients_');
  const helperEnd = code.indexOf('function getInventoryTransactionEmailRowValue_', helperStart);
  const helper = code.slice(helperStart, helperEnd);
  const enqueueStart = code.indexOf('function enqueueReclassInquiryEmail_');
  const handlerEnd = code.indexOf('function handleInventoryTransaction_', enqueueStart);
  const handler = code.slice(enqueueStart, handlerEnd);
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

test('Reclass workflow V3 row actions are live while V2 remains available for compatibility', () => {
  const server = loadServerModel();
  assert.equal(server.RECLASS_ACTION_WORKFLOW_V3_ENABLED_, true);
  assert.equal(server.RECLASS_ACTION_WORKFLOW_V3_POLICY_VERSION_, 'reclass-action-workflow-v3-row-actions-20260826');
  assert.deepEqual(Array.from(server.RECLASS_INQUIRY_ACTION_ORDER_V3_), [
    'hold', 'take_off_hold', 'stop_ship', 'off_stop_ship', 'recount', 'priority_change', 'move_up', 'move_down',
  ]);
  assert.equal(server.RECLASS_ACTION_WORKFLOW_V2_ENABLED_, true);
  assert.equal(server.RECLASS_ACTION_WORKFLOW_V2_POLICY_VERSION_, 'reclass-action-workflow-v2-live-20260826');
  assert.deepEqual(Array.from(Object.keys(server.RECLASS_INQUIRY_ACTION_RULES_V2_)), [
    'hold', 'take_off_hold', 'stop_ship', 'off_stop_ship', 'recount', 'priority_change', 'move_up', 'move_down',
  ]);
  const clientStart = html.indexOf('const RECLASS_ACTION_WORKFLOW_V3_ENABLED');
  const clientEnd = html.indexOf('const ARGOS_INVENTORY_TRANSACTION_REQUEST_LABELS', clientStart);
  const clientContract = html.slice(clientStart, clientEnd);
  assert.match(clientContract, /RECLASS_ACTION_WORKFLOW_V3_ENABLED = true/);
  assert.match(clientContract, /reclass-action-workflow-v3-row-actions-20260826/);
  assert.match(html, /RECLASS_ACTION_WORKFLOW_V2_ENABLED = true/);
  assert.match(html, /reclass-action-workflow-v2-live-20260826/);
  assert.doesNotMatch(clientContract, /\bncr\s*:/);
  assert.match(clientContract, /Object\.keys\(RECLASS_ACTION_WORKFLOW_V2_CONFIG\)/);
  assert.doesNotMatch(html.slice(html.indexOf('function ensureArgosInventoryTransactionModal'), html.indexOf('function renderArgosInventoryTransactionSource')), /NCR Request/);
});

test('action-specific compact PDFs use exact columns, natural ordering, preserved OH, and yellow proposals', () => {
  const server = loadServerModel();
  const expected = {
    priority_change: ['Lotcode', 'Location', 'Source', 'Priority', 'OH', 'Hold/Stop Code', 'Hold/Stop Reason', 'Loc Note Date', 'Location Note'],
    recount: ['Lotcode', 'Location', 'Source', 'Priority', 'OH', 'Hold/Stop Code', 'Hold/Stop Reason', 'Loc Note Date', 'Location Note'],
    move_up: ['Lotcode', 'Location', 'Source', 'Priority', 'OH', 'Move Qty', 'To Season', 'Hold/Stop Code', 'Hold/Stop Reason', 'Loc Note Date', 'Location Note'],
    move_down: ['Lotcode', 'Location', 'Source', 'Priority', 'OH', 'Move Qty', 'To Season', 'Hold/Stop Code', 'Hold/Stop Reason', 'Loc Note Date', 'Location Note'],
    hold: ['Lotcode', 'Location', 'Source', 'Priority', 'OH', 'Hold/Stop Code', 'Hold/Stop Reason', 'Loc Note Date', 'Location Note'],
    take_off_hold: ['Lotcode', 'Location', 'Source', 'Priority', 'OH', 'Hold/Stop Code', 'Hold/Stop Reason', 'Loc Note Date', 'Location Note'],
    stop_ship: ['Lotcode', 'Location', 'Source', 'Priority', 'OH', 'Hold/Stop Code', 'Hold/Stop Reason', 'Loc Note Date', 'Location Note'],
    off_stop_ship: ['Lotcode', 'Location', 'Source', 'Priority', 'OH', 'Hold/Stop Code', 'Hold/Stop Reason', 'Loc Note Date', 'Location Note'],
  };
  const outputs = {};
  for (const [action, expectedHeaders] of Object.entries(expected)) {
    const model = server.buildReclassInquiryCompactPilotModel_(action, new Date('2026-08-22T14:15:00Z'));
    const output = server.buildReclassInquiryCompactReportHtml_(model, true);
    outputs[action] = output;
    const headerHtml = output.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/)?.[1] || '';
    const headers = Array.from(headerHtml.matchAll(/<th>(.*?)<\/th>/g), (match) => match[1]);
    assert.deepEqual(headers, expectedHeaders, `${action} should have its exact columns`);
    assert.ok(output.indexOf('A.01.000') < output.indexOf('D.12.000'));
    assert.ok(output.indexOf('D.12.000') < output.indexOf('D.17.000'));
    assert.ok(output.indexOf('D.17.000') < output.indexOf('F.14.000'));
    assert.match(output, /TEST PILOT - SYNTHETIC DATA ONLY/);
    assert.match(output, /thead\{display:table-header-group\}/);
    assert.match(output, /@page\{size:Letter landscape/);
    assert.equal((output.match(/<tr>/g) || []).length, 5, `${action} should include all four current rows plus the header`);
  }
  for (const removed of ['Rev', 'Avail', 'Desig Item', 'Desig Cust', 'Desig Loc', 'Pull Tag 1', 'Pull Tag 2', 'Loc PTN 1', 'Loc PTN 2', 'H/S', 'H/S Reason']) {
    for (const output of Object.values(outputs)) assert.doesNotMatch(output, new RegExp(`<th>${removed}<\\/th>`), `${removed} must not be an action pilot column`);
  }
  assert.match(outputs.priority_change, /Request:<\/strong> Priority Change/);
  assert.match(outputs.priority_change, /class="edited-cell" data-edited="true">&nbsp;<\/td>/);
  assert.match(outputs.priority_change, /class="edited-cell" data-edited="true">1<\/td>/);
  assert.match(outputs.move_up, /class="edited-cell" data-edited="true">20<\/td>/);
  assert.match(outputs.move_up, /class="edited-cell" data-edited="true">F1<\/td>/);
  assert.match(outputs.move_up, />26<\/td><td class="edited-cell" data-edited="true">20<\/td>/, 'Move Up must preserve original OH 26');
  assert.match(outputs.move_down, />36<\/td><td class="edited-cell" data-edited="true">15<\/td>/, 'Move Down must preserve original OH 36');
  assert.match(outputs.take_off_hold, /class="edited-cell" data-edited="true">&nbsp;<\/td>/);
  assert.match(outputs.off_stop_ship, /class="edited-cell" data-edited="true">&nbsp;<\/td>/);
  assert.doesNotMatch(outputs.recount, /class="edited-cell"/);
});

test('workflow V2 validates every action and rejects mixed, stale, and unsafe proposals', () => {
  const server = loadServerModel();
  const pilotRows = server.getReclassInquiryCompactPilotRows_();
  for (const action of ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship', 'recount', 'priority_change', 'move_up', 'move_down']) {
    const result = server.buildReclassInquiryActionRowsV2_(action, pilotRows, server.buildReclassInquiryCompactPilotOverlays_(action, pilotRows));
    assert.equal(result.ok, true, `${action} should validate`);
  }
  const row = { unique_id: 'u1', itemcode: 'A1', lotcode: '27.F1', locationcode: 'A.1', priority: '3', ptronhand: '20', season: 'F1', holdstopcode: 'H', holdstopreason: 'Reason' };
  const overlay = (values = {}, actionValues = { included: true }, expected = { itemcode: 'A1', lotcode: '27.F1', locationcode: 'A.1' }) => ({ unique_id: 'u1', expected, values, actionValues });
  assert.throws(() => server.buildReclassInquiryActionRowsV2_('hold', [row], [overlay({ holdstopcode: 'S', holdstopreason: 'Reason' })]), /must propose Hold\/Stop Code H/);
  assert.throws(() => server.buildReclassInquiryActionRowsV2_('hold', [row], [overlay({ holdstopcode: 'H', holdstopreason: '' })]), /requires a Hold\/Stop Reason/);
  assert.throws(() => server.buildReclassInquiryActionRowsV2_('priority_change', [row], [overlay({ priority: '2', holdstopcode: 'H' })]), /unrelated field: holdstopcode/);
  assert.throws(() => server.buildReclassInquiryActionRowsV2_('priority_change', [row], [overlay({ priority: '0' })]), /1 through 99/);
  assert.throws(() => server.buildReclassInquiryActionRowsV2_('priority_change', [row], [overlay({ priority: '3' })]), /must add, replace, or remove/);
  assert.throws(() => server.buildReclassInquiryActionRowsV2_('move_up', [row], [overlay({}, { included: true, moveQuantity: 21, destinationSeason: 'S1' })]), /1 through the original OH/);
  assert.throws(() => server.buildReclassInquiryActionRowsV2_('move_up', [row], [overlay({}, { included: true, moveQuantity: 10.5, destinationSeason: 'S1' })]), /whole number/);
  assert.throws(() => server.buildReclassInquiryActionRowsV2_('move_up', [row], [overlay({}, { included: true, moveQuantity: 10, destinationSeason: 'F1' })]), /different from the current season/);
  assert.throws(() => server.buildReclassInquiryActionRowsV2_('move_up', [row], [overlay({}, { included: true, moveQuantity: 10, destinationSeason: 'Q1' })]), /configured destination season/);
  assert.throws(() => server.buildReclassInquiryActionRowsV2_('off_stop_ship', [row], [overlay({ holdstopcode: '', holdstopreason: '' })]), /currently coded S/);
  assert.throws(() => server.buildReclassInquiryActionRowsV2_('recount', [row], [overlay({}, { included: true })]), /read-only and unselected/);
  const stale = server.buildReclassInquiryActionRowsV2_('priority_change', [row], [overlay({ priority: '2' }, { included: true }, { itemcode: 'A1', lotcode: '27.F1', locationcode: 'Z.9' })]);
  assert.equal(stale.status, 'conflict');
  assert.deepEqual(row, { unique_id: 'u1', itemcode: 'A1', lotcode: '27.F1', locationcode: 'A.1', priority: '3', ptronhand: '20', season: 'F1', holdstopcode: 'H', holdstopreason: 'Reason' });
});

test('workflow V3 writes Dallas Move + Hold + Priority values into existing report columns', () => {
  const server = loadServerModel();
  const rows = [
    { unique_id: 'dallas', itemcode: '000748.010.1', lotcode: '27.S1', locationcode: 'C.16.000', source: 'LD', priority: '', ptronhand: '526', season: 'S1', saleyear: '27', holdstopcode: '', holdstopreason: '' },
    { unique_id: 'context', itemcode: '000748.010.1', lotcode: '27.F1', locationcode: 'A.01.000', source: 'SH', priority: '3', ptronhand: '20', season: 'F1', saleyear: '27', holdstopcode: '', holdstopreason: '' },
  ];
  const expected = (row) => ({ itemcode: row.itemcode, lotcode: row.lotcode, locationcode: row.locationcode });
  const overlays = rows.map((row) => ({
    unique_id: row.unique_id,
    expected: expected(row),
    proposals: row.unique_id === 'dallas' ? [
      { action: 'hold', holdstopcode: 'H', holdstopreason: 'sheared' },
      { action: 'priority_change', priority: '1' },
      { action: 'move_up', moveQuantity: 150, destinationSeason: 'F1' },
    ] : [],
  }));
  const transaction = {
    requestActions: ['hold', 'priority_change', 'move_up'],
    holdStopProposals: [],
    scope: {},
  };
  const result = server.buildReclassInquiryActionRowsV3_(transaction, rows, overlays, null);
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.requestActions), transaction.requestActions);
  const byId = Object.fromEntries(Array.from(result.rows, (row) => [row.unique_id, row]));
  assert.deepEqual(Array.from(byId.dallas.actions), ['hold', 'priority_change', 'move_up']);
  assert.equal(byId.dallas.values.ptronhand, '526');
  assert.equal(byId.dallas.values.holdstopcode, 'H');
  assert.equal(byId.dallas.values.holdstopreason, 'sheared');
  assert.equal(byId.dallas.values.priority, '1');
  assert.equal(byId.dallas.actionValues.moveupquantity, '150');
  assert.equal(byId.dallas.actionValues.moveupseason, 'F1');
  assert.deepEqual(Array.from(byId.dallas.changedFields), ['holdstopcode', 'holdstopreason', 'priority', 'moveupquantity', 'moveupseason']);

  const model = server.buildReclassInquiryReportModel_(rows[0], rows, result.rows, { transaction, actor: { display: 'Tester' } }, new Date('2026-08-26T14:00:00Z'));
  const output = server.buildReclassInquiryCompactReportHtml_(model, true);
  const headerHtml = output.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/)?.[1] || '';
  const headers = Array.from(headerHtml.matchAll(/<th>(.*?)<\/th>/g), (match) => match[1]);
  assert.deepEqual(headers, [
    'Lotcode', 'Location', 'Source', 'Priority', 'OH',
    'Move Up Qty', 'Move Up To Season',
    'Hold/Stop Code', 'Hold/Stop Reason', 'Loc Note Date', 'Location Note',
  ]);
  assert.match(output, /class="edited-cell" data-edited="true">1<\/td>/);
  assert.match(output, /class="edited-cell" data-edited="true">150<\/td>/);
  assert.match(output, /class="edited-cell" data-edited="true">H<\/td>/);
  assert.match(output, /class="edited-cell" data-edited="true">sheared<\/td>/);
  assert.doesNotMatch(output, /Hold\/Stop Proposals|<th>Actions<\/th>/);
  assert.ok(output.indexOf('A.01.000') < output.indexOf('C.16.000'));
  assert.equal((output.match(/<tr>/g) || []).length, rows.length + 1);
});

test('workflow V3 rejects duplicate actions, bad row fields, missing reasons, conflicting Hold/Stop, and move totals above OH', () => {
  const server = loadServerModel();
  const row = { unique_id: 'u1', itemcode: 'A1', lotcode: '27.F1', locationcode: 'A.1', priority: '3', ptronhand: '10', season: 'F1', saleyear: '27', holdstopcode: 'H', holdstopreason: 'Reason' };
  const overlay = (proposals) => [{ unique_id: 'u1', expected: { itemcode: 'A1', lotcode: '27.F1', locationcode: 'A.1' }, proposals }];
  const tx = (requestActions) => ({ requestActions, holdStopProposals: [], scope: {} });

  assert.throws(() => server.buildReclassInquiryActionRowsV3_(tx(['recount', 'recount']), [row], overlay([{ action: 'recount' }]), null), /empty or duplicated/);
  assert.throws(() => server.buildReclassInquiryActionRowsV3_(tx(['hold']), [row], overlay([{ action: 'hold', holdstopcode: 'H', holdstopreason: '' }]), null), /requires a Hold\/Stop Reason/);
  assert.throws(() => server.buildReclassInquiryActionRowsV3_(tx(['priority_change']), [row], overlay([{ action: 'priority_change', priority: '2', holdstopcode: 'S' }]), null), /unrelated field: holdstopcode/);
  assert.throws(() => server.buildReclassInquiryActionRowsV3_(tx(['move_up', 'move_down']), [row], overlay([
    { action: 'move_up', moveQuantity: 6, destinationSeason: 'S1' },
    { action: 'move_down', moveQuantity: 5, destinationSeason: 'U1' },
  ]), null), /cannot exceed original OH/);
  assert.throws(() => server.buildReclassInquiryActionRowsV3_(tx(['off_stop_ship']), [row], overlay([{ action: 'off_stop_ship', holdstopcode: '', holdstopreason: '' }]), null), /requires current Hold\/Stop Code S/);
  assert.throws(() => server.buildReclassInquiryActionRowsV3_(tx(['hold', 'stop_ship']), [row], overlay([
    { action: 'hold', holdstopcode: 'H', holdstopreason: 'Hold reason' },
    { action: 'stop_ship', holdstopcode: 'S', holdstopreason: 'Stop reason' },
  ]), null), /only one Hold\/Stop action/);
});

test('workflow V3 accepts every pairwise combination as independent proposals', () => {
  const server = loadServerModel();
  const actions = ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship', 'recount', 'priority_change', 'move_up', 'move_down'];
  const rows = [
    { unique_id: 'h', itemcode: 'A1', lotcode: '27.F1', locationcode: 'A.1', priority: '3', ptronhand: '50', season: 'F1', saleyear: '27', holdstopcode: 'H', holdstopreason: 'Hold' },
    { unique_id: 's', itemcode: 'A1', lotcode: '27.F1', locationcode: 'A.2', priority: '3', ptronhand: '50', season: 'F1', saleyear: '2027', holdstopcode: 'S', holdstopreason: 'Stop' },
    { unique_id: 'n1', itemcode: 'A1', lotcode: '27.F1', locationcode: 'A.3', priority: '3', ptronhand: '50', season: 'F1', saleyear: '27', holdstopcode: '', holdstopreason: '' },
    { unique_id: 'n2', itemcode: 'A1', lotcode: '27.F1', locationcode: 'A.4', priority: '4', ptronhand: '50', season: 'F1', saleyear: '27', holdstopcode: '', holdstopreason: '' },
  ];
  for (let left = 0; left < actions.length; left++) {
    for (let right = left + 1; right < actions.length; right++) {
      const pair = [actions[left], actions[right]];
      const proposalsByUid = { h: [], s: [], n1: [], n2: [] };
      pair.forEach((action) => {
        if (action === 'hold') proposalsByUid.n1.push({ action, holdstopcode: 'H', holdstopreason: 'Hold reason' });
        else if (action === 'take_off_hold') proposalsByUid.h.push({ action, holdstopcode: '', holdstopreason: '' });
        else if (action === 'stop_ship') proposalsByUid.n2.push({ action, holdstopcode: 'S', holdstopreason: 'Stop reason' });
        else if (action === 'off_stop_ship') proposalsByUid.s.push({ action, holdstopcode: '', holdstopreason: '' });
        else if (action === 'recount') proposalsByUid.n1.push({ action });
        else if (action === 'priority_change') proposalsByUid.n1.push({ action, priority: '2' });
        else if (action === 'move_up') proposalsByUid.n1.push({ action, moveQuantity: 5, destinationSeason: 'S1' });
        else if (action === 'move_down') proposalsByUid.n1.push({ action, moveQuantity: 6, destinationSeason: 'U1' });
      });
      const overlays = rows.map((row) => ({
        unique_id: row.unique_id,
        expected: { itemcode: row.itemcode, lotcode: row.lotcode, locationcode: row.locationcode },
        proposals: proposalsByUid[row.unique_id],
      }));
      const transaction = { requestActions: pair, holdStopProposals: [], scope: {} };
      const result = server.buildReclassInquiryActionRowsV3_(transaction, rows, overlays, null);
      assert.equal(result.ok, true, `${pair.join(' + ')} should validate independently`);
      assert.deepEqual(Array.from(result.requestActions), pair);
    }
  }
});

test('approved pilot sender is removed and the live Reclass handler accepts V3 before V2 compatibility', () => {
  const handlerStart = code.indexOf('function deliverReclassInquiryPayload_');
  const handlerEnd = code.indexOf('function handleInventoryTransaction_', handlerStart);
  const handler = code.slice(handlerStart, handlerEnd);
  const doPostStart = code.indexOf('function doPost');
  const doPost = code.slice(doPostStart);
  assert.doesNotMatch(code, /function sendReclassInquiryCompactPilotEmails/);
  assert.doesNotMatch(doPost, /compact_pilot|sendReclassInquiryCompactPilotEmails/);
  assert.match(handler, /buildReclassInquiryActionRowsV3_/);
  assert.match(handler, /buildReclassInquiryActionRowsV2_/);
  assert.match(handler, /buildReclassInquiryCompactReportHtml_\(model, true\)/);
  assert.match(handler, /workflowPolicyVersion/);
  assert.match(handler, /GNC PH Reclass - ' \+ model\.requestActionLabel/);
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

test('every live Reclass row shows current Hold/Stop fields and direct touch action controls', () => {
  const start = html.indexOf('function buildArgosReclassActionFieldsHtml');
  const end = html.indexOf('function buildArgosReclassRowFieldsHtml', start);
  const builder = html.slice(start, end);
  assert.match(builder, /Current HOLDSTOPCODE/);
  assert.match(builder, /Current HOLDSTOPREASON/);
  assert.match(builder, /data-reclass-v3-action/);
  assert.match(builder, /toggleArgosReclassV3Action/);
  assert.match(builder, /RECLASS_ACTION_WORKFLOW_V3_ORDER\.map/);
  assert.doesNotMatch(builder, /data-reclass-action-included/);
  assert.match(html, /\.argos-reclass-action-btn\{min-height:2\.75rem/);
});

test('Reclass send path contains no inventory, audit, History, cache-row, or live-event write', () => {
  const start = code.indexOf('function enqueueReclassInquiryEmail_');
  const end = code.indexOf('function handleInventoryTransaction_', start);
  const handler = code.slice(start, end);
  for (const forbidden of ['patchEmailApprovalMasterRow_', 'insertInventoryTransactionAudit_', 'emitAppLiveEvent_', 'propagateCommittedEdit', 'ph_request_history']) {
    assert.doesNotMatch(handler, new RegExp(forbidden));
  }
  assert.doesNotMatch(handler, /LockService\.getScriptLock|GmailApp\.sendEmail/);
  assert.match(handler, /sendGmailApiMessage_/);
  assert.match(handler, /attachments: \[pdfBlob\]/);
});

test('Reclass queues idempotently and exposes sanitized status and retry routes', () => {
  const start = code.indexOf('function getReclassInquiryEventKey_');
  const end = code.indexOf('function handleInventoryTransaction_', start);
  const delivery = code.slice(start, end);
  const doPost = code.slice(code.indexOf('function doPost'));
  assert.match(delivery, /reclass-inquiry:/);
  assert.match(delivery, /ph_request_delivery_outbox/);
  assert.match(delivery, /resolution=ignore-duplicates,return=representation/);
  assert.match(delivery, /status: 'pending'/);
  assert.match(delivery, /function handleReclassInquiryStatus_/);
  assert.match(delivery, /function handleReclassInquiryRetry_/);
  assert.doesNotMatch(delivery, /push_delivered_at/);
  assert.match(doPost, /payload\.type === 'reclass_inquiry_status'/);
  assert.match(doPost, /payload\.type === 'reclass_inquiry_retry'/);
});

test('Reclass signed delivery recovers deterministic Gmail sends and attaches the PDF', () => {
  const signedStart = code.indexOf('function handleSignedReclassInquiryDelivery_');
  const signedEnd = code.indexOf('function handleSignedRequestDeliveryEvent_', signedStart);
  const signed = code.slice(signedStart, signedEnd);
  const mimeStart = code.indexOf('function buildMimeEmail_');
  const mimeEnd = code.indexOf('function extractGmailMessageHeader_', mimeStart);
  const mime = code.slice(mimeStart, mimeEnd);
  assert.match(signed, /getRequestDeliveryReceipt_/);
  assert.match(signed, /findSentRequestDeliveryByMessageId_/);
  assert.match(signed, /deliverReclassInquiryPayload_/);
  assert.match(mime, /multipart\/mixed/);
  assert.match(mime, /Content-Disposition: attachment/);
  assert.match(mime, /Content-Transfer-Encoding: base64/);
});

test('Reclass client guards recipient selection and retains background drafts until delivery', () => {
  const submitStart = html.indexOf('async function submitArgosInventoryTransaction');
  const submitEnd = html.indexOf('function canSendDriveRowToHoldRelease', submitStart);
  const submit = html.slice(submitStart, submitEnd);
  const statusStart = html.indexOf('function readReclassDeliveryJobs');
  const statusEnd = html.indexOf('async function postArgosInventoryTransactionPayload', statusStart);
  const status = html.slice(statusStart, statusEnd);
  assert.ok(submit.indexOf('argosInventoryTransactionState.submitting = true') < submit.indexOf('applyArgosInventoryTransactionEmailRecipients'));
  assert.match(submit, /rememberQueuedReclassDelivery/);
  assert.match(submit, /Sending in Background/);
  assert.match(status, /RECLASS_DELIVERY_STORAGE_KEY/);
  assert.match(status, /reclass_inquiry_status/);
  assert.match(status, /reclass_inquiry_retry/);
  assert.match(status, /update\.payload = null/);
  assert.match(status, /reopenReclassDeliveryJob/);
});

test('live Reclass payload uses the V3 policy and independent action proposal arrays', () => {
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
  assert.deepEqual(Array.from(payload.transaction.requestActions), ['hold', 'priority_change']);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.transaction.holdStopProposals)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.transaction.scope)), {});
  assert.equal(payload.workflowPolicyVersion, 'reclass-action-workflow-v3-row-actions-20260826');
  assert.equal(payload.transaction.quantity, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.rowOverlays[0].proposals)), [
    { action: 'hold', holdstopcode: 'H', holdstopreason: 'Field review' },
    { action: 'priority_change', priority: '2' },
  ]);
});

test('live Reclass payload obtains its validation from the direct-action V3 draft collector', () => {
  const start = html.indexOf('function buildArgosInventoryTransactionPayload');
  const end = html.indexOf('async function postArgosInventoryTransactionPayload', start);
  assert.ok(start > 0 && end > start);
  const context = {
    argosInventoryTransactionState: { snapshot: {} },
    RECLASS_ACTION_WORKFLOW_V3_ENABLED: true,
    RECLASS_ACTION_WORKFLOW_V3_POLICY_VERSION: 'reclass-action-workflow-v3-row-actions-20260826',
    RECLASS_ACTION_WORKFLOW_V2_ENABLED: true,
    collectArgosReclassV3Draft: () => { throw new Error('Choose at least one Reclass action inside a Location/Lot row.'); },
    getArgosInventoryTransactionInputValue: () => '',
    parseAppNumber: Number,
    normalizeArgosInventoryTransactionRequestAction: () => 'none',
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}; this.buildArgosInventoryTransactionPayload = buildArgosInventoryTransactionPayload;`, context);
  assert.throws(() => context.buildArgosInventoryTransactionPayload(), /Choose at least one Reclass action inside a Location\/Lot row/);
});

test('Reclass editor avoids duplicate identity and season summary blocks', () => {
  const start = html.indexOf('function renderArgosReclassInquiryEditor');
  const end = html.indexOf('function handleArgosReclassLocationNoteInput', start);
  assert.ok(start > 0 && end > start);
  const editor = html.slice(start, end);
  assert.doesNotMatch(editor, /argos-reclass-identity/);
  assert.doesNotMatch(editor, /argos-reclass-season/);
  assert.match(editor, /Choose row actions/);
});

test('Bloom Picker Order is Dylan-only and optional Productivity schema failure stays local', () => {
  const bloomStart = html.indexOf('function canSubmitBloomPickerOrder');
  const bloomEnd = html.indexOf('function canUseCartInventoryActions', bloomStart);
  assert.ok(bloomStart > 0 && bloomEnd > bloomStart);
  const bloomGate = html.slice(bloomStart, bloomEnd);
  assert.match(bloomGate, /isExactDylanCollygeUser\(\)/);
  assert.match(bloomGate, /canUseBloomPicker\(items\)/);

  const warningStart = html.indexOf('function maybeWarnProductivitySchemaMissing');
  const warningEnd = html.indexOf('async function ensureProductivityHistorySchemaReady', warningStart);
  assert.ok(warningStart > 0 && warningEnd > warningStart);
  const warning = html.slice(warningStart, warningEnd);
  assert.match(warning, /console\.warn/);
  assert.doesNotMatch(warning, /showToast/);
});
