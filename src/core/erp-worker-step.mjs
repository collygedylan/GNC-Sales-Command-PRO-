import { compactErpFileContinuation } from '../../supabase/functions/_shared/erp-publication-checkpoint.mjs';

function folderFor(context, stage) {
  return String(context.folders[stage.key] || context.api.sourceFolders[stage.key]?.[0] || '').trim();
}

function processedFor(context, stage) {
  return String(context.folders.processed?.[stage.key] || context.folders[`${stage.key}_processed`] || '').trim();
}

function cursorFor(context, extra = {}) {
  return { stageIndex: context.stageIndex, stageResults: context.results,
    attemptedByStage: context.attempted, folderSnapshot: context.snapshot, ...extra };
}

async function checkpoint(context, stage) {
  await context.status({ sourceProgressDelta: context.api.buildCheckpoint(stage.key, context.results) });
}

function pendingFor(context, stage) {
  const attempted = new Set(context.attempted[stage.key] || []);
  return (context.snapshot[stage.key]?.files || []).filter(file => !attempted.has(String(file.id)));
}

async function processFile(context, stage, file, priorState, listDurationMs) {
  const started = performance.now();
  const maxRows = context.api.resolveRows(stage.dataset, context.maxRowsPerSlice ?? priorState?.maxRowsPerSlice);
  const step = await context.api.stageFile({
    supabase: context.supabase, fetcher: context.fetcher, token: context.token, file,
    dataset: stage.dataset, stageKey: stage.key, parentId: folderFor(context, stage),
    processedId: processedFor(context, stage), status: context.status, state: priorState, syncRunId: context.syncRunId,
    maxRowsPerSlice: maxRows, sliceStartMs: context.started
  });
  const elapsedMs = Number(priorState?.elapsedMs || listDurationMs) + Math.round(performance.now() - started);
  if (!step.done) return cursorFor(context, { maxRowsPerSlice: maxRows,
    fileContinuation: { stageIndex: context.stageIndex, file,
      state: { ...step.state, elapsedMs, maxRowsPerSlice: maxRows, listDurationMs } } });
  context.attempted[stage.key] = [...new Set([...(context.attempted[stage.key] || []), String(file.id)])];
  context.results.push({ ...step.result, key: stage.key, dataset: stage.dataset,
    listDurationMs, durationMs: elapsedMs });
  if (!pendingFor(context, stage).length) {
    await checkpoint(context, stage);
    context.stageIndex += 1;
  }
  return cursorFor(context);
}

async function runStage(context, stage, resume) {
  const snapshot = context.snapshot[stage.key] || {};
  const listDurationMs = Math.max(0, Number(resume?.state?.listDurationMs ?? snapshot.listDurationMs) || 0);
  if (!folderFor(context, stage) || snapshot.error) {
    context.results.push({ key: stage.key, outcome: 'failed', processedFiles: 0,
      error: snapshot.error || 'ERP_DROP_FOLDER_ID_MISSING', listDurationMs });
    context.stageIndex += 1;
    return cursorFor(context);
  }
  const file = resume?.file || pendingFor(context, stage)[0];
  if (!file) {
    if (!context.results.some(result => result.key === stage.key)) {
      context.results.push({ key: stage.key, outcome: 'UP_TO_DATE', processedFiles: 0, listDurationMs });
    }
    await checkpoint(context, stage);
    context.stageIndex += 1;
    return cursorFor(context);
  }
  if (resume) return processFile(context, stage, file, resume.state || null, listDurationMs);
  try {
    return await processFile(context, stage, file, resume?.state || null, listDurationMs);
  } catch (error) {
    context.attempted[stage.key] = [...new Set([...(context.attempted[stage.key] || []), String(file.id)])];
    context.results.push({ key: stage.key, dataset: stage.dataset, outcome: 'failed',
      sourceFileName: file.name, processedFiles: 0, listDurationMs,
      error: String(error?.message || 'ERP_FILE_IMPORT_FAILED').slice(0, 200) });
    return cursorFor(context);
  }
}

function buildContext(args, api, folders) {
  const cursor = args.cursor || {};
  return { ...args, fetcher: args.fetcher || fetch, api, folders, token: String(args.accessToken), started: performance.now(),
    syncRunId: String(cursor.syncRunId || ''),
    results: Array.isArray(cursor.stageResults) ? cursor.stageResults.slice() : [],
    attempted: { ...(cursor.attemptedByStage || {}) }, snapshot: { ...(cursor.folderSnapshot || {}) },
    stageIndex: Math.max(0, Math.min(api.stages.length, Number(cursor.stageIndex) || 0)) };
}

async function finish(context) {
  const failed = context.results.some(row => ['failed', 'requires_template'].includes(row.outcome));
  const cursor = cursorFor(context);
  await context.status({ active: false, status: failed ? 'failed' : 'complete', currentStage: 'idle',
    currentStageLabel: 'Idle', stageIndex: context.stageIndex, stageResults: context.results,
    continuationCursor: cursor, finishedAt: new Date().toISOString(),
    message: failed ? 'One or more ERP files could not be imported.' : 'ERP sync completed.',
    error: failed ? 'One or more ERP files could not be imported.' : '',
    errorCode: failed ? 'ERP_SYNC_STAGE_FAILED' : '' });
  return { done: true, ok: !failed, cursor };
}

export async function runPendingErpWorkerStep(args, api) {
  const raw = args.env('ERP_SYNC_DROP_FOLDERS_JSON');
  if (!raw || !args.accessToken) throw new Error('ERP_SYNC_CREDENTIALS_NOT_CONFIGURED');
  const context = buildContext(args, api, JSON.parse(raw));
  context.snapshot = await api.prefetch(context.fetcher, context.token, context.folders, context.snapshot);
  const resume = args.cursor?.fileContinuation || null;
  if (resume && (Number(resume.stageIndex) !== context.stageIndex || !resume.file?.id)) {
    throw new Error('ERP_CONTINUATION_INVALID');
  }
  if (resume) return executeOneStage(context, api.stages[context.stageIndex], resume);
  while (context.stageIndex < api.stages.length) {
    const stage = api.stages[context.stageIndex];
    const hasWork = pendingFor(context, stage).length > 0;
    const result = await executeOneStage(context, stage, null);
    if (hasWork || performance.now() - context.started >= 700) return result;
  }
  return finish(context);
}

async function executeOneStage(context, stage, resume) {
  if (!stage) throw new Error('ERP_CONTINUATION_INVALID');
  resume = compactErpFileContinuation(resume);
  const publishing = resume?.state?.phase === 'finalize';
  await context.status({ status: 'CONTINUE', stageIndex: context.stageIndex, currentStage: stage.key,
    currentStageLabel: stage.key.toUpperCase(), continuationCursor: cursorFor(context,
      resume ? { fileContinuation: resume } : {}),
    sourceProgressDelta: { key: stage.key, stage: publishing ? 'publishing' : resume ? 'staging' : 'checking',
      percent: publishing ? 95 : resume ? 70 : 10, updatedAt: new Date().toISOString(), error: '' } });
  const cursor = await runStage(context, stage, resume);
  await context.status({ status: 'CONTINUE', stageIndex: cursor.stageIndex,
    currentStage: context.api.stages[cursor.stageIndex]?.key || 'hl_po_parsed',
    continuationCursor: cursor, stageResults: context.results,
    fileId: cursor.fileContinuation?.file?.id || null,
    nextOffset: cursor.fileContinuation?.state?.nextOffset ?? null });
  return { done: false, cursor };
}
