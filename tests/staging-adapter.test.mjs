import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { File } from 'node:buffer';
import { parse } from 'acorn';
import { createStagingAdapter } from '../scripts/staging/adapter.mjs';
import { buildStagingSite, namespaceStorageReferences, transformRuntime } from '../scripts/staging/build.mjs';

const config = {
  sandboxUrl: 'https://apztnscvagayslumnalr.supabase.co',
  publishableKey: 'sb_publishable_uhcu2MjWHDRJ2voNu9ps4A_vesiNZNO',
  appOrigin: 'https://collygedylan.github.io',
  basePath: '/gnc-teardown-staging/staging/',
};
const profile = { id: 'profile-1', username: 'dylan_collyge', display_name: 'Dylan — Staging', role: 'Admin', division: 'PH', active: true };
const inventory = [{ id: 'staging-inventory-001', unique_id: 'staging-inventory-001', itemcode: 'STAGING-001', locationcode: 'E.99.001', lotcode: '27.F1', commonname: 'GNC Staging Red Maple', _staging_revision: 1 }];
const requests = [{ id: 'staging-request-001', unique_id: 'staging-request-001', itemcode: 'STAGING-001', commonname: 'GNC Staging Red Maple', _staging_revision: 1 }];

function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }

test('storage adapter prefixes reads, writes, enumeration, clears, indexedDB and CacheStorage', () => {
  const transformed = namespaceStorageReferences(`
    localStorage.setItem(key, value); localStorage.getItem(key); localStorage.removeItem(key);
    for (let i=0;i<localStorage.length;i++) localStorage.key(i); localStorage.clear();
    indexedDB.open(DB_NAME, 2); indexedDB.deleteDatabase(DB_NAME);
    caches.open('app-v1'); caches.delete('app-v1'); caches.keys(); root.caches.delete(key);
  `);
  assert.match(transformed, /gnc_teardown_staging_v1:/);
  assert.match(transformed, /localStorage\.removeItem\(k\)/);
  assert.match(transformed, /indexedDB\.open\("gnc_teardown_staging_v1:"\+String\(DB_NAME\)/);
  assert.match(transformed, /root\.caches\.delete\("gnc_teardown_staging_v1:"\+String\(key\)/);
  assert.doesNotThrow(() => parse(transformed, { ecmaVersion: 'latest' }));
});

test('runtime transform points auth, data and legacy email at the sandbox and preserves module-local transport', () => {
  const source = `const SUPABASE_URL="https://production.example";const SUPABASE_KEY="production-public";const GOOGLE_SCRIPT_URL="https://script.google.com/macros/s/prod/exec";const APP_API_FUNCTION_URL=SUPABASE_URL+"/functions/v1/app-api";const NATIVE_AUTH_ALIAS_DOMAIN="production.example";
    let supabaseClient;function getSupabaseBrowserClient(){return window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{global:{fetch:(input,init)=>window.GncLoginTrace?.fetch(input,init)??window.fetch(input,init)},auth:{storageKey:'gnc_supabase_auth_v1'}})}
    async function fetchWithTimeout(url,options={},timeoutMs=1000,label='Request'){try{return await (window.GncLoginTrace?.fetch(url,{...options,signal:controller.signal})??fetch(url,{...options,signal:controller.signal}))}finally{}}
    async function postGoogleScriptRawJsonPayload(payload={},timeoutMs=1000,label='Email'){return fetchWithTimeout(GOOGLE_SCRIPT_URL,{method:'POST',body:JSON.stringify(payload)},timeoutMs,label)}`;
  const result = transformRuntime(source, config);
  assert.match(result, /https:\/\/apztnscvagayslumnalr\.supabase\.co/);
  assert.match(result, /teardown-api\?legacy_delivery=email/);
  assert.match(result, /gnc_teardown_staging_v1:teardown_auth_v1/);
  assert.match(result, /gnc:staging-fetch/);
  assert.match(result, /headers:await getNativeAuthRequestHeaders\(\)/);
  assert.doesNotMatch(result, /production\.example|script\.google\.com/);
  assert.doesNotThrow(() => parse(result, { ecmaVersion: 'latest' }));
});

test('current inert application source satisfies the staging AST seams and endpoint boundary', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const marker = '<script id="app-script-source" type="text/plain">';
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, 'inert application source marker exists');
  const contentStart = start + marker.length;
  const contentEnd = html.indexOf('</script>', contentStart);
  assert.ok(contentEnd > contentStart, 'inert application source closes');
  const source = html.slice(contentStart, contentEnd);
  const staged = namespaceStorageReferences(transformRuntime(source, config));
  assert.doesNotThrow(() => parse(staged, { ecmaVersion: 'latest', sourceType: 'script', allowAwaitOutsideFunction: true }));
  assert.doesNotMatch(staged, /kzrnyjsosryejjejliii\.supabase\.co|script\.google\.com|agmetricapp\.com/i);
  assert.match(staged, /apztnscvagayslumnalr\.supabase\.co\/functions\/v1\/teardown-api/);
  assert.match(staged, /headers:await getNativeAuthRequestHeaders\(\)/);
});

test('authenticated staging adapter serves profile and synthetic datasets and persists edits only through sandbox API', async () => {
  const commands = [];
  const fetchImpl = async (url, options = {}) => {
    const command = JSON.parse(options.body || '{}');
    commands.push(command);
    if (command.operation === 'bootstrap') return json({ profile, inventory, requests, capabilities: { staging: true } });
    if (command.operation === 'save') return json({ row: { ...inventory[0], ...command.patch, _staging_revision: 2 }, revision: 2 });
    return json({ error: 'TEARDOWN_OPERATION_UNAVAILABLE' }, 422);
  };
  const adapter = createStagingAdapter({ config, fetchImpl, ResponseCtor: Response, eventTarget: {} });
  const auth = 'Bearer sandbox-jwt';
  const profileResponse = await adapter.route({ input: new Request(`${config.sandboxUrl}/rest/v1/profiles?id=eq.profile-1`, { headers: { Authorization: auth } }) });
  assert.equal((await profileResponse.json()).username, 'dylan_collyge');
  const inventoryResponse = await adapter.route({ input: new Request(`${config.sandboxUrl}/functions/v1/teardown-api`, {
    method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'inventory_read', operation: 'master_page', params: { dataset: 'master', projection: 'browse', limit: 50, offset: 0 } }),
  }) });
  assert.equal((await inventoryResponse.json()).data.rows[0].unique_id, 'staging-inventory-001');
  const saveResponse = await adapter.route({ input: new Request(`${config.sandboxUrl}/functions/v1/teardown-api`, {
    method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json', 'Idempotency-Key': 'save-001' },
    body: JSON.stringify({ action: 'db', table: 'ph_master_inventory', method: 'PATCH', query: 'unique_id=eq.staging-inventory-001', body: { SPEC: '5DP', CALIPER: 'staging note forbidden' } }),
  }) });
  assert.equal(saveResponse.status, 200);
  assert.equal(commands.at(-1).operation, 'save');
  assert.deepEqual(commands.at(-1).patch, { dock_spec: '5DP', caliper: 'staging note forbidden' });
  const blocked = await adapter.route({ input: new Request('https://script.google.com/macros/s/prod/exec', { method: 'POST' }) });
  assert.equal(blocked.status, 403);
  const unsupported = await adapter.route({ input: new Request(`${config.sandboxUrl}/rest/v1/unreviewed_table`, { headers: { Authorization: auth } }) });
  assert.equal(unsupported.status, 422);
  assert.equal((await unsupported.json()).error, 'TEARDOWN_MODULE_UNAVAILABLE');
  assert.equal(await adapter.route({ input: new Request(`${config.sandboxUrl}/auth/v1/token?grant_type=password`, { method: 'POST' }) }), null);
});

test('adapter installation is idempotent and disposal removes every lifecycle listener', () => {
  const listeners = new Map();
  const target = {
    addEventListener: (name, listener) => listeners.set(name, [...(listeners.get(name) || []), listener]),
    removeEventListener: (name, listener) => listeners.set(name, (listeners.get(name) || []).filter((entry) => entry !== listener)),
  };
  const adapter = createStagingAdapter({ config, fetchImpl: async () => json({}), ResponseCtor: Response, eventTarget: target });
  const dispose = adapter.install();
  assert.equal(adapter.install(), dispose);
  assert.deepEqual([...listeners.keys()].sort(), ['gnc:staging-fetch', 'pagehide', 'pageshow']);
  dispose();
  dispose();
  assert.deepEqual([...listeners.values()].flat(), []);
});

test('photo form upload uses signed sandbox upload and commits a durable row attachment', async () => {
  const operations = [];
  const fetchImpl = async (url, options = {}) => {
    if (String(url).includes('/storage/v1/object/upload/sign/')) return new Response('', { status: 200 });
    const command = JSON.parse(options.body || '{}');
    operations.push(command.operation);
    if (command.operation === 'bootstrap') return json({ profile, inventory, requests });
    if (command.operation === 'photo_upload_url') return json({ path: 'user-1/staging-inventory-001/photo.jpg', bucket: 'teardown-photos', token: 'signed', signedUrl: 'https://apztnscvagayslumnalr.supabase.co/storage/v1/object/upload/sign/teardown-photos/photo.jpg?token=signed', uploadMethod: 'PUT', headers: { 'x-upsert': 'false' }, contentType: command.contentType });
    if (command.operation === 'photo_commit') return json({ revision: 2, row: { ...inventory[0], _staging_revision: 2, photos: [{ bucket: 'teardown-photos', path: command.path, name: command.filename, url: 'https://apztnscvagayslumnalr.supabase.co/storage/v1/object/sign/teardown-photos/photo.jpg?token=read' }] } });
    return json({ error: 'unexpected operation' }, 422);
  };
  const adapter = createStagingAdapter({ config, fetchImpl, ResponseCtor: Response, eventTarget: {} });
  const form = new FormData();
  form.set('prefix', 'flyer-');
  form.set('fileName', 'staging-photo.jpg');
  form.set('masterUid', 'staging-inventory-001');
  form.set('file', new File([Buffer.from('jpeg')], 'staging-photo.jpg', { type: 'image/jpeg' }));
  const response = await adapter.route({ input: new Request(`${config.sandboxUrl}/functions/v1/teardown-api`, { method: 'POST', headers: { Authorization: 'Bearer sandbox-jwt' }, body: form }) });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.fileName, 'staging-photo.jpg');
  assert.deepEqual(operations, ['bootstrap', 'photo_upload_url', 'photo_commit']);
});

test('compiled Drive evidence RPC maps only reviewed fields into a revisioned sandbox save', async () => {
  const commands = [];
  const fetchImpl = async (_url, options = {}) => {
    const command = JSON.parse(options.body || '{}');
    commands.push(command);
    if (command.operation === 'bootstrap') return json({ profile, inventory, requests });
    if (command.operation === 'save') return json({ row: { ...inventory[0], ...command.patch, _staging_revision: 2, last_updated: '2026-10-05T12:00:00.000Z' }, revision: 2 });
    return json({ error: 'TEARDOWN_OPERATION_UNAVAILABLE' }, 422);
  };
  const adapter = createStagingAdapter({ config, fetchImpl, ResponseCtor: Response, eventTarget: {} });
  const response = await adapter.route({ input: new Request(`${config.sandboxUrl}/rest/v1/rpc/save_drive_evidence_v2`, {
    method: 'POST', headers: { Authorization: 'Bearer sandbox-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_master_uid: inventory[0].unique_id, p_expected_itemcode: 'STAGING-001', p_expected_locationcode: 'E.99.001',
      p_expected_lotcode: '27.F1', p_expected_signature: '', p_evidence: { spec: '5DP', match: '84', comments: 'Crew note', photo_link: 'ignored' },
      p_complete: false, p_workflow: 'season', p_idempotency_key: 'drive-idempotency-token' }),
  }) });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.canonicalConfirmed, true);
  assert.deepEqual(commands.at(-1).patch, { dock_spec: '5DP', match_percent: '84', notes: 'Crew note' });
  assert.match(commands.at(-1).requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(commands.at(-1).expectedRevision, 1);
  assert.equal(result.row.dock_spec, '5DP');
});

test('stage builder consumes a compiled shell, rewrites only its output and requires explicit commit identity', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'gnc-stage-build-'));
  try {
    const site = path.join(repo, '_site');
    const out = path.join(repo, '_staging', 'staging');
    const sourceScripts = path.join(repo, 'scripts', 'staging');
    await mkdir(path.join(site, 'assets'), { recursive: true });
    await mkdir(sourceScripts, { recursive: true });
    for (const file of ['adapter.mjs', 'entry.mjs', 'staging.css']) await cp(new URL(`../scripts/staging/${file}`, import.meta.url), path.join(sourceScripts, file));
    const runtimeName = 'live-app-runtime-v2026082010.min.js';
    await writeFile(path.join(site, 'index.html'), `<html><head><script>const runtime=document.createElement('script');runtime.src='./assets/${runtimeName}?v=V2026.10.05.004';</script><link rel="preload" as="script" href="./assets/${runtimeName}?v=V2026.10.05.004"></head><body></body></html>`);
    await writeFile(path.join(site, 'sw.js'), 'self.addEventListener("fetch",()=>{});');
    await writeFile(path.join(site, 'manifest.json'), '{"start_url":"/"}');
    await writeFile(path.join(site, 'Code.gs'), 'function doGet() {}');
    await writeFile(path.join(site, 'assets', runtimeName), `const SUPABASE_URL='https://old.supabase.co';const SUPABASE_KEY='old';const GOOGLE_SCRIPT_URL='https://script.google.com/';const APP_API_FUNCTION_URL=SUPABASE_URL+'/functions/v1/app-api';const NATIVE_AUTH_ALIAS_DOMAIN='production.example';let supabaseClient;function getSupabaseBrowserClient(){return window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{global:{fetch:(input,init)=>window.fetch(input,init)},auth:{storageKey:'gnc_supabase_auth_v1'}})}async function fetchWithTimeout(url,options={}){try{return await (window.GncLoginTrace?.fetch(url,options)??fetch(url,options))}finally{}}async function postGoogleScriptRawJsonPayload(payload={},timeoutMs=1000,label='Email'){return fetchWithTimeout(GOOGLE_SCRIPT_URL,{method:'POST',body:JSON.stringify(payload)},timeoutMs,label)}`);
    const configPath = path.join(repo, 'config.json');
    await writeFile(configPath, JSON.stringify(config));
    await assert.rejects(buildStagingSite({ siteDir: site, outputDir: out, configPath, repoRoot: repo }), /full 40-character commit SHA/);
    const result = await buildStagingSite({ siteDir: site, outputDir: out, configPath, commitSha: '0123456789abcdef0123456789abcdef01234567', repoRoot: repo });
    const stagedHtml = await readFile(path.join(out, 'index.html'), 'utf8');
    const stagedRuntime = await readFile(path.join(out, 'assets', runtimeName), 'utf8');
    assert.equal(result.runtimeName, runtimeName);
    assert.match(await readFile(path.join(out, 'assets', 'staging-adapter.mjs'), 'utf8'), /STAGING — SYNTHETIC DATA/);
    assert.match(await readFile(path.join(out, 'assets', 'staging-entry.mjs'), 'utf8'), /staging-adapter\.mjs/);
    assert.match(stagedHtml, /worker-src 'none'/);
    assert.ok(stagedHtml.indexOf('Content-Security-Policy') < stagedHtml.indexOf('runtime.src='), 'CSP is inserted before the generated runtime loader');
    assert.match(stagedHtml, /connect-src 'self' https:\/\/apztnscvagayslumnalr\.supabase\.co\/auth\/v1\//);
    assert.doesNotMatch(stagedHtml, /connect-src[^;]*wss:|connect-src 'self' https:\/\/apztnscvagayslumnalr\.supabase\.co;/);
    assert.match(stagedRuntime, /apztnscvagayslumnalr/);
    assert.doesNotMatch(stagedRuntime, /old\.supabase\.co|script\.google\.com/);
    await assert.rejects(readFile(path.join(out, 'sw.js')));
    await assert.rejects(readFile(path.join(out, 'manifest.json')));
    await assert.rejects(readFile(path.join(out, 'Code.gs')));
  } finally { await rm(repo, { recursive: true, force: true }); }
});
