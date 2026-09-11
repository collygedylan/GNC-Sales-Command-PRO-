import assert from 'node:assert/strict';
import test from 'node:test';
import { createHlOrderState, hlSoc } from './fixtures/hl-order-state.mjs';

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
