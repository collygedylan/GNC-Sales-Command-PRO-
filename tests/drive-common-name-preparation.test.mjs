import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareDriveCommonNameBatches } from '../src/views/drive-common-name-preparation.js';

test('classic Drive Common Name preparation matches its extracted owner', () => {
  const source = readFileSync(new URL('../src/views/drive-common-name-preparation.js', import.meta.url), 'utf8')
    .replaceAll('export function', 'function');
  assert.equal(readFileSync(new URL('../assets/drive-common-name-preparation.js', import.meta.url), 'utf8'), source);
});

test('Drive Common Name preparation exhausts every entry before completion', () => {
  const entries = Array.from({ length: 85 }, (_, index) => index);
  const pending = { index: 0, frame: 0, container: {}, fragment: {} };
  const frames = [], appended = [];
  let completed = 0;
  prepareDriveCommonNameBatches({
    pending, entries, renderEntry: entry => `<button>${entry}</button>`,
    isCurrent: () => true, onStale: () => assert.fail('current preparation became stale'),
    onComplete: () => { completed += 1; }, onError: assert.fail,
    appendHtml: (_state, html) => appended.push(html), updateProgress: () => {},
    getRenderedCount: () => entries.length, requestFrame: callback => frames.push(callback)
  });
  while (frames.length) frames.shift()();
  assert.equal(pending.index, entries.length);
  assert.equal(completed, 1);
  assert.match(appended.join(''), /<button>84<\/button>/);
});

test('stale Drive Common Name preparation never appends or completes', () => {
  let stale = 0;
  prepareDriveCommonNameBatches({
    pending: { index: 0 }, entries: [1], renderEntry: String, isCurrent: () => false,
    onStale: () => { stale += 1; }, onComplete: () => assert.fail('stale preparation completed'),
    onError: assert.fail, appendHtml: () => assert.fail('stale preparation appended')
  });
  assert.equal(stale, 1);
});
