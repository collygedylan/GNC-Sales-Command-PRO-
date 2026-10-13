import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
const require = createRequire(import.meta.url);
const { mutate } = require('swr');

const built = buildSync({ entryPoints: ['services/inventoryStatusSync.ts'], bundle: true, platform: 'node',
  format: 'cjs', external: ['swr'], write: false, logLevel: 'silent' });
const mod = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
const { createInventoryStatusSync } = mod.exports;

const pair = { itemcode: 'SKU.01', locationcode: 'A.01.001' };
const row = (unique_id, overrides = {}) => ({ unique_id, ...pair, priority: null, holdstopcode: null, holdstopreason: null, ...overrides });
const key = scope => JSON.stringify(['inventory-status', scope, pair.itemcode, pair.locationcode]);
const read = async cacheKey => {
  let found;
  await mutate(cacheKey, current => { found = current; return current; }, { revalidate: false });
  return found;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const clients = [];
test.afterEach(() => { for (const sync of clients.splice(0)) sync.reset(); });
function client(scope, fetchPair, extra = {}) {
  const confirmed = [], rendered = [], errors = [];
  const sync = createInventoryStatusSync({ getScope: () => scope, fetchPair, debounceMs: 1,
    onRows: (rows, itemPair) => confirmed.push({ rows, itemPair }), onDisplayChange: () => rendered.push(true),
    onError: error => errors.push(error), ...extra });
  clients.push(sync);
  return { sync, confirmed, rendered, errors };
}

test('begin mutates SWR cache and display immediately; confirm replaces it with canonical values', async () => {
  const cacheKey = key('user-a');
  await mutate(cacheKey, [row('row-a'), row('row-b')], { revalidate: false });
  const f = client('user-a', async () => [row('row-a', { priority: '1', holdstopcode: 'H', holdstopreason: 'Review' }), row('row-b')]);
  f.sync.seed([row('row-a'), row('row-b')]);
  const token = f.sync.begin([{ ...pair, unique_id: 'row-a', priority: '1', holdstopcode: 'H', holdstopreason: 'Review' }]);
  await wait(0);
  const cached = await read(cacheKey);
  assert.deepEqual(cached.map(row => [row.unique_id, row.priority, row.holdstopcode, row.holdstopreason]), [['row-a', '1', 'H', 'Review'], ['row-b', null, null, null]]);
  assert.equal(f.sync.getDisplayRow(row('row-a')).priority, '1');
  assert.equal(f.confirmed.length, 0, 'seeding the canonical cache does not invoke renderer callbacks');
  await f.sync.confirm(token, [row('row-a', { priority: '1', holdstopcode: 'H', holdstopreason: 'Review' }), row('row-b')]);
  assert.equal((await read(cacheKey))[0].holdstopreason, 'Review');
  assert.equal(f.sync.getDisplayRow(row('row-a')).priority, '1', 'stale display rows resolve to the latest canonical state');
});

test('rollback removes failed optimistic values and preserves a newer overlapping edit', async () => {
  const cacheKey = key('user-b');
  await mutate(cacheKey, [row('same')], { revalidate: false });
  const f = client('user-b', async () => [row('same')]);
  f.sync.seed([row('same')]);
  const older = f.sync.begin([{ ...pair, unique_id: 'same', priority: '1', holdstopreason: 'first' }]);
  const newer = f.sync.begin([{ ...pair, unique_id: 'same', priority: '2' }]);
  await wait(0);
  await f.sync.rollback(older);
  await wait(0);
  assert.equal(f.sync.getDisplayRow(row('same')).priority, '2');
  assert.equal(f.sync.getDisplayRow(row('same')).holdstopreason, null);
  assert.equal((await read(cacheKey))[0].priority, '2');
  await f.sync.rollback(newer);
  await wait(0);
  assert.equal((await read(cacheKey))[0].priority, null);
});

test('realtime updates coalesce by pair and fetch canonical rows, with other account scopes isolated', async () => {
  let calls = 0;
  const f = client('user-c', async requestedPair => { calls++; return [row('server', { priority: '3' }), { ...row('other'), itemcode: 'OTHER' }]; });
  const other = client('user-d', async () => { throw new Error('other client must not fetch'); });
  const cacheKey = key('user-c');
  await mutate(cacheKey, [row('server')], { revalidate: false });
  f.sync.handleUpdate({ new: row('server', { priority: '3' }) });
  f.sync.handleUpdate({ new: row('server', { priority: '4' }) });
  await wait(10);
  assert.equal(calls, 1);
  assert.equal((await read(cacheKey))[0].priority, '3');
  assert.equal(f.confirmed.at(-1).itemPair.locationcode, pair.locationcode);
  assert.equal(await read(key('user-d')), undefined);
  other.sync.suspend(); f.sync.suspend();
});

test('status patches update both legacy casing aliases and seeding merges partial pair rows', async () => {
  const cacheKey = key('user-g');
  const upper = { ...row('upper'), PRIORITY: null, HOLDSTOPCODE: 'OLD', HOLDSTOPREASON: 'OLD' };
  await mutate(cacheKey, [upper], { revalidate: false });
  const f = client('user-g', async () => []);
  f.sync.seed([upper]);
  f.sync.seed([row('second-lot')]);
  const token = f.sync.begin([{ ...pair, unique_id: 'upper', priority: '1', holdstopcode: null, holdstopreason: '' }]);
  await wait(0);
  const updated = (await read(cacheKey))[0];
  assert.equal(updated.PRIORITY, '1');
  assert.equal(updated.HOLDSTOPCODE, null);
  assert.equal(updated.HOLDSTOPREASON, '');
  assert.equal(f.sync.getDisplayRow({ ...upper, priority: null, holdstopcode: 'OLD', holdstopreason: 'OLD' }).holdstopcode, null);
  await f.sync.rollback(token);
});

test('events wait behind local mutations and coalesced confirmation fetches once', async () => {
  let calls = 0;
  const f = client('pending-events', async () => { calls++; return [row('a', { priority: '2' })]; });
  f.sync.seed([row('a')]);
  const token = f.sync.begin([{ ...pair, unique_id: 'a', priority: '2' }]);
  f.sync.handleUpdate({ new: row('a') });
  f.sync.handleUpdate({ new: row('a') });
  await wait(10);
  assert.equal(calls, 0);
  assert.equal(f.sync.getDisplayRow(row('a')).priority, '2');
  await f.sync.confirm(token);
  assert.equal(calls, 1);
  assert.equal((await read(key('pending-events')))[0].priority, '2');
});

test('two active clients refresh only the broadcast pair and ignore payload status values', async () => {
  const fetched = [];
  const a = client('device-a', async p => { fetched.push(['a', p]); return [row('a', { priority: '4' })]; });
  const b = client('device-b', async p => { fetched.push(['b', p]); return [row('a', { priority: '4' })]; });
  const unrelated = JSON.stringify(['inventory-status', 'device-a', pair.itemcode, 'OTHER']);
  await mutate(unrelated, ['untouched'], { revalidate: false });
  a.sync.handleUpdate({ new: row('a', { priority: 'untrusted' }) });
  b.sync.handleUpdate({ new: row('a', { priority: 'untrusted' }) });
  await wait(10);
  assert.deepEqual(fetched, [['a', pair], ['b', pair]]);
  assert.equal((await read(key('device-a')))[0].priority, '4');
  assert.equal((await read(key('device-b')))[0].priority, '4');
  assert.deepEqual(await read(unrelated), ['untouched']);
});

test('a read started before a save cannot publish after the optimistic mutation', async () => {
  let resolve;
  const f = client('read-race', () => new Promise(done => { resolve = done; }));
  f.sync.seed([row('a')]);
  const oldRead = f.sync.revalidate(pair);
  f.sync.begin([{ ...pair, unique_id: 'a', priority: '3' }]);
  resolve([row('a', { priority: 'old' })]);
  await oldRead;
  assert.equal(f.confirmed.length, 0);
  assert.equal((await read(key('read-race')))[0].priority, '3');
});

test('newer confirmed saves supersede older optimism and retain microsecond ordering and DOM identity', async () => {
  const old = row('a', { DOM_ID: 'card-a', last_updated: '2026-10-13T12:00:00.000001Z' });
  const newer = row('a', { priority: '2', last_updated: '2026-10-13T12:00:00.000003Z' });
  const f = client('save-order', async () => [row('a', { priority: 'stale', last_updated: '2026-10-13T12:00:00.000002Z' })]);
  f.sync.seed([old]);
  const first = f.sync.begin([{ ...pair, unique_id: 'a', priority: '1' }]);
  const second = f.sync.begin([{ ...pair, unique_id: 'a', priority: '2' }]);
  await f.sync.confirm(second, [newer]);
  assert.equal(f.sync.getDisplayRow(old).priority, '2');
  await f.sync.rollback(first);
  await f.sync.revalidate(pair);
  assert.equal(f.sync.getDisplayRow(old).priority, '2');
  assert.equal(f.sync.getDisplayRow(old).DOM_ID, 'card-a');
  assert.equal(f.confirmed.at(-1).rows.length, 0, 'stale microsecond receipt is rejected');
});

test('cross-location confirmations retry only the failed pair and keep that overlay visible', async () => {
  const secondPair = { ...pair, locationcode: 'B.01.001' };
  let attempts = 0;
  const f = client('retry-pair', async p => {
    if (p.locationcode === secondPair.locationcode && ++attempts === 1) throw new Error('temporary refresh failure');
    return [{ ...row(p.locationcode === pair.locationcode ? 'a' : 'b', { holdstopcode: 'H', holdstopreason: 'confirmed' }), ...p }];
  }, { retryMs: 10 });
  f.sync.seed([row('a'), { ...row('b'), ...secondPair }]);
  const token = f.sync.begin([{ ...pair, unique_id: 'a', holdstopcode: 'H', holdstopreason: 'pending' }, { ...secondPair, unique_id: 'b', holdstopcode: 'H', holdstopreason: 'pending' }]);
  await f.sync.confirm(token);
  assert.equal(f.sync.getDisplayRow(row('a')).holdstopreason, 'confirmed');
  assert.equal(f.sync.getDisplayRow({ ...row('b'), ...secondPair }).holdstopreason, 'pending');
  await wait(30);
  assert.equal(attempts, 2);
  assert.equal(f.sync.getDisplayRow({ ...row('b'), ...secondPair }).holdstopreason, 'confirmed');
});

test('suspend cancels pending work; reconnect refreshes seeded pairs and account reset rejects late reads', async () => {
  let scope = 'lifecycle-a', calls = 0, release;
  const f = client(scope, async () => { calls++; return [row('a', { priority: '4' })]; }, { getScope: () => scope });
  f.sync.seed([row('a')]);
  f.sync.handleUpdate({ new: row('a') });
  f.sync.suspend();
  await wait(5);
  assert.equal(calls, 0);
  f.sync.resume();
  await wait(5);
  assert.equal(calls, 1);
  const late = client('late', () => new Promise(resolve => { release = resolve; }), { getScope: () => scope });
  late.sync.seed([row('a')]);
  const readRequest = late.sync.revalidate(pair);
  scope = 'lifecycle-b'; late.sync.reset();
  release([row('a', { priority: 'old-account' })]);
  await readRequest;
  assert.equal(late.confirmed.length, 0);
  assert.equal(await read(key('lifecycle-b')), undefined);
});
