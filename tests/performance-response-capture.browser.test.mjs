// @test-group: node-browser
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';
import { waitForPerformanceVisibleElement } from '../scripts/performance-browser-fixture.mjs';
import { attachPerformanceResponseTracker, drainPerformanceApiRequests, safePerformanceApiDiagnostic } from '../scripts/performance-response-drain.mjs';

test('route readiness resolves on the first visible card frame instead of locator polling', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.setContent('<style>.card{display:none;width:120px;height:40px}</style><article class="card"></article>');
    await page.evaluate(() => setTimeout(() => { document.querySelector('.card').style.display = 'block'; }, 40));
    const box = await waitForPerformanceVisibleElement(page, '.card');
    assert.equal(box.width, 120);
    assert.equal(box.height, 40);
    await page.locator('.card').evaluate(element => { element.style.visibility = 'hidden'; });
    page.setDefaultTimeout(100);
    await assert.rejects(waitForPerformanceVisibleElement(page, '.card'), /Timeout/);
    page.setDefaultTimeout(30000);
    await page.locator('.card').evaluate(element => { element.style.visibility = 'visible'; });
    assert.equal((await waitForPerformanceVisibleElement(page, '.card')).width, 120);
  } finally { await browser.close(); }
});

test('Playwright response ledger captures exact payloads, excludes late reads, and records header-stage aborts', async () => {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://fixture.invalid').pathname;
    if (pathname === '/rest/v1/rpc/complete') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true,"rows":[1,2]}');
      return;
    }
    if (pathname === '/rest/v1/rpc/late') {
      setTimeout(() => {
        if (!response.destroyed) {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{"late":true}');
        }
      }, 80);
      return;
    }
    if (pathname === '/rest/v1/rpc/abort') {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' });
      response.flushHeaders();
      const timer = setTimeout(() => response.end('{"this body is deliberately delayed"}'), 1500);
      response.on('close', () => clearTimeout(timer));
      return;
    }
    if (pathname === '/rest/v1/rpc/error') {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end('{"private":"error response body"}');
      return;
    }
    if (pathname === '/functions/v1/app-api') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const totals = { apiRequests: [], pending: [], errors: [], scriptBytes: 0 };
  attachPerformanceResponseTracker(page, totals);
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await page.goto(origin);
    const completeText = await page.evaluate(async () => await (await fetch('/rest/v1/rpc/complete?secret=never-log')).text());
    assert.equal(completeText, '{"ok":true,"rows":[1,2]}');
    await drainPerformanceApiRequests(totals, { startIndex: 0, endIndex: 1 });
    assert.equal(totals.apiRequests[0].bytes, Buffer.byteLength(completeText));
    assert.deepEqual({ method: totals.apiRequests[0].method, path: totals.apiRequests[0].path, operation: totals.apiRequests[0].operation },
      { method: 'GET', path: '/rest/v1/rpc/complete', operation: 'rpc:complete' });
    assert.equal(JSON.stringify(safePerformanceApiDiagnostic(totals.apiRequests[0])).includes('never-log'), false,
      'diagnostics exclude query values');

    const lateResponse = page.waitForResponse(response => response.url().endsWith('/rest/v1/rpc/late'));
    await page.evaluate(() => { window.lateFetch = fetch('/rest/v1/rpc/late').then(response => response.text()); });
    await lateResponse;
    assert.equal(totals.apiRequests.length, 2);
    const snapshotEnd = 1;
    await drainPerformanceApiRequests(totals, { startIndex: 0, endIndex: snapshotEnd });
    assert.equal(totals.apiRequests.slice(0, snapshotEnd).reduce((sum, record) => sum + record.bytes, 0), Buffer.byteLength(completeText));
    const lateText = await page.evaluate(() => window.lateFetch);
    assert.equal(lateText, '{"late":true}');
    await drainPerformanceApiRequests(totals, { startIndex: 1, endIndex: 2 });
    assert.equal(totals.apiRequests[1].bytes, Buffer.byteLength(lateText));

    const abortedResponse = page.waitForResponse(response => response.url().endsWith('/rest/v1/rpc/abort'));
    await page.evaluate(() => {
      window.abortController = new AbortController();
      window.abortFetch = fetch('/rest/v1/rpc/abort', { signal: window.abortController.signal })
        .then(response => response.text()).catch(error => error.name);
    });
    await abortedResponse;
    await page.evaluate(() => window.abortController.abort());
    const abortResult = await page.evaluate(() => window.abortFetch);
    assert.equal(abortResult, 'AbortError');
    await drainPerformanceApiRequests(totals, { startIndex: 2, endIndex: 3 });
    assert.equal(totals.apiRequests[2].canceled, true);
    assert.equal(totals.apiRequests[2].bytes, 0);
    assert.equal(totals.apiRequests[2].error, null);
    assert.deepEqual(totals.errors, []);

    const appApiText = await page.evaluate(async () => await (await fetch('/functions/v1/app-api', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'dataset_read', dataset: 'request_queue', access_token: 'sensitive-test-token' })
    })).text());
    assert.equal(appApiText, '{"ok":true}');
    await drainPerformanceApiRequests(totals, { startIndex: 3, endIndex: 4 });
    assert.equal(totals.apiRequests[3].operation, 'action:dataset_read;dataset:request_queue');
    const diagnostic = safePerformanceApiDiagnostic(totals.apiRequests[3]);
    assert.equal(diagnostic.path, '/functions/v1/app-api');
    assert.equal(JSON.stringify(diagnostic).includes('sensitive-test-token'), false);

    const errorText = await page.evaluate(async () => await (await fetch('/rest/v1/rpc/error')).text());
    assert.match(errorText, /error response body/);
    await assert.rejects(drainPerformanceApiRequests(totals, { startIndex: 4, endIndex: 5 }), error => {
      assert.match(error.message, /HTTP 503/);
      assert.equal(error.message.includes('error response body'), false);
      return true;
    });
    assert.equal(totals.apiRequests[4].bytes, 0);
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
