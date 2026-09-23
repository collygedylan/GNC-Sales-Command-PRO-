import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecoveryBundle, rehearseRecovery, requireCurrentHealth } from '../scripts/recovery-bundle.mjs';
import { appendRepairEvent, summarizeRepair } from '../scripts/repair-ledger.mjs';
import { provisionSandbox } from '../scripts/google-sandbox-admin.mjs';

const commit = 'a'.repeat(40), digest = 'b'.repeat(64), migrations = 'c'.repeat(64);
const proof = { schemaVersion: 'gnc-release-proof-v1', commit, digest, release: 'V2026.09.22.05', runId: 123, attempt: 1, siteArtifactId: 234 };
const artifact = { commit, digest, release: proof.release };
const evidence = () => ({ schemaVersion: 'gnc-apps-script-recovery-evidence-v1', commit, versionNumber: 281,
  verifiedAt: new Date().toISOString(), sourceDigest: 'd'.repeat(64) });
const healthy = () => ({ schemaVersion: 'gnc-recovery-diagnostics-v1', ok: true, checkedAt: new Date().toISOString(), checks: {
  frontend: { ok: true, commit, release: proof.release }, appsScript: { ok: true, commit },
  database: { ok: true, migrationCount: 100, migrationDigest: migrations }
} });
test('recovery rehearsal binds exact artifact, script, migration state and makes no writes', () => {
  const bundle = buildRecoveryBundle({ proof, artifact, diagnostics: healthy(), appsScriptEvidence: evidence() });
  assert.equal(rehearseRecovery(bundle, { artifact, migrationDigest: migrations }).deploymentPerformed, false);
  assert.throws(() => rehearseRecovery(bundle, { artifact, migrationDigest: 'd'.repeat(64) }), /COMPATIBILITY_UNPROVEN/);
  assert.throws(() => rehearseRecovery(bundle, { artifact: { ...artifact, digest: 'e'.repeat(64) }, migrationDigest: migrations }), /ARTIFACT_MISMATCH/);
});
test('recovery cannot be declared ready from stale, failed, mismatched or missing evidence', () => {
  const h = healthy();
  for (const checkedAt of ['invalid', '2020-01-01', '2999-01-01']) assert.throws(() => requireCurrentHealth({ ...h, checkedAt }), /HEALTH_NOT_CURRENT/);
  assert.throws(() => requireCurrentHealth({ ...h, ok: false }), /HEALTH_NOT_CURRENT/);
  assert.throws(() => buildRecoveryBundle({ proof, artifact, diagnostics: h, appsScriptEvidence: { ...evidence(), versionNumber: 0 } }), /IDENTITY_INCOMPLETE/);
  assert.throws(() => buildRecoveryBundle({ proof, artifact, diagnostics: h, scriptVersion: 281 }), /SCRIPT_VERSION_UNPROVEN/);
  h.checks.appsScript.commit = 'f'.repeat(40);
  assert.throws(() => buildRecoveryBundle({ proof, artifact, diagnostics: h, appsScriptEvidence: evidence() }), /IDENTITY_INCOMPLETE/);
});
test('repair ledger separates phases and does not call shared allowance exact billing', () => {
  let events = appendRepairEvent([], { phase: 'diagnosis', model: 'gpt-5.6-sol', effort: 'high', usedPercent: 24 }, '2026-09-23T00:00:00Z');
  events = appendRepairEvent(events, { phase: 'validation', usedPercent: 25 }, '2026-09-23T00:10:00Z');
  events = appendRepairEvent(events, { phase: 'complete', usedPercent: 26 }, '2026-09-23T00:30:00Z');
  const result = summarizeRepair(events);
  assert.deepEqual(result.phaseSeconds, { diagnosis: 600, validation: 1200 });
  assert.equal(result.accountUsageDelta, 2); assert.match(result.billingNote, /not exact/);
  assert.throws(() => appendRepairEvent([], { phase: 'invalid' }));
});
test('sandbox provisioning writes only the separate project and resumes marked folders', async () => {
  const calls = [], folders = new Map(); let content = null;
  const api = async (url, method = 'GET', body) => {
    calls.push({ url, method, body });
    if (url.includes('drive/v3/files?') && method === 'GET') {
      const q = new URL(url).searchParams.get('q');
      if (q.startsWith('name =')) return { files: content ? [{ id: 'sandbox-script-001', mimeType: 'application/vnd.google-apps.script' }] : [] };
      return { files: folders.has(q.match(/value='([^']+)'/)[1]) ? [folders.get(q.match(/value='([^']+)'/)[1])] : [] };
    }
    if (url.endsWith('/v1/projects')) return { scriptId: 'sandbox-script-001' };
    if (url.includes('drive/v3/files?') && method === 'POST') {
      const folder = { id: `sandbox-folder-${folders.size + 1}` }; folders.set(body.appProperties.gncSandbox, folder); return folder;
    }
    if (url.endsWith('/content')) { if (method === 'PUT') content = body; return content; }
    throw new Error('UNEXPECTED_SANDBOX_CALL');
  };
  const source = "const FOLDERS={DROP:'production-drop-001',ARCHIVE:'production-archive-001'}; const DRIVE_AROUND_HISTORY_FOLDER_ID='production-history-001'; function run(){return DriveApp.getFolderById(FOLDERS.DROP);}";
  const first = await provisionSandbox(api, source, { scriptId: 'production-script-001' }, () => {});
  const second = await provisionSandbox(api, source, { scriptId: 'production-script-001' }, () => {});
  assert.equal(first.folderIds.length, 3); assert.deepEqual(second.folderIds, first.folderIds);
  assert.equal(calls.filter(c => c.url.endsWith('/v1/projects')).length, 1);
  assert.ok(calls.filter(c => c.method === 'PUT').every(c => c.url.includes('/sandbox-script-001/')));
  assert.ok(!content.files[0].source.includes("'production-drop-001'"));
  const manifest = JSON.parse(content.files[1].source);
  assert.ok(manifest.oauthScopes.every(scope => !/mail|external_request/.test(scope)));
});
test('sandbox refuses a production or unowned project before changing its content', async () => {
  let writes = 0;
  const api = async (url, method = 'GET') => {
    if (method !== 'GET') writes++;
    return { files: [{ id: 'production-script-001', mimeType: 'application/vnd.google-apps.script' }] };
  };
  await assert.rejects(provisionSandbox(api, '', { scriptId: 'production-script-001' }, () => {}), /PRODUCTION_TARGET_BLOCKED/);
  assert.equal(writes, 0);
  await assert.rejects(provisionSandbox(api, '', { scriptId: 'different-production' }, () => {}), /OWNERSHIP_UNVERIFIED/);
  assert.equal(writes, 0);
});
