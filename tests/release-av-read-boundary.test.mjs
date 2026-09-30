import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

const source = fs.readFileSync(new URL('../supabase/functions/_shared/av-read.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { readAvPage } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const edge = fs.readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');

function fixture(overrides = {}) {
  const calls = [];
  const result = { data: [{ unique_id: 'one' }], count: 1, error: null };
  const builder = Object.fromEntries(['select', 'filter', 'or', 'eq', 'order', 'range'].map(method => [method, (...args) => { calls.push([method, ...args]); return builder; }]));
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  const context = { supabase: { from: table => { calls.push(['from', table]); return builder; } },
    actor: { username: 'riley_sales', display_name: 'Riley Sales' },
    canRead: () => true, restrictRep: false, ...overrides };
  return { calls, result, read: payload => readAvPage({ ...context, payload: { action: 'av_read', dataset: 'reserves', ...payload } }) };
}

test('AV pages use the fixed source, exact totals, stable ordering and a 500-row cap', async () => {
  const f = fixture();
  const page = await f.read({ query: 'select=*&limit=7000&offset=500' });
  assert.deepEqual(page, { rows: [{ unique_id: 'one' }], total: 1, offset: 500, limit: 500, hasMore: false });
  assert.deepEqual(f.calls, [['from', 'ph_reserves'], ['select', '*', { count: 'exact' }], ['order', 'unique_id', { ascending: true }], ['range', 500, 999]]);
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
  const page = await f.read({ query: 'select=*&or=(itemcode.eq.A,itemcode.eq.B)&limit=500' });
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
    runWithFullJitter: task => task(), postAppFunctionJson: async (url, payload) => { calls.push({ url, payload }); return pending; } });
  vm.runInContext(html.slice(html.indexOf('function getAvReadDataset('), html.indexOf('async function requestInventoryRead(')), ctx);
  pending = { ok: true, data: { rows: [{ unique_id: 'one' }], total: 1, offset: 0 } };
  assert.equal((await ctx.requestAvReadPage('ph_reserves', 'select=*')).rows.length, 1);
  assert.equal(calls[0].payload.action, 'av_read');
  pending = { ok: true, data: { rows: [], total: 0, offset: 0 } };
  assert.equal((await ctx.requestAvReadPage('ph_av_notes', 'select=*')).rows.length, 0);
  pending = { ok: true, data: { rows: [], total: 1, offset: 0 } };
  await assert.rejects(ctx.requestAvReadPage('ph_reserves', ''), /incomplete/);
  let finish;
  pending = new Promise(resolve => { finish = resolve; });
  const read = ctx.requestAvReadPage('ph_reserves', ''); scope = 'b';
  finish({ ok: true, data: { rows: [], total: 0 } });
  await assert.rejects(read, /STALE/);
  ctx.postAppFunctionJson = async () => { throw new Error('offline'); };
  await assert.rejects(ctx.requestAvReadPage('ph_reserves', ''), /offline/);
});
