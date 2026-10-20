begin;

-- A canonical snapshot is staged before its atomic publication. If that run
-- fails before publication, the materialized source tables remain the last
-- complete published snapshot. Expose that fact separately from the import
-- fence: clients may read the stale baseline, but state/revision continue to
-- block writes and freshness claims.
create or replace function app_sync_private.published_snapshot_read_proof(
  p_dataset_key text,
  p_current_revision bigint
) returns jsonb
language sql stable security definer
set search_path = ''
as $function$
  with candidate as (
    select stage.run_id, run.created_at, run.finished_at, run.state
    from app_sync_private.ph_master_snapshot_stage_v1 stage
    join app_sync_private.import_runs run on run.id = stage.run_id
    where stage.status = 'staging'
      and stage.published_response is null
      and stage.publication_run_id is null
      and 'ph_master_inventory' = any(run.canonical_keys)
      and p_dataset_key = any(run.source_keys)
      and (
        run.state = 'failed'
        or (
          run.state = 'active'
          and run.expires_at > statement_timestamp()
          and exists (
            select 1 from app_sync_private.import_leases lease
            where lease.key = 'ph_master_inventory' and lease.run_id = run.id
          )
        )
      )
    order by run.created_at desc
    limit 1
  ), baseline as (
    select stage.publication_run_id, stage.source_digest, stage.updated_at
    from app_sync_private.ph_master_snapshot_stage_v1 stage
    join app_sync_private.import_runs published_run
      on published_run.id = stage.publication_run_id
     and published_run.state = 'completed'
     and p_dataset_key = any(published_run.source_keys)
    where stage.status = 'published'
      and stage.published_response is not null
      and exists (
        select 1 from candidate failed
        where stage.updated_at < failed.created_at
      )
    order by stage.updated_at desc
    limit 1
  ), safe_baseline as (
    select baseline.*
    from baseline
    cross join candidate current_run
    where not exists (
      -- A failed or still-active direct-write import can leave a source only
      -- partly updated. Do not lend the canonical baseline proof to it.
      select 1
      from app_sync_private.import_runs other_run
      where other_run.id <> current_run.run_id
        and p_dataset_key = any(other_run.source_keys)
        and other_run.created_at > baseline.updated_at
        and other_run.state in ('active', 'failed')
        and not (
          -- Canonical inventory runs mutate materialized tables only in the
          -- staged publisher transaction. Failed attempts without a published
          -- stage receipt cannot have changed those rows; a failed run with a
          -- published stage is intentionally still a blocker for its
          -- companions because reconciliation may have stopped afterward.
          other_run.state = 'failed'
          and 'ph_master_inventory' = any(other_run.canonical_keys)
          and not exists (
            select 1
            from app_sync_private.ph_master_snapshot_stage_v1 published_stage
            where published_stage.run_id = other_run.id
              and published_stage.status = 'published'
              and published_stage.published_response is not null
              and published_stage.publication_run_id is not null
          )
        )
    )
      and not exists (
        select 1
        from app_sync_private.import_leases lease
        join app_sync_private.import_runs active_run on active_run.id = lease.run_id
        where lease.key = p_dataset_key
          and active_run.id <> current_run.run_id
          and active_run.state = 'active'
          and active_run.expires_at > statement_timestamp()
      )
  )
  select jsonb_build_object(
    'publishedReadable', true,
    'publishedRevision', p_current_revision::text || ':' || publication_run_id::text || ':' || source_digest,
    'publishedAt', updated_at,
    -- Internal mutation allowlist: only a terminal failed canonical stage is
    -- eligible. Active imports remain readable as LKG but must stay write-fenced.
    'mutationAllowed', (select current_run.state = 'failed' from candidate current_run)
      and not exists (
        -- The assignment trigger rejects even expired lease rows. Treat every
        -- surviving lease as a fence until the normal cleanup path removes it.
        select 1 from app_sync_private.import_leases lease
        where lease.key = 'ph_master_inventory'
      )
  )
  from safe_baseline
$function$;

revoke all on function app_sync_private.published_snapshot_read_proof(text, bigint)
  from public, anon, authenticated;

create or replace function app_sync_private.snapshot(p_dataset_keys text[]) returns jsonb
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
    'changedAt',case when allowed then r.changed_at else null end,
    'publishedReadable',coalesce((proof.value->>'publishedReadable')::boolean,false),
    'publishedRevision',proof.value->>'publishedRevision',
    'publishedAt',proof.value->>'publishedAt'
  ) order by k.key),'[]'::jsonb) into result
  from (select distinct unnest(p_dataset_keys) as key) k
  join app_sync_private.sources source on source.key=k.key
  cross join lateral (select source.client_enabled and
    (not source.dylan_only or actor_scope->>'username'='dylan_collyge') and
    case when source.key like 'private.app_access\_%' escape '\' then access_control_allowed
      when source.key like 'private.codex_ops\_%' escape '\' or source.key='ph_runtime_feature_flags'
        then actor_scope->>'username'='dylan_collyge'
      else source.modules && allowed_modules end as allowed) access
  left join public.app_dataset_revisions r on r.key=k.key
  left join lateral (
    select case when access.allowed and r.key is not null and r.state <> 'ready'
      then app_sync_private.published_snapshot_read_proof(k.key,r.revision)
      else null end as value
  ) proof on true;
  return jsonb_build_object('contractVersion',1,'serverTime',statement_timestamp(),
    'permissionVersion',version,'sources',result);
end $$;

revoke all on function app_sync_private.snapshot(text[]) from public, anon;
grant execute on function app_sync_private.snapshot(text[]) to authenticated;
notify pgrst, 'reload schema';

-- The identity batch is a read-only resolver. It may use an explicitly
-- published LKG snapshot while an atomic canonical import is staging, while
-- retaining the current revision as the compare-and-swap read watermark.
do $migration$
declare
  function_oid oid := 'public.inventory_master_identity_batch_read_v1(uuid,jsonb,text)'::regprocedure;
  definition text;
  old_declaration text := $$declare
  actor public.profiles;
  revision_text text;
  revision_state text;
  results jsonb;$$;
  new_declaration text := $$declare
  actor public.profiles;
  revision_text text;
  revision_number bigint;
  revision_state text;
  lkg_proof jsonb;
  results jsonb;$$;
  old_gate text := $$  select r.revision::text,r.state into revision_text,revision_state
  from public.app_dataset_revisions r where r.key='ph_master_inventory';
  if revision_state is distinct from 'ready' or revision_text is null then
    raise exception using errcode='55000',message='MASTER_IDENTITY_SOURCE_NOT_READY';
  end if;
  if nullif(p_expected_revision,'') is not null and p_expected_revision<>revision_text then
    raise exception using errcode='55000',message='MASTER_IDENTITY_REVISION_CHANGED';
  end if;$$;
  new_gate text := $$  select r.revision::text,r.revision,r.state into revision_text,revision_number,revision_state
  from public.app_dataset_revisions r where r.key='ph_master_inventory';
  lkg_proof := app_sync_private.published_snapshot_read_proof('ph_master_inventory',revision_number);
  if revision_state is distinct from 'ready'
     and not coalesce((lkg_proof->>'publishedReadable')::boolean,false) then
    raise exception using errcode='55000',message='MASTER_IDENTITY_SOURCE_NOT_READY';
  end if;
  if nullif(p_expected_revision,'') is not null
     and p_expected_revision<>revision_text
     and p_expected_revision is distinct from lkg_proof->>'publishedRevision' then
    raise exception using errcode='55000',message='MASTER_IDENTITY_REVISION_CHANGED';
  end if;$$;
  old_return text := $$  return jsonb_build_object('inventoryRevision',revision_text,'rows',results);$$;
  new_return text := $$  return jsonb_build_object('inventoryRevision',revision_text,
    'publishedReadable',coalesce((lkg_proof->>'publishedReadable')::boolean,false),
    'publishedRevision',lkg_proof->>'publishedRevision','publishedAt',lkg_proof->>'publishedAt','rows',results);$$;
begin
  definition := pg_get_functiondef(function_oid);
  if position(new_declaration in definition)=0 then
    if (length(definition)-length(replace(definition,old_declaration,''))) / length(old_declaration) <> 1 then
      raise exception 'PUBLISHED_LKG_IDENTITY_DECLARATION_ANCHOR_INVALID';
    end if;
    definition := replace(definition,old_declaration,new_declaration);
  end if;
  if position(new_gate in definition)=0 then
    if (length(definition)-length(replace(definition,old_gate,''))) / length(old_gate) <> 1 then
      raise exception 'PUBLISHED_LKG_IDENTITY_GATE_ANCHOR_INVALID';
    end if;
    definition := replace(definition,old_gate,new_gate);
  end if;
  if position(new_return in definition)=0 then
    if (length(definition)-length(replace(definition,old_return,''))) / length(old_return) <> 1 then
      raise exception 'PUBLISHED_LKG_IDENTITY_RETURN_ANCHOR_INVALID';
    end if;
    definition := replace(definition,old_return,new_return);
  end if;
  execute definition;
end
$migration$;

-- Location on hand is also read-only and revision bounded. Keep the same
-- strict live revision comparison; only the state preflight gains LKG proof.
do $migration$
declare
  function_oid oid := 'public.inventory_location_on_hand_read_v1(uuid,jsonb,text)'::regprocedure;
  definition text;
  old_declaration text := $$declare
  actor public.profiles;
  revision_text text;
  revision_state text;
  totals jsonb;$$;
  new_declaration text := $$declare
  actor public.profiles;
  revision_text text;
  revision_number bigint;
  revision_state text;
  lkg_proof jsonb;
  totals jsonb;$$;
  old_gate text := $$  select revision::text,state into revision_text,revision_state
    from public.app_dataset_revisions where key='ph_master_inventory';
  if revision_state is distinct from 'ready' or revision_text is null then
    raise exception using errcode='PT409',message='LOC_ON_HAND_SOURCE_NOT_READY';
  end if;
  if nullif(p_expected_revision,'') is not null and p_expected_revision<>revision_text then
    raise exception using errcode='PT409',message='LOC_ON_HAND_REVISION_CHANGED';
  end if;$$;
  new_gate text := $$  select revision::text,revision,state into revision_text,revision_number,revision_state
    from public.app_dataset_revisions where key='ph_master_inventory';
  lkg_proof := app_sync_private.published_snapshot_read_proof('ph_master_inventory',revision_number);
  if revision_state is distinct from 'ready'
     and not coalesce((lkg_proof->>'publishedReadable')::boolean,false) then
    raise exception using errcode='PT409',message='LOC_ON_HAND_SOURCE_NOT_READY';
  end if;
  if nullif(p_expected_revision,'') is not null and p_expected_revision<>revision_text
     and p_expected_revision is distinct from lkg_proof->>'publishedRevision' then
    raise exception using errcode='PT409',message='LOC_ON_HAND_REVISION_CHANGED';
  end if;$$;
begin
  definition := pg_get_functiondef(function_oid);
  if position(new_declaration in definition)=0 then
    if (length(definition)-length(replace(definition,old_declaration,''))) / length(old_declaration) <> 1 then
      raise exception 'PUBLISHED_LKG_LOC_ON_HAND_DECLARATION_ANCHOR_INVALID';
    end if;
    definition := replace(definition,old_declaration,new_declaration);
  end if;
  if position(new_gate in definition)=0 then
    if (length(definition)-length(replace(definition,old_gate,''))) / length(old_gate) <> 1 then
      raise exception 'PUBLISHED_LKG_LOC_ON_HAND_GATE_ANCHOR_INVALID';
    end if;
    definition := replace(definition,old_gate,new_gate);
  end if;
  -- The existing result carries the numeric live revision for compatibility;
  -- the separate snapshot RPC carries the opaque published revision token.
  execute definition;
end
$migration$;

-- Reclass mutations may proceed against the still-materialized LKG only after
-- a canonical staged attempt has definitively failed. This helper takes the
-- same revision-row lock used by import publication/start, so a new import
-- cannot begin between proof validation and the caller's row-level CAS.
create or replace function private.lock_ph_master_inventory_for_reclass_lkg_v1(
  p_allow_inventory_write boolean default false
)
returns bigint
language plpgsql security definer set search_path = ''
as $function$
declare
  revision_value bigint;
  state_value text;
  proof jsonb;
begin
  select r.revision,r.state into revision_value,state_value
  from public.app_dataset_revisions r
  where r.key='ph_master_inventory'
  for update;
  if revision_value is null then
    raise exception using errcode='40001',message='RECLASS_V6_INVENTORY_REFRESH_REQUIRED';
  end if;
  if state_value='ready' then return revision_value; end if;
  if state_value is distinct from 'interrupted' then
    raise exception using errcode='40001',message='RECLASS_V6_INVENTORY_REFRESH_REQUIRED';
  end if;
  proof:=app_sync_private.published_snapshot_read_proof('ph_master_inventory',revision_value);
  if not coalesce((proof->>'mutationAllowed')::boolean,false) then
    raise exception using errcode='40001',message='RECLASS_V6_INVENTORY_REFRESH_REQUIRED';
  end if;
  return revision_value;
end
$function$;
revoke all on function private.lock_ph_master_inventory_for_reclass_lkg_v1(boolean)
  from public, anon, authenticated, service_role;

-- The assignment statement trigger also enforces the interrupted-state fence.
-- Permit its one intentional exception only when an unexposed definer function
-- established this transaction context after locking and validating the exact
-- interrupted revision. Authenticated callers cannot set a GUC or insert this
-- marker themselves.
create table if not exists private.ph_inventory_reclass_lkg_context_v1 (
  backend_pid integer not null,
  transaction_id bigint not null,
  inventory_revision bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (backend_pid, transaction_id)
);
revoke all on table private.ph_inventory_reclass_lkg_context_v1
  from public, anon, authenticated, service_role;

create or replace function private.reclass_lkg_write_context_active_v1()
returns boolean
language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1
    from private.ph_inventory_reclass_lkg_context_v1 context
    join public.app_dataset_revisions revision
      on revision.key = 'ph_master_inventory'
     and revision.state = 'interrupted'
     and revision.revision = context.inventory_revision
    where context.backend_pid = pg_backend_pid()
      and context.transaction_id = txid_current()
      and coalesce((app_sync_private.published_snapshot_read_proof(
        'ph_master_inventory', revision.revision
      )->>'mutationAllowed')::boolean, false)
  )
$function$;
revoke all on function private.reclass_lkg_write_context_active_v1()
  from public, anon, authenticated, service_role;

create or replace function private.reclass_lkg_write_context_proven_v1()
returns boolean
language sql volatile security definer set search_path = ''
as $function$
  select exists (
    select 1
    from private.ph_inventory_reclass_lkg_context_v1 context
    join public.app_dataset_revisions revision
      on revision.key = 'ph_master_inventory'
     and revision.state = 'interrupted'
     and revision.revision = context.inventory_revision
    where context.backend_pid = pg_backend_pid()
      and context.transaction_id = txid_current()
      and coalesce((app_sync_private.published_snapshot_read_proof(
        'ph_master_inventory', revision.revision
      )->>'mutationAllowed')::boolean, false)
  )
$function$;
revoke all on function private.reclass_lkg_write_context_proven_v1()
  from public, anon, authenticated, service_role;

create or replace function private.clear_current_ph_inventory_reclass_lkg_context_v1()
returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  delete from private.ph_inventory_reclass_lkg_context_v1 context
  where context.backend_pid = pg_backend_pid()
    and context.transaction_id = txid_current();
end
$function$;
revoke all on function private.clear_current_ph_inventory_reclass_lkg_context_v1()
  from public, anon, authenticated, service_role;

-- The v6 Hold/Stop/priority loop is itself private and called only from the
-- authorized v7 wrapper. Keep its revision-row lock, while admitting the same
-- terminal canonical LKG proof held by the outer wrapper.
do $migration$
declare
  target regprocedure := 'private.apply_ph_master_inventory_live_edits_v6(jsonb)'::regprocedure;
  definition text;
  old_guard text := $old$  perform 1 from public.app_dataset_revisions r
  where r.key = 'ph_master_inventory' and r.state = 'ready'
  for update;
  if not found then$old$;
  new_guard text := $new$  perform 1 from public.app_dataset_revisions r
  where r.key = 'ph_master_inventory'
  for update;
  if not found or not (
    exists(select 1 from public.app_dataset_revisions r where r.key = 'ph_master_inventory' and r.state = 'ready')
    or private.reclass_lkg_write_context_proven_v1()
  ) then$new$;
  occurrence_count integer;
begin
  definition := pg_get_functiondef(target);
  occurrence_count := (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard);
  if occurrence_count <> 1 then
    raise exception 'PUBLISHED_LKG_LIVE_EDIT_GUARD_ANCHOR_INVALID:%', occurrence_count;
  end if;
  execute replace(definition,old_guard,new_guard);
end
$migration$;

create or replace function private.cleanup_ph_inventory_reclass_lkg_context_v1()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
begin
  delete from private.ph_inventory_reclass_lkg_context_v1 context
  where context.backend_pid = new.backend_pid
    and context.transaction_id = new.transaction_id;
  return null;
end
$function$;
revoke all on function private.cleanup_ph_inventory_reclass_lkg_context_v1()
  from public, anon, authenticated, service_role;
drop trigger if exists trg_clear_ph_inventory_reclass_lkg_context_v1
  on private.ph_inventory_reclass_lkg_context_v1;
create constraint trigger trg_clear_ph_inventory_reclass_lkg_context_v1
  after insert on private.ph_inventory_reclass_lkg_context_v1
  deferrable initially deferred for each row
  execute function private.cleanup_ph_inventory_reclass_lkg_context_v1();

create or replace function private.lock_ph_master_inventory_for_reclass_lkg_v1(
  p_allow_inventory_write boolean default false
)
returns bigint
language plpgsql security definer set search_path = ''
as $function$
declare
  revision_value bigint;
  state_value text;
  proof jsonb;
begin
  select revision, state into revision_value, state_value
  from public.app_dataset_revisions
  where key = 'ph_master_inventory'
  for update;
  if revision_value is null then
    raise exception using errcode = '40001', message = 'RECLASS_V6_INVENTORY_REFRESH_REQUIRED';
  end if;
  if state_value = 'ready' then return revision_value; end if;
  if state_value is distinct from 'interrupted' then
    raise exception using errcode = '40001', message = 'RECLASS_V6_INVENTORY_REFRESH_REQUIRED';
  end if;
  proof := app_sync_private.published_snapshot_read_proof('ph_master_inventory', revision_value);
  if not coalesce((proof->>'mutationAllowed')::boolean, false) then
    raise exception using errcode = '40001', message = 'RECLASS_V6_INVENTORY_REFRESH_REQUIRED';
  end if;
  if p_allow_inventory_write then
    insert into private.ph_inventory_reclass_lkg_context_v1(backend_pid, transaction_id, inventory_revision)
    values(pg_backend_pid(), txid_current(), revision_value)
    on conflict (backend_pid, transaction_id) do nothing;
  end if;
  return revision_value;
end
$function$;
revoke all on function private.lock_ph_master_inventory_for_reclass_lkg_v1(boolean)
  from public, anon, authenticated, service_role;

-- Preserve the trigger's normal checks and assignment reconciliation. Only the
-- not-ready rejection is relaxed, and only for the private transaction marker.
create or replace function private.sync_inventory_row_assignment_statement_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  importing boolean;
  stale_lease boolean;
  source_state text;
  row_value record;
  lkg_reclass_context boolean := false;
begin
  if not exists(select 1 from private.ph_inventory_row_assignment_policy_state s where s.singleton and s.active) then
    return null;
  end if;
  select r.state into source_state from public.app_dataset_revisions r where r.key = 'ph_master_inventory';
  select exists(select 1 from app_sync_private.import_leases l
    join app_sync_private.import_runs r on r.id = l.run_id
    where l.key = 'ph_master_inventory' and r.state = 'active' and r.expires_at > clock_timestamp()) into importing;
  select exists(select 1 from app_sync_private.import_leases l where l.key = 'ph_master_inventory') into stale_lease;
  if importing and source_state is distinct from 'ready' then return null; end if;
  if source_state is distinct from 'ready' then
    lkg_reclass_context := source_state = 'interrupted'
      and private.reclass_lkg_write_context_active_v1();
    if not lkg_reclass_context then
      raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_NOT_READY';
    end if;
  end if;
  if stale_lease and not importing then
    raise exception using errcode = '55000', message = 'MASTER_IMPORT_FENCE_EXPIRED';
  end if;
  if importing then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('gnc-reconcile-eval-itemcodes-v2', 0));

  if tg_op = 'INSERT' then
    for row_value in select n.unique_id from new_rows n order by n.unique_id loop
      perform private.resolve_inventory_row_assignment_v1(row_value.unique_id, null);
    end loop;
  elsif tg_op = 'DELETE' then
    for row_value in select o.unique_id from old_rows o order by o.unique_id loop
      perform private.resolve_inventory_row_assignment_v1(row_value.unique_id, null);
    end loop;
  else
    for row_value in
      select changed.unique_id from (
        select o.unique_id from old_rows o
        where not exists(select 1 from new_rows n where n.unique_id = o.unique_id)
          or exists(select 1 from new_rows n where n.unique_id = o.unique_id
            and (o.itemcode, o.genusname, o.plantgroupcode, o.commonname, o.contsize,
              o.locationcode, o.lotcode, o.source, o.warehousei)
              is distinct from (n.itemcode, n.genusname, n.plantgroupcode, n.commonname, n.contsize,
              n.locationcode, n.lotcode, n.source, n.warehousei))
        union
        select n.unique_id from new_rows n
        where not exists(select 1 from old_rows o where o.unique_id = n.unique_id)
          or exists(select 1 from old_rows o where o.unique_id = n.unique_id
            and (o.itemcode, o.genusname, o.plantgroupcode, o.commonname, o.contsize,
              o.locationcode, o.lotcode, o.source, o.warehousei)
              is distinct from (n.itemcode, n.genusname, n.plantgroupcode, n.commonname, n.contsize,
              n.locationcode, n.lotcode, n.source, n.warehousei))
      ) changed order by changed.unique_id
    loop
      perform private.resolve_inventory_row_assignment_v1(row_value.unique_id, null);
    end loop;
  end if;
  return null;
end;
$function$;
revoke all on function private.sync_inventory_row_assignment_statement_v1()
  from public, anon, authenticated, service_role;

-- Scope the interrupted-LKG exception to the atomic Reclass apply and inquiry
-- mutation paths. General live-edit helpers remain strict while a source is
-- interrupted or actively importing.
do $migration$
declare
  target regprocedure;
  definition text;
  targets regprocedure[] := array[
    'public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb)'::regprocedure,
    'public.apply_inventory_reclass_moves_v1(uuid,text,bigint,jsonb)'::regprocedure,
    'public.enqueue_drive_reclass_inquiry_v7(jsonb)'::regprocedure
  ];
  old_call text := 'private.lock_ph_master_inventory_for_live_edit_v6()';
  new_call text := 'private.lock_ph_master_inventory_for_reclass_lkg_v1()';
  occurrence_count integer;
begin
  foreach target in array targets loop
    definition:=pg_get_functiondef(target);
    occurrence_count:=(length(definition)-length(replace(definition,old_call,'')))/length(old_call);
    if occurrence_count<>1 then
      raise exception 'PUBLISHED_LKG_RECLASS_LOCK_ANCHOR_INVALID:%:%',target,occurrence_count;
    end if;
    execute replace(definition,old_call,new_call);
  end loop;
end
$migration$;

-- The apply paths receive a private transaction marker. It remains available
-- only during their trusted body and is explicitly deleted before successful
-- return; rollback removes it on any exception.
do $migration$
declare
  target regprocedure;
  definition text;
  targets regprocedure[] := array[
    'public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb)'::regprocedure,
    'public.apply_inventory_reclass_moves_v1(uuid,text,bigint,jsonb)'::regprocedure
  ];
  old_call text := 'private.lock_ph_master_inventory_for_reclass_lkg_v1()';
  new_call text := 'private.lock_ph_master_inventory_for_reclass_lkg_v1(true)';
  occurrence_count integer;
begin
  foreach target in array targets loop
    definition := pg_get_functiondef(target);
    occurrence_count := (length(definition)-length(replace(definition,old_call,'')))/length(old_call);
    if occurrence_count <> 1 then
      raise exception 'PUBLISHED_LKG_RECLASS_WRITE_CONTEXT_ANCHOR_INVALID:%:%', target, occurrence_count;
    end if;
    execute replace(definition, old_call, new_call);
  end loop;
end
$migration$;

do $migration$
declare
  target regprocedure := 'public.enqueue_drive_reclass_inquiry_v7(jsonb)'::regprocedure;
  definition text;
  old_call text := 'private.lock_ph_master_inventory_for_reclass_lkg_v1()';
  new_call text := 'private.lock_ph_master_inventory_for_reclass_lkg_v1(true)';
  old_return text := $old$  return private.drive_reclass_delivery_result_v1(event_row)||jsonb_build_object(
    'duplicate',false$old$;
  occurrence_count integer;
begin
  definition := pg_get_functiondef(target);
  occurrence_count := (length(definition)-length(replace(definition,old_call,'')))/length(old_call);
  if occurrence_count <> 1 then
    raise exception 'PUBLISHED_LKG_INQUIRY_LOCK_ANCHOR_INVALID:%', occurrence_count;
  end if;
  definition := replace(definition,old_call,new_call);
  occurrence_count := (length(definition)-length(replace(definition,old_return,'')))/length(old_return);
  if occurrence_count <> 1 then
    raise exception 'PUBLISHED_LKG_INQUIRY_RETURN_ANCHOR_INVALID:%', occurrence_count;
  end if;
  definition := replace(definition,old_return,
    '  perform private.clear_current_ph_inventory_reclass_lkg_context_v1();'||chr(10)||old_return);
  execute definition;
end
$migration$;

do $migration$
declare
  target regprocedure;
  definition text;
  targets regprocedure[] := array[
    'public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb)'::regprocedure,
    'public.apply_inventory_reclass_moves_v1(uuid,text,bigint,jsonb)'::regprocedure
  ];
  old_return text;
  occurrence_count integer;
begin
  foreach target in array targets loop
    definition := pg_get_functiondef(target);
    if target = 'public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb)'::regprocedure then
      old_return := '  return request_value;';
    else
      old_return := '  return result_value;';
    end if;
    occurrence_count := (length(definition)-length(replace(definition,old_return,'')))/length(old_return);
    if occurrence_count <> 1 then
      raise exception 'PUBLISHED_LKG_APPLY_RETURN_ANCHOR_INVALID:%:%', target, occurrence_count;
    end if;
    definition := replace(definition,old_return,
      '  perform private.clear_current_ph_inventory_reclass_lkg_context_v1();'||chr(10)||old_return);
    execute definition;
  end loop;
end
$migration$;

commit;
