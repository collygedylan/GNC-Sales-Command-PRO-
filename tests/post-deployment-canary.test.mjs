import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  buildDeploymentFingerprint,
  normalizeCommit,
  normalizeRelease,
  verifyDeploymentFingerprint
} from '../scripts/deployment-fingerprint-lib.mjs';

const commit = '0123456789abcdef0123456789abcdef01234567';

test('deployment fingerprints require the exact release and full commit', () => {
  const fingerprint = buildDeploymentFingerprint({ release: 'V2026.08.27.07', commit, generatedAt: '2026-08-27T18:00:00.000Z' });
  assert.deepEqual(verifyDeploymentFingerprint(fingerprint, { release: 'V2026.08.27.07', commit }), {
    ok: true,
    code: 'LIVE_RELEASE_MATCH',
    actualRelease: 'V2026.08.27.07',
    actualCommit: commit
  });
  assert.equal(verifyDeploymentFingerprint(fingerprint, { release: 'V2026.08.27.08', commit }).code, 'LIVE_RELEASE_MISMATCH');
  assert.equal(verifyDeploymentFingerprint(fingerprint, { release: 'V2026.08.27.07', commit: 'f'.repeat(40) }).code, 'LIVE_RELEASE_MISMATCH');
});

test('deployment fingerprint normalization rejects ambiguous identifiers', () => {
  assert.equal(normalizeRelease('v2026.08.27.07'), 'V2026.08.27.07');
  assert.equal(normalizeRelease('2026.08.27.07'), '');
  assert.equal(normalizeCommit(commit.toUpperCase()), commit);
  assert.equal(normalizeCommit(commit.slice(0, 7)), '');
  assert.equal(verifyDeploymentFingerprint({}, { release: 'V2026.08.27.07', commit }).code, 'DEPLOYMENT_MANIFEST_INVALID');
});

test('Pages workflow publishes and gates the production deployment fingerprint', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/pages-static.yml', import.meta.url), 'utf8');
  const canary = fs.readFileSync(new URL('./production-request-canary.spec.ts', import.meta.url), 'utf8');
  assert.match(workflow, /write-deployment-fingerprint\.mjs/);
  assert.match(workflow, /post-deployment-canary:[\s\S]*needs: deploy/);
  assert.match(workflow, /wait-for-live-release\.mjs/);
  assert.match(workflow, /production-request-canary\.spec\.ts/);
  assert.match(canary, /live Eval Reports #2 drill and multi-select remain actionable without mutations/);
  assert.match(canary, /data-role="manager-eval2-selection-toggle"/);
  assert.match(canary, /getManagerEvalReport2SelectedItems\(\)\[0\]\?\.reportId/);
  assert.match(canary, /live PO Management uses authenticated PostgREST and never the retired database proxy/);
  assert.match(canary, /\/rest\/v1\/ph_view_po_27f1_hl/);
});

test('scheduled production health checks exact live parity without racing the push deployment', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/production-auth-health.yml', import.meta.url), 'utf8');
  const probe = fs.readFileSync(new URL('../scripts/probe-production-auth-health.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.match(workflow, /Verify the scheduled checkout is the exact live release/);
  assert.match(workflow, /REQUIRE_LIVE_RELEASE_MATCH: '1'/);
  assert.match(probe, /requireLiveReleaseMatch[\s\S]*production_live_release_mismatch/);
  assert.match(probe, /get_po_management_health_snapshot/);
  assert.match(probe, /production_po_management_auth_contract_unhealthy/);
});
