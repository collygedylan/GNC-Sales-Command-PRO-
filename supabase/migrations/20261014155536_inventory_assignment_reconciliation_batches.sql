begin;
-- @test-runtime: isolated-supabase
-- Resume assignment resolution in bounded transactions while preserving the
-- existing resolver and publication fence.

create table private.inventory_row_assignment_reconcile_runs (
  import_run_id uuid primary key references app_sync_private.import_runs(id) on delete cascade,
  source_witness text not null,
  processed_count integer not null default 0 check (processed_count >= 0),
  retired_count integer not null default 0 check (retired_count >= 0),
  total_count integer not null default 0 check (total_count >= 0),
  reset_count smallint not null default 0 check (reset_count between 0 and 1),
  source_revision bigint not null,
  updated_at timestamptz not null default clock_timestamp()
);
create table private.inventory_row_assignment_reconcile_worklist (
  import_run_id uuid not null references private.inventory_row_assignment_reconcile_runs(import_run_id) on delete cascade,
  ordinal integer not null check (ordinal > 0),
  master_unique_id text not null,
  work_kind text not null check (work_kind in ('source','retire')),
  primary key (import_run_id, ordinal),
  unique (import_run_id, master_unique_id)
);
alter table private.inventory_row_assignment_reconcile_runs enable row level security;
alter table private.inventory_row_assignment_reconcile_worklist enable row level security;
revoke all on private.inventory_row_assignment_reconcile_runs,
  private.inventory_row_assignment_reconcile_worklist from public, anon, authenticated, service_role;

create or replace function private.inventory_row_assignment_reconcile_source_witness_v1()
returns text language sql stable security definer set search_path = '' as $$
  select md5(
    coalesce((select string_agg(to_jsonb(m)::text, E'\n' order by m.unique_id)
      from public.ph_master_inventory m), '') || '|' ||
    coalesce((select string_agg(jsonb_build_array(d.itemcode_normalized, d.assignedto,
        d.assigned_at, d.revision, d.review_required)::text, E'\n' order by d.itemcode_normalized)
      from public.ph_itemcode_default_owners d), '') || '|' ||
    coalesce((select string_agg(jsonb_build_array(a.assignment_key, a.present_in_drive,
        a.assignedto, a.assigned_at, a.zone_override_active,
        a.zone_override_prior_assignedto, a.zone_override_prior_assigned_at)::text,
        E'\n' order by a.assignment_key)
      from public.ph_warehouse_assigned_items a), '') || '|' ||
    coalesce((select string_agg(jsonb_build_array(u.username, u.active)::text,
        E'\n' order by u.username)
      from public.ph_eval_assignment_users u), '') || '|' ||
    coalesce((select string_agg(jsonb_build_array(p.username, p.disabled_at,
        p.locked_until, p.disabled_at is null and
          (p.locked_until is null or p.locked_until <= now()))::text,
        E'\n' order by p.username)
      from public.profiles p), '') || '|' ||
    coalesce((select string_agg(jsonb_build_array(s.singleton, s.active)::text, E'\n' order by s.singleton)
      from private.ph_inventory_row_assignment_policy_state s), '')
  )
$$;
revoke all on function private.inventory_row_assignment_reconcile_source_witness_v1()
  from public, anon, authenticated, service_role;

create or replace function private.inventory_row_assignment_reconcile_prepare_v1(
  p_run_id uuid, p_source_witness text, p_reset_count integer, p_source_revision bigint
) returns void language plpgsql security definer set search_path = '' as $$
declare total integer;
begin
  insert into private.inventory_row_assignment_reconcile_runs(
    import_run_id, source_witness, processed_count, retired_count, total_count, reset_count, source_revision
  ) values (p_run_id, p_source_witness, 0, 0, 0, p_reset_count::smallint, p_source_revision)
  on conflict (import_run_id) do update set source_witness = excluded.source_witness,
    processed_count = 0, retired_count = 0, total_count = 0, reset_count = excluded.reset_count,
    source_revision = excluded.source_revision, updated_at = clock_timestamp();
  delete from private.inventory_row_assignment_reconcile_worklist w where w.import_run_id = p_run_id;
  insert into private.inventory_row_assignment_reconcile_worklist(import_run_id, ordinal, master_unique_id, work_kind)
  select p_run_id, row_number() over (order by case work_kind when 'source' then 0 else 1 end,
    master_unique_id)::integer,
    master_unique_id, work_kind
  from (
    select m.unique_id as master_unique_id, 'source'::text as work_kind
    from public.ph_master_inventory m
    union all
    select a.master_unique_id, 'retire'::text
    from public.ph_inventory_row_assignments a
    where a.present_in_drive and not exists (
      select 1 from public.ph_master_inventory m where m.unique_id = a.master_unique_id
    )
  ) work;
  get diagnostics total = row_count;
  update private.inventory_row_assignment_reconcile_runs r
  set total_count = total, updated_at = clock_timestamp() where r.import_run_id = p_run_id;
end;
$$;
revoke all on function private.inventory_row_assignment_reconcile_prepare_v1(uuid,text,integer,bigint)
  from public, anon, authenticated, service_role;

create or replace function private.inventory_row_assignment_reconcile_finish_v1(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare progress private.inventory_row_assignment_reconcile_runs; witness text;
  source_count bigint; source_revision bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('gnc-reconcile-eval-itemcodes-v2', 0));
  select * into progress from private.inventory_row_assignment_reconcile_runs r
  where r.import_run_id = p_run_id for update;
  if not found then
    return private.reconcile_inventory_row_assignments_v1(p_run_id);
  end if;
  witness := private.inventory_row_assignment_reconcile_source_witness_v1();
  select r.revision + 1 into source_revision from public.app_dataset_revisions r
  where r.key = 'ph_master_inventory';
  if source_revision is distinct from progress.source_revision then
    raise exception using errcode = '55000', message = 'INVENTORY_ROW_ASSIGNMENT_SOURCE_CHANGED';
  end if;
  if witness is distinct from progress.source_witness then
    raise exception using errcode = '55000', message = 'INVENTORY_ROW_ASSIGNMENT_SOURCE_CHANGED';
  end if;
  select count(*) into source_count from public.ph_master_inventory;
  if progress.processed_count <> progress.total_count
     or (select count(*) from private.inventory_row_assignment_reconcile_worklist w
         where w.import_run_id = p_run_id) <> progress.total_count
     or (select count(*) from private.inventory_row_assignment_reconcile_worklist w
         where w.import_run_id = p_run_id and w.work_kind = 'source') <> source_count
     or exists(select 1 from public.ph_master_inventory m
       where not exists(select 1 from private.inventory_row_assignment_reconcile_worklist w
         where w.import_run_id = p_run_id and w.work_kind = 'source'
           and w.master_unique_id = m.unique_id))
     or exists(select 1 from public.ph_inventory_row_assignments a
       where a.present_in_drive and not exists(
         select 1 from public.ph_master_inventory m where m.unique_id = a.master_unique_id)) then
    raise exception using errcode = '55000', message = 'PERENNIAL_ASSIGNMENT_RECONCILE_INCOMPLETE';
  end if;
  return jsonb_build_object('status','completed', 'processed', source_count,
    'retired', progress.retired_count,
    'sourceRevision', progress.source_revision);
end;
$$;
revoke all on function private.inventory_row_assignment_reconcile_finish_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.reconcile_inventory_row_assignments_batch_v1(
  p_import_run_id uuid, p_batch_size integer default 100
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare run app_sync_private.import_runs; progress private.inventory_row_assignment_reconcile_runs;
  witness text; post_witness text; source_revision bigint; post_revision bigint;
  reset_value smallint := 0; work record;
  processed_now integer := 0; retired_now integer := 0;
  resolved_row public.ph_inventory_row_assignments%rowtype;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 100 then
    raise exception using errcode = '22023', message = 'INVENTORY_ROW_ASSIGNMENT_BATCH_SIZE_INVALID';
  end if;
  if p_import_run_id is null then
    raise exception using errcode = '22023', message = 'INVENTORY_ROW_ASSIGNMENT_IMPORT_FENCE_LOST';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dataset-import:' || p_import_run_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('gnc-reconcile-eval-itemcodes-v2', 0));
  select * into run from app_sync_private.import_runs r where r.id = p_import_run_id for share;
  if not found or run.state <> 'active' or run.expires_at <= clock_timestamp()
     or not ('ph_master_inventory' = any(run.source_keys))
     or not ('ph_master_inventory' = any(run.canonical_keys))
     or exists(select 1 from unnest(run.source_keys) requested(source_key)
       where not exists(select 1 from app_sync_private.import_leases l
         where l.key = requested.source_key and l.run_id = run.id)) then
    raise exception using errcode = '55000', message = 'INVENTORY_ROW_ASSIGNMENT_IMPORT_FENCE_LOST';
  end if;
  select r.revision + 1 into source_revision from public.app_dataset_revisions r
  where r.key = 'ph_master_inventory';
  if source_revision is null then
    raise exception using errcode = '55000', message = 'INVENTORY_ROW_ASSIGNMENT_SOURCE_NOT_READY';
  end if;
  witness := private.inventory_row_assignment_reconcile_source_witness_v1();
  select * into progress from private.inventory_row_assignment_reconcile_runs r
  where r.import_run_id = p_import_run_id for update;
  if not found then
    perform private.inventory_row_assignment_reconcile_prepare_v1(
      p_import_run_id, witness, 0, source_revision);
    select * into progress from private.inventory_row_assignment_reconcile_runs r
      where r.import_run_id = p_import_run_id for update;
  elsif progress.source_witness is distinct from witness
     or progress.source_revision is distinct from source_revision then
    if progress.reset_count >= 1 then
      raise exception using errcode = '55000', message = 'INVENTORY_ROW_ASSIGNMENT_SOURCE_CHANGED';
    end if;
    reset_value := progress.reset_count + 1;
    perform private.inventory_row_assignment_reconcile_prepare_v1(
      p_import_run_id, witness, reset_value, source_revision);
    return jsonb_build_object('ok',true,'status','reset','processed',0,
      'total',(select r.total_count from private.inventory_row_assignment_reconcile_runs r
        where r.import_run_id = p_import_run_id),'cursor',null);
  end if;

  for work in select w.master_unique_id, w.ordinal, w.work_kind
    from private.inventory_row_assignment_reconcile_worklist w
    where w.import_run_id = p_import_run_id and w.ordinal > progress.processed_count
    order by w.ordinal limit p_batch_size
  loop
    select * into resolved_row from private.resolve_inventory_row_assignment_v1(
      work.master_unique_id, source_revision);
    if work.work_kind = 'retire' and resolved_row.master_unique_id is not null
       and not resolved_row.present_in_drive and resolved_row.assignment_reason = 'source_missing' then
      retired_now := retired_now + 1;
    end if;
    processed_now := processed_now + 1;
  end loop;
  post_witness := private.inventory_row_assignment_reconcile_source_witness_v1();
  select r.revision + 1 into post_revision from public.app_dataset_revisions r
  where r.key = 'ph_master_inventory';
  if post_witness is distinct from witness or post_revision is distinct from source_revision then
    raise exception using errcode = '55000', message = 'INVENTORY_ROW_ASSIGNMENT_SOURCE_CHANGED';
  end if;
  update private.inventory_row_assignment_reconcile_runs r
  set processed_count = r.processed_count + processed_now,
      retired_count = r.retired_count + retired_now,
      source_witness = witness,
      updated_at = clock_timestamp()
  where r.import_run_id = p_import_run_id returning * into progress;
  return jsonb_build_object('ok',true,
    'status',case when progress.processed_count = progress.total_count then 'completed' else 'in_progress' end,
    'processed',progress.processed_count,'total',progress.total_count,
    'cursor',case when progress.processed_count = 0 then null else progress.processed_count::text end,
    'retired',progress.retired_count);
end;
$$;
revoke all on function public.reconcile_inventory_row_assignments_batch_v1(uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_inventory_row_assignments_batch_v1(uuid,integer) to service_role;

do $$
declare definition text; needle text := 'assignment_result := private.reconcile_inventory_row_assignments_v1(p_run_id);';
begin
  definition := replace(pg_get_functiondef('app_sync_private.advance_import(uuid,text)'::regprocedure), E'\r\n', E'\n');
  if (length(definition) - length(replace(definition, needle, ''))) / length(needle) <> 1 then
    raise exception 'INVENTORY_ROW_ASSIGNMENT_BATCH_FINISH_HOOK_PATCH_FAILED';
  end if;
  execute replace(definition, needle,
    'assignment_result := private.inventory_row_assignment_reconcile_finish_v1(p_run_id);');
end;
$$;

notify pgrst, 'reload schema';
commit;
