begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create or replace function private.snapshot_delta_plan_v3039(p_relation regclass,p_itemcode text)
returns table(observation_id text,retained_id text,itemcode text,file_id text,observed_on date,
  payload jsonb,business_state jsonb,provenance jsonb)
language plpgsql security definer set search_path='' set statement_timeout='10s' as $function$
declare source_relation regclass; observation_count integer;
begin
  if p_itemcode is null or length(p_itemcode) not between 1 and 80 then
    raise exception 'HISTORY_ITEM_SCOPE_REQUIRED' using errcode='22023';
  end if;
  source_relation:=private.snapshot_read_relation_v3039(p_relation);
  execute format('select count(*) from(select 1 from %s where itemcode=$1 limit 5001) bounded',source_relation)
    into observation_count using p_itemcode;
  if observation_count>5000 then raise exception 'HISTORY_ITEM_EXCEEDS_5000_OBSERVATIONS'; end if;
  return query execute format($query$
    with source as materialized (
      select to_jsonb(r) payload,f.sequence from %s r
      left join private.snapshot_file_order_v3039() f on f.file_id=r.file_id where r.itemcode=$1
    ), prepared as (
      select payload,sequence,private.snapshot_entity_v3039($2,payload) entity,
        private.snapshot_business_state_v3039(payload) state from source
    ), multiplicities as (
      select *,count(*) over(partition by entity,sequence) multiplicity from prepared
    ), ordered as (
      select *,max(multiplicity) over(partition by entity)>1 ambiguous,
        lag(state) over cohort previous_state,lag(sequence) over cohort previous_sequence,
        lag(payload->>'file_id') over cohort previous_file,
        lag(coalesce(payload->>'report_date',payload->>'file_date')) over cohort previous_observed_on
      from multiplicities window cohort as(partition by entity order by sequence,payload->>'unique_id')
    ), comparable as materialized (
      select *,not ambiguous and sequence=previous_sequence+1 and state=previous_state
        and previous_observed_on is not null
        and coalesce(payload->>'report_date',payload->>'file_date') is not null as consecutive
      from ordered
    ), verification_files as (
      select payload->>'file_id' file_id from comparable where consecutive
      union select previous_file from comparable where consecutive
    ), verified as materialized (
      select file_id,(private.snapshot_file_completion_v3039($2,file_id)->>'ready')::boolean ready
      from verification_files
    ), runs as (
      select c.*,sum(case when c.consecutive and current_file.ready and previous_file.ready then 0 else 1 end)
        over(partition by entity order by sequence,payload->>'unique_id') as run
      from comparable c left join verified current_file on current_file.file_id=c.payload->>'file_id'
      left join verified previous_file on previous_file.file_id=c.previous_file
    ), planned as (
      select *,first_value(payload->>'unique_id') over(partition by entity,run
        order by sequence,payload->>'unique_id') kept from runs
    ) select payload->>'unique_id',kept,payload->>'itemcode',payload->>'file_id',
      coalesce(payload->>'report_date',payload->>'file_date')::date,payload,state,
      payload-array(select jsonb_object_keys(state)) from planned
    order by sequence,payload->>'unique_id'
  $query$,source_relation) using p_itemcode,p_relation;
end
$function$;

create or replace function private.snapshot_delta_reader_blockers_v3039(p_relation regclass)
returns jsonb language sql stable security definer set search_path='' as $function$
  select coalesce(jsonb_agg(consumer order by consumer),'[]'::jsonb) from (
    select distinct (n.nspname||'.'||p.proname)::text consumer
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname not in('pg_catalog','information_schema')
      and private.rewrite_snapshot_reads_v3039(p.prosrc,
        (select relname from pg_class where oid=p_relation),
        (select relname from pg_class where oid=private.snapshot_read_relation_v3039(p_relation)))<>p.prosrc
      and not private.retired_snapshot_compactor_v3039(p.oid)
      and p.proname not in('snapshot_delta_plan_v3039','snapshot_delta_reader_blockers_v3039','rewrite_snapshot_reads_v3039',
        'snapshot_file_completion_v3039')
    union
    select (n.nspname||'.'||c.relname)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='v' and n.nspname not in('pg_catalog','information_schema')
      and c.oid<>private.snapshot_read_relation_v3039(p_relation)
      and pg_get_viewdef(c.oid) ~* ('\m(from|join)\s+(public[.])?'||
        (select relname from pg_class where oid=p_relation)||'\M')
  ) consumers
$function$;

create or replace function private.snapshot_delta_report_v3039(p_relation regclass,p_itemcode text)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='10s' as $function$
declare result jsonb;
begin
  execute format($query$
    select jsonb_build_object('relation',$1::text,'itemcode',$2,
      'observations',count(*),'state_changes_kept',count(*) filter(where plan.observation_id=plan.retained_id),
      'consecutive_unchanged',count(*) filter(where plan.observation_id<>plan.retained_id),
      'last_unchanged_report_date',max(plan.observed_on) filter(where plan.observation_id<>plan.retained_id),
      'physical_rows_eligible',count(physical.unique_id))
    from private.snapshot_delta_plan_v3039($1,$2) plan
    left join %s physical on physical.unique_id=plan.observation_id
      and plan.observation_id<>plan.retained_id and to_jsonb(physical)=plan.payload
  $query$,p_relation) into result using p_relation,p_itemcode;
  return result||jsonb_build_object('reader_blockers',private.snapshot_delta_reader_blockers_v3039(p_relation),
    'production_writes',0);
end
$function$;

revoke all on function private.snapshot_delta_plan_v3039(regclass,text) from public,anon,authenticated,service_role;
revoke all on function private.snapshot_delta_reader_blockers_v3039(regclass) from public,anon,authenticated,service_role;
revoke all on function private.snapshot_delta_report_v3039(regclass,text) from public,anon,authenticated,service_role;
commit;
