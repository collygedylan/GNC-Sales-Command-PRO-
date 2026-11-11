begin;
set local statement_timeout = '5s';
set local lock_timeout = '1s';

-- All source preparation advances through the same durable, locked job.
-- Live data and its publication receipt remain one canonical transaction.
create function private.erp_publication_part_matches_v3064(p_dataset text,p_before text,p_after text)
returns boolean language sql immutable strict set search_path = '' as $same$
  select case when p_dataset<>'drive_around' then p_before=p_after else
    (select jsonb_agg(value #- '{values,last_updated}' order by ordinal)
      from jsonb_array_elements(('['||p_before||']')::jsonb) with ordinality r(value,ordinal))
    = (select jsonb_agg(value #- '{values,last_updated}' order by ordinal)
      from jsonb_array_elements(('['||p_after||']')::jsonb) with ordinality r(value,ordinal)) end
$same$;
revoke all on function private.erp_publication_part_matches_v3064(text,text,text) from public,anon,authenticated,service_role;

create function private.prepare_erp_publication_part_v3064(p_stage_id uuid,p_offset integer,p_expected integer)
returns integer language plpgsql set search_path = '' as $part$
declare stage private.fast_erp_stage_runs_v1%rowtype; part record; inserted integer;
begin
  select * into strict stage from private.fast_erp_stage_runs_v1 where stage_id=p_stage_id;
  if stage.stage_state<>'staging' or stage.expected_rows<>p_expected or stage.staged_rows<>p_expected
    or p_offset<0 or p_offset>=p_expected then raise exception 'FAST_ERP_STAGE_INCOMPLETE'; end if;
  with rows as materialized (
    select row_ordinal,row_value from private.fast_erp_stage_rows_v1
    where stage_id=p_stage_id and row_ordinal>p_offset and row_ordinal<=p_expected
    order by row_ordinal limit 1000
  )
  select min(row_ordinal) first_row,max(row_ordinal) last_row,count(*)::integer row_count,
    sum(octet_length(row_value::text)::bigint+2) raw_bytes,
    string_agg(case when stage.dataset_key='drive_around'
      then private.normalize_drive_erp_row_v3042(row_value,stage.file_meta->>'file_name')::text
      else row_value::text end,',' order by row_ordinal) body into part from rows;
  if part.row_count<>least(1000,p_expected-p_offset) or part.first_row is distinct from p_offset+1
    or part.last_row is distinct from p_offset+part.row_count then raise exception 'FAST_ERP_STAGE_INCOMPLETE'; end if;
  insert into private.erp_drive_publication_parts_v3042(stage_id,first_row,row_count,raw_bytes,body)
    values(p_stage_id,part.first_row,part.row_count,part.raw_bytes,part.body)
    on conflict(stage_id,first_row) do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 and not exists (
    select 1 from private.erp_drive_publication_parts_v3042 saved where saved.stage_id=p_stage_id
      and saved.first_row=part.first_row and saved.row_count=part.row_count
      and private.erp_publication_part_matches_v3064(stage.dataset_key,saved.body,part.body)
  ) then raise exception 'FAST_ERP_STAGE_PART_MISMATCH'; end if;
  return part.row_count;
end
$part$;
revoke all on function private.prepare_erp_publication_part_v3064(uuid,integer,integer)
  from public,anon,authenticated,service_role;

do $worker$
declare
  definition text:=pg_get_functiondef('private.run_erp_stage_publication_v3042(uuid)'::regprocedure);
  preparation text:=$old$if stage.dataset_key='drive_around' and job.prepared_rows<stage.expected_rows then$old$;
  call text:=$old$private.prepare_drive_erp_part_v3042(
          p_stage_id,stage.file_meta->>'file_name',job.prepared_rows,stage.expected_rows)$old$;
  aggregation text:=$old$select ('['||string_agg(row_value::text,',' order by row_ordinal)||']')::jsonb into prepared
      from private.fast_erp_stage_rows_v1 where stage_id=p_stage_id;$old$;
begin
  if cardinality(string_to_array(definition,preparation))<>2 or cardinality(string_to_array(definition,call))<>2
    or cardinality(string_to_array(definition,aggregation))<>2 then raise exception 'ERP_PUBLICATION_WORKER_CHANGED'; end if;
  definition:=replace(definition,preparation,'if job.prepared_rows<stage.expected_rows then');
  definition:=replace(definition,call,'private.prepare_erp_publication_part_v3064(p_stage_id,job.prepared_rows,stage.expected_rows)');
  execute replace(definition,aggregation,$new$select ('['||string_agg(body,',' order by first_row)||']')::jsonb into prepared
      from private.erp_drive_publication_parts_v3042 where stage_id=p_stage_id;$new$);
end
$worker$;

do $receipt$
declare
  definition text:=pg_get_functiondef('public.fast_commit_erp_stage_swap_v1(uuid,boolean)'::regprocedure);
  anchor text:=$old$return jsonb_build_object('ok',true,'busy',true,'stage_id',p_stage_id,'retryAfterMs',2500);$old$;
begin
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'ERP_PUBLICATION_ENQUEUE_CHANGED'; end if;
  execute replace(definition,anchor,$new$return jsonb_build_object('ok',true,'busy',true,'stage_id',p_stage_id,'retryAfterMs',2500,
    'expectedRows',stage.expected_rows,'preparedRows',coalesce((select prepared_rows
      from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id),0));$new$);
end
$receipt$;

-- Existing jobs with a completed legacy payload retain that payload. A queued
-- secondary job with no payload starts its bounded preparation at zero.
update private.erp_stage_publication_jobs_v3042 job set prepared_rows=stage.expected_rows
from private.fast_erp_stage_runs_v1 stage where stage.stage_id=job.stage_id and stage.dataset_key<>'drive_around'
  and job.payload is not null and job.prepared_rows=0 and jsonb_array_length(job.payload)=stage.expected_rows;
commit;
