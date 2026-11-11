export function isRetryableErpFinalizeError(error) {
  return ['55P03', '57014', '40P01', '40001'].includes(String(error?.code || ''))
    || /AbortError|TimeoutError/.test(String(error?.name || ''))
    || /lock timeout|statement timeout|signal timed out|fetch failed|network|502|503|504|546/i.test(String(error?.message || error || ''));
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
  const { data, error } = await supabase.rpc('fast_seal_erp_stage_v1', {
    p_stage_id: state.stageId, p_expected_rows: state.processedRows
  });
  if (error || data?.ok !== true) throw error || new Error('ERP_STAGE_SEAL_UNCONFIRMED');
  return { ...state, expectedRows: state.processedRows, expectedRowsPending: false };
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
  supabase, fetcher, token, file, dataset, stageKey, parentId, processedId, next, status, moveProcessed, maxRows
}) {
  let finalized = next;
  if (Number(finalized.retryNotBefore || 0) > Date.now()) return { done: false, state: finalized };
  try {
    if (finalized.expectedRowsPending) {
      finalized = await sealStage(supabase, finalized, maxRows);
      await status({ sourceProgressDelta: publicationProgress(stageKey, file.name, finalized.expectedRows, false) });
    }
    if (finalized.processedRows !== finalized.expectedRows) throw new Error('ERP_STAGE_ROW_COUNT_MISMATCH');
    const { data, error } = await supabase.rpc('fast_commit_erp_stage_swap_v1', { p_stage_id: finalized.stageId, p_async: true });
    if (data?.busy === true) {
      const retryNotBefore = Date.now() + Math.max(2500, Math.min(15000, Number(data.retryAfterMs) || 0));
      await status({ retryNotBefore, sourceProgressDelta: {
        ...publicationProgress(stageKey, file.name, finalized.expectedRows, false),
        rowsPrepared: Math.max(0, Math.min(finalized.expectedRows, Number(data.preparedRows) || 0))
      } });
      return { done: false, state: { ...finalized, phase: 'finalize', retryNotBefore } };
    }
    if (error || data?.ok !== true || finalized.expectedRows < 1) throw error || new Error('ERP_STAGE_COMMIT_UNCONFIRMED');
    await status({ sourceProgressDelta: publicationProgress(stageKey, file.name, finalized.expectedRows, true) });
  } catch (error) {
    return retryPublication(error, finalized, status);
  }
  try {
    await moveProcessed(fetcher, token, file, parentId, processedId);
    return { done: true, result: { key: dataset, outcome: 'processed', sourceFileName: file.name,
      processedFiles: 1, rowCount: finalized.expectedRows } };
  } catch {
    return { done: false, state: { ...finalized, phase: 'move', moveAttempts: 1 } };
  }
}
