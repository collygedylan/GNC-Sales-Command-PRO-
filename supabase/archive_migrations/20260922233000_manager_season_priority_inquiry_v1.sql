begin;

-- Manager Season Priority is an inquiry-only extension of protected Reclass.
-- It never updates ph_master_inventory. The DriveAround import remains the only
-- writer of inventory priority; this contract records the requested rotation
-- and later acknowledges the first ready import revision exactly once.

insert into private.app_access_permissions
  (permission_key, permission_kind, module_key, label, description, scope_options, sort_order, active)
values
  ('managers.season_priority.submit', 'action', 'managers', 'Request Season Priority change',
   'Create a protected Reclass inquiry that rotates an eligible Season Sales Notes item to Priority 1.',
   array['global']::text[], 616, true)
on conflict (permission_key) do update set
  permission_kind = excluded.permission_kind,
  module_key = excluded.module_key,
  label = excluded.label,
  description = excluded.description,
  scope_options = excluded.scope_options,
  sort_order = excluded.sort_order,
  active = true;

insert into private.app_access_role_grants
  (policy_id, role_key, permission_key, allowed, access_scope)
select policy.id, role.role_key, 'managers.season_priority.submit', true, 'global'
from private.app_access_policy_versions policy
cross join (values ('ADMIN'), ('ADMINISTRATOR'), ('MANAGER')) role(role_key)
on conflict (policy_id, role_key, permission_key) do update set
  allowed = excluded.allowed,
  access_scope = excluded.access_scope,
  updated_at = now();

insert into private.app_access_legacy_checks
  (check_key, permission_key, enforcement_surface, notes)
values
  ('client.managers.season_priority.v1', 'managers.season_priority.submit', 'client',
   'Managers renders server-selected Season Sales Notes AV Blank rows and submits only source UID, expected priority, scope fingerprint, and idempotency token.'),
  ('edge.managers.season_priority.v1', 'managers.season_priority.submit', 'edge',
   'The authenticated app API supplies the actor profile ID and exposes only list, submit, and state operations.'),
  ('rpc.managers.season_priority.v1', 'managers.season_priority.submit', 'rpc',
   'Service-only RPCs enforce active Manager/Admin access, ready source revisions, complete same-item scope, stale checks, dedupe, and persistent terminal import acknowledgment.')
on conflict (check_key) do update set
  permission_key = excluded.permission_key,
  enforcement_surface = excluded.enforcement_surface,
  notes = excluded.notes;

create table private.manager_season_priority_receipts (
  event_id uuid primary key references public.ph_request_delivery_outbox(event_id) on delete restrict,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  itemcode_normalized text not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  source_unique_id text not null,
  selected_lineage_hash text not null check (selected_lineage_hash ~ '^[0-9a-f]{64}$'),
  expected_priority smallint not null check (expected_priority between 2 and 4),
  scope_fingerprint text not null check (scope_fingerprint ~ '^[0-9a-f]{64}$'),
  before_state_hash text not null check (before_state_hash ~ '^[0-9a-f]{64}$'),
  expected_after_hash text not null check (expected_after_hash ~ '^[0-9a-f]{64}$'),
  created_inventory_revision bigint not null,
  last_checked_inventory_revision bigint not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text check (resolution is null or resolution in ('fulfilled', 'stale')),
  resolved_inventory_revision bigint,
  resolution_snapshot_hash text,
  check ((resolution is null and resolved_at is null and resolved_inventory_revision is null and resolution_snapshot_hash is null)
      or (resolution is not null and resolved_at is not null and resolved_inventory_revision is not null and resolution_snapshot_hash is not null))
);

create unique index manager_season_priority_one_active_fingerprint
  on private.manager_season_priority_receipts(request_fingerprint)
  where resolution is null;
create unique index manager_season_priority_one_active_itemcode
  on private.manager_season_priority_receipts(itemcode_normalized)
  where resolution is null;
create index manager_season_priority_item_state
  on private.manager_season_priority_receipts(itemcode_normalized, created_at desc);

alter table private.manager_season_priority_receipts enable row level security;
revoke all on private.manager_season_priority_receipts from public, anon, authenticated;
grant select, insert, update on private.manager_season_priority_receipts to service_role;

create or replace function private.manager_season_priority_actor_v1(p_actor_id uuid)
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
begin
  select p.* into actor
  from public.profiles p
  where p.id = p_actor_id
    and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now())
    and not p.must_change_password;

  if actor.id is null
     or private.normalized_profile_role(actor.role) not in ('ADMIN', 'ADMINISTRATOR', 'MANAGER') then
    raise exception using errcode = '42501', message = 'SEASON_PRIORITY_FORBIDDEN';
  end if;
  if not exists (
    select 1 from private.get_effective_app_permissions_v1(
      actor.id, private.resolve_app_access_policy_id_v1(false)
    ) e where e.permission_key = 'module.managers.view' and e.allowed
  ) or not exists (
    select 1 from private.get_effective_app_permissions_v1(
      actor.id, private.resolve_app_access_policy_id_v1(false)
    ) e where e.permission_key = 'managers.season_priority.submit' and e.allowed
  ) then
    raise exception using errcode = '42501', message = 'SEASON_PRIORITY_PERMISSION_REQUIRED';
  end if;
  return actor;
end
$function$;

create or replace function private.manager_season_priority_lineage_v1(p_row jsonb)
returns text
language sql
immutable
set search_path = ''
as $function$
  select encode(extensions.digest(jsonb_build_array(
    upper(btrim(coalesce(p_row->>'warehouseid', p_row->>'warehousei', ''))),
    upper(btrim(coalesce(p_row->>'itemcode', ''))),
    upper(btrim(coalesce(p_row->>'contsize', ''))),
    upper(btrim(coalesce(p_row->>'locationcode', ''))),
    upper(btrim(coalesce(p_row->>'lotcode', ''))),
    upper(btrim(coalesce(p_row->>'source', ''))),
    upper(btrim(coalesce(p_row->>'desigitem', ''))),
    upper(btrim(coalesce(p_row->>'desigcust', ''))),
    upper(btrim(coalesce(p_row->>'desigloc', '')))
  )::text, 'sha256'), 'hex')
$function$;

create or replace function public.submit_manager_season_priority_v1(
  p_actor_id uuid,
  p_source_unique_id text,
  p_expected_priority integer,
  p_scope_fingerprint text,
  p_idempotency_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles := private.manager_season_priority_actor_v1(p_actor_id);
  source_row public.ph_master_inventory;
  source_json jsonb;
  itemcode_value text;
  selected_lineage text;
  current_scope jsonb;
  current_scope_fingerprint text;
  before_state_hash text;
  after_state jsonb;
  after_state_hash text;
  overlays jsonb;
  request_fingerprint text;
  inventory_revision bigint;
  event_result jsonb;
  event_row public.ph_request_delivery_outbox;
  receipt private.manager_season_priority_receipts;
  active_receipt private.manager_season_priority_receipts;
  active_event public.ph_request_delivery_outbox;
  retried boolean := false;
  original_actor text;
  original_token text;
  bound_receipt private.manager_season_priority_receipts;
  bound_event public.ph_request_delivery_outbox;
  active_event_id uuid;
begin
  if p_expected_priority is null or p_expected_priority not between 2 and 4 then
    raise exception using errcode = '22023', message = 'SEASON_PRIORITY_EXPECTED_PRIORITY_INVALID';
  end if;
  if coalesce(p_scope_fingerprint, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'SEASON_PRIORITY_SCOPE_FINGERPRINT_INVALID';
  end if;
  if length(btrim(coalesce(p_idempotency_token, ''))) < 12
     or length(btrim(coalesce(p_idempotency_token, ''))) > 180 then
    raise exception using errcode = '22023', message = 'SEASON_PRIORITY_TOKEN_INVALID';
  end if;
  select r.* into bound_receipt
  from private.manager_season_priority_receipts r
  join public.ph_request_delivery_outbox o on o.event_id = r.event_id
  where o.event_key = 'reclass-inquiry:' || left(encode(extensions.digest(btrim(p_idempotency_token), 'sha256'), 'hex'), 40)
    and o.event_type = 'reclass_inquiry'
  limit 1;
  if bound_receipt.event_id is not null then
    select o.* into bound_event from public.ph_request_delivery_outbox o
    where o.event_id = bound_receipt.event_id;
    if bound_receipt.actor_id <> actor.id then
      raise exception using errcode = '42501', message = 'SEASON_PRIORITY_TOKEN_OWNERSHIP_CONFLICT';
    end if;
    if bound_receipt.source_unique_id is distinct from btrim(coalesce(p_source_unique_id, ''))
       or bound_receipt.expected_priority is distinct from p_expected_priority
       or bound_receipt.scope_fingerprint is distinct from p_scope_fingerprint then
      raise exception using errcode = '40001', message = 'SEASON_PRIORITY_TOKEN_CONFLICT';
    end if;
    return private.manager_season_priority_result_v1(bound_receipt, bound_event, true, false);
  end if;
  perform 1
  from public.app_dataset_revisions r
  where r.key in ('ph_master_inventory', 'ph_cav_import', 'ph_warehouse_assigned_items')
  order by r.key
  for share;
  if exists (
    select 1
    from unnest(array['ph_master_inventory', 'ph_cav_import', 'ph_warehouse_assigned_items']) required(key)
    left join public.app_dataset_revisions r on r.key = required.key
    where r.key is null or r.state <> 'ready'
  ) then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_SOURCE_REFRESH_REQUIRED';
  end if;
  select r.revision into inventory_revision
  from public.app_dataset_revisions r where r.key = 'ph_master_inventory' for share;
  if inventory_revision is null then
    raise exception using errcode = '55000', message = 'SEASON_PRIORITY_SOURCE_REVISION_MISSING';
  end if;

  select m.* into source_row
  from public.ph_master_inventory m
  where btrim(coalesce(m.unique_id, '')) = btrim(coalesce(p_source_unique_id, ''))
  limit 1 for share;
  if source_row.unique_id is null then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_SOURCE_MISSING';
  end if;
  source_json := to_jsonb(source_row);
  if not private.manager_season_priority_row_eligible_v1(source_json) then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_SOURCE_NOT_ELIGIBLE';
  end if;
  if btrim(coalesce(source_json->>'priority', '')) <> p_expected_priority::text then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_SOURCE_STALE';
  end if;
  itemcode_value := upper(btrim(coalesce(source_row.itemcode, '')));
  if itemcode_value = '' then
    raise exception using errcode = '22023', message = 'SEASON_PRIORITY_ITEMCODE_REQUIRED';
  end if;
  selected_lineage := private.manager_season_priority_lineage_v1(source_json);

  perform 1 from public.ph_master_inventory m
  where upper(btrim(coalesce(m.itemcode, ''))) = itemcode_value
  order by m.unique_id for share;
  current_scope := private.manager_season_priority_scope_v1(itemcode_value);
  current_scope_fingerprint := encode(extensions.digest(current_scope::text, 'sha256'), 'hex');
  if current_scope_fingerprint <> p_scope_fingerprint then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_SCOPE_CHANGED';
  end if;
  if exists (
    select 1
    from public.ph_master_inventory m
    where upper(btrim(m.itemcode)) = itemcode_value
    group by private.manager_season_priority_lineage_v1(to_jsonb(m))
    having count(*) > 1
  ) then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_LINEAGE_AMBIGUOUS';
  end if;
  before_state_hash := private.manager_season_priority_state_hash_v1(itemcode_value);

  with scope_rows as (
    select m.unique_id, to_jsonb(m) row_json,
      private.manager_season_priority_lineage_v1(to_jsonb(m)) lineage_hash,
      case when btrim(coalesce(m.priority, '')) ~ '^[1-4]$' then btrim(m.priority)::integer end old_priority
    from public.ph_master_inventory m
    where upper(btrim(coalesce(m.itemcode, ''))) = itemcode_value
  ), rotated as (
    select *, case
      when unique_id = source_row.unique_id then 1
      when old_priority between 1 and p_expected_priority - 1 then old_priority + 1
      else old_priority
    end new_priority
    from scope_rows
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'unique_id', unique_id,
      'expected', jsonb_build_object(
        'itemcode', coalesce(row_json->>'itemcode', ''),
        'lotcode', coalesce(row_json->>'lotcode', ''),
        'locationcode', coalesce(row_json->>'locationcode', ''),
        'ptronhand', coalesce(row_json->>'ptronhand', ''),
        'ptravailable', coalesce(row_json->>'ptravailable', ''),
        'priority', btrim(coalesce(row_json->>'priority', '')),
        'lineageHash', lineage_hash,
        'lineage', jsonb_build_object(
          'warehouse', coalesce(row_json->>'warehouseid', row_json->>'warehousei', ''),
          'itemcode', coalesce(row_json->>'itemcode', ''),
          'contsize', coalesce(row_json->>'contsize', ''),
          'locationcode', coalesce(row_json->>'locationcode', ''),
          'lotcode', coalesce(row_json->>'lotcode', ''),
          'source', coalesce(row_json->>'source', ''),
          'desigitem', coalesce(row_json->>'desigitem', ''),
          'desigcust', coalesce(row_json->>'desigcust', ''),
          'desigloc', coalesce(row_json->>'desigloc', '')
        )
      ),
      'proposals', case when new_priority is distinct from old_priority
        then jsonb_build_array(jsonb_build_object('action', 'priority_change', 'priority', new_priority))
        else '[]'::jsonb end
    ) order by lineage_hash, unique_id), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'lineageHash', lineage_hash,
      'priority', case when new_priority is null then btrim(coalesce(row_json->>'priority', '')) else new_priority::text end
    ) order by lineage_hash,
      case when new_priority is null then btrim(coalesce(row_json->>'priority', '')) else new_priority::text end,
      unique_id), '[]'::jsonb)
  into overlays, after_state
  from rotated;

  after_state_hash := encode(extensions.digest(after_state::text, 'sha256'), 'hex');
  request_fingerprint := encode(extensions.digest(jsonb_build_object(
    'contractVersion', 'manager-season-priority-v1',
    'itemcode', itemcode_value,
    'selectedLineageHash', selected_lineage,
    'selectedPriority', p_expected_priority,
    'beforeStateHash', before_state_hash,
    'afterStateHash', after_state_hash
  )::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('manager-season-priority-item:' || itemcode_value, 0));
  perform pg_advisory_xact_lock(hashtextextended('manager-season-priority:' || request_fingerprint, 0));
  select r.event_id into active_event_id
  from private.manager_season_priority_receipts r
  join public.ph_request_delivery_outbox o on o.event_id = r.event_id
  where r.itemcode_normalized = itemcode_value and r.resolution is null
  limit 1 for update of r, o;
  if active_event_id is not null then
    select r.* into active_receipt from private.manager_season_priority_receipts r where r.event_id = active_event_id;
    select o.* into active_event from public.ph_request_delivery_outbox o where o.event_id = active_event_id;
    if active_event.status in ('failed', 'unknown')
       and upper(coalesce(active_event.sanitized_error_code, '')) like 'RECLASS_CONFLICT%' then
      update private.manager_season_priority_receipts r
      set resolution = 'stale', resolved_at = now(),
          resolved_inventory_revision = inventory_revision,
          resolution_snapshot_hash = before_state_hash
      where r.event_id = active_receipt.event_id and r.resolution is null
      returning * into active_receipt;
      return private.manager_season_priority_result_v1(active_receipt, active_event, true, false);
    end if;
    if active_receipt.request_fingerprint <> request_fingerprint then
      raise exception using errcode = '40001', message = 'SEASON_PRIORITY_ITEM_PENDING';
    end if;
    if active_event.status in ('failed', 'unknown') then
      original_actor := active_event.payload #>> '{reclassPayload,actor,username}';
      original_token := active_event.payload #>> '{reclassPayload,idempotencyToken}';
      perform public.retry_drive_reclass_inquiry_v1(original_actor, original_token);
      select * into active_event from public.ph_request_delivery_outbox where event_id = active_receipt.event_id;
      retried := true;
    end if;
    return private.manager_season_priority_result_v1(active_receipt, active_event, true, retried);
  end if;

  event_result := public.enqueue_drive_reclass_inquiry_v1(jsonb_build_object(
    'workflowPolicyVersion', 'reclass-action-workflow-v3-row-actions-20260826',
    'idempotencyToken', btrim(p_idempotency_token),
    'actorUsername', lower(btrim(actor.username)),
    'source', jsonb_build_object(
      'unique_id', source_row.unique_id,
      'itemcode', source_row.itemcode,
      'lotcode', source_json->>'lotcode',
      'locationcode', source_json->>'locationcode'
    ),
    'transaction', jsonb_build_object(
      'requestActions', jsonb_build_array('priority_change'),
      'holdStopProposals', '[]'::jsonb,
      'scope', jsonb_build_object(),
      'seasonPriority', jsonb_build_object(
        'contractVersion', 'manager-season-priority-v1',
        'mode', 'priority_one_rotation',
        'selectedLineageHash', selected_lineage,
        'selectedPriority', p_expected_priority,
        'scopeFingerprint', current_scope_fingerprint,
        'requestFingerprint', request_fingerprint,
        'beforeStateHash', before_state_hash,
        'afterStateHash', after_state_hash
      )
    ),
    'rowOverlays', overlays,
    'clientVersion', 'manager-season-priority-v1'
  ));

  select o.* into event_row
  from public.ph_request_delivery_outbox o
  where o.event_id = (event_result->>'jobId')::uuid
  for update;
  if event_row.event_id is null then
    raise exception using errcode = '55000', message = 'SEASON_PRIORITY_OUTBOX_MISSING';
  end if;
  if event_row.payload #>> '{reclassPayload,transaction,seasonPriority,requestFingerprint}' is distinct from request_fingerprint then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_TOKEN_CONFLICT';
  end if;

  insert into private.manager_season_priority_receipts(
    event_id, request_fingerprint, itemcode_normalized, actor_id, source_unique_id,
    selected_lineage_hash, expected_priority, scope_fingerprint, before_state_hash,
    expected_after_hash, created_inventory_revision, last_checked_inventory_revision
  ) values (
    event_row.event_id, request_fingerprint, itemcode_value, actor.id, source_row.unique_id,
    selected_lineage, p_expected_priority, current_scope_fingerprint, before_state_hash,
    after_state_hash, inventory_revision, inventory_revision
  ) returning * into receipt;

  return private.manager_season_priority_result_v1(receipt, event_row, false, false);
end
$function$;

create or replace function public.manager_season_priority_list_v1(
  p_actor_id uuid,
  p_assigned_to text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles := private.manager_season_priority_actor_v1(p_actor_id);
  filter_value text := case
    when lower(btrim(coalesce(p_assigned_to, 'all'))) in ('__unassigned__', 'unassigned') then '__unassigned__'
    else lower(regexp_replace(btrim(coalesce(p_assigned_to, 'all')), '[^a-z0-9]+', '_', 'g'))
  end;
  inventory_revision bigint;
  current_season text := upper(btrim(coalesce(private.season_sales_settings_v1()->>'seasonCode', '')));
  current_sales_year integer := private.season_sales_year_v1(private.season_sales_settings_v1()->>'salesYear');
  roster_available boolean := (select exists(select 1 from public.ph_warehouse_assigned_items));
  result jsonb;
begin
  perform 1
  from public.app_dataset_revisions r
  where r.key in ('ph_master_inventory', 'ph_cav_import', 'ph_warehouse_assigned_items')
  order by r.key
  for share;
  if exists (
    select 1
    from unnest(array['ph_master_inventory', 'ph_cav_import', 'ph_warehouse_assigned_items']) required(key)
    left join public.app_dataset_revisions r on r.key = required.key
    where r.key is null or r.state <> 'ready'
  ) then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_SOURCE_REFRESH_REQUIRED';
  end if;
  select r.revision into inventory_revision
  from public.app_dataset_revisions r where r.key = 'ph_master_inventory';
  if inventory_revision is null then
    raise exception using errcode = '55000', message = 'SEASON_PRIORITY_SOURCE_REVISION_MISSING';
  end if;

  with ranked as materialized (
    select m.*, to_jsonb(m) row_json,
      row_number() over (
        partition by upper(btrim(m.itemcode))
        order by coalesce(private.season_sales_safe_numeric_v1(m.ptravailable), -1) desc,
                 btrim(m.priority)::integer asc,
                 private.eval_work_natural_sort_key_v1(m.locationcode),
                 m.unique_id
      ) winner_rank
    from public.ph_master_inventory m
    where lower(btrim(coalesce(m.app_tab_assignment, ''))) = 'season'
      and upper(btrim(coalesce(m.season, ''))) = current_season
      and private.season_sales_year_v1(to_jsonb(m)->>'saleyear') <= current_sales_year
      and btrim(coalesce(m.priority, '')) ~ '^[1-4]$'
      and upper(btrim(coalesce(to_jsonb(m)->>'end_cap_folder', ''))) in ('', 'NULL', 'N/A', '-')
      and upper(coalesce(m.holdstopcode, '')) !~ '[HS]'
  ), eligible as materialized (
    select ranked.*
    from ranked
    where winner_rank = 1
      and btrim(priority) ~ '^[2-4]$'
      and exists (
        select 1 from public.ph_cav_import c
        where upper(btrim(c.itemcode)) = upper(btrim(ranked.itemcode))
          and upper(btrim(c.season)) = current_season
          and upper(btrim(coalesce(to_jsonb(c)->>'holdstopreason', to_jsonb(c)->>'hold_reason', ''))) in ('', 'NULL')
      )
  ), scope_hashes as (
    select upper(btrim(itemcode)) itemcode_normalized,
           private.manager_season_priority_scope_fingerprint_v1(min(itemcode)) scope_fingerprint
    from eligible
    group by upper(btrim(itemcode))
  ), enriched as (
    select e.*,
      coalesce(assignments.values, '{}'::text[]) warehouse_assigned_to,
      coalesce(resolved.values, '{}'::text[]) resolved_assigned_to,
      private.manager_season_priority_lineage_v1(e.row_json) lineage_hash,
      scope_hashes.scope_fingerprint
    from eligible e
    join scope_hashes on scope_hashes.itemcode_normalized = upper(btrim(e.itemcode))
    left join lateral (
      select array_agg(distinct btrim(a.assignedto) order by btrim(a.assignedto))
        filter (where nullif(btrim(coalesce(a.assignedto, '')), '') is not null) values
      from public.ph_warehouse_assigned_items a
      where upper(btrim(coalesce(a.itemcode_normalized, a.itemcode, ''))) = upper(btrim(e.itemcode))
    ) assignments on true
    left join lateral (
      select array_agg(distinct normalized.value order by normalized.value) values
      from (
        select lower(regexp_replace(btrim(raw.value), '[^a-z0-9]+', '_', 'g')) value
        from unnest(case when roster_available
          then coalesce(assignments.values, '{}'::text[])
          else regexp_split_to_array(coalesce(e.assignedto, ''), '[,&/|]+|[[:space:]]+[Aa][Nn][Dd][[:space:]]+')
        end) raw(value)
      ) normalized
      where normalized.value not in ('', 'all', 'unassigned', 'none', 'null', 'na', 'n_a')
    ) resolved on true
  ), filtered as (
    select * from enriched e
    where filter_value in ('', 'all')
       or (filter_value = '__unassigned__' and cardinality(e.resolved_assigned_to) = 0)
       or exists (
         select 1 from unnest(e.resolved_assigned_to) assigned(value)
         where value = filter_value
       )
  ), options as (
    select assigned.value, min(initcap(replace(assigned.value, '_', ' '))) label, count(*)::integer count
    from enriched e cross join lateral unnest(e.resolved_assigned_to) assigned(value)
    group by assigned.value
  )
  select jsonb_build_object(
    'ok', true,
    'contractVersion', 'manager-season-priority-v1',
    'inventoryRevision', inventory_revision,
    'inventoryState', 'ready',
    'assignedToOptions', coalesce((select jsonb_agg(jsonb_build_object(
      'value', value, 'label', label, 'count', count
    ) order by label) from options), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'sourceUid', f.unique_id,
      'itemcode', coalesce(f.itemcode, ''),
      'commonname', coalesce(f.commonname, ''),
      'contsize', coalesce(f.contsize, ''),
      'locationcode', coalesce(f.locationcode, ''),
      'lotcode', coalesce(f.lotcode, ''),
      'blockalpha', coalesce(f.blockalpha, ''),
      'source', coalesce(f.source, ''),
      'season', coalesce(f.season, ''),
      'salesyear', coalesce(f.row_json->>'saleyear', ''),
      'priority', (btrim(f.priority))::integer,
      'ptravailable', coalesce(f.ptravailable, ''),
      'currentAssignment', coalesce(f.app_tab_assignment, ''),
      'assignedTo', coalesce(f.assignedto, ''),
      'warehouseAssignedTo', to_jsonb(f.warehouse_assigned_to),
      'resolvedAssignedTo', to_jsonb(f.resolved_assigned_to),
      'assignmentAuthoritative', roster_available,
      'noteContext', jsonb_build_object(
        'avNote', coalesce(f.av_note, ''),
        'salesNote', coalesce(f.sales_note, ''),
        'locationNote', coalesce(f.locationnote, ''),
        'picNote', coalesce(f.pic_note, '')
      ),
      'lineageHash', f.lineage_hash,
      'scopeFingerprint', f.scope_fingerprint
    ) order by upper(coalesce(f.blockalpha, '')), upper(coalesce(f.locationcode, '')),
               upper(coalesce(f.itemcode, '')), f.unique_id) from filtered f), '[]'::jsonb)
  ) into result;
  return result;
end
$function$;

create or replace function private.manager_season_priority_scope_v1(p_itemcode text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceUid', row_json->>'unique_id',
    'lineageHash', private.manager_season_priority_lineage_v1(row_json),
    'warehouse', coalesce(row_json->>'warehouseid', row_json->>'warehousei', ''),
    'itemcode', coalesce(row_json->>'itemcode', ''),
    'contsize', coalesce(row_json->>'contsize', ''),
    'locationcode', coalesce(row_json->>'locationcode', ''),
    'lotcode', coalesce(row_json->>'lotcode', ''),
    'source', coalesce(row_json->>'source', ''),
    'desigitem', coalesce(row_json->>'desigitem', ''),
    'desigcust', coalesce(row_json->>'desigcust', ''),
    'desigloc', coalesce(row_json->>'desigloc', ''),
    'priority', btrim(coalesce(row_json->>'priority', '')),
    'ptronhand', coalesce(row_json->>'ptronhand', ''),
    'ptravailable', coalesce(row_json->>'ptravailable', '')
  ) order by private.manager_season_priority_lineage_v1(row_json), row_json->>'unique_id'), '[]'::jsonb)
  from (
    select to_jsonb(m) row_json
    from public.ph_master_inventory m
    where upper(btrim(coalesce(m.itemcode, ''))) = upper(btrim(coalesce(p_itemcode, '')))
  ) rows
$function$;

create or replace function private.manager_season_priority_scope_fingerprint_v1(p_itemcode text)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select encode(extensions.digest(private.manager_season_priority_scope_v1(p_itemcode)::text, 'sha256'), 'hex')
$function$;

create or replace function private.manager_season_priority_state_hash_v1(p_itemcode text)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select encode(extensions.digest(coalesce(jsonb_agg(jsonb_build_object(
    'lineageHash', private.manager_season_priority_lineage_v1(row_json),
    'priority', btrim(coalesce(row_json->>'priority', ''))
  ) order by private.manager_season_priority_lineage_v1(row_json), btrim(coalesce(row_json->>'priority', '')), row_json->>'unique_id'), '[]'::jsonb)::text, 'sha256'), 'hex')
  from (
    select to_jsonb(m) row_json
    from public.ph_master_inventory m
    where upper(btrim(coalesce(m.itemcode, ''))) = upper(btrim(coalesce(p_itemcode, '')))
  ) rows
$function$;

create or replace function private.manager_season_priority_winner_uid_v1(p_itemcode text)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select m.unique_id
  from public.ph_master_inventory m
  where upper(btrim(m.itemcode)) = upper(btrim(p_itemcode))
    and lower(btrim(coalesce(m.app_tab_assignment, ''))) = 'season'
    and upper(btrim(coalesce(m.season, ''))) = upper(btrim(coalesce(private.season_sales_settings_v1()->>'seasonCode', '')))
    and private.season_sales_year_v1(to_jsonb(m)->>'saleyear') <= private.season_sales_year_v1(private.season_sales_settings_v1()->>'salesYear')
    and btrim(coalesce(m.priority, '')) ~ '^[1-4]$'
    and upper(btrim(coalesce(to_jsonb(m)->>'end_cap_folder', ''))) in ('', 'NULL', 'N/A', '-')
    and upper(coalesce(m.holdstopcode, '')) !~ '[HS]'
  order by coalesce(private.season_sales_safe_numeric_v1(m.ptravailable), -1) desc,
           btrim(m.priority)::integer asc,
           private.eval_work_natural_sort_key_v1(m.locationcode),
           m.unique_id
  limit 1
$function$;

create or replace function private.manager_season_priority_row_eligible_v1(p_row jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    btrim(coalesce(p_row->>'unique_id', '')) = private.manager_season_priority_winner_uid_v1(p_row->>'itemcode')
    and btrim(coalesce(p_row->>'priority', '')) ~ '^[2-4]$'
    and exists (
      select 1
      from public.ph_cav_import c
      where upper(btrim(coalesce(c.itemcode, ''))) = upper(btrim(coalesce(p_row->>'itemcode', '')))
        and upper(btrim(coalesce(c.season, ''))) = upper(btrim(coalesce(private.season_sales_settings_v1()->>'seasonCode', '')))
        and upper(btrim(coalesce(to_jsonb(c)->>'holdstopreason', to_jsonb(c)->>'hold_reason', ''))) in ('', 'NULL')
    ), false)
$function$;

create or replace function private.manager_season_priority_lifecycle_v1(
  p_receipt private.manager_season_priority_receipts,
  p_event public.ph_request_delivery_outbox
)
returns text
language sql
stable
set search_path = ''
as $function$
  select case
    when p_receipt.resolution = 'fulfilled' then 'fulfilled'
    when p_receipt.resolution = 'stale' then 'superseded'
    when p_event.status = 'delivered' then 'awaiting_import'
    when p_event.status = 'processing' then 'processing'
    when p_event.status in ('failed', 'unknown')
      and upper(coalesce(p_event.sanitized_error_code, '')) like 'RECLASS_CONFLICT%' then 'conflict'
    when p_event.status in ('failed', 'unknown') then 'delivery_failed'
    else 'queued'
  end
$function$;

create or replace function private.manager_season_priority_result_v1(
  p_receipt private.manager_season_priority_receipts,
  p_event public.ph_request_delivery_outbox,
  p_duplicate boolean default false,
  p_retried boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select private.drive_reclass_delivery_result_v1(p_event) || jsonb_build_object(
    'contractVersion', 'manager-season-priority-v1',
    'eventId', p_event.event_id,
    'duplicate', p_duplicate,
    'retried', p_retried,
    'pending', p_receipt.resolution is null,
    'itemcode', p_receipt.itemcode_normalized,
    'sourceUid', p_receipt.source_unique_id,
    'selectedLineageHash', p_receipt.selected_lineage_hash,
    'expectedPriority', p_receipt.expected_priority,
    'scopeFingerprint', p_receipt.scope_fingerprint,
    'requestFingerprint', p_receipt.request_fingerprint,
    'inventoryRevision', p_receipt.created_inventory_revision,
    'deliveryStatus', private.drive_reclass_delivery_result_v1(p_event)->>'status',
    'lifecycleStatus', private.manager_season_priority_lifecycle_v1(p_receipt, p_event),
    'canRetry', p_receipt.resolution is null and p_event.status in ('failed', 'unknown')
      and upper(coalesce(p_event.sanitized_error_code, '')) not like 'RECLASS_CONFLICT%',
    'retryRequest', jsonb_build_object(
      'sourceUid', p_receipt.source_unique_id,
      'expectedPriority', p_receipt.expected_priority,
      'scopeFingerprint', p_receipt.scope_fingerprint
    ),
    'createdAt', p_receipt.created_at,
    'resolvedAt', p_receipt.resolved_at,
    'resolution', p_receipt.resolution
  )
$function$;

create or replace function public.manager_season_priority_state_v1(
  p_actor_id uuid,
  p_itemcodes text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles := private.manager_season_priority_actor_v1(p_actor_id);
  normalized_itemcodes text[];
  inventory_revision bigint;
  inventory_state text;
  pending record;
  current_hash text;
  result jsonb;
begin
  if p_itemcodes is not null and cardinality(p_itemcodes) > 100 then
    raise exception using errcode = '22023', message = 'SEASON_PRIORITY_STATE_LIMIT';
  end if;
  select coalesce(array_agg(distinct upper(btrim(value))) filter (where btrim(coalesce(value, '')) <> ''), '{}'::text[])
    into normalized_itemcodes from unnest(coalesce(p_itemcodes, '{}'::text[])) value;
  perform 1 from public.app_dataset_revisions r
  where r.key = 'ph_master_inventory'
  for share;
  select r.revision, r.state into inventory_revision, inventory_state
  from public.app_dataset_revisions r where r.key = 'ph_master_inventory';
  if inventory_revision is null then
    raise exception using errcode = '55000', message = 'SEASON_PRIORITY_SOURCE_REVISION_MISSING';
  end if;

  if inventory_state = 'ready' then
    for pending in
      select receipt.event_id, receipt.itemcode_normalized,
             receipt.before_state_hash, receipt.expected_after_hash,
             event.status as delivery_status,
             event.sanitized_error_code
      from private.manager_season_priority_receipts receipt
      join public.ph_request_delivery_outbox event on event.event_id = receipt.event_id
      where receipt.resolution is null
        and (
          inventory_revision > receipt.last_checked_inventory_revision
          or (
            event.status in ('failed', 'unknown')
            and upper(coalesce(event.sanitized_error_code, '')) like 'RECLASS_CONFLICT%'
          )
        )
        and (p_itemcodes is null or receipt.itemcode_normalized = any(normalized_itemcodes))
      order by receipt.created_at, receipt.event_id
      limit 200
      for update of receipt
    loop
      current_hash := private.manager_season_priority_state_hash_v1(pending.itemcode_normalized);
      if current_hash = pending.expected_after_hash then
        update private.manager_season_priority_receipts receipt
        set resolution = 'fulfilled', resolved_at = now(),
            resolved_inventory_revision = inventory_revision,
            resolution_snapshot_hash = current_hash,
            last_checked_inventory_revision = inventory_revision
        where receipt.event_id = pending.event_id and receipt.resolution is null;
      elsif current_hash <> pending.before_state_hash
         or (
           pending.delivery_status in ('failed', 'unknown')
           and upper(coalesce(pending.sanitized_error_code, '')) like 'RECLASS_CONFLICT%'
         ) then
        update private.manager_season_priority_receipts receipt
        set resolution = 'stale', resolved_at = now(),
            resolved_inventory_revision = inventory_revision,
            resolution_snapshot_hash = current_hash,
            last_checked_inventory_revision = inventory_revision
        where receipt.event_id = pending.event_id and receipt.resolution is null;
      else
        update private.manager_season_priority_receipts receipt
        set last_checked_inventory_revision = inventory_revision
        where receipt.event_id = pending.event_id and receipt.resolution is null;
      end if;
    end loop;
  end if;

  with active as (
    select receipt, event
    from private.manager_season_priority_receipts receipt
    join public.ph_request_delivery_outbox event on event.event_id = receipt.event_id
    where receipt.resolution is null
      and (p_itemcodes is null or receipt.itemcode_normalized = any(normalized_itemcodes))
    order by receipt.created_at desc, receipt.event_id desc
  ), recent_terminal as (
    select receipt, event
    from private.manager_season_priority_receipts receipt
    join public.ph_request_delivery_outbox event on event.event_id = receipt.event_id
    where receipt.resolution is not null
      and (p_itemcodes is null or receipt.itemcode_normalized = any(normalized_itemcodes))
    order by receipt.created_at desc, receipt.event_id desc
    limit 100
  ), selected as (
    select * from active
    union all
    select * from recent_terminal
  )
  select jsonb_build_object(
    'ok', true,
    'contractVersion', 'manager-season-priority-v1',
    'inventoryRevision', inventory_revision,
    'inventoryState', inventory_state,
    'requests', coalesce(jsonb_agg(private.manager_season_priority_result_v1(receipt, event, false, false)
      order by (receipt).created_at desc, (receipt).event_id desc), '[]'::jsonb)
  ) into result from selected;
  return result;
end
$function$;

revoke all on function private.manager_season_priority_actor_v1(uuid) from public, anon, authenticated;
revoke all on function private.manager_season_priority_lineage_v1(jsonb) from public, anon, authenticated;
revoke all on function private.manager_season_priority_scope_v1(text) from public, anon, authenticated;
revoke all on function private.manager_season_priority_scope_fingerprint_v1(text) from public, anon, authenticated;
revoke all on function private.manager_season_priority_state_hash_v1(text) from public, anon, authenticated;
revoke all on function private.manager_season_priority_winner_uid_v1(text) from public, anon, authenticated;
revoke all on function private.manager_season_priority_row_eligible_v1(jsonb) from public, anon, authenticated;
revoke all on function private.manager_season_priority_lifecycle_v1(private.manager_season_priority_receipts, public.ph_request_delivery_outbox) from public, anon, authenticated;
revoke all on function private.manager_season_priority_result_v1(private.manager_season_priority_receipts, public.ph_request_delivery_outbox, boolean, boolean) from public, anon, authenticated;
revoke all on function public.manager_season_priority_list_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.submit_manager_season_priority_v1(uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.manager_season_priority_state_v1(uuid, text[]) from public, anon, authenticated;

grant execute on function public.manager_season_priority_list_v1(uuid, text) to service_role;
grant execute on function public.submit_manager_season_priority_v1(uuid, text, integer, text, text) to service_role;
grant execute on function public.manager_season_priority_state_v1(uuid, text[]) to service_role;

insert into private.app_access_legacy_baseline(profile_id, permission_key, allowed, access_scope)
select p.id, e.permission_key, e.allowed, e.access_scope
from public.profiles p
cross join lateral private.get_effective_app_permissions_v1(
  p.id, private.resolve_app_access_policy_id_v1(true)
) e
where e.permission_key = 'managers.season_priority.submit'
on conflict(profile_id, permission_key) do nothing;

notify pgrst, 'reload schema';

commit;
