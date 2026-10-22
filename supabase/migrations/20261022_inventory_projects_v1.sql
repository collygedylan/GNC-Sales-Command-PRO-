begin;

create extension if not exists pgcrypto;

create table if not exists public.inventory_projects (
  id uuid primary key default gen_random_uuid(),
  project_name text not null,
  instructions text not null default '',
  assigned_users jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active','completed')),
  created_by text not null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_project_rows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.inventory_projects(id) on delete cascade,
  itemcode text not null,
  locationcode text not null,
  lotcode text not null,
  commonname text not null default '',
  contsize text not null default '',
  row_instructions text not null default '',
  status text not null default 'pending' check (status in ('pending','done')),
  completed_by text,
  completed_at timestamptz,
  snapshot_metrics jsonb not null default '{}'::jsonb,
  added_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id,itemcode,locationcode,lotcode)
);

create index if not exists inventory_project_rows_project_location_idx
  on public.inventory_project_rows(project_id,locationcode,lotcode);
alter table public.inventory_projects enable row level security;
alter table public.inventory_project_rows enable row level security;
revoke all on public.inventory_projects, public.inventory_project_rows from public, anon, authenticated;
grant select, insert, update, delete on public.inventory_projects, public.inventory_project_rows to service_role;

create or replace function public.recover_stale_master_imports_v1(
  p_older_than timestamptz default clock_timestamp() - interval '4 minutes'
) returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  run_ids uuid[];
  source_keys text[];
  recovered_runs integer := 0;
  recovered_revisions integer := 0;
  cleared_stages integer := 0;
begin
  if not private.is_service_role_request() then
    raise exception using errcode='42501', message='MASTER_IMPORT_RECOVERY_FORBIDDEN';
  end if;
  if p_older_than is null or p_older_than > clock_timestamp() then
    raise exception using errcode='22023', message='MASTER_IMPORT_RECOVERY_CUTOFF_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('master-import-recovery-v1', 0));
  select array_agg(run.id order by run.created_at)
  into run_ids
  from app_sync_private.import_runs run
  where 'ph_master_inventory'=any(run.canonical_keys)
    and (run.state='failed' or (run.state='active' and run.created_at <= p_older_than));

  if coalesce(cardinality(run_ids), 0)=0 then
    return jsonb_build_object('ok',true,'recoveredRuns',0,'recoveredRevisions',0,'clearedStages',0);
  end if;

  select array_agg(distinct source_key order by source_key)
  into source_keys
  from app_sync_private.import_runs run
  cross join lateral unnest(run.source_keys) source_key
  where run.id=any(run_ids);

  delete from app_sync_private.ph_master_snapshot_stage_v1 stage
  where stage.run_id=any(run_ids) and stage.status='staging';
  get diagnostics cleared_stages = row_count;

  update app_sync_private.import_runs
  set state='failed', finished_at=coalesce(finished_at, clock_timestamp())
  where id=any(run_ids) and state='active';
  get diagnostics recovered_runs = row_count;

  delete from app_sync_private.import_leases where run_id=any(run_ids);
  update public.app_dataset_revisions revision
  set state='ready', changed_at=clock_timestamp()
  where revision.key=any(source_keys)
    and revision.state in ('importing','interrupted')
    and not exists (
      select 1 from app_sync_private.import_leases lease
      join app_sync_private.import_runs active_run on active_run.id=lease.run_id
      where lease.key=revision.key and active_run.state='active' and active_run.expires_at>clock_timestamp()
    );
  get diagnostics recovered_revisions = row_count;

  return jsonb_build_object(
    'ok',true,
    'recoveredRuns',recovered_runs,
    'recoveredRevisions',recovered_revisions,
    'clearedStages',cleared_stages
  );
end
$function$;
revoke all on function public.recover_stale_master_imports_v1(timestamptz) from public, anon, authenticated;
grant execute on function public.recover_stale_master_imports_v1(timestamptz) to service_role;

do $block$
declare
  definition text;
  owner_gate text := 'if actor.id is null or coalesce(lower(btrim(actor.username)),'''')<>''dylan_collyge''';
  role_gate text := 'if actor.id is null or (actor_role not in (''ADMIN'',''ADMINISTRATOR'',''MANAGER'',''REP'',''SALESREP'',''CSR'') and actor.username<>''dylan_collyge'')';
  context_owner_gate text := $old$if actor.id is null or coalesce(lower(btrim(actor.username)),'')<>'dylan_collyge'$old$;
  context_role_gate text := $new$if actor.id is null or (upper(regexp_replace(coalesce(actor.role,''),'^[[:space:]]+|[[:space:]]+$','','g')) not in ('ADMIN','ADMINISTRATOR','MANAGER','REP','SALESREP','CSR')
      and actor.username<>'dylan_collyge')$new$;
  soc_owner_gate text := $old$if actor.id is null or coalesce(lower(btrim(actor_name)),'')<>'dylan_collyge'$old$;
  soc_role_gate text := $new$if actor.id is null or (actor_role not in ('ADMIN','ADMINISTRATOR','MANAGER','REP','SALESREP','CSR') and actor_name<>'dylan_collyge')$new$;
begin
  definition:=pg_get_functiondef('public.aura_voice_access_v1()'::regprocedure);
  if position(owner_gate in definition)>0 then execute replace(definition,owner_gate,role_gate);
  elsif position(role_gate in definition)=0 then raise exception 'AURA_ACCESS_GUARD_MISSING';
  end if;

  definition:=pg_get_functiondef('public.aura_voice_context_v1()'::regprocedure);
  if position(context_owner_gate in definition)>0 then execute replace(definition,context_owner_gate,context_role_gate);
  elsif position(context_role_gate in definition)=0 then raise exception 'AURA_CONTEXT_GUARD_MISSING';
  end if;

  definition:=pg_get_functiondef('public.aura_voice_inventory_read_v1(text,jsonb,jsonb,integer)'::regprocedure);
  if position(owner_gate in definition)>0 then execute replace(definition,owner_gate,role_gate);
  elsif position(role_gate in definition)=0 then raise exception 'AURA_INVENTORY_GUARD_MISSING';
  end if;

  definition:=pg_get_functiondef('public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)'::regprocedure);
  if position(soc_owner_gate in definition)>0 then execute replace(definition,soc_owner_gate,soc_role_gate);
  elsif position(soc_role_gate in definition)=0 then raise exception 'AURA_SOC_GUARD_MISSING';
  end if;
end
$block$;

update public.app_dataset_revisions
set state='ready', changed_at=now()
where state='interrupted'
  and not exists (
    select 1 from app_sync_private.import_leases lease
    join app_sync_private.import_runs run on run.id=lease.run_id
    where lease.key=app_dataset_revisions.key and run.state='active' and run.expires_at>clock_timestamp()
  );

commit;
