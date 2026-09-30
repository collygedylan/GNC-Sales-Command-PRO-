begin;

-- Eval still updates its evidence and ordinary Location/Endcap assignments,
-- but only the durable Season lifecycle may publish Season Sales Office work.
create or replace function private.eval_work_apply_request_drive_parity_v1(
  p_work_id uuid,
  p_actor_username text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  work public.ph_eval_work;
  settings jsonb;
  current_season text;
  current_sales_year integer;
  completed_at timestamptz := now();
begin
  select * into work from public.ph_eval_work where id = p_work_id for update;
  if work.id is null then
    raise exception using errcode = '22023', message = 'eval_work_not_found';
  end if;

  update public.ph_master_inventory m
  set date_completed = completed_at,
      av_rule_bundle_updated_at = completed_at,
      av_rule_av_note_updated_at = completed_at,
      av_rule_spec_updated_at = completed_at,
      av_rule_match_updated_at = completed_at,
      av_rule_caliper_updated_at = completed_at,
      av_rule_photo_updated_at = completed_at,
      av_rule_priority_snapshot = m.priority,
      av_rule_holdstop_snapshot = concat_ws('|',
        nullif(btrim(coalesce(m.holdstopcode, '')), ''),
        nullif(btrim(coalesce(m.holdstopreason, '')), '')
      ),
      last_updated = completed_at
  from public.ph_eval_work_origin_rows origin
  where origin.eval_work_id = work.id and m.unique_id = origin.origin_unique_id;

  if coalesce(work.source_context->>'scopeContract', '') <> 'itemcode-all-rows-v1' then
    return;
  end if;
  settings := private.season_sales_settings_v1();
  current_season := upper(btrim(coalesce(settings->>'seasonCode', '')));
  current_sales_year := private.season_sales_year_v1(settings->>'salesYear');

  -- Preserve the existing non-Season assignment behavior. Existing Season
  -- winners remain classified while a busy reconciliation is deferred; the
  -- shared helper deterministically classifies the current-season family.
  update public.ph_master_inventory m
  set app_tab_assignment = case
        when upper(btrim(coalesce(m.end_cap_folder, ''))) not in ('', 'NULL', 'N/A', '-') then 'endcap'
        when upper(btrim(coalesce(m.season, ''))) = current_season
          and private.season_sales_year_v1(m.saleyear) <= current_sales_year
          and lower(btrim(coalesce(m.app_tab_assignment, ''))) = 'season' then 'season'
        else 'location'
      end,
      last_updated = completed_at
  where upper(btrim(coalesce(m.itemcode, ''))) = upper(btrim(work.itemcode))
    and not private.season_sales_assignment_protected_v1(m.app_tab_assignment);

  perform private.refresh_eligible_season_sales_itemcode_v1(
    work.itemcode, left('eval-complete:' || work.id::text || ':' || work.version::text, 180), null
  );
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
set search_path = pg_catalog, extensions
as $function$
declare
  actor public.profiles := private.season_sales_assert_actor_v1(p_actor_username);
  settings jsonb := private.season_sales_settings_v1();
  current_season text := upper(btrim(coalesce(settings->>'seasonCode', '')));
  current_sales_year integer := private.season_sales_year_v1(settings->>'salesYear');
  state_row public.ph_season_sales_office_state;
  winner public.ph_master_inventory;
  evidence jsonb;
  watermark timestamptz;
  request_hash text;
  prior private.season_sales_office_idempotency;
  response_value jsonb;
  removed_mirror_ids jsonb := '[]'::jsonb;
  refresh_result jsonb;
begin
  perform set_config('lock_timeout', '2000', true);
  perform set_config('statement_timeout', '12000', true);
  if length(btrim(coalesce(p_idempotency_key, ''))) not between 12 and 180 then
    raise exception using errcode = '22023', message = 'SEASON_SALES_TOKEN_INVALID';
  end if;
  if btrim(coalesce(p_master_id, '')) = '' or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'SEASON_SALES_REVISION_REQUIRED';
  end if;
  if current_season = '' or current_sales_year is null then
    raise exception using errcode = '22023', message = 'SEASON_SALES_SETTINGS_INVALID';
  end if;

  -- Match the reconciler's transaction lock before touching state or mirrors.
  -- This also serializes simultaneous retries of the same request token.
  perform pg_advisory_xact_lock(hashtextextended('season-sales-office-v1', 0));
  request_hash := encode(extensions.digest(concat_ws('|', p_master_id, p_expected_revision::text), 'sha256'), 'hex');
  select * into prior from private.season_sales_office_idempotency request
  where request.operation = 'complete' and request.actor_username = lower(actor.username)
    and request.idempotency_key = btrim(p_idempotency_key);
  if prior.idempotency_key is not null and prior.request_hash <> request_hash then
    raise exception using errcode = '22023', message = 'SEASON_SALES_TOKEN_CONFLICT';
  end if;

  select * into state_row from public.ph_season_sales_office_state state
  where state.winner_unique_id = btrim(p_master_id)
    and state.season_code = current_season and state.sales_year = current_sales_year
  order by state.updated_at desc limit 1 for update;

  if prior.idempotency_key is not null then
    -- A lost-response retry may acknowledge only that same completion. Never
    -- erase work that the rules reopened or whose winner/sales scope changed.
    if state_row.id is null or state_row.status <> 'done'
       or state_row.revision is distinct from (prior.response->>'revision')::integer
       or (prior.response ? 'stateId' and state_row.id::text <> prior.response->>'stateId')
       or (not (prior.response ? 'stateId') and
           (prior.response->>'completedAt' is null or state_row.completed_at is distinct from (prior.response->>'completedAt')::timestamptz)) then
      raise exception using errcode = '40001', message = 'SEASON_SALES_STALE_REVISION';
    end if;
    response_value := prior.response || jsonb_build_object('idempotentReplay', true);
  else
    if state_row.id is null then
      -- Legacy view rows can precede durable state. Classify only their linked
      -- ITEMCODE, then require this exact master to be the selected winner.
      select * into winner from public.ph_master_inventory m where m.unique_id = btrim(p_master_id);
      if winner.unique_id is null then
        raise exception using errcode = '40001', message = 'SEASON_SALES_NOT_FOUND';
      end if;
      refresh_result := private.refresh_eligible_season_sales_itemcode_v1(winner.itemcode, 'complete-legacy-row', null);
      if refresh_result->>'status' = 'maintenance_deferred' then
        raise exception using errcode = '55P03', message = 'SEASON_SALES_BUSY';
      end if;
      select * into state_row from public.ph_season_sales_office_state state
      where state.winner_unique_id = btrim(p_master_id)
        and state.season_code = current_season and state.sales_year = current_sales_year
      order by state.updated_at desc limit 1 for update;
      if state_row.id is null then
        raise exception using errcode = '40001', message = 'SEASON_SALES_WINNER_CHANGED';
      end if;
    end if;

    if state_row.status = 'done' then
      response_value := jsonb_build_object('ok', true, 'status', 'already_done',
        'masterId', p_master_id, 'stateId', state_row.id, 'revision', state_row.revision,
        'completedAt', state_row.completed_at);
    else
      if state_row.status <> 'open' then
        raise exception using errcode = '40001', message = 'SEASON_SALES_NOT_OPEN';
      end if;
      if state_row.revision <> p_expected_revision then
        raise exception using errcode = '40001', message = 'SEASON_SALES_STALE_REVISION';
      end if;
      select * into winner from public.ph_master_inventory m where m.unique_id = state_row.winner_unique_id for share;
      if winner.unique_id is null then
        raise exception using errcode = '40001', message = 'SEASON_SALES_WINNER_CHANGED';
      end if;
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
      insert into public.ph_season_sales_office_events (state_id, event_type, actor_username, revision, metadata)
      values (state_row.id, 'completed', lower(actor.username), state_row.revision,
        jsonb_build_object('evidenceReady', state_row.evidence_ready_at_completion));
      response_value := jsonb_build_object('ok', true, 'status', 'done',
        'masterId', winner.unique_id, 'stateId', state_row.id,
        'revision', state_row.revision, 'completedAt', state_row.completed_at);
    end if;
  end if;

  -- Legacy/flyer aliases admitted by the Season view share the same master.
  -- Bloom Picker and Move work have independent lifecycles and are untouched.
  -- A different open scope owning this master wins over historical cleanup.
  with removed as (
    delete from public.ph_sales_office sales
    where (sales.unique_id = state_row.winner_unique_id or sales.master_id = state_row.winner_unique_id)
      and lower(btrim(coalesce(sales.so_source, 'season'))) not in ('bloom_picker', 'bloom-picker', 'move', 'moves')
      and btrim(coalesce(sales.order_folder, '')) = ''
      and btrim(coalesce(sales.order_number, '')) = ''
      and btrim(coalesce(sales.order_customer, '')) = ''
      and not exists (
        select 1 from public.ph_season_sales_office_state newer
        where newer.winner_unique_id = state_row.winner_unique_id
          and newer.status = 'open' and newer.id <> state_row.id
      )
    returning sales.unique_id
  )
  select coalesce(jsonb_agg(removed.unique_id order by removed.unique_id), '[]'::jsonb)
  into removed_mirror_ids from removed;
  response_value := response_value || jsonb_build_object('removedMirrorIds', removed_mirror_ids);

  if prior.idempotency_key is null then
    insert into private.season_sales_office_idempotency(operation, actor_username, idempotency_key, request_hash, response)
    values ('complete', lower(actor.username), btrim(p_idempotency_key), request_hash, response_value);
  end if;
  return response_value;
end
$function$;

revoke all on function private.eval_work_apply_request_drive_parity_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_season_sales_office_v1(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.complete_season_sales_office_v1(text, text, integer, text) to service_role;

commit;
