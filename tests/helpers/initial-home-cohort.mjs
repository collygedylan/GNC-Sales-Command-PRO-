/** Wait for a named view's live-sync cohort to publish a current proof. */
export async function waitForVerifiedLiveCohort(readSnapshot, { label = 'live-sync', errorPrefix = 'LIVE_SYNC', timeoutMs = 20_000, pollMs = 25, now = Date.now, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const deadline = now() + timeoutMs;
  let latest = null;
  while (now() <= deadline) {
    latest = await readSnapshot();
    if (latest?.ready === true) return latest;
    if (['Needs attention', 'Offline'].includes(String(latest?.status?.state || ''))) {
      throw Object.assign(new Error(`${label} live-sync did not verify: ${JSON.stringify(latest)}`), { code: `${errorPrefix}_COHORT_FAILED` });
    }
    await delay(pollMs);
  }
  throw Object.assign(new Error(`${label} live-sync did not settle: ${JSON.stringify(latest)}`), { code: `${errorPrefix}_COHORT_TIMEOUT` });
}

export function waitForInitialHomeCohort(readSnapshot, options = {}) {
  return waitForVerifiedLiveCohort(readSnapshot, { ...options, label: 'Initial Home', errorPrefix: 'INITIAL_HOME' });
}
