import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeErpRows, parseErpCsv, parseErpXlsx, shouldIgnoreErpFile } from '../supabase/functions/_shared/erp-sync.mjs';

export const ERP_LOCAL_STAGES = Object.freeze([
  { key: 'drive', datasetKey: 'drive_around', source: 'DriveAround/DriveAround', processed: 'DriveAround/Processed' },
  { key: 'cav', datasetKey: 'cav', source: 'Custom AV/cav PENDING', processed: 'Custom AV/cav PROCESSED' },
  { key: 'reserves', datasetKey: 'reserves', source: 'Reserves 10Reserve/Unprocessed Reserves', processed: 'Reserves 10Reserve/Processed Reserves' },
  { key: 'soc', datasetKey: 'soc', source: 'SOC/SOC', processed: 'SOC/Porcessed SOC' },
  { key: 'hl_po_parsed', datasetKey: 'hl_po_parsed', source: 'PO Reports/HL/27F1 PENDING HL', processed: 'PO Reports/HL/27F1 PROCESSED HL' },
]);
const PROJECT_REF = 'kzrnyjsosryejjejliii';
const CHUNK_SIZE = 1000;
const LOG_MAX_BYTES = 1024 * 1024;
const IDLE_POLL_MS = 5000;
const QUEUED_POLL_MS = 2000;

export function localWorkerConfig(env = process.env, basePath = 'G:\\My Drive\\GNC') {
  const workerKey = String(env.ERP_SYNC_LOCAL_WORKER_KEY || '').trim();
  const anonKey = String(env.SUPABASE_ANON_KEY || env.GNC_SUPABASE_ANON_KEY || '').trim();
  if (!workerKey || !anonKey) throw new Error('ERP_LOCAL_WORKER_AUTH_REQUIRED');
  return {
    apiUrl: `https://${PROJECT_REF}.supabase.co/functions/v1/app-api`,
    workerKey,
    anonKey,
    basePath,
    logPath: path.join(basePath, 'AgData', 'Release Evidence', 'Local Validation', 'erp-sync-worker.log'),
  };
}

function safeErrorCode(value) {
  const code = String(value?.code || value?.message || value || 'ERP_LOCAL_WORKER_FAILED');
  return /^[A-Z0-9_:-]{1,100}$/.test(code) ? code : 'ERP_LOCAL_WORKER_FAILED';
}

export function createWorkerApi({ apiUrl, workerKey, anonKey, fetcher = fetch }) {
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/functions\/v1\/app-api$/.test(apiUrl || '') || !workerKey || !anonKey) {
    throw new Error('ERP_LOCAL_API_CONFIG_INVALID');
  }
  return async (operation, fields = {}) => {
    const payload = operation === 'status'
      ? { operation }
      : operation === 'claim_worker'
      ? { operation, ...fields }
      : { operation, ...fields };
    const response = await fetcher(apiUrl, {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: anonKey,
        authorization: `Bearer ${workerKey}` }, body: JSON.stringify({ action: 'erp_sync_worker', payload }),
      signal: AbortSignal.timeout(operation === 'commit' ? 130000 : 30000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok !== true) throw new Error(safeErrorCode(result?.error?.code || result?.code || `ERP_LOCAL_API_${response.status}`));
    return result.data;
  };
}

function sourceFiles(directory, fsApi) {
  if (!fsApi.existsSync(directory)) throw new Error('ERP_LOCAL_SOURCE_DIRECTORY_MISSING');
  return fsApi.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && !entry.isSymbolicLink() && !shouldIgnoreErpFile(entry.name) && /\.(?:xlsx|csv)$/i.test(entry.name))
    .map(entry => ({ name: entry.name, filePath: path.join(directory, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

function sourceIdentity(stageKey, relativePath) {
  return `localfs-${crypto.createHash('sha256').update(`${stageKey}\0${relativePath.toLowerCase()}`).digest('hex')}`;
}

function appendBoundedLog(logPath, entry, fsApi) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`;
  fsApi.mkdirSync(path.dirname(logPath), { recursive: true });
  if (fsApi.existsSync(logPath)) {
    const stat = fsApi.lstatSync(logPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('ERP_LOCAL_LOG_PATH_INVALID');
    if (stat.size + Buffer.byteLength(line) > LOG_MAX_BYTES) fsApi.writeFileSync(logPath, '');
  }
  fsApi.appendFileSync(logPath, line, 'utf8');
}

export async function runClaimedLocalJob({ api, runId, workerId, basePath, stagePaths = ERP_LOCAL_STAGES,
  fsApi = fs, fetcher = fetch, log = () => {} }) {
  let status = { active: true, status: 'running', runId, workerId, stageOrder: stagePaths.map(stage => stage.key),
    stageIndex: 0, stageResults: [] };
  const persist = async patch => {
    status = { ...status, ...patch, stageResults: patch.stageResults || status.stageResults };
    await api('update_status', { runId, workerId, args: { p_status: status } });
  };
  const errors = [];
  const setResult = result => {
    const existingIndex = status.stageResults.findIndex(row => row.key === result.key && row.sourceFileName === result.sourceFileName);
    if (existingIndex < 0) status.stageResults.push(result);
    else status.stageResults[existingIndex] = { ...status.stageResults[existingIndex], ...result };
  };

  for (let index = 0; index < stagePaths.length; index += 1) {
    const stage = stagePaths[index];
    const stageStarted = performance.now();
    const sourceDir = path.join(basePath, stage.source);
    const processedDir = path.join(basePath, stage.processed);
    await persist({ currentStage: stage.key, currentStageLabel: stage.key, stageIndex: index });
    let files;
    try { files = sourceFiles(sourceDir, fsApi); }
    catch (error) {
      const result = { key: stage.key, outcome: 'failed', processedFiles: 0, error: safeErrorCode(error) };
      setResult(result); errors.push(result.error);
      log({ event: 'stage_complete', stage: stage.key, outcome: 'failed', processedFiles: 0,
        elapsedMs: Math.round(performance.now() - stageStarted), error: result.error });
      continue;
    }
    if (!files.length) {
      const elapsedMs = Math.round(performance.now() - stageStarted);
      setResult({ key: stage.key, outcome: 'UP_TO_DATE', sourceFileName: '', processedFiles: 0, elapsedMs });
      log({ event: 'stage_complete', stage: stage.key, outcome: 'UP_TO_DATE', processedFiles: 0, elapsedMs });
      continue;
    }
    if (stage.key === 'hl_po_parsed') {
      const result = { key: stage.key, outcome: 'requires_template', sourceFileName: files[0].name, processedFiles: 0,
        error: 'HL_PO_WORKBOOK_CONTRACT_UNCONFIRMED' };
      setResult(result); errors.push(result.error);
      log({ event: 'hl_workbook_held', sourceFileName: files[0].name, count: files.length });
      log({ event: 'stage_complete', stage: stage.key, outcome: 'requires_template', processedFiles: 0,
        elapsedMs: Math.round(performance.now() - stageStarted) });
      continue;
    }

    const stageResultOffset = status.stageResults.length;
    for (const file of files) {
      const relative = path.relative(basePath, file.filePath).replaceAll('\\', '/');
      const fileId = sourceIdentity(stage.key, relative);
      try {
        const stat = fsApi.statSync(file.filePath);
        if (!stat.isFile()) throw new Error('ERP_LOCAL_SOURCE_NOT_FILE');
        const bytes = fsApi.readFileSync(file.filePath);
        const sourceHash = crypto.createHash('sha256').update(bytes).digest('hex');
        const modifiedAt = stat.mtime.toISOString();
        const meta = { file_id: fileId, file_name: file.name, modified_at: modifiedAt, content_hash: sourceHash };
        const checked = await api('check_file', { runId, workerId, args: { p_dataset_key: stage.datasetKey,
          p_file_id: fileId, p_file_name: file.name, p_modified_at: modifiedAt, p_content_hash: sourceHash } });
        if (checked?.skip === true) {
          fsApi.mkdirSync(processedDir, { recursive: true });
          const target = path.join(processedDir, file.name);
          if (fsApi.existsSync(target)) throw new Error('ERP_LOCAL_PROCESSED_TARGET_EXISTS');
          fsApi.renameSync(file.filePath, target);
          setResult({ key: stage.key, outcome: 'UP_TO_DATE', sourceFileName: file.name, processedFiles: 1 });
          continue;
        }
        const rawRows = /\.csv$/i.test(file.name)
          ? parseErpCsv(new TextDecoder('utf-8').decode(bytes)) : await parseErpXlsx(bytes);
        const columnResult = await api('columns', { runId, workerId, args: { p_dataset_key: stage.datasetKey } });
        const columns = Array.isArray(columnResult) ? columnResult : columnResult?.columns;
        if (!Array.isArray(columns) || !columns.length) throw new Error('ERP_COLUMNS_UNAVAILABLE');
        const rows = await normalizeErpRows(rawRows, stage.datasetKey, columns);
        const begun = await api('begin', { runId, workerId, args: { p_dataset_key: stage.datasetKey,
          p_file_meta: meta, p_expected_rows: rows.length } });
        if (begun?.skipped === true) {
          fsApi.mkdirSync(processedDir, { recursive: true });
          const target = path.join(processedDir, file.name);
          if (fsApi.existsSync(target)) throw new Error('ERP_LOCAL_PROCESSED_TARGET_EXISTS');
          fsApi.renameSync(file.filePath, target);
          setResult({ key: stage.key, outcome: 'UP_TO_DATE', sourceFileName: file.name, processedFiles: 1 });
          continue;
        }
        const importId = String(begun?.stage_id || begun?.stageId || '');
        if (!importId || Number(begun.expected_rows) !== rows.length) throw new Error('ERP_STAGE_BEGIN_UNCONFIRMED');
        for (let offset = Number(begun.staged_rows) || 0, chunkIndex = 0; offset < rows.length; offset += CHUNK_SIZE, chunkIndex += 1) {
          const batch = rows.slice(offset, offset + CHUNK_SIZE);
          const appended = await api('append', { runId, workerId, args: { p_stage_id: importId,
            p_start_row: offset, p_rows: batch } });
          const accepted = Number(appended?.staged_rows);
          if (accepted !== offset + batch.length) throw new Error('ERP_STAGE_BATCH_UNCONFIRMED');
          setResult({ key: stage.key, outcome: 'staging', sourceFileName: file.name, processedFiles: 0,
            stagedRows: accepted, expectedRows: rows.length, chunkIndex });
          await persist({ currentStage: stage.key, stageIndex: index, stageResults: status.stageResults });
        }
        const committed = await api('commit', { runId, workerId, args: { p_stage_id: importId } });
        if (committed?.ok !== true && committed?.committed !== true) throw new Error('ERP_STAGE_COMMIT_UNCONFIRMED');
        fsApi.mkdirSync(processedDir, { recursive: true });
        const target = path.join(processedDir, file.name);
        if (fsApi.existsSync(target)) throw new Error('ERP_LOCAL_PROCESSED_TARGET_EXISTS');
        fsApi.renameSync(file.filePath, target);
        setResult({ key: stage.key, outcome: 'processed', sourceFileName: file.name, processedFiles: 1, rowCount: rows.length });
      } catch (error) {
        const code = safeErrorCode(error);
        errors.push(code);
        setResult({ key: stage.key, outcome: 'failed', sourceFileName: file.name, processedFiles: 0, error: code });
        log({ event: 'source_retained', stage: stage.key, sourceFileName: file.name, error: code });
      }
    }
    const elapsedMs = Math.round(performance.now() - stageStarted);
    const stageRows = status.stageResults.slice(stageResultOffset);
    log({ event: 'stage_complete', stage: stage.key,
      processedFiles: stageRows.reduce((sum, row) => sum + Number(row.processedFiles || 0), 0), elapsedMs,
      files: stageRows.map(({ sourceFileName, outcome, rowCount }) => ({ sourceFileName, outcome, ...(rowCount ? { rowCount } : {}) })) });
  }

  const blocked = status.stageResults.some(result => result.outcome === 'requires_template');
  const failed = errors.length > 0;
  const terminalStatus = blocked ? 'blocked' : failed ? 'failed' : 'complete';
  await persist({ active: false, status: terminalStatus, currentStage: 'idle', currentStageLabel: 'Idle',
    stageIndex: stagePaths.length, stageResults: status.stageResults, finishedAt: new Date().toISOString(),
    error: failed ? errors[0] : '', message: blocked ? 'HL workbook is held for contract review.' : failed ? 'One or more local ERP files were retained.' : 'Local ERP sync completed.' });
  return { status: terminalStatus, stageResults: status.stageResults };
}

export async function pollLocalWorkerOnce({ api, basePath, stagePaths = ERP_LOCAL_STAGES, workerId = crypto.randomUUID(),
  attemptedRuns = new Set(), fsApi = fs, fetcher = fetch, log = () => {} }) {
  const current = await api('status');
  const runId = String(current?.runId || '');
  if (current?.active !== true || String(current?.status || '').toLowerCase() !== 'queued' || !runId || attemptedRuns.has(runId)) {
    return { outcome: 'idle', status: current };
  }
  attemptedRuns.add(runId);
  if (attemptedRuns.size > 128) attemptedRuns.delete(attemptedRuns.values().next().value);
  const claim = await api('claim_worker', { runId, workerId });
  const claimData = claim?.status && typeof claim.status === 'object' ? claim.status : claim;
  if (claim?.claimed !== true) return { outcome: 'not_claimed', runId };
  log({ event: 'claimed', runId });
  const result = await runClaimedLocalJob({ api, runId, workerId, basePath, stagePaths, fsApi, fetcher, log });
  return { outcome: 'processed', runId, ...result, claimStatus: claimData };
}

export async function runLocalWorkerLoop({ api, config, stagePaths = ERP_LOCAL_STAGES, fsApi = fs, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), logPath = config.logPath }) {
  const attemptedRuns = new Set();
  const log = entry => appendBoundedLog(logPath, entry, fsApi);
  while (true) {
    try {
      const result = await pollLocalWorkerOnce({ api, basePath: config.basePath, stagePaths, attemptedRuns, fsApi, log });
      if (result.outcome !== 'idle') log({ event: result.outcome, runId: result.runId || '' });
      await sleep(result.outcome === 'idle' && result.status?.status === 'queued' ? QUEUED_POLL_MS : IDLE_POLL_MS);
    } catch (error) {
      log({ event: 'poll_error', error: safeErrorCode(error) });
      await sleep(IDLE_POLL_MS);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = localWorkerConfig();
    const api = createWorkerApi(config);
    await runLocalWorkerLoop({ api, config });
  } catch (error) {
    process.stderr.write(`${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  }
}
