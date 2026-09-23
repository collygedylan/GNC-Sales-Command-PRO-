import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyReleaseArtifact } from './release-artifact.mjs';

const fail = code => { throw new Error(`RECOVERY_BUNDLE_${code}`); };
export function requireCurrentHealth(diagnostics, now = Date.now()) {
  const at = Date.parse(diagnostics?.checkedAt);
  if (diagnostics?.schemaVersion !== 'gnc-recovery-diagnostics-v1' || diagnostics.ok !== true
    || !Number.isFinite(at) || now - at > 15 * 60000 || at > now
    || !diagnostics.checks || Object.values(diagnostics.checks).some(c => c.ok !== true)) fail('HEALTH_NOT_CURRENT');
}
export function buildRecoveryBundle({ proof, artifact, diagnostics, appsScriptEvidence, now = Date.now() }) {
  requireCurrentHealth(diagnostics, now);
  const checks = diagnostics.checks;
  const scriptVersion = appsScriptEvidence?.versionNumber;
  const verifiedAt = Date.parse(appsScriptEvidence?.verifiedAt);
  if (appsScriptEvidence?.schemaVersion !== 'gnc-apps-script-recovery-evidence-v1'
    || appsScriptEvidence.commit !== proof?.commit || !/^[a-f0-9]{64}$/.test(appsScriptEvidence.sourceDigest || '')
    || !Number.isFinite(verifiedAt) || verifiedAt > now || now - verifiedAt > 15 * 60000) fail('SCRIPT_VERSION_UNPROVEN');
  if (checks?.frontend?.commit !== proof?.commit || checks?.appsScript?.commit !== proof?.commit
    || checks?.frontend?.release !== proof?.release || artifact?.commit !== proof?.commit
    || artifact?.release !== proof?.release || artifact?.digest !== proof?.digest
    || proof?.schemaVersion !== 'gnc-release-proof-v1' || !Number.isSafeInteger(proof.siteArtifactId)
    || !Number.isSafeInteger(proof.runId) || !Number.isSafeInteger(scriptVersion) || scriptVersion < 1
    || !/^[a-f0-9]{64}$/.test(checks?.database?.migrationDigest || '')) fail('IDENTITY_INCOMPLETE');
  return { schemaVersion: 'gnc-recovery-bundle-v1', capturedAt: diagnostics.checkedAt,
    commit: proof.commit, release: proof.release, candidateRunId: proof.runId, candidateAttempt: proof.attempt,
    siteArtifactId: proof.siteArtifactId, artifactDigest: artifact.digest, appsScriptVersion: scriptVersion,
    appsScriptCommit: checks.appsScript.commit, appsScriptSourceDigest: appsScriptEvidence.sourceDigest,
    migrationDigest: checks.database.migrationDigest,
    migrationCount: checks.database.migrationCount, policy: 'exact-migration-state-only-no-database-restore' };
}
export function rehearseRecovery(bundle, { artifact, migrationDigest }) {
  if (bundle?.schemaVersion !== 'gnc-recovery-bundle-v1' || bundle.policy !== 'exact-migration-state-only-no-database-restore'
    || !/^[a-f0-9]{64}$/.test(bundle.migrationDigest || '') || bundle.migrationDigest !== migrationDigest) fail('DATABASE_COMPATIBILITY_UNPROVEN');
  if (artifact.commit !== bundle.commit || artifact.release !== bundle.release || artifact.digest !== bundle.artifactDigest
    || bundle.appsScriptCommit !== bundle.commit || !Number.isSafeInteger(bundle.appsScriptVersion) || bundle.appsScriptVersion < 1) fail('ARTIFACT_MISMATCH');
  return { ok: true, mode: 'read-only-rehearsal', commit: bundle.commit, preservesBusinessData: true,
    deploymentPerformed: false, note: 'Normal release authorization and current live health are still required.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [operation, recordPath, site, healthPath, scriptEvidencePath] = process.argv.slice(2);
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    const health = JSON.parse(fs.readFileSync(healthPath, 'utf8'));
    const artifact = await verifyReleaseArtifact(site, { GITHUB_SHA: record.commit,
      EXPECTED_RELEASE_DIGEST: record.digest || record.artifactDigest, CI: '1' });
    if (operation === 'capture') console.log(JSON.stringify(buildRecoveryBundle({ proof: record, artifact, diagnostics: health,
      appsScriptEvidence: JSON.parse(fs.readFileSync(scriptEvidencePath, 'utf8')) }), null, 2));
    else if (operation === 'rehearse') {
      requireCurrentHealth(health);
      console.log(JSON.stringify(rehearseRecovery(record, { artifact, migrationDigest: health.checks?.database?.migrationDigest })));
    } else fail('USAGE_CAPTURE_OR_REHEARSE');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
