import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const catalogPath = 'assets/branding/catalog.json';
const filenamePattern = /^ag-data-solutions-[a-z0-9-]+\.(?:png|webp)$/;
const startMarker = '// BEGIN GENERATED BRANDING ASSETS';
const endMarker = '// END GENERATED BRANDING ASSETS';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(`BRANDING_ASSETS: ${message}`); };

export async function readBrandingCatalog(root = repositoryRoot) {
  const catalog = JSON.parse(await readFile(path.join(root, catalogPath), 'utf8'));
  assert(catalog.schemaVersion === 1 && Array.isArray(catalog.assets) && catalog.assets.length > 0, 'invalid catalog');
  const files = new Set(), aliases = new Set(), hashes = new Set();
  for (const asset of catalog.assets) {
    assert(asset && typeof asset === 'object' && filenamePattern.test(asset.file), 'invalid canonical filename');
    assert(!files.has(asset.file) && !hashes.has(asset.sha256), 'duplicate canonical asset');
    assert(/^[a-f0-9]{64}$/.test(asset.sha256) && Number.isSafeInteger(asset.bytes) && asset.bytes > 0, 'invalid fingerprint');
    assert(Array.isArray(asset.legacyFiles) && asset.legacyFiles.includes(asset.file), 'missing legacy filenames');
    files.add(asset.file); hashes.add(asset.sha256);
    for (const alias of asset.legacyFiles) {
      assert(typeof alias === 'string' && filenamePattern.test(alias) && !aliases.has(alias), 'invalid or duplicate legacy filename');
      aliases.add(alias);
    }
  }
  return catalog;
}

async function verifiedImage(root, asset) {
  const source = path.resolve(root, 'assets/branding', asset.file);
  const resolvedRoot = await realpath(root);
  const expected = path.join(resolvedRoot, 'assets/branding', asset.file);
  assert((await lstat(source)).isFile() && (await realpath(source)) === expected, 'source must be a regular, unlinked asset');
  const bytes = await readFile(source);
  assert(bytes.length === asset.bytes && digest(bytes) === asset.sha256, `fingerprint mismatch: ${asset.file}`);
  return bytes;
}

export function renderBrandingWorkerManifest(source, catalog) {
  assert(source.split(startMarker).length === 2 && source.split(endMarker).length === 2, 'worker markers missing or duplicated');
  const aliases = Object.fromEntries(catalog.assets.flatMap(asset => asset.legacyFiles.map(alias => [`./${alias}`, `./assets/branding/${asset.file}`])));
  const canonical = catalog.assets.map(asset => `./assets/branding/${asset.file}`);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const block = (`${startMarker}\n// Derived from assets/branding/catalog.json by scripts/branding-assets.mjs.\n`
    + `const BRANDING_LEGACY_ALIASES = Object.freeze(${JSON.stringify(aliases, null, 2)});\n`
    + `const BRANDING_CANONICAL_ASSETS = Object.freeze(${JSON.stringify(canonical, null, 2)});\n${endMarker}`).replaceAll('\n', newline);
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker);
  assert(end > start, 'worker marker order invalid');
  return source.slice(0, start) + block + source.slice(end + endMarker.length);
}

export async function syncBrandingWorker(root = repositoryRoot, { check = false } = {}) {
  const catalog = await readBrandingCatalog(root);
  await Promise.all(catalog.assets.map(asset => verifiedImage(root, asset)));
  const filename = path.join(root, 'sw.js');
  const before = await readFile(filename, 'utf8');
  const after = renderBrandingWorkerManifest(before, catalog);
  if (check) assert(before === after, 'worker catalog is stale; run node scripts/branding-assets.mjs --sync-worker');
  else if (before !== after) await writeFile(filename, after);
  return catalog;
}

async function ensureOutputDirectory(directory) {
  await mkdir(directory, { recursive: true });
  assert((await lstat(directory)).isDirectory() && await realpath(directory) === path.resolve(directory), 'output directory must not contain links');
}

export async function prepareBrandingAssets({ root = repositoryRoot, site } = {}) {
  assert(typeof site === 'string' && site.length > 0 && path.resolve(site) !== path.resolve(root), 'separate output directory required');
  const relativeSource = path.relative(path.resolve(site), await realpath(root));
  assert(relativeSource === '..' || relativeSource.startsWith(`..${path.sep}`) || path.isAbsolute(relativeSource),
    'output directory must not contain the source repository');
  const catalog = await readBrandingCatalog(root);
  // Validate all source bytes before creating any public compatibility copies.
  const images = await Promise.all(catalog.assets.map(asset => verifiedImage(root, asset)));
  await ensureOutputDirectory(path.resolve(site));
  await ensureOutputDirectory(path.resolve(site, 'assets'));
  await ensureOutputDirectory(path.resolve(site, 'assets/branding'));
  const writeAsset = async (name, bytes) => {
    const target = path.join(site, name);
    const existing = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    assert(!existing || existing.isFile() && !existing.isSymbolicLink(), 'output must be a regular file');
    await writeFile(target, bytes);
  };
  for (let index = 0; index < catalog.assets.length; index++) {
    const asset = catalog.assets[index], bytes = images[index];
    await writeAsset(`assets/branding/${asset.file}`, bytes);
    for (const alias of asset.legacyFiles) await writeAsset(alias, bytes);
  }
  await writeAsset(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  const worker = path.join(site, 'sw.js');
  const rendered = renderBrandingWorkerManifest(await readFile(worker, 'utf8'), catalog);
  await writeAsset('sw.js', rendered);
  return { canonicalCount: catalog.assets.length, legacyCount: catalog.assets.reduce((sum, asset) => sum + asset.legacyFiles.length, 0),
    canonicalBytes: images.reduce((sum, bytes) => sum + bytes.length, 0) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    assert(process.argv.length === 3 && ['--check', '--sync-worker'].includes(process.argv[2]), 'usage: --check|--sync-worker');
    await syncBrandingWorker(repositoryRoot, { check: process.argv[2] === '--check' });
    console.log('Branding assets and worker catalog verified.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
