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
const built = await build({ entryPoints: [new URL('../components/historical-requests/HistoricalRequestsView.tsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react/jsx-runtime'], jsx: 'automatic', loader: { '.css': 'empty' } });
const componentModule = { exports: {} };
require('vm').runInNewContext(built.outputFiles[0].text, { require, module: componentModule, exports: componentModule.exports,
  console, process, Error, globalThis, AbortController, Intl, Date, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask });
const { HistoricalRequestsView } = componentModule.exports;
const { render, screen, fireEvent, waitFor, cleanup } = require('@testing-library/react');
afterEach(() => cleanup());

const group = (key, label, totalValue = 0, unpricedCount = 0) => ({ key, label, requestCount: 1, totalValue, unpricedCount });
const base = { scope: 'own', revision: 'rev1', generatedAt: '2026-10-10T12:00:00Z', page: 0, pageSize: 25, total: 1,
  rows: [group('c:001', 'Customer 001')], summary: { requestCount: 1, totalValue: 0, unpricedCount: 1 } };
function makeBridge(scopeKey, overrides = {}) {
  const calls = [];
  return { calls, bridge: { scopeKey, revisionKey: overrides.revisionKey || 'rev1', read: async (query, signal) => {
    calls.push({ query, signal });
    if (overrides.read) return overrides.read(query, signal);
    if (query.operation === 'reps') return { ...base, scope: 'all', rows: [group('rep:molly', 'Molly Dixon', 900, 1)] };
    if (query.operation === 'consignees') return { ...base, rows: [group('g:east', 'East Yard', 250, 1)] };
    if (query.operation === 'requests') return { ...base, rows: [{ id: 'req-1', customerName: 'Customer 001', consigneeName: 'East Yard', salesrepUserId: null,
      salesrepName: 'Molly Dixon', itemcode: '00012', commonname: 'Red Maple', location: 'A.01', requestedAt: null, status: 'Completed', requestQty: 0,
      effectiveQty: 25, listPrice: null, totalValue: null, unresolvedReason: 'current_list_price_unavailable_or_invalid' }] };
    return { ...base, scope: overrides.scope || 'own', summary: overrides.scope === 'all' ? { requestCount: 10, totalValue: 2500, unpricedCount: 2 } : base.summary };
  } } };
}

test('drills customer to consignee to paginated requests and shows unresolved pricing explicitly', async () => {
  const fixture = makeBridge('rep:molly:own');
  render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
  await screen.findByRole('button', { name: /Customer 001/ });
  fireEvent.click(screen.getByRole('button', { name: /Customer 001/ }));
  await screen.findByRole('button', { name: /East Yard/ });
  fireEvent.click(screen.getByRole('button', { name: /East Yard/ }));
  await screen.findByText('Unresolved value: Current master list price is unavailable or invalid.');
  assert.equal(fixture.calls.map(call => call.query.operation).includes('requests'), true);
  assert.equal(fixture.calls.find(call => call.query.operation === 'requests').query.customerKey, 'c:001');
  assert.equal(fixture.calls.find(call => call.query.operation === 'requests').query.consigneeKey, 'g:east');
  assert.equal(screen.queryByRole('heading', { name: 'Requests by sales rep' }), null);
});

test('only renders the all-scope dashboard after server confirms all scope for totals and rep pages', async () => {
  const own = makeBridge('actor:rep:own');
  render(React.createElement(HistoricalRequestsView, { bridge: own.bridge }));
  await screen.findByRole('button', { name: /Customer 001/ });
  assert.equal(screen.queryByRole('heading', { name: 'Requests by sales rep' }), null);
  assert.equal(own.calls.some(call => call.query.operation === 'reps'), false);

  cleanup();
  const all = makeBridge('actor:admin:all', { scope: 'all' });
  render(React.createElement(HistoricalRequestsView, { bridge: all.bridge }));
  await screen.findByText('Molly Dixon');
  await screen.findByText('$2,500.00');
  assert.equal(all.calls.some(call => call.query.operation === 'reps'), true);
});

test('fails closed on all-scope customer values when the rep endpoint returns own scope', async () => {
  const fixture = makeBridge('actor:admin:all', { read: async query => {
    if (query.operation === 'customers') return { ...base, scope: 'all', rows: [group('c:secret', 'Confidential Customer', 7777)] };
    if (query.operation === 'reps') return { ...base, scope: 'own', rows: [group('rep:own', 'Own Rep', 10)] };
    return { ...base, scope: 'all', rows: [] };
  } });
  render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
  await screen.findByText('Dashboard scope could not be confirmed.');
  assert.equal(screen.queryByRole('button', { name: /Confidential Customer/ }), null);
  assert.equal(screen.queryByText('$7,777.00'), null);
});

test('keeps the all-scope probe active through drilldown and hides cached details after its error or scope downgrade', async () => {
  for (const repOutcome of ['error', 'own']) {
    cleanup();
    let repMode = 'all';
    const bridge = {
      scopeKey: `actor:admin:${repOutcome}`,
      revisionKey: 'rev1',
      read: async query => {
        if (query.operation === 'customers') return { ...base, scope: 'all', rows: [group('c:secret', 'Confidential Customer', 7777)] };
        if (query.operation === 'reps') {
          if (repMode === 'error') throw new Error('Rep scope unavailable.');
          return { ...base, scope: repMode, rows: [group('rep:admin', 'Admin View', 100)] };
        }
        if (query.operation === 'consignees') return { ...base, scope: 'all', rows: [group('g:secret', 'Confidential Consignee', 6000)] };
        if (query.operation === 'requests') return { ...base, scope: 'all', rows: [{ id: 'req-secret', customerName: 'Confidential Customer',
          consigneeName: 'Confidential Consignee', salesrepUserId: null, salesrepName: 'Secret Rep', itemcode: 'SECRET-1', commonname: 'Confidential Plant',
          location: 'Secret Location', requestedAt: null, status: 'Pending', requestQty: 1, effectiveQty: 1, listPrice: 6000, totalValue: 6000, unresolvedReason: null }] };
        return { ...base, scope: 'all', rows: [] };
      },
    };
    const view = render(React.createElement(HistoricalRequestsView, { bridge }));
    await screen.findByRole('button', { name: /Confidential Customer/ });
    await screen.findByText('Admin View');
    fireEvent.click(screen.getByRole('button', { name: /Confidential Customer/ }));
    await screen.findByRole('button', { name: /Confidential Consignee/ });
    fireEvent.click(screen.getByRole('button', { name: /Confidential Consignee/ }));
    await screen.findByText('Confidential Plant');

    repMode = repOutcome;
    view.rerender(React.createElement(HistoricalRequestsView, { bridge: { ...bridge, revisionKey: 'rev2' } }));
    await screen.findByText('Data scope could not be confirmed.');
    assert.equal(screen.queryByText('Confidential Plant'), null, `${repOutcome}: request rows are suppressed`);
    assert.equal(screen.queryByText('$6,000.00'), null, `${repOutcome}: cached detail totals are suppressed`);
    assert.equal(screen.queryByRole('button', { name: /Confidential Consignee/ }), null, `${repOutcome}: cached consignee groups are suppressed`);
    assert.ok(screen.getByRole('button', { name: 'Return to customers and refresh' }));
  }
});

test('scope change replaces the private SWR cache and aborts the previous account read', async () => {
  let oldSignal;
  const first = makeBridge('actor-a:all', { read: (query, signal) => {
    if (query.operation === 'customers') { oldSignal = signal; return new Promise(() => {}); }
    return Promise.resolve({ ...base, scope: 'all', rows: [] });
  } });
  const view = render(React.createElement(HistoricalRequestsView, { bridge: first.bridge }));
  await waitFor(() => assert.ok(oldSignal));
  const second = makeBridge('actor-b:own');
  view.rerender(React.createElement(HistoricalRequestsView, { bridge: second.bridge }));
  await screen.findByRole('button', { name: /Customer 001/ });
  assert.equal(oldSignal.aborted, true);
  assert.equal(screen.queryByText('Molly Dixon'), null);
});

test('hides prior rows and exposes retry when the current request read fails', async () => {
  let attempt = 0;
  const fixture = makeBridge('actor:own', { read: async query => {
    if (query.operation !== 'customers') return { ...base, rows: [] };
    attempt += 1;
    if (attempt === 1) return base;
    throw new Error('History service unavailable.');
  } });
  render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
  await screen.findByRole('button', { name: /Customer 001/ });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByRole('alert');
  assert.equal(screen.queryByRole('button', { name: /Customer 001/ }), null);
  assert.ok(screen.getByText('History service unavailable.'));
});

test('requests the next server page instead of aggregating only the initial customer page', async () => {
  const fixture = makeBridge('actor:admin:all', { read: async query => {
    if (query.operation === 'customers') return { ...base, scope: 'all', page: query.page || 0, pageSize: 1, total: 2,
      rows: [group(query.page ? 'c:002' : 'c:001', query.page ? 'South Nursery' : 'North Nursery')] };
    if (query.operation === 'summary') return { ...base, scope: 'all', rows: [] };
    if (query.operation === 'reps') return { ...base, scope: 'all', rows: [] };
    return { ...base, scope: 'all', rows: [] };
  } });
  render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
  await screen.findByRole('button', { name: /North Nursery/ });
  fireEvent.click(screen.getAllByRole('button', { name: 'Next' }).at(-1));
  await screen.findByRole('button', { name: /South Nursery/ });
  assert.ok(fixture.calls.some(call => call.query.operation === 'customers' && call.query.page === 1));
});
