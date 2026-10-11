// @test-group: bunch-notes
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { removeObsoleteBunchChunks } from '../scripts/build-bunch-note.mjs';

test('Bunch chunk cleanup removes only owned eight-character base36 chunks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bunch-chunks-'));
  const chunks = path.join(root, 'assets', 'bunch-note-chunks');
  await mkdir(path.join(chunks, 'nested'), { recursive: true });
  const names = [
    'StructuredView-AB12CD34.js',
    'card_board-00AAZZ99.js',
    'foreign-ABCDEFGH.js.map',
    'short-ABC1234.js',
    'long-ABC123456.js',
    'notes.txt'
  ];
  for (const name of names) await writeFile(path.join(chunks, name), name);
  await writeFile(path.join(chunks, 'nested', 'nested-ABC12345.js'), 'nested');

  try {
    await removeObsoleteBunchChunks(chunks);
    assert.deepEqual((await readdir(chunks)).sort(), [
      'foreign-ABCDEFGH.js.map', 'long-ABC123456.js', 'nested', 'notes.txt', 'short-ABC1234.js'
    ]);
    assert.equal(await readFile(path.join(chunks, 'nested', 'nested-ABC12345.js'), 'utf8'), 'nested');
    await writeFile(path.join(chunks, 'current-ABCD1234.js'), 'current');
    await writeFile(path.join(chunks, 'stale-ZYXW9876.js'), 'stale');
    await removeObsoleteBunchChunks(chunks, ['current-ABCD1234.js']);
    assert.deepEqual((await readdir(chunks)).sort(), [
      'current-ABCD1234.js', 'foreign-ABCDEFGH.js.map', 'long-ABC123456.js', 'nested', 'notes.txt', 'short-ABC1234.js'
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Bunch entry keeps the two lazy views split and caches only authoritative account/revision snapshots', async () => {
  const source = await readFile(new URL('../components/bunch-notes/BunchNoteEntry.tsx', import.meta.url), 'utf8');
  assert.match(source, /import\(new URL\(`\$\{chunkPath\}\$\{retryToken\}`/);
  assert.match(source, /importView<StructuredViewProps>\(STRUCTURED_CHUNK_PATH, structuredLoadAttempt\+\+/);
  assert.match(source, /importView<CardBoardViewProps>\(CARD_BOARD_CHUNK_PATH, cardLoadAttempt\+\+/);
  assert.match(source, /__BUNCH_CARD_BOARD_CHUNK__/);
  assert.match(source, /__BUNCH_STRUCTURED_CHUNK__/);
  assert.match(source, /retry=\$\{attempt\}/);
  assert.match(source, /\['bunch-note-view', accountKey, revisionKey\]/);
  assert.match(source, /revalidateOnFocus: false/);
  assert.match(source, /mutate\(snapshot, \{ revalidate: false \}\)/);
  assert.doesNotMatch(source, /as unknown as/);
  assert.match(source, /key=\{accountKey\}/);
});

test('compiled Bunch entry defers card and worksheet markup into their own chunks', async () => {
  const assets = new URL('../assets/', import.meta.url);
  const entry = await readFile(new URL('bunch-note-structured.js', assets), 'utf8');
  const chunks = new URL('bunch-note-chunks/', assets);
  const files = await readdir(chunks);
  const cardName = files.find(name => /^CardBoard-[A-Z0-9]{8}\.js$/.test(name));
  const structuredName = files.find(name => /^StructuredBunchNote-[A-Z0-9]{8}\.js$/.test(name));
  assert.ok(cardName, 'card board is emitted as a hashed lazy chunk');
  assert.ok(structuredName, 'structured editor is emitted as a hashed lazy chunk');
  const [cards, structured] = await Promise.all([
    readFile(new URL(cardName, chunks), 'utf8'),
    readFile(new URL(structuredName, chunks), 'utf8')
  ]);
  assert.match(entry, /bunch-note-chunks\/CardBoard-[A-Z0-9]{8}\.js/);
  assert.match(entry, /bunch-note-chunks\/StructuredBunchNote-[A-Z0-9]{8}\.js/);
  assert.match(entry, /retry=/);
  assert.match(entry, /new URL\(`\$\{e\}\$\{r\}`/);
  assert.match(entry, /\?retry=\$\{t\}/);
  assert.doesNotMatch(entry, /bn-card-board|bn-house-section/);
  assert.match(cards, /bn-card-board/);
  assert.doesNotMatch(cards, /bn-house-section/);
  assert.match(structured, /bn-house-section/);
  assert.doesNotMatch(structured, /bn-card-board/);
});
