// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cacheStart = html.indexOf('const CLIENT_BROWSE_PAGE_KEY_CACHE_LIMIT =');
const cacheEnd = html.indexOf('function getClientBrowsePage(view =', cacheStart);
assert.ok(cacheStart >= 0 && cacheEnd > cacheStart, 'browse key cache source is present');
const cacheSource = html.slice(cacheStart, cacheEnd);

function createFixture() {
  let identity = 'profile:alpha';
  const signatureInputs = [];
  const context = {
    getSupabaseReadIdentityScope: () => identity,
    buildRowsRenderSignature: (prefix, rows) => {
      const uniqueId = rows[0]?.UNIQUE_ID ?? '';
      signatureInputs.push({ prefix, uniqueId });
      return `render:${prefix}:${uniqueId}`;
    }
  };
  vm.createContext(context);
  vm.runInContext(cacheSource, context);
  return {
    context,
    signatureInputs,
    setIdentity(value) { identity = value; },
    key(view, source) { return context.getClientBrowsePageKey(view, source); },
    state(expression) { return vm.runInContext(expression, context); }
  };
}

test('browse page key cache preserves the original key and reuses only an exact tuple', () => {
  const fixture = createFixture();
  const expected = 'request:render:browse:request:profile:alpha:request-source';
  assert.equal(fixture.key(' request ', ' request-source '), expected);
  assert.equal(fixture.key('request', 'request-source'), expected);
  assert.equal(fixture.signatureInputs.length, 1);

  assert.notEqual(fixture.key('av', 'request-source'), expected);
  assert.notEqual(fixture.key('request', 'other-source'), expected);
  assert.equal(fixture.signatureInputs.length, 3);
  assert.deepEqual(fixture.signatureInputs.map(input => input.uniqueId), [
    'profile:alpha:request-source', 'profile:alpha:request-source', 'profile:alpha:other-source'
  ]);
});

test('identity scope changes purge cached source keys before producing the next key', () => {
  const fixture = createFixture();
  const first = fixture.key('request', 'large-render-key');
  assert.equal(fixture.state('clientBrowsePageKeyCacheEntryCount'), 1);
  fixture.setIdentity('profile:beta');
  const second = fixture.key('request', 'large-render-key');
  assert.notEqual(second, first);
  assert.equal(fixture.state('clientBrowsePageKeyCacheEntryCount'), 1);
  assert.equal(fixture.state('clientBrowsePageKeyCacheIdentityKey'), 'profile:beta');
  assert.equal(fixture.signatureInputs.length, 2);
  assert.equal(fixture.signatureInputs[1].uniqueId, 'profile:beta:large-render-key');
});

test('browse key cache is bounded and evicted entries are recomputed exactly', () => {
  const fixture = createFixture();
  const original = fixture.key('request', 'source-0');
  for (let index = 1; index <= 20; index++) fixture.key('request', `source-${index}`);
  assert.equal(fixture.state('clientBrowsePageKeyCacheEntryCount'), 12);
  assert.equal(fixture.state('clientBrowsePageKeyCacheOrder.length'), 12);
  assert.equal(fixture.key('request', 'source-0'), original);
  assert.equal(fixture.signatureInputs.length, 22, 'the oldest entry was evicted and recomputed');
  assert.equal(fixture.state('clientBrowsePageKeyCacheEntryCount'), 12);
});

test('evicting a view cache before inserting into that view keeps the live cache bounded', () => {
  const fixture = createFixture();
  for (let index = 0; index < 12; index++) fixture.key(`view-${index}`, 'key-a');
  const next = fixture.key('view-0', 'key-b');
  assert.equal(fixture.key('view-0', 'key-b'), next);
  assert.equal(fixture.state('clientBrowsePageKeyCacheEntryCount'), 12);
  assert.equal(fixture.state('clientBrowsePageKeyCacheOrder.length'), 12);
  assert.equal(fixture.state('[...clientBrowsePageKeyCache.values()].reduce((total, cache) => total + cache.size, 0)'), 12);
  assert.equal(fixture.signatureInputs.length, 13, 'the inserted tuple is cached after the eviction');
});

test('nested tuple keys do not collide when view and source contain separators', () => {
  const fixture = createFixture();
  const first = fixture.key('request:av', 'source');
  const second = fixture.key('request', 'av:source');
  assert.notEqual(first, second);
  assert.equal(fixture.signatureInputs.length, 2);
});
