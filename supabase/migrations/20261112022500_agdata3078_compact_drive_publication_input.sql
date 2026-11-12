begin;
set local lock_timeout='1500ms';
set local statement_timeout='30s';

-- SQL's JSONB array text inserts ", " between elements. Reconstitute that
-- exact byte stream from bounded immutable parts, without one giant JSONB.
create function private.drive_part_array_body_v3078(p_body text,p_count integer)
returns text language plpgsql immutable strict set search_path='' as $part$
declare rows_json jsonb:=('['||p_body||']')::jsonb; canonical text;
begin
  if jsonb_array_length(rows_json)<>p_count then raise exception 'ERP_DRIVE_PART_COUNT_CHANGED'; end if;
  canonical:=rows_json::text;
  return substr(canonical,2,length(canonical)-2);
end
$part$;
revoke all on function private.drive_part_array_body_v3078(text,integer) from public,anon,authenticated,service_role;

-- Only a complete small DRIVE source can take the transaction-local path.
-- Large files, interrupted decoding, and partial durable checkpoints retain
-- the bounded cursor and its authenticated source/decoded-part proofs.
create function private.drive_parts_fit_one_attempt_v3078(p_stage_id uuid)
returns boolean language sql stable set search_path='' as $fit$
  select exists(select 1 from private.fast_erp_stage_runs_v1 s
    join private.erp_stage_publication_jobs_v3042 j using(stage_id)
    where s.stage_id=p_stage_id and s.dataset_key='drive_around' and s.stage_state='staging'
      and s.expected_rows between 1 and 10000 and s.staged_rows=s.expected_rows and j.prepared_rows=s.expected_rows
      and j.typed_prepared_rows=0 and j.typed_source_fingerprint is null
      and j.last_error_phase is distinct from 'prepare'
      and (select sum(octet_length(p.body)) from private.erp_drive_publication_parts_v3042 p
        where p.stage_id=s.stage_id)<=25165824)
$fit$;
revoke all on function private.drive_parts_fit_one_attempt_v3078(uuid) from public,anon,authenticated,service_role;

-- Raw RPCs unpack their arrays once. The worker supplies exactly the same
-- (ordinality,value) relation from bounded parts; both use the same decoder.
do $decoder$
declare definition text:=pg_get_functiondef('private.prepare_master_bulk_stage_v3046(jsonb)'::regprocedure);
  rows_source text:='from jsonb_array_elements(p_rows) as e(value)';
  ordinal_source text:='from jsonb_array_elements(p_rows) with ordinality as e(value, ordinality)';
  entry text:=E'begin\n  if exists (';
begin
  if cardinality(string_to_array(definition,rows_source))<>3 or cardinality(string_to_array(definition,ordinal_source))<>2
    or cardinality(string_to_array(definition,entry))<>2 then raise exception 'ERP_DRIVE_DECODER_OWNER_CHANGED'; end if;
  definition:=replace(replace(definition,rows_source,'from pg_temp.erp_drive_decode_input_v3078 e'),
    ordinal_source,'from pg_temp.erp_drive_decode_input_v3078 e');
  -- Avoid repeatedly compressing and decompressing typical workbook rows in
  -- these transaction-local tables. Oversized individual rows still TOAST.
  definition:=replace(definition,'create temp table ph_master_bulk_stage_v1 on commit drop as',
    'create temp table ph_master_bulk_stage_v1 with(toast_tuple_target=8000) on commit drop as');
  definition:=replace(definition,'  perform private.refresh_drive_stage_cohort_statistics_v3077();',
    '  perform private.refresh_drive_stage_cohort_statistics_v3077();'||chr(10)||'  drop table pg_temp.erp_drive_decode_input_v3078;');
  execute replace(definition,entry,$open$begin
  if p_rows is not null then
    drop table if exists pg_temp.erp_drive_decode_input_v3078;
    create temp table erp_drive_decode_input_v3078 with(toast_tuple_target=8000) on commit drop as
      select value,ordinality from jsonb_array_elements(p_rows) with ordinality;
  elsif not exists(select 1 from pg_class where relnamespace=pg_my_temp_schema() and relname='erp_drive_decode_input_v3078'
    and relkind='r' and relpersistence='t' and pg_get_userbyid(relowner)=current_user) then
    raise exception 'ERP_DRIVE_DECODER_SOURCE_UNTRUSTED';
  end if;
  if exists ($open$);
end
$decoder$;

-- Extract each potentially toasted JSON object once before deriving stock,
-- masks, hashes and master columns from that same physical row.
do $projection$
declare def text:=pg_get_functiondef('private.prepare_master_bulk_stage_v3046(jsonb)'::regprocedure);
  pos integer:=strpos(def,'  create temp table ph_master_bulk_stage_v1'); projection text:=substr(def,pos);
  anchor text:='  from pg_temp.erp_drive_decode_input_v3078 e';
begin
  if pos=0 or cardinality(string_to_array(projection,anchor))<>2 then raise exception 'ERP_DRIVE_TYPED_PROJECTION_CHANGED'; end if;
  projection:=replace(replace(projection,'e.value->''values''','v.raw_values'),'e.value->''rawFields''','v.raw_fields');
  execute left(def,pos-1)||replace(projection,anchor,anchor||chr(10)||
    '  cross join lateral (select e.value->''values'' raw_values,e.value->''rawFields'' raw_fields offset 0) v');
end
$projection$;

create function private.load_drive_fast_parts_v3078(p_stage_id uuid,p_expected integer)
returns text language plpgsql set search_path='' as $load$
declare canonical text; actual integer; first_ordinal bigint; last_ordinal bigint;
begin
  drop table if exists pg_temp.erp_drive_decode_input_v3078;
  create temp table erp_drive_decode_input_v3078 with(toast_tuple_target=8000) on commit drop as
    select r.value,p.first_row+r.ord-1 ordinality,p.first_row
    from private.erp_drive_publication_parts_v3042 p cross join lateral
      jsonb_array_elements(('['||p.body||']')::jsonb) with ordinality r(value,ord)
    where p.stage_id=p_stage_id;
  create unique index on pg_temp.erp_drive_decode_input_v3078(ordinality);
  analyze pg_temp.erp_drive_decode_input_v3078 (first_row,ordinality);
  if exists(select 1 from private.erp_drive_publication_parts_v3042 p left join
      (select first_row,count(*) rows from pg_temp.erp_drive_decode_input_v3078 group by first_row) actual using(first_row)
    where p.stage_id=p_stage_id and (p.row_count not between 1 and 1500 or p.row_count is distinct from actual.rows)) then
    raise exception 'ERP_DRIVE_PART_RANGE_CHANGED';
  end if;
  select count(*),min(ordinality),max(ordinality),'['||string_agg(value::text,', ' order by ordinality)||']'
    into actual,first_ordinal,last_ordinal,canonical from pg_temp.erp_drive_decode_input_v3078;
  if actual<>p_expected or first_ordinal<>1 or last_ordinal<>p_expected then raise exception 'ERP_DRIVE_DECODE_COUNT_CHANGED'; end if;
  perform private.prepare_master_bulk_stage_v3046(null);
  return canonical;
end
$load$;
revoke all on function private.load_drive_fast_parts_v3078(uuid,integer) from public,anon,authenticated,service_role;
-- Downstream only SOC reads row payloads after canonical typed hydration. Its
-- exact three raw keys retain the original JSON ->> conversion, nulls and order.
-- Only definer-owned temp tables can certify this private transport in bulk.
create function private.build_drive_publication_input_v3078(p_stage_id uuid,p_expected integer,p_canonical text)
returns void language plpgsql set search_path='' as $input$
declare canonical text:=p_canonical; digest text; compact jsonb;
begin
  if canonical is null then
    select '['||string_agg(private.drive_part_array_body_v3078(body,row_count),', ' order by first_row)||']'
      into canonical from private.erp_drive_publication_parts_v3042 where stage_id=p_stage_id;
  end if;
  if canonical is null or octet_length(canonical)>67108864 then raise exception 'BULK_MASTER_IMPORT_INPUT_INVALID'; end if;
  digest:=encode(extensions.digest(convert_to(canonical,'UTF8'),'sha256'),'hex');
  select jsonb_agg(jsonb_build_object('itemcode',raw_values->>'itemcode','locationcode',raw_values->>'locationcode',
    'lotcode',raw_values->>'lotcode') order by row_number) into compact from pg_temp.ph_master_bulk_stage_v1;
  if jsonb_array_length(compact) is distinct from p_expected then raise exception 'ERP_DRIVE_DECODE_COUNT_CHANGED'; end if;
  compact:=jsonb_set(compact,'{0}',(compact->0)||jsonb_build_object('$erpStage',p_stage_id,'$erpDigest',digest));
  create temp table agdata_drive_publication_input_v3042 on commit drop as
    select p_stage_id stage_id,compact payload,digest source_digest;
end
$input$;
revoke all on function private.build_drive_publication_input_v3078(uuid,integer,text) from public,anon,authenticated,service_role;

create or replace function private.load_drive_erp_publication_input_v3042(p_stage_id uuid)
returns void language plpgsql set search_path='' set work_mem='32MB' as $load$
declare expected integer; canonical text;
begin
  select s.expected_rows into expected from private.erp_stage_publication_jobs_v3042 j
    join private.fast_erp_stage_runs_v1 s using(stage_id)
    where j.stage_id=p_stage_id and j.prepared_rows=s.expected_rows and s.dataset_key='drive_around'
      and s.stage_state='staging' and s.expires_at>clock_timestamp()
      and j.failures<6 and j.next_attempt_at<=clock_timestamp();
  if not found then return; end if;
  if private.drive_parts_fit_one_attempt_v3078(p_stage_id) then
    canonical:=private.load_drive_fast_parts_v3078(p_stage_id,expected);
  else
    perform private.load_drive_typed_checkpoint_v3077(p_stage_id);
  end if;
  perform private.build_drive_publication_input_v3078(p_stage_id,expected,canonical);
  perform set_config('agdata.erp.loaded_drive_stage',p_stage_id::text,true);
end
$load$;

do $wire$
declare definition text:=pg_get_functiondef('private.prepare_erp_publication_v3077(uuid)'::regprocedure);
  anchor text:='  return private.prepare_drive_typed_part_v3077(p_stage_id);';
begin
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'ERP_DRIVE_PREPARATION_OWNER_CHANGED'; end if;
  execute replace(definition,anchor,'  if private.drive_parts_fit_one_attempt_v3078(p_stage_id) then return true; end if;'
    ||chr(10)||anchor);
end
$wire$;
commit;
