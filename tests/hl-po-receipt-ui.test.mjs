import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createHlOrderState, hlSoc } from './fixtures/hl-order-state.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const extract = (name) => {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0);
  return html.slice(start, html.indexOf('\n        }', start) + 10);
};
const ctx = vm.createContext({ Intl, Date });
vm.runInContext(extract('hlChicagoCutoffToIso'), ctx);

test('Chicago receipt cutoffs handle summer, winter, nonexistent times and repeated times explicitly', () => {
  assert.equal(ctx.hlChicagoCutoffToIso('2026-09-11T10:00'), '2026-09-11T15:00:00.000Z');
  assert.equal(ctx.hlChicagoCutoffToIso('2026-01-11T10:00'), '2026-01-11T16:00:00.000Z');
  assert.throws(() => ctx.hlChicagoCutoffToIso('2026-03-08T02:30'), /does not exist/);
  assert.throws(() => ctx.hlChicagoCutoffToIso('2026-11-01T01:30'), /occurs twice/);
  assert.equal(ctx.hlChicagoCutoffToIso('2026-11-01T01:30', '-05:00'), '2026-11-01T06:30:00.000Z');
  assert.equal(ctx.hlChicagoCutoffToIso('2026-11-01T01:30', '-06:00'), '2026-11-01T07:30:00.000Z');
  assert.throws(() => ctx.hlChicagoCutoffToIso('2026-02-30T10:00'), /does not exist/);
});

test('HL has no unrestricted SOC fallback while protected eligibility is loading', () => {
  const context = vm.createContext({ canUseHlOrder: () => true, hlOrderStateData: null,
    socInventory: [{ unique_id: 'not-authorized' }], makeHlOrderRow: (row) => row, isHlOrderSourceEligible: () => true });
  vm.runInContext(extract('getHlOrderRows'), context);
  assert.equal(context.getHlOrderRows().length, 0);
});

test('PO send warnings aggregate matching item and size across source lots and distinguish zero from unknown', () => {
  const context = vm.createContext({ hlOrderStateData: { draft: [] }, escapeHtml: String });
  vm.runInContext(['getHlOrderSource', 'getHlPoBalance', 'getHlPoSubmissionWarnings', 'buildHlPoBalanceHtml'].map(extract).join('\n'), context);
  const first = { ...hlSoc('a'), quantity: 4, po_balance: { status: 'ready', remaining: 6 } };
  const second = { ...hlSoc('b', { lotcode: '26.F1' }), quantity: 4, po_balance: { status: 'ready', remaining: 6 } };
  assert.match(context.getHlPoSubmissionWarnings({ lines: [first, second] })[0], /ordering 8 exceeds PO remaining 6/);
  first.po_balance.remaining = 0;
  assert.match(context.getHlPoSubmissionWarnings({ lines: [first] })[0], /remaining 0/);
  assert.match(context.buildHlPoBalanceHtml(first), /PO remaining: 0/);
  first.po_balance = { status: 'unknown', remaining: null };
  assert.match(context.getHlPoSubmissionWarnings({ lines: [first] })[0], /remaining is Unknown/);
  assert.match(context.buildHlPoBalanceHtml(first), /PO remaining: Unknown/);
});

test('receipt fixture keeps duplicate balance copies, command replay and inclusive import cutoff consistent', () => {
  const fixture = createHlOrderState({ rows: [hlSoc('a')], poRows: [{ itemcode: 'SYNTH.003', contsize: '#3', po_remain: 20 }, { itemcode: 'SYNTH.003', contsize: '#3', po_remain: 20 }],
    poBalances: [{ itemcode: 'SYNTH.003', size: '#3', status: 'ready', imported: 20, remaining: 20 }],
    poImports: [{ id: 'import', status: 'pending', balances: [{ itemcode: 'SYNTH.003', size: '#3', status: 'ready', imported: 15 }] }] });
  let sequence = 0;
  const command = (action, payload = {}) => fixture.command({ p_command_id: `command-${++sequence}`, p_action: action, p_payload: payload, p_expected_revision: fixture.state.revision });
  command('draft_save', { rows: [{ source_id: 'a', quantity: 10 }] });
  command('submit', { preview_id: command('preview').preview.id }); fixture.deliver();
  assert.equal([...fixture.poBalances.values()][0].remaining, 20);
  const order = fixture.state.orders[0], line = order.lines[0];
  command('receive', { order_id: order.id, lines: [{ line_id: line.id, received_quantity: 5 }] });
  fixture.command(fixture.commands.at(-1));
  assert.deepEqual(fixture.poRows.map((row) => row.po_remain), [15, 15]);
  assert.equal(fixture.receiptAdjustments.length, 1);
  const preview = command('po_import_preview', { import_id: 'import', receipt_cutoff: '2026-09-11T16:05:00Z' }).po_import_preview;
  assert.equal(preview.balances[0].receipt_adjustment, 0);
  assert.equal(preview.balances[0].remaining, 15);
  command('po_import_confirm', { preview_id: preview.id });
  command('receive', { order_id: order.id, lines: [{ line_id: line.id, received_quantity: 3 }], reason: 'Correction' });
  assert.equal([...fixture.poBalances.values()][0].remaining, 17);
});

test('reconciliation fixture rejects superseded reports and cutoffs outside the imported report interval', () => {
  const fixture = createHlOrderState({ poCutoff: '2026-09-10T15:00:00Z', poImports: [
    { id: 'older', status: 'pending', created_at: '2026-09-10T17:00:00Z', balances: [] },
    { id: 'newer', status: 'pending', created_at: '2026-09-11T17:00:00Z', balances: [] }
  ] });
  let sequence = 0;
  const command = (action, payload) => fixture.command({ p_command_id: `import-${++sequence}`, p_action: action, p_payload: payload, p_expected_revision: fixture.state.revision });
  assert.deepEqual(fixture.snapshot().po_imports.map((row) => row.id), ['newer']);
  assert.throws(() => command('po_import_preview', { import_id: 'older', receipt_cutoff: '2026-09-10T16:00:00Z' }), /HL_PO_IMPORT_SUPERSEDED/);
  for (const receipt_cutoff of ['2026-09-10T14:00:00Z', '2026-09-11T18:00:00Z', '2999-01-01T00:00:00Z']) {
    assert.throws(() => command('po_import_preview', { import_id: 'newer', receipt_cutoff }), /HL_PO_INVALID_CUTOFF/);
  }
  const preview = command('po_import_preview', { import_id: 'newer', receipt_cutoff: '2026-09-11T16:00:00Z' }).po_import_preview;
  command('po_import_confirm', { preview_id: preview.id });
  assert.deepEqual(fixture.snapshot().po_imports, [], 'older pending report cannot reappear after a newer reconciliation');
});

test('duplicate PO balance copies remain one shared amount and mixed null copies remain unknown', () => {
  const copies = [20, 20].map((imported) => ({ itemcode: 'SYNTH.003', size: '#3', imported, status: 'ready' }));
  const known = createHlOrderState({ poBalances: copies });
  assert.equal([...known.poBalances.values()][0].remaining, 20);
  const mixed = createHlOrderState({ poBalances: [...copies, { itemcode: 'SYNTH.003', size: '#3', imported: null }] });
  assert.equal([...mixed.poBalances.values()][0].status, 'unknown');
  assert.equal([...mixed.poBalances.values()][0].remaining, null);
  const conflict = createHlOrderState({ poBalances: [...copies, { itemcode: 'SYNTH.003', size: '#3', imported: 21 }] });
  assert.equal([...conflict.poBalances.values()][0].status, 'conflict');
});

test('PO Management totals count shared 27.F1 copies once and preserve unknown, zero and negative balances', () => {
  const context = vm.createContext({ escapeHtml: String, PO_MANAGEMENT_NUMERIC_FIELDS: new Set(['po_remain']) });
  vm.runInContext(['normalizePoManagementText', 'parsePoManagementNumber', 'formatPoManagementNumber', 'getPoManagementSharedRemaining', 'renderPoManagementCell'].map(extract).join('\n'), context);
  const copies = Array.from({ length: 3 }, (_, index) => ({ itemcode: index ? 'item.a' : ' ITEM.A ', contsize: index ? '#3' : ' #3 ', lotcode: index ? '27.f1' : ' 27.F1 ', po_remain: 100 }));
  assert.equal(context.getPoManagementSharedRemaining(copies), 100);
  assert.equal(context.getPoManagementSharedRemaining(copies.map((row) => ({ ...row, po_remain: 95 }))), 95, 'receiving five reduces the one shared balance by five');
  assert.equal(context.getPoManagementSharedRemaining([...copies, { ...copies[0], po_remain: null }]), null);
  assert.equal(context.getPoManagementSharedRemaining([...copies, { ...copies[0], po_remain: 101 }]), null);
  assert.equal(context.getPoManagementSharedRemaining(copies.map((row) => ({ ...row, po_remain: 0 }))), 0);
  assert.equal(context.getPoManagementSharedRemaining(copies.map((row) => ({ ...row, po_remain: -5 }))), -5);
  assert.equal(context.getPoManagementSharedRemaining([...copies, { ...copies[0], lotcode: '26.F1', po_remain: 999 }]), 100);
  assert.equal(context.getPoManagementSharedRemaining([...copies, { ...copies[0], lotcode: '27.S1', po_remain: null }]), 100);
  assert.equal(context.getPoManagementSharedRemaining([...copies, { ...copies[0], contsize: '#7', po_remain: 50 }]), 150);
  assert.match(context.renderPoManagementCell({ po_remain: null }, { key: 'po_remain' }), />Unknown<\/td>/);
  assert.match(context.renderPoManagementCell({ po_remain: 0 }, { key: 'po_remain' }), />0<\/td>/);
  assert.match(context.renderPoManagementCell({ po_remain: -5 }, { key: 'po_remain' }), />-5<\/td>/);
});

test('PO reconciliation shows the prior cutoff and report import time in Chicago', () => {
  const context = vm.createContext({ escapeHtml: String, hlOrderButton: () => '', hlPoImportPreview: null, hlPoImportCutoff: '', hlPoImportOffset: '',
    hlOrderStateData: { po_receipt_cutoff: '2026-09-10T15:00:00Z', po_imports: [{ id: 'new-report', status: 'pending', created_at: '2026-09-11T17:00:00Z', report_date: '2026-09-11', row_count: 3 }] } });
  vm.runInContext(['formatHlPoCutoffTime', 'buildHlPoImportsHtml'].map(extract).join('\n'), context);
  const markup = context.buildHlPoImportsHtml();
  assert.match(markup, /Previously confirmed cutoff: Sep 10, 2026, 10:00 AM CDT/);
  assert.match(markup, /Imported: Sep 11, 2026, 12:00 PM CDT/);
  assert.match(markup, /at or before the report import time/);
  assert.equal(context.formatHlPoCutoffTime('1970-01-01T00:00:00Z'), 'No previous cutoff');
});
