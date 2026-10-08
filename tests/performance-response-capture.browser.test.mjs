// @test-group: node-browser
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';
import { attachPerformanceResponseTracker, drainPerformanceApiRequests } from '../scripts/performance-response-drain.mjs';

test('Playwright response ledger captures exact payloads, excludes late reads, and records header-stage aborts', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/rest/v1/rpc/complete') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true,"rows":[1,2]}');
      return;
    }
    if (request.url === '/rest/v1/rpc/late') {
      setTimeout(() => {
        if (!response.destroyed) {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{"late":true}');
        }
      }, 80);
      return;
    }
    if (request.url === '/rest/v1/rpc/abort') {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' });
      response.flushHeaders();
      const timer = setTimeout(() => response.end('{"this body is deliberately delayed"}'), 1500);
      response.on('close', () => clearTimeout(timer));
      return;
    }
    if (request.url === '/rest/v1/rpc/error') {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end('{"private":"error response body"}');
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
    const completeText = await page.evaluate(async () => await (await fetch('/rest/v1/rpc/complete')).text());
    assert.equal(completeText, '{"ok":true,"rows":[1,2]}');
    await drainPerformanceApiRequests(totals, { startIndex: 0, endIndex: 1 });
    assert.equal(totals.apiRequests[0].bytes, Buffer.byteLength(completeText));

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

    const errorText = await page.evaluate(async () => await (await fetch('/rest/v1/rpc/error')).text());
    assert.match(errorText, /error response body/);
    await assert.rejects(drainPerformanceApiRequests(totals, { startIndex: 3, endIndex: 4 }), error => {
      assert.match(error.message, /HTTP 503/);
      assert.equal(error.message.includes('error response body'), false);
      return true;
    });
    assert.equal(totals.apiRequests[3].bytes, 0);
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
