import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// This fixture intentionally commits so ten independent sessions can contend.
// It is ONLY allowed against a CI-owned loopback database, never hosted data.
const connectionString = process.env.EVAL_REVIEW_TEST_DB_URL || '';
const target = new URL(connectionString || 'postgresql://invalid');
assert.equal(process.env.CI, 'true', 'Concurrency fixtures require isolated CI');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'Hosted database fixtures forbidden');
assert.equal(target.pathname, '/postgres', 'Unexpected isolated database');
const options = { connectionString, connectionTimeoutMillis: 10_000, statement_timeout: 30_000,
  application_name: 'isolated_review_concurrency_test' };
const admin = new pg.Client(options);
const workers = [];
const run = randomUUID();
const sourceId = `REVIEW-CONCURRENT-${run}`;
const itemcode = `REVIEW-CONCURRENT-${run}`;
const token = `review-concurrent-${run}`;
const usernames = ['dylan_collyge', 'megan_kelly', 'charley_robertson'];
const fixtures = usernames.map(username => ({ username, id: randomUUID(), email: `${username}@review-concurrent.example.invalid` }));
let fixtureCommitted = false;
let originalSetting;
await admin.connect();
try {
  const present = await admin.query('select count(*)::int count from public.profiles where username=any($1::text[])', [usernames]);
  assert.equal(present.rows[0].count, 0, 'Isolated review fixture names already occupied; will not overwrite');
  originalSetting = (await admin.query("select value from public.ph_app_settings where key='current_season_salesyear'")).rows[0];
  await admin.query('begin');
  for (const fixture of fixtures) {
    await admin.query("insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,'{}','{}')", [fixture.id, fixture.email]);
    await admin.query("insert into public.profiles(id,username,display_name,role,must_change_password) values($1,$2,$2,'ADMIN',false)", [fixture.id, fixture.username]);
  }
  await admin.query("insert into public.ph_app_settings(key,value) values('current_season_salesyear','{\"seasonCode\":\"F1\",\"salesYear\":\"27\"}') on conflict(key) do update set value=excluded.value");
  await admin.query("insert into public.ph_master_inventory(unique_id,itemcode,genusname,commonname,contsize,locationcode,lotcode,source,season,saleyear,ptronhand,ptravailable) values($1,$2,'Spiraea','Concurrency Fixture','#3','I.13.000','27.S1','LD','S1','27','40','40')", [sourceId,itemcode]);
  await admin.query("insert into public.ph_warehouse_assigned_items(unique_id,itemcode,itemcode_normalized,genusname,genusname_normalized,assignment_key,assignedto,present_in_drive,assigned_at) values($1,$2,upper($2),'Spiraea','spiraea',private.normalize_eval_assignment_key($2,'Spiraea'),'charley_robertson',true,now())", [sourceId,itemcode]);
  await admin.query('commit');
  fixtureCommitted = true;
  await admin.query("select set_config('request.jwt.claim.role','service_role',false)");
  const source = { unique_id:sourceId, source_table:'ph_master_inventory', itemcode,
    locationcode:'I.13.000', lotcode:'27.S1' };
  const setup = (await admin.query('select public.get_eval_work_review_setup_v1($1::jsonb) setup', [JSON.stringify({actorUsername:'dylan_collyge',source})])).rows[0].setup;
  const payload = { actorUsername:'dylan_collyge', createToken:token, source,
    expectedAssignmentRevision:setup.assignmentRevision, additionalCompletionRecipients:[], instructions:'Concurrent fixture' };
  for (let index=0;index<10;index++) {
    const client = new pg.Client(options);
    workers.push(client);
    await client.connect();
    await client.query("select set_config('request.jwt.claim.role','service_role',false)");
  }
  const results = await Promise.all(workers.map(client => client.query(
    'select to_jsonb(public.create_eval_work_multi_v1($1::jsonb)) work', [JSON.stringify(payload)])));
  const ids = new Set(results.map(result=>result.rows[0].work.id));
  assert.equal(ids.size,1,'Concurrent retries created multiple work IDs');
  const work = results[0].rows[0].work;
  assert.deepEqual(work.assignee_usernames,['charley_robertson']);
  assert.deepEqual(work.completion_recipients,['charley_robertson@review-concurrent.example.invalid']);
  const count = (await admin.query('select count(*)::int count from public.ph_request_delivery_outbox where event_type=$1 and request_id=$2',['eval_work_assignment',work.id])).rows[0].count;
  assert.equal(count,1,'Concurrent retries created duplicate assignment events');
  const originalEvent = (await admin.query('select to_jsonb(o) event from public.ph_request_delivery_outbox o where event_id=$1',[work.assignment_event_id])).rows[0].event;
  await admin.query("update public.ph_warehouse_assigned_items set assignedto='megan_kelly',assigned_at=now() where unique_id=$1",[sourceId]);
  const replay = (await admin.query('select to_jsonb(public.create_eval_work_multi_v1($1::jsonb)) work',[JSON.stringify(payload)])).rows[0].work;
  assert.deepEqual(replay,work,'Later AssignedTo change redirected existing work');
  assert.deepEqual((await admin.query('select to_jsonb(o) event from public.ph_request_delivery_outbox o where event_id=$1',[work.assignment_event_id])).rows[0].event,originalEvent,'Retry rewrote frozen delivery');
  console.log('PASS: 10 concurrent single-review submissions, one work, one assignment event, immutable replay.');
} finally {
  await Promise.all(workers.map(client=>client.end()));
  await admin.query('rollback');
  if (fixtureCommitted) {
    await admin.query('begin');
    await admin.query('update public.ph_eval_work set assignment_event_id=null,completion_event_id=null where create_token=$1',[token]);
    await admin.query('delete from public.ph_request_delivery_outbox where request_id in (select id::text from public.ph_eval_work where create_token=$1)',[token]);
    await admin.query('delete from public.ph_eval_work_events where eval_work_id in (select id from public.ph_eval_work where create_token=$1)',[token]);
    await admin.query('delete from public.ph_eval_work where create_token=$1',[token]);
    await admin.query('delete from public.ph_warehouse_assigned_items where unique_id=$1',[sourceId]);
    await admin.query('delete from public.ph_master_inventory where unique_id=$1',[sourceId]);
    await admin.query('delete from private.app_access_user_overrides where profile_id=any($1::uuid[])',[fixtures.map(f=>f.id)]);
    await admin.query('delete from private.app_access_legacy_baseline where profile_id=any($1::uuid[])',[fixtures.map(f=>f.id)]);
    await admin.query('delete from public.profiles where id=any($1::uuid[])',[fixtures.map(f=>f.id)]);
    await admin.query('delete from auth.users where id=any($1::uuid[])',[fixtures.map(f=>f.id)]);
    if (originalSetting) await admin.query("update public.ph_app_settings set value=$1::jsonb where key='current_season_salesyear'",[JSON.stringify(originalSetting.value)]);
    else await admin.query("delete from public.ph_app_settings where key='current_season_salesyear'");
    await admin.query('commit');
  }
  await admin.end();
}
