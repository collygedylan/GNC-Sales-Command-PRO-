import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const React = require('react');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'react') return React;
  return originalLoad.call(this, request, parent, isMain);
};
const built = await build({ entryPoints: [new URL('../components/field-counting/FieldCountingView.tsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react/jsx-runtime'], jsx: 'automatic' });
const componentModule = { exports: {} };
require('vm').runInNewContext(built.outputFiles[0].text, { require, module: componentModule, exports: componentModule.exports,
  console, process, Error, globalThis, crypto: globalThis.crypto, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask });
const { render, screen, fireEvent, waitFor, cleanup } = require('@testing-library/react');
const { FieldCountingView } = componentModule.exports;

afterEach(() => cleanup());

const lot = (sourceUid, commonname) => ({ sourceUid, block: 'A', location: 'A.01.000', itemcode: '001', commonname,
  contsize: '#3', lotcode: sourceUid, season: 'F1', onHand: null });
function makeSnapshot(query, revision = 'r1') {
  if (!query.block) {
    const options = (query.page || 0) === 0
      ? [{ value: 'A', label: 'Block A', rowCount: 3 }, ...Array.from({ length: 99 }, (_, index) => ({ value: `B${index + 1}`, label: `Block B${index + 1}`, rowCount: 1 }))]
      : [{ value: 'Z', label: 'Block Z', rowCount: 2 }];
    return { datasetRevision: revision, masterRevision: 'm1', rows: [], counts: [], options, page: query.page || 0, total: 101, complete: (query.page || 0) > 0 };
  }
  if (!query.location) return { datasetRevision: revision, masterRevision: 'm1', rows: [], counts: [],
    options: [{ value: 'A.01.000', label: 'A.01.000', rowCount: 3 }], page: query.page || 0, total: 1, complete: true };
  const page = query.page || 0;
  const rows = page === 0 ? [lot('lot-b', 'Beta'), lot('lot-a', 'Alpha')] : [lot('lot-c', 'Gamma')];
  const counts = page === 0 ? [
    { sourceUid: 'lot-a', countedQty: 8, direction: 'north_south', rowOrder: 2, note: '', updatedAt: '2026-10-10T10:00:00Z', actor: 'Worker' },
    { sourceUid: 'lot-b', countedQty: null, direction: 'north_south', rowOrder: 1, note: '', updatedAt: '', actor: '' }
  ] : [];
  return { datasetRevision: revision, masterRevision: 'm1', rows, counts, options: [], page, total: 3, complete: page === 1 };
}
function bridge(scopeKey, revisionKey = 'r1', overrides = {}) {
  return { scopeKey, countType: 'bunch', revisionKey,
    readSnapshot: overrides.readSnapshot || (async query => makeSnapshot(query, revisionKey)),
    saveCounts: overrides.saveCounts || (async input => ({ revision: 'next', savedSourceUids: input.entries.map(entry => entry.sourceUid) })),
    completeAndEmail: overrides.completeAndEmail || (async input => ({ revision: 'next', savedSourceUids: input.entries.map(entry => entry.sourceUid), reportId: 'report-1', deliveryStatus: 'queued' })) };
}
async function chooseLocation() {
  await screen.findByRole('option', { name: /Block A/ });
  fireEvent.click(screen.getByRole('button', { name: 'Load next 100' }));
  await screen.findByRole('option', { name: /Block Z/ });
  assert.ok(screen.getByRole('option', { name: /Block A/ }), 'the earlier block page remains available');
  fireEvent.change(screen.getByLabelText('Block'), { target: { value: 'A' } });
  await screen.findByRole('option', { name: /A\.01\.000/ });
  fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'A.01.000' } });
  await screen.findByRole('heading', { name: 'Beta' });
}

test('keeps option selection visible, honors saved row order and submits only this page while other-page drafts survive', async () => {
  const calls = [];
  const saveCounts = async input => { calls.push(input); return { revision: 'r2', savedSourceUids: input.entries.map(entry => entry.sourceUid) }; };
  const rendered = render(React.createElement(FieldCountingView, { bridge: bridge('actor-a', 'r1', { saveCounts }) }));
  await chooseLocation();
  assert.equal(screen.getByLabelText('Block').value, 'A', 'selected block stays represented after drilling into a location');
  assert.deepEqual(Array.from(document.querySelectorAll('[data-source-uid]')).map(node => node.dataset.sourceUid), ['lot-b', 'lot-a'], 'saved row_order is retained');
  fireEvent.change(screen.getByLabelText('Count Beta, lot-b'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load next 100' }));
  await screen.findByRole('heading', { name: 'Gamma' });
  fireEvent.change(screen.getByLabelText('Count Gamma, lot-c'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Previous 100' }));
  await screen.findByRole('heading', { name: 'Beta' });
  assert.equal(screen.getByLabelText('Count Beta, lot-b').value, '0');
  fireEvent.click(screen.getByRole('button', { name: 'Save this page' }));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(Array.from(calls[0].entries, entry => entry.sourceUid).join(','), 'lot-b');
  fireEvent.click(screen.getByRole('button', { name: 'Load next 100' }));
  await screen.findByRole('heading', { name: 'Gamma' });
  assert.equal(screen.getByLabelText('Count Gamma, lot-c').value, '4', 'an unsaved draft on another page survives saving this page');
  rendered.unmount();
});

test('keeps direction and location note edits after the React event callback returns', async () => {
  const calls = [];
  const saveCounts = async input => {
    calls.push(input);
    return { revision: 'r2', savedSourceUids: input.entries.map(entry => entry.sourceUid) };
  };
  render(React.createElement(FieldCountingView, { bridge: bridge('actor-a', 'r1', { saveCounts }) }));
  await chooseLocation();
  fireEvent.change(screen.getByLabelText('Count Beta, lot-b'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('Row direction'), { target: { value: 'south_north' } });
  fireEvent.change(screen.getByLabelText('Location note (optional)'), { target: { value: 'Counted from the south end' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save this page' }));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(calls[0].direction, 'south_north');
  assert.equal(calls[0].entries[0].note, 'Counted from the south end');
});

test('retains an identical command id after an uncertain response and resets private drafts for another account', async () => {
  const calls = [];
  let attempts = 0;
  const saveCounts = async input => {
    calls.push(input);
    attempts += 1;
    if (attempts === 1) throw new Error('Connection lost before confirmation.');
    return { revision: 'r2', savedSourceUids: input.entries.map(entry => entry.sourceUid) };
  };
  const rendered = render(React.createElement(FieldCountingView, { bridge: bridge('actor-a', 'r1', { saveCounts }) }));
  await chooseLocation();
  fireEvent.change(screen.getByLabelText('Count Beta, lot-b'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save this page' }));
  await screen.findByText('Connection lost before confirmation.');
  fireEvent.click(screen.getByRole('button', { name: 'Save this page' }));
  await waitFor(() => assert.equal(calls.length, 2));
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
  rendered.rerender(React.createElement(FieldCountingView, { bridge: bridge('actor-b', 'r1') }));
  assert.equal(screen.queryByLabelText('Count Beta, lot-b'), null, 'another account starts without the previous private draft');
  await screen.findByRole('option', { name: /Block A/ });
});

test('aborts the old owner read when the field island changes account', async () => {
  let firstSignal;
  const firstRead = bridge('actor-a', 'r1', { readSnapshot: query => {
    firstSignal = query.signal;
    return new Promise(() => {});
  } });
  const rendered = render(React.createElement(FieldCountingView, { bridge: firstRead }));
  await waitFor(() => assert.ok(firstSignal));
  rendered.rerender(React.createElement(FieldCountingView, { bridge: bridge('actor-b', 'r1') }));
  await screen.findByRole('option', { name: /Block A/ });
  assert.equal(firstSignal.aborted, true);
});
