import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReclassMoveCommand } from '../services/reclassMove.ts';
import { createInventoryReclassMovesService } from '../services/reclassMoves.ts';

const source = { uniqueId: 'source-uid', identity: {
  unique_id: 'source-uid', itemcode: 'ITEM-1', contsize: '#3', locationcode: 'C.12.001',
  lotcode: '27.F1', season: 'F1', ptronhand: '50', ptravailable: '40',
} };
const command = { commandId: 'reclass-explanation-0001', expectedRevision: 41,
  moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] };
const sourceRow = { ...source.identity, ptronhand: '30', ptravailable: '20' };
const targetRow = { ...sourceRow, unique_id: 'target-uid', lotcode: '27.U1', season: 'U1',
  ptronhand: '20', ptravailable: '20' };
const receipt = { ok: true, commandId: command.commandId, requestId: 'request-1', revision: 42,
  rows: [{ table: 'ph_master_inventory', row: sourceRow }, { table: 'ph_master_inventory', row: targetRow }],
  movements: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20,
    sourceUniqueId: source.uniqueId, destinationUniqueId: targetRow.unique_id }], status: 'applied' };

function serviceFixture() {
  const requests = [];
  const service = createInventoryReclassMovesService(async (payload, options) => {
    requests.push({ payload: structuredClone(payload), options });
    return { ok: true, data: structuredClone(receipt) };
  });
  return { service, requests };
}

test('move submission transports exact explanations and preserves the persisted retry command', async () => {
  const { service, requests } = serviceFixture();
  const input = { ...structuredClone(command), reclassExplanations: {
    'source-uid': '  Move to U1\nReviewed by field crew.  ',
    'other-edited-row': 'Priority changed in the same inquiry.',
  } };
  const original = structuredClone(input);
  assert.equal((await service.submit(input)).requestId, receipt.requestId);
  assert.equal((await service.submit(input)).requestId, receipt.requestId);
  assert.deepEqual(requests[0].payload.reclassExplanations, original.reclassExplanations);
  assert.deepEqual(requests[0].payload.moves, command.moves);
  assert.equal(requests[0].payload.receiptEncoding, 'master-null-elision-v1');
  assert.equal(requests[0].options.idempotencyKey, command.commandId);
  assert.deepEqual(requests[1], requests[0], 'safe retry retains the exact transport payload');
  assert.deepEqual(input, original, 'validation cannot change the durable local draft');
});

test('optional and empty explanations retain admin compatibility with the server boundary', async () => {
  const { service, requests } = serviceFixture();
  for (const reclassExplanations of [undefined, {}, { 'source-uid': '' }, { 'source-uid': 'x'.repeat(4000) }]) {
    await service.submit({ ...command, reclassExplanations });
    assert.deepEqual(requests.at(-1).payload.reclassExplanations, reclassExplanations);
  }
  assert.equal(Object.hasOwn(requests[0].payload, 'reclassExplanations'), false);
});

test('status recovery accepts the saved explanations while sending only status contract fields', async () => {
  const { service, requests } = serviceFixture();
  const input = { ...command, reclassExplanations: { 'source-uid': 'Ready for the next season.' } };
  const result = await service.status(command.commandId, input);
  assert.equal(result.status, 'applied');
  assert.equal(result.receipt.requestId, receipt.requestId);
  assert.deepEqual(requests[0].payload, { action: 'inventory_reclass_move', operation: 'status',
    commandId: command.commandId, receiptEncoding: 'master-null-elision-v1' });
  await assert.rejects(service.status('reclass-explanation-other', input), error =>
    /STATUS_COMMAND_MISMATCH/.test(error.message) && error.outcomeUncertain === true);
});

test('malformed explanation maps fail before any move transport', async () => {
  const { service, requests } = serviceFixture();
  const invalid = [null, [], 'reason', 1, true, { 'source-uid': null }, { 'source-uid': 1 },
    { 'source-uid': {} }, { 'source-uid': [] }, { 'source-uid': 'x'.repeat(4001) },
    { '': 'reason' }, { '  ': 'reason' }, { ['x'.repeat(1001)]: 'reason' }];
  for (const reclassExplanations of invalid) {
    await assert.rejects(service.submit({ ...command, reclassExplanations }), /EXPLANATION_INVALID/);
  }
  assert.equal(requests.length, 0);
});

test('allowing explanation metadata does not widen the strict move command allowlist', async () => {
  const { service, requests } = serviceFixture();
  const input = { ...command, reclassExplanations: { 'source-uid': 'Move approved.' } };
  for (const extra of [{ actor_id: 'forged' }, { receiptEncoding: 'forged' }, { explanations: {} }]) {
    await assert.rejects(service.submit({ ...input, ...extra }), /PAYLOAD_INVALID/);
  }
  const changed = structuredClone(input);
  changed.moves[0].source.actor_id = 'forged';
  await assert.rejects(service.submit(changed), /SOURCE_INVALID/);
  assert.equal(requests.length, 0);
  assert.throws(() => normalizeReclassMoveCommand({ action: 'inventory_reclass_move', ...input }), /PAYLOAD_INVALID/);
});

test('status recovery retains invalid saved commands as uncertain outcomes', async () => {
  const { service } = serviceFixture();
  for (const extra of [{ reclassExplanations: { 'source-uid': false } }, { actor_id: 'forged' }]) {
    await assert.rejects(service.status(command.commandId, { ...command, ...extra }), error =>
      /EXPLANATION_INVALID|PAYLOAD_INVALID/.test(error.message) && error.outcomeUncertain === true);
  }
});
