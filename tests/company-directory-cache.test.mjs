// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/company-directory-cache.js', import.meta.url), 'utf8');
function fixture() {
  const window = {}; vm.runInNewContext(source, { window, URLSearchParams });
  return window.GncCompanyDirectoryCache.create();
}
test('directory delegates pagination to its transport and retains a synchronous snapshot during refresh', async () => {
  const cache = fixture(), calls = [];
  const rows = Array.from({ length: 2500 }, (_, id) => ({ id: String(id), name: `Employee ${id}` }));
  const read = async (table, query) => {
    const p = new URLSearchParams(query); calls.push([table, p.get('offset'), p.get('limit')]);
    assert.equal(p.has('offset'), false); assert.equal(p.has('limit'), false);
    return table.endsWith('_contacts') ? rows : [];
  };
  const original = await cache.refresh('user:permission', read);
  assert.equal(original.contacts.length, 2500);
  assert.equal(calls.length, 4);
  let release; const gate = new Promise(resolve => { release = resolve; });
  const refresh = cache.refresh('user:permission', async (...args) => { await gate; return read(...args); });
  assert.equal(cache.peek('user:permission'), original);
  assert.equal(cache.refresh('user:permission', read), refresh);
  release(); await refresh;
});
test('identity changes and permission denial prevent private snapshot reuse', async () => {
  const cache = fixture();
  await cache.refresh('a:v1', async () => []);
  assert.ok(cache.peek('a:v1'));
  assert.equal(cache.peek('b:v1'), null);
  await assert.rejects(cache.refresh('a:v1', async () => { throw Object.assign(new Error('Denied'), { status: 403 }); }));
  assert.equal(cache.peek('a:v1'), null);
  let release; const gate = new Promise(resolve => { release = resolve; });
  const pending = cache.refresh('a:v1', async () => { await gate; return []; });
  await cache.refresh('b:v1', async () => []);
  release(); await pending;
  assert.equal(cache.peek('a:v1'), null);
  assert.ok(cache.peek('b:v1'));
});
test('transient failures retain the last good snapshot and incomplete pagination is rejected', async () => {
  const cache = fixture();
  const first = await cache.refresh('a:v1', async () => []);
  await assert.rejects(cache.refresh('a:v1', async () => { throw new Error('Offline'); }));
  assert.equal(cache.peek('a:v1'), first);
  await assert.rejects(cache.refresh('a:v1', async () => null), /invalid/i);
});
