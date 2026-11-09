import assert from 'node:assert/strict';
import { isManualErpScanStalled } from '../services/erp-manual-continuation.js';
import { createErpDriveScanFetcher, guardErpScanCheckpoint } from '../../supabase/functions/_shared/erp-scan-recovery.mjs';

export async function invariant601() {
  const startedAt = '2026-11-09T12:00:00.000Z';
  const start = Date.parse(startedAt);
  const status = { active: true, startedAt, currentStage: 'scanning' };
  assert.equal(isManualErpScanStalled(status, start + 24999), false);
  assert.equal(isManualErpScanStalled(status, start + 25000), true);
  assert.equal(isManualErpScanStalled({ ...status, recoveryClaimedAt: new Date(start + 25000).toISOString() }, start + 26000), false);
  const publishing = { ...status, currentStage: 'drive', sourceProgress: { drive: { stage: 'publishing', fileName: 'staged.xlsx' } } };
  assert.equal(isManualErpScanStalled(publishing, start + 26000), false);
  assert.equal(isManualErpScanStalled({ ...publishing, recoveryDue: true }, start + 90000), true);

  const controller = new AbortController();
  const fetcher = createErpDriveScanFetcher((_, init) => init, controller.signal);
  const files = 'https://www.googleapis.com/drive/v3/files';
  const list = fetcher(files);
  assert.equal(list.referrerPolicy, 'no-referrer');
  assert.equal(fetcher(`${files}/file-id?alt=media`).signal, undefined);
  assert.equal(fetcher(files, { method: 'POST' }).signal, undefined);
  const writes = [];
  const persist = patch => writes.push(patch);
  const guarded = guardErpScanCheckpoint(controller.signal, persist);
  const timedOut = guardErpScanCheckpoint(controller.signal, persist);
  const checkpoint = { continuationCursor: { stageIndex: 0, fileContinuation: { state: { stageId: 'existing-stage' } } } };
  await guarded(checkpoint);
  controller.abort();
  assert.equal(list.signal.aborted, true);
  await assert.rejects(() => timedOut({ currentStage: 'cav' }), /ERP_DRIVE_SCAN_TIMEOUT/);
  await guarded({ currentStage: 'drive' });
  assert.deepEqual(writes, [checkpoint, { currentStage: 'drive' }]);
}
