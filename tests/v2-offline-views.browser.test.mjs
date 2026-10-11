import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startReleaseTestServer } from '../scripts/serve-release-tests.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const releaseRoot = path.resolve(repositoryRoot, process.env.GNC_BROWSER_ASSET_ROOT || '_site');
const manifestPath = path.join(releaseRoot, 'v2', '.vite', 'manifest.json');

async function readDynamicChunk(source) {
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch { throw new Error(`Compiled V2 manifest is missing under ${releaseRoot}; use a sealed release artifact.`); }
  const entry = manifest[source];
  if (!entry?.isDynamicEntry || typeof entry.file !== 'string') throw new Error(`V2_ROUTE_CHUNK_MISSING:${source}`);
  return entry.file;
}

test('V2 precache opens Que and Drive in a fresh offline tab without fetching production data', async t => {
  const requestChunk = await readDynamicChunk('src/pages/RequestQueue.tsx');
  const driveChunk = await readDynamicChunk('src/components/DriveInventory.tsx');
  const server = await startReleaseTestServer({ siteDir: releaseRoot, port: 0 });
  const browser = await chromium.launch({ headless: true });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({ baseURL: origin, serviceWorkers: 'allow', viewport: { width: 820, height: 1180 } });

  t.after(async () => {
    await context.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  });

  await context.route('**/runtime-config.json', route => route.fulfill({ json: {
    environment: 'sandbox', testData: true, projectRef: 'performance', productionProjectRef: 'production-blocked',
    supabaseUrl: 'https://performance.supabase.co', publishableKey: 'sb_publishable_synthetic_fixture'
  } }));
  await context.route('https://performance.supabase.co/**', route => route.abort('internetdisconnected'));

  const warmPage = await context.newPage();
  await warmPage.goto('/v2/#home');
  await warmPage.locator('.home-dashboard').waitFor();
  await warmPage.evaluate(async () => { await navigator.serviceWorker.ready; });
  await warmPage.reload();
  await warmPage.locator('.home-dashboard').waitFor();
  await warmPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  const cachedPaths = await warmPage.evaluate(async () => {
    const names = await caches.keys();
    const precache = names.find(name => name.includes('precache'));
    if (!precache) throw new Error('V2_PRECACHE_NOT_READY');
    const cache = await caches.open(precache);
    return (await cache.keys()).map(request => new URL(request.url).pathname);
  });
  assert.ok(cachedPaths.includes(`/v2/${requestChunk}`), 'Queue chunk was not precached');
  assert.ok(cachedPaths.includes(`/v2/${driveChunk}`), 'Drive chunk was not precached');

  await context.setOffline(true);
  const coldPage = await context.newPage();
  await coldPage.goto('/v2/#home');
  await coldPage.locator('.home-dashboard').waitFor();
  await coldPage.evaluate(() => { window.location.hash = 'request'; });
  await coldPage.locator('.request-card').first().waitFor();
  await coldPage.evaluate(() => { window.location.hash = 'drive'; });
  await coldPage.locator('.drive-inventory').waitFor();
  assert.equal(await coldPage.locator('.drive-search input').inputValue(), '');
});
