export async function drainPerformanceResponseBodies(totals, { maxBatches = 8, timeoutMs = 15_000 } = {}) {
  if (!totals || !Array.isArray(totals.pending) || !Array.isArray(totals.errors)
    || !Number.isInteger(maxBatches) || maxBatches < 1 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('PERFORMANCE_RESPONSE_DRAIN_OPTIONS_INVALID');
  }

  const deadline = Date.now() + timeoutMs;
  let batches = 0;
  while (totals.pending.length) {
    if (++batches > maxBatches) throw new Error('PERFORMANCE_RESPONSE_DRAIN_LIMIT');
    const batch = totals.pending.splice(0);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error('PERFORMANCE_RESPONSE_DRAIN_TIMEOUT');
    let timeout;
    try {
      await Promise.race([
        Promise.all(batch),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('PERFORMANCE_RESPONSE_DRAIN_TIMEOUT')), remainingMs);
        })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
}
