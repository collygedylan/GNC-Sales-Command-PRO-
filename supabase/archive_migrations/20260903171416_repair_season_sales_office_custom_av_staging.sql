begin;

-- Season Sales Notes is a durable staging queue for the external Custom AV
-- program.  ph_sales_office remains the open-work mirror; this state table is
-- the authoritative lifecycle record that survives Done.

alter table public.ph_sales_office
  add column if not exists workflow_status text,
  add column if not exists workflow_detail jsonb not null default '{}'::jsonb,
  add column if not exists state_revision integer not null default 1,
  add column if not exists reopen_reason text,
  add column if not exists source_revision text,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.ph_season_sales_office_state (
  id uuid primary key default gen_random_uuid(),
  season_code text not null,
  sales_year integer not null,
  itemcode_normalized text not null,
  winner_unique_id text not null,
  status text not null default 'open' check (status in ('open', 'done', 'retired')),
  revision integer not null default 1 check (revision > 0),
  readiness_status text not null default 'needs_photo_data',
  reopen_reason text,
  completed_by text,
  completed_at timestamptz,
  cav_watermark timestamptz,
  evidence_ready_at_completion boolean,
  evidence_ready_seen_after_completion boolean not null default false,
  completed_evidence_snapshot jsonb,
  current_evidence_snapshot jsonb not null default '{}'::jsonb,
  source_fingerprint text not null default '',
  import_revision text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_code, sales_year, itemcode_normalized)
);

create table if not exists public.ph_season_sales_office_events (
  id bigint generated always as identity primary key,
  state_id uuid references public.ph_season_sales_office_state(id) on delete restrict,
  event_type text not null check (event_type in (
    'opened', 'winner_changed', 'av_note_saved', 'completed', 'reopened',
    'retired', 'reconciled'
  )),
  actor_username text not null,
  revision integer,
  reason_code text,
  metadata jsonb not null default '{}'::jsonb check (octet_length(metadata::text) <= 4096),
  created_at timestamptz not null default now()
);

create table if not exists private.season_sales_office_idempotency (
  operation text not null,
  actor_username text not null,
  idempotency_key text not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (operation, actor_username, idempotency_key)
);

create index if not exists ph_season_sales_office_state_status_scope_idx
  on public.ph_season_sales_office_state (status, season_code, sales_year, updated_at desc);
create index if not exists ph_season_sales_office_state_winner_idx
  on public.ph_season_sales_office_state (winner_unique_id);
create index if not exists ph_season_sales_office_events_state_created_idx
  on public.ph_season_sales_office_events (state_id, created_at desc);
create index if not exists ph_sales_office_season_itemcode_idx
  on public.ph_sales_office (upper(btrim(itemcode)), updated_at desc)
  where lower(btrim(coalesce(so_source, 'season'))) = 'season';
create index if not exists ph_master_inventory_season_winner_idx
  on public.ph_master_inventory (
    upper(btrim(itemcode)), upper(btrim(season)), saleyear,
    priority, ptravailable, unique_id
  );
create index if not exists ph_master_inventory_sales_assignment_scope_idx
  on public.ph_master_inventory (
    lower(btrim(coalesce(app_tab_assignment, ''))),
    upper(btrim(season)), upper(btrim(itemcode))
  );
create index if not exists ph_cav_import_season_itemcode_updated_idx
  on public.ph_cav_import (upper(btrim(itemcode)), upper(btrim(season)), last_updated desc);

alter table public.ph_season_sales_office_state enable row level security;
alter table public.ph_season_sales_office_events enable row level security;

revoke all on table public.ph_season_sales_office_state from public, anon, authenticated;
revoke all on table public.ph_season_sales_office_events from public, anon, authenticated;
revoke all on table private.season_sales_office_idempotency from public, anon, authenticated;
grant select on table public.ph_season_sales_office_state to authenticated;
grant select on table public.ph_season_sales_office_events to authenticated;
grant all on table public.ph_season_sales_office_state to service_role;
grant all on table public.ph_season_sales_office_events to service_role;
grant all on table private.season_sales_office_idempotency to service_role;
grant usage, select on sequence public.ph_season_sales_office_events_id_seq to service_role;

drop policy if exists "Sales Office users read season staging state" on public.ph_season_sales_office_state;
create policy "Sales Office users read season staging state"
on public.ph_season_sales_office_state for select to authenticated
using (
  exists (
    select 1
    from private.get_effective_app_permissions_v1(
      (private.current_active_profile()).id,
      private.resolve_app_access_policy_id_v1(false)
    ) permission
    where permission.permission_key = 'module.sales-office.view'
      and permission.allowed
  )
);

drop policy if exists "Sales Office users read season staging events" on public.ph_season_sales_office_events;
create policy "Sales Office users read season staging events"
on public.ph_season_sales_office_events for select to authenticated
using (
  exists (
    select 1
    from private.get_effective_app_permissions_v1(
      (private.current_active_profile()).id,
      private.resolve_app_access_policy_id_v1(false)
    ) permission
    where permission.permission_key = 'module.sales-office.view'
      and permission.allowed
  )
);

create or replace function private.prevent_season_sales_event_mutation_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '42501', message = 'SEASON_SALES_AUDIT_APPEND_ONLY';
end
$function$;

drop trigger if exists ph_season_sales_office_events_append_only
  on public.ph_season_sales_office_events;
create trigger ph_season_sales_office_events_append_only
before update or delete on public.ph_season_sales_office_events
for each row execute function private.prevent_season_sales_event_mutation_v1();

create or replace function private.season_sales_safe_numeric_v1(p_value text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $function$
declare
  cleaned text := regexp_replace(coalesce(p_value, ''), '[^0-9.-]', '', 'g');
begin
  if cleaned !~ '^-?[0-9]+([.][0-9]+)?$' then return null; end if;
  return cleaned::numeric;
exception when others then
  return null;
end
$function$;

create or replace function private.season_sales_year_v1(p_value text)
returns integer
language plpgsql
immutable
set search_path = ''
as $function$
declare
  parsed numeric := private.season_sales_safe_numeric_v1(p_value);
begin
  if parsed is null then return null; end if;
  if parsed >= 2000 then return (parsed::integer % 100); end if;
  return parsed::integer;
end
$function$;

create or replace function private.season_sales_settings_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select s.value from public.ph_app_settings s
    where s.key = 'current_season_salesyear' limit 1
  ), '{}'::jsonb)
$function$;

create or replace function private.season_sales_assignment_protected_v1(p_assignment text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select lower(btrim(coalesce(p_assignment, ''))) in (
    'flyer', 'endcap', 'sales-office', 'sales-office-order', 'move', 'moves',
    'eval-task', 'not_on_inventory_dylan', 'not_on_inventory_jd',
    'not_on_inventory_denied'
  ) or lower(btrim(coalesce(p_assignment, ''))) like 'ncr\_%' escape '\'
$function$;

create or replace function private.season_sales_evidence_v1(p_row jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  bundle_at timestamptz;
  reasons text[] := '{}'::text[];
  has_photo boolean;
  has_note boolean;
  has_match boolean;
  match_qty numeric;
  ready boolean;
begin
  has_photo := btrim(coalesce(p_row->>'photo_link', '')) <> '';
  has_note := btrim(coalesce(p_row->>'av_note', '')) <> '';
  has_match := btrim(coalesce(p_row->>'match', '')) <> '';
  match_qty := private.season_sales_safe_numeric_v1(p_row->>'loc_match_qty');
  bundle_at := greatest(
    nullif(p_row->>'av_rule_bundle_updated_at', '')::timestamptz,
    nullif(p_row->>'av_rule_av_note_updated_at', '')::timestamptz,
    nullif(p_row->>'av_rule_spec_updated_at', '')::timestamptz,
    nullif(p_row->>'av_rule_match_updated_at', '')::timestamptz,
    nullif(p_row->>'av_rule_caliper_updated_at', '')::timestamptz,
    nullif(p_row->>'av_rule_photo_updated_at', '')::timestamptz,
    nullif(p_row->>'date_completed', '')::timestamptz
  );
  if not has_photo then reasons := array_append(reasons, 'photo_missing'); end if;
  if not has_note then reasons := array_append(reasons, 'av_note_missing'); end if;
  if not has_match then reasons := array_append(reasons, 'match_missing'); end if;
  if match_qty is null or match_qty <= 0 then reasons := array_append(reasons, 'loc_match_qty_missing'); end if;
  if bundle_at is not null and bundle_at < now() - interval '10 days' then
    reasons := array_append(reasons, 'photo_or_evidence_expired');
  end if;
  if nullif(p_row->>'av_rule_last_cleared_at', '')::timestamptz is not null
     and (bundle_at is null or nullif(p_row->>'av_rule_last_cleared_at', '')::timestamptz >= bundle_at) then
    reasons := array_append(reasons, coalesce(nullif(p_row->>'av_rule_last_clear_reason', ''), 'evidence_invalidated'));
  end if;
  ready := cardinality(reasons) = 0;
  return jsonb_build_object(
    'ready', ready,
    'status', case when ready then 'ready_for_custom_av' else 'needs_photo_data' end,
    'reasons', to_jsonb(reasons),
    'bundleUpdatedAt', bundle_at,
    'fingerprint', encode(extensions.digest(concat_ws('|',
      coalesce(p_row->>'photo_link', ''), coalesce(p_row->>'photo_name', ''),
      coalesce(p_row->>'av_note', ''), coalesce(p_row->>'spec', ''),
      coalesce(p_row->>'caliper', ''), coalesce(p_row->>'match', ''),
      coalesce(p_row->>'loc_match_qty', ''), coalesce(p_row->>'av_rule_last_cleared_at', '')
    ), 'sha256'), 'hex')
  );
exception when others then
  return jsonb_build_object('ready', false, 'status', 'needs_photo_data',
    'reasons', jsonb_build_array('evidence_timestamp_invalid'), 'fingerprint', 'invalid');
end
$function$;

create or replace function private.season_sales_assert_actor_v1(p_username text)
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  allowed boolean := false;
begin
  select p.* into actor
  from public.profiles p
  where lower(btrim(p.username)) = lower(btrim(coalesce(p_username, '')))
    and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now())
    and not p.must_change_password
  limit 1;
  if actor.id is null then
    raise exception using errcode = '42501', message = 'SEASON_SALES_PROFILE_NOT_ACTIVE';
  end if;
  select coalesce(permission.allowed, false) into allowed
  from private.get_effective_app_permissions_v1(
    actor.id, private.resolve_app_access_policy_id_v1(false)
  ) permission
  where permission.permission_key = 'module.sales-office.view'
  limit 1;
  if not coalesce(allowed, false) then
    raise exception using errcode = '42501', message = 'SEASON_SALES_PERMISSION_REQUIRED';
  end if;
  return actor;
end
$function$;

create or replace function private.season_sales_mirror_winner_v1(
  p_winner public.ph_master_inventory,
  p_state public.ph_season_sales_office_state
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  delete from public.ph_sales_office sales
  where lower(btrim(coalesce(sales.so_source, 'season'))) = 'season'
    and upper(btrim(coalesce(sales.itemcode, ''))) = p_state.itemcode_normalized
    and coalesce(sales.master_id, sales.unique_id) <> p_winner.unique_id;

  insert into public.ph_sales_office (
    unique_id, master_id, so_source, itemcode, commonname, contsize,
    locationcode, lotcode, ptravailable, priority, av_note, sales_note,
    spec, caliper, photo_link, photo_name, completed_by, completed_at,
    workflow_status, workflow_detail, state_revision, reopen_reason,
    source_revision, updated_at
  ) values (
    p_winner.unique_id, p_winner.unique_id, 'season', p_winner.itemcode,
    p_winner.commonname, p_winner.contsize, p_winner.locationcode,
    p_winner.lotcode, p_winner.ptravailable, p_winner.priority,
    p_winner.av_note, p_winner.sales_note, p_winner.spec, p_winner.caliper,
    p_winner.photo_link, p_winner.photo_name, null, null,
    p_state.readiness_status, p_state.current_evidence_snapshot,
    p_state.revision, p_state.reopen_reason, p_state.import_revision, now()
  )
  on conflict (unique_id) do update set
    master_id = excluded.master_id,
    so_source = excluded.so_source,
    itemcode = excluded.itemcode,
    commonname = excluded.commonname,
    contsize = excluded.contsize,
    locationcode = excluded.locationcode,
    lotcode = excluded.lotcode,
    ptravailable = excluded.ptravailable,
    priority = excluded.priority,
    av_note = excluded.av_note,
    sales_note = excluded.sales_note,
    spec = excluded.spec,
    caliper = excluded.caliper,
    photo_link = excluded.photo_link,
    photo_name = excluded.photo_name,
    completed_by = null,
    completed_at = null,
    workflow_status = excluded.workflow_status,
    workflow_detail = excluded.workflow_detail,
    state_revision = excluded.state_revision,
    reopen_reason = excluded.reopen_reason,
    source_revision = excluded.source_revision,
    updated_at = now();
end
$function$;

create or replace function public.reconcile_season_sales_office_v1(
  p_itemcodes text[] default null,
  p_dry_run boolean default true,
  p_import_revision text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  settings jsonb := private.season_sales_settings_v1();
  current_season text;
  current_sales_year integer;
  scope_hash text;
  prior_response jsonb;
  prior_hash text;
  winner public.ph_master_inventory;
  state_row public.ph_season_sales_office_state;
  evidence jsonb;
  current_cav_watermark timestamptz;
  newer_blank_at timestamptz;
  event_type text;
  reopen_reason_value text;
  expected_count integer := 0;
  open_count integer := 0;
  done_count integer := 0;
  create_count integer := 0;
  winner_change_count integer := 0;
  reopen_count integer := 0;
  retire_count integer := 0;
  mirror_upsert_count integer := 0;
  response_value jsonb;
begin
  perform set_config('lock_timeout', '2000', true);
  perform set_config('statement_timeout', '25000', true);
  current_season := upper(btrim(coalesce(settings->>'seasonCode', '')));
  current_sales_year := private.season_sales_year_v1(settings->>'salesYear');
  if current_season = '' or current_sales_year is null then
    raise exception using errcode = '22023', message = 'SEASON_SALES_SETTINGS_INVALID';
  end if;
  if p_idempotency_key is not null and (length(btrim(p_idempotency_key)) < 12 or length(btrim(p_idempotency_key)) > 180) then
    raise exception using errcode = '22023', message = 'SEASON_SALES_TOKEN_INVALID';
  end if;

  scope_hash := encode(extensions.digest(concat_ws('|', current_season, current_sales_year::text,
    coalesce(array_to_string(p_itemcodes, ','), '*'), coalesce(p_import_revision, '')), 'sha256'), 'hex');
  if not coalesce(p_dry_run, true) and p_idempotency_key is not null then
    select request.response, request.request_hash into prior_response, prior_hash
    from private.season_sales_office_idempotency request
    where request.operation = 'reconcile'
      and request.actor_username = 'service_role'
      and request.idempotency_key = btrim(p_idempotency_key);
    if prior_response is not null then
      if prior_hash is distinct from scope_hash then
        raise exception using errcode = '22023', message = 'SEASON_SALES_TOKEN_CONFLICT';
      end if;
      return prior_response;
    end if;
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended('season-sales-office-v1', 0)) then
    return jsonb_build_object('ok', true, 'status', 'maintenance_deferred',
      'code', 'MAINTENANCE_DEFERRED');
  end if;

  create temporary table if not exists season_sales_target_items_v1 (
    itemcode_normalized text primary key
  ) on commit drop;
  truncate season_sales_target_items_v1;
  if cardinality(coalesce(p_itemcodes, '{}'::text[])) > 0 then
    insert into season_sales_target_items_v1(itemcode_normalized)
    select distinct upper(btrim(requested.value))
    from unnest(p_itemcodes) requested(value)
    where btrim(coalesce(requested.value, '')) <> ''
      and (
        exists (
          select 1
          from public.ph_master_inventory scoped
          where upper(btrim(coalesce(scoped.itemcode, ''))) = upper(btrim(requested.value))
            and upper(btrim(coalesce(scoped.season, ''))) = current_season
            and private.season_sales_year_v1(scoped.saleyear) <= current_sales_year
            and lower(btrim(coalesce(scoped.app_tab_assignment, ''))) in ('season', 'location')
        )
        or exists (
          select 1
          from public.ph_season_sales_office_state state
          where state.season_code = current_season
            and state.sales_year = current_sales_year
            and state.itemcode_normalized = upper(btrim(requested.value))
        )
        or exists (
          select 1
          from public.ph_sales_office sales
          where lower(btrim(coalesce(sales.so_source, 'season'))) = 'season'
            and upper(btrim(coalesce(sales.itemcode, ''))) = upper(btrim(requested.value))
        )
      );
  else
    insert into season_sales_target_items_v1(itemcode_normalized)
    select distinct upper(btrim(m.itemcode))
    from public.ph_master_inventory m
    where btrim(coalesce(m.itemcode, '')) <> ''
      and upper(btrim(coalesce(m.season, ''))) = current_season
      and private.season_sales_year_v1(m.saleyear) <= current_sales_year
      and lower(btrim(coalesce(m.app_tab_assignment, ''))) in ('season', 'location')
    union
    select state.itemcode_normalized
    from public.ph_season_sales_office_state state
    where state.season_code = current_season and state.sales_year = current_sales_year
    union
    select distinct upper(btrim(sales.itemcode))
    from public.ph_sales_office sales
    where lower(btrim(coalesce(sales.so_source, 'season'))) = 'season'
      and btrim(coalesce(sales.itemcode, '')) <> '';
  end if;

  create temporary table if not exists season_sales_winners_v1 (
    itemcode_normalized text primary key,
    unique_id text not null
  ) on commit drop;
  truncate season_sales_winners_v1;
  insert into season_sales_winners_v1(itemcode_normalized, unique_id)
  select ranked.itemcode_normalized, ranked.unique_id
  from (
    select upper(btrim(m.itemcode)) itemcode_normalized, m.unique_id,
      row_number() over (
        partition by upper(btrim(m.itemcode))
        order by coalesce(private.season_sales_safe_numeric_v1(m.ptravailable), -1) desc,
          btrim(m.priority)::integer asc,
          private.eval_work_natural_sort_key_v1(m.locationcode),
          private.eval_work_natural_sort_key_v1(m.lotcode),
          m.unique_id
      ) winner_rank
    from public.ph_master_inventory m
    join season_sales_target_items_v1 target
      on target.itemcode_normalized = upper(btrim(m.itemcode))
    where upper(btrim(coalesce(m.season, ''))) = current_season
      and private.season_sales_year_v1(m.saleyear) <= current_sales_year
      and btrim(coalesce(m.priority, '')) ~ '^[1-4]$'
      and upper(btrim(coalesce(m.end_cap_folder, ''))) in ('', 'NULL', 'N/A', '-')
      and upper(coalesce(m.holdstopcode, '')) !~ '[HS]'
      and not private.season_sales_assignment_protected_v1(m.app_tab_assignment)
  ) ranked
  where ranked.winner_rank = 1;

  select count(*) into expected_count from season_sales_winners_v1;
  select count(*) into create_count
  from season_sales_winners_v1 winner_key
  left join public.ph_season_sales_office_state state
    on state.season_code = current_season and state.sales_year = current_sales_year
   and state.itemcode_normalized = winner_key.itemcode_normalized
  where state.id is null;
  select count(*) into winner_change_count
  from season_sales_winners_v1 winner_key
  join public.ph_season_sales_office_state state
    on state.season_code = current_season and state.sales_year = current_sales_year
   and state.itemcode_normalized = winner_key.itemcode_normalized
  where state.winner_unique_id <> winner_key.unique_id;
  select count(*) into retire_count
  from public.ph_season_sales_office_state state
  join season_sales_target_items_v1 target using (itemcode_normalized)
  left join season_sales_winners_v1 winner_key using (itemcode_normalized)
  where state.season_code = current_season and state.sales_year = current_sales_year
    and state.status <> 'retired' and winner_key.unique_id is null;

  select count(*) into reopen_count
  from public.ph_season_sales_office_state state
  join season_sales_winners_v1 winner_key using (itemcode_normalized)
  join public.ph_master_inventory m on m.unique_id = winner_key.unique_id
  where state.season_code = current_season
    and state.sales_year = current_sales_year
    and state.status = 'done'
    and state.winner_unique_id = winner_key.unique_id
    and (
      exists (
        select 1 from public.ph_cav_import c
        where upper(btrim(coalesce(c.itemcode, ''))) = state.itemcode_normalized
          and upper(btrim(coalesce(c.season, ''))) = current_season
          and btrim(coalesce(c.holdstopreason, '')) = ''
          and c.last_updated > coalesce(state.cav_watermark, state.completed_at, '-infinity'::timestamptz)
      )
      or m.av_rule_last_cleared_at > state.completed_at
      or (
        state.evidence_ready_seen_after_completion
        and not coalesce((private.season_sales_evidence_v1(to_jsonb(m))->>'ready')::boolean, false)
      )
    );

  if coalesce(p_dry_run, true) then
    return jsonb_build_object('ok', true, 'status', 'dry_run',
      'seasonCode', current_season, 'salesYear', current_sales_year,
      'winnerCount', expected_count, 'newStateCount', create_count,
      'winnerChangeCount', winner_change_count, 'retireCount', retire_count,
      'reopenCount', reopen_count,
      'scopeCount', (select count(*) from season_sales_target_items_v1));
  end if;

  -- Keep Season/Location assignment classification authoritative for current
  -- scope rows, including H/S rows which are always Location Sales Notes.
  update public.ph_master_inventory m
  set app_tab_assignment = case when winner_key.unique_id = m.unique_id then 'season' else 'location' end,
      last_updated = coalesce(m.last_updated, now())
  from season_sales_target_items_v1 target
  left join season_sales_winners_v1 winner_key using (itemcode_normalized)
  where target.itemcode_normalized = upper(btrim(coalesce(m.itemcode, '')))
    and upper(btrim(coalesce(m.season, ''))) = current_season
    and private.season_sales_year_v1(m.saleyear) <= current_sales_year
    and upper(btrim(coalesce(m.end_cap_folder, ''))) in ('', 'NULL', 'N/A', '-')
    and not private.season_sales_assignment_protected_v1(m.app_tab_assignment)
    and m.app_tab_assignment is distinct from case when winner_key.unique_id = m.unique_id then 'season' else 'location' end;

  for winner in
    select m.*
    from season_sales_winners_v1 winner_key
    join public.ph_master_inventory m on m.unique_id = winner_key.unique_id
    order by winner_key.itemcode_normalized
  loop
    select * into state_row
    from public.ph_season_sales_office_state state
    where state.season_code = current_season and state.sales_year = current_sales_year
      and state.itemcode_normalized = upper(btrim(winner.itemcode))
    for update;
    evidence := private.season_sales_evidence_v1(to_jsonb(winner));
    select max(c.last_updated) into current_cav_watermark
    from public.ph_cav_import c
    where upper(btrim(coalesce(c.itemcode, ''))) = upper(btrim(winner.itemcode))
      and upper(btrim(coalesce(c.season, ''))) = current_season;
    event_type := null;
    reopen_reason_value := null;

    if state_row.id is null then
      insert into public.ph_season_sales_office_state (
        season_code, sales_year, itemcode_normalized, winner_unique_id,
        status, revision, readiness_status, current_evidence_snapshot,
        source_fingerprint, import_revision
      ) values (
        current_season, current_sales_year, upper(btrim(winner.itemcode)),
        winner.unique_id, 'open', 1, evidence->>'status', evidence,
        evidence->>'fingerprint', p_import_revision
      ) returning * into state_row;
      event_type := 'opened';
    elsif state_row.winner_unique_id <> winner.unique_id then
      update public.ph_season_sales_office_state state set
        winner_unique_id = winner.unique_id, status = 'open', revision = state.revision + 1,
        readiness_status = evidence->>'status', reopen_reason = 'winner_changed',
        completed_by = null, completed_at = null, cav_watermark = null,
        evidence_ready_at_completion = null, evidence_ready_seen_after_completion = false,
        completed_evidence_snapshot = null, current_evidence_snapshot = evidence,
        source_fingerprint = evidence->>'fingerprint', import_revision = p_import_revision,
        updated_at = now()
      where state.id = state_row.id returning * into state_row;
      event_type := 'winner_changed';
    else
      if state_row.status = 'done' then
        select max(c.last_updated) into newer_blank_at
        from public.ph_cav_import c
        where upper(btrim(coalesce(c.itemcode, ''))) = upper(btrim(winner.itemcode))
          and upper(btrim(coalesce(c.season, ''))) = current_season
          and btrim(coalesce(c.holdstopreason, '')) = ''
          and c.last_updated > coalesce(state_row.cav_watermark, state_row.completed_at, '-infinity'::timestamptz);
        if newer_blank_at is not null then
          reopen_reason_value := 'cav_blank';
        elsif nullif(to_jsonb(winner)->>'av_rule_last_cleared_at', '')::timestamptz > state_row.completed_at then
          reopen_reason_value := 'evidence_invalid';
        elsif state_row.evidence_ready_seen_after_completion
              and not coalesce((evidence->>'ready')::boolean, false) then
          reopen_reason_value := 'evidence_invalid';
        end if;
        if reopen_reason_value is not null then
          update public.ph_season_sales_office_state state set
            status = 'open', revision = state.revision + 1,
            readiness_status = case when reopen_reason_value = 'cav_blank'
              then 'reopened_cav_blank' else 'reopened_evidence_invalid' end,
            reopen_reason = reopen_reason_value, completed_by = null, completed_at = null,
            current_evidence_snapshot = evidence,
            source_fingerprint = evidence->>'fingerprint', import_revision = p_import_revision,
            updated_at = now()
          where state.id = state_row.id returning * into state_row;
          event_type := 'reopened';
          reopen_count := reopen_count + 1;
        else
          update public.ph_season_sales_office_state state set
            evidence_ready_seen_after_completion = state.evidence_ready_seen_after_completion
              or coalesce((evidence->>'ready')::boolean, false),
            current_evidence_snapshot = evidence,
            source_fingerprint = evidence->>'fingerprint', import_revision = p_import_revision,
            updated_at = now()
          where state.id = state_row.id returning * into state_row;
        end if;
      else
        update public.ph_season_sales_office_state state set
          status = 'open', readiness_status = case
            when state.reopen_reason = 'cav_blank' then 'reopened_cav_blank'
            when state.reopen_reason = 'evidence_invalid' then 'reopened_evidence_invalid'
            else evidence->>'status' end,
          current_evidence_snapshot = evidence,
          source_fingerprint = evidence->>'fingerprint', import_revision = p_import_revision,
          updated_at = now()
        where state.id = state_row.id returning * into state_row;
      end if;
    end if;

    if state_row.status = 'open' then
      perform private.season_sales_mirror_winner_v1(winner, state_row);
      mirror_upsert_count := mirror_upsert_count + 1;
      open_count := open_count + 1;
    else
      delete from public.ph_sales_office sales
      where lower(btrim(coalesce(sales.so_source, 'season'))) = 'season'
        and upper(btrim(coalesce(sales.itemcode, ''))) = upper(btrim(winner.itemcode));
      done_count := done_count + 1;
    end if;
    if event_type is not null then
      insert into public.ph_season_sales_office_events (
        state_id, event_type, actor_username, revision, reason_code, metadata
      ) values (
        state_row.id, event_type, 'service_role', state_row.revision,
        coalesce(reopen_reason_value, state_row.reopen_reason),
        jsonb_build_object('seasonCode', current_season, 'salesYear', current_sales_year,
          'importRevision', p_import_revision)
      );
    end if;
  end loop;

  for state_row in
    select state.* from public.ph_season_sales_office_state state
    join season_sales_target_items_v1 target using (itemcode_normalized)
    left join season_sales_winners_v1 winner_key using (itemcode_normalized)
    where state.season_code = current_season and state.sales_year = current_sales_year
      and winner_key.unique_id is null and state.status <> 'retired'
    for update of state
  loop
    update public.ph_season_sales_office_state state set
      status = 'retired', revision = state.revision + 1,
      readiness_status = 'retired', reopen_reason = null,
      import_revision = p_import_revision, updated_at = now()
    where state.id = state_row.id returning * into state_row;
    delete from public.ph_sales_office sales
    where lower(btrim(coalesce(sales.so_source, 'season'))) = 'season'
      and upper(btrim(coalesce(sales.itemcode, ''))) = state_row.itemcode_normalized;
    insert into public.ph_season_sales_office_events (
      state_id, event_type, actor_username, revision, reason_code, metadata
    ) values (state_row.id, 'retired', 'service_role', state_row.revision,
      'no_current_winner', jsonb_build_object('importRevision', p_import_revision));
  end loop;

  -- ph_sales_office is the open-work mirror only. Remove legacy Season rows
  -- that are no longer the current open lifecycle winner. The durable state,
  -- audit, source inventory, and completion history are not deleted.
  delete from public.ph_sales_office sales
  using season_sales_target_items_v1 target
  where lower(btrim(coalesce(sales.so_source, 'season'))) = 'season'
    and target.itemcode_normalized = upper(btrim(coalesce(sales.itemcode, '')))
    and not exists (
      select 1
      from public.ph_season_sales_office_state state
      where state.season_code = current_season
        and state.sales_year = current_sales_year
        and state.status = 'open'
        and state.winner_unique_id = coalesce(sales.master_id, sales.unique_id)
    );

  response_value := jsonb_build_object('ok', true, 'status', 'completed',
    'seasonCode', current_season, 'salesYear', current_sales_year,
    'winnerCount', expected_count, 'openCount', open_count, 'doneCount', done_count,
    'newStateCount', create_count, 'winnerChangeCount', winner_change_count,
    'reopenCount', reopen_count, 'retireCount', retire_count,
    'mirrorUpsertCount', mirror_upsert_count, 'scopeHash', scope_hash);
  if p_idempotency_key is not null then
    insert into private.season_sales_office_idempotency (
      operation, actor_username, idempotency_key, request_hash, response
    ) values ('reconcile', 'service_role', btrim(p_idempotency_key), scope_hash, response_value)
    on conflict (operation, actor_username, idempotency_key) do nothing;
  end if;
  insert into public.ph_season_sales_office_events (
    state_id, event_type, actor_username, metadata
  ) values (null, 'reconciled', 'service_role', response_value - 'scopeHash');
  return response_value;
exception
  when lock_not_available or query_canceled then
    return jsonb_build_object('ok', true, 'status', 'maintenance_deferred',
      'code', 'MAINTENANCE_DEFERRED');
end
$function$;

create or replace function public.save_season_sales_office_av_note_v1(
  p_actor_username text,
  p_master_id text,
  p_expected_revision integer,
  p_av_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles := private.season_sales_assert_actor_v1(p_actor_username);
  state_row public.ph_season_sales_office_state;
  winner public.ph_master_inventory;
  evidence jsonb;
  request_hash text;
  prior private.season_sales_office_idempotency;
  response_value jsonb;
begin
  if length(btrim(coalesce(p_idempotency_key, ''))) < 12 then
    raise exception using errcode = '22023', message = 'SEASON_SALES_TOKEN_INVALID';
  end if;
  request_hash := encode(extensions.digest(concat_ws('|', p_master_id, p_expected_revision::text, coalesce(p_av_note, '')), 'sha256'), 'hex');
  select * into prior from private.season_sales_office_idempotency request
  where request.operation = 'save_av_note' and request.actor_username = lower(actor.username)
    and request.idempotency_key = btrim(p_idempotency_key);
  if prior.idempotency_key is not null then
    if prior.request_hash <> request_hash then
      raise exception using errcode = '22023', message = 'SEASON_SALES_TOKEN_CONFLICT';
    end if;
    return prior.response;
  end if;
  select * into state_row from public.ph_season_sales_office_state state
  where state.winner_unique_id = btrim(p_master_id) and state.status = 'open'
  order by state.updated_at desc limit 1 for update;
  if state_row.id is null then raise exception using errcode = '40001', message = 'SEASON_SALES_NOT_OPEN'; end if;
  if state_row.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'SEASON_SALES_STALE_REVISION'; end if;
  select * into winner from public.ph_master_inventory m where m.unique_id = state_row.winner_unique_id for update;
  if winner.unique_id is null then raise exception using errcode = '40001', message = 'SEASON_SALES_WINNER_CHANGED'; end if;
  update public.ph_master_inventory m set
    av_note = nullif(btrim(coalesce(p_av_note, '')), ''),
    av_rule_av_note_updated_at = now(), av_rule_bundle_updated_at = now(),
    av_rule_priority_snapshot = m.priority,
    av_rule_holdstop_snapshot = concat_ws('|', nullif(btrim(coalesce(m.holdstopcode, '')), ''), nullif(btrim(coalesce(m.holdstopreason, '')), '')),
    last_updated = now()
  where m.unique_id = winner.unique_id returning * into winner;
  evidence := private.season_sales_evidence_v1(to_jsonb(winner));
  update public.ph_season_sales_office_state state set
    revision = state.revision + 1, readiness_status = evidence->>'status',
    current_evidence_snapshot = evidence, source_fingerprint = evidence->>'fingerprint',
    updated_at = now()
  where state.id = state_row.id returning * into state_row;
  perform private.season_sales_mirror_winner_v1(winner, state_row);
  insert into public.ph_season_sales_office_events (state_id, event_type, actor_username, revision, metadata)
  values (state_row.id, 'av_note_saved', lower(actor.username), state_row.revision, '{}'::jsonb);
  response_value := jsonb_build_object('ok', true, 'status', 'saved', 'masterId', winner.unique_id,
    'revision', state_row.revision, 'readinessStatus', state_row.readiness_status,
    'workflowDetail', state_row.current_evidence_snapshot, 'avNote', coalesce(winner.av_note, ''));
  insert into private.season_sales_office_idempotency(operation, actor_username, idempotency_key, request_hash, response)
  values ('save_av_note', lower(actor.username), btrim(p_idempotency_key), request_hash, response_value);
  return response_value;
end
$function$;

create or replace function public.complete_season_sales_office_v1(
  p_actor_username text,
  p_master_id text,
  p_expected_revision integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles := private.season_sales_assert_actor_v1(p_actor_username);
  state_row public.ph_season_sales_office_state;
  winner public.ph_master_inventory;
  evidence jsonb;
  watermark timestamptz;
  request_hash text;
  prior private.season_sales_office_idempotency;
  response_value jsonb;
begin
  if length(btrim(coalesce(p_idempotency_key, ''))) < 12 then
    raise exception using errcode = '22023', message = 'SEASON_SALES_TOKEN_INVALID';
  end if;
  request_hash := encode(extensions.digest(concat_ws('|', p_master_id, p_expected_revision::text), 'sha256'), 'hex');
  select * into prior from private.season_sales_office_idempotency request
  where request.operation = 'complete' and request.actor_username = lower(actor.username)
    and request.idempotency_key = btrim(p_idempotency_key);
  if prior.idempotency_key is not null then
    if prior.request_hash <> request_hash then raise exception using errcode = '22023', message = 'SEASON_SALES_TOKEN_CONFLICT'; end if;
    return prior.response;
  end if;
  select * into state_row from public.ph_season_sales_office_state state
  where state.winner_unique_id = btrim(p_master_id)
  order by state.updated_at desc limit 1 for update;
  if state_row.id is null then raise exception using errcode = '40001', message = 'SEASON_SALES_NOT_FOUND'; end if;
  if state_row.status = 'done' then
    response_value := jsonb_build_object('ok', true, 'status', 'already_done', 'masterId', p_master_id, 'revision', state_row.revision);
  else
    if state_row.status <> 'open' then raise exception using errcode = '40001', message = 'SEASON_SALES_NOT_OPEN'; end if;
    if state_row.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'SEASON_SALES_STALE_REVISION'; end if;
    select * into winner from public.ph_master_inventory m where m.unique_id = state_row.winner_unique_id for share;
    if winner.unique_id is null then raise exception using errcode = '40001', message = 'SEASON_SALES_WINNER_CHANGED'; end if;
    evidence := private.season_sales_evidence_v1(to_jsonb(winner));
    select max(c.last_updated) into watermark from public.ph_cav_import c
    where upper(btrim(coalesce(c.itemcode, ''))) = state_row.itemcode_normalized
      and upper(btrim(coalesce(c.season, ''))) = state_row.season_code;
    update public.ph_season_sales_office_state state set
      status = 'done', revision = state.revision + 1, readiness_status = 'done',
      reopen_reason = null, completed_by = lower(actor.username), completed_at = now(),
      cav_watermark = watermark, evidence_ready_at_completion = coalesce((evidence->>'ready')::boolean, false),
      evidence_ready_seen_after_completion = coalesce((evidence->>'ready')::boolean, false),
      completed_evidence_snapshot = evidence, current_evidence_snapshot = evidence,
      source_fingerprint = evidence->>'fingerprint', updated_at = now()
    where state.id = state_row.id returning * into state_row;
    delete from public.ph_sales_office sales
    where lower(btrim(coalesce(sales.so_source, 'season'))) = 'season'
      and (sales.unique_id = winner.unique_id or sales.master_id = winner.unique_id);
    insert into public.ph_season_sales_office_events (state_id, event_type, actor_username, revision, metadata)
    values (state_row.id, 'completed', lower(actor.username), state_row.revision,
      jsonb_build_object('evidenceReady', state_row.evidence_ready_at_completion));
    response_value := jsonb_build_object('ok', true, 'status', 'done', 'masterId', winner.unique_id,
      'revision', state_row.revision, 'completedAt', state_row.completed_at);
  end if;
  insert into private.season_sales_office_idempotency(operation, actor_username, idempotency_key, request_hash, response)
  values ('complete', lower(actor.username), btrim(p_idempotency_key), request_hash, response_value)
  on conflict (operation, actor_username, idempotency_key) do nothing;
  return response_value;
end
$function$;

create or replace function public.refresh_season_sales_office_v1(
  p_actor_username text,
  p_itemcode text,
  p_import_revision text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles := private.season_sales_assert_actor_v1(p_actor_username);
  normalized_itemcode text := upper(btrim(coalesce(p_itemcode, '')));
begin
  if normalized_itemcode = '' then
    raise exception using errcode = '22023', message = 'SEASON_SALES_NOT_FOUND';
  end if;
  return public.reconcile_season_sales_office_v1(
    array[normalized_itemcode], false,
    left(coalesce(nullif(btrim(p_import_revision), ''), 'client-refresh'), 180),
    p_idempotency_key
  );
end
$function$;

create or replace function public.get_season_sales_office_health_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with settings as (select private.season_sales_settings_v1() value), scope as (
    select upper(btrim(value->>'seasonCode')) season_code,
      private.season_sales_year_v1(value->>'salesYear') sales_year from settings
  ), counts as (
    select
      count(*) filter (where state.status = 'open') open_states,
      count(*) filter (where state.status = 'done') done_states,
      count(*) filter (where state.status = 'retired') retired_states
    from public.ph_season_sales_office_state state, scope
    where state.season_code = scope.season_code and state.sales_year = scope.sales_year
  ), mirrors as (
    select count(*) mirror_count, count(distinct upper(btrim(itemcode))) mirror_itemcodes
    from public.ph_sales_office where lower(btrim(coalesce(so_source, 'season'))) = 'season'
  )
  select jsonb_build_object('ok', true, 'openStates', counts.open_states,
    'doneStates', counts.done_states, 'retiredStates', counts.retired_states,
    'mirrorCount', mirrors.mirror_count, 'mirrorItemcodes', mirrors.mirror_itemcodes,
    'parity', counts.open_states = mirrors.mirror_count and mirrors.mirror_count = mirrors.mirror_itemcodes)
  from counts, mirrors
$function$;

revoke all on function private.season_sales_safe_numeric_v1(text) from public, anon, authenticated;
revoke all on function private.season_sales_year_v1(text) from public, anon, authenticated;
revoke all on function private.season_sales_settings_v1() from public, anon, authenticated;
revoke all on function private.season_sales_assignment_protected_v1(text) from public, anon, authenticated;
revoke all on function private.season_sales_evidence_v1(jsonb) from public, anon, authenticated;
revoke all on function private.season_sales_assert_actor_v1(text) from public, anon, authenticated;
revoke all on function private.season_sales_mirror_winner_v1(public.ph_master_inventory, public.ph_season_sales_office_state) from public, anon, authenticated;
revoke all on function private.prevent_season_sales_event_mutation_v1() from public, anon, authenticated;
revoke all on function public.reconcile_season_sales_office_v1(text[], boolean, text, text) from public, anon, authenticated;
revoke all on function public.save_season_sales_office_av_note_v1(text, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.complete_season_sales_office_v1(text, text, integer, text) from public, anon, authenticated;
revoke all on function public.refresh_season_sales_office_v1(text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_season_sales_office_health_v1() from public, anon, authenticated;
grant execute on function public.reconcile_season_sales_office_v1(text[], boolean, text, text) to service_role;
grant execute on function public.save_season_sales_office_av_note_v1(text, text, integer, text, text) to service_role;
grant execute on function public.complete_season_sales_office_v1(text, text, integer, text) to service_role;
grant execute on function public.refresh_season_sales_office_v1(text, text, text, text) to service_role;
grant execute on function public.get_season_sales_office_health_v1() to service_role;

commit;
