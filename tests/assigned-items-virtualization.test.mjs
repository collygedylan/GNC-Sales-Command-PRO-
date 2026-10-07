import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extract(name) {
  const start = html.search(new RegExp(`        (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const next = html.slice(start + 1).search(/\r?\n        (?:async )?function \w+\(/);
  return html.slice(start, start + 1 + next);
}

test('virtualized source shell never serializes all inventory rows', () => {
  const ctx = vm.createContext({});
  vm.runInContext(extract('renderManagerAssignedItemsPreviewTable'), ctx);
  for (const size of [0, 1, 10000, 25000]) {
    const markup = ctx.renderManagerAssignedItemsPreviewTable(Array.from({length:size}), size);
    assert.ok(markup.length < 500);
    assert.match(markup, new RegExp(`data-logical-row-count="${size}"`));
    assert.doesNotMatch(markup, /<select|<tr|<article/);
  }
});

test('snapshot memoization skips normalization and sorting until authoritative data changes', () => {
  let normalizations = 0, signature = '1';
  const state = { filters:{}, labels:new Map() };
  const low = { revision:0 };
  const ctx = vm.createContext({
    warehouseAssignedItemsInventory: Array.from({length:25000}, (_,i) => ({UNIQUE_ID:`row-${i}`, ITEMCODE:`ITEM-${i}`, ASSIGNEDTO:'zoe_green', COMMONNAME:`Item ${i}`})),
    getManagerAssignedColumnState: () => state,
    getManagerItemLowStockTargetsState: () => low,
    getDatasetLoadSignature: () => signature,
    normalizeWarehouseAssignedItemRow: row => { normalizations++; return row; },
    normalizeEvalAssignableUser: value => String(value || '').trim().toLowerCase(),
    getManagerItemLowStockTarget: () => null,
    managerEvalReportSettings: {lowStockMaxSLts:150},
  });
  vm.runInContext(extract('getManagerAssignedItemsDisplayRows'), ctx);
  const first = ctx.getManagerAssignedItemsDisplayRows();
  for (let i=0;i<10;i++) assert.equal(ctx.getManagerAssignedItemsDisplayRows(), first);
  assert.equal(normalizations,25000);
  signature = '2';
  const second = ctx.getManagerAssignedItemsDisplayRows();
  assert.equal(normalizations,50000);
  assert.equal(second[0], first[0], 'unchanged records retain their memoized object identity');
  ctx.warehouseAssignedItemsInventory[0].ASSIGNEDTO = 'mitch_kaiser';
  state.dataEpoch = 1;
  const third = ctx.getManagerAssignedItemsDisplayRows();
  assert.equal(third.find(row => row.UNIQUE_ID === 'row-0').ASSIGNEDTO,'mitch_kaiser');
  assert.equal(first.find(row => row.UNIQUE_ID === 'row-0').ASSIGNEDTO,'zoe_green');
  low.revision++;
  assert.notEqual(ctx.getManagerAssignedItemsDisplayRows(),third);
});

test('toolbar refresh retains the connected list root and native input focus', () => {
  const dom = new JSDOM('<div id="panel"><div data-manager-assigned-chrome>Old toolbar</div><div id="manager-assigned-items-root"><input value="draft"></div></div>');
  const {document} = dom.window;
  let allowed = true, disposed = 0;
  const ctx = vm.createContext({document, canViewAssignedItemsExport: () => allowed,
    destroyManagerAssignedItemsView: () => { disposed++; }});
  vm.runInContext(extract('patchManagerAssignedItemsShell'),ctx);
  const panel = document.getElementById('panel'), root = document.getElementById('manager-assigned-items-root');
  const input = root.querySelector('input'); input.focus(); input.setSelectionRange(1,3);
  assert.equal(ctx.patchManagerAssignedItemsShell(panel,'<div><div data-manager-assigned-chrome>New toolbar</div><div id="manager-assigned-items-root"></div></div>'),true);
  assert.equal(document.getElementById('manager-assigned-items-root'),root);
  assert.equal(document.activeElement,input);
  assert.equal(input.value,'draft');
  assert.equal(input.selectionStart,1);
  assert.equal(panel.querySelector('[data-manager-assigned-chrome]').textContent,'New toolbar');
  assert.equal(ctx.patchManagerAssignedItemsShell(panel,'<p>Loading refreshed assignments...</p>'),true);
  assert.equal(document.activeElement,input);
  const clear = document.createElement('button');
  clear.className = 'assigned-filter-clear';
  panel.querySelector('[data-manager-assigned-chrome]').append(clear);
  clear.focus();
  assert.equal(ctx.patchManagerAssignedItemsShell(panel,'<div data-manager-assigned-chrome>Filters cleared</div>'),true);
  assert.equal(panel.querySelector('.assigned-filter-clear'),null,'action buttons must not postpone toolbar state updates');
  assert.equal(document.getElementById('manager-assigned-items-root'),root);
  allowed = false;
  assert.equal(ctx.patchManagerAssignedItemsShell(panel,'<p>Access restricted</p>'),false);
  assert.equal(disposed,1,'permission loss must dispose the view and replace its toolbar');
  dom.window.close();
});

test('destroy invalidates pending imports and unmounts the active component', () => {
  let destroyed=0;
  const state={viewTicket:2,view:{destroy(){destroyed++;}},viewHost:{}};
  const ctx=vm.createContext({managerAssignedColumnState:state});
  vm.runInContext(extract('destroyManagerAssignedItemsView'),ctx);
  ctx.destroyManagerAssignedItemsView(); ctx.destroyManagerAssignedItemsView();
  assert.equal(destroyed,1); assert.equal(state.viewTicket,4);
  assert.equal(state.viewHost,null);
  assert.equal(state.view,null);
});

test('module delivery uses a document-relative versioned URL and preserves cloud release assets', () => {
  assert.match(extract('mountManagerAssignedItemsView'), /new URL\(`\.\/assets\/assigned-items-table\.js\?v=.*document\.baseURI/);
  assert.match(extract('mountManagerAssignedItemsView'), /state !== getManagerAssignedColumnState\(\)/);
  assert.match(extract('mountManagerAssignedItemsView'), /Retry Assigned Items/);
  const build=readFileSync(new URL('../scripts/build-live-shell.mjs',import.meta.url),'utf8');
  assert.match(build, /'assigned-items-table\.js', 'assigned-items\.css'/);
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.match(pkg.scripts['build:live:assets'],/build:live:assigned-items/);
});
