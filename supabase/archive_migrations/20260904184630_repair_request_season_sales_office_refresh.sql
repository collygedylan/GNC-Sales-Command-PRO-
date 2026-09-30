begin;

-- A Request completion can make an otherwise-unclassified current open-stock
-- row ready for Custom AV.  The legacy scoped reconciliation required the row
-- to already be labelled season/location, which made that transition
-- impossible.  Derive the one ITEMCODE family on the server before invoking
-- the existing durable Season Sales Office lifecycle.
create or replace function private.refresh_eligible_season_sales_itemcode_v1(
  p_itemcode text,
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
  current_season text := upper(btrim(coalesce(settings->>'seasonCode', '')));
  current_sales_year integer := private.season_sales_year_v1(settings->>'salesYear');
  normalized_itemcode text := upper(btrim(coalesce(p_itemcode, '')));
  item_scope_exists boolean := false;
  classified_count integer := 0;
  reconcile_result jsonb;
begin
  perform set_config('lock_timeout', '1500', true);
  perform set_config('statement_timeout', '12000', true);

  if normalized_itemcode = '' then
    return jsonb_build_object('ok', true, 'status', 'skipped',
      'code', 'SEASON_SALES_ITEMCODE_REQUIRED');
  end if;
  if current_season = '' or current_sales_year is null then
    return jsonb_build_object('ok', true, 'status', 'maintenance_deferred',
      'code', 'SEASON_SALES_SETTINGS_INVALID');
  end if;

  -- Serialize only this ITEMCODE.  A concurrent caller will perform the same
  -- deterministic classification, so a busy result is safe and retryable.
  if not pg_try_advisory_xact_lock(
    hashtextextended('season-sales-itemcode-v1:' || normalized_itemcode, 0)
  ) then
    return jsonb_build_object('ok', true, 'status', 'maintenance_deferred',
      'code', 'MAINTENANCE_DEFERRED');
  end if;

  select exists (
    select 1
    from public.ph_master_inventory candidate
    where upper(btrim(coalesce(candidate.itemcode, ''))) = normalized_itemcode
      and upper(btrim(coalesce(candidate.season, ''))) = current_season
      and private.season_sales_year_v1(candidate.saleyear) <= current_sales_year
      and upper(btrim(coalesce(candidate.end_cap_folder, ''))) in ('', 'NULL', 'N/A', '-')
      and not private.season_sales_assignment_protected_v1(candidate.app_tab_assignment)
      and (
        lower(btrim(coalesce(candidate.app_tab_assignment, ''))) in ('season', 'location')
        or coalesce(private.season_sales_safe_numeric_v1(candidate.s_lts), 0) > 0
        or exists (
          select 1
          from public.ph_season_sales_office_state state
          where state.season_code = current_season
            and state.sales_year = current_sales_year
            and state.itemcode_normalized = normalized_itemcode
        )
      )
  ) into item_scope_exists;

  if not item_scope_exists then
    return jsonb_build_object('ok', true, 'status', 'skipped',
      'code', 'NOT_SEASON_SALES_SCOPE');
  end if;

  with ranked as (
    select candidate.unique_id,
      row_number() over (
        order by coalesce(private.season_sales_safe_numeric_v1(candidate.ptravailable), -1) desc,
          btrim(candidate.priority)::integer asc,
          private.eval_work_natural_sort_key_v1(candidate.locationcode),
          private.eval_work_natural_sort_key_v1(candidate.lotcode),
          candidate.unique_id
      ) as winner_rank
    from public.ph_master_inventory candidate
    where upper(btrim(coalesce(candidate.itemcode, ''))) = normalized_itemcode
      and upper(btrim(coalesce(candidate.season, ''))) = current_season
      and private.season_sales_year_v1(candidate.saleyear) <= current_sales_year
      and btrim(coalesce(candidate.priority, '')) ~ '^[1-4]$'
      and upper(btrim(coalesce(candidate.end_cap_folder, ''))) in ('', 'NULL', 'N/A', '-')
      and upper(coalesce(candidate.holdstopcode, '')) !~ '[HS]'
      and not private.season_sales_assignment_protected_v1(candidate.app_tab_assignment)
  ), winner as (
    select ranked.unique_id
    from ranked
    where ranked.winner_rank = 1
  )
  update public.ph_master_inventory target
  set app_tab_assignment = case
        when target.unique_id = (select winner.unique_id from winner) then 'season'
        else 'location'
      end,
      last_updated = coalesce(target.last_updated, now())
  where upper(btrim(coalesce(target.itemcode, ''))) = normalized_itemcode
    and upper(btrim(coalesce(target.season, ''))) = current_season
    and private.season_sales_year_v1(target.saleyear) <= current_sales_year
    and upper(btrim(coalesce(target.end_cap_folder, ''))) in ('', 'NULL', 'N/A', '-')
    and not private.season_sales_assignment_protected_v1(target.app_tab_assignment)
    and target.app_tab_assignment is distinct from case
      when target.unique_id = (select winner.unique_id from winner) then 'season'
      else 'location'
    end;
  get diagnostics classified_count = row_count;

  reconcile_result := public.reconcile_season_sales_office_v1(
    array[normalized_itemcode],
    false,
    left(coalesce(nullif(btrim(p_import_revision), ''), 'scoped-refresh'), 180),
    p_idempotency_key
  );

  return coalesce(reconcile_result, '{}'::jsonb)
    || jsonb_build_object('classifiedCount', classified_count);
exception
  when lock_not_available or query_canceled then
    return jsonb_build_object('ok', true, 'status', 'maintenance_deferred',
      'code', 'MAINTENANCE_DEFERRED');
end
$function$;

revoke all on function private.refresh_eligible_season_sales_itemcode_v1(text, text, text)
  from public, anon, authenticated;
grant execute on function private.refresh_eligible_season_sales_itemcode_v1(text, text, text)
  to service_role;

-- Keep the existing authenticated App API contract, but make scoped refreshes
-- derive the assignment instead of assuming it already exists.
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
  return private.refresh_eligible_season_sales_itemcode_v1(
    normalized_itemcode,
    left(coalesce(nullif(btrim(p_import_revision), ''), 'client-refresh'), 180),
    p_idempotency_key
  );
end
$function$;

revoke all on function public.refresh_season_sales_office_v1(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.refresh_season_sales_office_v1(text, text, text, text)
  to service_role;

-- Request saves are authoritative and already protected by the existing
-- capability/row checks.  After the atomic Request + master evidence commit,
-- reconcile the linked ITEMCODE in the same transaction.  A deferred refresh
-- never rolls back the Request save.
create or replace function public.save_request_work(
  request_id text,
  expected_version bigint,
  patch jsonb,
  complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing public.ph_active_request%rowtype;
  profile public.profiles%rowtype;
  profile_email text;
  canonical jsonb;
  safe_patch jsonb;
  save_result jsonb;
  season_result jsonb;
  linked_itemcode text;
  resulting_version bigint;
  season_token text;
begin
  if not private.can_save_request_work() then
    raise exception using errcode = '42501', message = 'REQUEST_SAVE_FORBIDDEN';
  end if;
  if nullif(btrim(coalesce(request_id, '')), '') is null or expected_version is null then
    raise exception using errcode = '22023', message = 'REQUEST_ID_AND_VERSION_REQUIRED';
  end if;
  if patch is null or jsonb_typeof(patch) <> 'object' then
    raise exception using errcode = '22023', message = 'REQUEST_PATCH_INVALID';
  end if;

  select * into existing
  from public.ph_active_request
  where unique_id = request_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'REQUEST_NOT_FOUND';
  end if;

  profile := private.current_active_profile();
  if profile.id is null then
    raise exception using errcode = '42501', message = 'REQUEST_PROFILE_REQUIRED';
  end if;
  if lower(btrim(coalesce(profile.username, ''))) in ('ben_brown', 'chance_alldredge') then
    if not private.can_work_request_identity(
      existing.request_created_by_username,
      existing.request_selected_rep_username,
      existing.requested_by
    ) then
      raise exception using errcode = '42501', message = 'REQUEST_ROW_FORBIDDEN';
    end if;
  end if;

  if lower(coalesce(existing.req_status, '')) in ('complete', 'completed')
     or nullif(btrim(coalesce(existing.date_completed, '')), '') is not null then
    canonical := coalesce(private.canonical_request_json(request_id), to_jsonb(existing));
    save_result := jsonb_build_object(
      'row', canonical,
      'row_version', existing.row_version,
      'delivery_state', coalesce((
        select outbox.status
        from public.ph_request_delivery_outbox outbox
        where outbox.request_id = existing.unique_id
          and outbox.event_type = 'request_completed'
        order by outbox.created_at desc
        limit 1
      ), 'already_completed'),
      'acknowledged', true
    );
  else
    if existing.row_version <> expected_version then
      raise exception using errcode = '40001', message = 'REQUEST_VERSION_CONFLICT',
        detail = jsonb_build_object('current_version', existing.row_version)::text;
    end if;

    safe_patch := patch - 'completed_by_username' - 'completed_by_display' - 'completed_by_email';
    if complete then
      select auth_user.email into profile_email
      from auth.users auth_user
      where auth_user.id = profile.id;
      safe_patch := safe_patch || jsonb_build_object(
        'completed_by_username', profile.username,
        'completed_by_display', coalesce(nullif(profile.display_name, ''), profile.username),
        'completed_by_email', coalesce(profile_email, '')
      );
    end if;

    save_result := public.save_request_work_v1(
      request_id, expected_version, safe_patch, complete
    );
  end if;

  if coalesce(complete, false) and existing.master_id is not null then
    select master.itemcode into linked_itemcode
    from public.ph_master_inventory master
    where master.unique_id = existing.master_id;
    if nullif(btrim(coalesce(linked_itemcode, '')), '') is not null then
      resulting_version := coalesce(
        nullif(save_result->>'row_version', '')::bigint,
        existing.row_version
      );
      season_token := 'request-season-' || encode(extensions.digest(
        request_id || '|' || coalesce(resulting_version, 0)::text,
        'sha256'
      ), 'hex');
      begin
        season_result := private.refresh_eligible_season_sales_itemcode_v1(
          linked_itemcode,
          left('request-complete:' || request_id || ':' || coalesce(resulting_version, 0)::text, 180),
          season_token
        );
      exception when others then
        season_result := jsonb_build_object(
          'ok', true,
          'status', 'maintenance_deferred',
          'code', 'MAINTENANCE_DEFERRED'
        );
      end;
      save_result := coalesce(save_result, '{}'::jsonb)
        || jsonb_build_object('season_sales_office', season_result);
    end if;
  end if;

  return save_result;
end
$function$;

revoke all on function public.save_request_work(text, bigint, jsonb, boolean)
  from public, anon;
grant execute on function public.save_request_work(text, bigint, jsonb, boolean)
  to authenticated;

comment on function private.refresh_eligible_season_sales_itemcode_v1(text, text, text) is
  'Service-only scoped classifier and reconciler for current Season Sales Notes ITEMCODEs. Positive S_LTS or an existing lifecycle proves scope; protected assignments are preserved.';
comment on function public.save_request_work(text, bigint, jsonb, boolean) is
  'Atomic Request writer with authoritative completion identity, durable delivery, and non-failing scoped Season Sales Office reconciliation.';

commit;
