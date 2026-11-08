import test from 'node:test';
import assert from 'node:assert/strict';
import { installReleaseSmokeDirectOperationalRoute, primeReleaseSmokeCapturedSnapshot,
  primeReleaseSmokeDirectOperationalRows } from './helpers/release-smoke-direct-reads.mjs';
import { RELEASE_SMOKE_SUPABASE_ORIGIN } from './helpers/release-smoke-route-policy.mjs';

const apiUrl = `${RELEASE_SMOKE_SUPABASE_ORIGIN}/functions/v1/app-api`;
const syntheticHeaders = { authorization: 'Bearer browser-only-no-real-session' };

async function fixturePage({ primeCaptured = false } = {}) {
  const handlers = [];
  const page = { route: async (...args) => handlers.push(args[1]), evaluate: async () => null };
  installReleaseSmokeDirectOperationalRoute(page);
  if (primeCaptured) assert.equal(primeReleaseSmokeCapturedSnapshot(page), true);
  await page.route('**/*', () => {});
  const handler = handlers.at(-1);
  const read = async (body, options = {}) => {
    let result = null;
    const request = { method: () => options.method || 'POST', url: () => options.url || apiUrl,
      headers: () => options.headers || syntheticHeaders, postDataJSON: () => body };
    await handler({ request: () => request, fallback: async () => {},
      fulfill: async response => { result = { ...response, json: JSON.parse(response.body) }; } });
    return result;
  };
  return { page, read };
}

test('captured snapshot primes the complete cold master path and exact lookup', async () => {
  const { read } = await fixturePage({ primeCaptured: true });
  const ids = new Set();
  let total;
  for (let offset = 0; offset < 9500; offset += 500) {
    const result = await read({ action: 'inventory_read', operation: 'master_page',
      params: { dataset: 'master', projection: 'browse', offset, limit: 500 } });
    const data = result.json.data;
    total = data.total;
    assert.equal(data.hasMore, offset + data.rows.length < total);
    for (const row of data.rows) ids.add(row.unique_id);
  }
  assert.equal(total, 9487);
  assert.equal(ids.size, 9487);
  const uniqueId = ids.values().next().value;
  const lookup = await read({ action: 'inventory_read', operation: 'master_page',
    params: { dataset: 'lookup', projection: 'full', offset: 0, limit: 1, uniqueId } });
  assert.equal(lookup.json.data.rows[0].unique_id, uniqueId);
  assert.equal(lookup.json.data.fieldCoverage, 'full');
});

test('exact synthetic project, watchdog and latest suspend reads return fixture data', async () => {
  const { read } = await fixturePage({ primeCaptured: true });
  assert.deepEqual((await read({ action: 'projects_read' })).json, { ok: true, data: { projects: [], rows: [] } });
  assert.deepEqual((await read({ action: 'watchdog_list_events' })).json,
    { ok: true, data: [], fixBrief: '', hasMore: false });
  const params = { projection: 'default', offset: 0, limit: 500, filters: [],
    order: [{ field: 'unique_id', ascending: true }] };
  const result = await read({ action: 'dataset_read', dataset: 'suspend_tag', params });
  assert.equal(result.json.data.total, 37);
  assert.equal(result.json.data.rows.length, 37);
  assert.ok(result.json.data.sourceFreshness.filename);
  assert.equal(await read({ action: 'dataset_read', dataset: 'suspend_tag', params: { ...params, extra: true } }), null);
});

test('direct master lookup accepts only the exact single-row production shape', async () => {
  const { read } = await fixturePage({ primeCaptured: true });
  const uniqueId = '010539_030_1-_3-F_16_000-27_F1-LD----1';
  const query = new URLSearchParams({ select: 'unique_id,itemcode,locationcode,lotcode', order: 'unique_id.asc',
    limit: '1', offset: '0', unique_id: `eq.${uniqueId}` });
  const url = `${RELEASE_SMOKE_SUPABASE_ORIGIN}/rest/v1/ph_master_inventory?${query}`;
  const result = await read(null, { method: 'GET', url });
  assert.equal(result.json.length, 1);
  assert.equal(result.json[0].unique_id, uniqueId);
  assert.equal(await read(null, { method: 'GET', url: url.replace('limit=1', 'limit=2') }), null);
  assert.equal(await read(null, { method: 'GET', url: `${url}&extra=true` }), null);
});

test('supplemental routes reject changed methods, credentials, origins and payloads', async () => {
  const { page, read } = await fixturePage();
  primeReleaseSmokeDirectOperationalRows(page, [{ UNIQUE_ID: 'one' }]);
  const body = { action: 'inventory_read', operation: 'master_page',
    params: { dataset: 'master', projection: 'full', offset: 0, limit: 500 } };
  for (const candidate of [
    { ...body, extra: true }, { ...body, operation: 'master_write' },
    { ...body, params: { ...body.params, offset: -1 } },
    { ...body, params: { ...body.params, limit: 501 } },
    { ...body, params: { ...body.params, season: 'F1' } },
    { action: 'projects_read', extra: true }, { action: 'watchdog_resolve_events' },
  ]) assert.equal(await read(candidate), null);
  for (const options of [
    { method: 'GET' }, { headers: { authorization: 'Bearer real-session' } },
    { headers: { ...syntheticHeaders, 'idempotency-key': 'mutation' } },
    { url: apiUrl.replace('https://', 'https://foreign.') }, { url: `${apiUrl}?extra=true` },
  ]) assert.equal(await read(body, options), null);
  assert.equal((await read(body)).json.data.rows[0].unique_id, 'one');
});

test('PO reads use the exact production projection and reject extra query parameters', async () => {
  const { read } = await fixturePage();
  const select = 'id,run_id,row_index,itemcode,commonname,contsize,locationcode,priority,lotcode,holdstopcode,holdstopreason,total_quantity_ordered,ptronhand,total_ptronhand,lot_pend_rec,salesrepid,salesrepname,customername,consigneename,consigneestate,stopnumber,quantityordered,requestdate,stagename,step,dock,po_remain,built_at';
  const query = new URLSearchParams({ select, order: 'row_index.asc', limit: '1000', offset: '0' });
  const url = `${RELEASE_SMOKE_SUPABASE_ORIGIN}/rest/v1/ph_view_po_27f1_hl?${query}`;
  assert.deepEqual((await read(null, { method: 'GET', url })).json, []);
  assert.equal(await read(null, { method: 'GET', url: `${url}&extra=true` }), null);
  assert.equal(await read(null, { method: 'DELETE', url }), null);
  assert.equal(await read(null, { method: 'GET', url, headers: {} }), null);
});

test('default owner reads accept only the paged production projection', async () => {
  const { read } = await fixturePage();
  const query = new URLSearchParams({ select: '*', order: 'itemcode_normalized.asc', limit: '1000', offset: '0' });
  const url = `${RELEASE_SMOKE_SUPABASE_ORIGIN}/rest/v1/ph_itemcode_default_owners?${query}`;
  assert.deepEqual((await read(null, { method: 'GET', url })).json, []);
  assert.equal(await read(null, { method: 'GET', url: `${url}&extra=true` }), null);
  assert.equal(await read(null, { method: 'POST', url }), null);
});
