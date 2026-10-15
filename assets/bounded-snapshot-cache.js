(() => {
  'use strict';

  const MARKER = '__agMetricBoundedSnapshotCacheV1';
  const INTERNAL_KEY_PREFIX = '__agmetric_bounded_snapshot_cache_v1__';
  const ROW_CHUNK_SIZE = 128;
  const LARGE_SNAPSHOT_ROW_COUNT = 128;
  const writeTailsByDatabase = new WeakMap();

  function chunkKey(cacheKey, generation, index) {
    // Array keys are separate from the application's string cache keys.
    return [INTERNAL_KEY_PREFIX, cacheKey, generation, index];
  }

  function generationId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function transactionCompletion(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
    });
  }

  function readManifest(value) {
    if (!value || typeof value !== 'object' || value[MARKER] !== true
      || typeof value.generation !== 'string' || !Number.isInteger(value.chunkCount)
      || value.chunkCount < 1 || !Number.isInteger(value.rowCount) || value.rowCount <= LARGE_SNAPSHOT_ROW_COUNT
      || value.chunkCount !== Math.ceil(value.rowCount / ROW_CHUNK_SIZE)
      || !value.metadata || typeof value.metadata !== 'object' || Array.isArray(value.metadata)) {
      return null;
    }
    return value;
  }

  function previousChunkKeys(value, cacheKey) {
    const manifest = readManifest(value);
    if (!manifest) return [];
    return Array.from({ length: manifest.chunkCount }, (_, index) => chunkKey(cacheKey, manifest.generation, index));
  }

  function enqueueWrite(db, storeName, cacheKey, operation) {
    let tails = writeTailsByDatabase.get(db);
    if (!tails) {
      tails = new Map();
      writeTailsByDatabase.set(db, tails);
    }
    const token = `${storeName}\u0000${cacheKey}`;
    const previous = tails.get(token) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    tails.set(token, current);
    return current.finally(() => {
      if (tails.get(token) === current) tails.delete(token);
    });
  }

  async function putChunk(db, storeName, key, rows) {
    const transaction = db.transaction(storeName, 'readwrite');
    const completed = transactionCompletion(transaction);
    try {
      transaction.objectStore(storeName).put(rows, key);
    } catch (error) {
      try { transaction.abort(); } catch { /* The transaction may already be inactive. */ }
      await completed.catch(() => {});
      throw error;
    }
    await completed;
  }

  async function cleanupKeys(db, storeName, keys) {
    if (!keys.length) return;
    const transaction = db.transaction(storeName, 'readwrite');
    const completed = transactionCompletion(transaction);
    const store = transaction.objectStore(storeName);
    keys.forEach(key => store.delete(key));
    await completed;
  }

  async function publish(db, storeName, cacheKey, value) {
    const transaction = db.transaction(storeName, 'readwrite');
    const completed = transactionCompletion(transaction);
    const store = transaction.objectStore(storeName);
    const previousRequest = store.get(cacheKey);
    previousRequest.onsuccess = () => {
      try {
        previousChunkKeys(previousRequest.result, cacheKey).forEach(key => store.delete(key));
        store.put(value, cacheKey);
      } catch (error) {
        try { transaction.abort(); } catch { /* The transaction may already be inactive. */ }
      }
    };
    previousRequest.onerror = () => {
      try { transaction.abort(); } catch { /* The transaction may already be inactive. */ }
    };
    await completed;
  }

  async function writeSnapshot(db, storeName, cacheKey, value) {
    const rows = value && typeof value === 'object' && Array.isArray(value.rawRows) ? value.rawRows : null;
    if (!rows || rows.length <= LARGE_SNAPSHOT_ROW_COUNT) {
      await publish(db, storeName, cacheKey, value);
      return true;
    }

    const generation = generationId();
    const chunkCount = Math.ceil(rows.length / ROW_CHUNK_SIZE);
    const writtenKeys = [];
    const metadata = { ...value };
    delete metadata.rawRows;
    const manifest = {
      [MARKER]: true,
      generation,
      chunkCount,
      rowCount: rows.length,
      metadata
    };

    try {
      for (let index = 0; index < chunkCount; index += 1) {
        const key = chunkKey(cacheKey, generation, index);
        const chunk = rows.slice(index * ROW_CHUNK_SIZE, (index + 1) * ROW_CHUNK_SIZE);
        await putChunk(db, storeName, key, chunk);
        writtenKeys.push(key);
        // Let rendering and input handlers run between bounded clone operations.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      await publish(db, storeName, cacheKey, manifest);
      return true;
    } catch {
      try { await cleanupKeys(db, storeName, writtenKeys); } catch { /* Failed generations are never published. */ }
      return false;
    }
  }

  async function readSnapshot(db, storeName, cacheKey) {
    try {
      const transaction = db.transaction(storeName, 'readonly');
      const completed = transactionCompletion(transaction);
      const store = transaction.objectStore(storeName);
      let result = null;
      let readFailed = false;
      const manifestRequest = store.get(cacheKey);
      manifestRequest.onsuccess = () => {
        const storedValue = manifestRequest.result;
        const manifest = readManifest(storedValue);
        if (!manifest) {
          if (storedValue && typeof storedValue === 'object' && storedValue[MARKER] === true) readFailed = true;
          else result = storedValue ?? null;
          return;
        }
        const chunks = new Array(manifest.chunkCount);
        let remaining = manifest.chunkCount;
        for (let index = 0; index < manifest.chunkCount; index += 1) {
          const request = store.get(chunkKey(cacheKey, manifest.generation, index));
          request.onsuccess = () => {
            if (!Array.isArray(request.result)) readFailed = true;
            else chunks[index] = request.result;
            remaining -= 1;
            if (remaining === 0 && !readFailed) {
              const rawRows = chunks.flat();
              if (rawRows.length === manifest.rowCount) result = { ...manifest.metadata, rawRows };
            }
          };
          request.onerror = () => { readFailed = true; };
        }
      };
      manifestRequest.onerror = () => { readFailed = true; };
      await completed;
      return readFailed ? null : result;
    } catch {
      return null;
    }
  }

  const api = Object.freeze({
    write(db, storeName, cacheKey, value) {
      if (!db || typeof storeName !== 'string' || !storeName || typeof cacheKey !== 'string' || !cacheKey) {
        return Promise.resolve(false);
      }
      return enqueueWrite(db, storeName, cacheKey, () => writeSnapshot(db, storeName, cacheKey, value).catch(() => false));
    },
    read(db, storeName, cacheKey) {
      if (!db || typeof storeName !== 'string' || !storeName || typeof cacheKey !== 'string' || !cacheKey) {
        return Promise.resolve(null);
      }
      return readSnapshot(db, storeName, cacheKey);
    }
  });

  Object.defineProperty(globalThis, 'AgMetricBoundedSnapshotCache', {
    configurable: true,
    enumerable: false,
    value: api
  });
})();
