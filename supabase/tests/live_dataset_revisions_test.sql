-- This transaction is rolled back; no customer fixtures or production records.
begin;
do $$ begin
  if current_setting('app.sync_test',true) is distinct from 'isolated' then raise exception 'Isolated harness required'; end if;
end $$;
create function pg_temp.assert_true(test boolean,label text) returns void language plpgsql as $$
begin if test is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.expect_error(command text,expected text) returns void language plpgsql as $$
begin
  begin execute command;
  exception when others then
    if position(expected in sqlerrm)>0 then return; end if;
    raise exception 'Expected %, got %',expected,sqlerrm;
  end;
  raise exception 'Expected error % was not raised',expected;
end $$;
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into public.profiles(id,username,role) values
 ('10000000-0000-4000-8000-000000000001','dylan_collyge','Admin'),
 ('10000000-0000-4000-8000-000000000002','synthetic_staff','User');
insert into private.fixture_permissions(profile_id,module) values
 ('10000000-0000-4000-8000-000000000001','docks'),
 ('10000000-0000-4000-8000-000000000001','sales'),
 ('10000000-0000-4000-8000-000000000002','docks');
insert into auth.sessions(id,user_id) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claims',jsonb_build_object('sub','10000000-0000-4000-8000-000000000001',
 'role','authenticated','exp',extract(epoch from now()+interval '1 hour'),'session_id','20000000-0000-4000-8000-000000000001')::text,true);
select pg_temp.assert_true((public.get_my_dataset_revisions_v1(array['ph_soc_master'])->>'contractVersion')::int=1,'snapshot version');
select pg_temp.assert_true(public.get_my_dataset_revisions_v1(array['ph_soc_master'])->'sources'->0->>'state'='ready','fresh source');
select pg_temp.assert_true(jsonb_typeof(public.get_my_dataset_revisions_v1(array['ph_soc_master'])->'sources'->0->'revision')='string','bigint string');
select pg_temp.assert_true(public.get_my_dataset_revisions_v1(array['tx_soc_master'])->'sources'->0->>'state'='unavailable','dormant site not enabled');
select pg_temp.assert_true(public.get_my_dataset_revisions_v1(array['ph_crop_roll_rows'])->'sources'->0->>'state'='unavailable','missing source explicit');
select pg_temp.expect_error($q$select public.get_my_dataset_revisions_v1(array['unregistered'])$q$,'DATASET_KEYS_INVALID');
select pg_temp.assert_true(jsonb_array_length(public.get_my_dataset_revisions_v1(array_fill('ph_soc_master'::text,array[65]))->'sources')=1,'dedupe precedes cap');
select pg_temp.expect_error($q$select public.get_my_dataset_revisions_v1(array(select key from app_sync_private.sources order by key limit 65))$q$,'DATASET_KEYS_INVALID');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.ph_soc_master','UPDATE'),'no source update grant');
select pg_temp.assert_true(not has_table_privilege('anon','public.app_dataset_revisions','SELECT'),'no anonymous metadata');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.begin_dataset_import_v1(text[],uuid,text[])','EXECUTE'),'no customer import fence');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.app_dataset_revisions','UPDATE'),'no customer revision write');

-- A file emits begin + finish, not a notification for each imported row/chunk.
select public.begin_dataset_import_v1(array['ph_soc_master'],'30000000-0000-4000-8000-000000000001');
create temp table expected_revision as select revision from public.app_dataset_revisions where key='ph_soc_master';
select set_config('request.headers','{"x-gnc-import-run-id":"30000000-0000-4000-8000-000000000001"}',true);
insert into public.ph_soc_master(unique_id,dock,quantityordered) select 'synthetic-'||i,'Dock 29',i from generate_series(1,2000) i;
update public.ph_soc_master set quantityordered=quantityordered+1;
delete from public.ph_soc_master where quantityordered>1995;
select pg_temp.assert_true((select revision from public.app_dataset_revisions where key='ph_soc_master')=(select revision from expected_revision),'batch changes coalesced');
select pg_temp.assert_true(public.get_my_dataset_revisions_v1(array['ph_soc_master'])->'sources'->0->>'state'='importing','not a complete snapshot mid-import');
select public.heartbeat_dataset_import_v1('30000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select revision from public.app_dataset_revisions where key='ph_soc_master')=(select revision from expected_revision),'heartbeat is private');
select public.finish_dataset_import_v1('30000000-0000-4000-8000-000000000001');
select public.finish_dataset_import_v1('30000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select revision from public.app_dataset_revisions where key='ph_soc_master')=(select revision+1 from expected_revision),'finish replay does not republish');
select pg_temp.expect_error($q$update public.ph_soc_master set quantityordered=0$q$,'DATASET_IMPORT_FENCE_LOST');
select set_config('request.headers','{}',true);
select set_config('app_sync.touched','{}',true);
update public.ph_soc_master set quantityordered=quantityordered+1;
update public.ph_soc_master set quantityordered=quantityordered+1;
select pg_temp.assert_true((select revision from public.app_dataset_revisions where key='ph_soc_master')=(select revision+2 from expected_revision),'ordinary multi-statement transaction publishes once');

select public.begin_dataset_import_v1(array['ph_soc_master'],'30000000-0000-4000-8000-000000000002');
select pg_temp.expect_error($q$select public.begin_dataset_import_v1(array['ph_soc_master'],'30000000-0000-4000-8000-000000000003')$q$,'DATASET_IMPORT_BUSY');
select public.fail_dataset_import_v1('30000000-0000-4000-8000-000000000002');
select pg_temp.assert_true(public.get_my_dataset_revisions_v1(array['ph_soc_master'])->'sources'->0->>'state'='interrupted','failed import not current');
select public.begin_dataset_import_v1(array['ph_soc_master'],'30000000-0000-4000-8000-000000000003');
update app_sync_private.import_runs set expires_at=now()-interval '1 minute' where id='30000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(public.get_my_dataset_revisions_v1(array['ph_soc_master'])->'sources'->0->>'state'='interrupted','expired lease cannot claim freshness');
select pg_temp.expect_error($q$select public.finish_dataset_import_v1('30000000-0000-4000-8000-000000000003')$q$,'DATASET_IMPORT_EXPIRED');
select public.begin_dataset_import_v1(array['ph_soc_master'],'30000000-0000-4000-8000-000000000004');
select public.finish_dataset_import_v1('30000000-0000-4000-8000-000000000004');

-- Completion, deletion and TRUNCATE invalidate even without last_updated edits.
select set_config('app_sync.touched','{}',true);
update expected_revision set revision=(select revision from public.app_dataset_revisions where key='ph_soc_master');
update public.ph_soc_master set date_completed=clock_timestamp() where unique_id='synthetic-1';
select pg_temp.assert_true((select revision from public.app_dataset_revisions where key='ph_soc_master')=(select revision+1 from expected_revision),'completion invalidates');
select set_config('app_sync.touched','{}',true);
truncate public.ph_soc_master;
select pg_temp.assert_true((select revision from public.app_dataset_revisions where key='ph_soc_master')=(select revision+2 from expected_revision),'empty/pruned source invalidates');

-- A failed Master root cannot be falsely recovered by a CAV import whose
-- reconciliation merely writes some Master evidence columns.
select public.begin_dataset_import_v1(array['ph_master_inventory'],'40000000-0000-4000-8000-000000000001',array['ph_master_inventory']);
select public.fail_dataset_import_v1('40000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((public.get_dataset_import_status_v1(array['ph_master_inventory'])->>'requiresRecovery')::boolean,'zero-delta replay sees interrupted fence');
select pg_temp.expect_error($q$select public.begin_dataset_import_v1(array['ph_cav_import','ph_master_inventory'],
 '40000000-0000-4000-8000-000000000002',array['ph_cav_import'])$q$,'DATASET_RECOVERY_REQUIRES_CANONICAL_SOURCE');
select public.begin_dataset_import_v1(array['ph_master_inventory'],'40000000-0000-4000-8000-000000000003',array['ph_master_inventory']);
select public.finish_dataset_import_v1('40000000-0000-4000-8000-000000000003');
select pg_temp.assert_true(not (public.get_dataset_import_status_v1(array['ph_master_inventory'])->>'requiresRecovery')::boolean,'validated zero-delta canonical retry recovers');

-- Module, same-JWT membership changes, Dylan-only data, and revocation.
select set_config('request.jwt.claims',jsonb_build_object('sub','10000000-0000-4000-8000-000000000002',
 'role','authenticated','exp',extract(epoch from now()+interval '1 hour'),'session_id','20000000-0000-4000-8000-000000000002')::text,true);
select pg_temp.assert_true(public.get_my_dataset_revisions_v1(array['bloomscapes_private.orders'])->'sources'->0->>'state'='unavailable','pending stays Dylan-only');
insert into private.fixture_permissions(profile_id,module) values ('10000000-0000-4000-8000-000000000002','request');
select pg_temp.assert_true(app_sync_private.can_read_source('ph_location_work_jobs'),'assigned staff location-work metadata is not Dylan-only');
select pg_temp.assert_true(app_sync_private.can_read_source('ph_eval_work'),'Request queue can refresh its existing Eval Work dependency');
select pg_temp.assert_true(app_sync_private.can_read_source('ph_shear_list'),'Request queue can refresh its existing Shear dependency');
update private.fixture_permissions set allowed=false where profile_id='10000000-0000-4000-8000-000000000002';
select pg_temp.assert_true(public.get_my_dataset_revisions_v1(array['ph_soc_master'])->'sources'->0->>'state'='unavailable','role changes checked with same JWT');
delete from auth.sessions where id='20000000-0000-4000-8000-000000000002';
select pg_temp.expect_error($q$select public.get_my_dataset_revisions_v1(array['ph_soc_master'])$q$,'DATASET_SESSION_REQUIRED');
rollback;
