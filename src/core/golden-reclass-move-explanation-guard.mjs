import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInventoryReclassMovesService } from '../../services/reclassMoves.ts';

const readRepository = file => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
const source = { uniqueId: 'source-uid', identity: {
  unique_id: 'source-uid', itemcode: 'ITEM-1', contsize: '#3', locationcode: 'C.12.001',
  lotcode: '27.F1', season: 'F1', ptronhand: '50', ptravailable: '40'
} };
const command = { commandId: 'golden-reclass-explanation-0001', expectedRevision: 41,
  moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20 }] }] };

function appliedReceipt() {
  const sourceRow = { ...source.identity, ptronhand: '30', ptravailable: '20' };
  const targetRow = { ...sourceRow, unique_id: 'target-uid', lotcode: '27.U1', season: 'U1',
    ptronhand: '20', ptravailable: '20' };
  return { ok: true, commandId: command.commandId, requestId: 'request-1', revision: 42,
    status: 'applied', rows: [{ table: 'ph_master_inventory', row: sourceRow },
      { table: 'ph_master_inventory', row: targetRow }],
    movements: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 20,
      sourceUniqueId: source.uniqueId, destinationUniqueId: targetRow.unique_id }] };
}

export async function invariant555({ read = readRepository } = {}) {
  const requests = [];
  const service = createInventoryReclassMovesService(async payload => {
    requests.push(structuredClone(payload));
    return { ok: true, data: appliedReceipt() };
  });
  const reclassExplanations = { 'source-uid': 'Move approved for U1.' };
  await service.submit({ ...command, reclassExplanations });
  assert.deepEqual(requests[0].reclassExplanations, reclassExplanations);
  await assert.rejects(service.submit({ ...command, reclassExplanations, actor_id: 'forged' }), /PAYLOAD_INVALID/);
  assert.equal(requests.length, 1, 'invalid metadata cannot reach transport');
  assert.match(read('.agents/skills/agdata-views-workflows/SKILL.md'), /Invariant 555/);
}
