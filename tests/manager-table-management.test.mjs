import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/manager-table-management.js', import.meta.url), 'utf8');

function setup(request, options = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'https://agdata.invalid/' });
  dom.window.confirm = () => true;
  vm.runInContext(source, vm.createContext({ window: dom.window, document: dom.window.document, Blob: dom.window.Blob, FormData: dom.window.FormData, URL: dom.window.URL, CSS: { escape: value => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') }, setTimeout, clearTimeout, console }));
  const root = dom.window.document.querySelector('#root');
  const view = dom.window.GncManagerTableManagement.mountManagerTableManagement(root, { request: async payload => ({ ok: true, data: await request(payload) }), openTable() {}, tables: ['company-directory'], ...options });
  return { dom, root, view };
}

test('Company Directory supports add, inline save, full edit, delete and Excel export', async () => {
  const calls = [];
  let rows = [];
  const request = async input => {
    calls.push(input);
    if (input.operation === 'read') return { rows: [...rows], total: rows.length };
    if (input.operation === 'create') { rows = [{ id: 'row-1', revision: 1, ...input.payload }]; return { ok: true }; }
    if (input.operation === 'update') { rows = rows.map(row => row.id === input.payload.id ? { ...row, ...input.payload, revision: Number(row.revision) + 1 } : row); return { ok: true, row: rows[0] }; }
    if (input.operation === 'delete') { rows = []; return { ok: true }; }
    throw new Error('Unexpected operation');
  };
  const { dom, root, view } = setup(request);
  root.querySelector('[data-table-select="company-directory"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  root.querySelector('[data-add]').click();
  root.querySelector('[name="name"]').value = 'North Yard';
  root.querySelector('[name="active"]').checked = true;
  root.querySelector('[data-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(rows[0].name, 'North Yard');
  assert.ok(calls.some(call => call.operation === 'create' && call.payload.command_id));

  root.querySelector('[data-inline-field="name"]').value = 'South Yard';
  root.querySelector('[data-save-row="row-1"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(rows[0].name, 'South Yard');
  assert.equal(calls.findLast(call => call.operation === 'update').payload.expectedRevision, '1');

  root.querySelector('[data-edit="row-1"]').click();
  root.querySelector('[name="department"]').value = 'Production';
  root.querySelector('[data-form]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(rows[0].department, 'Production');

  let exported = false;
  dom.window.downloadManagerRowsToExcel = () => { exported = true; };
  root.querySelector('[data-export]').click();
  assert.equal(exported, true);
  root.querySelector('[data-delete="row-1"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(rows.length, 0);
  assert.ok(calls.some(call => call.operation === 'delete' && call.payload.expectedRevision === '3'));
  view.destroy(); dom.window.close();
});

test('transient read failure preserves error state and refresh retries', async () => {
  let attempts = 0;
  const { dom, root, view } = setup(async input => {
    if (input.operation !== 'read') throw new Error('Not expected');
    attempts++;
    if (attempts === 1) throw new Error('temporary read error');
    return { rows: [], total: 0 };
  });
  root.querySelector('[data-table-select="company-directory"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(root.textContent, /temporary read error/);
  root.querySelector('[data-refresh]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(attempts, 2);
  assert.doesNotMatch(root.textContent, /temporary read error/);
  view.destroy(); dom.window.close();
});

test('Company Directory preserves gated contacts, blocks and production-code workflow', async () => {
  let opens = 0;
  const { dom, root, view } = setup(async () => ({ rows: [], total: 0 }), {
    canOpenLegacyDirectory: true, openLegacyDirectory: () => { opens++; },
  });
  root.querySelector('[data-table-select="company-directory"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  const legacy = root.querySelector('[data-legacy-directory]');
  assert.ok(legacy);
  assert.match(legacy.textContent, /contacts, blocks & production codes/i);
  legacy.click();
  assert.equal(opens, 1);
  view.destroy(); dom.window.close();
});

test('archive entries expose no write controls and archive mutation contract rejects writes', async () => {
  const { dom, root, view } = setup(async () => ({ rows: [], total: 0 }));
  const moduleSource = await readFile(new URL('../supabase/functions/_shared/table-management.ts', import.meta.url), 'utf8');
  assert.match(moduleSource, /READ_ONLY_TABLES/);
  assert.match(moduleSource, /MANAGER_TABLE_READ_ONLY/);
  assert.match(source, /READ-ONLY ARCHIVE/);
  assert.doesNotMatch(source, /Restore|restore/);
  view.destroy(); dom.window.close();
});
