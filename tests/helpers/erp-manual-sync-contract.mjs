import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { validateErpSyncCommand } from '../../supabase/functions/_shared/erp-sync.mjs';
import { finishStageContinuation } from '../../supabase/functions/_shared/erp-stage-publication.mjs';
import { readComposedAppSource } from '../../scripts/composed-app-source.mjs';
import { createDashboardMetadataFixture } from '../../src/core/erp-home-metadata-fixture.mjs';

function startFixture(claim) {
  const code = readFileSync(new URL('../../supabase/functions/_shared/erp-browser-start.ts', import.meta.url), 'utf8');
  const context = vm.createContext({ exports: {}, Date, Response });
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  const calls = [], wakes = [];
  const port = { calls, wakes, stageOrder: ['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed'],
    rpc: async (name, args) => { calls.push({ name, args }); return { data: claim }; },
    object: value => value || {}, wake: value => wakes.push(value), json: value => value,
    fail: (_message, status, extra) => ({ status, ...extra }),
    databaseFailure: (_message, _error, code) => ({ code }) };
  const command = validateErpSyncCommand({ action: 'erp_sync', operation: 'start', force: true, forceRestart: true, maxAttemptsPerStage: 1,
    commandId: '3f053fb9-743e-4f84-8c03-870ab3cc841a' });
  return { port, command, start: context.exports.startBrowserErpSyncCommand };
}

export async function assertManualErpRestart() {
  const fresh = startFixture({ claimed: true, active: true, runId: 'new' });
  assert.equal((await fresh.start(fresh.command, 'actor', fresh.port)).status, 'queued');
  assert.equal(fresh.port.calls[0].args.p_force_restart, true);
  assert.equal(fresh.port.calls[0].args.p_actor, 'actor');
  assert.deepEqual(Object.keys(fresh.port.calls[1].args.p_status.continuationCursor.folderSnapshot), []);
  assert.equal(fresh.port.wakes.length, 1);
  const existing = startFixture({ claimed: false, active: true, runId: 'saved', stageIndex: 3 });
  assert.equal((await existing.start(existing.command, 'actor', existing.port)).data.stageIndex, 3);
  assert.equal(existing.port.calls.length, 1);
  assert.equal(existing.port.wakes[0].runId, 'saved');
  const invalid = startFixture({});
  assert.equal((await invalid.start({}, 'actor', invalid.port)).status, 400);
  assert.equal(invalid.port.calls.length, 0);
  const failed = startFixture({ claimed: true, active: true, runId: 'new' });
  failed.port.rpc = async name => name === 'claim_erp_sync_job_v2'
    ? { data: { claimed: true, runId: 'new' } } : { error: { code: '57014' } };
  assert.equal((await failed.start(failed.command, 'actor', failed.port)).code, 'ERP_SYNC_START_FAILED');
  assert.equal(failed.port.wakes.length, 0);
}

export async function assertManualErpMetadata() {
  const { ctx } = createDashboardMetadataFixture(readComposedAppSource().replaceAll('\r\n', '\n'));
  ctx.coordinatorOwnsMetadata = true;
  assert.equal(await ctx.refreshDashboardSyncMetadata(true), true);
  assert.equal(ctx.metadataState().summaries[0].files[0], 'current-drive.xlsx');
  let resolve;
  ctx.supabaseRpc = () => new Promise(done => { resolve = done; });
  const pending = ctx.refreshDashboardSyncMetadata(true);
  ctx.owner = 'different-account';
  resolve({ contractVersion: 1, sources: [] });
  assert.equal(await pending, false);
  assert.equal(ctx.metadataState().pending, null);
}

export async function assertPreparedIsNotPublished() {
  const statuses = [], moves = [];
  const result = await finishStageContinuation({
    next: { stageId: 'saved', phase: 'finalize', processedRows: 2501, expectedRows: 2501 },
    dataset: 'soc', stageKey: 'soc', file: { name: 'today.xlsx' }, maxRows: 50000,
    supabase: { rpc: async () => ({ data: { ok: true, busy: true, preparedRows: 2000 } }) },
    status: async value => statuses.push(value), moveProcessed: async () => moves.push(true)
  });
  assert.equal(result.done, false);
  assert.equal(statuses.at(-1).sourceProgressDelta.rowsPrepared, 2000);
  assert.equal(statuses.at(-1).sourceProgressDelta.rowsPublished, 0);
  assert.equal(statuses.at(-1).sourceProgressDelta.publicationConfirmed, undefined);
  assert.deepEqual(moves, []);
}

export async function assertAfternoonErpSources() {
 const {erpFilenameTimestamp,compareErpFiles,normalizeErpRows}=await import('../../supabase/functions/_shared/erp-sync.mjs');
 const afternoon={name:'DriveAroundMC-10-16391420261105043914.xlsx',modifiedTime:'2026-11-06T01:00:00Z'};
 const midday={name:'DriveAroundMC-10-12390520261105123905.xlsx',modifiedTime:'2026-11-06T02:00:00Z'};
 assert.equal(erpFilenameTimestamp(afternoon.name),'20261105163914');assert.deepEqual([midday,afternoon].sort(compareErpFiles),[afternoon,midday]);
 const base={itemcode:'PLANT',warehouseid:'10',planstart:'44573',tripnumber:'T03818'};
 const rows=await normalizeErpRows([{...base,dock:'Dock 34'},{...base,dock:''},{...base,dock:'T03818'},{...base,warehouseid:'20',dock:'Dock 34'}],'soc',['unique_id','itemcode','warehouseid','dock','dock_num','planstart','tripnumber']);
 assert.equal(rows.length,1);assert.equal(rows[0].dock,'Dock 34');assert.equal(rows[0].tripnumber,'T03818');
}
