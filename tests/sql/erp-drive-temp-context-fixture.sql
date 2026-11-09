-- The temp view shares the immutable raw stage without changing exact lookup.
select private.prepare_master_bulk_stage_v3046(
  '[{"values":{"unique_id":"raw-a","itemcode":"TEMP-CONTEXT-A","locationcode":"L.05.000","lotcode":"28.F1","locationnote":"exact raw A"},"rawFields":["locationnote"]},
    {"values":{"unique_id":"raw-b","itemcode":"TEMP-CONTEXT-B","locationcode":"L.05.000","lotcode":"27.F1","locationnote":"exact raw B"},"rawFields":["locationnote"]}]'
);
create temporary table ph_master_bulk_map_v1 (row_number bigint,source_unique_id text,canonical_unique_id text);
insert into ph_master_bulk_map_v1 values (1,'raw-a','canonical-a'),(2,'raw-b',null);
select private.open_master_bulk_temp_context_v3046(
  'a3046000-0000-4000-8000-000000000050','a3046000-0000-4000-8000-000000000051');

do $test$
declare
  run_key uuid := 'a3046000-0000-4000-8000-000000000050';
  request_key uuid := 'a3046000-0000-4000-8000-000000000051';
  evidence app_sync_private.ph_master_bulk_import_context_v1;
begin
  if not private.has_master_bulk_context_v3046(run_key,request_key)
    or private.has_master_bulk_context_v3046(run_key,'a3046000-0000-4000-8000-000000000052') then
    raise exception 'ERP_TEMP_CONTEXT_REQUEST_WITNESS';
  end if;
  evidence:=private.ph_master_bulk_context_v1(run_key,'canonical-a');
  if evidence.raw_values->>'locationnote' is distinct from 'exact raw A'
    or evidence.raw_item6_fields is distinct from array['locationnote']
    or evidence.source_unique_id is distinct from 'raw-a'
    or evidence.backend_pid is distinct from pg_backend_pid()
    or evidence.transaction_id is distinct from txid_current() then
    raise exception 'ERP_TEMP_CONTEXT_CANONICAL_LOOKUP';
  end if;
  update ph_master_bulk_map_v1 set canonical_unique_id='later-map' where row_number=1;
  evidence:=private.ph_master_bulk_context_v1(run_key,'raw-a');
  if evidence.canonical_unique_id is distinct from 'canonical-a'
    or (private.ph_master_bulk_context_v1(run_key,'later-map')).source_unique_id is not null then
    raise exception 'ERP_TEMP_CONTEXT_MAP_WAS_NOT_FROZEN';
  end if;
  if exists(select 1 from app_sync_private.ph_master_bulk_import_context_v1 c where c.run_id=run_key) then
    raise exception 'ERP_TEMP_CONTEXT_WROTE_LOGGED_ROWS';
  end if;
end
$test$;

drop view pg_temp.ph_master_bulk_context_v3046;
drop table pg_temp.ph_master_bulk_context_keys_v3046;
insert into app_sync_private.ph_master_bulk_import_context_v1(run_id,request_id,backend_pid,transaction_id,
  source_unique_id,canonical_unique_id,raw_values,raw_item6_fields,source_hash,new_insert_verified)
values ('a3046000-0000-4000-8000-000000000050','a3046000-0000-4000-8000-000000000051',pg_backend_pid(),txid_current(),
  'legacy-source','legacy-canonical','{"locationnote":"legacy raw"}',array['locationnote'],repeat('a',64),true);

set local role service_role;
create temp view ph_master_bulk_context_v3046 as select 'caller-owned'::text as source_unique_id;
select set_config('agdata.erp.master_bulk_context_v3046',concat_ws(':','a3046000-0000-4000-8000-000000000050',
  'a3046000-0000-4000-8000-000000000051',pg_backend_pid(),txid_current()),true);
reset role;

do $test$
declare
  run_key uuid := 'a3046000-0000-4000-8000-000000000050';
  evidence app_sync_private.ph_master_bulk_import_context_v1;
begin
  if private.master_bulk_temp_context_active_v3046(run_key) then raise exception 'ERP_TEMP_CONTEXT_ACCEPTED_SPOOF'; end if;
  evidence:=private.ph_master_bulk_context_v1(run_key,'legacy-canonical');
  if evidence.raw_values->>'locationnote' is distinct from 'legacy raw' or evidence.new_insert_verified is distinct from true then
    raise exception 'ERP_TEMP_CONTEXT_LEGACY_FALLBACK_CHANGED';
  end if;
end
$test$;
