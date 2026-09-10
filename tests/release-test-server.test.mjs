import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createReleaseTestServer, startReleaseTestServer } from '../scripts/serve-release-tests.mjs';

async function removeOwnedFixture(directory, root) {
  const relative = path.relative(root, directory);
  assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));
  assert.equal((await lstat(directory)).isSymbolicLink(), false);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const info = await lstat(target);
    // Never traverse the intentionally malicious symlinks/junctions below.
    if (info.isSymbolicLink()) await unlink(target);
    else if (info.isDirectory()) await removeOwnedFixture(target, root);
    else { assert.ok(info.isFile()); await unlink(target); }
  }
  await rmdir(directory);
}

async function fixture(t, { start = true } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gnc-release-test-server-'));
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^gnc-release-test-server-[a-zA-Z0-9]+$/);
    await removeOwnedFixture(directory, directory);
  });
  const siteDir = path.join(directory, 'artifact');
  const sourceDir = path.join(directory, 'checkout');
  const fixtureDir = path.join(sourceDir, 'tests', 'fixtures');
  await Promise.all([
    mkdir(path.join(siteDir, 'assets'), { recursive: true }),
    mkdir(path.join(siteDir, 'v2'), { recursive: true }),
    mkdir(path.join(sourceDir, 'assets'), { recursive: true }),
    mkdir(fixtureDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(siteDir, 'index.html'), '<html>SEALED COMPILED SHELL</html>'),
    writeFile(path.join(siteDir, 'v2', 'index.html'), '<html>SEALED V2</html>'),
    writeFile(path.join(siteDir, 'assets', 'app.js'), 'window.artifact=true;'),
    writeFile(path.join(siteDir, 'assets', 'app.css'), 'body{color:green}'),
    writeFile(path.join(siteDir, 'assets', 'font.woff2'), Buffer.from([0, 1, 2, 3])),
    writeFile(path.join(sourceDir, 'index.html'), '<html>UNCOMPILED CHECKOUT</html>'),
    writeFile(path.join(sourceDir, 'assets', 'missing.js'), 'SOURCE MUST NOT LEAK'),
    writeFile(path.join(sourceDir, 'secret.txt'), 'PRIVATE CHECKOUT'),
    writeFile(path.join(sourceDir, 'tests', 'private.test.mjs'), 'PRIVATE TEST'),
    writeFile(path.join(fixtureDir, 'ops-precision-browser.html'), '<link rel="stylesheet" href="../../assets/app.css">FIXTURE'),
  ]);
  if (start) server = await startReleaseTestServer({ siteDir, fixtureDir, port: 0 });
  return { directory, siteDir, sourceDir, fixtureDir, server,
    get: (url, method = 'GET') => new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: server.address().port, path: url, method }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.end();
    }),
  };
}

test('release server serves the artifact entry point at root, index and compiled aliases', async t => {
  const f = await fixture(t);
  assert.equal(f.server.address().address, '127.0.0.1');
  for (const url of ['/', '/?canary=1', '/index.html', '/_site', '/_site/', '/_site/index.html']) {
    const result = await f.get(url);
    assert.equal(result.status, 200, url);
    assert.equal(result.body, '<html>SEALED COMPILED SHELL</html>');
    assert.match(result.headers['content-type'], /^text\/html/);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers['x-content-type-options'], 'nosniff');
  }
  assert.equal((await f.get('/v2/')).body, '<html>SEALED V2</html>');
  assert.equal((await f.get('/_site/v2/')).body, '<html>SEALED V2</html>');
});

test('artifact JS, CSS and fonts retain correct MIME and HEAD does not return bytes', async t => {
  const f = await fixture(t);
  for (const [url, mime] of [['/assets/app.js', 'text/javascript'], ['/assets/app.css', 'text/css'], ['/assets/font.woff2', 'font/woff2']]) {
    const result = await f.get(url);
    assert.equal(result.status, 200);
    assert.ok(result.headers['content-type'].startsWith(mime));
    assert.ok(Number(result.headers['content-length']) > 0);
    const head = await f.get(url, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.equal(head.headers['content-length'], result.headers['content-length']);
  }
});

test('only audited fixture paths fall back to checkout and relative assets remain sealed', async t => {
  const f = await fixture(t);
  const fixturePage = await f.get('/tests/fixtures/ops-precision-browser.html?view=drive');
  assert.equal(fixturePage.status, 200);
  assert.match(fixturePage.body, /FIXTURE/);
  assert.equal((await f.get('/assets/app.css')).body, 'body{color:green}');
  for (const url of ['/assets/missing.js', '/_site/assets/missing.js', '/secret.txt', '/tests/private.test.mjs', '/tests/fixtures/missing.html', '/assets/']) {
    const result = await f.get(url);
    assert.equal(result.status, 404, url);
    assert.doesNotMatch(result.body, /PRIVATE|SOURCE|UNCOMPILED/);
  }
});

test('release server never mutates files through HTTP', async t => {
  const f = await fixture(t);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const result = await f.get('/index.html', method);
    assert.equal(result.status, 405, method);
    assert.equal(result.headers.allow, 'GET, HEAD');
  }
  assert.equal(await readFile(path.join(f.siteDir, 'index.html'), 'utf8'), '<html>SEALED COMPILED SHELL</html>');
});

test('raw, encoded, Windows and ambiguous traversal paths are rejected before resolution', async t => {
  const f = await fixture(t);
  for (const url of [
    '/../checkout/secret.txt', '/_site/../checkout/secret.txt', '/%2e%2e/checkout/secret.txt',
    '/%252e%252e/checkout/secret.txt', '/tests/fixtures/../private.test.mjs',
    '/tests/fixtures/%2e%2e/private.test.mjs', '/assets%2fapp.js', '/assets%5capp.js',
    '/assets\\app.js', '/C:/secret.txt', '/index.html:secret', '//index.html',
    '/assets//app.js', '/assets/./app.js', '/%00', '/%ZZ', '/..%20/checkout/secret.txt', '/NUL',
  ]) assert.equal((await f.get(url)).status, 400, url);
});

test('artifact and fixture symlinks cannot expose files outside their allowed root', async t => {
  const f = await fixture(t);
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  await symlink(f.sourceDir, path.join(f.siteDir, 'linked'), linkType);
  await symlink(f.sourceDir, path.join(f.fixtureDir, 'linked'), linkType);
  assert.equal((await f.get('/linked/secret.txt')).status, 403);
  assert.equal((await f.get('/tests/fixtures/linked/secret.txt')).status, 403);
  const rootLink = path.join(f.directory, 'root-link');
  await symlink(f.siteDir, rootLink, linkType);
  await assert.rejects(createReleaseTestServer({ siteDir: rootLink, fixtureDir: f.fixtureDir }), /without symlinks/);
});

test('missing compiled artifact or entry point is a startup failure, never a source fallback', async t => {
  const f = await fixture(t, { start: false });
  await assert.rejects(createReleaseTestServer({ siteDir: path.join(f.directory, 'missing'), fixtureDir: f.fixtureDir }), /ENOENT/);
  const empty = path.join(f.directory, 'empty');
  await mkdir(empty);
  await assert.rejects(createReleaseTestServer({ siteDir: empty, fixtureDir: f.fixtureDir }), /ENOENT/);
});
