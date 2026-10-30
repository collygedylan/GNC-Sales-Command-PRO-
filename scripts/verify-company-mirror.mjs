import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startCompanyMirror } from './serve-company-mirror.mjs';

const seed = JSON.parse(process.env.AGDATA_PROOF_SESSION || 'null');
if (!seed?.access_token) throw new Error('AGDATA_PROOF_SESSION_REQUIRED');
const started = Date.now(), results = [];
const cachedMirror = process.argv.includes('--cached-mirror');
const server = await startCompanyMirror();
const browser = await chromium.launch({ headless: true });
const deadline = setTimeout(() => void browser.close(), 28000);
try {
  for (const scenario of (cachedMirror ? ['cached-mirror'] : ['mirror', 'cached-primary'])) {
    if (scenario === 'cached-primary' && process.argv.includes('--mirror-only')) continue;
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    await context.addInitScript(session => {
      if (!localStorage.getItem('gnc_supabase_auth_v1')) localStorage.setItem('gnc_supabase_auth_v1', JSON.stringify(session));
    }, seed);
    const page = await context.newPage(), errors = [], inventory = [], forbiddenReferrers = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    context.on('request', request => {
      if (request.url().startsWith('https://kzrnyjsosryejjejliii.supabase.co/') && request.headers().referer) forbiddenReferrers.push(request.url().split('?')[0]);
    });
    page.on('response', response => {
      if (response.url().includes('/rest/v1/ph_master_inventory') && response.ok()) inventory.push(response.status());
    });
    if (scenario === 'mirror') await context.route('**://agmetricapp.com/**', route => route.abort('blockedbyclient'));
    const origin = scenario !== 'cached-primary' ? 'http://127.0.0.1:4173' : 'https://agmetricapp.com';
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser === 'dylan_collyge', null, { timeout: 12000 }).catch(async error => { console.log(JSON.stringify({ errors, body: (await page.locator('body').innerText()).slice(0,400), state: await page.evaluate(() => ({ version:window.__APP_SHELL_VERSION__, ready:window.__AGDATA_RUNTIME_READY__, user:typeof currentUser !== 'undefined' ? currentUser : null, native:typeof nativeAuthSessionActive !== 'undefined' ? nativeAuthSessionActive : null })) })); throw error; });
    await page.evaluate(() => switchView('drive'));
    await page.waitForFunction(() => typeof fullInventory !== 'undefined' && fullInventory.length > 0, null, { timeout: 15000 });
    console.log(JSON.stringify({ stage: 'hydrated', scenario, errors, inventoryResponses: inventory.length, workers: await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => ({active:r.active?.state, installing:r.installing?.state}))) }));
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (scenario === 'cached-primary' || cachedMirror) {
      await context.route(origin + '/**', route => route.abort('blockedbyclient'));
      if (cachedMirror) await new Promise(resolve => server.close(resolve));
      // Block the worker's own transport as well; page routing alone is insufficient.
      const cdp = await browser.newBrowserCDPSession();
      const { targetInfos } = await cdp.send('Target.getTargets');
      for (const target of targetInfos.filter(target => target.type === 'service_worker' && target.url.startsWith(origin))) {
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
        await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1, method: 'Network.enable' }) });
        await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 2, method: 'Network.setBlockedURLs', params: { urls: [origin + '/*'] } }) });
      }
      inventory.length = 0;
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser === 'dylan_collyge', null, { timeout: 15000 });
      await page.evaluate(() => switchView('drive'));
      await page.waitForFunction(() => typeof fullInventory !== 'undefined' && fullInventory.length > 0, null, { timeout: 15000 });
    }
    if (cachedMirror) {
      await page.evaluate(() => refreshManualSyncStatus(true));
      await page.waitForFunction(() => manualSyncStatusState?.active === false, null, { timeout: 5000 });
      assert.match(await page.locator('[data-run-script-label]').innerText(), /^Run Script$/i);
    }
    const state = await page.evaluate(async () => ({ version: window.__APP_SHELL_VERSION__, user: currentUser, rows: fullInventory.length,
      secure: isSecureContext, controlled: !!navigator.serviceWorker.controller, caches: await caches.keys() }));
    assert.equal(state.version, 'AgData v2.3.114'); assert.equal(state.user, 'dylan_collyge'); assert.ok(state.rows > 0); assert.equal(state.secure, true);
    assert.ok(state.caches.includes(state.version.replace('AgData v', 'agdata-v'))); assert.equal(forbiddenReferrers.length, 0);
    assert.ok(inventory.length > 0, 'live inventory network response required');
    assert.deepEqual(errors, [], 'console/page errors');
    assert.doesNotMatch(await page.locator('body').innerText(), /ERP_SYNC_CONTINUE_DEADLINE|Verifying updated access|Drive Inventory unavailable|Data could not be verified|Load Failed: An import was interrupted|Row Details Unavailable/);
    results.push({ scenario, ...state, inventoryResponses: inventory.length, errors: errors.length });
    await context.close();
  }
} finally { clearTimeout(deadline); await browser.close(); await new Promise(resolve => server.close(resolve)); }
const report = { seconds: (Date.now() - started) / 1000, results };
if (process.env.AGDATA_PROOF_REPORT) await writeFile(process.env.AGDATA_PROOF_REPORT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
