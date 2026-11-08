export async function waitForPublishedHydration(check, getStatus, delay, options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || 120_000);
  const intervalMs = Math.max(1, Number(options.intervalMs) || 50);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const deadline = now() + timeoutMs;
  let attempt = 0;
  while (now() < deadline) {
    const loaded = await check();
    const status = getStatus();
    attempt += 1;
    if (typeof options.onAttempt === 'function') options.onAttempt({ attempt, loaded, status });
    if (loaded === true && status?.state === 'Published data') return true;
    await delay(intervalMs);
  }
  throw new Error('Published Drive hydration did not settle within 120 seconds');
}
