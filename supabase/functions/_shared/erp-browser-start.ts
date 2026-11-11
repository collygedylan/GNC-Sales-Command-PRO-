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
