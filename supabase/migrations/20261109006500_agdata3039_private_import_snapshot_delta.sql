begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table import_private.import_history_states_v3039 (
  state_digest bytea primary key,
  row_values jsonb not null check(jsonb_typeof(row_values)='array')
);
create table import_private.import_history_coverage_v3039 (
  snapshot_id uuid not null references import_private.import_history_files(id) on delete cascade,
  row_number integer not null check(row_number>0),
  state_digest bytea not null references import_private.import_history_states_v3039(state_digest),
  primary key(snapshot_id,row_number)
);
alter table import_private.import_history_states_v3039 enable row level security;
alter table import_private.import_history_coverage_v3039 enable row level security;
revoke all on import_private.import_history_states_v3039,import_private.import_history_coverage_v3039
  from public,anon,authenticated,service_role;

create view import_private.import_history_logical_rows_v3039 with(security_invoker=true) as
select physical.snapshot_id,physical.row_number,physical.row_values
from import_private.import_history_rows physical
where not exists(select 1 from import_private.import_history_coverage_v3039 coverage
  where coverage.snapshot_id=physical.snapshot_id and coverage.row_number=physical.row_number)
union all
select coverage.snapshot_id,coverage.row_number,state.row_values
from import_private.import_history_coverage_v3039 coverage
join import_private.import_history_states_v3039 state using(state_digest);
revoke all on import_private.import_history_logical_rows_v3039 from public,anon,authenticated,service_role;

create function import_private.import_history_complete_v3039(p_snapshot uuid)
returns boolean language sql stable set search_path='' as $function$
  select exists(select 1 from import_private.import_history_files file
    cross join lateral (
      select count(*) row_count,min(row_number) first_row,max(row_number) last_row
      from import_private.import_history_logical_rows_v3039 where snapshot_id=file.id
    ) observed
    where file.id=p_snapshot and file.status='ready' and file.published_at is not null
      and file.staged_rows=file.expected_rows and observed.row_count=file.expected_rows
      and (observed.row_count=0 or (observed.first_row=1 and observed.last_row=file.expected_rows)))
$function$;

-- Check the immediate predecessor from every receipt state. A staging file or
-- a different positional header vector breaks the comparison.
create function import_private.import_history_predecessor_v3039(p_snapshot uuid)
returns uuid language sql stable set search_path='' as $function$
  select previous.id
  from import_private.import_history_files current
  cross join lateral (
    select candidate.id,candidate.columns
    from import_private.import_history_files candidate where candidate.dataset=current.dataset
      and (candidate.report_date,candidate.daily_sequence)<(current.report_date,current.daily_sequence)
    order by candidate.report_date desc,candidate.daily_sequence desc limit 1
  ) previous
  where current.id=p_snapshot and current.columns=previous.columns
    and import_private.import_history_complete_v3039(previous.id)
$function$;

create function import_private.import_history_batch_v3039(p_rows jsonb)
returns table(row_number integer,row_values jsonb)
language sql immutable set search_path='' as $function$
  select (entry->>'row_number')::integer,entry->'values' from jsonb_array_elements(p_rows) entry
$function$;

create function import_private.validate_history_stage_v3039(
  p_file import_private.import_history_files,p_rows jsonb)
returns integer language plpgsql set search_path='' as $function$
declare entry jsonb; previous integer; current_row integer; position_value numeric;
begin
  for entry in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(entry) is distinct from 'object' then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_INVALID';
    end if;
    if (select count(*) from jsonb_object_keys(entry))<>2
      or jsonb_typeof(entry->'row_number') is distinct from 'number'
      or (entry->>'row_number') !~ '^[0-9]{1,10}$'
      or jsonb_typeof(entry->'values') is distinct from 'array' then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_INVALID';
    end if;
    if jsonb_array_length(entry->'values')<>cardinality(p_file.columns) then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_INVALID';
    end if;
    position_value:=(entry->>'row_number')::numeric;
    if position_value<1 or position_value>p_file.expected_rows then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_OUT_OF_RANGE';
    end if;
    current_row:=position_value::integer;
    if previous is null and current_row>p_file.staged_rows+1 then
      raise exception using errcode='22023',message='IMPORT_HISTORY_STAGE_GAP';
    end if;
    if previous is not null and current_row<>previous+1 then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROWS_NOT_CONTIGUOUS';
    end if;
    previous:=current_row;
  end loop;
  if exists(select 1 from import_private.import_history_batch_v3039(p_rows) input
    join import_private.import_history_logical_rows_v3039 saved using(row_number)
    where saved.snapshot_id=p_file.id and saved.row_values is distinct from input.row_values) then
    raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_RETRY_CONFLICT';
  end if;
  return greatest(p_file.staged_rows,coalesce(previous,p_file.staged_rows));
end
$function$;

create function import_private.import_history_matching_batch_v3039(p_previous uuid,p_rows jsonb)
returns table(row_number integer,row_values jsonb,state_digest bytea)
language sql stable set search_path='' as $function$
  select input.row_number,input.row_values,sha256(convert_to(input.row_values::text,'UTF8'))
  from import_private.import_history_batch_v3039(p_rows) input
  join import_private.import_history_logical_rows_v3039 previous using(row_number)
  where previous.snapshot_id=p_previous and previous.row_values=input.row_values
$function$;

create function import_private.capture_history_stage_v3039(p_snapshot uuid,p_previous uuid,p_rows jsonb)
returns integer language plpgsql set search_path='' as $function$
declare covered integer; inserted integer;
begin
  insert into import_private.import_history_states_v3039(state_digest,row_values)
    select distinct matching.state_digest,matching.row_values
    from import_private.import_history_matching_batch_v3039(p_previous,p_rows) matching
    on conflict do nothing;
  insert into import_private.import_history_coverage_v3039(snapshot_id,row_number,state_digest)
    select p_snapshot,matching.row_number,matching.state_digest
    from import_private.import_history_matching_batch_v3039(p_previous,p_rows) matching
    join import_private.import_history_states_v3039 state using(state_digest)
    where state.row_values=matching.row_values and not exists(select 1
      from import_private.import_history_rows physical where physical.snapshot_id=p_snapshot
        and physical.row_number=matching.row_number)
    on conflict do nothing;
  get diagnostics covered=row_count;
  insert into import_private.import_history_rows(snapshot_id,row_number,row_values)
    select p_snapshot,input.row_number,input.row_values from import_private.import_history_batch_v3039(p_rows) input
    where not exists(select 1 from import_private.import_history_coverage_v3039 coverage
      where coverage.snapshot_id=p_snapshot and coverage.row_number=input.row_number)
    on conflict do nothing;
  get diagnostics inserted=row_count;
  return covered+inserted;
end
$function$;

create or replace function public.stage_import_history_rows_v1(p_snapshot_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='55s' as $function$
declare snapshot import_private.import_history_files; previous uuid; accepted integer; staged integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using errcode='42501',message='IMPORT_HISTORY_IMPORTER_FORBIDDEN';
  end if;
  if p_snapshot_id is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode='22023',message='IMPORT_HISTORY_STAGE_INVALID';
  end if;
  if jsonb_array_length(p_rows)>2000 then
    raise exception using errcode='22023',message='IMPORT_HISTORY_STAGE_INVALID';
  end if;
  select * into snapshot from import_private.import_history_files where id=p_snapshot_id for update;
  if not found then raise exception using errcode='P0002',message='IMPORT_HISTORY_SNAPSHOT_NOT_FOUND'; end if;
  if snapshot.status='ready' then
    if jsonb_array_length(p_rows)=0 then
      return jsonb_build_object('snapshotId',p_snapshot_id,'acceptedRows',0,'stagedRows',snapshot.staged_rows);
    end if;
    raise exception using errcode='55000',message='IMPORT_HISTORY_ALREADY_PUBLISHED';
  end if;
  staged:=import_private.validate_history_stage_v3039(snapshot,p_rows);
  previous:=import_private.import_history_predecessor_v3039(p_snapshot_id);
  accepted:=import_private.capture_history_stage_v3039(p_snapshot_id,previous,p_rows);
  update import_private.import_history_files set staged_rows=staged where id=p_snapshot_id and status='staging';
  return jsonb_build_object('snapshotId',p_snapshot_id,'acceptedRows',accepted,'stagedRows',staged);
end
$function$;

-- Keep the installed RPC grants, role validation and result shapes. Both
-- publication and paged reads must count/read the same logical row owner.
do $rewire_import_history$
declare target regprocedure; source text; rewritten text; physical text:='import_private.import_history_rows r';
begin
  foreach target in array array['public.publish_import_history_v1(uuid)'::regprocedure,
    'public.get_import_history_rows_v1(uuid,integer,integer)'::regprocedure] loop
    source:=pg_get_functiondef(target);
    rewritten:=replace(source,'from '||physical,'from import_private.import_history_logical_rows_v3039 r');
    if rewritten=source or (length(source)-length(replace(source,'from '||physical,'')))<>length('from '||physical) then
      raise exception 'IMPORT_HISTORY_READ_REWIRE_ANCHOR_INVALID';
    end if;
    execute rewritten;
  end loop;
end
$rewire_import_history$;

create function import_private.plan_import_history_delta_v3039(
  p_snapshot uuid,p_previous uuid,p_after integer,p_limit integer)
returns table(row_number integer,row_values jsonb,state_digest bytea)
language sql stable set search_path='' as $function$
  select current.row_number,current.row_values,sha256(convert_to(current.row_values::text,'UTF8'))
  from import_private.import_history_rows current
  join import_private.import_history_logical_rows_v3039 previous using(row_number)
  where current.snapshot_id=p_snapshot and previous.snapshot_id=p_previous
    and current.row_number>p_after and current.row_values=previous.row_values
    and not exists(select 1 from import_private.import_history_coverage_v3039 archived
      where archived.snapshot_id=p_snapshot and archived.row_number=current.row_number)
  order by current.row_number limit p_limit
$function$;

create function import_private.compact_import_history_delta_v3039(
  p_snapshot uuid,p_after integer default 0,p_limit integer default 500,p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='1s' set statement_timeout='10s' as $function$
declare previous uuid; next_row integer; eligible integer; removed integer:=0;
begin
  if session_user not in('postgres','supabase_admin') then
    raise exception using errcode='42501',message='IMPORT_HISTORY_DIRECT_MAINTENANCE_REQUIRED';
  end if;
  if p_snapshot is null or p_after is null or p_after<0 or p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode='22023',message='IMPORT_HISTORY_COMPACTION_SCOPE_INVALID';
  end if;
  if p_apply is true and not pg_try_advisory_xact_lock(hashtextextended('import-history-compaction-v3039',0)) then
    raise exception using errcode='55P03',message='IMPORT_HISTORY_COMPACTION_BUSY';
  end if;
  if import_private.import_history_complete_v3039(p_snapshot) then
    previous:=import_private.import_history_predecessor_v3039(p_snapshot);
  end if;
  if previous is null then
    return jsonb_build_object('status','receipt_or_predecessor_missing','eligible',0,'rows_removed',0,'done',true);
  end if;
  select count(*)::integer,max(row_number) into eligible,next_row
    from import_private.plan_import_history_delta_v3039(p_snapshot,previous,p_after,p_limit);
  if p_apply is true and eligible>0 then
    removed:=import_private.apply_import_history_delta_v3039(p_snapshot,previous,p_after,p_limit);
  end if;
  return jsonb_build_object('status',case when p_apply then 'applied' else 'dry_run' end,
    'eligible',eligible,'rows_removed',removed,'next_row',next_row,'done',eligible<p_limit);
end
$function$;

create function import_private.apply_import_history_delta_v3039(
  p_snapshot uuid,p_previous uuid,p_after integer,p_limit integer)
returns integer language plpgsql set search_path='' as $function$
declare removed integer; covered integer;
begin
  drop table if exists pg_temp.import_history_delta_plan_v3039;
  create temporary table import_history_delta_plan_v3039 on commit drop as
    select * from import_private.plan_import_history_delta_v3039(p_snapshot,p_previous,p_after,p_limit);
  insert into import_private.import_history_states_v3039(state_digest,row_values)
    select distinct state_digest,row_values from pg_temp.import_history_delta_plan_v3039
    on conflict do nothing;
  insert into import_private.import_history_coverage_v3039(snapshot_id,row_number,state_digest)
    select p_snapshot,plan.row_number,plan.state_digest
    from pg_temp.import_history_delta_plan_v3039 plan
    join import_private.import_history_states_v3039 state using(state_digest)
    where state.row_values=plan.row_values
    on conflict do nothing;
  get diagnostics covered=row_count;
  delete from import_private.import_history_rows physical
    using pg_temp.import_history_delta_plan_v3039 plan,
      import_private.import_history_coverage_v3039 coverage,import_private.import_history_states_v3039 state
    where physical.snapshot_id=p_snapshot and physical.snapshot_id=coverage.snapshot_id and physical.row_number=plan.row_number
      and physical.row_number=coverage.row_number and coverage.state_digest=state.state_digest
      and physical.row_values=state.row_values and physical.row_values=plan.row_values;
  get diagnostics removed=row_count;
  if covered<>removed then raise exception 'IMPORT_HISTORY_COVERAGE_RECONSTRUCTION_FAILED'; end if;
  return removed;
end
$function$;

revoke all on function import_private.import_history_complete_v3039(uuid),
  import_private.import_history_predecessor_v3039(uuid),import_private.import_history_batch_v3039(jsonb),
  import_private.validate_history_stage_v3039(import_private.import_history_files,jsonb),
  import_private.import_history_matching_batch_v3039(uuid,jsonb),
  import_private.capture_history_stage_v3039(uuid,uuid,jsonb),
  import_private.plan_import_history_delta_v3039(uuid,uuid,integer,integer),
  import_private.compact_import_history_delta_v3039(uuid,integer,integer,boolean),
  import_private.apply_import_history_delta_v3039(uuid,uuid,integer,integer)
  from public,anon,authenticated,service_role;

commit;
