type Data = Record<string, unknown>;
type RecoveryPort = {
  rpc(...[]: [name: string, args: Data]): Promise<{ error: unknown }>;
  object(...[]: [value: unknown]): Data;
  fail(...[]: [runId: string, workerId: string, error: unknown, message: string]): Promise<void>;
};

function failureMessage(error: unknown): string {
  return String((error as { message?: unknown })?.message || 'ERP_SYNC_WORKER_FAILED').slice(0, 200);
}

function finalizeCheckpoint(current: Data, object: RecoveryPort['object']): boolean {
  const cursor = object(current.continuationCursor || {});
  return object(object(cursor.fileContinuation || {}).state || {}).phase === 'finalize';
}

export async function recoverErpCloudSliceFailure(port: RecoveryPort, runId: string, workerId: string,
  current: Data, maxRowsPerSlice: number | undefined, error: unknown): Promise<never> {
  const message = failureMessage(error);
  const lease = await port.rpc('assert_erp_sync_worker_v1', { p_run_id: runId, p_worker_id: workerId });
  if (lease.error) throw error;
  const failures = Number(current.sliceFailures || 0) + 1;
  // A saved publication owns its bounded recovery budget. Replaying its terminal
  // exhaustion as smaller worksheet slices cannot advance the sealed stage.
  if (failures > 6 || /^ERP_PUBLICATION_(?:RETRY|RECOVERY)_EXHAUSTED$/.test(message)) {
    await port.fail(runId, workerId, error, message);
    throw error;
  }
  const finalizeRetry = finalizeCheckpoint(current, port.object)
    && /55P03|57014|40P01|40001|timeout|timed out|fetch|network|502|503|504|546/i
      .test(`${String((error as { code?: unknown })?.code || '')} ${message}`);
  const priorCap = Number(maxRowsPerSlice || current.maxRowsPerSlice) || 2500;
  await port.rpc('update_erp_sync_job_v1', { p_run_id: runId, p_status: {
    ...current, _workerLeaseId: workerId, active: true, status: 'CONTINUE', sliceFailures: failures,
    retryNotBefore: Date.now() + Math.min(60000, 5000 * 2 ** (failures - 1)),
    maxRowsPerSlice: priorCap >= 2500 ? 1250 : 600,
    error: finalizeRetry ? '' : message, errorCode: finalizeRetry ? '' : 'ERP_SYNC_SLICE_RETRY',
    message: finalizeRetry ? 'Retrying saved publication.' : 'Retrying the current import slice with a smaller batch.'
  } });
  throw error;
}
