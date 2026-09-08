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
const snapshotResponseBytes = [];
const guardedFetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  assert.equal(url.origin, new URL(apiUrl).origin, 'External request forbidden');
  const response = await fetch(input, { ...init, redirect: 'error' });
  if (url.pathname === '/rest/v1/rpc/get_my_dataset_revisions_v1' && response.ok) {
    snapshotResponseBytes.push((await response.clone().arrayBuffer()).byteLength);
  }
  return response;
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
  let postgresReady = false;
  const channel = client.channel(`revision-${label}-${randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_dataset_revisions', filter: 'key=eq.ph_soc_master' }, payload => events.push(payload.new))
    .on('system', {}, payload => {
      console.log(`Realtime ${label} system: ${JSON.stringify(payload)}`);
      if (payload.extension === 'postgres_changes' && payload.status === 'ok') postgresReady = true;
    });
  channels.push({ client, channel });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime subscribe timeout')), 15000);
    channel.subscribe((state, error) => {
      if (state === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') { clearTimeout(timer); reject(error || new Error(state)); }
    });
  });
  // Channel join can precede the database subscription by several seconds on
  // a cold local stack. Don't lose the fixture's first event in that gap.
  await until(() => postgresReady, `${label} PostgreSQL subscription ready`);
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
  await sql.query(repoFile('supabase/migrations/20260908201318_live_dataset_revision_empty_statements.sql'));
  await sql.query(repoFile('supabase/tests/live_dataset_revisions_test.sql'));
  await sql.query(repoFile('supabase/tests/live_dataset_revisions_empty_statements_test.sql'));
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
  assert.equal(firstEvents.length, 1);
  assert.equal(secondEvents.length, 1);
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
  console.log('ph_soc_master import: 2 metadata events per authorized device (1 importing + 1 ready); 0 chunk/heartbeat events; 0 events to denied session');

  // Real Postgres statement triggers fire even when no tuple matched. These
  // maintenance/retry commands must not advertise a source change or consume
  // Realtime messages. Test SQL and actual PostgREST paths independently.
  const sourceMetadata = async () => (await sql.query("select revision::text,changed_at::text from public.app_dataset_revisions where key='ph_soc_master'")).rows[0];
  const beforeEmpty = await sourceMetadata();
  firstEvents.length = 0; secondEvents.length = 0;
  await sql.query("insert into public.ph_soc_master(unique_id) select 'native-empty' where false");
  await sql.query("update public.ph_soc_master set dock='No row' where unique_id='native-missing'");
  await sql.query("delete from public.ph_soc_master where unique_id='native-missing'");
  await sql.query("insert into public.ph_soc_master(unique_id) values('ci-1-1') on conflict(unique_id) do nothing");
  assert.ifError((await admin.from('ph_soc_master').update({ dock: 'No row' }).eq('unique_id', 'native-missing')).error);
  assert.ifError((await admin.from('ph_soc_master').delete().eq('unique_id', 'native-missing')).error);
  assert.ifError((await admin.from('ph_soc_master').upsert({ unique_id: 'ci-1-1', quantityordered: 0 }, { onConflict: 'unique_id', ignoreDuplicates: true })).error);
  assert.deepEqual(await sourceMetadata(), beforeEmpty, 'seven empty SQL/REST commands preserve revision and timestamp');
  for (const result of [
    await importer.from('ph_soc_master').update({ dock: 'No row' }).eq('unique_id', 'native-missing'),
    await importer.from('ph_soc_master').delete().eq('unique_id', 'native-missing'),
  ]) {
    assert.equal(result.error?.message, 'DATASET_IMPORT_FENCE_LOST', 'closed-token validation also applies to empty REST requests');
  }
  await delay(300);
  assert.equal(firstEvents.length, 0, 'zero-row commands emit no phone events');
  assert.equal(secondEvents.length, 0, 'zero-row commands emit no tablet events');
  console.log('PASS 7 empty SQL/PostgREST commands: 0 revisions, 0 events per device; closed-token zero-row retries rejected');

  // Positive controls form a delivery barrier as well as proving that event
  // suppression did not disable real inserts/updates/deletes. The first also
  // proves an empty earlier statement cannot hide a later real transaction.
  const realCommands = [
    "begin; update public.ph_soc_master set dock='none' where false; insert into public.ph_soc_master(unique_id,quantityordered) values('native-real',1); commit",
    "update public.ph_soc_master set quantityordered=2 where unique_id='native-real'",
    "insert into public.ph_soc_master(unique_id,quantityordered) values('native-real',3) on conflict(unique_id) do update set quantityordered=excluded.quantityordered",
    "update public.ph_soc_master set quantityordered=quantityordered where unique_id='native-real'",
    "delete from public.ph_soc_master where unique_id='native-real'",
  ];
  for (const [index, command] of realCommands.entries()) {
    const before = await sourceMetadata();
    await sql.query(command);
    const after = await sourceMetadata();
    assert.equal(BigInt(after.revision), BigInt(before.revision) + 1n, 'real mutation publishes one revision');
    await until(() => firstEvents.length >= index + 1 && secondEvents.length >= index + 1, 'both sessions receive real source mutation');
    assert.equal(String(firstEvents[index].revision), after.revision);
    assert.equal(String(secondEvents[index].revision), after.revision);
  }
  await delay(250);
  assert.equal(firstEvents.length, realCommands.length, 'no late empty-statement or duplicate upsert event');
  assert.equal(secondEvents.length, realCommands.length);
  assert.equal(deniedEvents.length, 0);
  console.log('PASS real insert, update, upsert-update, same-value row update, delete: 5 revisions and exactly 5 events per authorized device');

  // Catch up from durable revisions after a WebSocket is intentionally absent.
  await first.removeChannel(channels[0].channel);
  const beforeOffline = (await sourceMetadata()).revision;
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
  const firstMeasuredResponse = snapshotResponseBytes.length;
  for (let i = 0; i < 20; i += 1) {
    const start = performance.now();
    await rpc(first, 'get_my_dataset_revisions_v1', { p_dataset_keys: ['ph_soc_master', 'ph_master_inventory', 'ph_app_settings'] });
    timings.push(performance.now() - start);
  }
  const measuredResponseBytes = snapshotResponseBytes.slice(firstMeasuredResponse);
  assert.equal(measuredResponseBytes.length, 20);
  assert.ok(measuredResponseBytes.every(size => size < 4096), 'Three-source metadata response stays bounded');
  console.log(`Metadata RPC local p95: ${timings.sort((a,b) => a-b)[18].toFixed(1)}ms; fixture permission resolver, not production load benchmark`);
  console.log(`Metadata RPC response body for 3 sources: mean ${Math.round(measuredResponseBytes.reduce((sum,size) => sum+size,0)/measuredResponseBytes.length)} bytes, max ${Math.max(...measuredResponseBytes)} bytes; actual local HTTP body, not production compressed egress`);
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
