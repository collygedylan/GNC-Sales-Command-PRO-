import { copyFile, lstat, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, '_site');
const files = [
  'index.html', 'manifest.json', 'sw.js', 'CNAME', '.nojekyll', 'OneSignalSDKWorker.js',
  'ag-data-solutions-logo-v2026080923.png', 'ag-data-solutions-splash-v2026080923.png',
  'ag-data-solutions-icon-v2026080923-32.png', 'ag-data-solutions-icon-v2026080923-180.png',
  'ag-data-solutions-icon-v2026080923-192.png', 'ag-data-solutions-icon-v2026080923-512.png',
  'ag-data-solutions-logo-v2026080925.png', 'ag-data-solutions-logo-v2026090503-224.webp',
  'ag-data-solutions-logo-v2026090503-448.webp', 'ag-data-solutions-splash-v2026080925.png',
  'ag-data-solutions-splash-v2026081702.png', 'ag-data-solutions-splash-v2026081705.png',
  'ag-data-solutions-splash-v2026081706.png', 'ag-data-solutions-splash-v2026081708.png',
  'ag-data-solutions-splash-v2026081709.png', 'ag-data-solutions-icon-v2026080925-32.png',
  'ag-data-solutions-icon-v2026080925-180.png', 'ag-data-solutions-icon-v2026080925-192.png',
  'ag-data-solutions-icon-v2026080925-512.png',
];

async function copyTree(source, destination) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error('RELEASE_SOURCE_SYMLINK_FORBIDDEN');
  const sourceReal = await realpath(source);
  const relative = path.relative(root, sourceReal);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('RELEASE_SOURCE_OUTSIDE_WORKSPACE');
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const name of (await readdir(source)).sort()) await copyTree(path.join(source, name), path.join(destination, name));
  } else if (info.isFile()) await copyFile(source, destination);
  else throw new Error('RELEASE_SOURCE_FILE_TYPE_INVALID');
}

try {
  const existing = await lstat(site).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || (await readdir(site)).length)) throw new Error('RELEASE_SITE_MUST_BE_EMPTY');
  await mkdir(site, { recursive: true });
  for (const name of files) await copyTree(path.join(root, name), path.join(site, name));
  await copyTree(path.join(root, 'assets'), path.join(site, 'assets'));
  await copyTree(path.join(root, 'reports'), path.join(site, 'reports'));
  await copyTree(path.join(root, 'v2', 'dist'), path.join(site, 'v2'));
  for (const script of ['build-live-shell.mjs', 'write-deployment-fingerprint.mjs']) {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
      cwd: root, stdio: 'inherit', env: { ...process.env, LIVE_SITE_DIR: site, DEPLOYMENT_SITE_DIR: site },
    });
    if (result.error || result.status !== 0) throw new Error(`RELEASE_PREPARATION_FAILED_${script}`);
  }
  if ((await stat(path.join(site, 'index.html'))).size > 1_500_000) throw new Error('RELEASE_INDEX_TOO_LARGE');
  const html = await readFile(path.join(site, 'index.html'), 'utf8');
  if (/cdn\.tailwindcss\.com|unpkg\.com\/@phosphor-icons|cdn\.jsdelivr\.net\/npm\/@supabase/.test(html)) throw new Error('RELEASE_EXTERNAL_CDN_FORBIDDEN');
  console.log('RELEASE_SITE_PREPARED');
} catch (error) {
  console.error(String(error && error.message || 'RELEASE_PREPARATION_FAILED'));
  process.exitCode = 1;
}
