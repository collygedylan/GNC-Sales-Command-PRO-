import { readErpStagePublication } from './erp-publication-recovery.mjs';
import { compactErpPublicationState } from './erp-publication-checkpoint.mjs';

export function isRetryableErpFinalizeError(error) {
  return ['55P03', '57014', '40P01', '40001'].includes(String(error?.code || ''))
    || /AbortError|TimeoutError/.test(String(error?.name || ''))
    || /lock timeout|statement timeout|signal timed out|fetch failed|network|502|503|504|546/i.test(String(error?.message || error || ''));
}

export async function boundedErpPublicationRpc(supabase, name, args, deadlineMs = 12000) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = Object.assign(new Error('ERP_PUBLICATION_RPC_TIMEOUT'), { name: 'TimeoutError' });
      controller.abort(error);
      reject(error);
    }, deadlineMs);
  });
  try {
    const request = supabase.rpc(name, args);
    const pending = typeof request.abortSignal === 'function' ? request.abortSignal(controller.signal) : request;
    return await Promise.race([pending, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function isConfirmedPendingStageReceipt(receipt, dataset, fileName, expectedRows) {
  const relation = { drive_around: 'ph_master_inventory', cav: 'ph_cav_import',
    reserves: 'ph_reserves', soc: 'ph_soc_master' }[dataset];
  return Boolean(relation && receipt?.ok === true && receipt.skip !== true
    && receipt.stage_commit === 'canonical_atomic_import' && receipt.file_name === fileName
    && receipt.dataset_key === relation && Number.isSafeInteger(expectedRows) && expectedRows > 0
    && Number.isSafeInteger(receipt.staged_rows) && receipt.staged_rows === expectedRows
    && Number.isSafeInteger(receipt.source_rows) && receipt.source_rows > 0);
}

function publicationProgress(key, fileName, rows, published) {
  return {
    key, fileName, rowsParsed: rows, rowsStaged: rows, rowsTotal: rows,
    rowsPublished: published ? rows : 0, stage: published ? 'published' : 'publishing',
    percent: published ? 100 : 95, updatedAt: new Date().toISOString(),
    ...(published ? { publishedFileName: fileName, publicationConfirmed: true } : {})
  };
}

async function sealStage(supabase, state, maxRows) {
  if (state.processedRows < 1 || state.processedRows > maxRows) throw new Error('ERP_ROWS_INVALID');
  const { data, error } = await boundedErpPublicationRpc(supabase, 'fast_seal_erp_stage_v1', {
    p_stage_id: state.stageId, p_expected_rows: state.processedRows
  });
  if (error || data?.ok !== true) throw error || new Error('ERP_STAGE_SEAL_UNCONFIRMED');
  return { ...state, expectedRows: state.processedRows, expectedRowsPending: false };
}

async function yieldPreparedPublication(data, finalized, stageKey, fileName, status) {
  const retryNotBefore = Date.now() + Math.max(2500, Math.min(15000, Number(data.retryAfterMs) || 0));
  await status({ retryNotBefore, sourceProgressDelta: {
    ...publicationProgress(stageKey, fileName, finalized.expectedRows, false),
    rowsPrepared: Math.max(0, Math.min(finalized.expectedRows, Number(data.preparedRows) || 0)),
    publicationProgressAt: finalized.publicationProgressAt,
    publicationRecoveryAt: finalized.publicationRecoveryAt
  } });
  return { done: false, state: { ...finalized, phase: 'finalize', retryNotBefore } };
}

async function retryPublication(error, state, status) {
  if (!isRetryableErpFinalizeError(error)) throw error;
  const finalizeAttempts = (Number(state.finalizeAttempts) || 0) + 1;
  if (finalizeAttempts > 6) {
    throw Object.assign(new Error('ERP_PUBLICATION_RETRY_EXHAUSTED'), { code: 'ERP_PUBLICATION_RETRY_EXHAUSTED' });
  }
  const retryNotBefore = Date.now() + Math.min(60000, 5000 * 2 ** (finalizeAttempts - 1));
  await status({
    active: true, status: 'CONTINUE', retryNotBefore, error: '', errorCode: 'ERP_PUBLICATION_RETRY',
    message: 'Publication is waiting for the database; staged rows are saved.'
  });
  return { done: false, state: { ...state, phase: 'finalize', finalizeAttempts, retryNotBefore } };
}

export async function finishStageContinuation({
  supabase, fetcher, token, file, dataset, stageKey, parentId, processedId, next, status, moveProcessed, maxRows, requireReceipt = false
}) {
  let finalized = compactErpPublicationState(next);
  let receipt;
  if (Number(finalized.retryNotBefore || 0) > Date.now()) return { done: false, state: finalized };
  try {
    if (finalized.expectedRowsPending) {
      finalized = await sealStage(supabase, finalized, maxRows);
      await status({ sourceProgressDelta: publicationProgress(stageKey, file.name, finalized.expectedRows, false) });
    }
    if (finalized.processedRows !== finalized.expectedRows) throw new Error('ERP_STAGE_ROW_COUNT_MISMATCH');
    finalized = compactErpPublicationState({ ...finalized, phase: 'finalize' });
    const publication = await readErpStagePublication(supabase, finalized, boundedErpPublicationRpc);
    finalized = publication.state;
    const { data, error } = publication;
    if (!error && data?.busy === true) return await yieldPreparedPublication(data, finalized, stageKey, file.name, status);
    if (error || data?.ok !== true || data?.skip === true || Number(data?.source_rows ?? 1) < 1 || finalized.expectedRows < 1) {
      throw error || new Error('ERP_STAGE_COMMIT_UNCONFIRMED');
    }
    if (requireReceipt && !isConfirmedPendingStageReceipt(data, dataset, file.name, finalized.expectedRows)) {
      throw new Error('ERP_STAGE_COMMIT_UNCONFIRMED');
    }
    receipt = data;
    await status({ sourceProgressDelta: publicationProgress(stageKey, file.name, finalized.expectedRows, true) });
  } catch (error) {
    return retryPublication(error, finalized, status);
  }
  try {
    await moveProcessed(fetcher, token, { ...file, publishedContentHash: finalized.contentHash }, parentId, processedId);
    return { done: true, result: { key: dataset, outcome: 'processed', sourceFileName: file.name,
      processedFiles: 1, rowCount: finalized.expectedRows } };
  } catch {
    return { done: false, state: { ...finalized, phase: 'move', moveAttempts: 1, ...(requireReceipt ? { receipt } : {}) } };
  }
}
