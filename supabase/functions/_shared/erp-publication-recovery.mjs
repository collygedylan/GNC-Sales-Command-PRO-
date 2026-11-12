const PUBLICATION_STALL_MS = 90000;

function isExhaustedPublication(error) {
  return String(error?.message || '') === 'ERP_PUBLICATION_RETRY_EXHAUSTED';
}

export function advanceErpPublicationClock(state, data, now = Date.now()) {
  const prepared = Math.max(0, Math.min(state.expectedRows, Number(data?.preparedRows) || 0));
  const prior = Number(state.publicationPreparedRows) || 0;
  const previous = Number(state.publicationProgressAt);
  const raw = data?.publicationProgressAt;
  const durable = typeof raw === 'number' ? raw : Date.parse(raw || '');
  return { ...state, publicationPreparedRows: Math.max(prior, prepared),
    publicationProgressAt: Number.isFinite(durable) && durable <= now ? durable
      : !Number.isFinite(previous) || prepared > prior ? now : previous };
}

function exhaustionDetails(error, state) {
  try {
    const details = JSON.parse(error?.details || '{}');
    return details.stage_id === state.stageId ? details : null;
  } catch { return null; }
}

function pendingPublication(state) {
  return { ok: true, busy: true, stage_id: state.stageId,
    preparedRows: state.publicationPreparedRows, retryAfterMs: 2500 };
}

export async function readErpStagePublication(supabase, state, rpc, now = Date.now()) {
  const result = await rpc(supabase, 'fast_commit_erp_stage_swap_v1', {
    p_stage_id: state.stageId, p_async: true
  });
  if (result.error && !isExhaustedPublication(result.error)) return { ...result, state };
  if (!result.error && result.data?.busy !== true) return { ...result, state };
  const next = advanceErpPublicationClock(state, result.data || exhaustionDetails(result.error, state), now);
  if (next.publicationRecoveryAttempted === true) return { ...result, state: next };
  if (now - next.publicationProgressAt < PUBLICATION_STALL_MS) {
    return { data: result.data || pendingPublication(next), state: next };
  }
  const recovered = await rpc(supabase, 'resume_erp_stage_publication_v3077', { p_stage_id: state.stageId });
  const accepted = recovered.data?.recoveryAccepted === true;
  const recoveredState = accepted
    ? { ...next, publicationRecoveryAttempted: true, publicationRecoveryAt: now }
    : advanceErpPublicationClock(next, recovered.data, now);
  if (!recovered.error && recovered.data?.stage_id !== state.stageId) {
    return { error: new Error('ERP_PUBLICATION_RECOVERY_IDENTITY_MISMATCH'), state: recoveredState };
  }
  return { ...recovered, state: recoveredState };
}
