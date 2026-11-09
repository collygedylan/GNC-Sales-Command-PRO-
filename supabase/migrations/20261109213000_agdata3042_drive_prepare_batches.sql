begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

alter table private.erp_stage_publication_jobs_v3042 add column prepared_rows integer not null default 0;
create table private.erp_drive_publication_parts_v3042 (
  stage_id uuid not null references private.erp_stage_publication_jobs_v3042(stage_id) on delete cascade,
  first_row integer not null,
  row_count integer not null check (row_count between 1 and 1500),
  raw_bytes bigint not null,
  body text not null,
  primary key (stage_id,first_row)
);
revoke all on private.erp_drive_publication_parts_v3042 from public,anon,authenticated,service_role;

create function private.normalize_drive_erp_row_v3042(p_row jsonb,p_filename text)
returns jsonb language sql volatile set search_path='' as $row$
  select jsonb_build_object(
    'values',private.fast_erp_clean_row_v2369(case when p_row ? 'values' then p_row->'values' else p_row end)
      ||jsonb_build_object('filename',p_filename,'last_updated',clock_timestamp()),
    'rawFields',case when p_row ? 'values' then coalesce(p_row->'rawFields','[]'::jsonb)
      else (select coalesce(jsonb_agg(field_name order by field_name),'[]'::jsonb)
        from unnest(array['locationnote','locationptn1','desigitem','desigcust','desigloc','pullerresponsibility',
          'oversellpercentage','salesnote','suspend']) field_name where p_row ? field_name) end)
$row$;

create function private.prepare_drive_erp_part_v3042(p_stage_id uuid,p_filename text,p_offset integer,p_expected integer)
returns integer language plpgsql set search_path='' as $part$
declare part record;
begin
  with rows as materialized (
    select row_ordinal,row_value from private.fast_erp_stage_rows_v1
    where stage_id=p_stage_id and row_ordinal>p_offset and row_ordinal<=p_expected
    order by row_ordinal limit 1500
  )
  select min(row_ordinal) first_row,max(row_ordinal) last_row,count(*)::integer row_count,
    sum(octet_length(row_value::text)::bigint+2) raw_bytes,
    string_agg(private.normalize_drive_erp_row_v3042(row_value,p_filename)::text,',' order by row_ordinal) body
  into part from rows;
  if part.row_count<>least(1500,p_expected-p_offset) or part.first_row is distinct from p_offset+1
    or part.last_row is distinct from p_offset+part.row_count then raise exception 'FAST_ERP_STAGE_INCOMPLETE'; end if;
  insert into private.erp_drive_publication_parts_v3042(stage_id,first_row,row_count,raw_bytes,body)
    values(p_stage_id,part.first_row,part.row_count,part.raw_bytes,part.body);
  return part.row_count;
end
$part$;
revoke all on function private.normalize_drive_erp_row_v3042(jsonb,text),
  private.prepare_drive_erp_part_v3042(uuid,text,integer,integer) from public,anon,authenticated,service_role;

do $runner$
declare definition text := pg_get_functiondef('private.run_erp_stage_publication_v3042(uuid)'::regprocedure);
  anchor text := '    if job.payload is null then';
begin
  if strpos(definition,anchor)=0 then raise exception 'ERP_DRIVE_PREPARE_RUNNER_ANCHOR_MISSING'; end if;
  execute replace(definition,anchor,$prepare$    if stage.dataset_key='drive_around' and job.prepared_rows<stage.expected_rows then
      update private.erp_stage_publication_jobs_v3042 set payload=null,failures=0,last_error=null,
        prepared_rows=job.prepared_rows+private.prepare_drive_erp_part_v3042(
          p_stage_id,stage.file_meta->>'file_name',job.prepared_rows,stage.expected_rows)
      where stage_id=p_stage_id;
      return;
    elsif stage.dataset_key<>'drive_around' and job.payload is null then$prepare$);
end
$runner$;

do $commit$
declare definition text := pg_get_functiondef('public.fast_commit_erp_stage_swap_v1(uuid)'::regprocedure);
  start_text text := '  select j.payload into rows_value';
  end_text text := '  if coalesce(jsonb_array_length(rows_value),0)';
  start_at integer := strpos(definition,start_text);
  end_at integer := strpos(definition,end_text);
begin
  if start_at=0 or end_at<=start_at or strpos(definition,'  end case;')=0 then
    raise exception 'ERP_DRIVE_PREPARED_COMMIT_ANCHOR_MISSING';
  end if;
  definition := overlay(definition placing $read$  previous_prepared := coalesce(current_setting('agdata.erp.prepared_drive',true),'');
  perform set_config('agdata.erp.prepared_drive','off',true);
  if stage.dataset_key='drive_around' and exists(select 1 from private.erp_stage_publication_jobs_v3042
      where stage_id=p_stage_id and prepared_rows=stage.expected_rows) then
    select coalesce(sum(raw_bytes),0),coalesce(sum(row_count),0) into input_bytes,part_rows
    from private.erp_drive_publication_parts_v3042 where stage_id=p_stage_id;
    if part_rows<>stage.expected_rows or input_bytes>67108864 then raise exception 'FAST_ERP_STAGE_INCOMPLETE'; end if;
    select ('['||string_agg(body,',' order by first_row)||']')::jsonb into rows_value
    from private.erp_drive_publication_parts_v3042 where stage_id=p_stage_id;
    perform set_config('agdata.erp.prepared_drive','on',true);
  else
    select j.payload into rows_value from private.erp_stage_publication_jobs_v3042 j where j.stage_id=p_stage_id;
    if rows_value is null then
      select jsonb_agg(row_value order by row_ordinal) into rows_value
      from private.fast_erp_stage_rows_v1 where stage_id=p_stage_id;
    end if;
  end if;
$read$ from start_at for end_at-start_at);
  definition := replace(definition,' result_value jsonb;',
    ' result_value jsonb; previous_prepared text; input_bytes bigint; part_rows bigint;');
  execute replace(definition,'  end case;','  end case;'||chr(10)||
    '  perform set_config(''agdata.erp.prepared_drive'',previous_prepared,true);');
end
$commit$;

do $ingest$
declare definition text := pg_get_functiondef('public.fast_ingest_drive_around_v2374_base(jsonb,jsonb)'::regprocedure);
  start_at integer := strpos(definition,'  select (''[''||string_agg((case when row_value');
  end_at integer := strpos(definition,'  if exists(select 1 from jsonb_array_elements(bulk_rows)');
  byte_limit text := 'or octet_length(p_rows::text)>67108864';
begin
  if start_at=0 or end_at<=start_at or strpos(definition,byte_limit)=0 then
    raise exception 'ERP_DRIVE_PREPARED_INGEST_ANCHOR_MISSING';
  end if;
  definition := overlay(definition placing $ingest_rows$  if current_setting('agdata.erp.prepared_drive',true)='on' then
    bulk_rows := p_rows;
  else
    select jsonb_agg(private.normalize_drive_erp_row_v3042(row_value,meta->>'file_name') order by ordinality)
    into bulk_rows from jsonb_array_elements(p_rows) with ordinality source_row(row_value,ordinality);
  end if;
$ingest_rows$ from start_at for end_at-start_at);
  execute replace(definition,byte_limit,$bytes$or (coalesce(current_setting('agdata.erp.prepared_drive',true),'')<>'on'
       and octet_length(p_rows::text)>67108864)$bytes$);
end
$ingest$;

commit;
