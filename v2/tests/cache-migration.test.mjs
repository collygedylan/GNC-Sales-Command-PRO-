import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../public/v2-cache-migration.js', import.meta.url), 'utf8');

function installMigration(names) {
  const existing = new Set(names);
  const deletions = [];
  const events = new Map();
  runInNewContext(source, {
    self: { addEventListener: (event, listener) => events.set(event, listener) },
    caches: { delete: async name => { deletions.push(name); return existing.delete(name); } },
  });
  return { existing, deletions, events };
}

test('activation deletes exactly the obsolete v2 image cache and preserves all unrelated caches', async () => {
  const preserved = ['gnc-v2-static-icons-v2', 'workbox-precache-v2', 'bloomscapes-nursery-v1', 'gnc-production-images', 'unknown-customer-cache'];
  const migration = installMigration(['gnc-v2-images', ...preserved]);
  assert.deepEqual([...migration.events.keys()], ['activate']);
  assert.deepEqual(migration.deletions, [], 'registration must not delete caches before activation');
  let lifetime;
  migration.events.get('activate')({ waitUntil: promise => { lifetime = promise; } });
  assert.ok(lifetime instanceof Promise);
  await lifetime;
  assert.deepEqual(migration.deletions, ['gnc-v2-images']);
  assert.deepEqual([...migration.existing], preserved);
});

test('activation is harmless and repeatable when the old cache no longer exists', async () => {
  const migration = installMigration(['unknown-customer-cache']);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let lifetime;
    migration.events.get('activate')({ waitUntil: promise => { lifetime = promise; } });
    assert.equal(await lifetime, false);
  }
  assert.deepEqual(migration.deletions, ['gnc-v2-images', 'gnc-v2-images']);
  assert.deepEqual([...migration.existing], ['unknown-customer-cache']);
});
