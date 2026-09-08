-- Disposable fixture only: the entire test transaction is rolled back.
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
create temp table empty_expected_revision as select revision,changed_at from public.app_dataset_revisions where key='ph_soc_master';
select set_config('request.headers','{}',true);
select set_config('app_sync.touched','{}',true);
insert into public.ph_soc_master(unique_id) select 'empty-insert' where false;
update public.ph_soc_master set dock='No matching row' where unique_id='missing';
delete from public.ph_soc_master where unique_id='missing';
select pg_temp.assert_true((select (revision,changed_at) from public.app_dataset_revisions where key='ph_soc_master')=
 (select (revision,changed_at) from empty_expected_revision),'empty insert/update/delete preserve revision and timestamp');
select pg_temp.assert_true(not (current_setting('app_sync.touched')::jsonb ? 'ph_soc_master'),'empty statements do not consume transaction touch');

-- Empty before real, same transaction: a real write still publishes once.
insert into public.ph_soc_master(unique_id,dock,quantityordered) values ('real-fixture','Dock 29',3);
select pg_temp.assert_true((select revision from public.app_dataset_revisions where key='ph_soc_master')=
 (select revision+1 from empty_expected_revision),'real insert after empty advances');
update public.ph_soc_master set quantityordered=4 where unique_id='real-fixture';
select pg_temp.assert_true((select revision from public.app_dataset_revisions where key='ph_soc_master')=
 (select revision+1 from empty_expected_revision),'real writes still coalesce by source and transaction');

-- Simulate a new committed source transaction in this rollback-only harness.
select set_config('app_sync.touched','{}',true);
update empty_expected_revision set revision=(select revision from public.app_dataset_revisions where key='ph_soc_master'),
 changed_at=(select changed_at from public.app_dataset_revisions where key='ph_soc_master');
insert into public.ph_soc_master(unique_id,quantityordered) values ('real-fixture',9) on conflict(unique_id) do nothing;
select pg_temp.assert_true((select (revision,changed_at) from public.app_dataset_revisions where key='ph_soc_master')=
 (select (revision,changed_at) from empty_expected_revision),'conflict do nothing does not advance');
insert into public.ph_soc_master(unique_id,quantityordered) values ('real-fixture',9)
 on conflict(unique_id) do update set quantityordered=excluded.quantityordered;
select pg_temp.assert_true((select revision from public.app_dataset_revisions where key='ph_soc_master')=
 (select revision+1 from empty_expected_revision),'upsert update emits once despite separate event triggers');
select set_config('app_sync.touched','{}',true);
update public.ph_soc_master set quantityordered=quantityordered where unique_id='real-fixture';
select pg_temp.assert_true((select revision from public.app_dataset_revisions where key='ph_soc_master')=
 (select revision+2 from empty_expected_revision),'same-value UPDATE touching existing rows still advances');
select set_config('app_sync.touched','{}',true);
delete from public.ph_soc_master where unique_id='real-fixture';
select pg_temp.assert_true((select revision from public.app_dataset_revisions where key='ph_soc_master')=
 (select revision+3 from empty_expected_revision),'real deletion advances');
select set_config('app_sync.touched','{}',true);
truncate public.ph_soc_master;
select pg_temp.assert_true((select revision from public.app_dataset_revisions where key='ph_soc_master')=
 (select revision+4 from empty_expected_revision),'empty TRUNCATE preserves invalidation');

-- Rollbacks restore both source rows and revision; no false committed signal.
select set_config('app_sync.touched','{}',true);
update empty_expected_revision set revision=(select revision from public.app_dataset_revisions where key='ph_soc_master');
select pg_temp.expect_error($q$do $body$ begin
 insert into public.ph_soc_master(unique_id) values('rolled-back');
 raise exception 'ROLLBACK_FIXTURE'; end $body$$q$,'ROLLBACK_FIXTURE');
select pg_temp.assert_true(not exists(select 1 from public.ph_soc_master where unique_id='rolled-back') and
 (select revision from public.app_dataset_revisions where key='ph_soc_master')=(select revision from empty_expected_revision),'rollback preserves revision and source');

-- A real source row trigger can write a differently shaped registered table.
-- Reused transition names must resolve to each firing statement's own rows,
-- and many nested statements still invalidate each source only once.
create function pg_temp.fixture_derived_inventory() returns trigger language plpgsql as $$
begin
  insert into public.ph_master_inventory(unique_id,ptronhand) values(new.unique_id,new.quantityordered)
    on conflict(unique_id) do update set ptronhand=excluded.ptronhand;
  return new;
end $$;
create trigger fixture_derived_inventory after insert or update on public.ph_soc_master
 for each row execute function pg_temp.fixture_derived_inventory();
create temp table derived_expected_revisions as select key,revision from public.app_dataset_revisions
 where key in ('ph_soc_master','ph_master_inventory');
select set_config('app_sync.touched','{}',true);
insert into public.ph_soc_master(unique_id,quantityordered) values('derived-one',11),('derived-two',12);
select pg_temp.assert_true((select count(*) from public.ph_master_inventory where unique_id in ('derived-one','derived-two') and ptronhand in (11,12))=2,'nested derived writes execute against a different row shape');
select pg_temp.assert_true((select count(*) from public.app_dataset_revisions r join derived_expected_revisions e using(key)
 where r.revision=e.revision+1)=2,'nested row writes coalesce to one revision for each of two sources');
select set_config('app_sync.touched','{}',true);
update public.ph_soc_master set quantityordered=quantityordered+1 where unique_id in ('derived-one','derived-two');
select pg_temp.assert_true((select count(*) from public.app_dataset_revisions r join derived_expected_revisions e using(key)
 where r.revision=e.revision+2)=2,'nested upsert updates reuse transition relations correctly');
drop trigger fixture_derived_inventory on public.ph_soc_master;

-- Empty commands are not a bypass for invalid, closed, expired or lost leases.
-- The touched marker is deliberately already set to exercise the fast path.
select set_config('app_sync.touched','{"ph_soc_master":true}',true);
select set_config('request.headers','{"x-gnc-import-run-id":"50000000-0000-4000-8000-000000000099"}',true);
select pg_temp.expect_error($q$insert into public.ph_soc_master(unique_id) select 'none' where false$q$,'DATASET_IMPORT_TOKEN_INVALID');
select pg_temp.expect_error($q$update public.ph_soc_master set dock='none' where false$q$,'DATASET_IMPORT_TOKEN_INVALID');
select pg_temp.expect_error($q$delete from public.ph_soc_master where false$q$,'DATASET_IMPORT_TOKEN_INVALID');
select set_config('request.headers','{}',true);
select public.begin_dataset_import_v1(array['ph_soc_master'],'50000000-0000-4000-8000-000000000001');
select public.finish_dataset_import_v1('50000000-0000-4000-8000-000000000001');
select set_config('app_sync.touched','{"ph_soc_master":true}',true);
select set_config('request.headers','{"x-gnc-import-run-id":"50000000-0000-4000-8000-000000000001"}',true);
select pg_temp.expect_error($q$insert into public.ph_soc_master(unique_id) select 'none' where false$q$,'DATASET_IMPORT_FENCE_LOST');
select pg_temp.expect_error($q$update public.ph_soc_master set dock='none' where false$q$,'DATASET_IMPORT_FENCE_LOST');
select pg_temp.expect_error($q$delete from public.ph_soc_master where false$q$,'DATASET_IMPORT_FENCE_LOST');
select set_config('request.headers','{}',true);
select public.begin_dataset_import_v1(array['ph_soc_master'],'50000000-0000-4000-8000-000000000002');
update app_sync_private.import_runs set expires_at=clock_timestamp()-interval '1 minute' where id='50000000-0000-4000-8000-000000000002';
select set_config('request.headers','{"x-gnc-import-run-id":"50000000-0000-4000-8000-000000000002"}',true);
select pg_temp.expect_error($q$update public.ph_soc_master set dock='none' where false$q$,'DATASET_IMPORT_FENCE_LOST');
select set_config('request.headers','{}',true);
select public.begin_dataset_import_v1(array['ph_soc_master'],'50000000-0000-4000-8000-000000000003');
select set_config('request.headers','{"x-gnc-import-run-id":"50000000-0000-4000-8000-000000000002"}',true);
select pg_temp.expect_error($q$delete from public.ph_soc_master where false$q$,'DATASET_IMPORT_FENCE_LOST');
select set_config('request.headers','{"x-gnc-import-run-id":"50000000-0000-4000-8000-000000000003"}',true);
delete from app_sync_private.import_leases where key='ph_soc_master';
select pg_temp.expect_error($q$insert into public.ph_soc_master(unique_id) select 'none' where false$q$,'DATASET_IMPORT_FENCE_LOST');

select pg_temp.assert_true((select count(*) from pg_trigger where tgrelid='public.ph_soc_master'::regclass
 and tgname in ('app_dataset_revision_inserted','app_dataset_revision_updated','app_dataset_revision_deleted','app_dataset_revision_truncated'))=4,'four event-specific statement triggers');
select pg_temp.assert_true(not exists(select 1 from pg_trigger where tgname='app_dataset_revision_changed'),'obsolete broad trigger removed');
select pg_temp.assert_true(not has_function_privilege('authenticated','app_sync_private.touch_source()','EXECUTE'),'replacement trigger retains private permissions');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.ph_soc_master','UPDATE'),'no business grants added');
rollback;
