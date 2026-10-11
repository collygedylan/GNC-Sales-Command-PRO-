import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { prepareBrandingAssets, readBrandingCatalog } from '../scripts/branding-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const mimeTypes = { '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

let fixtureRoot;
let siteRoot;
let catalog;
let canonicalImages;
let legacyWorkerSource;
let currentWorkerSource;
let server;
let origin;
let workerMode = 'current';

function fixtureHtml(catalogValue) {
  const firstCanonical = catalogValue.assets[4].file;
  const firstLegacy = catalogValue.assets[4].legacyFiles[0];
  return `<!doctype html><html><head><meta charset="utf-8"><title>Branding fixture</title><link rel="manifest" href="./manifest.json"></head><body><h1>Branding fixture</h1><img id="canonical-logo" src="./assets/branding/${firstCanonical}" alt="canonical"><img id="legacy-logo" src="./${firstLegacy}" alt="legacy"></body></html>`;
}

function oldWorkerSource(alias) {
  const cacheName = 'ag-data-v4.3-rebuild-branding-legacy-fixture';
  const absolute = `new URL(${JSON.stringify(`./${alias}`)}, self.registration.scope).href`;
  return `
const LEGACY_CACHE = ${JSON.stringify(cacheName)};
const LEGACY_URL = ${absolute};
self.addEventListener('install', event => event.waitUntil((async () => {
  const response = await fetch(LEGACY_URL, { cache: 'reload' });
  if (!response.ok) throw new Error('legacy fixture image unavailable');
  const cache = await caches.open(LEGACY_CACHE);
  await cache.put(LEGACY_URL, response);
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (new URL(event.request.url).href !== LEGACY_URL) return;
  event.respondWith(caches.open(LEGACY_CACHE).then(cache => cache.match(LEGACY_URL)).then(response => response || fetch(event.request)));
});
`;
}

function contentType(filename) {
  return mimeTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

async function serveFixture(request, response) {
  const url = new URL(request.url || '/', origin);
  if (url.pathname === '/sw.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    response.end(workerMode === 'legacy' ? legacyWorkerSource : currentWorkerSource);
    return;
  }
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filename = path.resolve(siteRoot, `.${requested}`);
  const resolvedRoot = await realpath(siteRoot);
  if (!filename.startsWith(`${resolvedRoot}${path.sep}`) && filename !== resolvedRoot) {
    response.writeHead(403).end();
    return;
  }
  try {
    const info = await stat(filename);
    if (!info.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' });
    const bytes = await readFile(filename);
    response.writeHead(200, { 'content-type': contentType(filename), 'content-length': bytes.length, 'cache-control': 'no-store' });
    response.end(bytes);
  } catch (error) {
    // The real worker precaches the full shell. This fixture intentionally only
    // materializes branding files, so satisfy unrelated shell requests quickly.
    response.writeHead(error.code === 'ENOENT' ? 200 : 500, { 'content-type': contentType(filename), 'cache-control': 'no-store' }).end();
  }
}

test.before(async () => {
  catalog = await readBrandingCatalog(root);
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'gnc-branding-browser-'));
  siteRoot = path.join(fixtureRoot, 'site');
  await mkdir(siteRoot, { recursive: true });
  await copyFile(path.join(root, 'sw.js'), path.join(siteRoot, 'sw.js'));
  await copyFile(path.join(root, 'manifest.json'), path.join(siteRoot, 'manifest.json'));
  await writeFile(path.join(siteRoot, 'index.html'), fixtureHtml(catalog));
  const prepared = await prepareBrandingAssets({ root, site: siteRoot });
  assert.deepEqual(prepared, {
    canonicalCount: 9,
    legacyCount: 30,
    canonicalBytes: 1_456_461,
  });
  currentWorkerSource = await readFile(path.join(siteRoot, 'sw.js'), 'utf8');
  const compatibilityAsset = catalog.assets.find(asset => asset.legacyFiles.length > 1);
  assert.ok(compatibilityAsset, 'catalog should include a historic filename alias');
  legacyWorkerSource = oldWorkerSource(compatibilityAsset.legacyFiles[0]);
  canonicalImages = new Map(await Promise.all(catalog.assets.map(async asset => [asset.file, await readFile(path.join(siteRoot, 'assets/branding', asset.file))])));
  server = createServer((request, response) => { void serveFixture(request, response); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (fixtureRoot) {
    const tempRoot = await realpath(os.tmpdir());
    const fixturePath = await realpath(fixtureRoot);
    const fixtureStat = await lstat(fixtureRoot);
    assert.equal(path.dirname(fixturePath).toLowerCase(), tempRoot.toLowerCase(), 'fixture must be a direct child of the system temp directory');
    assert.match(path.basename(fixturePath), /^gnc-branding-browser-/);
    assert.ok(fixtureStat.isDirectory() && !fixtureStat.isSymbolicLink(), 'fixture cleanup target must be a real directory');
    assert.equal(fixturePath.toLowerCase(), path.resolve(fixtureRoot).toLowerCase(), 'fixture path must not traverse a reparse point');
    await rm(fixturePath, { recursive: true });
  }
});

test.beforeEach(() => { workerMode = 'current'; });

async function createBrowserFixture(engine, t) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  context.setDefaultTimeout(10_000);
  context.setDefaultNavigationTimeout(15_000);
  t.after(async () => { await context.close(); await browser.close(); });
  context.on('request', request => {
    if (new URL(request.url()).origin !== origin) assert.fail(`Unexpected external request: ${request.url()}`);
  });
  const page = await context.newPage();
  await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
  return { browser, context, page };
}

async function fetchImageDetails(page, url) {
  return page.evaluate(async requested => {
    const response = await fetch(requested, { cache: 'reload' });
    if (!response.ok) return { status: response.status, contentType: response.headers.get('content-type'), size: 0, width: 0, height: 0, bytes: [] };
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    const result = { status: response.status, contentType: response.headers.get('content-type'), size: blob.size, width: bitmap.width, height: bitmap.height, sha256 };
    bitmap.close();
    return result;
  }, url);
}

async function registerCurrentWorker(page) {
  await page.evaluate(async () => {
    const ready = (async () => {
      const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
      return registration;
    })();
    const registration = await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('service worker activation timed out')), 20_000))]);
    if (!registration.active) throw new Error('branding worker did not activate');
  });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

for (const [engineName, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
test(`${engineName} loads canonical and legacy branding images and manifest icons`, { timeout: 120_000 }, async t => {
    const { context, page } = await createBrowserFixture(engine, t);
    const initialImages = await page.evaluate(() => [...document.images].map(image => ({ id: image.id, loaded: image.complete && image.naturalWidth > 0 })));
    assert.deepEqual(initialImages, [{ id: 'canonical-logo', loaded: true }, { id: 'legacy-logo', loaded: true }]);
    const manifest = JSON.parse(await readFile(path.join(siteRoot, 'manifest.json'), 'utf8'));
    for (const icon of manifest.icons) {
      const image = await fetchImageDetails(page, icon.src);
      assert.equal(image.status, 200, `manifest icon must load: ${icon.src}`);
      assert.ok(image.width > 0 && image.height > 0);
    }
    for (const asset of catalog.assets) {
      const canonical = await fetchImageDetails(page, `./assets/branding/${asset.file}`);
      assert.equal(canonical.status, 200, `canonical image must load: ${asset.file}`);
      assert.equal(canonical.size, asset.bytes);
      assert.equal(canonical.sha256, asset.sha256);
      for (const alias of asset.legacyFiles) {
        const legacy = await fetchImageDetails(page, `./${alias}`);
        assert.equal(legacy.status, 200, `legacy filename must load: ${alias}`);
        assert.equal(legacy.sha256, canonical.sha256, `legacy URL must return the canonical bytes: ${alias}`);
      }
    }
  });
}

test('Chromium fresh install serves canonical branding assets offline', { timeout: 120_000 }, async t => {
  const { context, page } = await createBrowserFixture(chromium, t);
  await registerCurrentWorker(page);
  const workerCache = await page.evaluate(async () => {
    const names = await caches.keys();
    const name = names.find(cache => cache.startsWith('ag-data-v4.3-rebuild-') && cache.includes('-scope-r1'));
    if (!name) throw new Error('current root shell cache missing');
    const cache = await caches.open(name);
    const requests = await cache.keys();
    return { entries: requests.map(request => new URL(request.url).pathname) };
  });
  assert.ok(workerCache.entries.some(entry => entry.endsWith('/assets/branding/ag-data-solutions-icon-v2026080925-192.png')));
  await context.setOffline(true);
  for (const asset of catalog.assets) {
    const image = await fetchImageDetails(page, `./assets/branding/${asset.file}`);
    assert.equal(image.status, 200, `canonical image must load offline: ${asset.file}`);
    assert.equal(image.size, asset.bytes);
    assert.equal(image.sha256, asset.sha256);
  }
});

test('Chromium updated worker serves an old shell branding URL offline', { timeout: 120_000 }, async t => {
    workerMode = 'legacy';
    const { context, page } = await createBrowserFixture(chromium, t);
    const compatibilityAsset = catalog.assets.find(asset => asset.legacyFiles.length > 1);
    const legacyName = compatibilityAsset.legacyFiles[0];
    const canonicalBytes = canonicalImages.get(compatibilityAsset.file);
    await registerCurrentWorker(page);
    const oldResponse = await fetchImageDetails(page, `./${legacyName}`);
    assert.equal(oldResponse.status, 200);
    assert.equal(oldResponse.sha256, sha256(canonicalBytes));
    const oldWorkerStatus = await page.evaluate(() => navigator.serviceWorker.controller?.state || '');
    assert.equal(oldWorkerStatus, 'activated');
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('./');
      if (!registration?.active) throw new Error('legacy worker registration missing');
      window.__legacyBrandingWorker = registration.active;
    });
    workerMode = 'current';
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('./');
      await registration.update();
    });
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration('./');
      return Boolean(registration?.active && registration.active !== window.__legacyBrandingWorker);
    }, null, { timeout: 20_000 });
    await context.setOffline(true);
    const afterUpdate = await fetchImageDetails(page, `./${legacyName}`);
    assert.equal(afterUpdate.status, 200);
    assert.equal(afterUpdate.contentType, 'image/png');
    assert.equal(afterUpdate.sha256, sha256(canonicalBytes));
    assert.ok(afterUpdate.width > 0 && afterUpdate.height > 0);
});

if (process.env.GNC_BROWSER_ASSET_ROOT) {
  test('sealed release includes every catalog image and generated compatibility alias', async () => {
    const releaseRoot = path.resolve(root, process.env.GNC_BROWSER_ASSET_ROOT);
    const releaseCatalog = JSON.parse(await readFile(path.join(releaseRoot, 'assets/branding/catalog.json'), 'utf8'));
    assert.deepEqual(releaseCatalog, catalog);
    const worker = await readFile(path.join(releaseRoot, 'sw.js'), 'utf8');
    assert.ok(worker.includes('// BEGIN GENERATED BRANDING ASSETS'));
    for (const asset of catalog.assets) {
      const canonical = await readFile(path.join(releaseRoot, 'assets/branding', asset.file));
      assert.equal(canonical.length, asset.bytes);
      assert.equal(sha256(canonical), asset.sha256);
      for (const alias of asset.legacyFiles) {
        assert.deepEqual(await readFile(path.join(releaseRoot, alias)), canonical, `sealed alias drift: ${alias}`);
      }
    }
  });
}
