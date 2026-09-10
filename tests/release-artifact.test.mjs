import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { sealReleaseArtifact, verifyReleaseArtifact } from '../scripts/release-artifact.mjs';
import { buildDeploymentFingerprint } from '../scripts/deployment-fingerprint-lib.mjs';

const commit = 'a'.repeat(40);
const release = 'V2026.09.09.08';
const digestOf = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gnc-release-artifact-'));
  t.after(async () => {
    // The test owns only this freshly created temporary directory, never the repository.
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^gnc-release-artifact-[a-zA-Z0-9]+$/);
    assert.equal((await lstat(directory)).isSymbolicLink(), false);
    await rm(directory, { recursive: true, force: false });
  });
  const site = path.join(directory, '_site');
  await mkdir(path.join(site, 'deployments'), { recursive: true });
  await mkdir(path.join(site, 'assets', '.hidden'), { recursive: true });
  const fingerprint = JSON.stringify(buildDeploymentFingerprint({ release, commit, generatedAt: '2026-09-09T00:00:00.000Z' }));
  await Promise.all([
    writeFile(path.join(site, 'deployment.json'), fingerprint),
    writeFile(path.join(site, 'deployments', `${commit}.json`), fingerprint),
    writeFile(path.join(site, 'manifest.json'), JSON.stringify({ version: release })),
    writeFile(path.join(site, 'index.html'), '<html>immutable release</html>'),
    writeFile(path.join(site, '.nojekyll'), ''),
    writeFile(path.join(site, 'assets', '.hidden', 'cache.json'), '{"ready":true}'),
  ]);
  return { directory, site, env: { DEPLOYMENT_COMMIT: commit } };
}

async function sealed(t) {
  const result = await fixture(t);
  const seal = await sealReleaseArtifact(result.site, result.env);
  return { ...result, seal, verifyEnv: { ...result.env, CI: 'true', EXPECTED_RELEASE_DIGEST: seal.digest } };
}

async function rewriteManifest(site, change) {
  const target = path.join(site, 'release-manifest.json');
  const value = JSON.parse(await readFile(target, 'utf8'));
  change(value);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(target, bytes);
  return digestOf(bytes);
}

test('seals deterministic bytes, hidden files, and a single immutable manifest', async t => {
  const a = await fixture(t);
  const b = await fixture(t);
  const output = path.join(a.directory, 'github-output');
  const seal = await sealReleaseArtifact(a.site, { GITHUB_SHA: commit, GITHUB_OUTPUT: output });
  const second = await sealReleaseArtifact(b.site, b.env);
  assert.equal(seal.digest, second.digest);
  assert.equal(await readFile(output, 'utf8'), `digest=${seal.digest}\n`);
  const manifest = JSON.parse(await readFile(path.join(a.site, 'release-manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 'gnc-release-artifact-v1');
  assert.equal(manifest.commit, commit);
  assert.equal(manifest.release, release);
  assert.equal(manifest.files.length, 6);
  assert.ok(manifest.files.some(row => row.path === '.nojekyll' && row.bytes === 0));
  assert.ok(manifest.files.some(row => row.path === 'assets/.hidden/cache.json'));
  assert.ok(!manifest.files.some(row => row.path === 'release-manifest.json'));
  assert.deepEqual(await verifyReleaseArtifact(a.site, { ...a.env, CI: 'true', EXPECTED_RELEASE_DIGEST: seal.digest }), seal);
  await assert.rejects(sealReleaseArtifact(a.site, a.env), { code: 'EEXIST' });
});

for (const mutation of ['tampered', 'missing', 'extra', 'hidden']) {
  test(`rejects ${mutation} files in a sealed release`, async t => {
    const { site, verifyEnv } = await sealed(t);
    if (mutation === 'tampered') await writeFile(path.join(site, 'index.html'), '<html>changed</html>');
    if (mutation === 'missing') await rm(path.join(site, 'index.html'));
    if (mutation === 'extra') await writeFile(path.join(site, 'unexpected.js'), 'alert(1)');
    if (mutation === 'hidden') await writeFile(path.join(site, 'assets', '.hidden', 'cache.json'), '{}');
    await assert.rejects(verifyReleaseArtifact(site, verifyEnv), /RELEASE_ARTIFACT_CONTENT_MISMATCH/);
  });
}

test('requires the upstream seal digest in CI and rejects mismatched or malformed digests', async t => {
  const { site, env } = await sealed(t);
  await assert.rejects(verifyReleaseArtifact(site, { ...env, CI: 'true' }), /EXPECTED_DIGEST_REQUIRED/);
  await assert.rejects(verifyReleaseArtifact(site, { ...env, EXPECTED_RELEASE_DIGEST: 'invalid' }), /EXPECTED_DIGEST_REQUIRED/);
  await assert.rejects(verifyReleaseArtifact(site, { ...env, EXPECTED_RELEASE_DIGEST: '0'.repeat(64) }), /DIGEST_MISMATCH/);
});

test('detects manifest tampering before trusting its file inventory', async t => {
  const { site, verifyEnv } = await sealed(t);
  await rewriteManifest(site, manifest => { manifest.files = []; });
  await assert.rejects(verifyReleaseArtifact(site, verifyEnv), /DIGEST_MISMATCH/);
});

test('requires expected commit and rejects another commit or mismatched fingerprints', async t => {
  const { site, env, verifyEnv } = await sealed(t);
  await assert.rejects(verifyReleaseArtifact(site, {}), /EXPECTED_COMMIT_REQUIRED/);
  await assert.rejects(verifyReleaseArtifact(site, { ...verifyEnv, GITHUB_SHA: 'b'.repeat(40) }), /MANIFEST_INVALID/);
  const other = await fixture(t);
  await writeFile(path.join(other.site, 'deployment.json'), JSON.stringify(buildDeploymentFingerprint({ release, commit: 'b'.repeat(40) })));
  await assert.rejects(sealReleaseArtifact(other.site, env), /FINGERPRINT_MISMATCH/);
});

test('checks immutable fingerprint parity and manifest release before sealing', async t => {
  const a = await fixture(t);
  await writeFile(path.join(a.site, 'deployments', `${commit}.json`), JSON.stringify(buildDeploymentFingerprint({ release, commit, generatedAt: 'different' })));
  await assert.rejects(sealReleaseArtifact(a.site, a.env), /FINGERPRINT_MISMATCH/);
  const b = await fixture(t);
  await writeFile(path.join(b.site, 'manifest.json'), JSON.stringify({ version: 'V2026.09.09.07' }));
  await assert.rejects(sealReleaseArtifact(b.site, b.env), /RELEASE_MISMATCH/);
});

for (const invalidPath of ['../outside.txt', '/absolute.txt', 'assets/../index.html', 'assets\\escape.js', 'C:/escape.js', 'assets//empty']) {
  test(`rejects unsafe manifest path ${invalidPath}`, async t => {
    const { site, verifyEnv } = await sealed(t);
    const digest = await rewriteManifest(site, value => { value.files[0].path = invalidPath; });
    await assert.rejects(verifyReleaseArtifact(site, { ...verifyEnv, EXPECTED_RELEASE_DIGEST: digest }), /PATH_INVALID/);
  });
}

test('rejects duplicate and unordered file paths even with a trusted manifest digest', async t => {
  const { site, verifyEnv } = await sealed(t);
  const digest = await rewriteManifest(site, value => { value.files[1] = value.files[0]; });
  await assert.rejects(verifyReleaseArtifact(site, { ...verifyEnv, EXPECTED_RELEASE_DIGEST: digest }), /MANIFEST_INVALID/);
});

test('rejects a linked release directory and linked content without following it', async t => {
  const { directory, site, env, verifyEnv } = await sealed(t);
  const alias = path.join(directory, 'linked-site');
  const outside = path.join(directory, 'external-assets');
  await mkdir(outside);
  await writeFile(path.join(outside, 'do-not-publish.txt'), 'outside release');
  try {
    await symlink(site, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await symlink(outside, path.join(site, 'linked-assets'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip(`Symlinks unavailable: ${error.code}`);
    throw error;
  }
  // Remove links explicitly before the fixture's recursive cleanup; never traverse their targets.
  try {
    await assert.rejects(verifyReleaseArtifact(alias, verifyEnv), /ROOT_INVALID/);
    await assert.rejects(verifyReleaseArtifact(site, verifyEnv), /SYMLINK_FORBIDDEN/);
    await assert.rejects(sealReleaseArtifact(site, env), /SYMLINK_FORBIDDEN/);
  } finally {
    await rm(path.join(site, 'linked-assets'), { force: true });
    await rm(alias, { force: true });
  }
});
