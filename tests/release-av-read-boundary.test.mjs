import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { createClient } from '@supabase/supabase-js';
import { databaseContracts } from '../scripts/generate-database-contracts.mjs';

const source = fs.readFileSync(new URL('../supabase/functions/_shared/av-read.ts', import.meta.url), 'utf8');
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const builtAv = buildSync({ absWorkingDir: root, entryPoints: ['supabase/functions/_shared/av-read.ts'], bundle: true,
  platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const avModule = { exports: {} };
new Function('require', 'module', 'exports', builtAv.outputFiles[0].text)(require, avModule, avModule.exports);
const { readAvPage } = avModule.exports;
const database = databaseContracts(fs.readFileSync(new URL('../supabase/functions/_shared/database.types.ts', import.meta.url), 'utf8'));
const reserveColumns = [...source.matchAll(/const RESERVE_FULL_SELECT_FIELDS = \[([\s\S]*?)\].join/g)].flatMap(match => [...match[1].matchAll(/"([a-z0-9_]+)"/g)].map(item => item[1])).join(',');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const edge = fs.readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const observability = fs.readFileSync(new URL('../supabase/functions/_shared/observability.ts', import.meta.url), 'utf8');
const appAuth = fs.readFileSync(new URL('../supabase/functions/_shared/app-auth.ts', import.meta.url), 'utf8');
const directoryMigration = fs.readFileSync(new URL('../supabase/migrations/20261004010000_company_directory.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function fixture(overrides = {}) {
  const calls = [];
  const result = { data: [], count: 1, error: null };
  const builder = Object.fromEntries(['select', 'filter', 'or', 'eq', 'order', 'range'].map(method => [method, (...args) => { calls.push([method, ...args]); return builder; }]));
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  const context = { supabase: { from: table => { calls.push(['from', table]); return builder; } },
    actor: { username: 'riley_sales', display_name: 'Riley Sales' },
    canRead: () => true, restrictRep: false, ...overrides };
  const read = payload => {
    const request = { action: 'av_read', dataset: 'reserves', ...payload };
    const fullFields = request.dataset === 'reserves' ? reserveColumns
      : request.dataset === 'notes' ? 'unique_id,commonname,salesnote'
      : request.dataset === 'hot_prices' ? 'itemcode_key,cav_itemcode,hot_price,cav_filename,cav_last_updated'
      : 'key,value,updated_by,updated_at';
    const params = new URLSearchParams(String(request.query || ''));
    const selected = params.get('select') || fullFields;
    const fields = selected === '*' ? fullFields : selected;
    const schema = database.tables[
      request.dataset === 'reserves' ? 'ph_reserves'
        : request.dataset === 'notes' ? 'ph_av_notes'
        : request.dataset === 'hot_prices' ? 'ph_view_av_hot_price_keys' : 'ph_app_settings'
    ].row.object;
    const sample = field => {
      const value = field?.schema ?? field;
      if (value === 'string') return 'fixture';
      if (value === 'number') return 1;
      if (value === 'boolean') return true;
      if (value === 'null') return null;
      if (value === 'json') return {};
      if (value === 'never') throw new Error('No sample for never schema');
      if (value?.oneOf) return sample(value.oneOf.find(variant => variant !== 'null') ?? value.oneOf[0]);
      if (value?.array) return [];
      if (value?.object) return Object.fromEntries(Object.entries(value.object).map(([key, item]) => [key, sample(item)]));
      throw new Error(`Unsupported fixture schema: ${JSON.stringify(value)}`);
    };
    result.data = Object.hasOwn(overrides, 'data') ? overrides.data
      : [Object.fromEntries(fields.split(',').flatMap(field => schema[field] ? [[field, sample(schema[field])]] : []))];
    if (!Object.hasOwn(overrides, 'data') && schema.unique_id && result.data[0]) result.data[0].unique_id = 'one';
    return readAvPage({ ...context, payload: request });
  };
  return { calls, result, read };
}

test('AV pages use the fixed source, exact totals, stable ordering and a 500-row cap', async () => {
  const f = fixture();
  const page = await f.read({ query: 'select=*&limit=7000&offset=500' });
  assert.deepEqual(page.rows[0].unique_id, 'one');
  assert.equal(page.total, 1);
  assert.equal(page.offset, 500);
  assert.equal(page.limit, 500);
  assert.equal(page.hasMore, false);
  assert.deepEqual(f.calls, [['from', 'ph_reserves'], ['select', reserveColumns, { count: 'exact' }], ['order', 'unique_id', { ascending: true }], ['range', 500, 999]]);
});

test('AV denies unauthorized datasets, relation embedding, arbitrary operators and invalid paging', async () => {
  const denied = fixture({ canRead: () => false });
  await assert.rejects(denied.read({}), { message: 'AV_READ_FORBIDDEN' });
  assert.equal(denied.calls.length, 0);
  for (const payload of [{ dataset: 'constructor' }, { dataset: 'profiles' }, { table: 'profiles' },
    { query: 'select=*,profiles(*)' }, { query: 'or=(profiles.id.eq.foo)' }, { query: 'limit=-1' },
    { query: 'offset=1.5' }, { query: 'or=(itemcode.eq.A),salesrepname.ilike.*)' }, { query: 'rpc=evil' }]) {
    await assert.rejects(fixture().read(payload), { message: 'AV_READ_QUERY_INVALID' });
  }
});

test('AV validates successful row projections and finite JSONB values before returning data', async () => {
  await assert.rejects(fixture({ data: [{ unique_id: 12 }] }).read({ query: 'select=unique_id' }),
    { message: 'AV_READ_INVALID_PAGE' });
  await assert.rejects(fixture({ data: [{ key: 'current_season_salesyear', value: Number.NaN }] })
    .read({ dataset: 'settings', query: 'select=key,value' }), { message: 'AV_READ_INVALID_PAGE' });
});

test('rep scope is derived from the active actor and ANDed with requested filters', async () => {
  const f = fixture({ restrictRep: true });
  await f.read({ query: 'or=(and(itemcode.eq.A,season.eq.F1),itemcode.eq.B)&salesrepname=ilike.*' });
  const scopes = f.calls.filter(call => call[0] === 'or');
  assert.deepEqual(scopes, [['or', 'and(or(and(itemcode.eq.A,season.eq.F1),itemcode.eq.B),or(salesrepname.ilike.riley*sales,salesrepname.ilike.sales*riley))']]);
  await assert.rejects(fixture({ restrictRep: true, actor: { username: '' } }).read({}), { message: 'AV_READ_REP_IDENTITY_REQUIRED' });
});

test('real PostgREST builder sends one combined filter and an exact-count request', async () => {
  const requests = [];
  const supabase = createClient('https://fixture.example', 'synthetic-key', { global: { fetch: async (input, options) => {
    requests.push({ url: new URL(String(input)), prefer: new Headers(input?.headers || options?.headers).get('prefer') });
    return new Response(JSON.stringify([{ unique_id: 'one' }]), { status: 206,
      headers: { 'content-type': 'application/json', 'content-range': '0-0/1' } });
  } } });
  const f = fixture({ supabase, restrictRep: true });
  const page = await f.read({ query: 'select=unique_id&or=(itemcode.eq.A,itemcode.eq.B)&limit=500' });
  assert.equal(page.total, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.pathname, '/rest/v1/ph_reserves');
  assert.equal(requests[0].url.searchParams.get('or'), '(and(or(itemcode.eq.A,itemcode.eq.B),or(salesrepname.ilike.riley*sales,salesrepname.ilike.sales*riley)))');
  assert.equal(requests[0].url.searchParams.getAll('or').length, 1);
  assert.match(requests[0].prefer || '', /count=exact/);
});

test('the hot-price view checks its protected source and settings cannot expose other keys', async () => {
  const permissions = [];
  const f = fixture({ canRead: table => { permissions.push(table); return true; } });
  await f.read({ dataset: 'hot_prices' });
  await f.read({ dataset: 'settings', query: 'key=eq.secret' });
  assert.deepEqual(permissions, ['ph_cav_import', 'ph_app_settings']);
  assert.ok(f.calls.some(call => call[0] === 'eq' && call[1] === 'key' && call[2] === 'current_season_salesyear'));
  const failed = fixture(); failed.result.error = { message: 'denied' };
  await assert.rejects(failed.read({}), { message: 'AV_READ_UNAVAILABLE' });
});

test('only active inventory readers get the AV current-season settings dependency', async () => {
  const block = edge.slice(edge.indexOf('  if (action === "av_read") {'), edge.indexOf('  if (action === "inventory_read") return'));
  const roleHelpers = appAuth.slice(appAuth.indexOf('export function normalizeUsername'), appAuth.indexOf('function getSessionSecret()'));
  const tableConstants = edge.slice(edge.indexOf('const AV_OPTION_EVAL_REQUESTS_TABLE'), edge.indexOf('const REP_WRITE_TABLES'));
  const readGate = edge.slice(edge.indexOf('function hasTableReadAccess('), edge.indexOf('// This read boundary deliberately accepts dataset'));
  const branch = `async function invoke(session, payload) { const action = 'av_read'; const req = { headers: new Headers([['x-request-id', 'test-request']]) }; ${block} }`;
  const code = ts.transpileModule(`${roleHelpers}\n${tableConstants}\n${readGate}\n${branch}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.replace(/export\s+/g, '');
  const calls = [];
  const context = vm.createContext({ Headers, supabase: {},
    resolveActiveSessionProfile: async session => ({ username: session.username, role: session.role }),
    readAvPage: async ({ payload, canRead }) => {
      const source = { settings: 'ph_app_settings', reserves: 'ph_reserves', notes: 'ph_av_notes', hot_prices: 'ph_cav_import' }[payload.dataset];
      const permitted = canRead(source);
      calls.push({ role: payload.role, username: payload.username, dataset: payload.dataset, source, permitted });
      if (!permitted) throw Object.assign(new Error('AV_READ_FORBIDDEN'), { status: 403, stage: 'authorization' });
      return { rows: [] };
    }, jsonResponse: (body, status = 200) => ({ body, status }), errorResponse: (message, status, extra) => ({ body: { error: message, ...extra }, status }),
    recordHandledError: () => {} });
  vm.runInContext(code, context);
  const cases = [
    ['QC Supervisor', 'dan_mccuistion', true, false],
    ['QC', 'quality_user', false, false],
    ['REP', 'riley_sales', true, true],
    ['Sales Rep', 'riley_sales', true, true],
    ['salesrep', 'riley_sales', true, true],
    ['Sales', 'riley_sales', true, true],
    ['CSR', 'customer_service', true, true],
    ['Sales & Marketing', 'marketing_user', true, false],
    ['QC Supervisor', 'dylan_collyge', true, true],
    ['Manager', 'manager_user', true, true],
  ];
  for (const [role, username] of cases) {
    for (const dataset of ['settings', 'reserves']) {
      const result = await context.invoke({ role, username, mustChangePassword: false }, { dataset, role, username });
      calls.at(-1).resultStatus = result.status;
    }
  }
  assert.deepEqual(calls.map(({ role, username, dataset, permitted, resultStatus }) => [role, username, dataset, permitted, resultStatus]),
    cases.flatMap(([role, username, inventory, av]) => [
      [role, username, 'settings', inventory, inventory ? 200 : 403],
      [role, username, 'reserves', av, av ? 200 : 403],
    ]));
});

test('Company Directory SQL still restricts every table policy to Dylan active profile', () => {
  assert.match(directoryMigration, /lower\(btrim\(\(profile\)\.username\)\) = 'dylan_collyge'[\s\S]*not coalesce\(\(profile\)\.must_change_password, true\)/);
  for (const table of ['contacts', 'blocks', 'beds', 'codes']) {
    assert.ok(directoryMigration.includes(`create policy company_directory_${table}_dylan_all on public.ph_company_directory_${table}\n  for all to authenticated using ((select private.company_directory_is_dylan_v1()))\n  with check ((select private.company_directory_is_dylan_v1()));`));
  }
  assert.match(directoryMigration, /grant execute on function private\.company_directory_is_dylan_v1\(\) to authenticated/);
});

test('AV failures log bounded request, dataset, stage, HTTP status and SQLSTATE diagnostics', async () => {
  const block = edge.slice(edge.indexOf('  if (action === "av_read") {'), edge.indexOf('  if (action === "inventory_read") return'));
  const code = ts.transpileModule(`async function invoke(session, payload) { const action = 'av_read'; const req = { headers: new Headers([['x-request-id', 'diagnostic-request']]) }; ${block} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const logs = [];
  const context = vm.createContext({ Headers, FULL_ACCESS_USER_KEYS: new Set(), normalizeUsername: value => String(value).toLowerCase(),
    getRoleAccessState: () => ({ isRep: false, isRepLike: false, isAdmin: false }), hasTableReadAccess: () => true,
    supabase: {}, resolveActiveSessionProfile: async () => ({ username: 'user', role: 'Manager' }),
    readAvPage: async () => { throw Object.assign(new Error('AV_READ_FORBIDDEN'), { status: 403, code: '42501', stage: 'database' }); },
    jsonResponse: (body, status = 200) => ({ body, status }), errorResponse: (message, status, extra) => ({ body: { error: message, ...extra }, status }),
    recordHandledError: (...args) => logs.push(args) });
  vm.runInContext(code, context);
  const result = await context.invoke({ mustChangePassword: false }, { dataset: 'settings' });
  assert.equal(result.status, 403);
  assert.deepEqual(JSON.parse(JSON.stringify(logs.map(([fn, action, , status, diagnostics]) => [fn, action, status, diagnostics]))), [[
    'app-api', 'av_read', 403,
    { requestId: 'diagnostic-request', sqlState: '42501', dataset: 'settings', denialStage: 'database' },
  ]]);
  assert.equal(result.body.error, 'AV_READ_FORBIDDEN');
  assert.equal(result.body.sqlState, undefined);
});

test('AV observability adds bounded denial dimensions without logging raw errors or request data', () => {
  const js = ts.transpileModule(observability, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/export\s+/g, '');
  const logs = [];
  const context = vm.createContext({ TextEncoder, Error, crypto: { randomUUID: () => 'generated-id' },
    console: { error: value => logs.push(String(value)), info: value => logs.push(String(value)) } });
  vm.runInContext(js, context);
  const error = new Error('Bearer super-secret-token select=* rows=[customer private data]');
  context.recordHandledError('app-api', 'av_read', error, 403, {
    requestId: 'safe-request-id', sqlState: '42501', dataset: 'settings', denialStage: 'database',
  });
  const record = JSON.parse(logs[0]);
  assert.deepEqual([record.request_id, record.action, record.status, record.sqlstate, record.dataset, record.denial_stage],
    ['safe-request-id', 'av_read', 403, '42501', 'settings', 'database']);
  assert.equal(record.error_code, 'error');
  assert.doesNotMatch(logs[0], /super-secret-token|customer private data|select=\*/);
  logs.length = 0;
  context.recordHandledError('app-api', 'av_read', new Error('AV_READ_FORBIDDEN'), 403, {
    requestId: 'safe-request-id', sqlState: null, dataset: 'reserves', denialStage: 'authorization',
  });
  assert.equal(JSON.parse(logs[0]).error_code, 'av_read_forbidden');
  logs.length = 0;
  context.recordHandledError('app-api', 'other', error, 503);
  assert.equal(Object.hasOwn(JSON.parse(logs[0]), 'dataset'), false);
  assert.equal(Object.hasOwn(JSON.parse(logs[0]), 'denial_stage'), false);
});

test('AV handler rejects absent, forced-password and inactive sessions before querying data', async () => {
  const block = edge.slice(edge.indexOf('  if (action === "av_read") {'), edge.indexOf('  if (action === "inventory_read") return'));
  const code = ts.transpileModule(`async function invoke(session) { const action = 'av_read', payload = {}; ${block} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ errorResponse: (message, status) => ({ message, status }),
    resolveActiveSessionProfile: async () => { throw new Error('disabled'); }, readAvPage: () => { throw new Error('must not query'); } });
  vm.runInContext(code, context);
  assert.equal((await context.invoke(null)).status, 401);
  assert.equal((await context.invoke({ mustChangePassword: true })).status, 403);
  assert.equal((await context.invoke({})).status, 403);
});

test('AV transport rejects stale identity, incomplete pages and failed requests without a REST fallback', async () => {
  let scope = 'a', pending;
  const calls = [];
  const ctx = vm.createContext({ URLSearchParams, APP_API_FUNCTION_URL: 'app-api', SUPABASE_READ_TIMEOUT_MS: 1000,
    getSupabaseReadIdentityScope: () => scope, staleSupabaseReadScopeError: () => new Error('STALE'),
    runWithFullJitter: task => task(), postAppFunctionJson: async (url, payload, options) => { calls.push({ url, payload, options }); return pending; } });
  vm.runInContext(html.slice(html.indexOf('function getAvReadDataset('), html.indexOf('async function requestInventoryRead(')), ctx);
  pending = { ok: true, data: { rows: [{ unique_id: 'one' }], total: 1, offset: 0 } };
  assert.equal((await ctx.requestAvReadPage('ph_av_notes', 'select=*')).rows.length, 1);
  assert.equal(calls[0].payload.action, 'av_read');
  assert.match(calls[0].options.requestId, /^[a-z0-9-]+$/i, 'AV requests carry a non-sensitive diagnostic correlation ID');
  pending = { ok: true, data: { rows: [], total: 0, offset: 0 } };
  assert.equal((await ctx.requestAvReadPage('ph_av_notes', 'select=*')).rows.length, 0);
  pending = { ok: true, data: { rows: [], total: 1, offset: 0 } };
  await assert.rejects(ctx.requestAvReadPage('ph_av_notes', ''), /incomplete/);
  let finish;
  pending = new Promise(resolve => { finish = resolve; });
  const read = ctx.requestAvReadPage('ph_av_notes', ''); scope = 'b';
  finish({ ok: true, data: { rows: [], total: 0 } });
  await assert.rejects(read, /STALE/);
  ctx.postAppFunctionJson = async () => { throw new Error('offline'); };
  await assert.rejects(ctx.requestAvReadPage('ph_av_notes', ''), /offline/);
});
