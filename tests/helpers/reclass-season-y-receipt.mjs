import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createInventoryReclassMovesService } from '../../services/reclassMoves.ts';
import { reclassWorksheetSource } from './reclass-worksheet-source.mjs';

function physicalRow(id, lot, year) {
  return { unique_id: id, itemcode: 'ITEM', contsize: '#3', locationcode: id, lotcode: lot, saleyear: year,
    season: 'Y', ptronhand: '10', ptravailable: '10', s_lts: '10' };
}

function project(rows) {
  const vmContext = vm.createContext({ parseAppNumber: x => x == null ? null : Number(x),
    normalizeNcrSalesYearValue: x => /^\d+$/.test(String(x)) ? Number(x) : null,
    getNcrExplicitSalesYear: row => Number(row.saleyear), getConfiguredCurrentSalesYearCode: () => 27,
    getConfiguredCurrentSeasonCode: () => 'F1', buildItemInquiryViewModel: (_, rows) => ({ rows }),
    readPendingArgosInventoryReclassMove: () => null, getArgosReclassLiveEditIdentityKey: () => 'account',
    canUseProductionLiveSync: () => true, generateArgosInventoryTransactionId: () => 'reclass-seas-y-receipt-76' });
  vm.runInContext(reclassWorksheetSource(), vmContext);
  const state = { inquiryModel: { rows, locationRows: rows.map(sourceRow => ({ unique_id: sourceRow.unique_id, sourceRow })) } };
  const payload = { rowOverlays: rows.map(r => ({ unique_id: r.unique_id, proposals: [
    { action: 'move_up', splits: [{ destinationSeason: 'U1', quantity: 2 }] }] })) };
  const command = vmContext.buildInventoryReclassMoveCommand(payload, state);
  const model = vmContext.buildOptimisticInventoryReclassMoveModel(state, command).model;
  return { command, rows: model.rows };
}

function committedMovement(command, rows, targetLots) {
  const entries = [], movements = [];
  rows.forEach((row, i) => {
    const uid = 'target-' + i;
    entries.push({ table: 'ph_master_inventory', row: { ...row, ptronhand: '8', ptravailable: '8' } },
      { table: 'ph_master_inventory', row: { ...row, unique_id: uid, season: 'U1', lotcode: targetLots[i], ptronhand: '2', ptravailable: '2' } });
    movements.push({ direction: 'move_up', quantity: 2, destinationSeason: 'U1', sourceUniqueId: row.unique_id, destinationUniqueId: uid });
  });
  return { ok: true, status: 'applied', commandId: command.commandId, requestId: 'test-reclass-request', revision: 42, rows: entries, movements };
}

export async function reclassSeasonYReceiptContract() {
  for (const rows of [[physicalRow('single', 'Y', '27')], [physicalRow('first', 'Y', '2027'), physicalRow('second', '26.Y', '2026')]]) {
    const lots = rows.map(row => row.unique_id === 'second' ? '26.U1' : '27.U1');
    const projected = project(rows);
    assert.deepEqual(Array.from(projected.rows.slice(rows.length), row => row.lotcode), lots);
    assert.equal(projected.command.moves[0].source.identity.lotcode, 'Y');
    const receipt = committedMovement(projected.command, rows, lots);
    const service = createInventoryReclassMovesService(async () => ({ ok: true, data: receipt }));
    assert.equal((await service.submit(projected.command)).movements.length, rows.length);
    receipt.rows[1].row.lotcode = '28.U1';
    await assert.rejects(service.submit(projected.command), /DESTINATION_MISMATCH/);
  }
  for (const year of ['', null, 'Q27']) assert.throws(() => project([physicalRow('unknown', 'Y', year)]), /LOT_INVALID/);
}
