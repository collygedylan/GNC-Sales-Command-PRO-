import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const script = path.join(root, 'scripts/wait-for-live-release.mjs');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const release = `V${packageJson.version}`;
const expectedCommit = 'a'.repeat(40);
const staleCommit = 'b'.repeat(40);
const fingerprint = commit => ({ schemaVersion: 'gnc-deployment-fingerprint-v1', release, commit,
  generatedAt: '2026-10-02T00:00:00.000Z' });

async function runWaiter({ rootMode, requireRoot = true, timeout = 1400 }) {
  let rootRequests = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    response.setHeader('content-type', 'application/json');
    if (url.pathname === `/deployments/${expectedCommit}.json`) {
      response.end(JSON.stringify(fingerprint(expectedCommit)));
      return;
    }
    if (url.pathname === '/deployment.json') {
      rootRequests += 1;
      if (rootMode === 'http-failure') {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: 'fixture' }));
        return;
      }
      const isUpdated = rootMode === 'eventual' && rootRequests >= 2;
      response.end(JSON.stringify(fingerprint(isUpdated ? expectedCommit : staleCommit)));
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const env = {
    ...process.env,
    CANARY_BASE_URL: `http://127.0.0.1:${address.port}`,
    CANARY_WAIT_TIMEOUT_MS: String(timeout),
    CANARY_WAIT_INTERVAL_MS: '250',
    EXPECTED_COMMIT: expectedCommit,
    RESOLVE_PAGES_PUBLICATION: '0'
  };
  if (requireRoot) env.REQUIRE_CURRENT_LIVE_DESCRIPTOR = '1';
  else delete env.REQUIRE_CURRENT_LIVE_DESCRIPTOR;
  try {
    const child = spawn(process.execPath, [script], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', value => { stdout += value; });
    child.stderr.setEncoding('utf8').on('data', value => { stderr += value; });
    const [code] = await once(child, 'close');
    return { code, stdout, stderr, rootRequests };
  } finally {
    server.close();
  }
}

test('requires current root descriptor after the immutable fingerprint matches', async () => {
  const result = await runWaiter({ rootMode: 'stale', timeout: 900 });
  assert.equal(result.code, 1);
  assert.ok(result.rootRequests >= 2, 'stale descriptor is retried within the existing poll window');
  assert.match(result.stderr, /"observedCode":"CURRENT_LIVE_RELEASE_MISMATCH"/);
  assert.doesNotMatch(result.stderr, /[b]{40}|fixture|http:\/\//);
});

test('waits for a delayed root descriptor update while immutable fingerprint remains valid', async () => {
  const result = await runWaiter({ rootMode: 'eventual', timeout: 1800 });
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.ok, true);
  assert.equal(payload.commit, expectedCommit.slice(0, 7));
  assert.ok(payload.attempts >= 2);
  assert.ok(result.rootRequests >= 2);
});

test('reports sanitized root descriptor HTTP failure and keeps polling bounded', async () => {
  const result = await runWaiter({ rootMode: 'http-failure', timeout: 900 });
  assert.equal(result.code, 1);
  assert.ok(result.rootRequests >= 2);
  assert.match(result.stderr, /CURRENT_DEPLOYMENT_DESCRIPTOR_HTTP_503/);
  assert.doesNotMatch(result.stderr, /fixture|http:\/\//);
});

test('default mode preserves immutable fingerprint-only behavior', async () => {
  const result = await runWaiter({ rootMode: 'stale', requireRoot: false });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.rootRequests, 0);
  assert.equal(JSON.parse(result.stdout.trim()).code, 'LIVE_RELEASE_MATCH');
});
