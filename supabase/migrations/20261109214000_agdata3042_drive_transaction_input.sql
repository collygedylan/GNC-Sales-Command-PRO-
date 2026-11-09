begin;
set local lock_timeout='3s';
set local statement_timeout='120s';

-- Give materialization its own statement deadline while retaining the same
-- transaction and canonical publisher for the inventory and receipt writes.
create function private.load_drive_erp_publication_input_v3042(p_stage_id uuid)
returns void language plpgsql set search_path='' set work_mem='32MB' as $load$
declare attempt integer;
begin
  select j.failures into attempt
  from private.erp_stage_publication_jobs_v3042 j join private.fast_erp_stage_runs_v1 s using(stage_id)
  where j.stage_id=p_stage_id and j.prepared_rows=s.expected_rows and s.dataset_key='drive_around'
    and s.stage_state='staging' and s.expires_at>clock_timestamp()
    and j.failures<6 and j.next_attempt_at<=clock_timestamp();
  if not found then return; end if;

  begin
    create temp table agdata_drive_publication_input_v3042 on commit drop as
    with prepared as materialized (
      select ('['||string_agg(body,',' order by first_row)||']')::jsonb as payload
      from private.erp_drive_publication_parts_v3042 where stage_id=p_stage_id
    )
    select p_stage_id as stage_id,payload,
      encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex') as source_digest
    from prepared;
    if exists(select 1 from pg_temp.agdata_drive_publication_input_v3042 i
      cross join lateral jsonb_array_elements(i.payload) r
      group by r->'values'->>'unique_id'
      having nullif(btrim(r->'values'->>'unique_id'),'') is null or count(*)>1) then
      raise exception 'FAST_ERP_ROW_IDENTITY_INVALID';
    end if;
    perform set_config('agdata.erp.loaded_drive_stage',p_stage_id::text,true);
  exception when query_canceled or others then
    update private.erp_stage_publication_jobs_v3042 set failures=attempt+1,
      next_attempt_at=clock_timestamp()+least(60,5*2^attempt)*interval '1 second',last_error=SQLSTATE
      where stage_id=p_stage_id;
  end;
end
$load$;
revoke all on function private.load_drive_erp_publication_input_v3042(uuid) from public,anon,authenticated,service_role;

do $wire$
declare
  definition text := pg_get_functiondef('public.fast_commit_erp_stage_swap_v1(uuid)'::regprocedure);
  start_at integer := strpos(definition,'    select (''[''||string_agg(body,');
  stop_at integer := strpos(definition,'    perform set_config(''agdata.erp.prepared_drive'',''on'',true);');
  command text := 'set statement_timeout = ''''120s''''; select private.run_erp_stage_publication_v3042(%L::uuid)';
begin
  if start_at=0 or stop_at<=start_at then raise exception 'ERP_DRIVE_PUBLISH_INPUT_ANCHOR_MISSING'; end if;
  execute overlay(definition placing $prepared$    if current_setting('agdata.erp.loaded_drive_stage',true)=p_stage_id::text
      and to_regclass('pg_temp.agdata_drive_publication_input_v3042') is not null then
      select input.payload into rows_value from pg_temp.agdata_drive_publication_input_v3042 input
      where input.stage_id=p_stage_id;
    end if;
    if rows_value is null then
      select ('['||string_agg(body,',' order by first_row)||']')::jsonb into rows_value
      from private.erp_drive_publication_parts_v3042 where stage_id=p_stage_id;
    end if;
$prepared$ from start_at for stop_at-start_at);

  definition:=pg_get_functiondef('public.fast_commit_erp_stage_swap_v1(uuid,boolean)'::regprocedure);
  if strpos(definition,command)=0 then raise exception 'ERP_DRIVE_PUBLISH_COMMAND_ANCHOR_MISSING'; end if;
  execute replace(definition,command,$schedule$set statement_timeout = ''120s''; begin; select private.load_drive_erp_publication_input_v3042(%1$L::uuid); select private.run_erp_stage_publication_v3042(%1$L::uuid); commit$schedule$);
end
$wire$;

do $ingest$
declare definition text := pg_get_functiondef('public.fast_ingest_drive_around_v2374_base(jsonb,jsonb)'::regprocedure);
  hash_text text := 'encode(extensions.digest(convert_to(bulk_rows::text,''UTF8''),''sha256''),''hex'')';
  identity_text text := '  if exists(select 1 from jsonb_array_elements(bulk_rows)';
  invalid_text text := 'group by row_value->''values''->>''unique_id'' having count(*)>1) then';
begin
  if strpos(definition,hash_text)=0 or strpos(definition,identity_text)=0 or strpos(definition,invalid_text)=0 then
    raise exception 'ERP_DRIVE_PUBLISH_PROOF_ANCHOR_MISSING';
  end if;
  definition:=replace(definition,'  bulk_result jsonb;','  bulk_result jsonb; prepared_digest text;');
  definition:=replace(definition,identity_text,$proof$  if current_setting('agdata.erp.prepared_drive',true)='on'
    and to_regclass('pg_temp.agdata_drive_publication_input_v3042') is not null then
    select i.source_digest into prepared_digest from pg_temp.agdata_drive_publication_input_v3042 i
    where i.stage_id::text=current_setting('agdata.erp.loaded_drive_stage',true);
  end if;
  if prepared_digest is null and (exists(select 1 from jsonb_array_elements(bulk_rows)$proof$);
  definition:=replace(definition,invalid_text,replace(invalid_text,') then',')) then'));
  execute replace(definition,hash_text,'coalesce(prepared_digest,'||hash_text||')');
end
$ingest$;

commit;
