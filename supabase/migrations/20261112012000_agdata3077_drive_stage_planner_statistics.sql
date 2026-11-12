begin;
set local statement_timeout = '120s';
set local lock_timeout = '15s';

-- PostgreSQL omits whole-value statistics for the wide field-key arrays even
-- when their compressed size is small. The existing distinct cohort table
-- proves their actual cardinality without rescanning wide inventory rows.
create function private.refresh_drive_stage_cohort_statistics_v3077()
returns void language plpgsql set search_path = '' as $refresh$
declare groups integer;
begin
  select count(distinct field_keys) into groups from pg_temp.ph_master_bulk_tuples_v3046;
  execute format('alter table pg_temp.ph_master_bulk_stage_v1 alter column field_keys set(n_distinct=%s)',groups);
  analyze pg_temp.ph_master_bulk_stage_v1 (row_number,unique_id,lineage_key,raw_item6_fields,field_keys);
end
$refresh$;
revoke all on function private.refresh_drive_stage_cohort_statistics_v3077() from public,anon,authenticated,service_role;

-- Run statistics only after the canonical typed rows and distinct cohorts
-- exist. Every mutation, raw comparison, shield and receipt stays unchanged.
do $statistics$
declare definition text:=pg_get_functiondef('private.prepare_master_bulk_stage_v3046(jsonb)'::regprocedure);
  prior text:='  analyze pg_temp.ph_master_bulk_stage_v1 (row_number);';
  tuples text:='  from pg_temp.ph_master_bulk_stage_v1 s;';
begin
  if cardinality(string_to_array(definition,prior))<>2 or cardinality(string_to_array(definition,tuples))<>2 then
    raise exception 'ERP_DRIVE_STATISTICS_OWNER_CHANGED';
  end if;
  definition:=replace(definition,prior,'');
  execute replace(definition,tuples,tuples||chr(10)||'  perform private.refresh_drive_stage_cohort_statistics_v3077();');
end
$statistics$;
commit;
