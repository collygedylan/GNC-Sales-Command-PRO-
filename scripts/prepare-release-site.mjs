import { copyFile, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareBrandingAssets } from './branding-assets.mjs';
import { readExpectedRelease } from './deployment-fingerprint-lib.mjs';
import { prepareReleaseSiteDirectory, releaseSiteDirectory } from './release-disk-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = releaseSiteDirectory(root);
const files = [
  'index.html', 'manifest.json', 'sw.js', 'CNAME', '.nojekyll', 'OneSignalSDKWorker.js',
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
  await prepareReleaseSiteDirectory(root, { clear: true });
  // This small module has editable page/service sources outside assets. Compile
  // it here too so a scoped local release never packages a stale checked-in copy.
  const scheduleBuild = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-production-schedule.mjs')],
    { cwd: root, stdio: 'inherit', windowsHide: true });
  if (scheduleBuild.error || scheduleBuild.status !== 0) throw new Error('RELEASE_PREPARATION_FAILED_SCHEDULE');
  // CI supplies freshly compiled inputs. Repair only missing/wrong-release
  // local prerequisites here; matching labels do not verify same-version source freshness.
  const v2Output = await lstat(path.join(root, 'v2', 'dist')).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (v2Output && (!v2Output.isDirectory() || v2Output.isSymbolicLink())) throw new Error('RELEASE_V2_OUTPUT_INVALID');
  const v2Release = await readExpectedRelease(root);
  let v2Manifest = null;
  try { v2Manifest = JSON.parse(await readFile(path.join(root, 'v2', 'dist', 'manifest.webmanifest'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  if (!v2Output || v2Manifest?.version !== v2Release
      || v2Manifest?.start_url !== `./?shellv=${encodeURIComponent(v2Release)}`) {
    const v2Build = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build', '--config', 'vite.v2.config.ts'], { cwd: root, stdio: 'inherit', windowsHide: true });
    if (v2Build.error || v2Build.status !== 0) throw new Error('RELEASE_PREPARATION_FAILED_V2');
  }
  await mkdir(site, { recursive: true });
  for (const name of files) await copyTree(path.join(root, name), path.join(site, name));
  await copyTree(path.join(root, 'assets'), path.join(site, 'assets'));
  await prepareBrandingAssets({ root, site });
  // Native AURA modules stay out of the public shell bundle and are fetched
  // only after the verified owner signs in. Their relative ESM imports require
  // the same directory layout in the static site.
  for (const directory of ['services', 'utils', 'components/common']) await mkdir(path.join(site, directory), { recursive: true });
  await copyTree(path.join(root, 'services', 'auraVoiceService.js'), path.join(site, 'services', 'auraVoiceService.js'));
  await copyTree(path.join(root, 'services', 'auraConversation.js'), path.join(site, 'services', 'auraConversation.js'));
  await copyTree(path.join(root, 'services', 'auraGeminiSpeech.js'), path.join(site, 'services', 'auraGeminiSpeech.js'));
  await copyTree(path.join(root, 'utils', 'auraIntentParser.js'), path.join(site, 'utils', 'auraIntentParser.js'));
  await copyTree(path.join(root, 'utils', 'auraLingo.js'), path.join(site, 'utils', 'auraLingo.js'));
  await copyTree(path.join(root, 'components', 'common', 'auraVoiceWidget.js'), path.join(site, 'components', 'common', 'auraVoiceWidget.js'));
  await copyTree(path.join(root, 'components', 'common', 'auraQueryPanel.js'), path.join(site, 'components', 'common', 'auraQueryPanel.js'));
  // The top-level widget URL is versioned by the shell. Version its relative
  // imports too: bypassing a service worker alone does not bypass HTTP caches.
  const auraRelease = await readExpectedRelease(root);
  for (const file of ['components/common/auraVoiceWidget.js', 'utils/auraIntentParser.js']) {
    const target = path.join(site, file);
    const source = await readFile(target, 'utf8');
    await writeFile(target, source.replace(/from\s+(["'])(\.\.?\/[^"']+\.js)\1/g,
      (_match, quote, specifier) => `from ${quote}${specifier}?v=${encodeURIComponent(auraRelease)}${quote}`), 'utf8');
  }
  await copyTree(path.join(root, 'reports'), path.join(site, 'reports'));
  await copyTree(path.join(root, 'v2', 'dist'), path.join(site, 'v2'));
  const shellBuild = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-live-shell.mjs')], {
    cwd: root, stdio: 'inherit', env: { ...process.env, LIVE_SITE_DIR: site, DEPLOYMENT_SITE_DIR: site },
  });
  if (shellBuild.error || shellBuild.status !== 0) throw new Error('RELEASE_PREPARATION_FAILED_build-live-shell.mjs');
  // The extracted sources are build inputs; the deployed shell uses the single
  // versioned runtime and two cascade-preserving CSS bundles instead.
  await Promise.all(['app-runtime.js', ...Array.from({ length: 15 }, (_, index) =>
    `app-shell-style-${String(index + 1).padStart(2, '0')}.css`)].map(name =>
    writeFile(path.join(site, 'assets', name), '')));
  const fingerprint = spawnSync(process.execPath, [path.join(root, 'scripts', 'write-deployment-fingerprint.mjs')], {
    cwd: root, stdio: 'inherit', env: { ...process.env, LIVE_SITE_DIR: site, DEPLOYMENT_SITE_DIR: site },
  });
  if (fingerprint.error || fingerprint.status !== 0) throw new Error('RELEASE_PREPARATION_FAILED_write-deployment-fingerprint.mjs');
  if ((await stat(path.join(site, 'index.html'))).size > 1_500_000) throw new Error('RELEASE_INDEX_TOO_LARGE');
  const html = await readFile(path.join(site, 'index.html'), 'utf8');
  const assetVersion = v2Release.replace(/^AgData v/, '');
  for (const match of html.matchAll(/<(?:link|script)\b[^>]*(?:href|src)="(\.\/assets\/[^"?]+\.(?:css|js)(?:\?[^"]*)?)"/g)) {
    const assetUrl = new URL(match[1], 'https://release.invalid');
    const version = assetUrl.searchParams.get('v');
    const isScopedAssetHotfix = version === `${assetVersion}.1`
      && ['/assets/mobile-workspace.js', '/assets/photo-history-v2026090401.js', '/assets/inventory-list-contract.js',
        '/assets/live-app-styles-base-v2026090503.css'].includes(assetUrl.pathname);
    if (version !== assetVersion && !isScopedAssetHotfix) throw new Error('RELEASE_ASSET_VERSION_MISMATCH: ' + match[1]);
  }
  if (/cdn\.tailwindcss\.com|unpkg\.com\/@phosphor-icons|cdn\.jsdelivr\.net\/npm\/@supabase/.test(html)) throw new Error('RELEASE_EXTERNAL_CDN_FORBIDDEN');
  console.log('RELEASE_SITE_PREPARED');
} catch (error) {
  console.error(String(error && error.message || 'RELEASE_PREPARATION_FAILED'));
  process.exitCode = 1;
}
