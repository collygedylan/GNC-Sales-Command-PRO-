// Real native Auth, PostgREST, PostgreSQL transactions and WebSockets, strictly
// against the disposable local Supabase instance created by this workflow.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const sandbox = realpathSync(process.argv[2] || '');
assert.ok(basename(sandbox).startsWith('agmetric-revisions-ci-'), 'Disposable project directory required');
const status = JSON.parse(execFileSync('supabase', ['status', '--workdir', sandbox, '-o', 'json'], { encoding: 'utf8' }));
const apiUrl = status.API_URL;
const dbUrl = status.DB_URL;
for (const value of [apiUrl, dbUrl]) assert.ok(['127.0.0.1', 'localhost'].includes(new URL(value).hostname), 'No hosted project access');
assert.equal(new URL(apiUrl).protocol, 'http:');
const anonKey = status.ANON_KEY || status.PUBLISHABLE_KEY;
const serviceKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
assert.ok(anonKey && serviceKey, 'Local development keys missing');
const guardedFetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  assert.equal(url.origin, new URL(apiUrl).origin, 'External request forbidden');
  return fetch(input, { ...init, redirect: 'error' });
};
const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: guardedFetch } };
const admin = createClient(apiUrl, serviceKey, options);
const sql = new pg.Client({ connectionString: dbUrl, application_name: 'isolated-live-revision-ci', connectionTimeoutMillis: 5000 });
await sql.connect();
const clients = [];
const channels = [];
const repoFile = name => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
const rpc = async (client, name, payload) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await client.rpc(name, payload);
    if (!result.error) return result.data;
    if (result.error.code !== 'PGRST202' || attempt === 29) throw new Error(`${name}: ${result.error.message}`);
    await delay(250);
  }
};
const until = async (condition, label) => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > 15000) throw new Error(`Timeout: ${label}`);
    await delay(50);
  }
};
async function actor(username, module = 'docks') {
  const email = `${randomUUID()}@example.invalid`;
  const password = `Disposable-only-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  const id = created.data.user.id;
  await sql.query('insert into public.profiles(id,username,role) values($1,$2,$3)', [id, username, username === 'dylan_collyge' ? 'Admin' : 'User']);
  if (module) await sql.query('insert into private.fixture_permissions(profile_id,module) values($1,$2)', [id, module]);
  return { email, password, id };
}
async function session(account) {
  const client = createClient(apiUrl, anonKey, options);
  const signed = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  assert.ifError(signed.error);
  clients.push(client);
  await client.realtime.setAuth(signed.data.session.access_token);
  return client;
}
async function watch(client, label) {
  const events = [];
  const channel = client.channel(`revision-${label}-${randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_dataset_revisions', filter: 'key=eq.ph_soc_master' }, payload => events.push(payload.new))
    .on('system', {}, payload => console.log(`Realtime ${label} system: ${JSON.stringify(payload)}`));
  channels.push({ client, channel });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime subscribe timeout')), 15000);
    channel.subscribe((state, error) => {
      if (state === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') { clearTimeout(timer); reject(error || new Error(state)); }
    });
  });
  return events;
}
try {
  await sql.query("select set_config('app.sync_test','isolated',false)");
  // Production already has this publication. A fresh empty local CLI project
  // need not: reproduce that prerequisite without changing any Realtime schema.
  if (!(await sql.query("select 1 from pg_publication where pubname='supabase_realtime'")).rowCount) {
    await sql.query('create publication supabase_realtime');
  }
  await sql.query(repoFile('supabase/ci/live_dataset_revision_baseline.sql'));
  await sql.query(repoFile('supabase/migrations/20260908185903_live_dataset_revisions.sql'));
  await sql.query(repoFile('supabase/tests/live_dataset_revisions_test.sql'));
  assert.equal((await sql.query("select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='app_dataset_revisions'")).rowCount, 1, 'Metadata publication must be active');
  console.log('PASS isolated native PostgreSQL transaction/RLS assertions');
  const account = await actor('dylan_collyge');
  const otherAccount = await actor('synthetic_other', null);
  const first = await session(account);
  const second = await session(account);
  const denied = await session(otherAccount);
  const firstEvents = await watch(first, 'phone');
  const secondEvents = await watch(second, 'tablet');
  const deniedEvents = await watch(denied, 'denied');
  const firstSnapshot = await rpc(first, 'get_my_dataset_revisions_v1', { p_dataset_keys: ['ph_soc_master'] });
  assert.equal(firstSnapshot.sources[0].state, 'ready');
  assert.equal(typeof firstSnapshot.sources[0].revision, 'string');
  const deniedSnapshot = await rpc(denied, 'get_my_dataset_revisions_v1', { p_dataset_keys: ['ph_soc_master'] });
  assert.equal(deniedSnapshot.sources[0].state, 'unavailable');
  assert.equal(deniedSnapshot.sources[0].revision, null);
  assert.equal((await denied.from('app_dataset_revisions').select('*')).data.length, 0);
  assert.ok((await first.from('ph_soc_master').update({ dock: 'Forbidden' }).eq('unique_id', 'none')).error);
  assert.ok((await first.rpc('begin_dataset_import_v1', { p_dataset_keys: ['ph_soc_master'], p_run_id: randomUUID() })).error);

  const runId = randomUUID();
  await rpc(admin, 'begin_dataset_import_v1', { p_dataset_keys: ['ph_soc_master'], p_run_id: runId });
  for (const client of [first, second]) {
    const visible = await client.from('app_dataset_revisions').select('key,state').eq('key', 'ph_soc_master').single();
    assert.ifError(visible.error);
    assert.equal(visible.data.state, 'importing', 'Same native session can read the event row under RLS');
  }
  await until(() => firstEvents.some(e => e.state === 'importing') && secondEvents.some(e => e.state === 'importing'), 'both sessions receive import fence');
  firstEvents.length = 0; secondEvents.length = 0;
  const importer = createClient(apiUrl, serviceKey, { ...options, global: { ...options.global, headers: { 'x-gnc-import-run-id': runId } } });
  for (let chunk = 0; chunk < 3; chunk += 1) {
    const result = await importer.from('ph_soc_master').insert(Array.from({ length: 250 }, (_, i) => ({ unique_id: `ci-${chunk}-${i}`, dock: 'Dock 29', quantityordered: i + 1 })));
    assert.ifError(result.error);
  }
  assert.ifError((await importer.from('ph_soc_master').delete().eq('unique_id', 'ci-0-0')).error);
  await rpc(admin, 'heartbeat_dataset_import_v1', { p_run_id: runId });
  await delay(250);
  assert.equal(firstEvents.length, 0, 'chunks and heartbeat do not emit row spam');
  assert.equal(secondEvents.length, 0);
  await rpc(admin, 'finish_dataset_import_v1', { p_run_id: runId });
  await until(() => firstEvents.some(e => e.state === 'ready') && secondEvents.some(e => e.state === 'ready'), 'both sessions receive ready revision');
  assert.equal(firstEvents.length, 1);
  assert.equal(secondEvents.length, 1);
  assert.equal(deniedEvents.length, 0, 'unauthorized native session receives no metadata');
  const current = await rpc(second, 'get_my_dataset_revisions_v1', { p_dataset_keys: ['ph_soc_master'] });
  assert.ok(BigInt(current.sources[0].revision) > BigInt(firstSnapshot.sources[0].revision));
  assert.equal((await second.from('ph_soc_master').select('*', { count: 'exact', head: true }).eq('dock', 'Dock 29')).count, 749);
  assert.ok((await importer.from('ph_soc_master').update({ quantityordered: 0 }).eq('unique_id', 'ci-1-1')).error, 'closed import retry cannot write');
  console.log('PASS two same-login sessions, actual RLS-filtered Realtime, coalesced 750-row import and pruning');

  // Catch up from durable revisions after a WebSocket is intentionally absent.
  await first.removeChannel(channels[0].channel);
  const beforeOffline = current.sources[0].revision;
  await sql.query("update public.ph_soc_master set date_completed=clock_timestamp() where unique_id='ci-1-1'");
  const reconnect = await rpc(first, 'get_my_dataset_revisions_v1', { p_dataset_keys: ['ph_soc_master'] });
  assert.ok(BigInt(reconnect.sources[0].revision) > BigInt(beforeOffline));
  console.log('PASS missed-socket/reconnect metadata catch-up');

  // Finish waits for an already-running source transaction before ready.
  const fenced = randomUUID();
  await rpc(admin, 'begin_dataset_import_v1', { p_dataset_keys: ['ph_soc_master'], p_run_id: fenced });
  const writer = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });
  await writer.connect();
  try {
    await writer.query('begin');
    await writer.query("update public.ph_soc_master set quantityordered=quantityordered+1 where unique_id='ci-1-1'");
    let finished = false;
    const finishing = rpc(admin, 'finish_dataset_import_v1', { p_run_id: fenced }).then(value => { finished = true; return value; });
    await delay(150);
    assert.equal(finished, false, 'cannot publish ahead of committed source');
    await writer.query('commit');
    await finishing;
  } finally { await writer.query('rollback').catch(() => {}); await writer.end(); }
  console.log('PASS concurrent source commit / finish ordering');

  const timings = [];
  for (let i = 0; i < 20; i += 1) {
    const start = performance.now();
    await rpc(first, 'get_my_dataset_revisions_v1', { p_dataset_keys: ['ph_soc_master', 'ph_master_inventory', 'ph_app_settings'] });
    timings.push(performance.now() - start);
  }
  console.log(`Metadata RPC local p95: ${timings.sort((a,b) => a-b)[18].toFixed(1)}ms; fixture permission resolver, not production load benchmark`);
  const beforePermission = reconnect.permissionVersion;
  await sql.query("update public.profiles set division='20' where id=$1", [account.id]);
  assert.notEqual((await rpc(first, 'get_my_dataset_revisions_v1', { p_dataset_keys: ['ph_soc_master'] })).permissionVersion, beforePermission);
  await sql.query('delete from private.fixture_permissions where profile_id=$1', [account.id]);
  assert.equal((await rpc(first, 'get_my_dataset_revisions_v1', { p_dataset_keys: ['ph_soc_master'] })).sources[0].state, 'unavailable');
  await sql.query('delete from auth.sessions where user_id=$1', [account.id]);
  assert.ok((await first.rpc('get_my_dataset_revisions_v1', { p_dataset_keys: ['ph_soc_master'] })).error, 'revoked session rejected with old JWT');
  console.log('PASS current database membership/scope and native session revocation');
} finally {
  for (const { client, channel } of channels) await client.removeChannel(channel).catch(() => {});
  for (const client of clients) await client.auth.signOut({ scope: 'local' }).catch(() => {});
  await sql.end();
}
