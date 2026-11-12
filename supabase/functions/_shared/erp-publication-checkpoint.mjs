const PARSER_CHECKPOINT_FIELDS = new Set(['identityCounts', 'header', 'headerRowIndex']);

export function compactErpPublicationState(state) {
  if (!state || state.phase !== 'finalize' || !state.stageId || state.expectedRowsPending === true
    || !Number.isSafeInteger(state.expectedRows) || state.expectedRows < 1
    || state.processedRows !== state.expectedRows || Number(state.stagedPrefixRows || 0) !== 0) return state;
  if (!Object.keys(state).some(key => PARSER_CHECKPOINT_FIELDS.has(key))) return state;
  // The sealed durable stage owns every normalized identity. Publication and
  // archive retries cannot return to workbook parsing or regenerate these IDs.
  return Object.fromEntries(Object.entries(state).filter(([key]) => !PARSER_CHECKPOINT_FIELDS.has(key)));
}

export function compactErpFileContinuation(continuation) {
  if (!continuation) return continuation;
  const state = compactErpPublicationState(continuation.state);
  return state === continuation.state ? continuation : { ...continuation, state };
}
