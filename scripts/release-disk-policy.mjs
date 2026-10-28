import { lstat, mkdir, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

export function releaseSiteDirectory(root, env = process.env) {
  const site = path.resolve(root, '_site');
  if (env.LIVE_SITE_DIR && path.resolve(root, env.LIVE_SITE_DIR) !== site) {
    throw new Error('RELEASE_SITE_PATH_INVALID: reuse the workspace _site directory');
  }
  return site;
}

export function localEvidenceDirectory(root) {
  const identity = createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 12);
  const base = process.platform === 'win32' && process.env.GITHUB_ACTIONS !== 'true'
    ? 'G:/My Drive/GNC/AgData/Local Validation'
    : path.join(process.env.RUNNER_TEMP || tmpdir(), 'agdata-local-validation');
  return path.join(base, `${path.basename(path.resolve(root))}-${identity}`);
}

// Validate the complete output tree before changing any file. Retain the one
// directory tree; remove stale files individually, never by recursive rm.
export async function prepareReleaseSiteDirectory(root, { clear = false, env = process.env } = {}) {
  const site = releaseSiteDirectory(root, env);
  const rootReal = await realpath(root);
  const files = [];
  async function inspect(directory) {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('RELEASE_SITE_DIRECTORY_INVALID');
    const relative = path.relative(rootReal, await realpath(directory));
    if (relative !== '_site' && !relative.startsWith(`_site${path.sep}`)) throw new Error('RELEASE_SITE_OUTSIDE_WORKSPACE');
    for (const name of await readdir(directory)) {
      const target = path.join(directory, name);
      const entry = await lstat(target);
      if (entry.isSymbolicLink()) throw new Error('RELEASE_SITE_SYMLINK_FORBIDDEN');
      if (entry.isDirectory()) await inspect(target);
      else if (entry.isFile() && entry.nlink === 1) files.push(target);
      else throw new Error('RELEASE_SITE_FILE_INVALID');
    }
  }
  const existing = await lstat(site).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing) await inspect(site);
  else await mkdir(site);
  if (clear) for (const file of files) {
    await writeFile(file, '');
    await unlink(file);
  }
  return site;
}
