type Data = Record<string, unknown>;
type Port = {
  rpc(...[]: [name: string, args: Data]): Promise<{ data: unknown; error: unknown }>;
  object(...[]: [value: unknown]): Data;
  stageOrder: string[];
  wake(...[]: [status: Data]): unknown;
  json(...[]: [value: unknown]): Response;
  fail(...[]: [message: string, status: number, extra: Data]): Response;
  databaseFailure(...[]: [message: string, error: unknown, code: string]): Response;
};

function initialBrowserErpStatus(command: Data, actor: string, claim: Data, runId: string, stageOrder: string[]): Data {
  return {
    ...claim, active: true, status: "queued", runId, commandId: command.commandId,
    actor, source: "postgresql", additionalStageOrder: [], stageOrder,
    stageIndex: 0, currentStage: "queued", currentStageLabel: "Starting",
    message: "Running cloud sync.", stageResults: [],
    continuationCursor: { stageIndex: 0, stageResults: [], attemptedByStage: {}, folderSnapshot: {} },
    fileId: null, nextOffset: null, freshFolderScan: true,
    startedAt: claim.startedAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    maxAttemptsPerStage: 1, maxRowsPerSlice: Math.min(1500, Number(command.maxRowsPerSlice) || 1500)
  };
}

async function initializeBrowserErpClaim(command: Data, actor: string, claim: Data, status: Data, port: Port) {
  const runId = String(claim.runId || claim.run_id || status.runId || status.run_id || "");
  if (!runId) return port.fail("ERP sync claim was not confirmed.", 503, { code: "ERP_SYNC_CLAIM_UNCONFIRMED" });
  const initial = initialBrowserErpStatus(command, actor, status, runId, port.stageOrder);
  const { error } = await port.rpc("update_erp_sync_job_v1", { p_run_id: runId, p_status: initial });
  if (error) return port.databaseFailure("ERP sync could not be started.", error, "ERP_SYNC_START_FAILED");
  port.wake(initial);
  return port.json({ ok: true, status: "queued", cloudRelay: true, data: { ...initial, cloudRelay: true } });
}

export async function startBrowserErpSyncCommand(command: Data, actor: string, port: Port) {
  // validateErpSyncCommand only accepts starts with force and forceRestart true.
  // SQL rechecks scan staleness under its existing job lock before superseding.
  if (command.ok !== true || command.operation !== "start") {
    return port.fail("Invalid ERP sync start request.", 400, { code: "ERP_SYNC_REQUEST_INVALID" });
  }
  const { data, error } = await port.rpc("claim_erp_sync_job_v2", {
    p_command_id: command.commandId, p_actor: actor, p_force_restart: true
  });
  if (error) return port.databaseFailure("ERP sync could not be queued.", error, "ERP_SYNC_CLAIM_FAILED");
  const claim = port.object(data);
  const status = claim.status && typeof claim.status === "object" && !Array.isArray(claim.status)
    ? port.object(claim.status) : claim;
  if (claim.claimed === true) return initializeBrowserErpClaim(command, actor, claim, status, port);
  if (status.active === true) port.wake(status);
  return port.json({ ok: true, status: status.active === true ? "CONTINUE" : status.status || "complete",
    cloudRelay: true, data: { ...status, cloudRelay: true } });
}

type StatusWriter = { readonly current: Data; persist(...[]: [Data]): Promise<void> };

export function createErpStageCheckRecorder(runId: string, workerId: string, port: Pick<Port, 'rpc' | 'object'>) {
  return async (key: string): Promise<string> => {
    const { data, error } = await port.rpc('record_erp_stage_checked_v3070',
      { p_run_id: runId, p_worker_id: workerId, p_stage_key: key });
    const result = port.object(data);
    if (error || result.ok !== true || !result.last_checked_at) throw error || new Error('ERP_STAGE_CHECK_UNCONFIRMED');
    return String(result.last_checked_at);
  };
}

export function deferredErpRetry(status: Data, cursor: Data) {
  return Number(status.retryNotBefore || 0) > Date.now() ? { result: { done: false, cursor }, status } : null;
}

export function withErpStageCheckRecording(writer: StatusWriter, record: (...[]: [string]) => Promise<string>): StatusWriter {
  return {
    get current() { return writer.current; },
    async persist(patch: Data) {
      const progress = patch.sourceProgressDelta;
      if (progress && typeof progress === 'object' && !Array.isArray(progress)) {
        const delta = progress as Data;
        if (delta.checked === true && delta.stage === 'complete') {
          const checkedAt = await record(String(delta.key || ''));
          patch = { ...patch, sourceProgressDelta: { ...delta, checkedAt, last_checked_at: checkedAt } };
        }
      }
      await writer.persist(patch);
    }
  };
}
