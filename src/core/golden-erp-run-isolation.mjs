import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function erpStageReceipts() {
  return [
    { currentStage: 'drive', stageIndex: 0, sourceProgress: { drive: { stage: 'publishing', percent: 95, rowsStaged: 9549, rowsPublished: 0 } } },
    { currentStage: 'cav', stageIndex: 1, sourceProgress: { drive: { stage: 'complete', percent: 100, rowsStaged: 9549, rowsPublished: 9549 } } },
    { currentStage: 'reserves', stageIndex: 2 }, { currentStage: 'soc', stageIndex: 3 },
    { currentStage: 'hl_po_parsed', stageIndex: 4 }, { currentStage: 'idle', stageIndex: 5, active: false, percent: 100 },
  ];
}

export async function invariant592() {
  const receipts = erpStageReceipts();
  const displayed = [], requested = [];
  let resolveOld;
  const context = vm.createContext({
    APP_API_FUNCTION_URL: '/app-api', MANUAL_SYNC_SCRIPT_TIMEOUT_MS: 600000, manualSyncStartGeneration: 0,
    document: { hidden: false }, getSupabaseReadIdentityScope: () => 'actor',
    firstNonEmptyValue: (...values) => values.find(value => value != null && value !== ''),
    setTimeout: callback => callback(),
    applyManualSyncStatus: status => displayed.push(status),
    postAppFunctionJson: async (_url, command, options) => {
      requested.push(command.runId);
      assert.ok(options.timeoutMs > 60000 && options.timeoutMs < 90000);
      if (command.runId === 'older') return new Promise(resolve => { resolveOld = resolve; });
      const status = { runId: command.runId, active: true, ...receipts.shift() };
      return { ok: true, status: status.active ? 'CONTINUE' : 'COMPLETE', data: { runStatus: status } };
    },
  });
  const source = readFileSync(new URL('../../assets/erp-manual-continuation.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const old = context.continueManualErpSync({ runId: 'older' });
  context.manualSyncStartGeneration++;
  const receipt = await context.continueManualErpSync({ runId: 'newer' });
  assert.equal(receipt.percent, 100);
  assert.deepEqual(displayed.map(status => status.currentStage), ['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed', 'idle']);
  assert.equal(displayed[0].sourceProgress.drive.rowsPublished, 0);
  assert.equal(displayed[1].sourceProgress.drive.rowsPublished, 9549);
  assert.deepEqual(requested, ['older', ...Array(6).fill('newer')]);
  resolveOld({ ok: true, status: 'COMPLETE', data: { runStatus: { runId: 'older', active: false } } });
  await old;
  assert.equal(displayed.length, 6);
}
