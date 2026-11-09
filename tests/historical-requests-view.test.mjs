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
const built = await build({ stdin: { contents: "export * from './components/historical-requests/HistoricalRequestsView'; export { parseHistoricalArchivePage } from './services/historicalRequests';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react/jsx-runtime'], jsx: 'automatic', loader: { '.css': 'empty' } });
const componentModule = { exports: {} };
require('vm').runInNewContext(built.outputFiles[0].text, { require, module: componentModule, exports: componentModule.exports,
  console, process, Error, globalThis, AbortController, Intl, Date, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask });
const { HistoricalRequestsView } = componentModule.exports;
const { render, screen, fireEvent, waitFor, cleanup } = require('@testing-library/react');
afterEach(() => cleanup());

const repKey = 'rep:50000000-0000-4000-8000-000000000001';
const requestPath = ['Molly Dixon', 'Customer 001', 'Direct_or_NA', '2026-10-10_REQ-1', '00012'];
const photo = 'https://example.invalid/full-resolution.jpg?token=original';
const group = (key, label) => ({ key, label, requestCount: 1, totalValue: 900, unpricedCount: 1,
  customerKey: null, consigneeKey: null, consigneeName: null });
const folder = (value, label = value) => ({ kind: 'folder', key: `folder:${value}`, value, label, subtitle: '', recordCount: 1, totalValue: null });

function reportPage(query, scope) {
  const rows = query.operation === 'reps' ? [group(repKey, requestPath[0])]
    : query.operation === 'customers' ? [group('c:001', requestPath[1])] : [];
  return { scope, financials: scope === 'all', recordKind: query.recordKind || 'requests', ownRepKey: repKey,
    revision: 'rev1', generatedAt: '2026-10-10T12:00:00Z', page: query.page || 0, pageSize: query.pageSize || 25,
    total: rows.length, rows: rows.map(row => scope === 'own' ? { ...row, totalValue: null, unpricedCount: null } : row),
    summary: { requestCount: 10, totalValue: scope === 'all' ? 2500 : null, unpricedCount: scope === 'all' ? 2 : null } };
}

function archiveRecord(kind, overrides = {}) {
  return { kind: 'record', id: `${kind}-1`, title: `${kind} Red Maple`, subtitle: 'Indexed history', status: 'Completed',
    occurredAt: '2026-10-10T12:00:00Z', itemcode: '00012', commonname: 'Red Maple', contsize: '10G',
    locationcode: 'A.01', lotcode: 'L1', quantity: 0, unitListPrice: null, lineDollarValue: null,
    photoLinks: [photo], photoDate: '2026-10-09', facts: { Spec: '6–8 feet', Delivery: 'delivered', Dock: '0' },
    notes: ['Permanent snapshot'], ...(kind === 'requests' ? { archivePath: requestPath } : {}), ...overrides };
}

function archivePage(query, scope, rows, total = rows.length, pageSize = query.pageSize || 25) {
  const path = query.path || [];
  return { scope, financials: scope === 'all', recordKind: query.recordKind, operation: query.operation, path,
    depth: path.length, maxDepth: { requests: 5, orders: 3, reserves: 4, drive: 3 }[query.recordKind],
    revision: 'archive-r1', generatedAt: '2026-10-10T12:00:00Z', page: query.page || 0, pageSize, total, rows };
}

function defaultArchive(query, scope) {
  if (query.operation !== 'archive-folders') return archivePage(query, scope, [archiveRecord(query.recordKind)]);
  const depth = (query.path || []).length;
  if (query.recordKind !== 'requests') return archivePage(query, scope, [folder(String(depth + 1), `Folder ${depth + 1}`)]);
  const rows = [folder(requestPath[depth])];
  if (depth === 1) rows.push(folder('Direct_or_NA'));
  return archivePage(query, scope, rows);
}

function makeBridge(scopeKey, overrides = {}) {
  const calls = [];
  const scope = overrides.scope || (scopeKey.startsWith('dylan:') ? 'all' : 'own');
  const bridge = {
    scopeKey, role: overrides.role || (scopeKey.startsWith('dylan:') ? 'Admin' : 'Sales Rep'), revisionKey: 'rev1',
    async read(query, signal) {
      calls.push({ query, signal });
      return overrides.read ? overrides.read(query, signal) : reportPage(query, scope);
    },
    async readArchive(query, signal) {
      calls.push({ query, signal });
      const page = overrides.readArchive ? await overrides.readArchive(query, signal) : defaultArchive(query, scope);
      return componentModule.exports.parseHistoricalArchivePage(page, query, { canViewFinancials: bridge.role === 'Admin' });
    },
  };
  return { calls, bridge };
}

async function openArchivePath(path = requestPath) {
  for (const name of path) fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name}`) }));
}

test('report lookup choices retain their DOM and options while a revision refresh is pending', async () => {
  let hold = false;
  const releases = [];
  const fixture = makeBridge('dylan:directory-cache', { read: async query => {
    if (hold && query.recordKind === 'all') await new Promise(resolve => releases.push(resolve));
    return reportPage(query, 'all');
  } });
  const view = render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
  const select = await screen.findByLabelText('Reporting customer');
  await waitFor(() => assert.match(select.textContent, /Customer 001/));
  hold = true;
  view.rerender(React.createElement(HistoricalRequestsView, { bridge: { ...fixture.bridge, revisionKey: 'rev2' } }));
  await waitFor(() => assert.ok(releases.length));
  assert.equal(screen.getByLabelText('Reporting customer'), select);
  assert.match(select.textContent, /Customer 001/);
  hold = false;
  releases.forEach(resolve => resolve());
});

test('drills through five exact Request folders and preserves full-resolution photos and receipt facts', async () => {
  const fixture = makeBridge('dylan:all');
  render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
  await openArchivePath();
  await screen.findByText('6–8 feet');
  await screen.findByText('delivered');
  const image = screen.getByRole('img', { name: 'Archive photo 1' });
  assert.equal(image.getAttribute('src'), photo);
  assert.equal(image.closest('a').getAttribute('href'), photo);
  assert.ok(image.closest('a').querySelector('[data-photo-taken-date]'));
  const reads = fixture.calls.map(call => call.query).filter(query => query.operation.startsWith('archive-'));
  for (let depth = 0; depth < 5; depth++) assert.ok(reads.some(query => query.operation === 'archive-folders'
    && JSON.stringify(query.path) === JSON.stringify(requestPath.slice(0, depth))));
  assert.deepEqual(Array.from(reads.find(query => query.operation === 'archive-records').path), requestPath);
});

test('opens only verified deleted photos in Drive and retains available original images', async () => {
  const sourceUrl = 'https://example.invalid/2026-10-08/deleted.jpg';
  const drive = 'https://drive.google.com/file/d/archived-file_01/view';
  const receipt = { sourceUrl, sourceKey: 'photos:deleted', driveFileId: 'archived-file_01',
    verifiedAt: '2026-10-09T00:00:00Z', deletedAt: '2026-10-20T00:00:00Z', sha256: 'a'.repeat(64) };
  const record = archiveRecord('requests', { photoLinks: [photo, drive], photoArchiveReceipts: [receipt] });
  const fixture = makeBridge('rep:archived-photo', { readArchive: async query => query.operation === 'archive-records'
    ? archivePage(query, 'own', [record]) : defaultArchive(query, 'own') });
  render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
  await openArchivePath();
  const link = await screen.findByRole('link', { name: 'Open archived photo 2 in Google Drive (10/08/26)' });
  assert.equal(link.getAttribute('href'), drive);
  assert.equal(link.querySelector('img'), null);
  assert.equal(screen.getByRole('img', { name: 'Archive photo 1' }).getAttribute('src'), photo);
  assert.equal(document.querySelector(`a[href="${sourceUrl}"]`), null);
});

test('own scope exposes the authorized rep path while only verified Admin receives financial reports', async () => {
  const own = makeBridge('rep:own');
  render(React.createElement(HistoricalRequestsView, { bridge: own.bridge }));
  await openArchivePath(requestPath.slice(0, 1));
  await screen.findByRole('button', { name: /^Customer 001/ });
  assert.equal(screen.queryByRole('heading', { name: 'Executive reporting' }), null);
  assert.equal(document.body.textContent.includes('$'), false);
  cleanup();
  const all = makeBridge('dylan:all');
  render(React.createElement(HistoricalRequestsView, { bridge: all.bridge }));
  await screen.findByText('$2,500.00');
});

test('Eval cannot show financial values claimed by an all-scope response', async () => {
  const fixture = makeBridge('eval:all', { scope: 'all', role: 'Eval', readArchive: async query => archivePage(query, 'all',
    [{ ...folder(requestPath[0]), totalValue: 2500 }]) });
  render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
  await screen.findByRole('button', { name: /^Molly Dixon/ });
  assert.equal(document.body.textContent.includes('$'), false);
  assert.equal(screen.queryByRole('heading', { name: 'Executive reporting' }), null);
});

test('rejects a global archive page when the current rep authorization is own scope', async () => {
  const fixture = makeBridge('rep:own', { readArchive: async query => archivePage(query, 'all', [folder('Confidential Customer')]) });
  render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
  await screen.findByText('Data scope could not be confirmed.');
  assert.equal(screen.queryByRole('button', { name: /Confidential Customer/ }), null);
});

test('an authorization probe downgrade or denial conceals cached Request records', async () => {
  for (const outcome of ['error', 'own']) {
    cleanup();
    let mode = 'all';
    const fixture = makeBridge(`dylan:${outcome}`, { read: async query => {
      if (query.operation === 'reps' && mode === 'error') throw Object.assign(new Error('Rep scope denied.'), { status: 403 });
      return reportPage(query, mode);
    } });
    const view = render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
    await openArchivePath();
    await screen.findByText('requests Red Maple');
    mode = outcome;
    view.rerender(React.createElement(HistoricalRequestsView, { bridge: { ...fixture.bridge, revisionKey: 'rev2' } }));
    await screen.findByText('Data scope could not be confirmed.');
    assert.equal(screen.queryByText('requests Red Maple'), null);
  }
});

test('account change replaces the archive cache and aborts the old read', async () => {
  let oldSignal;
  const first = makeBridge('actor-a', { readArchive: (_query, signal) => {
    oldSignal = signal;
    return new Promise(() => {});
  } });
  const view = render(React.createElement(HistoricalRequestsView, { bridge: first.bridge }));
  await waitFor(() => assert.ok(oldSignal));
  const second = makeBridge('actor-b');
  view.rerender(React.createElement(HistoricalRequestsView, { bridge: second.bridge }));
  await screen.findByRole('button', { name: /^Molly Dixon/ });
  assert.equal(oldSignal.aborted, true);
});

test('a role change with the same scope key aborts the previous Admin leaf read', async () => {
  let adminSignal;
  let finish;
  const admin = makeBridge('shared-session', { scope: 'all', role: 'Admin', readArchive: (query, signal) => {
    if (query.operation !== 'archive-records') return defaultArchive(query, 'all');
    return new Promise(resolve => {
      adminSignal = signal;
      finish = () => resolve(archivePage(query, 'all', [archiveRecord('requests', { lineDollarValue: 6000 })]));
    });
  } });
  const view = render(React.createElement(HistoricalRequestsView, { bridge: admin.bridge }));
  await openArchivePath();
  await waitFor(() => assert.ok(adminSignal));
  const evalBridge = makeBridge('shared-session', { scope: 'all', role: 'Eval' }).bridge;
  view.rerender(React.createElement(HistoricalRequestsView, { bridge: evalBridge }));
  await screen.findByRole('button', { name: /^Molly Dixon/ });
  assert.equal(adminSignal.aborted, true);
  finish();
  assert.equal(document.body.textContent.includes('$'), false);
});

test('refresh retains the same account’s loaded folders on transient failure and clears them on denial', async () => {
  let error;
  const fixture = makeBridge('actor:own', { readArchive: async query => {
    if (error) throw error;
    return defaultArchive(query, 'own');
  } });
  render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
  await screen.findByRole('button', { name: /^Molly Dixon/ });
  error = new Error('History service unavailable.');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('Showing the last loaded archive while refresh retries.');
  assert.ok(screen.getByRole('button', { name: /^Molly Dixon/ }));
  error = Object.assign(new Error('History access denied.'), { status: 403 });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('History access denied.');
  assert.equal(screen.queryByRole('button', { name: /^Molly Dixon/ }), null);
});

test('requests the next server folder page instead of limiting the visible folder set', async () => {
  const fixture = makeBridge('dylan:all', { readArchive: async query => query.path?.length === 1
    ? archivePage(query, 'all', [folder(query.page ? 'South Nursery' : 'North Nursery')], 2, 1) : defaultArchive(query, 'all') });
  render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
  await openArchivePath(requestPath.slice(0, 1));
  await screen.findByRole('button', { name: /^North Nursery/ });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('button', { name: /^South Nursery/ });
  assert.ok(fixture.calls.some(call => call.query.operation === 'archive-folders' && call.query.page === 1));
});

test('all four archive tabs support search and a Request search can reach records beyond the first page', async () => {
  const fixture = makeBridge('rep:own', { readArchive: async query => query.recordKind === 'requests' && query.operation === 'archive-search'
    ? archivePage(query, 'own', [archiveRecord('requests', { title: query.page ? '26th Request result' : 'First Request result' })], 26)
    : defaultArchive(query, 'own') });
  render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
  const tabNames = ['Historical Requests', 'Historical SOC Open Orders', 'Historical SOC Reserves', 'Historical Drive Around'];
  assert.deepEqual(tabNames.map(name => screen.getByRole('button', { name }).textContent), tabNames);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search this archive' }), { target: { value: 'maple' } });
  await screen.findByText('First Request result');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('26th Request result');
  assert.ok(fixture.calls.some(call => call.query.operation === 'archive-search' && call.query.page === 1));
  for (const [tab, kind] of [[tabNames[1], 'orders'], [tabNames[2], 'reserves'], [tabNames[3], 'drive']]) {
    fireEvent.click(screen.getByRole('button', { name: tab }));
    await screen.findByText(`${kind} Red Maple`);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  await openArchivePath(['Folder 1', 'Folder 2', 'Folder 3']);
  await screen.findByText('drive Red Maple');
});

test('rejects a foreign archive row even when the page echoes the selected path; rejects unsafe photo URLs', async () => {
  const fixture = makeBridge('rep:own', { readArchive: async query => query.operation === 'archive-records'
    ? archivePage(query, 'own', [archiveRecord('requests', { title: 'Other Rep Secret', archivePath: ['Other Rep', ...requestPath.slice(1)] })])
    : defaultArchive(query, 'own') });
  render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
  await openArchivePath();
  await screen.findByText('Request archive record does not match the selected folder.');
  assert.equal(screen.queryByText('Other Rep Secret'), null);
  const { historicalPhotoUrls } = componentModule.exports;
  assert.deepEqual(Array.from(historicalPhotoUrls(['javascript:alert(1)', '//unsafe.invalid/photo', photo, JSON.stringify([photo])])), [photo]);
});

test('executive month, rep and customer filters query complete totals and monthly grouping', async () => {
  const fixture = makeBridge('dylan:reports');
  render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
  await screen.findByRole('heading', { name: 'Executive reporting' });
  fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'month' } });
  fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-02' } });
  fireEvent.change(screen.getByLabelText('Group totals'), { target: { value: 'months' } });
  await waitFor(() => assert.ok(fixture.calls.some(call => call.query.operation === 'months' && call.query.dateFrom === '2026-02-01' && call.query.dateTo === '2026-02-28')));
  fireEvent.change(screen.getByLabelText('Reporting rep'), { target: { value: repKey } });
  await waitFor(() => assert.ok(fixture.calls.some(call => call.query.operation === 'months' && call.query.repKey === repKey)));
  assert.ok(fixture.calls.some(call => call.query.operation === 'customers' && call.query.pageSize === 100));
});

test('invalid reporting dates retain inputs without querying a reversed range', async () => {
  const fixture = makeBridge('dylan:range');
  render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
  await screen.findByRole('heading', { name: 'Executive reporting' });
  fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'range' } });
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-02' } });
  fireEvent.change(screen.getByLabelText('Through date'), { target: { value: '2026-10-01' } });
  await screen.findByText('The through date must be on or after the from date.');
  assert.equal(screen.getByLabelText('From date').value, '2026-10-02');
  assert.equal(document.body.textContent.includes('$'), false);
  assert.ok(!fixture.calls.some(call => call.query.dateFrom === '2026-10-02' && call.query.dateTo === '2026-10-01'));
});

test('an executive report scope downgrade conceals cached dollar values', async () => {
  const fixture = makeBridge('dylan:downgrade', { read: async query => reportPage(query, query.operation === 'months' ? 'own' : 'all') });
  render(React.createElement(HistoricalRequestsView, { bridge: fixture.bridge }));
  await screen.findByRole('heading', { name: 'Executive reporting' });
  fireEvent.change(screen.getByLabelText('Group totals'), { target: { value: 'months' } });
  await screen.findByText('Data scope could not be confirmed.');
  assert.equal(document.body.textContent.includes('$'), false);
});
