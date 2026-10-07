import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Real native-authenticated sessions are required to exercise the manager RPC.
// This committed fixture is permitted only against the disposable loopback CI DB.
const connectionString = process.env.ITEMCODE_DEFAULT_OWNER_TEST_DB_URL || '';
const target = new URL(connectionString || 'postgresql://invalid');
assert.equal(process.env.CI, 'true', 'Default-owner concurrency fixture requires isolated CI');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'Hosted database fixtures forbidden');
assert.equal(target.pathname, '/postgres', 'Unexpected isolated database');

const options = { connectionString, connectionTimeoutMillis: 10_000, statement_timeout: 30_000,
  application_name: 'isolated_default_owner_concurrency_test' };
const admin = new pg.Client(options);
const clients = [];
const actorId = randomUUID();
const sessionId = randomUUID();
const run = randomUUID();
const itemcodes = [`OWNER-CONCURRENT-A-${run}`, `OWNER-CONCURRENT-B-${run}`];
const sourceIds = [`OWNER-CONCURRENT-SOURCE-A-${run}`, `OWNER-CONCURRENT-SOURCE-B-${run}`];
const usernames = [`owner_concurrent_a_${run.replaceAll('-', '')}`, `owner_concurrent_b_${run.replaceAll('-', '')}`];
const requestIds = [randomUUID(), randomUUID(), randomUUID()];
const claims = { role: 'authenticated', sub: actorId, session_id: sessionId,
  iss: 'https://kzrnyjsosryejjejliii.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600 };
let fixtureCommitted = false;
const authenticate = async client => {
  await client.query("select set_config('request.jwt.claims',$1,false),set_config('request.jwt.claim.role','authenticated',false)",
    [JSON.stringify(claims)]);
  await client.query('set role authenticated');
};

await admin.connect();
try {
  const occupied = await admin.query('select count(*)::int count from public.profiles where username=$1', ['dylan_collyge']);
  assert.equal(occupied.rows[0].count, 0, 'Synthetic manager identity is occupied; never overwrite it');
  await admin.query('begin');
  await admin.query("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values($1,$2,now(),'{}','{}')",
    [actorId, `${actorId}@default-owner-concurrency.example.invalid`]);
  await admin.query("insert into public.profiles(id,username,display_name,role,must_change_password) values($1,'dylan_collyge','Default owner concurrency','ADMIN',false)", [actorId]);
  await admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 hour')", [sessionId, actorId]);
  await admin.query("insert into public.ph_eval_assignment_users(username,display_name,active,source) values($1,'Concurrency A',true,'ci_fixture'),($2,'Concurrency B',true,'ci_fixture')",
    usernames);
  await admin.query("update public.app_dataset_revisions set state='ready',revision=greatest(revision,1) where key='ph_master_inventory'");
  await admin.query("insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,source,season,saleyear,ptronhand,ptravailable) values($1,$2,'Default owner concurrency','#3','D.10.022','27.F1','PH','F1','27','4','4'),($3,$4,'Default owner retry','#3','D.10.022','27.F1','PH','F1','27','4','4')",
    [sourceIds[0], itemcodes[0], sourceIds[1], itemcodes[1]]);
  await admin.query('commit');
  fixtureCommitted = true;

  for (let index = 0; index < 2; index++) {
    const client = new pg.Client(options);
    clients.push(client);
    await client.connect();
    await authenticate(client);
  }

  const invoke = (client, itemcode, owner, requestId) => client.query(
    'select public.set_itemcode_default_owners_v1($1::jsonb,$2::uuid) result',
    [JSON.stringify([{ itemcode, assignedto: owner, expectedRevision: 0 }]), requestId]);

  const competing = await Promise.allSettled([
    invoke(clients[0], itemcodes[0], usernames[0], requestIds[0]),
    invoke(clients[1], itemcodes[0], usernames[1], requestIds[1]),
  ]);
  assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1,
    'Only one concurrent edit with the same expected revision may commit');
  const conflict = competing.find(result => result.status === 'rejected').reason;
  assert.equal(conflict.code, '40001');
  assert.equal(conflict.message, 'ITEMCODE_DEFAULT_OWNER_REVISION_CONFLICT');

  const retries = await Promise.all([
    invoke(clients[0], itemcodes[1], usernames[0], requestIds[2]),
    invoke(clients[1], itemcodes[1], usernames[0], requestIds[2]),
  ]);
  assert.deepEqual(retries[1].rows[0].result, retries[0].rows[0].result,
    'Concurrent exact retries return the same saved acknowledgment');
  const audit = await admin.query('select count(*)::int count from private.ph_itemcode_default_owner_audit where request_id=$1', [requestIds[2]]);
  assert.equal(audit.rows[0].count, 1, 'Concurrent exact retries create one default-owner audit row');
  console.log('PASS: stale concurrent edits conflict; same-request retries acknowledge once through native auth sessions.');
} finally {
  const closeResults = await Promise.allSettled(clients.map(client => client.end()));
  for (const result of closeResults) {
    if (result.status === 'rejected') console.error('Unable to close concurrency-test database session:', result.reason);
  }
  if (fixtureCommitted) {
    await admin.query('begin');
    await admin.query('delete from private.ph_itemcode_default_owner_commands where request_id=any($1::uuid[])', [requestIds]);
    await admin.query('delete from private.ph_itemcode_default_owner_audit where request_id=any($1::uuid[])', [requestIds]);
    await admin.query('delete from public.ph_master_inventory where unique_id=any($1::text[])', [sourceIds]);
    await admin.query('delete from private.ph_inventory_row_assignment_audit where master_unique_id=any($1::text[])', [sourceIds]);
    await admin.query('delete from public.ph_inventory_row_assignments where master_unique_id=any($1::text[])', [sourceIds]);
    await admin.query('delete from public.ph_itemcode_default_owners where itemcode_normalized=any($1::text[])', [itemcodes]);
    await admin.query('delete from public.ph_eval_assignment_users where username=any($1::text[])', [usernames]);
    await admin.query('delete from auth.sessions where id=$1', [sessionId]);
    await admin.query('delete from public.profiles where id=$1', [actorId]);
    await admin.query('delete from auth.users where id=$1', [actorId]);
    await admin.query('commit');
  }
  await admin.end();
}
