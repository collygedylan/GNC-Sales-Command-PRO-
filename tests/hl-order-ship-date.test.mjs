import assert from 'node:assert/strict';
import test from 'node:test';
import { createHlOrderState, hlSoc } from './fixtures/hl-order-state.mjs';
import { inventoryReadFixture } from './fixtures/inventory-list-read-fixture.mjs';

test('PO inventory fixture scopes item and size before deterministic paging', () => {
  const rows = [
    { unique_id: 'a', itemcode: 'PO.TEST', contsize: '#7', ptravailable: '99' },
    { unique_id: 'b', itemcode: 'OTHER', contsize: '#3', ptravailable: '99' },
    { unique_id: 'c', itemcode: 'PO.TEST', contsize: '#3', ptravailable: '0' },
    { unique_id: 'd', itemcode: 'PO.TEST', contsize: '#3', ptravailable: null },
  ];
  const scope = 'select=unique_id,ptravailable&itemcode=eq.PO.TEST&contsize=eq.%233&order=unique_id.asc&limit=1';
  assert.deepEqual(inventoryReadFixture.read(rows, scope).rows, [{ unique_id: 'c', ptravailable: '0' }]);
  assert.deepEqual(inventoryReadFixture.read(rows, scope + '&offset=1').rows, [{ unique_id: 'd', ptravailable: null }]);
  assert.throws(() => inventoryReadFixture.read(rows, 'itemcode=like.*'), /unsupported exact filter/);
});

let commandSequence = 0;
const command = (fixture, action, payload = {}) => fixture.command({
  p_command_id: `20000000-0000-4000-8000-${String(++commandSequence).padStart(12, '0')}`,
  p_action: action,
  p_payload: payload,
  p_expected_revision: fixture.state.revision
});

test('a pending same-date HL batch blocks a second preview, while another ship date remains separate', () => {
  const fixture = createHlOrderState({ rows: [hlSoc('first'), hlSoc('same-date'), hlSoc('other-date', { planstartdate: '2026-09-16' })] });
  command(fixture, 'draft_save', { rows: [{ source_id: 'first', quantity: 4 }] });
  const firstPreview = command(fixture, 'preview', { ship_date: '2026-09-15' }).preview;
  command(fixture, 'submit', { preview_id: firstPreview.id });
  fixture.deliver('delivery_unknown');
  command(fixture, 'draft_save', { rows: [{ source_id: 'same-date', quantity: 3 }] });
  assert.throws(() => command(fixture, 'preview', { ship_date: '2026-09-15' }), /HL_ORDER_DELIVERY_UNKNOWN/);
  command(fixture, 'draft_save', { rows: [{ source_id: 'other-date', quantity: 2 }] });
  const other = command(fixture, 'preview', { ship_date: '2026-09-16' }).preview;
  assert.equal(other.report.ship_date, '2026-09-16');
  assert.equal(other.report.kind, 'submission');
});

test('HL fixture saves original date text and canonical Chicago dates, reserving undated rows for review', () => {
  const raw = 'Tue Sep 15 2026 10:00:00 GMT-0500 (Central Daylight Time)';
  const fixture = createHlOrderState({ rows: [hlSoc('raw', { planstartdate: raw }), hlSoc('utc', { planstartdate: '2026-09-16T01:00:00Z' }), hlSoc('missing', { planstartdate: '' })] });
  command(fixture, 'draft_save', { rows: ['raw', 'utc', 'missing'].map((source_id) => ({ source_id, quantity: 2 })) });
  assert.deepEqual(fixture.state.draft.map((row) => row.ship_date), ['2026-09-15', '2026-09-15', null]);
  assert.equal(fixture.state.draft[0].source.planstartdate, raw);
  const preview = command(fixture, 'preview', { ship_date: '2026-09-15' }).preview;
  assert.deepEqual(preview.report.lines.map((line) => line.source_id), ['raw', 'utc']);
});
