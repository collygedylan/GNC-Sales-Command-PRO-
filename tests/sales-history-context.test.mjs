import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function harness() {
  const context = vm.createContext({
    firstNonEmptyValue: (...values) => values.find(v => v !== undefined && v !== null && String(v).trim() !== '') ?? '',
    normalizeRepMatchToken: value => String(value || '').toLowerCase().replace(/\W/g, ''),
    normalizeRequestCustomerFolderKey: value => String(value || '').toLowerCase(),
    parseRequestCustomerFolderParts: label => ({ customerName: label.split('|')[0].trim(), consigneeName: label.split('|')[1]?.trim() || '' }),
    getRequestCustomerConsigneeLabel: (c, s) => `${c} | ${s}`,
    getRequestConsigneeFolderLabel: value => value || 'No Consignee',
    getRequestFolderName: row => row.request_folder,
    requestsInventory: [], tempRequestCustomerSelectedFinalLabel: '', tempRequestCustomerSelectedContext: null,
    getRoleAccessState: () => ({ isRep: true }), canAccessView: () => true,
    buildFastInvokeAttrs: (fn, args) => `data-call="${fn}" data-uid="${args[0]}"`,
  });
  for (const name of ['getRequestCustomerContext', 'requestCustomerOptionKey', 'resolveRequestCustomerContext', 'applyRequestCustomerContextAliases', 'buildRequestCustomerPickerGroups', 'buildDocksCreditAction']) {
    const start = html.indexOf(`        function ${name}(`);
    assert.ok(start >= 0, name);
    const end = html.indexOf('\n        function ', start + 1);
    vm.runInContext(html.slice(start, end), context);
  }
  return context;
}

test('duplicate customer names and consignee names remain separate by exact IDs', () => {
  const h = harness();
  const options = [
    { customerName: 'Same Name', consigneeName: 'Store', customeridentityid: 'C1', consigneeidentityid: 'S1' },
    { customerName: 'Same Name', consigneeName: 'Store', customeridentityid: 'C2', consigneeidentityid: 'S1' },
    { customerName: 'Same Name', consigneeName: 'Store', customeridentityid: 'C1', consigneeidentityid: 'S2' },
  ];
  const groups = h.buildRequestCustomerPickerGroups(options);
  assert.equal(groups.length, 2);
  assert.equal(groups.find(g => g.key === 'id:C1').consignees.length, 2);
  assert.equal(new Set(options.map(h.requestCustomerOptionKey)).size, 3);
});

test('selected identities survive creation and aliases; typed or ambiguous names never invent IDs', () => {
  const h = harness();
  h.tempRequestCustomerSelectedFinalLabel = 'Same Name | Store';
  h.tempRequestCustomerSelectedContext = { customeridentityid: 'C2', customername: 'Same Name', consigneeidentityid: 'S9', consigneename: 'Store' };
  const selected = h.resolveRequestCustomerContext('Same Name | Store');
  assert.equal(selected.customeridentityid, 'C2');
  assert.equal(h.applyRequestCustomerContextAliases({}, selected).CONSIGNEEIDENTITYID, 'S9');
  assert.equal(h.resolveRequestCustomerContext('Other | Store').customeridentityid, '');
  h.requestsInventory = [
    { request_folder: 'F', customeridentityid: 'C1', customername: 'Same Name' },
    { request_folder: 'F', customeridentityid: 'C2', customername: 'Same Name' },
  ];
  assert.equal(h.resolveRequestCustomerContext('Same Name | Store', 'F').customeridentityid, '');
  h.requestsInventory.pop();
  assert.equal(h.resolveRequestCustomerContext('Same Name | Store', 'F').customeridentityid, 'C1');
});

test('Docks credit controls use exact source IDs, never synthetic rows or unauthorized modules', () => {
  const h = harness();
  assert.match(h.buildDocksCreditAction({ UNIQUE_ID: 'SOC-1' }), /data-uid="SOC-1"/);
  assert.equal(h.buildDocksCreditAction({ UNIQUE_ID: 'SOC-1', IS_SYNTHETIC_DOCK_ROW: true }), '');
  h.canAccessView = () => false;
  assert.equal(h.buildDocksCreditAction({ UNIQUE_ID: 'SOC-1' }), '');
});
