-- Run after installing the migration inside a rolled-back local transaction.
create temporary table master_provenance_fixture (
  unique_id text primary key, erp_on_hand numeric, erp_ptrreview numeric, erp_available numeric,
  filename text, erp_source_filename text, erp_source_present boolean, spec text, photo_link text
);
create temporary table ph_master_bulk_stage_v1 (row_number bigint, raw_values jsonb, filename text);
create temporary table ph_master_bulk_map_v1 (row_number bigint, canonical_unique_id text);
insert into master_provenance_fixture values
  ('unchanged',10,2,8,'original.xlsx','original.xlsx',true,'keep spec','https://fixture/one.jpg'),
  ('delta',4,0,4,'original.xlsx','original.xlsx',true,'keep spec','https://fixture/two.jpg'),
  ('retained',7,0,7,'original.xlsx','original.xlsx',false,'keep spec','https://fixture/three.jpg'),
  ('absent',3,0,3,'original.xlsx','original.xlsx',true,'keep spec','https://fixture/four.jpg');
insert into ph_master_bulk_stage_v1 values
  (1,'{"ptronhand":"10","ptrreviewed":"2","ptravailable":"8","filename":"next.xlsx"}','next.xlsx'),
  (2,'{"ptronhand":"11","ptrreviewed":"2","ptravailable":"9","filename":"next.xlsx"}','next.xlsx');
insert into ph_master_bulk_map_v1 values (1,'unchanged'),(2,'delta');
create temporary table original_provenance_locations as
select unique_id,ctid as physical_location from master_provenance_fixture;

-- Rebind only the production relation to the isolated four-row table.
do $test$
declare
  definition text := pg_get_functiondef('private.apply_erp_master_provenance_v3042()'::regprocedure);
  changed integer;
begin
  execute replace(definition,'public.ph_master_inventory','pg_temp.master_provenance_fixture');
  perform private.apply_erp_master_provenance_v3042();
  select count(*) into changed from master_provenance_fixture where filename='next.xlsx';
  if changed<>1 or not exists (select 1 from master_provenance_fixture where unique_id='delta' and erp_on_hand=11)
    or not exists (select 1 from master_provenance_fixture where unique_id='absent' and not erp_source_present)
    or exists (select 1 from master_provenance_fixture where spec<>'keep spec' or photo_link is null)
    or exists (select 1 from master_provenance_fixture row
      join original_provenance_locations original using(unique_id)
      where row.unique_id in ('unchanged','retained') and row.ctid<>original.physical_location)
    then raise exception 'ERP_DELTA_PROVENANCE_FIXTURE_FAILED'; end if;
end
$test$;

create temporary table soc_history_calls (source_uid text);
create or replace function private.refresh_soc_order_history_v2366(p_unique_id text default null)
returns integer language plpgsql set search_path='' as $fixture$
begin
  if p_unique_id='broken' then raise exception 'fixture failure' using errcode='55P03'; end if;
  insert into pg_temp.soc_history_calls values(p_unique_id);
  return 1;
end
$fixture$;

insert into private.erp_soc_history_jobs_v3046(source_uid,attempts) values ('exact',0),('broken',2);
do $test$
begin
  if private.drain_erp_soc_history_v3046()<>1 then raise exception 'ERP_EXACT_HISTORY_DRAIN_FAILED'; end if;
  if (select array_agg(source_uid order by source_uid) from soc_history_calls) is distinct from array['exact']
    or not exists (select 1 from private.erp_soc_history_jobs_v3046 where source_uid='broken'
      and attempts=3 and last_sqlstate='55P03' and next_attempt_at>clock_timestamp())
    or private.drain_erp_soc_history_v3046()<>0 then
    raise exception 'ERP_EXACT_HISTORY_RETRY_FIXTURE_FAILED';
  end if;
end
$test$;
