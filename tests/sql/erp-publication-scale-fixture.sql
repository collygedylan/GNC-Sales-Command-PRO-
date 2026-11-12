-- Run in a disposable PostgreSQL 17 database with the ERP migrations installed.
-- Its caller owns BEGIN/ROLLBACK; every operational write is rolled back.
set local client_min_messages = warning;
set local statement_timeout = '60s';
set local track_functions = 'all';
select set_config('request.jwt.claim.role','service_role',true);

create temp table erp77_scale_rows as
select jsonb_agg(private.normalize_drive_erp_row_v3042(jsonb_build_object(
  'unique_id','erp77-'||n,'itemcode','ERP77-'||n,'locationcode','X.01.001','lotcode','28.F1',
  'source','PH','warehousei','MC','plantgroupcode','135','commonname','Fixture plant '||n,
  'contsize','#2','ptronhand','100','ptrreviewed','2','ptravailable','98',
  'priority','1','holdstopcode',null,'holdstopreason',null,'salesnote',repeat('x',500)
),'ERP77-scale.xlsx')) payload from generate_series(1,9610) n;

select public.begin_dataset_import_v1(array['ph_master_inventory'],
  'e3077000-0000-4000-8000-000000000011',array['ph_master_inventory'])->>'state';
select set_config('request.headers','{"x-gnc-import-run-id":"e3077000-0000-4000-8000-000000000011"}',true);
select public.bulk_import_master_snapshot_v1('e3077000-0000-4000-8000-000000000011',
  'e3077000-0000-4000-8000-000000000012',payload,repeat('a',64)) from erp77_scale_rows;
select public.finish_dataset_import_v1('e3077000-0000-4000-8000-000000000011')->>'state';

select public.begin_dataset_import_v1(array['ph_master_inventory'],
  'e3077000-0000-4000-8000-000000000013',array['ph_master_inventory'])->>'state';
select set_config('request.headers','{"x-gnc-import-run-id":"e3077000-0000-4000-8000-000000000013"}',true);
update erp77_scale_rows set payload=(select jsonb_agg(
  jsonb_set(jsonb_set(e.value,'{values,ptronhand}','"101"'),'{values,ptravailable}','"99"')
) from jsonb_array_elements(payload) e(value));

create temp table erp77_scale_timing(started timestamptz);
insert into erp77_scale_timing values(clock_timestamp());
select public.bulk_import_master_snapshot_v1('e3077000-0000-4000-8000-000000000013',
  'e3077000-0000-4000-8000-000000000014',payload,repeat('b',64)) from erp77_scale_rows;
select extract(epoch from(clock_timestamp()-started))*1000 as changed_9610_update_ms from erp77_scale_timing;
select json_agg(profile) from (
  select funcid::regprocedure::text as function,calls,total_time,self_time
  from pg_stat_xact_user_functions where calls>0 order by self_time desc limit 12
) profile;
