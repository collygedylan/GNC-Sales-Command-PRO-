import { createHash } from 'node:crypto';
import { appendFile, lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeCommit, normalizeRelease, verifyDeploymentFingerprint } from './deployment-fingerprint-lib.mjs';

const MANIFEST = 'release-manifest.json';
const SCHEMA = 'gnc-release-artifact-v1';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };

function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || /[\x00-\x1f\x7f:]/.test(value)
      || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) fail('RELEASE_ARTIFACT_PATH_INVALID');
  return value;
}

async function siteDirectory(site) {
  const resolved = path.resolve(site);
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('RELEASE_ARTIFACT_ROOT_INVALID');
  return realpath(resolved);
}

async function inventory(root, directory = root) {
  const rows = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const target = path.join(directory, entry.name);
    const relative = safeRelative(path.relative(root, target).split(path.sep).join('/'));
    const info = await lstat(target);
    if (info.isSymbolicLink()) fail('RELEASE_ARTIFACT_SYMLINK_FORBIDDEN');
    if (info.isDirectory()) rows.push(...await inventory(root, target));
    else if (info.isFile()) {
      if (relative === MANIFEST) continue;
      const bytes = await readFile(target);
      rows.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
    } else fail('RELEASE_ARTIFACT_FILE_TYPE_INVALID');
  }
  return rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

async function checkFingerprints(root, commit, release = '') {
  const current = JSON.parse(await readFile(path.join(root, 'deployment.json'), 'utf8'));
  const expectedRelease = normalizeRelease(release || current.release);
  if (!expectedRelease || !verifyDeploymentFingerprint(current, { release: expectedRelease, commit }).ok) fail('RELEASE_ARTIFACT_FINGERPRINT_MISMATCH');
  const immutable = JSON.parse(await readFile(path.join(root, 'deployments', `${commit}.json`), 'utf8'));
  if (!verifyDeploymentFingerprint(immutable, { release: expectedRelease, commit }).ok
      || JSON.stringify(current) !== JSON.stringify(immutable)) fail('RELEASE_ARTIFACT_FINGERPRINT_MISMATCH');
  const appManifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (normalizeRelease(appManifest.version) !== expectedRelease) fail('RELEASE_ARTIFACT_RELEASE_MISMATCH');
  return expectedRelease;
}

function expectedCommit(env) {
  const commit = normalizeCommit(env.GITHUB_SHA || env.DEPLOYMENT_COMMIT);
  if (!commit) fail('RELEASE_ARTIFACT_EXPECTED_COMMIT_REQUIRED');
  return commit;
}

export async function sealReleaseArtifact(site = '_site', env = process.env) {
  const commit = expectedCommit(env);
  const root = await siteDirectory(site);
  const files = await inventory(root);
  const release = await checkFingerprints(root, commit);
  const manifest = { schemaVersion: SCHEMA, commit, release, files };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  // Never overwrite a previous seal: consumers may only verify the build artifact.
  await writeFile(path.join(root, MANIFEST), serialized, { encoding: 'utf8', flag: 'wx' });
  const digest = sha256(Buffer.from(serialized));
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `digest=${digest}\n`, 'utf8');
  return { digest, commit, release, fileCount: files.length };
}

export async function verifyReleaseArtifact(site = '_site', env = process.env) {
  const commit = expectedCommit(env);
  const requiredDigest = String(env.EXPECTED_RELEASE_DIGEST || '').trim().toLowerCase();
  if ((env.CI && !requiredDigest) || (requiredDigest && !/^[a-f0-9]{64}$/.test(requiredDigest))) fail('RELEASE_ARTIFACT_EXPECTED_DIGEST_REQUIRED');
  const root = await siteDirectory(site);
  const manifestPath = path.join(root, MANIFEST);
  const info = await lstat(manifestPath);
  if (!info.isFile() || info.isSymbolicLink()) fail('RELEASE_ARTIFACT_MANIFEST_INVALID');
  const raw = await readFile(manifestPath);
  const digest = sha256(raw);
  if (requiredDigest && digest !== requiredDigest) fail('RELEASE_ARTIFACT_DIGEST_MISMATCH');
  const manifest = JSON.parse(raw.toString('utf8'));
  if (manifest.schemaVersion !== SCHEMA || !Array.isArray(manifest.files) || manifest.commit !== commit
      || !normalizeRelease(manifest.release)) fail('RELEASE_ARTIFACT_MANIFEST_INVALID');
  let previous = '';
  for (const entry of manifest.files) {
    const relative = safeRelative(entry.path);
    if (relative === MANIFEST || relative <= previous || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0
        || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')
        || Object.keys(entry).sort().join(',') !== 'bytes,path,sha256') fail('RELEASE_ARTIFACT_MANIFEST_INVALID');
    previous = relative;
  }
  const files = await inventory(root);
  if (JSON.stringify(files) !== JSON.stringify(manifest.files)) fail('RELEASE_ARTIFACT_CONTENT_MISMATCH');
  await checkFingerprints(root, commit, manifest.release);
  return { digest, commit, release: manifest.release, fileCount: files.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [operation, site = '_site', ...extra] = process.argv.slice(2);
    if (extra.length || !['seal', 'verify'].includes(operation)) fail('USAGE: release-artifact.mjs seal|verify [site-directory]');
    const result = operation === 'seal' ? await sealReleaseArtifact(site) : await verifyReleaseArtifact(site);
    console.log(`RELEASE_ARTIFACT_${operation.toUpperCase()}_OK ${result.commit} ${result.digest} ${result.fileCount} files`);
  } catch (error) {
    console.error(String(error && error.message || 'RELEASE_ARTIFACT_FAILED'));
    process.exitCode = 1;
  }
}
