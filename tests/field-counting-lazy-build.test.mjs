// @test-group: field-counting
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { removeObsoleteFieldCountingChunks } from '../scripts/build-field-counting.mjs';

test('field counting cleanup removes only stale owned hashed chunks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'field-counting-chunks-'));
  const chunks = path.join(root, 'assets', 'field-counting-chunks');
  await mkdir(path.join(chunks, 'nested'), { recursive: true });
  for (const name of ['View-AB12CD34.js', 'chunk-00AAZZ99.js', 'other-ABCDEFGH.js.map', 'short-ABC1234.js', 'notes.txt']) {
    await writeFile(path.join(chunks, name), name);
  }
  await writeFile(path.join(chunks, 'nested', 'nested-AB12CD34.js'), 'nested');
  try {
    await removeObsoleteFieldCountingChunks(chunks);
    assert.deepEqual((await readdir(chunks)).sort(), ['nested', 'notes.txt', 'other-ABCDEFGH.js.map', 'short-ABC1234.js']);
    await writeFile(path.join(chunks, 'current-ABCD1234.js'), 'current');
    await writeFile(path.join(chunks, 'stale-ZYXW9876.js'), 'stale');
    await removeObsoleteFieldCountingChunks(chunks, ['current-ABCD1234.js']);
    assert.deepEqual((await readdir(chunks)).sort(), ['current-ABCD1234.js', 'nested', 'notes.txt', 'other-ABCDEFGH.js.map', 'short-ABC1234.js']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('compiled Counting entry defers the view and supports a fresh URL after chunk failure', async () => {
  const assets = new URL('../assets/', import.meta.url);
  const entry = await readFile(new URL('field-counting.js', assets), 'utf8');
  const chunkNames = await readdir(new URL('field-counting-chunks/', assets));
  const viewName = chunkNames.find(name => /^FieldCountingView-[A-Z0-9]{8}\.js$/.test(name));
  assert.ok(viewName, 'view has its own hashed chunk');
  assert.match(entry, new RegExp(`field-counting-chunks/${viewName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(entry, /searchParams\.set\("retry"/);
  assert.doesNotMatch(entry, /__FIELD_COUNTING_VIEW_CHUNK_URL__/);
  assert.doesNotMatch(entry, /field-counting__rows/);
  const view = await readFile(new URL(viewName, new URL('field-counting-chunks/', assets)), 'utf8');
  assert.match(view, /field-counting__rows/);
});
