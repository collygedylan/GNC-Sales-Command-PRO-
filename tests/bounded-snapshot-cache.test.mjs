// @test-group: inventory
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/bounded-snapshot-cache.js', import.meta.url), 'utf8');
const context = vm.createContext({
  Date,
  Math,
  Promise,
  setTimeout,
  WeakMap,
  Map,
  Array,
  Object,
  Number,
  String,
  Error,
  globalThis: null
});
context.globalThis = context;
vm.runInContext(source, context, { filename: 'bounded-snapshot-cache.js' });
const cache = context.AgMetricBoundedSnapshotCache;

function copy(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function keyToken(key) {
  return typeof key === 'string' ? `s:${key}` : `a:${JSON.stringify(key)}`;
}

class FakeRequest {
  result = undefined;
  error = null;
  onsuccess = null;
  onerror = null;
}

class FakeTransaction {
  constructor(database, storeName, mode, release) {
    this.database = database;
    this.storeName = storeName;
    this.mode = mode;
    this.release = release;
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this.queue = [];
    this.pending = false;
    this.finished = false;
    this.active = false;
    this.staged = null;
    this.writtenChunkKeys = [];
  }

  activate() {
    this.active = true;
    this.staged = new Map(this.database.records);
    setTimeout(() => this.pump(), 0);
  }

  objectStore(storeName) {
    assert.equal(storeName, this.storeName);
    return {
      get: key => this.enqueue('get', key),
      put: (value, key) => this.enqueue('put', key, value),
      delete: key => this.enqueue('delete', key)
    };
  }

  enqueue(type, key, value) {
    const request = new FakeRequest();
    if (this.finished) throw new Error('Transaction is inactive.');
    this.queue.push({ type, key, value, request });
    this.pump();
    return request;
  }

  abort(error = new Error('IndexedDB transaction aborted.')) {
    if (this.finished) return;
    this.finished = true;
    this.error = error;
    this.onerror?.({ target: this });
    this.onabort?.({ target: this });
    this.release();
  }

  pump() {
    if (!this.active || this.finished || this.pending) return;
    const operation = this.queue.shift();
    if (!operation) {
      this.pending = true;
      setTimeout(() => {
        this.pending = false;
        if (this.finished || this.queue.length) return this.pump();
        if (this.mode === 'readwrite') this.database.records = this.staged;
        this.finished = true;
        this.database.onTransactionComplete?.(this);
        this.oncomplete?.({ target: this });
        this.release();
      }, 0);
      return;
    }

    this.pending = true;
    setTimeout(() => {
      this.pending = false;
      if (this.finished) return;
      const token = keyToken(operation.key);
      if (operation.type === 'get') {
        operation.request.result = copy(this.staged.get(token));
        this.database.onGet?.(operation.request.result, operation.key);
      } else if (operation.type === 'put') {
        if (this.mode !== 'readwrite') return this.abort(new Error('Readonly transaction cannot write.'));
        if (this.database.shouldFailPut?.(operation.value, operation.key)) {
          operation.request.error = new Error('Injected put failure.');
          operation.request.onerror?.({ target: operation.request });
          return this.abort(operation.request.error);
        }
        this.staged.set(token, copy(operation.value));
        if (Array.isArray(operation.key)) this.writtenChunkKeys.push(operation.key);
      } else {
        if (this.mode !== 'readwrite') return this.abort(new Error('Readonly transaction cannot delete.'));
        this.staged.delete(token);
      }
      operation.request.onsuccess?.({ target: operation.request });
      this.pump();
    }, 0);
  }
}

class FakeDatabase {
  records = new Map();
  tail = Promise.resolve();
  onTransactionComplete = null;
  onGet = null;
  shouldFailPut = null;

  transaction(storeName, mode) {
    let release;
    const lock = new Promise(resolve => { release = resolve; });
    const previous = this.tail;
    this.tail = lock;
    const transaction = new FakeTransaction(this, storeName, mode, release);
    previous.then(() => transaction.activate());
    return transaction;
  }

  seed(key, value) {
    this.records.set(keyToken(key), copy(value));
  }

  remove(key) {
    this.records.delete(keyToken(key));
  }
}

function largeSnapshot(label, rows = 300) {
  return { format: 'verified-raw-v1', label, rawRows: Array.from({ length: rows }, (_, index) => ({ id: `${label}-${index}`, value: index })) };
}

function plain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('large raw snapshots use bounded chunks and reconstruct the original cached object', async () => {
  const db = new FakeDatabase();
  const original = largeSnapshot('first', 300);
  const readChunkSizes = [];
  db.onGet = result => { if (Array.isArray(result)) readChunkSizes.push(result.length); };

  assert.equal(await cache.write(db, 'cache', 'master-key', original), true);
  const manifest = db.records.get(keyToken('master-key'));
  assert.equal(manifest.rawRows, undefined);
  assert.equal(manifest.chunkCount, 3);
  assert.deepEqual(plain(await cache.read(db, 'cache', 'master-key')), original);
  assert.deepEqual(readChunkSizes, [128, 128, 44]);
});

test('legacy latest-data snapshots chunk every large top-level dataset array and reconstruct the same payload', async () => {
  const db = new FakeDatabase();
  const original = {
    status: 'success',
    data: Array.from({ length: 300 }, (_, index) => ({ id: `master-${index}`, value: index })),
    avOpenData: Array.from({ length: 140 }, (_, index) => ({ id: `av-${index}` })),
    cropRollDriveData: [{ id: 'small-inline' }],
    meta: { cacheSchemaVersion: 25, scopedUser: 'manager-a' }
  };
  const readChunkSizes = [];
  db.onGet = result => { if (Array.isArray(result)) readChunkSizes.push(result.length); };

  assert.equal(await cache.write(db, 'cache', 'latest_data', original), true);
  const manifest = db.records.get(keyToken('latest_data'));
  assert.deepEqual(manifest.arrays.map(array => array.field), ['data', 'avOpenData']);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.metadata, 'data'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.metadata, 'avOpenData'), false);
  assert.deepEqual(plain(await cache.read(db, 'cache', 'latest_data')), original);
  assert.deepEqual(readChunkSizes, [128, 128, 44, 128, 12]);
});

test('failed legacy data-array chunks keep the old payload and clean all unpublished array chunks', async () => {
  const db = new FakeDatabase();
  const oldSnapshot = { status: 'success', data: Array.from({ length: 260 }, (_, index) => ({ id: `old-${index}` })) };
  const newSnapshot = { status: 'success', data: Array.from({ length: 260 }, (_, index) => ({ id: `new-${index}` })) };
  assert.equal(await cache.write(db, 'cache', 'latest_data', oldSnapshot), true);
  const oldManifest = db.records.get(keyToken('latest_data'));
  let failed = false;
  db.shouldFailPut = (_value, key) => {
    if (!failed && Array.isArray(key) && key[3] === 1) {
      failed = true;
      return true;
    }
    return false;
  };

  assert.equal(await cache.write(db, 'cache', 'latest_data', newSnapshot), false);
  assert.deepEqual(plain(await cache.read(db, 'cache', 'latest_data')), oldSnapshot);
  assert.equal(db.records.get(keyToken('latest_data')).arrays[0].generation, oldManifest.arrays[0].generation);
  assert.equal([...db.records.entries()].some(([key, value]) => key.startsWith('a:') && value?.[0]?.id?.startsWith('new-')), false,
    'no chunk from the failed data generation remains stored');
});

test('legacy data chunks stay isolated by cache identity', async () => {
  const db = new FakeDatabase();
  const first = { data: Array.from({ length: 260 }, (_, index) => ({ id: `first-${index}` })) };
  const second = { data: Array.from({ length: 260 }, (_, index) => ({ id: `second-${index}` })) };
  assert.deepEqual(await Promise.all([
    cache.write(db, 'cache', 'latest_data:first', first),
    cache.write(db, 'cache', 'latest_data:second', second)
  ]), [true, true]);

  assert.deepEqual(plain(await cache.read(db, 'cache', 'latest_data:first')), first);
  assert.deepEqual(plain(await cache.read(db, 'cache', 'latest_data:second')), second);
  const chunkCacheKeys = [...db.records.keys()].filter(key => key.startsWith('a:'))
    .map(key => JSON.parse(key.slice(2))[1]);
  assert.ok(chunkCacheKeys.includes('latest_data:first'));
  assert.ok(chunkCacheKeys.includes('latest_data:second'));
});

test('legacy values and empty raw-row snapshots remain inline and readable', async () => {
  const db = new FakeDatabase();
  const ordinary = { cachedAt: 'today', data: [{ id: 1 }] };
  const empty = { format: 'verified-raw-v1', rawRows: [], rowCount: 0 };

  assert.equal(await cache.write(db, 'cache', 'ordinary', ordinary), true);
  assert.equal(await cache.write(db, 'cache', 'empty', empty), true);
  assert.deepEqual(db.records.get(keyToken('ordinary')), ordinary);
  assert.deepEqual(db.records.get(keyToken('empty')), empty);
  assert.deepEqual(plain(await cache.read(db, 'cache', 'ordinary')), ordinary);
  assert.deepEqual(plain(await cache.read(db, 'cache', 'empty')), empty);
});

test('readers see the old complete snapshot while a replacement generation is being written', async () => {
  const db = new FakeDatabase();
  const oldSnapshot = largeSnapshot('old', 260);
  const newSnapshot = largeSnapshot('new', 260);
  assert.equal(await cache.write(db, 'cache', 'master-key', oldSnapshot), true);
  const oldManifest = db.records.get(keyToken('master-key'));

  const firstChunkCommitted = deferred();
  let observedChunk = false;
  db.onTransactionComplete = transaction => {
    if (!observedChunk && transaction.writtenChunkKeys.length) {
      observedChunk = true;
      firstChunkCommitted.resolve();
    }
  };
  const writePromise = cache.write(db, 'cache', 'master-key', newSnapshot);
  await firstChunkCommitted.promise;
  assert.deepEqual(plain(await cache.read(db, 'cache', 'master-key')), oldSnapshot);
  assert.equal(await writePromise, true);
  assert.deepEqual(plain(await cache.read(db, 'cache', 'master-key')), newSnapshot);
  for (let index = 0; index < oldManifest.chunkCount; index += 1) {
    assert.equal(db.records.has(keyToken(['__agmetric_bounded_snapshot_cache_v1__', 'master-key', oldManifest.generation, index])), false,
      'the previous generation is removed after the replacement publishes');
  }
});

test('a failed chunk write keeps the prior snapshot and removes the incomplete generation', async () => {
  const db = new FakeDatabase();
  const oldSnapshot = largeSnapshot('old', 260);
  const newSnapshot = largeSnapshot('new', 260);
  assert.equal(await cache.write(db, 'cache', 'master-key', oldSnapshot), true);
  let failed = false;
  db.shouldFailPut = (_value, key) => {
    if (!failed && Array.isArray(key) && key[3] === 1) {
      failed = true;
      return true;
    }
    return false;
  };

  assert.equal(await cache.write(db, 'cache', 'master-key', newSnapshot), false);
  assert.deepEqual(plain(await cache.read(db, 'cache', 'master-key')), oldSnapshot);
  assert.equal([...db.records.keys()].some(key => key.startsWith('a:')), true, 'the published old generation remains stored');
  assert.equal([...db.records.entries()].some(([key, value]) => key.startsWith('a:') && value?.[0]?.id?.startsWith('new-')), false,
    'no chunk from the failed generation remains stored');
});

test('writes for the same cache key serialize in invocation order', async () => {
  const db = new FakeDatabase();
  const earlier = largeSnapshot('earlier', 260);
  const later = largeSnapshot('later', 260);
  const firstWrite = cache.write(db, 'cache', 'master-key', earlier);
  const secondWrite = cache.write(db, 'cache', 'master-key', later);

  assert.deepEqual(await Promise.all([firstWrite, secondWrite]), [true, true]);
  assert.deepEqual(plain(await cache.read(db, 'cache', 'master-key')), later);
});

test('a missing chunk fails closed instead of returning partial rows', async () => {
  const db = new FakeDatabase();
  const original = largeSnapshot('complete', 260);
  assert.equal(await cache.write(db, 'cache', 'master-key', original), true);
  const manifest = db.records.get(keyToken('master-key'));
  db.remove(['__agmetric_bounded_snapshot_cache_v1__', 'master-key', manifest.generation, 1]);

  assert.equal(await cache.read(db, 'cache', 'master-key'), null);
});

test('malformed manifests with oversized or unsafe chunk counts fail closed', async () => {
  for (const descriptor of [
    { field: 'data', generation: 'oversized', chunkCount: 100001, rowCount: 100001 * 128 },
    { field: 'data', generation: 'unsafe', chunkCount: Number.MAX_SAFE_INTEGER + 1, rowCount: Number.MAX_SAFE_INTEGER + 1 }
  ]) {
    const db = new FakeDatabase();
    db.seed('master-key', {
      __agMetricBoundedSnapshotCacheV1: true,
      arrays: [descriptor],
      metadata: {}
    });
    let chunkReads = 0;
    db.onGet = (_value, key) => {
      if (Array.isArray(key)) chunkReads += 1;
    };

    assert.equal(await cache.read(db, 'cache', 'master-key'), null);
    assert.equal(chunkReads, 0, 'invalid counts are rejected before allocating or reading chunks');
  }
});
