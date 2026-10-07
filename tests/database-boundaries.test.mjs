import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appApiDatabaseBridge, databaseBridge } from './helpers/database-bridge.mjs';
import { databaseContracts, generateContracts } from '../scripts/generate-database-contracts.mjs';
import { inspectDatabaseBoundary } from '../scripts/check-database-boundaries.mjs';

test('coverage guard rejects new untyped clients and calls outside adapters', () => {
  assert.match(inspectDatabaseBoundary('v2/src/services/new.ts', "const c = createClient(url, key);").join(' '), /generated Database/);
  assert.match(inspectDatabaseBoundary('v2/src/services/new.ts', "import {createClient as connect} from '@supabase/supabase-js'; connect(url,key);").join(' '), /generated Database/);
  assert.match(inspectDatabaseBoundary('components/new.tsx', "client.from('profiles').select('*')").join(' '), /approved compiled/);
  assert.match(inspectDatabaseBoundary('supabase/functions/new/index.ts', 'let c: SupabaseClient<any>;').join(' '), /generated Database/);
  assert.match(inspectDatabaseBoundary('supabase/functions/new/index.ts', 'type Dependencies = { supabase: any };').join(' '), /never any/);
  assert.match(inspectDatabaseBoundary('supabase/functions/new/index.ts', 'type Client = { rpc: (name: string, args: object) => Promise<unknown> };').join(' '), /fixed literals/);
  assert.deepEqual(inspectDatabaseBoundary('components/new.tsx', 'Array.from(rows); client.storage.from(bucket);'), []);
});

test('coverage guard catches REST URLs passed through renamed and injected transports', () => {
  assert.match(inspectDatabaseBoundary('supabase/functions/new/index.ts',
    "const fetcher = (url: string) => fetch(url); fetcher(`${base}/rest/v1/rpc/${name}`);").join(' '), /validated typed bridge/);
  assert.match(inspectDatabaseBoundary('supabase/functions/new/index.ts',
    "const endpoint = `${base}/rest/v1/rpc/known`; const injectedTransport = (url: string) => fetch(url); injectedTransport(endpoint, init);").join(' '), /validated typed bridge/);
  assert.deepEqual(inspectDatabaseBoundary('services/databaseRest.ts',
    "const fetcher = (url: string) => fetch(url); fetcher(`${base}/rest/v1/rpc/${name}`);"), []);
});

test('generated runtime contracts match both checked-in database schemas', () => {
  generateContracts({ check: true });
  const schema = databaseContracts(readFileSync(new URL('../supabase/functions/_shared/database.types.ts', import.meta.url), 'utf8'));
  assert.equal(schema.tables.ph_master_inventory.row.object.commonname.schema.oneOf[0], 'string');
  assert.ok(schema.functions.aura_resolve_season_v1);
  assert.ok(schema.functionReturns.aura_resolve_season_v1);
});

test('unknown tables, columns, RPCs and invalid writes fail before transport', async () => {
  const sent = [];
  const bridge = databaseBridge(async (...args) => { sent.push(args); return new Response('[]'); });
  const get = { method: 'GET' };
  await assert.rejects(bridge.fetchTable('https://fixture.invalid', 'ph_typo', 'select=*', get, 1000, 'test'), /Unknown database table/);
  await assert.rejects(bridge.fetchTable('https://fixture.invalid', 'ph_master_inventory', 'select=itemcode,missing_column', get, 1000, 'test'), /Unknown.*column/);
  await assert.rejects(bridge.fetchTable('https://fixture.invalid', 'ph_master_inventory', 'unknown_filter=eq.1', get, 1000, 'test'), /Unknown.*column/);
  await assert.rejects(bridge.fetchTable('https://fixture.invalid', 'profiles', 'id=eq.synthetic', { method: 'PATCH', body: JSON.stringify({ must_change_password: 'false' }) }, 1000, 'test'), /Invalid profiles PATCH/);
  await assert.rejects(bridge.fetchTable('https://fixture.invalid', 'profiles', '', { method: 'PATCH', body: JSON.stringify({ imaginary_flag: true }) }, 1000, 'test'), /Invalid profiles PATCH/);
  await assert.rejects(bridge.fetchRpc('https://fixture.invalid', 'rpc_typo', { method: 'POST', body: '{}' }, 1000, 'test'), /Unknown database operation/);
  await assert.rejects(bridge.fetchRpc('https://fixture.invalid', 'aura_resolve_season_v1', { method: 'POST', body: '{"wrong_actor":"id"}' }, 1000, 'test'), /Invalid.*arguments/);
  assert.equal(sent.length, 0);
});

test('validated legacy transport preserves authentication, filters, signal and response', async () => {
  const sent = []; const response = new Response('[]', { headers: { 'content-range': '0-0/1' } });
  const bridge = databaseBridge(async (...args) => { sent.push(args); return response; });
  const controller = new AbortController();
  const init = { method: 'GET', headers: { Authorization: 'Bearer fixture', Prefer: 'count=exact' }, signal: controller.signal };
  const actual = await bridge.fetchTable('https://fixture.invalid', 'ph_master_inventory', 'select=itemcode,commonname&itemcode=eq.000012&locationcode=eq.C.06.001&limit=25&offset=50', init, 3500, 'inventory');
  assert.equal(actual, response);
  assert.equal(sent[0][1], init);
  assert.equal(sent[0][2], 3500);
  const query = new URL(sent[0][0]).searchParams;
  assert.equal(query.get('itemcode'), 'eq.000012');
  assert.equal(query.get('locationcode'), 'eq.C.06.001');
  assert.equal(query.get('offset'), '50');
});

test('zero-argument operations and PostgreSQL nullable arguments remain valid', async () => {
  const sent = [];
  const bridge = databaseBridge(async (...args) => { sent.push(args); return new Response('{}'); });
  await bridge.fetchRpc('https://fixture.invalid', 'get_request_capabilities', { method: 'POST', body: '{}' }, 1000, 'capabilities');
  const body = JSON.stringify({ p_action: 'state', p_payload: {}, p_request_id: null });
  await bridge.fetchRpc('https://fixture.invalid', 'bloomscapes_pending_command', { method: 'POST', body }, 1000, 'pending');
  assert.equal(sent.length, 2);
  assert.equal(sent[1][1].body, body);
});

test('HL PO PDF finalization accepts only the RPC-supported nullable page argument', async () => {
  const sent = [];
  const bridge = databaseBridge(async (...args) => { sent.push(args); return new Response('{"status":"pending"}'); });
  const args = { p_run_id: 'synthetic-run', p_metadata: {}, p_page: null, p_rows: [], p_complete: true };
  await bridge.fetchRpc('https://fixture.invalid', 'hl_po_pdf_stage', { method: 'POST', body: JSON.stringify(args) }, 1000, 'PDF finalize');
  assert.equal(sent.length, 1);
  assert.deepEqual(JSON.parse(sent[0][1].body), args);
  await assert.rejects(bridge.fetchRpc('https://fixture.invalid', 'hl_po_pdf_stage', {
    method: 'POST', body: JSON.stringify({ ...args, p_page: 'null' }),
  }, 1000, 'invalid PDF page'), /Invalid.*arguments/);
  assert.equal(sent.length, 1, 'invalid page values are rejected before transport');
});

test('successful JSON table responses validate projected aliases, JSON paths, and body shape', async () => {
  const validResponse = new Response(JSON.stringify([{ uid: '000012', template: 'modern' }]), {
    status: 206,
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-range': '0-0/1' },
  });
  const bridge = databaseBridge(async () => validResponse);
  const result = await bridge.fetchTable('https://fixture.invalid', 'marketing_materials',
    'select=uid:unique_id,design_json->>template&limit=1', { method: 'GET' }, 1000, 'projection');
  assert.equal(result, validResponse, 'validation preserves the original response, status, and headers');
  assert.equal(result.status, 206);
  assert.equal(result.headers.get('content-range'), '0-0/1');
  assert.deepEqual(await result.json(), [{ uid: '000012', template: 'modern' }], 'validation leaves the response body readable');

  const invalidTable = databaseBridge(async () => new Response(JSON.stringify([{ uid: 12, template: 'modern' }]), {
    headers: { 'content-type': 'application/json' },
  }));
  await assert.rejects(invalidTable.fetchTable('https://fixture.invalid', 'marketing_materials',
    'select=uid:unique_id,design_json->>template', { method: 'GET' }, 1000, 'invalid projection'), /Invalid.*response/);

  const malformedJson = databaseBridge(async () => new Response('{broken', {
    headers: { 'content-type': 'application/json' },
  }));
  await assert.rejects(malformedJson.fetchTable('https://fixture.invalid', 'marketing_materials',
    'select=unique_id', { method: 'GET' }, 1000, 'malformed JSON'), /successful response was not valid JSON/);

  const invalidUnmarked = databaseBridge(async () => new Response('[{"unique_id":12}]', {
    headers: { 'content-type': 'text/plain' },
  }));
  await assert.rejects(invalidUnmarked.fetchTable('https://fixture.invalid', 'marketing_materials',
    'select=unique_id', { method: 'GET' }, 1000, 'unmarked invalid data'), /Invalid.*response/);
});

test('RPC JSON returns are checked, nullable SQL results pass, and error or empty responses are preserved', async () => {
  const bridge = databaseBridge(async (_url, init) => {
    if (init.headers?.mode === 'error') return new Response('{"unexpected":true}', {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
    if (init.headers?.mode === 'null') return new Response('null', { headers: { 'content-type': 'application/json' } });
    if (init.headers?.mode === 'invalid') return new Response('{"unexpected":true}', { headers: { 'content-type': 'application/json' } });
    return new Response('"Peony"', { status: 201, headers: { 'content-type': 'application/json' } });
  });
  const good = await bridge.fetchRpc('https://fixture.invalid', 'aura_inventory_v2_name_v1', {
    method: 'POST', body: '{"p_value":"Peony"}', headers: { mode: 'good' },
  }, 1000, 'valid RPC');
  assert.equal(good.status, 201);
  assert.equal(await good.json(), 'Peony');

  const nullable = await bridge.fetchRpc('https://fixture.invalid', 'aura_inventory_v2_name_v1', {
    method: 'POST', body: '{"p_value":"unknown"}', headers: { mode: 'null' },
  }, 1000, 'nullable RPC');
  assert.equal(await nullable.json(), null);
  await assert.rejects(bridge.fetchRpc('https://fixture.invalid', 'aura_inventory_v2_name_v1', {
    method: 'POST', body: '{"p_value":"Peony"}', headers: { mode: 'invalid' },
  }, 1000, 'invalid RPC'), /Invalid.*response/);

  const error = await bridge.fetchRpc('https://fixture.invalid', 'aura_inventory_v2_name_v1', {
    method: 'POST', body: '{"p_value":"Peony"}', headers: { mode: 'error' },
  }, 1000, 'error passthrough');
  assert.equal(error.status, 403);
  assert.deepEqual(await error.json(), { unexpected: true }, 'non-2xx error bodies are not mistaken for success data');

  const emptyBridge = databaseBridge(async () => new Response(null, { status: 204 }));
  const empty = await emptyBridge.fetchTable('https://fixture.invalid', 'marketing_materials',
    'select=*', { method: 'HEAD' }, 1000, 'empty response');
  assert.equal(empty.status, 204);
});

test('existing inventory/request views remain readable and cannot be written through the bridge', async () => {
  const sent = [];
  const bridge = databaseBridge(async (...args) => { sent.push(args); return new Response('[]'); });
  await bridge.fetchTable('https://fixture.invalid', 'ph_active_request_live_rows', 'select=*&limit=1', { method: 'GET' }, 1000, 'request scope');
  await assert.rejects(bridge.fetchTable('https://fixture.invalid', 'ph_active_request_live_rows', '', { method: 'DELETE' }, 1000, 'request scope'), /read-only/);
  assert.equal(sent.length, 1);
});

test('only the app-api bridge accepts schema-derived v2 compatibility table aliases', async () => {
  const sent = [];
  const browserBridge = databaseBridge(async (...args) => { sent.push(args); return new Response('[]'); });
  const appApiBridge = appApiDatabaseBridge(async (...args) => { sent.push(args); return new Response('[]'); });
  await assert.rejects(browserBridge.fetchTable('https://fixture.invalid', 'v2_app_users', 'select=username', { method: 'GET' }, 1000, 'strict browser'), /Unknown database table/);
  await appApiBridge.fetchTable('https://fixture.invalid', 'v2_app_users', 'select=username&limit=1', { method: 'GET' }, 1000, 'legacy app-api');
  assert.equal(new URL(sent[0][0]).pathname, '/rest/v1/v2_app_users');
  await assert.rejects(appApiBridge.fetchTable('https://fixture.invalid', 'v2_unknown', 'select=*', { method: 'GET' }, 1000, 'unknown alias'), /Unknown database table/);
  await assert.rejects(appApiBridge.fetchTable('https://fixture.invalid', 'v2_app_users', 'select=missing_column', { method: 'GET' }, 1000, 'invalid alias field'), /Unknown.*column/);
  assert.equal(sent.length, 1, 'invalid aliases and fields are rejected before transport');
});

test('app-api reads Suspend Tag overlay rows from the RPC object envelope', () => {
  const source = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
  assert.match(source, /suspendTagRowsFromResult\(state\)/);
  assert.doesNotMatch(source, /Array\.isArray\(state\)\s*\?\s*state\s*:\s*\[\]/);
});

test('legacy shell routes database reads/writes through the checked adapter', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /(?:fetchWithTimeout|fetch)\s*\([^\n]*\/rest\/v1\//);
  assert.doesNotMatch(html, /client\.from\(['"]profiles/);
  assert.match(html, /GncDatabase\.readProfile\(client, session\.user\.id\)/);
  assert.match(html, /GncDatabase\.fetchTable/);
});
