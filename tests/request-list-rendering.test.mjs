// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function source(name) {
  const start = html.search(new RegExp(`        function ${name}\\(`));
  assert.ok(start >= 0, `${name} exists`);
  const next = html.slice(start + 1).search(/\r?\n        (?:async )?function \w+\(/);
  assert.ok(next > 0, `${name} boundary`);
  return html.slice(start, start + next + 1);
}

function fixture() {
  const signatures = [];
  const pageKeys = [];
  const ctx = vm.createContext({
    signatures, pageKeys, pageIndex: 0,
    isRequestPendingVisible: () => true,
    isRegularRequestQueueItem: () => true,
    compareRequestLocationCodes: (a, b) => String(a).localeCompare(String(b)),
    getItemUniqueId: row => row.UNIQUE_ID,
    buildRequestChunkRenderKey: (mode, crumb, rows) => {
      signatures.push(rows.length);
      return JSON.stringify([mode, crumb, rows.map(row => [row.UNIQUE_ID, row.label])]);
    },
    getClientBrowsePage: (_view, key, rows) => {
      pageKeys.push(key);
      const pageIndex = Math.min(ctx.pageIndex, Math.max(0, Math.ceil(rows.length / 100) - 1));
      return { key, pageIndex, rows: rows.slice(pageIndex * 100, (pageIndex + 1) * 100) };
    },
    renderClientBrowsePageFooter: (_view, _key, total, page) => `${page.pageIndex}:${total}`
  });
  for (const name of ['buildRequestBrowseMembershipKey', 'buildRequestPagedRenderPlan']) {
    if (html.includes(`function ${name}(`)) vm.runInContext(source(name), ctx);
  }
  vm.runInContext(source('buildPendingRequestRenderPlan'), ctx);
  return ctx;
}

const rows = (count) => Array.from({ length: count }, (_, i) => ({ UNIQUE_ID: `request-${i}`, LOCATIONCODE: String(i).padStart(5, '0'), label: `Row ${i}` }));

test('reused Suspend collators preserve dock, stop, location, and Unicode name ordering', () => {
  const ctx = vm.createContext({
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') || '',
    getRequestSuspendTagDockFilterOptionForItem: row => ({ value: row.dock, label: row.dock })
  });
  for (const name of ['compareRequestSuspendTagDockOptions', 'compareLocationCodeValues', 'compareRequestSuspendTagRows']) {
    vm.runInContext(source(name), ctx);
  }
  const collators = { text: new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare,
    location: new Intl.Collator(undefined, { numeric: true }).compare };
  const data = Array.from({ length: 120 }, (_, id) => ({
    id, dock: ['Dock 2', 'Dock 10', 'no-dock'][id % 3], STOPNUMBER: ['', '2', '10'][id % 3],
    LOCATIONCODE: ['A.2', 'A.10', 'B.2.1', 'A.2.1', 'A-2'][id % 5],
    COMMONNAME: ['Érable 2', 'érable 10', 'Oak 3', 'Oak 12'][id % 4]
  }));
  const original = data.slice().sort((a, b) => ctx.compareRequestSuspendTagRows(a, b));
  const optimized = data.slice().sort((a, b) => ctx.compareRequestSuspendTagRows(a, b, collators));
  assert.deepEqual(optimized.map(row => row.id), original.map(row => row.id));
});

test('Pending computes rich card signatures for only its 100-row page at production scale', () => {
  const ctx = fixture();
  const plan = ctx.buildPendingRequestRenderPlan(rows(9539));
  assert.equal(plan.items.length, 9539);
  assert.equal(plan.rows.length, 100);
  assert.deepEqual(ctx.signatures, [100]);
  assert.equal(plan.footerMarkup, '0:9539');
});

test('visible content changes invalidate the render while keeping the current page', () => {
  const ctx = fixture(); ctx.pageIndex = 2;
  const data = rows(350);
  const first = ctx.buildPendingRequestRenderPlan(data);
  data[201].label = 'Updated photo and quantity';
  const second = ctx.buildPendingRequestRenderPlan(data);
  assert.equal(second.pageIndex, 2);
  assert.equal(ctx.pageKeys[0], ctx.pageKeys[1]);
  assert.notEqual(first.renderSignature, second.renderSignature);
  assert.equal(second.rows[1], data[201]);
  data[0].label = 'Off-page update';
  assert.equal(ctx.buildPendingRequestRenderPlan(data).renderSignature, second.renderSignature);
});

test('membership keys track order and filters without delimiter collisions', () => {
  const ctx = fixture();
  const data = rows(2);
  const key = ctx.buildRequestBrowseMembershipKey('pending', data);
  assert.notEqual(ctx.buildRequestBrowseMembershipKey('suspend-tag', data), key);
  assert.notEqual(ctx.buildRequestBrowseMembershipKey('pending', [...data].reverse()), key);
  assert.notEqual(ctx.buildRequestBrowseMembershipKey('pending', [{ UNIQUE_ID: 'a|b' }, { UNIQUE_ID: 'c' }]),
    ctx.buildRequestBrowseMembershipKey('pending', [{ UNIQUE_ID: 'a' }, { UNIQUE_ID: 'b|c' }]));
});

test('Suspend keeps all filter totals while bounding cards and plan-start signatures to its page', () => {
  const ctx = fixture();
  const planstartReads = [];
  Object.assign(ctx, {
    requestSuspendTagCommonNameSearchTerm: '', requestSuspendTagAssignedToFilter: 'all',
    requestSuspendTagContSizeFilter: 'all', requestSuspendTagDockFilter: 'all',
    getSuspendTagRequestItems: values => values.slice(),
    compareRequestSuspendTagRows: (a, b) => a.LOCATIONCODE.localeCompare(b.LOCATIONCODE),
    applyRequestSuspendTagCommonNameSearchFilter: values => values,
    applyRequestSuspendTagAssignedToFilter: values => values,
    applyRequestSuspendTagContSizeFilter: values => values,
    applyRequestSuspendTagDockFilter: values => values,
    normalizeSearchValue: value => value,
    normalizeRequestSuspendTagAssignedToFilterValue: value => value,
    normalizeRequestSuspendTagContSizeFilterValue: value => value,
    getDockSuspendDcRequestPlanstartInfo: row => { planstartReads.push(row.UNIQUE_ID); return { value: row.date || '', tone: 'monday', valid: true }; }
  });
  vm.runInContext(source('buildSuspendTagRenderPlan'), ctx);
  const data = rows(9539);
  const first = ctx.buildSuspendTagRenderPlan(data);
  assert.equal(first.allItems.length, 9539);
  assert.equal(first.items.length, 9539);
  assert.equal(first.rows.length, 100);
  assert.equal(first.footerMarkup, '0:9539');
  assert.deepEqual(ctx.signatures, [100]);
  assert.equal(planstartReads.length, 100);
  data[0].date = '2026-10-19';
  assert.notEqual(ctx.buildSuspendTagRenderPlan(data).renderSignature, first.renderSignature);
  ctx.pageIndex = 95;
  assert.equal(ctx.buildSuspendTagRenderPlan(data).rows.length, 39);
});
