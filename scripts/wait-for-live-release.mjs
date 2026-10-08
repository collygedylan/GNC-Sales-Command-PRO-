import { readExpectedRelease, verifyDeploymentFingerprint } from './deployment-fingerprint-lib.mjs';
import { resolvePagesPublication } from './pages-publication.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const expectedRelease = await readExpectedRelease(root);
const expectedMainCommit = String(process.env.EXPECTED_COMMIT || process.env.EXPECTED_LIVE_COMMIT || process.env.GITHUB_SHA || '').trim().toLowerCase();
let expectedCommit = expectedMainCommit;
let publicationResolved = process.env.RESOLVE_PAGES_PUBLICATION !== '1';
const repository = process.env.GITHUB_REPOSITORY;
function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', shell: false, windowsHide: true, timeout: 15000 });
  if (result.error || result.status !== 0) throw new Error('PAGES_PUBLICATION_API_FAILED');
  return result.stdout;
}
async function readDescriptor({ runId, name }) {
  const temp = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(temp, 'gnc-publication-'));
  let descriptor;
  let readError;
  try {
    gh(['run', 'download', String(runId), '--repo', repository, '--name', name, '--dir', directory]);
    descriptor = JSON.parse(await readFile(path.join(directory, 'publication.json'), 'utf8'));
  } catch (error) {
    readError = error;
  }

  let cleanupError;
  try {
    // Remove only this invocation's own temporary download, never a checkout.
    if (path.dirname(directory) !== temp || !path.basename(directory).startsWith('gnc-publication-')
      || await realpath(directory) !== directory) throw new Error('PAGES_PUBLICATION_TEMP_INVALID');
    await rm(directory, { recursive: true, force: false });
  } catch (error) {
    cleanupError = error;
  }

  if (readError && cleanupError) {
    throw new AggregateError([readError, cleanupError], 'PAGES_PUBLICATION_DESCRIPTOR_AND_CLEANUP_FAILED', { cause: readError });
  }
  if (readError) throw readError;
  if (cleanupError) throw cleanupError;
  return descriptor;
}
const baseUrl = String(process.env.CANARY_BASE_URL || 'https://agmetricapp.com').trim().replace(/\/+$/, '');
const timeoutMs = Math.max(1_000, Math.min(10 * 60_000, Number(process.env.CANARY_WAIT_TIMEOUT_MS || 180_000)));
const intervalMs = Math.max(250, Math.min(30_000, Number(process.env.CANARY_WAIT_INTERVAL_MS || 5_000)));
const requireCurrentLiveDescriptor = String(process.env.REQUIRE_CURRENT_LIVE_DESCRIPTOR || '').trim() === '1';
const deadline = Date.now() + timeoutMs;
let lastCode = 'DEPLOYMENT_MANIFEST_UNAVAILABLE';
let attempts = 0;

while (Date.now() <= deadline) {
  attempts += 1;
  const nonce = `${Date.now()}-${attempts}`;
  try {
    if (!publicationResolved) {
      expectedCommit = await resolvePagesPublication({ repository, commit: expectedMainCommit,
        api: async endpoint => JSON.parse(gh(['api', '--hostname', 'github.com', '--method', 'GET', endpoint])), readDescriptor,
        readLiveCommit: async () => {
          const response = await fetch(`${baseUrl}/deployment.json?publication=${encodeURIComponent(nonce)}`, {
            cache: 'no-store', headers: { 'cache-control': 'no-cache, no-store, must-revalidate' }, signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) throw new Error('PAGES_PUBLICATION_FINGERPRINT_UNAVAILABLE');
          const payload = await response.json();
          if (!verifyDeploymentFingerprint(payload, { release: expectedRelease, commit: payload?.commit }).ok) {
            throw new Error('PAGES_PUBLICATION_FINGERPRINT_MISMATCH');
          }
          return payload.commit;
        },
      });
      publicationResolved = true;
    }
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
        if (requireCurrentLiveDescriptor) {
          try {
            const rootResponse = await fetch(`${baseUrl}/deployment.json?canary=${encodeURIComponent(nonce)}`, {
              cache: 'no-store',
              headers: { 'cache-control': 'no-cache, no-store, must-revalidate', pragma: 'no-cache' },
              redirect: 'follow',
              signal: AbortSignal.timeout(15_000)
            });
            if (!rootResponse.ok) {
              lastCode = rootResponse.status === 404
                ? 'CURRENT_DEPLOYMENT_DESCRIPTOR_NOT_FOUND'
                : `CURRENT_DEPLOYMENT_DESCRIPTOR_HTTP_${rootResponse.status}`;
            } else {
              const rootPayload = await rootResponse.json().catch(() => null);
              const rootVerification = verifyDeploymentFingerprint(rootPayload, {
                release: expectedRelease, commit: expectedCommit
              });
              if (rootVerification.ok) {
                console.log(JSON.stringify({ ok: true, code: verification.code, release: expectedRelease,
                  commit: expectedCommit.slice(0, 7), attempts }));
                process.exit(0);
              }
              lastCode = `CURRENT_${rootVerification.code}`;
            }
          } catch {
            lastCode = 'CURRENT_DEPLOYMENT_DESCRIPTOR_UNAVAILABLE';
          }
        } else {
          console.log(JSON.stringify({ ok: true, code: verification.code, release: expectedRelease,
            commit: expectedCommit.slice(0, 7), attempts }));
          process.exit(0);
        }
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
