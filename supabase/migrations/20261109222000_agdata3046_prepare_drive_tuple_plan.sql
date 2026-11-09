begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- Decode and validate the immutable workbook in the preload statement. The
-- live overlay changes typed values, not the input field set or its digest.
do $extract$
declare
  bulk regprocedure := 'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure;
  definition text := pg_get_functiondef(bulk);
  stage_at integer := strpos(definition,'  if exists ('||chr(10)||'    select 1 from jsonb_array_elements(p_rows) as e(value)');
  stage_end integer := strpos(definition,'  select count(*)::integer into source_rows from pg_temp.ph_master_bulk_stage_v1;');
  tuple_query text := $query$    select s.raw_item6_fields, s.field_keys,
      bool_and(s.raw_values ? 'priority' and s.raw_values ? 'holdstopcode' and s.raw_values ? 'holdstopreason') as complete_hold_tuple
    from pg_temp.ph_master_bulk_stage_v1 s
    group by s.raw_item6_fields, s.field_keys
    order by array_to_string(s.raw_item6_fields, ','), array_to_string(s.field_keys, ',')$query$;
  hash_line text := '  payload_hash := encode(extensions.digest(convert_to(p_rows::text, ''UTF8''), ''sha256''), ''hex'');';
begin
  if stage_at=0 or stage_end<=stage_at or strpos(definition,tuple_query)=0 or strpos(definition,hash_line)=0
    or strpos(definition,'  v_rows jsonb := p_rows;')=0 then
    raise exception 'ERP_DRIVE_TUPLE_PLAN_ANCHOR_MISSING';
  end if;
  execute format($stage$create function private.prepare_master_bulk_stage_v3046(p_rows jsonb)
returns void language plpgsql set search_path='' as $body$
begin
%s
  drop table if exists pg_temp.ph_master_bulk_tuples_v3046;
  create temp table ph_master_bulk_tuples_v3046 on commit drop as
  select distinct s.raw_item6_fields,s.field_keys,
    s.field_keys @> array['priority','holdstopcode','holdstopreason'] as complete_hold_tuple
  from pg_temp.ph_master_bulk_stage_v1 s;
end
$body$;$stage$,replace(substring(definition from stage_at for stage_end-stage_at),
    'jsonb_array_elements(v_rows)','jsonb_array_elements(p_rows)'));
  definition:=overlay(definition placing $prepared$  if loaded_payload_hash is null then
    perform private.prepare_master_bulk_stage_v3046(p_rows);
  end if;
$prepared$ from stage_at for stage_end-stage_at);
  definition:=replace(definition,'  v_rows jsonb := p_rows;','  loaded_payload_hash text;');
  definition:=replace(definition,hash_line,$hash$  if current_setting('agdata.erp.prepared_drive',true)='on'
    and to_regclass('pg_temp.agdata_drive_publication_input_v3042') is not null
    and to_regclass('pg_temp.ph_master_bulk_stage_v1') is not null
    and to_regclass('pg_temp.ph_master_bulk_tuples_v3046') is not null then
    select input.source_digest into loaded_payload_hash from pg_temp.agdata_drive_publication_input_v3042 input
    where input.stage_id::text=current_setting('agdata.erp.loaded_drive_stage',true)
      and input.source_digest=p_source_digest and input.payload=p_rows;
  end if;
  payload_hash := coalesce(loaded_payload_hash,encode(extensions.digest(convert_to(p_rows::text, 'UTF8'), 'sha256'), 'hex'));$hash$);
  execute replace(definition,tuple_query,$tuples$    select raw_item6_fields,field_keys,complete_hold_tuple
    from pg_temp.ph_master_bulk_tuples_v3046
    order by array_to_string(raw_item6_fields, ','),array_to_string(field_keys, ',')$tuples$);
end
$extract$;
revoke all on function private.prepare_master_bulk_stage_v3046(jsonb) from public,anon,authenticated,service_role;

do $wire$
declare
  definition text := pg_get_functiondef('private.load_drive_erp_publication_input_v3042(uuid)'::regprocedure);
  start_at integer := strpos(definition,'    if exists(select 1 from pg_temp.agdata_drive_publication_input_v3042 i');
  stop_at integer := strpos(definition,'    perform set_config(''agdata.erp.loaded_drive_stage'',p_stage_id::text,true);');
begin
  if start_at=0 or stop_at<=start_at then raise exception 'ERP_DRIVE_PRELOAD_TUPLE_PLAN_ANCHOR_MISSING'; end if;
  execute overlay(definition placing $prepare$    perform private.prepare_master_bulk_stage_v3046(
      (select i.payload from pg_temp.agdata_drive_publication_input_v3042 i where i.stage_id=p_stage_id));
$prepare$ from start_at for stop_at-start_at);
end
$wire$;
commit;
