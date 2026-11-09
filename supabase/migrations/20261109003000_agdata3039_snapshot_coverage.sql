begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Business state has an independent immutable owner. A coverage reference is
-- never resolved through a mutable Drive or Hold row.
create table if not exists private.history_snapshot_states_v3039 (
  relation_id regclass not null,
  state_digest bytea not null,
  business_state jsonb not null,
  primary key(relation_id,state_digest)
);
create table if not exists private.history_snapshot_coverage_v3039 (
  relation_id regclass not null,
  observation_id text not null,
  retained_id text not null,
  itemcode text,
  file_id text not null,
  observed_on date not null,
  state_digest bytea not null,
  provenance jsonb not null,
  primary key(relation_id,observation_id),
  foreign key(relation_id,state_digest) references private.history_snapshot_states_v3039(relation_id,state_digest)
);
create index if not exists history_snapshot_coverage_item_v3039
  on private.history_snapshot_coverage_v3039(relation_id,itemcode);
create index if not exists history_snapshot_coverage_file_v3039
  on private.history_snapshot_coverage_v3039(relation_id,file_id);
revoke all on private.history_snapshot_coverage_v3039,private.history_snapshot_states_v3039
  from public,anon,authenticated,service_role;
grant select on private.history_snapshot_coverage_v3039,private.history_snapshot_states_v3039
  to anon,authenticated,service_role;
alter table private.history_snapshot_coverage_v3039 enable row level security;
alter table private.history_snapshot_states_v3039 enable row level security;

-- The installed SELECT policies are role-wide plus the active-profile fence.
-- A new row-scoped predicate requires archive policy review before any pruning.
create or replace function public.snapshot_archive_policy_supported_v3039(p_relation oid)
returns boolean language sql stable security invoker set search_path='' as $function$
  with policies as (
    select *,regexp_replace(coalesce(pg_get_expr(polqual,polrelid),'true'),'\s+',' ','g') predicate
    from pg_policy where polrelid=p_relation and polcmd in('r','*')
  ), active_profile as (
    select oid from policies where polname='scheduled_handover_active_session' and not polpermissive
      and polroles=array['authenticated'::regrole::oid]
      and predicate='(( SELECT (private.current_active_profile()).id AS id) IS NOT NULL)'
  )
  select p_relation in('public.ph_drive_around_report_rows'::regclass::oid,
    'public.ph_hold_stop_itemcode_snapshots'::regclass::oid)
    and exists(select 1 from active_profile)
    and not exists(select 1 from policies where predicate<>'true' and oid not in(select oid from active_profile))
$function$;

create or replace function public.snapshot_coverage_visible_v3039(p_relation oid)
returns boolean language sql stable security invoker set search_path='' as $function$
  select exists(select 1 from pg_class relation
    where relation.oid=p_relation and has_table_privilege(current_user,p_relation,'select')
      and (not relation.relrowsecurity or exists(select 1 from pg_roles
        where rolname=current_user and (rolsuper or rolbypassrls))
        or (not relation.relforcerowsecurity and pg_has_role(current_user,relation.relowner,'USAGE'))
        or (public.snapshot_archive_policy_supported_v3039(p_relation) and exists(select 1
          from pg_policy policy cross join lateral unnest(policy.polroles) role_id
          where policy.polrelid=p_relation and policy.polpermissive and policy.polcmd in('r','*')
            and case when role_id=0 then true else pg_has_role(current_user,role_id,'USAGE') end))))
$function$;
revoke all on function public.snapshot_archive_policy_supported_v3039(oid) from public;
revoke all on function public.snapshot_coverage_visible_v3039(oid) from public;
grant execute on function public.snapshot_archive_policy_supported_v3039(oid),public.snapshot_coverage_visible_v3039(oid)
  to anon,authenticated,service_role;
create policy snapshot_coverage_read_v3039 on private.history_snapshot_coverage_v3039 for select
  to anon,authenticated,service_role using(public.snapshot_coverage_visible_v3039(relation_id));
create policy snapshot_state_read_v3039 on private.history_snapshot_states_v3039 for select
  to anon,authenticated,service_role using(public.snapshot_coverage_visible_v3039(relation_id));

create policy snapshot_coverage_active_profile_v3039 on private.history_snapshot_coverage_v3039
  as restrictive for select to authenticated using ((select (private.current_active_profile()).id) is not null);
create policy snapshot_state_active_profile_v3039 on private.history_snapshot_states_v3039
  as restrictive for select to authenticated using ((select (private.current_active_profile()).id) is not null);

create or replace function private.snapshot_provenance_fields_v3039()
returns text[] language sql immutable set search_path='' as $function$
  select array['unique_id','file_id','file_name','report_date','file_date','row_number','row_hash',
    'row_state_hash','created_at','updated_at','first_seen_at','last_seen_at','first_file_id',
    'last_file_id','first_file_name','last_file_name','last_report_date','seen_count',
    'canonical_sequence','file_rank','source_row_ids','last_unchanged_report_date']::text[]
$function$;

create or replace function private.snapshot_business_state_v3039(p_row jsonb)
returns jsonb language sql immutable set search_path='' as $function$
  select p_row-private.snapshot_provenance_fields_v3039()
$function$;

create or replace function private.snapshot_entity_v3039(p_relation regclass,p_row jsonb)
returns jsonb language sql immutable set search_path='' as $function$
  select case when p_relation='public.ph_hold_stop_itemcode_snapshots'::regclass
    then jsonb_build_array(p_row->'itemcode')
    else jsonb_build_array(p_row->'itemcode',p_row->'locationcode',p_row->'lotcode',p_row->'season',p_row->'saleyear') end
$function$;

create or replace function private.snapshot_read_relation_v3039(p_relation regclass)
returns regclass language plpgsql stable set search_path='' as $function$
begin
  if p_relation='public.ph_drive_around_report_rows'::regclass then
    return 'public.ph_drive_around_report_rows_snapshot_v3039'::regclass;
  elsif p_relation='public.ph_hold_stop_itemcode_snapshots'::regclass then
    return 'public.ph_hold_stop_itemcode_snapshots_snapshot_v3039'::regclass;
  end if;
  raise exception 'HISTORY_SNAPSHOT_RELATION_NOT_APPROVED' using errcode='22023';
end
$function$;

-- Captured observations have priority even when a rebuild recreates the UID.
-- Uncaptured observations remain readable through the original physical table.
create or replace function private.create_snapshot_read_view_v3039(p_relation regclass,p_name text)
returns void language plpgsql security definer set search_path='' as $function$
declare columns_sql text; reader_role text;
begin
  select string_agg(case a.attname
    when 'unique_id' then 'coverage.observation_id as unique_id'
    when 'file_id' then 'coverage.file_id as file_id'
    when 'itemcode' then 'coverage.itemcode as itemcode'
    when 'report_date' then 'coverage.observed_on as report_date'
    when 'file_date' then 'coverage.observed_on as file_date'
    else format('observation.%I',a.attname) end,',' order by a.attnum)
  into columns_sql from pg_attribute a where a.attrelid=p_relation and a.attnum>0 and not a.attisdropped;
  execute format('create or replace view public.%I with(security_invoker=true) as
    select physical.* from %s physical where not exists(select 1 from private.history_snapshot_coverage_v3039 archived
      where archived.relation_id=%L::regclass and archived.observation_id=physical.unique_id)
    union all select %s from private.history_snapshot_coverage_v3039 coverage
    join private.history_snapshot_states_v3039 state using(relation_id,state_digest)
    cross join lateral jsonb_populate_record(null::%s,state.business_state||coverage.provenance) observation
    where coverage.relation_id=%L::regclass',p_name,p_relation,p_relation::text,columns_sql,p_relation,p_relation::text);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',p_name);
  foreach reader_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(reader_role,p_relation,'select') then
      execute format('grant select on public.%I to %I',p_name,reader_role);
    end if;
  end loop;
end
$function$;

create or replace function private.snapshot_file_receipt_status_v3039(p_status text,p_count integer)
returns boolean language sql immutable set search_path='' as $function$
  select coalesce(p_count>=0 and (p_status in('processed','row_indexed','complete')
    or (p_status='empty' and p_count=0)),false)
$function$;

create or replace function private.snapshot_file_completion_v3039(p_relation regclass,p_file text)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare metadata record; actual_count bigint; expected_count bigint; raw_count bigint;
begin
  select file.* into metadata from public.ph_drive_around_report_files file where file.file_id=p_file;
  if metadata.file_id is null or not private.snapshot_file_receipt_status_v3039(metadata.status,metadata.row_count)
    or metadata.processed_at is null
    or coalesce(metadata.canonical_report_date,metadata.report_date) is null then
    return jsonb_build_object('ready',false,'reason','complete_file_receipt_missing');
  end if;
  execute format('select count(*) from %s where file_id=$1',private.snapshot_read_relation_v3039(p_relation))
    into actual_count using p_file;
  expected_count:=metadata.row_count;
  if p_relation='public.ph_hold_stop_itemcode_snapshots'::regclass then
    select count(*),count(distinct nullif(btrim(itemcode),'')) into raw_count,expected_count
      from public.ph_drive_around_report_rows_snapshot_v3039 where file_id=p_file;
    if raw_count<>metadata.row_count then
      return jsonb_build_object('ready',false,'reason','raw_file_count_not_complete');
    end if;
    if exists(
      (select distinct nullif(btrim(itemcode),'') from public.ph_drive_around_report_rows_snapshot_v3039
        where file_id=p_file and nullif(btrim(itemcode),'') is not null)
      except all
      (select itemcode from public.ph_hold_stop_itemcode_snapshots_snapshot_v3039 where file_id=p_file)
    ) then return jsonb_build_object('ready',false,'reason','hold_item_coverage_not_complete'); end if;
  end if;
  if actual_count<>expected_count then return jsonb_build_object('ready',false,'reason','source_count_not_complete',
    'expected',expected_count,'observed',actual_count); end if;
  return jsonb_build_object('ready',true,'observations',actual_count);
end
$function$;

create or replace function private.snapshot_file_order_v3039()
returns table(file_id text, sequence bigint)
language sql stable set search_path='' as $function$
  select f.file_id,row_number() over(order by coalesce(f.canonical_report_date,f.report_date),
    coalesce(f.canonical_sequence,999999),coalesce(nullif(btrim(f.canonical_file_name),''),f.file_name),f.file_id)
  from public.ph_drive_around_report_files f
$function$;

-- Protect physical DELETE targets; change SELECT/JOIN sources only. The result
-- must round-trip to the original definition with a literal inverse rename.
create or replace function private.rewrite_snapshot_reads_v3039(p_source text,p_table text,p_view text)
returns text language plpgsql immutable set search_path='' as $function$
declare guarded text; rewritten text;
begin
  guarded:=regexp_replace(p_source,'(\mdelete\s+from\s+)public[.]'||p_table||'\M',
    '\1public."__history_physical_write_v3039__"','gi');
  rewritten:=regexp_replace(guarded,'(\m(from|join)\s+)public[.]'||p_table||'\M',
    '\1public.'||p_view,'gi');
  return replace(rewritten,'"__history_physical_write_v3039__"',p_table);
end
$function$;

create or replace function private.retired_snapshot_compactor_v3039(p_function oid)
returns boolean language plpgsql stable security definer set search_path='' as $function$
declare function_name text;
begin
  select proname into function_name from pg_proc where oid=p_function;
  if function_name not in('merge_drive_around_report_state_v2366','deduplicate_drive_around_report_rows_batch_v1') then return false; end if;
  if exists(select 1 from pg_trigger where tgfoid=p_function and not tgisinternal and tgenabled<>'D') then return false; end if;
  if to_regclass('cron.job') is not null then
    if exists(select 1 from cron.job where jobname='agdata_historical_state_dedup_v2366' and active) then return false; end if;
  end if;
  return true;
end
$function$;

select private.create_snapshot_read_view_v3039('public.ph_drive_around_report_rows',
  'ph_drive_around_report_rows_snapshot_v3039');
select private.create_snapshot_read_view_v3039('public.ph_hold_stop_itemcode_snapshots',
  'ph_hold_stop_itemcode_snapshots_snapshot_v3039');

create or replace view public.ph_history_state_coverage_v3039 with(security_invoker=true) as
select relation_id,retained_id,itemcode,min(observed_on) first_unchanged_report_date,
  max(observed_on) last_unchanged_report_date,count(*) unchanged_observations
from private.history_snapshot_coverage_v3039 where observation_id<>retained_id
group by relation_id,retained_id,itemcode;
revoke all on public.ph_history_state_coverage_v3039 from public,anon,authenticated;
grant select on public.ph_history_state_coverage_v3039 to service_role;

revoke all on function private.snapshot_provenance_fields_v3039() from public,anon,authenticated,service_role;
revoke all on function private.snapshot_business_state_v3039(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.snapshot_entity_v3039(regclass,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.snapshot_read_relation_v3039(regclass) from public,anon,authenticated,service_role;
revoke all on function private.create_snapshot_read_view_v3039(regclass,text) from public,anon,authenticated,service_role;
revoke all on function private.rewrite_snapshot_reads_v3039(text,text,text) from public,anon,authenticated,service_role;
revoke all on function private.retired_snapshot_compactor_v3039(oid) from public,anon,authenticated,service_role;
revoke all on function private.snapshot_file_receipt_status_v3039(text,integer) from public,anon,authenticated,service_role;
revoke all on function private.snapshot_file_completion_v3039(regclass,text) from public,anon,authenticated,service_role;
revoke all on function private.snapshot_file_order_v3039() from public,anon,authenticated,service_role;
commit;
