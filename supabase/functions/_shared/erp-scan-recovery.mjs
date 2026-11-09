export function createErpDriveScanFetcher(fetcher, deadline) {
  return (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname !== 'www.googleapis.com' || url.pathname !== '/drive/v3/files'
      || (init.method ?? input.method ?? 'GET') !== 'GET') return fetcher(input, init);
    const signal = init.signal ? AbortSignal.any([deadline, init.signal]) : deadline;
    return fetcher(input, { ...init, signal, referrerPolicy: 'no-referrer' });
  };
}

export function guardErpScanCheckpoint(deadline, persist) {
  let scanning = Boolean(deadline);
  return async patch => {
    if (scanning && deadline.aborted) throw new Error('ERP_DRIVE_SCAN_TIMEOUT');
    scanning = false;
    return persist(patch);
  };
}

export function cloudErpCoreCheckpoint(patch) {
  if (patch.active !== false) return patch;
  return { ...patch, active: true, status: 'CONTINUE', currentStage: 'hl_po_parsed', currentStageLabel: 'HL PO', stageIndex: 4, finishedAt: null };
}

function mergeErpSourceProgress(merged, current, delta, jsonObject) {
  if (!delta.key) return;
  const key = String(delta.key);
  const sources = jsonObject(current.sourceProgress || {});
  const previous = jsonObject(sources[key] || {});
  const changedFile = delta.fileName && previous.fileName && delta.fileName !== previous.fileName;
  const progress = { ...(changedFile ? { rowsParsed: 0, rowsStaged: 0, rowsPublished: 0, rowsTotal: null } : previous), ...delta };
  if (delta.fileName && delta.fileName === previous.fileName) {
    progress.percent = Math.max(Number(previous.percent) || 0, Number(delta.percent) || 0);
  }
  if (delta.checked === true || Number(delta.rowsStaged || 0) > Number(previous.rowsStaged || 0)
    || Number(delta.rowsPublished || 0) > Number(previous.rowsPublished || 0)) {
    merged.error = '';
    merged.errorCode = '';
    merged.sliceFailures = 0;
  }
  merged.sourceProgress = { ...sources, [key]: progress };
}

function receiptProgressStage(previous, error, published, unchanged) {
  if (error) return 'failed';
  if (previous.checked === true && previous.stage === 'complete') return 'complete';
  if (published) return 'published';
  if (unchanged) return 'up_to_date';
  return 'staging';
}

function mergeErpStageReceipt(merged, priorResults, row, jsonObject) {
  if (!row.key || !row.outcome) return;
  const duplicate = priorResults.some(prior => prior.key === row.key && prior.sourceFileName === row.sourceFileName && prior.outcome === row.outcome);
  if (duplicate) return;
  const key = String(row.key);
  const sources = jsonObject(merged.sourceProgress || {});
  const previous = jsonObject(sources[key] || {});
  const published = ['processed', 'imported'].includes(String(row.outcome)) && Number(row.rowCount) > 0;
  const unchanged = row.outcome === 'UP_TO_DATE';
  const stage = receiptProgressStage(previous, row.error, published, unchanged);
  const percent = row.error ? 0 : 70;
  const progress = { ...previous, stage, percent, updatedAt: new Date().toISOString(), error: row.error || '' };
  if (!row.error && (published || unchanged)) progress.percent = 100;
  if (row.sourceFileName) progress.fileName = row.sourceFileName;
  if (published) Object.assign(progress, { rowsPublished: Number(row.rowCount), publicationConfirmed: true, publishedFileName: row.sourceFileName });
  merged.sourceProgress = { ...sources, [key]: progress };
}

function mergeCloudErpStatus(current, patch, cursor, jsonObject) {
  const { sourceProgressDelta, stageResultsDelta, ...fields } = patch;
  const merged = { ...current, ...fields };
  if (patch.continuationCursor && cursor.secondaryFolders) {
    merged.continuationCursor = { ...jsonObject(patch.continuationCursor), secondaryFolders: cursor.secondaryFolders };
  }
  mergeErpSourceProgress(merged, current, jsonObject(sourceProgressDelta || {}), jsonObject);
  const prior = Array.isArray(current.stageResults) ? current.stageResults.map(jsonObject) : [];
  const results = Array.isArray(patch.stageResults) ? patch.stageResults.slice() : [];
  if (stageResultsDelta) results.push(stageResultsDelta);
  for (const result of results) mergeErpStageReceipt(merged, prior, jsonObject(result), jsonObject);
  if (stageResultsDelta && typeof stageResultsDelta === 'object' && !Array.isArray(stageResultsDelta)) {
    const index = prior.findIndex(row => row.key === stageResultsDelta.key && row.sourceFileName === stageResultsDelta.sourceFileName);
    if (index < 0) prior.push(stageResultsDelta);
    else prior[index] = { ...prior[index], ...stageResultsDelta };
    merged.stageResults = prior;
  }
  return merged;
}

export function createCloudErpStatusWriter(supabase, runId, workerId, status, cursor, jsonObject) {
  let current = { ...status };
  const persist = async patch => {
    const lease = await supabase.rpc('assert_erp_sync_worker_v1', { p_run_id: runId, p_worker_id: workerId });
    if (lease.error) throw new Error('ERP_SYNC_WORKER_LEASE_INVALID');
    const merged = mergeCloudErpStatus(current, patch, cursor, jsonObject);
    const { data, error } = await supabase.rpc('update_erp_sync_job_v1', { p_run_id: runId, p_status: { ...merged, _workerLeaseId: workerId } });
    if (error) throw error;
    current = data && typeof data === 'object' && jsonObject(data).runId === runId ? jsonObject(data) : merged;
  };
  return { persist, get current() { return current; } };
}

export async function mintCloudDriveAccessToken(url, secret, sign, scanDeadline) {
  if (!url || !secret) {
    throw new Error("ERP_SYNC_APPS_SCRIPT_TOKEN_BRIDGE_UNAVAILABLE");
  }
  const command = { contractVersion: "apps-script-action-v1", action: "mint_drive_token",
    payload: { type: "mint_drive_token" }, actor: { system: "erp-sync-cloud-worker" } };
  const timestamp = new Date().toISOString();
  const { deliveryJson, signature } = await sign(command, timestamp, secret);
  const response = await fetch(url, { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "apps_script_action_v1", timestamp, signature, deliveryJson }),
    signal: scanDeadline ? AbortSignal.any([scanDeadline, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), referrerPolicy: "no-referrer", redirect: "follow" });
  const body = await response.json().catch(() => ({}));
  const data = body.data && typeof body.data === "object" ? body.data : body;
  const accessToken = String(data.accessToken || data.access_token || "");
  if (!response.ok || body.ok !== true || !accessToken) throw new Error("ERP_SYNC_DRIVE_TOKEN_MINT_FAILED");
  return accessToken;
}
