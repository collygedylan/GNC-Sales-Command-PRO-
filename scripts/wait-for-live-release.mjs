import { readExpectedRelease, verifyDeploymentFingerprint } from './deployment-fingerprint-lib.mjs';

const root = process.cwd();
const expectedRelease = await readExpectedRelease(root);
const expectedCommit = String(process.env.EXPECTED_COMMIT || process.env.GITHUB_SHA || '').trim().toLowerCase();
const baseUrl = String(process.env.CANARY_BASE_URL || 'https://agmetricapp.com').trim().replace(/\/+$/, '');
const timeoutMs = Math.max(1_000, Math.min(10 * 60_000, Number(process.env.CANARY_WAIT_TIMEOUT_MS || 180_000)));
const intervalMs = Math.max(250, Math.min(30_000, Number(process.env.CANARY_WAIT_INTERVAL_MS || 5_000)));
const deadline = Date.now() + timeoutMs;
let lastCode = 'DEPLOYMENT_MANIFEST_UNAVAILABLE';
let attempts = 0;

while (Date.now() <= deadline) {
  attempts += 1;
  const nonce = `${Date.now()}-${attempts}`;
  try {
    const manifestUrl = `${baseUrl}/deployments/${encodeURIComponent(expectedCommit)}.json?canary=${encodeURIComponent(nonce)}`;
    const response = await fetch(manifestUrl, {
      cache: 'no-store',
      headers: { 'cache-control': 'no-cache, no-store, must-revalidate', pragma: 'no-cache' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000)
    });
    if (response.ok) {
      const payload = await response.json().catch(() => null);
      const verification = verifyDeploymentFingerprint(payload, { release: expectedRelease, commit: expectedCommit });
      lastCode = verification.code;
      if (verification.ok) {
        console.log(JSON.stringify({ ok: true, code: verification.code, release: expectedRelease, commit: expectedCommit.slice(0, 7), attempts }));
        process.exit(0);
      }
    } else {
      lastCode = response.status === 404 ? 'DEPLOYMENT_MANIFEST_NOT_FOUND' : `DEPLOYMENT_MANIFEST_HTTP_${response.status}`;
    }
  } catch {
    lastCode = 'DEPLOYMENT_MANIFEST_UNAVAILABLE';
  }
  if (Date.now() + intervalMs > deadline) break;
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

console.error(JSON.stringify({
  ok: false,
  code: 'LIVE_RELEASE_MISMATCH',
  observedCode: String(lastCode || 'UNKNOWN').replace(/[^A-Z0-9_-]+/gi, '_').toUpperCase().slice(0, 64),
  expectedRelease,
  expectedCommit: expectedCommit.slice(0, 7),
  attempts
}));
process.exit(1);
