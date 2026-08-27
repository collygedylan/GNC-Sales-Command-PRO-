import { readFile } from 'node:fs/promises';
import path from 'node:path';

const RELEASE_PATTERN = /^V\d{4}\.\d{2}\.\d{2}\.\d{2}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/i;

export function normalizeRelease(value = '') {
  const normalized = String(value || '').trim().toUpperCase();
  return RELEASE_PATTERN.test(normalized) ? normalized : '';
}
export function normalizeCommit(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return COMMIT_PATTERN.test(normalized) ? normalized : '';
}

export async function readExpectedRelease(root = process.cwd()) {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const release = normalizeRelease(`V${String(packageJson.version || '').trim()}`);
  if (!release) throw new Error('DEPLOYMENT_RELEASE_INVALID');
  return release;
}

export function buildDeploymentFingerprint({ release = '', commit = '', generatedAt = '' } = {}) {
  const safeRelease = normalizeRelease(release);
  const safeCommit = normalizeCommit(commit);
  if (!safeRelease) throw new Error('DEPLOYMENT_RELEASE_INVALID');
  if (!safeCommit) throw new Error('DEPLOYMENT_COMMIT_INVALID');
  return {
    schemaVersion: 'gnc-deployment-fingerprint-v1',
    release: safeRelease,
    commit: safeCommit,
    generatedAt: String(generatedAt || new Date().toISOString())
  };
}

export function verifyDeploymentFingerprint(payload, { release = '', commit = '' } = {}) {
  const expectedRelease = normalizeRelease(release);
  const expectedCommit = normalizeCommit(commit);
  if (!expectedRelease || !expectedCommit) {
    return { ok: false, code: 'EXPECTED_FINGERPRINT_INVALID', actualRelease: '', actualCommit: '' };
  }
  if (!payload || typeof payload !== 'object' || payload.schemaVersion !== 'gnc-deployment-fingerprint-v1') {
    return { ok: false, code: 'DEPLOYMENT_MANIFEST_INVALID', actualRelease: '', actualCommit: '' };
  }
  const actualRelease = normalizeRelease(payload.release);
  const actualCommit = normalizeCommit(payload.commit);
  if (!actualRelease || !actualCommit) {
    return { ok: false, code: 'DEPLOYMENT_MANIFEST_INVALID', actualRelease, actualCommit };
  }
  if (actualRelease !== expectedRelease || actualCommit !== expectedCommit) {
    return { ok: false, code: 'LIVE_RELEASE_MISMATCH', actualRelease, actualCommit };
  }
  return { ok: true, code: 'LIVE_RELEASE_MATCH', actualRelease, actualCommit };
}
