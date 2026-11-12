begin;
set local lock_timeout='1500ms';
set local statement_timeout='30s';

-- Both historical part writers join canonical jsonb::text objects with a bare
-- comma. Nested structures use comma-space and quotes in strings are escaped.
-- Retain the original normalized timestamps and use JSON's parser for other
-- encodings. Only the requested members are converted to JSONB.
create function private.drive_typed_slice_v3078(p_body text,p_count integer,p_offset integer,p_limit integer)
returns jsonb language plpgsql immutable strict set search_path='' as $slice$
declare frames text[]; payload jsonb; members integer;
begin
  if p_count not between 1 and 1500 or p_limit not between 1 and 250 or p_offset<0 or p_offset+p_limit>p_count then
    raise exception 'ERP_TYPED_SOURCE_SLICE_INVALID';
  end if;
  frames:=string_to_array(p_body,'},{"values": {');
  if cardinality(frames)=p_count then
    begin
      select jsonb_agg(((case when n=1 then '' else '{"values": {' end)||frames[n]||
        (case when n=p_count then '' else '}' end))::jsonb order by n) into payload
      from generate_series(p_offset+1,p_offset+p_limit) n;
      return payload;
    exception when invalid_text_representation then
      -- A noncanonical historical encoding may match a nested separator.
      payload:=null;
    end;
  end if;
  select count(*),jsonb_agg(value::jsonb order by ord) filter(where ord>p_offset and ord<=p_offset+p_limit)
    into members,payload from json_array_elements(('['||p_body||']')::json) with ordinality r(value,ord);
  if members<>p_count then raise exception 'ERP_TYPED_SOURCE_PART_INVALID'; end if;
  return payload;
end
$slice$;
revoke all on function private.drive_typed_slice_v3078(text,integer,integer,integer) from public,anon,authenticated,service_role;

do $cursor$
declare def text:=pg_get_functiondef('private.prepare_drive_typed_part_v3077(uuid)'::regprocedure);
  start_at integer:=strpos(def,'  payload:=(''[''||part.body||'']'')::jsonb;');
  stop_at integer:=strpos(def,'  perform private.prepare_master_bulk_stage_v3046(payload);');
begin
  if start_at=0 or stop_at<=start_at then raise exception 'ERP_TYPED_SOURCE_READER_CHANGED'; end if;
  execute overlay(def placing $read$  offset_rows:=job.typed_prepared_rows+1-part.first_row;
  batch_rows:=least(250,part.row_count-offset_rows,stage.expected_rows-job.typed_prepared_rows);
  payload:=private.drive_typed_slice_v3078(part.body,part.row_count,offset_rows,batch_rows);
$read$ from start_at for stop_at-start_at);
end
$cursor$;

create table private.erp_drive_preparation_seals_v3078 (
  stage_id uuid primary key references private.erp_stage_publication_jobs_v3042(stage_id) on delete cascade,
  source_fingerprint text not null, expected_rows integer not null check(expected_rows between 1 and 50000),
  checkpoint_hash text not null, source_digest text not null check(source_digest~'^[0-9a-f]{64}$'),
  payload jsonb not null check(jsonb_array_length(payload)=expected_rows),
  check(payload#>>'{0,$erpDigest}' is not distinct from source_digest),
  check(payload#>>'{0,$erpStage}' is not distinct from stage_id::text)
);
alter table private.erp_drive_preparation_seals_v3078 enable row level security;
revoke all on private.erp_drive_preparation_seals_v3078 from public,anon,authenticated,service_role;

create function private.drive_checkpoint_signature_v3078(p_stage_id uuid)
returns text language sql stable set search_path='' as $signature$
  select encode(extensions.digest(convert_to(string_agg(jsonb_build_array(first_row,row_count,source_first_row,
    source_part_hash,decoded_rows_hash)::text,',' order by first_row),'UTF8'),'sha256'),'hex')
  from private.erp_drive_typed_parts_v3077 where stage_id=p_stage_id
$signature$;
revoke all on function private.drive_checkpoint_signature_v3078(uuid) from public,anon,authenticated,service_role;

-- Keep the exact canonical array digest, 64 MiB validation and SOC projection
-- in their existing owner. This transaction writes private preparation only.
create function private.seal_drive_preparation_v3078(p_stage_id uuid)
returns boolean language plpgsql set search_path='' as $seal$
declare stage private.fast_erp_stage_runs_v1%rowtype; signature text;
begin
  perform 1 from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id for update nowait;
  if not found then raise exception 'ERP_DRIVE_PREPARATION_JOB_MISSING'; end if;
  select * into strict stage from private.fast_erp_stage_runs_v1 where stage_id=p_stage_id;
  if stage.dataset_key<>'drive_around' or stage.stage_state<>'staging' or stage.expires_at<=clock_timestamp()
    or stage.expected_rows<>stage.staged_rows then raise exception 'ERP_DRIVE_PREPARATION_STAGE_CHANGED'; end if;
  signature:=private.drive_checkpoint_signature_v3078(p_stage_id);
  if exists(select 1 from private.erp_drive_preparation_seals_v3078 where stage_id=p_stage_id) then
    if not exists(select 1 from private.erp_drive_preparation_seals_v3078 where stage_id=p_stage_id
      and source_fingerprint=stage.source_fingerprint and expected_rows=stage.expected_rows and checkpoint_hash=signature) then
      raise exception 'ERP_DRIVE_PREPARATION_SEAL_CHANGED';
    end if;
    return true;
  end if;
  perform private.load_drive_typed_checkpoint_v3077(p_stage_id);
  perform private.build_drive_publication_input_v3078(p_stage_id,stage.expected_rows,null);
  insert into private.erp_drive_preparation_seals_v3078
    select p_stage_id,stage.source_fingerprint,stage.expected_rows,signature,i.source_digest,i.payload
    from pg_temp.agdata_drive_publication_input_v3042 i where i.stage_id=p_stage_id;
  if not found then raise exception 'ERP_DRIVE_PREPARATION_SEAL_MISSING'; end if;
  update private.erp_stage_publication_jobs_v3042 set last_progress_at=clock_timestamp() where stage_id=p_stage_id;
  return false;
end
$seal$;
revoke all on function private.seal_drive_preparation_v3078(uuid) from public,anon,authenticated,service_role;

create function private.load_drive_preparation_seal_v3078(p_stage_id uuid)
returns boolean language plpgsql set search_path='' as $load$
declare seal private.erp_drive_preparation_seals_v3078%rowtype;
begin
  select * into seal from private.erp_drive_preparation_seals_v3078 where stage_id=p_stage_id;
  if not found then return false; end if;
  if seal.checkpoint_hash is distinct from private.drive_checkpoint_signature_v3078(p_stage_id)
    or not exists(select 1 from private.fast_erp_stage_runs_v1 where stage_id=p_stage_id and dataset_key='drive_around'
      and source_fingerprint=seal.source_fingerprint and expected_rows=seal.expected_rows)
    or seal.payload#>>'{0,$erpDigest}' is distinct from seal.source_digest
    or seal.payload#>>'{0,$erpStage}' is distinct from p_stage_id::text then raise exception 'ERP_DRIVE_PREPARATION_SEAL_CHANGED'; end if;
  perform private.load_drive_typed_checkpoint_v3077(p_stage_id);
  create temp table agdata_drive_publication_input_v3042 on commit drop as
    select seal.stage_id stage_id,seal.source_digest source_digest,seal.payload payload;
  perform set_config('agdata.erp.loaded_drive_stage',p_stage_id::text,true);
  return true;
end
$load$;
revoke all on function private.load_drive_preparation_seal_v3078(uuid) from public,anon,authenticated,service_role;

do $separate$
declare def text:=pg_get_functiondef('private.prepare_erp_publication_v3077(uuid)'::regprocedure);
  prior text:=E'  if private.drive_parts_fit_one_attempt_v3078(p_stage_id) then return true; end if;\n  return private.prepare_drive_typed_part_v3077(p_stage_id);';
  loader text:='  if private.drive_parts_fit_one_attempt_v3078(p_stage_id) then';
begin
  if cardinality(string_to_array(def,prior))<>2 then raise exception 'ERP_DRIVE_PREPARATION_ROUTE_CHANGED'; end if;
  execute replace(def,prior,$next$  if stage.dataset_key<>'drive_around' then return true; end if;
  if not private.prepare_drive_typed_part_v3077(p_stage_id) then return false; end if;
  return private.seal_drive_preparation_v3078(p_stage_id);$next$);
  def:=pg_get_functiondef('private.load_drive_erp_publication_input_v3042(uuid)'::regprocedure);
  if cardinality(string_to_array(def,loader))<>2 then raise exception 'ERP_DRIVE_INPUT_ROUTE_CHANGED'; end if;
  execute replace(def,loader,'  if private.load_drive_preparation_seal_v3078(p_stage_id) then return; end if;'||chr(10)||loader);
end
$separate$;

-- A GUC changed inside an already-running SELECT cannot extend that statement's
-- existing timer. Arm the deadline before each cron SELECT, and scope the
-- matching function configuration to the already service-only DRIVE owner.
create or replace function private.schedule_erp_stage_publication_v3057(p_stage_id uuid)
returns bigint language sql set search_path='' as $schedule$
  select cron.schedule('agdata-erp-publication-'||p_stage_id,'2 seconds',format(
    'begin; set local statement_timeout = %L; set local lock_timeout = %L; select private.run_erp_stage_publication_v3042(%L::uuid); commit',
    case when stage.dataset_key='drive_around' then '240s' else '120s' end,
    case when stage.dataset_key='drive_around' then '750ms' else '15s' end, p_stage_id))
  from private.fast_erp_stage_runs_v1 stage where stage.stage_id=p_stage_id;
$schedule$;
alter function public.fast_ingest_drive_around_v1(jsonb,jsonb) set statement_timeout='240s';
do $drive_scope$
declare def text:=pg_get_functiondef('public.fast_ingest_drive_around_v1(jsonb,jsonb)'::regprocedure);
  prior text:='  perform set_config(''agdata.bulk_import.ph_drive_around_report_rows'',''on'',true);';
begin
  if cardinality(string_to_array(def,prior))<>2 then raise exception 'ERP_DRIVE_INGEST_OWNER_CHANGED'; end if;
  execute replace(def,prior,'  set local statement_timeout=''240s'';'||chr(10)||prior);
end
$drive_scope$;
commit;
