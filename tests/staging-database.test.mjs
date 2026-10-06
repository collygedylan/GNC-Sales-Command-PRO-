import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

const url = process.env.STAGING_TEST_DATABASE_URL;
const schema = fs.readFileSync(new URL('../supabase/staging/teardown-schema.sql', import.meta.url), 'utf8');
const sessionFence = fs.readFileSync(new URL('../supabase/staging/teardown-session-fence.sql', import.meta.url), 'utf8');
const fencedResources = [
  'public.sandbox_runtime','public.ph_master_inventory','public.ph_active_request','public.ph_cav_import',
  'public.ph_27f1_hl_po','public.ph_dock_team_status','public.sandbox_profiles',
  'public.sandbox_workflow_records','public.sandbox_message_threads','public.sandbox_messages',
  'public.sandbox_upload_jobs','public.sandbox_event_log','public.ph_app_user_preferences',
  'public.ph_app_live_pilot_flags','public.profiles','public.ph_runtime_feature_flags','storage.objects',
];
test('staging SQL uses namespaced private operations and never resets shared resources', () => {
  assert.doesNotMatch(schema, /drop\s+(?:schema|table)|truncate|delete\s+from|alter\s+role|create\s+extension/i);
  assert.match(schema, /on conflict \(collection,id\) do nothing/);
  assert.doesNotMatch(schema, /function public\.[\s\S]{0,120}security definer/i);
  assert.match(schema, /expectedRevision/);
  assert.match(schema, /auth\.sessions/);
  assert.match(schema, /starts_with\(coalesce\(photo->>'path',''\), v_actor::text \|\| '\/' \|\| \(command->>'rowId'\) \|\| '\/'\)/);
  assert.match(schema, /prior\.command <> command/);
  assert.match(schema, /'collection', collection/);
  assert.match(schema, /commands\.actor = v_actor and commands\.request_id = v_request/);
  assert.match(schema, /deliveries\.actor = v_actor and deliveries\.request_id = v_request/);
  assert.doesNotMatch(schema, /(?:save_row|capture_delivery|commit_photo)\.actor/);
  assert.match(schema, /jsonb_object_keys\(patch\) as patch_field\(key\) where patch_field\.key not in/);
  assert.match(schema, /default 'captured'.*check \(state = 'captured'\)/s);
});
test('shared-data fence only denies authenticated teardown identities without widening grants', () => {
  assert.doesNotMatch(sessionFence, /drop\s+(?:schema|table)|truncate|delete\s+from|alter\s+role/i);
  assert.match(sessionFence, /create or replace function teardown_private\.is_teardown_identity\(\)/);
  assert.match(sessionFence, /where user_id = auth\.uid\(\)/);
  assert.match(sessionFence, /as restrictive for all to authenticated using \(not teardown_private\.is_teardown_identity\(\)\) with check \(not teardown_private\.is_teardown_identity\(\)\)/);
  assert.match(sessionFence, /if not exists \(select 1 from pg_policy[\s\S]*polname='teardown_identity_fence'/);
  assert.match(sessionFence, /if to_regclass\(target\) is null then raise exception/);
  for (const resource of fencedResources) assert.ok(sessionFence.includes(`'${resource}'`), `missing fence for ${resource}`);
  assert.doesNotMatch(sessionFence, /to\s+anon|to\s+public|grant\s+all/i);
});
test('isolated SQL authorization, revisions, idempotency and delivery capture', { skip: !url }, async () => {
  const target = new URL(url);
  assert.ok(['localhost','127.0.0.1'].includes(target.hostname), 'disposable local database required');
  assert.equal(target.pathname, '/teardown_test');
  const db = new pg.Client({ connectionString: url }); await db.connect();
  const actor = '40000000-0000-4000-8000-000000000001';
  const session = '40000000-0000-4000-8000-000000000002';
  const otherActor = '40000000-0000-4000-8000-000000000003';
  try {
    await db.query(`create role anon; create role authenticated; create role service_role;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key); create table auth.sessions(id uuid primary key,user_id uuid);
      create function auth.jwt() returns jsonb language sql as 'select current_setting(''request.jwt.claims'',true)::jsonb';
      create function auth.uid() returns uuid language sql as 'select (auth.jwt()->>''sub'')::uuid';
      grant usage on schema auth, storage to authenticated, anon; grant execute on all functions in schema auth to authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(bucket_id text,name text);
      insert into auth.users values ('${actor}'),('${otherActor}');
      insert into auth.sessions values ('${session}','${actor}');`);
    await db.query(schema);
    await db.query('insert into teardown_private.members values ($1,$2,$3,true)', [actor,'dylan_collyge','Dylan Staging']);

    // Fixture shared sandbox objects with permissive pre-existing access. The
    // additive restrictive fence must isolate teardown identities without
    // changing the behavior of unrelated authenticated or anonymous users.
    for (const resource of fencedResources.filter(name => name !== 'storage.objects')) {
      const table = resource.split('.')[1];
      await db.query(`create table public.${table}(id text primary key);
        alter table public.${table} enable row level security;
        create policy fixture_existing_access on public.${table} for all to authenticated, anon using (true) with check (true);
        grant select, insert on public.${table} to authenticated, anon;
        insert into public.${table} values ('fixture-row');`);
    }
    await db.query(`alter table storage.objects enable row level security;
      create policy fixture_existing_access on storage.objects for all to authenticated, anon using (true) with check (true);
      grant select, insert on storage.objects to authenticated, anon;
      insert into storage.objects values ('other-bucket','fixture-row');`);
    await db.query(`insert into teardown.rows(collection,id,data) values
      ('inventory','staging-request-001','{"unique_id":"same-id-inventory"}')`);
    await db.query('set role authenticated');
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:actor,session_id:session})]);
    const rpc = async (name, input) => (await db.query(`select public.teardown_${name}($1::jsonb) as value`, [JSON.stringify(input)])).rows[0].value;
    const snapshot = (await db.query('select public.teardown_bootstrap() as value')).rows[0].value;
    assert.equal(snapshot.inventory[0].unique_id, 'staging-inventory-001');
    const command = { collection:'inventory',id:'staging-inventory-001',requestId:'50000000-0000-4000-8000-000000000001',expectedRevision:1,patch:{note:'Saved staging note'} };
    const saved = await rpc('save_row',command); assert.equal(saved.revision,2);
    assert.deepEqual(await rpc('save_row',command),saved);
    await assert.rejects(rpc('save_row',{...command,patch:{note:'Changed'}}), /REQUEST_ID_REUSED/);
    await assert.rejects(rpc('save_row',{...command,requestId:'50000000-0000-4000-8000-000000000002'}), /REVISION_CONFLICT/);
    await assert.rejects(rpc('save_row',{...command,requestId:'50000000-0000-4000-8000-000000000003',expectedRevision:2,patch:{role:'Admin'}}), /FIELD_FORBIDDEN/);
    await assert.rejects(rpc('save_row',{...command,requestId:'50000000-0000-4000-8000-000000000004',expectedRevision:null}), /INVALID_COMMAND/);
    const delivery = {requestId:'50000000-0000-4000-8000-000000000005',collection:'requests',rowId:'staging-request-001',channel:'email'};
    assert.equal((await rpc('capture_delivery',delivery)).state,'captured');
    const captured = await rpc('capture_delivery',delivery);
    assert.deepEqual(captured,await rpc('capture_delivery',delivery));
    await assert.rejects(rpc('capture_delivery',{...delivery,collection:'inventory'}), /REQUEST_ID_REUSED/);
    await assert.rejects(rpc('capture_delivery',{...delivery,channel:'push'}), /REQUEST_ID_REUSED/);

    const photoPath = `${actor}/staging-inventory-001/photo.png`;
    await db.query('insert into storage.objects values ($1,$2)', ['teardown-photos',photoPath]);
    const photoCommand = { collection:'inventory',rowId:'staging-inventory-001',requestId:'50000000-0000-4000-8000-000000000006',expectedRevision:2,
      photo:{bucket:'teardown-photos',path:photoPath,name:'Photo',contentType:'image/png'} };
    await assert.rejects(rpc('commit_photo',{...photoCommand,photo:{...photoCommand.photo,path:`${actor}/another-row/photo.png`}}), /PHOTO_FORBIDDEN/);
    const photoSaved = await rpc('commit_photo',photoCommand);
    assert.equal(photoSaved.revision,3);
    assert.deepEqual(await rpc('commit_photo',photoCommand),photoSaved);
    await assert.rejects(rpc('commit_photo',{...photoCommand,photo:{...photoCommand.photo,name:'Different'}}), /REQUEST_ID_REUSED/);

    // Reapplying the staging seed must backfill only the missing assignment;
    // previously saved review text and uploaded-photo metadata remain intact.
    await db.query('reset role');
    await db.query(`update teardown.rows
      set data = data - 'app_tab_assignment', updated_at = clock_timestamp()
      where collection = 'inventory' and id = 'staging-inventory-001'`);
    const beforeBackfill = (await db.query(`select data, revision, updated_at
      from teardown.rows where collection = 'inventory' and id = 'staging-inventory-001'`)).rows[0];
    assert.equal(beforeBackfill.data.note, 'Saved staging note');
    assert.equal(beforeBackfill.data.photos.length, 1);
    await db.query(schema);
    const afterBackfill = (await db.query(`select data, revision, updated_at
      from teardown.rows where collection = 'inventory' and id = 'staging-inventory-001'`)).rows[0];
    assert.equal(afterBackfill.data.app_tab_assignment, 'season');
    assert.equal(afterBackfill.data.note, beforeBackfill.data.note);
    assert.deepEqual(afterBackfill.data.photos, beforeBackfill.data.photos);
    assert.equal(Number(afterBackfill.revision), Number(beforeBackfill.revision) + 1);
    assert.ok(new Date(afterBackfill.updated_at) >= new Date(beforeBackfill.updated_at));
    await db.query('set role authenticated');

    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actor,session_id:'40000000-0000-4000-8000-000000000099'})]);
    await assert.rejects(db.query('select public.teardown_bootstrap()'), /ACCESS_DENIED/);
    await db.query('reset role');
    await db.query('delete from auth.sessions where id=$1',[session]);
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actor,session_id:session})]);
    await db.query('set role authenticated');
    await assert.rejects(db.query('select public.teardown_bootstrap()'), /ACCESS_DENIED/);
    await db.query('reset role');
    await db.query('insert into auth.sessions values ($1,$2)',[session,actor]);
    await db.query('update teardown_private.members set active=false where user_id=$1',[actor]);
    await db.query('set role authenticated');
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actor,session_id:session})]);
    await assert.rejects(db.query('select public.teardown_bootstrap()'), /ACCESS_DENIED/);
    await db.query('reset role'); await db.query('set role anon');
    await assert.rejects(db.query('select public.teardown_bootstrap()'), /permission denied/);
    await assert.rejects(db.query('select * from teardown.rows'), /permission denied/);

    // The session fence is an additive restrictive policy: a teardown member
    // cannot read or write shared application tables, while ordinary users and
    // the pre-existing anonymous policy are unchanged.
    await db.query('reset role');
    await db.query('update teardown_private.members set active=true where user_id=$1',[actor]);
    await db.query(sessionFence);
    await db.query('set role authenticated');
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actor,session_id:session})]);
    for (const resource of fencedResources) {
      const [resourceSchema, table] = resource.split('.');
      const count = await db.query(`select count(*)::int as count from ${resourceSchema}.${table}`);
      assert.equal(count.rows[0].count,0,`teardown identity read shared rows in ${resource}`);
      const values = resource === 'storage.objects' ? "'teardown-photos','blocked-row'" : "'blocked-row'";
      await assert.rejects(db.query(`insert into ${resourceSchema}.${table} values (${values})`), /row-level security|policy/i,
        `teardown identity wrote shared rows in ${resource}`);
    }
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:otherActor})]);
    const ordinary = await db.query('select count(*)::int as count from public.sandbox_runtime');
    assert.equal(ordinary.rows[0].count,1);
    await db.query("insert into public.sandbox_runtime values ('ordinary-user-row')");
    await db.query('reset role'); await db.query('set role anon');
    const anonymous = await db.query('select count(*)::int as count from public.sandbox_runtime');
    assert.equal(anonymous.rows[0].count,2);
  } finally { await db.end(); }
});
