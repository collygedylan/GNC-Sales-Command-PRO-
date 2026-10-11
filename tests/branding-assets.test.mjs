import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { prepareBrandingAssets, readBrandingCatalog, renderBrandingWorkerManifest, syncBrandingWorker } from '../scripts/branding-assets.mjs';
import { discoverRepositoryFiles } from '../scripts/test-discovery.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => readFile(path.join(root, file), 'utf8');

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gnc-branding-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^gnc-branding-[a-zA-Z0-9]+$/);
    assert.equal((await lstat(directory)).isSymbolicLink(), false);
    await rm(directory, { recursive: true, force: false });
  });
  return directory;
}

test('nine canonical images retain the fingerprints of all 30 historical names', async () => {
  const catalog = await readBrandingCatalog(root);
  assert.equal(catalog.assets.length, 9);
  assert.equal(catalog.assets.flatMap(asset => asset.legacyFiles).length, 30);
  assert.equal(catalog.assets.reduce((sum, asset) => sum + asset.bytes, 0), 1456461);
  assert.equal(catalog.assets.reduce((sum, asset) => sum + asset.bytes * asset.legacyFiles.length, 0), 10282691);
  for (const asset of catalog.assets) {
    const bytes = await readFile(path.join(root, 'assets/branding', asset.file));
    assert.equal(bytes.length, asset.bytes);
    assert.equal(sha256(bytes), asset.sha256);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, path.extname(asset.file).slice(1));
    if (asset.file.includes('-icon-')) {
      const size = Number(asset.file.match(/-(\d+)\.png$/)[1]);
      assert.equal(metadata.width, size);
      assert.equal(metadata.height, size);
    }
  }
  assert.deepEqual((await readdir(root)).filter(file => /\.(png|jpe?g|gif|svg|webp|ico)$/i.test(file)), []);
});

test('both manifests preserve identity and resolve icons with matching dimensions and MIME', async () => {
  const manifestFiles = ['manifest.json', 'v2/public/manifest.webmanifest'];
  for (const file of manifestFiles) {
    const manifest = JSON.parse(await read(file));
    const base = new URL(file === 'manifest.json' ? '/manifest.json' : '/v2/manifest.webmanifest', 'https://branding.test');
    for (const icon of manifest.icons) {
      const url = new URL(icon.src, base);
      assert.match(url.pathname, /^\/assets\/branding\/ag-data-solutions-icon-/);
      const bytes = await readFile(path.join(root, url.pathname.slice(1)));
      const metadata = await sharp(bytes).metadata();
      assert.equal(icon.sizes, `${metadata.width}x${metadata.height}`);
      assert.equal(icon.type, `image/${metadata.format}`);
    }
    const production = file === 'manifest.json';
    assert.equal(manifest.id, production ? './index.html?app=ag-data-solutions' : undefined);
    assert.equal(manifest.scope, './');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.name, production ? 'Ag Data Solutions' : 'GNC Field App v2');
    assert.equal(manifest.short_name, production ? 'Ag Data' : 'GNC v2');
    assert.equal(manifest.start_url.replace(/shellv=[^&]+/, 'shellv=VERSION'), production
      ? './index.html?shellv=VERSION&app=ag-data-solutions' : './?shellv=VERSION');
    for (const icon of manifest.icons) assert.equal(icon.purpose, production ? 'any maskable' : undefined);
  }
});

test('authored image references use canonical paths and every referenced branding image exists', async () => {
  const catalog = await readBrandingCatalog(root);
  const canonical = new Set(catalog.assets.map(asset => asset.file));
  const files = discoverRepositoryFiles({ root }).filter(file => /\.(?:html|css|js|mjs|jsx|ts|tsx|json|webmanifest)$/.test(file)
    && !/^(?:tests\/|v2\/tests\/|assets\/vendor\/|v2\/public\/partner\/)/.test(file)
    && file !== 'assets/branding/catalog.json');
  let references = 0;
  for (const file of files) {
    const source = (await read(file)).replace(/\/\/ BEGIN GENERATED BRANDING ASSETS[\s\S]*?\/\/ END GENERATED BRANDING ASSETS/, '');
    for (const match of source.matchAll(/ag-data-solutions-[a-z0-9-]+\.(?:png|webp)/g)) {
      assert.ok(canonical.has(match[0]), `${file}: unknown branding image ${match[0]}`);
      assert.equal(source.slice(Math.max(0, match.index - 16), match.index), 'assets/branding/', `${file}: noncanonical image reference`);
      references++;
    }
  }
  assert.ok(references > 15, 'actual shell/manifest references must be audited');
});

test('release preparation emits verified canonical bytes, all legacy URLs and a synchronized worker', async t => {
  const site = await temporaryDirectory(t);
  await writeFile(path.join(site, 'sw.js'), await read('sw.js'));
  const result = await prepareBrandingAssets({ root, site });
  assert.deepEqual(result, { canonicalCount: 9, legacyCount: 30, canonicalBytes: 1456461 });
  const catalog = await readBrandingCatalog(root);
  for (const asset of catalog.assets) {
    for (const name of [`assets/branding/${asset.file}`, ...asset.legacyFiles]) {
      assert.equal(sha256(await readFile(path.join(site, name))), asset.sha256, name);
    }
  }
  const worker = await readFile(path.join(site, 'sw.js'), 'utf8');
  assert.equal(worker, renderBrandingWorkerManifest(worker, catalog));
  assert.match(await read('scripts/prepare-release-site.mjs'), /await prepareBrandingAssets\(\{ root, site \}\)/);
  await syncBrandingWorker(root, { check: true });
});

test('packaging rejects changed bytes, unsafe aliases and stale worker mappings', async t => {
  const fixture = await temporaryDirectory(t), source = path.join(fixture, 'source'), site = path.join(fixture, 'site');
  await mkdir(path.join(source, 'assets'), { recursive: true });
  await cp(path.join(root, 'assets/branding'), path.join(source, 'assets/branding'), { recursive: true });
  const catalog = await readBrandingCatalog(source);
  const image = path.join(source, 'assets/branding', catalog.assets[0].file);
  const original = await readFile(image);
  await writeFile(image, 'changed image bytes');
  await assert.rejects(prepareBrandingAssets({ root: source, site }), /fingerprint mismatch/);
  await writeFile(image, original);
  catalog.assets[0].legacyFiles.push('../outside.png');
  await writeFile(path.join(source, 'assets/branding/catalog.json'), JSON.stringify(catalog));
  await assert.rejects(readBrandingCatalog(source), /invalid or duplicate legacy filename/);
  await assert.rejects(prepareBrandingAssets({ root, site: root }), /separate output directory required/);
  await assert.rejects(prepareBrandingAssets({ root, site: path.dirname(path.resolve(root)) }), /must not contain the source repository/);
  await cp(path.join(root, 'assets/branding/catalog.json'), path.join(source, 'assets/branding/catalog.json'));
  await writeFile(path.join(source, 'sw.js'), '// BEGIN GENERATED BRANDING ASSETS\n// stale\n// END GENERATED BRANDING ASSETS');
  await assert.rejects(syncBrandingWorker(source, { check: true }), /worker catalog is stale/);
});

test('unused archive config is removed while tagged release coverage remains', async () => {
  assert.ok(!(await readdir(root)).includes('playwright.request-archive.config.ts'));
  const spec = await read('tests/request-archive-mobile.e2e.spec.ts');
  const cases = (spec.match(/test\('/g) || []).length;
  assert.ok(cases > 0);
  assert.equal((spec.match(/"@release-functional"/g) || []).length, cases);
  assert.match(await read('playwright.release-functional.config.ts'), /grep: \/@release-functional\//);
  assert.match(await read('.github/workflows/release-validation.yml'), /config playwright\.release-functional\.config\.ts/);
});
