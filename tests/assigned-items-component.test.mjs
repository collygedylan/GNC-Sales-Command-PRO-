import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const rootDir = process.cwd();
const tempRoot = path.join(rootDir, '.gnc-local', 'assigned-items-component');
await fs.mkdir(tempRoot, { recursive: true });
const tempDir = await fs.mkdtemp(path.join(tempRoot, 'run-'));
await build({ entryPoints: ['components/assigned-items/AssignedItems.jsx'], bundle: true, format: 'esm', platform: 'browser', target: 'es2020', jsx: 'automatic', external: ['react', 'react-dom/client', '@tanstack/react-virtual'], outfile: path.join(tempDir, 'component.mjs') });
let dom, mounted;
const previous = {};
const globalNames = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'MutationObserver', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
for (const name of globalNames) previous[name] = Object.getOwnPropertyDescriptor(globalThis, name);

class ResizeObserverMock {
  static observed = new Set();
  observe(target) { ResizeObserverMock.observed.add(target); }
  unobserve() {}
  disconnect() {}
}

function setupDom(width = 1024) {
  dom = new JSDOM('<!doctype html><div id="main-scroll-area"><div id="layout"><div id="host"></div></div></div>', { pretendToBeVisual: true });
  ResizeObserverMock.observed.clear();
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, MutationObserver: dom.window.MutationObserver, ResizeObserver: ResizeObserverMock, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const scroll = document.getElementById('main-scroll-area');
  Object.defineProperties(scroll, { clientHeight: { configurable: true, value: 600 }, offsetHeight: { configurable: true, value: 600 }, offsetWidth: { configurable: true, value: 900 }, scrollHeight: { configurable: true, value: 900000 } });
  scroll.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600, left: 0, right: 900, width: 900, x: 0, y: 0, toJSON() {} });
  const host = document.getElementById('host');
  host.getBoundingClientRect = () => ({ top: 100, bottom: 700, height: 600, left: 0, right: 900, width: 900, x: 0, y: 100, toJSON() {} });
  window.ResizeObserver = ResizeObserverMock;
  const originalRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() {
    if (this.hasAttribute?.('data-manager-assigned-group')) return 42;
    if (this.hasAttribute?.('data-manager-assigned-item-row')) return 56;
    if (this.hasAttribute?.('data-manager-assigned-item-card')) return 280;
    return 0;
  } });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 900; } });
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.tagName === 'THEAD') return { top: 100, bottom: 144, height: 44, left: 0, right: 900, width: 900, x: 0, y: 100, toJSON() {} };
    if (this.tagName === 'TR') return { top: 150, bottom: 206, height: 56, left: 0, right: 900, width: 900, x: 0, y: 150, toJSON() {} };
    if (this.tagName === 'ARTICLE') return { top: 150, bottom: 430, height: 280, left: 0, right: 900, width: 900, x: 0, y: 150, toJSON() {} };
    return originalRect.call(this);
  };
  return host;
}

const rows = count => Array.from({ length: count }, (_, index) => ({
  MASTER_UNIQUE_ID: `row-${index}`, ITEMCODE: index % 3 ? 'AB-100' : 'CD-200', ASSIGNEDTO: index % 4 ? 'dylan_collyge' : '',
  DEFAULT_ASSIGNEDTO: 'dylan_collyge', WAREHOUSEI: 'A', CONTSIZE: '#1', COMMONNAME: `Plant ${index}`, LOCATIONCODE: `C.${String(index % 9).padStart(2, '0')}.001`,
  LOTCODE: `LOT-${index}`, ASSIGNMENT_REASON: index === 0 ? 'zone_zoe' : 'itemcode_default', assignment_reason: index === 0 ? 'zone_zoe' : 'itemcode_default'
}));

const baseProps = (data, overrides = {}) => ({
  rows: data, totalRows: data.length, grouped: true,
  columns: [['ASSIGNEDTO', 'Effective Worker'], ['DEFAULT_ASSIGNEDTO', 'Itemcode Default Owner'], ['ITEMCODE', 'Item Code'], ['LOCATIONCODE', 'Location Code']],
  sort: { field: 'ITEMCODE', direction: 'asc' }, columnFilters: { ITEMCODE: { active: true, label: 'All', open: false } },
  canManageAssignments: true, snapshotCurrent: true,
  options: [{ value: '', label: 'Unassigned' }, { value: 'dylan_collyge', label: 'Dylan Collyge' }, { value: 'zoe_green', label: 'Zoe Green' }],
  ownerDrafts: {}, pendingCodes: new Set(), selectedCodes: new Set(), lowStock: { targets: new Map(), drafts: new Map(), saving: new Set(), canEdit: false, fallback: 150 },
  onDefaultChange() {}, onSelect() {}, onLowStockDraft() {}, onLowStockSave() {}, onLowStockReset() {}, onColumnFilter() {}, getReason: row => row.ASSIGNMENT_REASON, onError: error => { throw error; },
  ...overrides
});

test('Assigned Items mounts once, renders a bounded desktop window, and shows an owner control per row', async () => {
  const { act } = await import('react');
  const { mountAssignedItems } = await import(pathToFileURL(path.join(tempDir, 'component.mjs')).href);
  const host = setupDom();
  const data = rows(10000), changes = [];
  await act(async () => { mounted = mountAssignedItems(host, baseProps(data, { onDefaultChange: (...args) => changes.push(args) })); });
  assert.ok(ResizeObserverMock.observed.has(document.getElementById('layout')), 'layout above the list is observed for height changes');
  assert.equal(host.dataset.logicalRowCount, '10000');
  assert.equal(host.dataset.totalRowCount, '10000');
  assert.equal(host.querySelector('[data-manager-assigned-layout="desktop"]') != null, true);
  assert.equal(host.querySelector('table')?.getAttribute('aria-rowcount'), '15001');
  const visible = host.querySelectorAll('[data-manager-assigned-item-row]');
  assert.ok(visible.length > 0 && visible.length < 25, `virtualized desktop rendered ${visible.length} rows`);
  assert.equal(host.querySelectorAll('[aria-label^="Itemcode Default Owner "]').length, visible.length);
  assert.ok(host.querySelector('[data-manager-assigned-group="unassigned"]'));
  assert.ok(host.querySelector('[aria-label^="Itemcode Default Owner "]'));
  const firstOwner = host.querySelector('[aria-label^="Itemcode Default Owner "]');
  firstOwner.value = 'zoe_green';
  await act(async () => { firstOwner.dispatchEvent(new window.Event('change', { bubbles: true })); });
  assert.deepEqual(changes[0], ['CD-200', 'zoe_green']);
  const scroll = document.getElementById('main-scroll-area');
  await act(async () => { scroll.scrollTop = 899000; scroll.dispatchEvent(new window.Event('scroll')); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.ok(host.querySelector('[data-inventory-id="row-9999"]'), 'the virtual list can render its final inventory row');
  await act(async () => { mounted.update(baseProps(data, { onDefaultChange: (...args) => changes.push(args) })); });
  assert.equal(host, document.getElementById('host'), 'updates retain the mounted host');
  await act(async () => { mounted.destroy(); });
  mounted = null;
});

test('Assigned Items switches to phone cards, exposes location override and expands exact row details', async () => {
  const { act } = await import('react');
  const { mountAssignedItems } = await import(pathToFileURL(path.join(tempDir, 'component.mjs')).href);
  const host = setupDom(390), data = rows(1000);
  await act(async () => { mounted = mountAssignedItems(host, baseProps(data)); });
  await act(async () => { window.dispatchEvent(new window.Event('resize')); });
  assert.equal(host.querySelector('[data-manager-assigned-layout="mobile"]') != null, true);
  assert.ok(host.querySelector('[data-manager-assigned-item-card]'));
  const first = host.querySelector('[data-manager-assigned-item-card]');
  assert.ok(first.querySelector('[aria-label^="Itemcode Default Owner "]'));
  assert.match(first.textContent, /Location Override: Zoe/);
  await act(async () => { first.querySelector('button[aria-expanded]').click(); });
  assert.ok(first.querySelector('dl[aria-label^="Details for "]'));
  await act(async () => { mounted.destroy(); });
  mounted = null;
});

test('owner drafts retry the retained code/value and pending or read-only sibling controls are disabled', async () => {
  const { act } = await import('react');
  const { mountAssignedItems } = await import(pathToFileURL(path.join(tempDir, 'component.mjs')).href);
  const host = setupDom(), data = rows(500), calls = [];
  await act(async () => { mounted = mountAssignedItems(host, baseProps(data, {
    ownerDrafts: { 'AB-100': { assignedto: 'zoe_green', error: 'The save failed.' } }, pendingCodes: new Set(['AB-100']),
    onDefaultChange: (...args) => calls.push(args)
  })); });
  const controls = [...host.querySelectorAll('[data-manager-assigned-item-row] [aria-label^="Itemcode Default Owner"]')].filter(element => element.dataset.itemcode === 'AB-100');
  assert.ok(controls.length > 0);
  assert.ok(controls.every(element => element.disabled), 'all itemcode siblings lock while one command is pending');
  assert.ok(host.querySelector('[data-retry-owner-save="AB-100"]')?.disabled);
  await act(async () => { mounted.update(baseProps(data, {
    ownerDrafts: { 'CD-200': { assignedto: 'zoe_green', error: 'The save failed.' } }, pendingCodes: new Set(),
    onDefaultChange: (...args) => calls.push(args)
  })); });
  const retry = host.querySelector('[data-retry-owner-save="CD-200"]');
  assert.ok(retry);
  await act(async () => { retry.click(); });
  assert.deepEqual(calls.at(-1), ['CD-200', 'zoe_green']);
  await act(async () => { mounted.update(baseProps(data, { canManageAssignments: false })); });
  const readOnly = host.querySelectorAll('[aria-label^="Itemcode Default Owner "]');
  assert.ok(readOnly.length > 0 && [...readOnly].every(element => element.disabled));
  await act(async () => { mounted.destroy(); });
  mounted = null;
});

test('virtualized row identity and text escaping survive reordered refreshes', async () => {
  const { act } = await import('react');
  const { mountAssignedItems } = await import(pathToFileURL(path.join(tempDir, 'component.mjs')).href);
  const host = setupDom(), data = rows(200);
  data[0].COMMONNAME = '<img src=x onerror=alert(1)>';
  await act(async () => { mounted = mountAssignedItems(host, baseProps(data)); });
  const row = host.querySelector('[data-inventory-id="row-1"]');
  assert.ok(row);
  await act(async () => { row.querySelector('select').focus(); });
  await act(async () => { mounted.update(baseProps([...data].reverse())); });
  assert.equal(host.querySelector('[data-inventory-id="row-1"]'), row, 'keyed records retain their focused DOM node after reordering');
  assert.equal(document.querySelector('img'), null, 'cell text is rendered without interpreting markup');
  await act(async () => { mounted.destroy(); });
  mounted = null;
});

after(async () => {
  if (mounted) mounted.destroy();
  await new Promise(resolve => setTimeout(resolve, 180));
  dom?.window.close();
  for (const name of globalNames) {
    if (previous[name]) Object.defineProperty(globalThis, name, previous[name]);
    else delete globalThis[name];
  }
  await fs.rm(tempDir, { recursive: true, force: true });
});
