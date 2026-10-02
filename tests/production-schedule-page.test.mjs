import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://field.example.test' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.AbortController = dom.window.AbortController;
const { createProductionSchedulePage } = await import('../pages/managers/ProductionSchedule.js');

const snapshotId = 'd0060000-0000-4000-8000-000000000001';
const metadata = {
  ok: true,
  snapshot: { id: snapshotId, importedAt: '2026-10-01T12:00:00Z' },
  sheets: [{ id: 0, index: 0, title: 'PROD SCHED', columns: [{ index: 1, header: 'ITEM NO.' }], filterColumns: [] }]
};

function rootElement() {
  const host = document.createElement('div');
  const root = document.createElement('div');
  host.append(root);
  document.body.append(host);
  return { host, root };
}

async function waitFor(predicate, message) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail(message || 'Timed out waiting for Production Schedule state.');
}

test('schedule page serves a cached page immediately while stale rows refresh in the background', async () => {
  const now = Date.now;
  let clock = 100000;
  Date.now = () => clock;
  const calls = [];
  let resolveRefreshRows;
  const request = (body, signal) => {
    calls.push({ body, signal });
    if (body.operation === 'metadata') return Promise.resolve(metadata);
    if (body.operation === 'status') return Promise.resolve({ ok: true, run: { status: 'ready', id: snapshotId } });
    if (body.operation === 'rows') {
      if (resolveRefreshRows) return new Promise(resolve => { resolveRefreshRows = result => resolve(result); });
      const name = calls.filter(call => call.body.operation === 'rows').length === 1 ? 'Old Widget' : 'Fresh Widget';
      return Promise.resolve({ ok: true, rows: [{ sourceRow: 9, cells: { 1: name }, fieldCount: 1 }],
        total: 1, nextCursor: null, snapshotId, hasMore: false });
    }
    throw new Error(`Unexpected operation: ${body.operation}`);
  };
  const page = createProductionSchedulePage();
  const first = rootElement();
  try {
    page.mount(first.root, request, 'dylan-profile');
    await waitFor(() => first.root.textContent.includes('Old Widget'), 'initial schedule rows should load');
    page.unmount();

    clock += 31000;
    resolveRefreshRows = () => {};
    const second = rootElement();
    page.mount(second.root, request, 'dylan-profile');
    await waitFor(() => calls.filter(call => call.body.operation === 'rows').length === 2,
      'stale cached page should trigger a background row refresh');
    assert.match(second.root.textContent, /Old Widget/);
    assert.match(second.root.textContent, /Refreshing saved rows/);
    resolveRefreshRows({ ok: true, rows: [{ sourceRow: 9, cells: { 1: 'Fresh Widget' }, fieldCount: 1 }],
      total: 1, nextCursor: null, snapshotId, hasMore: false });
    await waitFor(() => second.root.textContent.includes('Fresh Widget'), 'fresh schedule rows should replace the cache');
    assert.doesNotMatch(second.root.textContent, /Refreshing saved rows/);
    page.unmount();
    first.host.remove();
    second.host.remove();
  } finally {
    page.unmount();
    Date.now = now;
  }
});

test('unmount aborts pending metadata work and releases the in-flight view state', async () => {
  const page = createProductionSchedulePage();
  const view = rootElement();
  let readSignal;
  page.mount(view.root, (_body, signal) => {
    readSignal = signal;
    return new Promise(() => {});
  }, 'profile-unmount');
  page.unmount();
  assert.equal(readSignal.aborted, true);
  view.host.remove();
});

test('schedule details cap open rows and do not refetch from rerenders', async () => {
  const calls = [];
  const request = (body) => {
    calls.push(body);
    if (body.operation === 'metadata') return Promise.resolve(metadata);
    if (body.operation === 'status') return Promise.resolve({ ok: true, run: { status: 'ready', id: snapshotId } });
    if (body.operation === 'rows') return Promise.resolve({ ok: true,
      rows: Array.from({ length: 9 }, (_, index) => ({ sourceRow: index + 9, cells: { 1: `Item ${index + 1}` }, fieldCount: 1 })),
      total: 9, nextCursor: null, snapshotId, hasMore: false });
    if (body.operation === 'row_detail') return Promise.resolve({ ok: true, snapshotId,
      row: { sourceRow: body.sourceRow, cells: { 1: `Item ${body.sourceRow - 8}` } } });
    throw new Error(`Unexpected operation: ${body.operation}`);
  };
  const page = createProductionSchedulePage();
  const view = rootElement();
  try {
    page.mount(view.root, request, 'detail-cap-profile');
    await waitFor(() => view.root.querySelectorAll('[data-ps-detail]').length === 9, 'nine schedule cards should render');
    for (let index = 0; index < 9; index += 1) {
      const summary = view.root.querySelector(`[data-ps-detail="${index}"] summary`);
      summary.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    await waitFor(() => calls.filter(call => call.operation === 'row_detail').length === 9,
      'each explicitly opened row should request its details once');
    assert.equal(view.root.querySelectorAll('[data-ps-detail][open]').length, 8,
      'opening a ninth row collapses the oldest open disclosure');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls.filter(call => call.operation === 'row_detail').length, 9,
      'rerendering expanded rows must not create duplicate detail reads');
  } finally {
    page.unmount();
    view.host.remove();
  }
});

test('schedule pagination restores a fresh cached page without another network read', async () => {
  const calls = [];
  const request = (body) => {
    calls.push(body);
    if (body.operation === 'metadata') return Promise.resolve(metadata);
    if (body.operation === 'status') return Promise.resolve({ ok: true, run: { status: 'ready', id: snapshotId } });
    if (body.operation === 'rows') {
      const isNext = body.cursor === '10';
      return Promise.resolve({ ok: true, rows: [{ sourceRow: isNext ? 11 : 9, cells: { 1: isNext ? 'Next item' : 'First item' }, fieldCount: 1 }],
        total: 2, nextCursor: isNext ? null : '10', snapshotId, hasMore: !isNext });
    }
    throw new Error(`Unexpected operation: ${body.operation}`);
  };
  const page = createProductionSchedulePage();
  const view = rootElement();
  try {
    page.mount(view.root, request, 'paging-profile');
    await waitFor(() => view.root.textContent.includes('First item'), 'first page should load');
    view.root.querySelector('[data-ps-action="next"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await waitFor(() => view.root.textContent.includes('Next item'), 'next page should load');
    view.root.querySelector('[data-ps-action="previous"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await waitFor(() => view.root.textContent.includes('First item'), 'previous page should restore from cache');
    assert.equal(calls.filter(call => call.operation === 'rows').length, 2,
      'fresh cached page should not be fetched again within the 30-second TTL');
  } finally {
    page.unmount();
    view.host.remove();
  }
});
