-- Durable, metadata-only invalidation. No inventory grants, source rows, or
-- business policies are changed. Imported files remain multi-transaction: the
-- fence explicitly prevents a partially imported source being called current.
create schema if not exists app_sync_private;
revoke all on schema app_sync_private from public, anon, authenticated;

create table app_sync_private.sources (
  key text primary key,
  modules text[] not null,
  client_enabled boolean not null default true,
  dylan_only boolean not null default false
);
create table public.app_dataset_revisions (
  key text primary key references app_sync_private.sources(key),
  revision bigint not null default 1 check (revision > 0),
  state text not null default 'ready' check (state in ('ready','importing','interrupted')),
  changed_at timestamptz not null default clock_timestamp()
);
create table app_sync_private.import_runs (
  id uuid primary key,
  source_keys text[] not null,
  canonical_keys text[] not null,
  state text not null check (state in ('active','completed','failed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);
create table app_sync_private.import_leases (
  key text primary key references app_sync_private.sources(key),
  run_id uuid not null references app_sync_private.import_runs(id)
);
create index app_dataset_import_lease_run_idx on app_sync_private.import_leases(run_id);
alter table public.app_dataset_revisions enable row level security;
alter table app_sync_private.sources enable row level security;
alter table app_sync_private.import_runs enable row level security;
alter table app_sync_private.import_leases enable row level security;
revoke all on public.app_dataset_revisions from public, anon, authenticated;
revoke all on all tables in schema app_sync_private from public, anon, authenticated;
grant select on public.app_dataset_revisions to authenticated;

-- Keys are physical sources, not UI aliases or SQL views. Joined views must
-- compare every dependency. Only existing real tables receive a revision row.
insert into app_sync_private.sources(key,modules,dylan_only) values
('ph_master_inventory','{drive,tasks,docks,request,reserves,av,sales,sales-office,office,moves,managers,production,production-workflow,shear-list,weather-hold,review,move-up,low-stock,sales-inventory,crop-roll,qc,po-management,reports,building,grower,pest-management,take-back,advertisement}',false),
('ph_soc_master','{docks,request,sales,reports,qc,po-management}',false),
('ph_active_request','{request,tasks,drive,sales,managers,reports}',false),
('ph_request_delivery_outbox','{request,tasks,drive,sales,managers,reports}',false),
('ph_request_history','{request,tasks,sales,managers,reports}',false),
('ph_sales_credit_requests','{sales,request,managers}',false),
('ph_inventory_edit_requests','{request,drive,tasks,managers}',false),
('ph_inventory_edit_request_events','{request,drive,tasks,managers}',false),
('ph_av_option_eval_requests','{request,drive,tasks,managers}',false),
('ph_reserves','{reserves,av,drive,tasks,sales,shear-list,weather-hold}',false),
('ph_customer_consignee_sales_reps','{request,drive,tasks,sales,docks,reserves,reports}',false),
('ph_sales_office','{sales-office,office,moves,sales,drive,tasks,request,managers}',false),
('ph_flyer_folder_rows','{tasks,drive,managers,advertisement}',false),
('ph_flyer_folder_history','{tasks,drive,managers,advertisement}',false),
('ph_grower_scout_reports','{grower,pest-management,tasks}',false),
('ph_grower_scout_assets','{grower,pest-management,tasks}',false),
('ph_warehouse_assigned_items','{drive,tasks,managers,request}',false),
('ph_cav_import','{av,tasks,sales,managers,drive,advertisement}',false),
('ph_av_notes','{av,drive,sales}',false),
('ph_app_settings','{drive,tasks,docks,request,reserves,av,sales,sales-office,managers,production,production-workflow,shear-list,weather-hold,review,move-up,low-stock,sales-inventory,crop-roll,qc,po-management,reports}',false),
('ph_crop_roll_drive_rows','{crop-roll,drive}',false),
('ph_crop_roll_completed_drive_keys','{crop-roll,drive}',false),
('ph_crop_roll_runs','{crop-roll}',false),
('ph_crop_roll_rows','{crop-roll}',false),
('ph_dock_trip_status','{docks,qc,request}',false),
('ph_dock_team_status','{docks,qc,request}',false),
('ph_dock_item_status','{docks,qc,request}',false),
('ph_dock_issue_status','{docks,qc,request}',false),
('ph_dock_issue_allocations','{docks,qc,request}',false),
('ph_ncr_completions','{review,move-up,drive,tasks,managers}',false),
('ph_take_back_queue','{take-back,request}',false),
('ph_shear_list','{shear-list,tasks}',false),
('ph_production_workflow_rows','{production,production-workflow}',false),
('ph_spread_counts','{production,production-workflow}',false),
('ph_bunch_counts','{production,production-workflow}',false),
('ph_eval_work','{tasks,managers}',false),
('ph_eval_work_origin_rows','{tasks,managers}',false),
('ph_eval_work_events','{tasks,managers}',false),
('ph_eval_report_settings','{tasks,managers}',false),
('ph_shear_location_inquiries','{shear-list,tasks,drive}',false),
('ph_shear_location_items','{shear-list,tasks,drive}',false),
('ph_shear_location_rows','{shear-list,tasks,drive}',false),
('ph_location_work_jobs','{tasks,drive,request,managers}',false),
('ph_location_work_lines','{tasks,drive,request,managers}',false),
('ph_location_work_assignments','{tasks,drive,request,managers}',false),
('ph_item_inquiry_coverage','{drive,tasks,managers}',false),
('ph_27f1_hl_po','{po-management}',false),
('ph_department_calendar_events','{department-calendar,communication}',false),
('ph_chat_conversations','{chat,communication}',false),
('ph_chat_participants','{chat,communication}',false),
('ph_chat_messages','{chat,communication}',false),
('profiles','{chat,communication,department-calendar,managers,docks,tasks,request,drive}',false),
('ph_app_users','{chat,communication,department-calendar,managers,docks,tasks,request,drive}',false),
('ph_weather_hourly','{weather-hold}',false),
('ph_weather_daily','{weather-hold}',false),
('ph_hold_stop_itemcode_summaries','{weather-hold}',false),
('ph_hold_learning_profiles','{weather-hold}',false),
('ph_hold_release_cycles','{weather-hold}',false),
('ph_hold_learning_events','{weather-hold}',false),
('ph_drive_around_report_files','{weather-hold,managers,reports}',false),
('ph_drive_around_report_rows','{weather-hold,managers,reports}',false),
('ph_labor_hours','{hours,managers}',false),
('ph_productivity_history','{managers,reports}',false),
('ph_inventory_transactions','{drive,managers,reports}',false),
('ph_pikes_order_batches','{managers}',false),
('ph_pikes_order_source_rows','{managers}',false),
('ph_pikes_order_inventory_rows','{managers}',false),
('ph_transactions_keyed_files','{managers}',false),
('ph_transactions_keyed_rows','{managers}',false),
('ph_historical_inventory_dimensions','{managers,reports}',false),
('private.app_access_permissions','{}',false),
('private.app_access_policy_versions','{}',false),
('private.app_access_role_grants','{}',false),
('private.app_access_user_overrides','{}',false),
('private.app_access_maintainers','{}',false),
('private.app_access_legacy_baseline','{}',false),
('private.app_access_legacy_checks','{}',false),
('private.app_access_runtime_state','{}',false),
('private.codex_ops_tasks','{}',true),
('private.codex_ops_messages','{}',true),
('private.codex_ops_events','{}',true),
('private.codex_ops_attachments','{}',true),
('private.codex_ops_approvals','{}',true),
('ph_runtime_feature_flags','{}',true),
('bloomscapes_private.orders','{sales}',true),
('bloomscapes_private.order_lines','{sales}',true);

-- Existing dormant farm tables may be fenced by the trusted importer, but this
-- release does not enable their client routing or invent division permissions.
insert into app_sync_private.sources(key,modules,client_enabled,dylan_only)
select farm.prefix || substring(s.key from 3), s.modules, false, s.dylan_only
from app_sync_private.sources s cross join (values ('tx'),('nc'),('hl')) farm(prefix)
where s.key like 'ph\_%' escape '\'
  and exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=farm.prefix || substring(s.key from 3) and c.relkind in ('r','p'));

create function app_sync_private.active_actor() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare claims jsonb := auth.jwt(); actor uuid := auth.uid(); profile public.profiles;
begin
  if actor is null or claims->>'role' is distinct from 'authenticated'
    or coalesce((claims->>'exp')::numeric,0) <= extract(epoch from now())
    or not exists (select 1 from auth.sessions s where s.user_id=actor
      and s.id::text=claims->>'session_id' and (s.not_after is null or s.not_after>now())) then
    return null;
  end if;
  profile := private.current_active_profile();
  if profile.id is null or profile.must_change_password is distinct from false then return null; end if;
  return profile.id;
end $$;

create function app_sync_private.can_read_source(p_key text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from app_sync_private.sources source
    join public.profiles profile on profile.id=app_sync_private.active_actor()
    where source.key=p_key and source.client_enabled
      and (not source.dylan_only or profile.username='dylan_collyge')
      and (case when source.key like 'private.app_access\_%' escape '\' then private.can_view_access_control_v2()
        when source.key like 'private.codex_ops\_%' escape '\' or source.key='ph_runtime_feature_flags' then profile.username='dylan_collyge'
        else exists (select 1 from private.get_effective_app_permissions_v1(profile.id,
        private.resolve_app_access_policy_id_v1(false)) permission
        where permission.allowed and permission.permission_kind='module'
          and permission.module_key=any(source.modules)) end)
  )
$$;
create policy app_dataset_revision_read on public.app_dataset_revisions for select to authenticated
using (app_sync_private.can_read_source(key));

create function app_sync_private.snapshot(p_dataset_keys text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; actor uuid := app_sync_private.active_actor(); version text; actor_scope jsonb;
  permissions jsonb; allowed_modules text[]; access_control_allowed boolean;
begin
  if actor is null then raise exception using errcode='42501',message='DATASET_SESSION_REQUIRED'; end if;
  if p_dataset_keys is null or (select count(distinct k) from unnest(p_dataset_keys) k)>64 or exists (
    select 1 from unnest(p_dataset_keys) k where k is null or not exists (
      select 1 from app_sync_private.sources s where s.key=k)) then
    raise exception using errcode='22023',message='DATASET_KEYS_INVALID';
  end if;
  -- Include current effective permissions in the version, not only the policy
  -- number: disabling a profile or changing a user override must invalidate it.
  select jsonb_build_object('id',p.id,'username',p.username,'role',p.role,'division',p.division)
    into actor_scope from public.profiles p where p.id=actor;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.permission_key),'[]'::jsonb),
    coalesce(array_agg(p.module_key) filter(where p.allowed and p.permission_kind='module'),'{}'::text[])
    into permissions,allowed_modules
  from private.get_effective_app_permissions_v1(actor,private.resolve_app_access_policy_id_v1(false)) p;
  version := md5(actor_scope::text||permissions::text);
  access_control_allowed := private.can_view_access_control_v2();
  select coalesce(jsonb_agg(jsonb_build_object(
    'key',k.key,'revision',case when allowed and r.key is not null then r.revision::text else null end,
    'state',case when not allowed or r.key is null then 'unavailable'
      when r.state='importing' and not exists (
        select 1 from app_sync_private.import_leases l join app_sync_private.import_runs run on run.id=l.run_id
        where l.key=k.key and run.state='active' and run.expires_at>statement_timestamp()) then 'interrupted'
      else r.state end,
    'changedAt',case when allowed then r.changed_at else null end) order by k.key),'[]'::jsonb) into result
  from (select distinct unnest(p_dataset_keys) as key) k
  join app_sync_private.sources source on source.key=k.key
  cross join lateral (select source.client_enabled and
    (not source.dylan_only or actor_scope->>'username'='dylan_collyge') and
    case when source.key like 'private.app_access\_%' escape '\' then access_control_allowed
      when source.key like 'private.codex_ops\_%' escape '\' or source.key='ph_runtime_feature_flags'
        then actor_scope->>'username'='dylan_collyge'
      else source.modules && allowed_modules end as allowed) access
  left join public.app_dataset_revisions r on r.key=k.key;
  return jsonb_build_object('contractVersion',1,'serverTime',statement_timestamp(),
    'permissionVersion',version,'sources',result);
end $$;
create function public.get_my_dataset_revisions_v1(p_dataset_keys text[]) returns jsonb
language sql stable security invoker set search_path='' as $$
  select app_sync_private.snapshot(p_dataset_keys)
$$;

create function app_sync_private.touch_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare source_key text := case when tg_table_schema='public' then tg_table_name else tg_table_schema||'.'||tg_table_name end;
  header_run text; run app_sync_private.import_runs; touched jsonb;
  current_revision public.app_dataset_revisions;
begin
  -- A source can be touched once per imported row by an existing derived-row
  -- trigger. Keep this fast path transaction-local: only the first touch locks
  -- the revision row and validates the request's immutable import header.
  touched := coalesce(nullif(current_setting('app_sync.touched',true),'')::jsonb,'{}'::jsonb);
  if touched ? source_key then return null; end if;
  select * into current_revision from public.app_dataset_revisions where key=source_key for update;
  if not found then raise exception using errcode='55000',message='DATASET_SOURCE_UNREGISTERED'; end if;
  header_run := nullif(current_setting('request.headers',true),'')::jsonb->>'x-gnc-import-run-id';
  if header_run is not null then
    select * into run from app_sync_private.import_runs where id::text=header_run;
    if run.id is null then raise exception using errcode='55000',message='DATASET_IMPORT_TOKEN_INVALID'; end if;
    if run.state<>'active' or run.expires_at<=clock_timestamp() then
      raise exception using errcode='55000',message='DATASET_IMPORT_FENCE_LOST';
    end if;
    -- Derived writes outside the file's declared sources still have their own
    -- revision. The imported source always enforces the writer's exact fence.
    if source_key=any(run.source_keys) and not exists(
      select 1 from app_sync_private.import_leases where key=source_key and run_id=run.id) then
      raise exception using errcode='55000',message='DATASET_IMPORT_FENCE_LOST';
    end if;
  end if;
  perform set_config('app_sync.touched',(touched||jsonb_build_object(source_key,true))::text,true);
  if current_revision.state='importing' then
    -- Lock is held until the source transaction commits, so finish cannot
    -- publish ready ahead of a concurrent, already-acknowledged source write.
    return null;
  end if;
  update public.app_dataset_revisions set revision=revision+1,changed_at=clock_timestamp() where key=source_key;
  return null;
end $$;

create function app_sync_private.begin_import(p_dataset_keys text[],p_run_id uuid,p_canonical_keys text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare keys text[]; canonical text[]; run app_sync_private.import_runs; k text; other app_sync_private.import_runs;
begin
  select array_agg(distinct requested.source_key order by requested.source_key) into keys
    from unnest(p_dataset_keys) requested(source_key);
  select array_agg(distinct requested.source_key order by requested.source_key) into canonical
    from unnest(coalesce(p_canonical_keys,keys)) requested(source_key);
  if p_run_id is null or keys is null or cardinality(keys)>64 or array_position(keys,null) is not null
    or canonical is null or array_position(canonical,null) is not null or not canonical <@ keys
    or exists(select 1 from unnest(keys) requested(source_key) where not exists(
      select 1 from public.app_dataset_revisions r where r.key=requested.source_key)) then
    raise exception using errcode='22023',message='DATASET_IMPORT_KEYS_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dataset-import:'||p_run_id::text,0));
  select * into run from app_sync_private.import_runs where id=p_run_id;
  if found then
    if run.source_keys<>keys or run.canonical_keys<>canonical then raise exception using errcode='22023',message='DATASET_IMPORT_TOKEN_CONFLICT'; end if;
    if run.state='active' and run.expires_at<=clock_timestamp() then
      raise exception using errcode='55000',message='DATASET_IMPORT_EXPIRED';
    end if;
    return jsonb_build_object('ok',true,'runId',run.id,'state',run.state);
  end if;
  perform 1 from public.app_dataset_revisions where key=any(keys) order by key for update;
  foreach k in array keys loop
    select r.* into other from app_sync_private.import_leases l join app_sync_private.import_runs r on r.id=l.run_id where l.key=k;
    if found and other.state='active' and other.expires_at>clock_timestamp() then
      raise exception using errcode='55000',message='DATASET_IMPORT_BUSY';
    end if;
    if other.id is not null and not other.canonical_keys <@ canonical then
      raise exception using errcode='55000',message='DATASET_RECOVERY_REQUIRES_CANONICAL_SOURCE';
    end if;
  end loop;
  insert into app_sync_private.import_runs(id,source_keys,canonical_keys,state,expires_at)
    values(p_run_id,keys,canonical,'active',clock_timestamp()+interval '12 minutes');
  insert into app_sync_private.import_leases(key,run_id) select unnest(keys),p_run_id
    on conflict(key) do update set run_id=excluded.run_id;
  update public.app_dataset_revisions set state='importing',revision=revision+1,changed_at=clock_timestamp() where key=any(keys);
  perform set_config('app_sync.touched',(coalesce(nullif(current_setting('app_sync.touched',true),'')::jsonb,'{}'::jsonb)-keys)::text,true);
  return jsonb_build_object('ok',true,'runId',p_run_id,'state','active');
end $$;

create function app_sync_private.advance_import(p_run_id uuid,p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare run app_sync_private.import_runs; target text;
begin
  if p_action not in ('heartbeat','finish','fail') then raise exception 'DATASET_IMPORT_ACTION_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('dataset-import:'||p_run_id::text,0));
  select * into run from app_sync_private.import_runs where id=p_run_id;
  if not found then raise exception using errcode='55000',message='DATASET_IMPORT_TOKEN_INVALID'; end if;
  target := case p_action when 'finish' then 'completed' when 'fail' then 'failed' else 'active' end;
  if run.state<>'active' then
    if run.state=target then return jsonb_build_object('ok',true,'runId',run.id,'state',run.state); end if;
    raise exception using errcode='55000',message='DATASET_IMPORT_ALREADY_CLOSED';
  end if;
  if p_action<>'fail' and run.expires_at<=clock_timestamp() then
    raise exception using errcode='55000',message='DATASET_IMPORT_EXPIRED';
  end if;
  perform 1 from public.app_dataset_revisions where key=any(run.source_keys) order by key for update;
  if exists(select 1 from unnest(run.source_keys) requested(source_key) where not exists(
    select 1 from app_sync_private.import_leases l where l.key=requested.source_key and l.run_id=run.id)) then
    raise exception using errcode='55000',message='DATASET_IMPORT_FENCE_LOST';
  end if;
  if p_action='heartbeat' then
    update app_sync_private.import_runs set expires_at=clock_timestamp()+interval '12 minutes' where id=run.id;
  else
    update app_sync_private.import_runs set state=target,finished_at=clock_timestamp() where id=run.id;
    update public.app_dataset_revisions set state=case when p_action='finish' then 'ready' else 'interrupted' end,
      revision=revision+1,changed_at=clock_timestamp() where key=any(run.source_keys);
    -- Failed roots stay associated with every companion dataset. An unrelated
    -- import may not declare a partial old snapshot recovered merely because
    -- its derived writes happen to overlap the same tables.
    if p_action='finish' then delete from app_sync_private.import_leases where run_id=run.id; end if;
    perform set_config('app_sync.touched',(coalesce(nullif(current_setting('app_sync.touched',true),'')::jsonb,'{}'::jsonb)-run.source_keys)::text,true);
  end if;
  return jsonb_build_object('ok',true,'runId',run.id,'state',target);
end $$;
create function public.begin_dataset_import_v1(p_dataset_keys text[],p_run_id uuid,p_canonical_keys text[] default null) returns jsonb
language sql security invoker set search_path='' as $$ select app_sync_private.begin_import(p_dataset_keys,p_run_id,p_canonical_keys) $$;
create function public.heartbeat_dataset_import_v1(p_run_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select app_sync_private.advance_import(p_run_id,'heartbeat') $$;
create function public.finish_dataset_import_v1(p_run_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select app_sync_private.advance_import(p_run_id,'finish') $$;
create function public.fail_dataset_import_v1(p_run_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select app_sync_private.advance_import(p_run_id,'fail') $$;
create function app_sync_private.import_status(p_dataset_keys text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if p_dataset_keys is null or (select count(distinct k) from unnest(p_dataset_keys) k)>64 or exists(
    select 1 from unnest(p_dataset_keys) requested(source_key) where requested.source_key is null
      or not exists(select 1 from public.app_dataset_revisions r where r.key=requested.source_key)) then
    raise exception using errcode='22023',message='DATASET_IMPORT_KEYS_INVALID';
  end if;
  return jsonb_build_object('ok',true,'requiresRecovery',exists(
    select 1 from public.app_dataset_revisions r where r.key=any(p_dataset_keys) and
      (r.state='interrupted' or (r.state='importing' and not exists(
        select 1 from app_sync_private.import_leases l join app_sync_private.import_runs run on run.id=l.run_id
        where l.key=r.key and run.state='active' and run.expires_at>statement_timestamp())))));
end $$;
create function public.get_dataset_import_status_v1(p_dataset_keys text[]) returns jsonb
language sql stable security invoker set search_path='' as $$select app_sync_private.import_status(p_dataset_keys)$$;

revoke all on all functions in schema app_sync_private from public,anon,authenticated;
revoke all on function public.get_my_dataset_revisions_v1(text[]) from public,anon,authenticated;
revoke all on function public.begin_dataset_import_v1(text[],uuid,text[]) from public,anon,authenticated;
revoke all on function public.heartbeat_dataset_import_v1(uuid) from public,anon,authenticated;
revoke all on function public.finish_dataset_import_v1(uuid) from public,anon,authenticated;
revoke all on function public.fail_dataset_import_v1(uuid) from public,anon,authenticated;
revoke all on function public.get_dataset_import_status_v1(text[]) from public,anon,authenticated;
grant usage on schema app_sync_private to authenticated,service_role;
grant execute on function app_sync_private.can_read_source(text),app_sync_private.snapshot(text[]) to authenticated;
grant execute on function public.get_my_dataset_revisions_v1(text[]) to authenticated;
grant execute on function app_sync_private.begin_import(text[],uuid,text[]),app_sync_private.advance_import(uuid,text) to service_role;
grant execute on function app_sync_private.import_status(text[]),public.get_dataset_import_status_v1(text[]) to service_role;
grant execute on function public.begin_dataset_import_v1(text[],uuid,text[]),public.heartbeat_dataset_import_v1(uuid),
  public.finish_dataset_import_v1(uuid),public.fail_dataset_import_v1(uuid) to service_role;

do $$ declare source record; begin
  for source in select s.key,n.nspname,c.relname from app_sync_private.sources s
    join pg_catalog.pg_class c on c.relname=case when position('.' in s.key)>0 then split_part(s.key,'.',2) else s.key end
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname=case when position('.' in s.key)>0 then split_part(s.key,'.',1) else 'public' end
      and c.relkind in ('r','p') order by s.key loop
    insert into public.app_dataset_revisions(key) values(source.key);
    execute format('create trigger app_dataset_revision_changed after insert or update or delete or truncate on %I.%I for each statement execute function app_sync_private.touch_source()',source.nspname,source.relname);
  end loop;
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.app_dataset_revisions;
  end if;
end $$;
comment on table public.app_dataset_revisions is 'Authenticated opaque source revisions; never a source-row or inventory stream. Import states are consistency fences, not atomic file transactions.';
notify pgrst, 'reload schema';
