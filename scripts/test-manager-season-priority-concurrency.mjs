import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const connectionString = process.env.SEASON_PRIORITY_TEST_DB_URL || '';
const target = new URL(connectionString || 'postgresql://invalid');
assert.equal(process.env.CI, 'true', 'Concurrency fixtures require isolated CI');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'Hosted database fixtures forbidden');
assert.equal(target.pathname, '/postgres', 'Unexpected isolated database');
const options = { connectionString, connectionTimeoutMillis: 10_000, statement_timeout: 30_000,
  application_name: 'isolated_season_priority_concurrency_test' };
const admin = new pg.Client(options);
const workers = [new pg.Client(options), new pg.Client(options)];
const run = randomUUID();
const itemcode = `SP-CONCURRENT-${run}`;
const sourceId = `SP-CONCURRENT-SOURCE-${run}`;
const lowerId = `SP-CONCURRENT-LOWER-${run}`;
const cavId = `SP-CONCURRENT-CAV-${run}`;
const actors = [
  { id: randomUUID(), username: 'dylan_collyge', role: 'ADMIN' },
  { id: randomUUID(), username: 'megan_kelly', role: 'MANAGER' },
  { id: randomUUID(), username: 'sharon_combs', role: 'MANAGER' },
];
let committed = false;
let originalSetting;
await admin.connect();
try {
  const present = await admin.query('select count(*)::int count from public.profiles where username=any($1::text[])', [actors.map(a => a.username)]);
  assert.equal(present.rows[0].count, 0, 'Isolated fixture usernames already occupied');
  originalSetting = (await admin.query("select value from public.ph_app_settings where key='current_season_salesyear'")).rows[0];
  await admin.query('begin');
  for (const actor of actors) {
    await admin.query("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values($1,$2,now(),'{}','{}')", [actor.id, `${actor.username}@sp-concurrent.example.invalid`]);
    await admin.query("insert into public.profiles(id,username,display_name,role,must_change_password) values($1,$2,$2,$3,false)", [actor.id, actor.username, actor.role]);
  }
  await admin.query("insert into public.ph_app_settings(key,value) values('current_season_salesyear','{\"seasonCode\":\"F1\",\"salesYear\":27}') on conflict(key) do update set value=excluded.value");
  await admin.query("insert into public.ph_cav_import(unique_id,itemcode,season,holdstopreason) values($1,$2,'F1','')", [cavId,itemcode]);
  await admin.query("insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,source,season,saleyear,ptronhand,ptravailable,priority,app_tab_assignment) values($1,$3,'Concurrency Plant','#3','A.01.001','27.F1','PH','F1','27','5','4','1','season'),($2,$3,'Concurrency Plant','#3','B.01.001','27.F1','PH','F1','27','20','19','2','season')", [lowerId,sourceId,itemcode]);
  await admin.query("update public.app_dataset_revisions set state='ready',revision=greatest(revision,1) where key in ('ph_master_inventory','ph_cav_import','ph_warehouse_assigned_items')");
  await admin.query('commit');
  committed = true;
  const fingerprint = (await admin.query('select private.manager_season_priority_scope_fingerprint_v1($1) value',[itemcode])).rows[0].value;
  await Promise.all(workers.map(async client => {
    await client.connect();
    await client.query("select set_config('request.jwt.claim.role','service_role',false)");
  }));
  const results = await Promise.all(workers.map((client,index) => client.query(
    'select public.submit_manager_season_priority_v1($1,$2,2,$3,$4) result',
    [actors[index].id,sourceId,fingerprint,`season-priority-concurrent-${run}-${index}`]
  )));
  const eventIds = new Set(results.map(result => result.rows[0].result.eventId));
  assert.equal(eventIds.size,1,'Concurrent managers created multiple outbox events');
  const counts = await admin.query("select (select count(*)::int from private.manager_season_priority_receipts where itemcode_normalized=upper($1)) receipts,(select count(*)::int from public.ph_request_delivery_outbox where payload#>>'{reclassPayload,source,itemcode}'=$1) events",[itemcode]);
  assert.deepEqual(counts.rows[0],{ receipts:1, events:1 });
  console.log('PASS: two concurrent managers produced one Season Priority receipt and outbox event.');
} finally {
  await Promise.all(workers.map(client => client.end().catch(() => {})));
  if (committed) {
    await admin.query('begin');
    await admin.query("delete from public.ph_inventory_transactions where delivery_event_id in (select event_id from public.ph_request_delivery_outbox where payload#>>'{reclassPayload,source,itemcode}'=$1)",[itemcode]);
    await admin.query('delete from private.manager_season_priority_receipts where itemcode_normalized=upper($1)',[itemcode]);
    await admin.query("delete from public.ph_request_delivery_outbox where payload#>>'{reclassPayload,source,itemcode}'=$1",[itemcode]);
    await admin.query('delete from public.ph_master_inventory where itemcode=$1',[itemcode]);
    await admin.query('delete from public.ph_cav_import where unique_id=$1',[cavId]);
    await admin.query('delete from private.app_access_user_overrides where profile_id=any($1::uuid[])',[actors.map(a=>a.id)]);
    await admin.query('delete from private.app_access_legacy_baseline where profile_id=any($1::uuid[])',[actors.map(a=>a.id)]);
    await admin.query('delete from public.profiles where id=any($1::uuid[])',[actors.map(a=>a.id)]);
    await admin.query('delete from auth.users where id=any($1::uuid[])',[actors.map(a=>a.id)]);
    if (originalSetting) await admin.query("update public.ph_app_settings set value=$1::jsonb where key='current_season_salesyear'",[JSON.stringify(originalSetting.value)]);
    else await admin.query("delete from public.ph_app_settings where key='current_season_salesyear'");
    await admin.query('commit');
  }
  await admin.end();
}
