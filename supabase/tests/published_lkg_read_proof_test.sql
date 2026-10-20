-- @test-runtime: canonical
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(16);

insert into app_sync_private.import_runs(id,source_keys,canonical_keys,state,expires_at,created_at,finished_at)
values
  ('f2315000-0000-4000-8000-000000000001','{ph_master_inventory}','{ph_master_inventory}','completed',now()+interval '1 day',now()-interval '3 hours',now()-interval '3 hours'),
  ('f2315000-0000-4000-8000-000000000002','{ph_master_inventory}','{ph_master_inventory}','failed',now()-interval '2 hours',now()-interval '90 minutes',now()-interval '89 minutes'),
  ('f2315000-0000-4000-8000-000000000003','{ph_master_inventory}','{ph_master_inventory}','failed',now()-interval '1 minute',now()-interval '1 minute',now()-interval '30 seconds');

insert into app_sync_private.ph_master_snapshot_stage_v1(
  request_id,run_id,source_manifest,source_manifest_digest,source_digest,
  expected_rows,expected_chunks,payload_hash,status,publication_run_id,published_response,updated_at
) values
  ('f2315000-0000-4000-8000-000000000011','f2315000-0000-4000-8000-000000000001','{}',repeat('a',64),repeat('b',64),1,1,repeat('c',64),'published','f2315000-0000-4000-8000-000000000001','{"published":true}',now()-interval '2 hours'),
  ('f2315000-0000-4000-8000-000000000013','f2315000-0000-4000-8000-000000000003','{}',repeat('d',64),repeat('e',64),1,1,repeat('f',64),'staging',null,null,now()-interval '1 minute');

select is((app_sync_private.published_snapshot_read_proof('ph_master_inventory',8293)->>'publishedReadable')::boolean,true,
  'failed canonical stage with a prior completed publication keeps the last complete snapshot readable');
select is(split_part(app_sync_private.published_snapshot_read_proof('ph_master_inventory',8293)->>'publishedRevision',':',1),'8293',
  'published cache token is bound to the current interrupted revision');
select is(split_part(app_sync_private.published_snapshot_read_proof('ph_master_inventory',8293)->>'publishedRevision',':',2),
  'f2315000-0000-4000-8000-000000000001','published cache token identifies the completed publication');
select ok(((app_sync_private.published_snapshot_read_proof('ph_master_inventory',8293)->>'publishedAt')::timestamptz)
  = now()-interval '2 hours','proof carries the original publication timestamp');
select ok(app_sync_private.published_snapshot_read_proof('ph_master_inventory',8293)->>'publishedRevision' like '8293:%:'||repeat('b',64),
  'published cache token includes the published source digest');
select is((app_sync_private.published_snapshot_read_proof('ph_master_inventory',8293)->>'mutationAllowed')::boolean,true,
  'a terminal failed canonical stage may use the revision-locked Reclass path');
update public.app_dataset_revisions set revision=8293,state='interrupted' where key='ph_master_inventory';
select throws_ok($$update public.ph_master_inventory set itemcode=itemcode
  where unique_id=(select min(unique_id) from public.ph_master_inventory)$$, '55000',
  'MASTER_SNAPSHOT_NOT_READY',
  'interrupted-state direct inventory writes stay blocked without private Reclass context');
select is(private.lock_ph_master_inventory_for_reclass_lkg_v1(),8293::bigint,
  'Reclass lock accepts the exact interrupted revision only with terminal canonical proof');

update app_sync_private.import_runs set state='active',expires_at=now()+interval '10 minutes'
where id='f2315000-0000-4000-8000-000000000003';
insert into app_sync_private.import_leases(key,run_id) values('ph_master_inventory','f2315000-0000-4000-8000-000000000003');
update public.app_dataset_revisions set state='importing' where key='ph_master_inventory';
select is((app_sync_private.published_snapshot_read_proof('ph_master_inventory',8293)->>'publishedReadable')::boolean,true,
  'an active atomic import still exposes the complete prior snapshot for reads');
select is((app_sync_private.published_snapshot_read_proof('ph_master_inventory',8293)->>'mutationAllowed')::boolean,false,
  'an active import never receives mutation permission');
select throws_ok('select private.lock_ph_master_inventory_for_reclass_lkg_v1()', '40001',
  'RECLASS_V6_INVENTORY_REFRESH_REQUIRED','Reclass remains fenced during an active import');

delete from app_sync_private.import_leases where key='ph_master_inventory';
update app_sync_private.import_runs set state='failed',finished_at=now(),expires_at=now()-interval '1 minute'
where id='f2315000-0000-4000-8000-000000000003';
update public.app_dataset_revisions set state='interrupted' where key='ph_master_inventory';
insert into app_sync_private.import_runs(id,source_keys,canonical_keys,state,expires_at,created_at,finished_at)
values('f2315000-0000-4000-8000-000000000004','{ph_master_inventory}','{}','failed',now()-interval '1 minute',now()-interval '30 seconds',now());
select is(app_sync_private.published_snapshot_read_proof('ph_master_inventory',8293),null,
  'an unresolved direct-write failure blocks LKG reads and Reclass mutation');
select throws_ok('select private.lock_ph_master_inventory_for_reclass_lkg_v1()', '40001',
  'RECLASS_V6_INVENTORY_REFRESH_REQUIRED','Reclass rejects an unproven direct-write failure');

select is(app_sync_private.published_snapshot_read_proof('ph_soc_master',255),null,
  'source without a matching completed canonical snapshot receives no LKG proof');
select ok(not has_function_privilege('anon','app_sync_private.published_snapshot_read_proof(text,bigint)','EXECUTE'),
  'anonymous role cannot call the internal LKG proof helper');
select ok(not has_function_privilege('authenticated','app_sync_private.published_snapshot_read_proof(text,bigint)','EXECUTE'),
  'authenticated role cannot call the internal LKG proof helper directly');

select * from finish();
rollback;
