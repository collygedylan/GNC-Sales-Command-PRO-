-- Application-level lifecycle conflicts must not use serialization_failure (40001):
-- PostgREST can retry that SQLSTATE and amplify these expected conflicts.
-- Preserve the production function bodies, security settings, owners, and execute ACLs.

CREATE OR REPLACE FUNCTION public.complete_season_sales_office_v1(p_actor_username text, p_master_id text, p_expected_revision integer, p_idempotency_key text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
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
      raise exception using errcode = 'PT409', message = 'SEASON_SALES_STALE_REVISION';
    end if;
    response_value := prior.response || jsonb_build_object('idempotentReplay', true);
  else
    if state_row.id is null then
      -- Legacy view rows can precede durable state. Classify only their linked
      -- ITEMCODE, then require this exact master to be the selected winner.
      select * into winner from public.ph_master_inventory m where m.unique_id = btrim(p_master_id);
      if winner.unique_id is null then
        raise exception using errcode = 'PT409', message = 'SEASON_SALES_NOT_FOUND';
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
        raise exception using errcode = 'PT409', message = 'SEASON_SALES_WINNER_CHANGED';
      end if;
    end if;

    if state_row.status = 'done' then
      response_value := jsonb_build_object('ok', true, 'status', 'already_done',
        'masterId', p_master_id, 'stateId', state_row.id, 'revision', state_row.revision,
        'completedAt', state_row.completed_at);
    else
      if state_row.status <> 'open' then
        raise exception using errcode = 'PT409', message = 'SEASON_SALES_NOT_OPEN';
      end if;
      if state_row.revision <> p_expected_revision then
        raise exception using errcode = 'PT409', message = 'SEASON_SALES_STALE_REVISION';
      end if;
      select * into winner from public.ph_master_inventory m where m.unique_id = state_row.winner_unique_id for share;
      if winner.unique_id is null then
        raise exception using errcode = 'PT409', message = 'SEASON_SALES_WINNER_CHANGED';
      end if;
      winner.av_note := state_row.retained_av_note;
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
$$;


ALTER FUNCTION public.complete_season_sales_office_v1(p_actor_username text, p_master_id text, p_expected_revision integer, p_idempotency_key text) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.save_season_sales_office_av_note_v1(p_actor_username text, p_master_id text, p_expected_revision integer, p_av_note text, p_idempotency_key text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'extensions'
    AS $$
declare
  actor public.profiles := private.season_sales_assert_actor_v1(p_actor_username);
  state_row public.ph_season_sales_office_state;
  winner public.ph_master_inventory;
  evidence jsonb;
  request_hash text;
  prior private.season_sales_office_idempotency;
  response_value jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('season-sales-office-v1', 0));
  if length(btrim(coalesce(p_idempotency_key, ''))) < 12 then
    raise exception using errcode = '22023', message = 'SEASON_SALES_TOKEN_INVALID';
  end if;
  request_hash := encode(digest(concat_ws('|', p_master_id, p_expected_revision::text, coalesce(p_av_note, '')), 'sha256'), 'hex');
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
    and state.season_code = upper(btrim(coalesce(private.season_sales_settings_v1()->>'seasonCode', '')))
    and state.sales_year = private.season_sales_year_v1(private.season_sales_settings_v1()->>'salesYear')
  order by state.updated_at desc limit 1 for update;
  if state_row.id is null then raise exception using errcode = 'PT409', message = 'SEASON_SALES_NOT_OPEN'; end if;
  if state_row.revision <> p_expected_revision then raise exception using errcode = 'PT409', message = 'SEASON_SALES_STALE_REVISION'; end if;
  select * into winner from public.ph_master_inventory m where m.unique_id = state_row.winner_unique_id for update;
  if winner.unique_id is null then raise exception using errcode = 'PT409', message = 'SEASON_SALES_WINNER_CHANGED'; end if;
  update public.ph_master_inventory m set
    av_note = nullif(btrim(coalesce(p_av_note, '')), ''),
    av_rule_av_note_updated_at = now(), av_rule_bundle_updated_at = now(),
    av_rule_priority_snapshot = m.priority,
    av_rule_holdstop_snapshot = concat_ws('|', nullif(btrim(coalesce(m.holdstopcode, '')), ''), nullif(btrim(coalesce(m.holdstopreason, '')), '')),
    last_updated = now()
  where m.unique_id = winner.unique_id returning * into winner;
  evidence := private.season_sales_evidence_v1(to_jsonb(winner));
  update public.ph_season_sales_office_state state set
    retained_av_note = winner.av_note, retained_av_note_at = clock_timestamp(),
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
$$;


ALTER FUNCTION public.save_season_sales_office_av_note_v1(p_actor_username text, p_master_id text, p_expected_revision integer, p_av_note text, p_idempotency_key text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.complete_season_sales_office_v1(p_actor_username text, p_master_id text, p_expected_revision integer, p_idempotency_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_season_sales_office_v1(p_actor_username text, p_master_id text, p_expected_revision integer, p_idempotency_key text) TO service_role;
REVOKE ALL ON FUNCTION public.save_season_sales_office_av_note_v1(p_actor_username text, p_master_id text, p_expected_revision integer, p_av_note text, p_idempotency_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_season_sales_office_av_note_v1(p_actor_username text, p_master_id text, p_expected_revision integer, p_av_note text, p_idempotency_key text) TO service_role;