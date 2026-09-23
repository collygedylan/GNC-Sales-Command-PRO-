import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { startReleaseTestServer } from './serve-release-tests.mjs';
import { isolationHeaders } from './isolated-preview.mjs';

const server = await startReleaseTestServer({ port: 0, responseHeaders: isolationHeaders() });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 412, height: 915 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const remote = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') { remote.push(url.origin); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    const response = await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['x-gnc-environment'], 'isolated-preview');
    assert.equal(await page.evaluate(() => fetch('https://example.invalid/production-write', { method: 'POST', body: 'fixture' }).then(() => false, () => true)), true);
    assert.equal(await page.evaluate(() => fetch('/index.html').then(r => r.ok)), true);
    assert.deepEqual(remote, [], 'CSP must block remote requests before even the safety interceptor sees them');
    await context.close();
  }
  console.log('ISOLATED_COMPILED_PREVIEW_OK android/iphone widths; remote writes blocked; local assets readable');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
