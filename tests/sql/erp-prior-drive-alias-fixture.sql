-- Isolated PG17 rollback fixture. The no-alias check deliberately precedes
-- the creation of a stage, so an unnecessary stage lookup fails the test.
delete from app_sync_private.ph_master_bulk_import_source_v1 where source_unique_id<>canonical_unique_id;
do $empty$
begin
  assert to_regclass('pg_temp.ph_master_bulk_stage_v1') is null;
  assert not exists(select 1 from private.prior_drive_source_aliases_v3046());
end
$empty$;
create temp table ph_master_bulk_stage_v1(row_number bigint primary key,unique_id text unique,lineage_key text not null);
insert into ph_master_bulk_stage_v1 values
  (1,'hist-source-one','l1'),(2,'hist-source-ambiguous','l2'),(3,'hist-source-wrong','l3'),
  (4,'hist-source-already-live','l4'),(5,'hist-source-target-staged','l5'),(6,'hist-target-also-staged','l6'),
  (7,'hist-source-missing-live','l7'),(8,'hist-source-single-eligible','l8');
create temp table historical_pairs(source_uid text,canonical_uid text primary key,lineage text,live boolean);
insert into historical_pairs values
  ('hist-source-one','hist-c1','l1',true),
  ('hist-source-ambiguous','hist-c2a','l2',true),('hist-source-ambiguous','hist-c2b','l2',true),
  ('hist-source-wrong','hist-c3','different-lineage',true),
  ('hist-source-already-live','hist-c4','l4',true),
  ('hist-source-target-staged','hist-target-also-staged','l5',true),
  ('hist-source-missing-live','hist-c7','l7',false),
  ('hist-source-single-eligible','hist-c8a','l8',true),('hist-source-single-eligible','hist-c8b','old-lineage',true),
  ('hist-source-already-live','hist-source-already-live','l4',true);
insert into public.ph_master_inventory(unique_id,itemcode,commonname,locationcode,lotcode,source,ptronhand)
  select canonical_uid,'HIST-FIXTURE','Fixture','X.92.001','26.F1','PH','5' from historical_pairs where live;
insert into app_sync_private.ph_master_bulk_import_source_v1(canonical_unique_id,source_unique_id,source_hash,import_run_id)
  select canonical_uid,source_uid,repeat('a',64),'e3078000-0000-4000-8000-000000000535' from historical_pairs;
insert into app_sync_private.ph_master_inventory_source_baselines(canonical_unique_id,lineage_key)
  select canonical_uid,lineage from historical_pairs;
create temp table expected_historical_aliases(row_number bigint,canonical_unique_id text);
insert into expected_historical_aliases values (1,'hist-c1'),(8,'hist-c8a');
create temp table got_historical_aliases as select * from private.prior_drive_source_aliases_v3046();
do $identity$
begin
  assert not exists((select * from got_historical_aliases except all select * from expected_historical_aliases)
    union all (select * from expected_historical_aliases except all select * from got_historical_aliases)),
    'alias resolution must retain exact lineage, source/target ownership, live membership and ambiguity';
  assert not has_function_privilege('anon','private.prior_drive_source_aliases_v3046()','EXECUTE');
  assert not has_function_privilege('authenticated','private.prior_drive_source_aliases_v3046()','EXECUTE');
  assert not has_function_privilege('service_role','private.prior_drive_source_aliases_v3046()','EXECUTE');
end
$identity$;

-- Exercise the same exclusions with dense history. The additional prior
-- aliases are deliberately stale and have no input or canonical-master row.
insert into app_sync_private.ph_master_bulk_import_source_v1(canonical_unique_id,source_unique_id,source_hash,import_run_id)
  select 'hist-stale-c-'||n,'hist-stale-s-'||n,repeat('b',64),'e3078000-0000-4000-8000-000000000535'
  from generate_series(1,65) n;
create temp table got_dense_aliases as select * from private.prior_drive_source_aliases_v3046();
do $dense$
declare previous text:=current_setting('enable_nestloop');
begin
  assert not exists((select * from got_dense_aliases except all select * from expected_historical_aliases)
    union all (select * from expected_historical_aliases except all select * from got_dense_aliases));
  perform set_config('enable_nestloop','on',true);
  perform 1 from private.prior_drive_source_aliases_v3046();
  assert current_setting('enable_nestloop')='on';
  alter table pg_temp.ph_master_bulk_stage_v1 rename to alias_fixture_held_stage;
  begin
    perform 1 from private.prior_drive_source_aliases_v3046();
    raise exception 'missing nonempty stage was silently accepted';
  exception when undefined_table then null; end;
  assert current_setting('enable_nestloop')='on','a failed alias lookup must restore its caller configuration';
  alter table pg_temp.alias_fixture_held_stage rename to ph_master_bulk_stage_v1;
  perform set_config('enable_nestloop',previous,true);
end
$dense$;
