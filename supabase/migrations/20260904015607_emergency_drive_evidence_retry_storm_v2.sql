begin;

-- Expected Drive evidence conflicts are application outcomes, not database
-- failures. Persist terminal outcomes by idempotency token so an older shell
-- repeating the same stale save gets a cheap replay instead of another lock,
-- exception, rollback, and log entry.
alter table private.drive_evidence_idempotency
  add column if not exists outcome_code text not null default 'SAVED',
  add column if not exists expires_at timestamptz;

create index if not exists drive_evidence_idempotency_recent_outcome_idx
  on private.drive_evidence_idempotency (created_at desc, outcome_code);

create index if not exists drive_evidence_idempotency_expiring_idx
  on private.drive_evidence_idempotency (expires_at)
  where expires_at is not null;

create or replace function private.store_drive_evidence_terminal_v2(
  p_profile_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_response jsonb,
  p_outcome_code text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing private.drive_evidence_idempotency%rowtype;
  v_inserted boolean := false;
begin
  insert into private.drive_evidence_idempotency(
    profile_id,
    idempotency_key,
    request_hash,
    response_payload,
    outcome_code,
    expires_at
  ) values (
    p_profile_id,
    btrim(p_idempotency_key),
    p_request_hash,
    p_response,
    upper(btrim(coalesce(p_outcome_code, 'UNKNOWN'))),
    p_expires_at
  )
  on conflict (profile_id, idempotency_key) do nothing
  returning true into v_inserted;

  if v_inserted then
    return p_response;
  end if;

  select * into v_existing
  from private.drive_evidence_idempotency
  where profile_id = p_profile_id
    and idempotency_key = btrim(p_idempotency_key);

  if not found or v_existing.request_hash <> p_request_hash then
    return jsonb_build_object(
      'ok', false,
      'code', 'IDEMPOTENCY_CONFLICT',
      'canonicalConfirmed', false,
      'retryBlocked', true,
      'recovered', false
    );
  end if;

  return jsonb_set(v_existing.response_payload, '{recovered}', 'true'::jsonb, true);
end
$function$;

revoke all on function private.store_drive_evidence_terminal_v2(uuid, text, text, jsonb, text, timestamptz)
  from public, anon, authenticated;

create or replace function private.save_drive_evidence_core_v2(
  p_master_uid text,
  p_expected_itemcode text,
  p_expected_locationcode text,
  p_expected_lotcode text,
  p_expected_signature text,
  p_baseline jsonb,
  p_evidence jsonb,
  p_complete boolean,
  p_workflow text,
  p_idempotency_key text,
  p_allow_field_merge boolean,
  p_contract_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor public.profiles%rowtype;
  v_row public.ph_master_inventory%rowtype;
  v_saved public.ph_master_inventory%rowtype;
  v_existing private.drive_evidence_idempotency%rowtype;
  v_payload jsonb := coalesce(p_evidence, '{}'::jsonb);
  v_baseline jsonb := coalesce(p_baseline, '{}'::jsonb);
  v_current_fields jsonb;
  v_request_hash text;
  v_response jsonb;
  v_request_rows jsonb := '[]'::jsonb;
  v_unexpected_keys text[];
  v_conflict_fields text[] := '{}'::text[];
  v_workflow text := lower(btrim(coalesce(p_workflow, '')));
  v_saved_at timestamptz := clock_timestamp();
  v_expected_signature timestamptz;
  v_is_stale boolean := false;
begin
  v_actor := private.require_active_admin_profile();

  if char_length(btrim(coalesce(p_idempotency_key, ''))) not between 12 and 180 then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if char_length(btrim(coalesce(p_master_uid, ''))) not between 1 and 240 then
    raise exception using errcode = '22023', message = 'INVALID_MASTER_IDENTITY';
  end if;
  if v_workflow not in ('season', 'location', 'notes') then
    raise exception using errcode = '22023', message = 'INVALID_DRIVE_WORKFLOW';
  end if;
  if jsonb_typeof(v_payload) <> 'object'
     or (coalesce(p_allow_field_merge, false) and jsonb_typeof(v_baseline) <> 'object') then
    raise exception using errcode = '22023', message = 'INVALID_EVIDENCE_PAYLOAD';
  end if;

  select array_agg(key order by key) into v_unexpected_keys
  from jsonb_object_keys(v_payload) as keys(key)
  where key not in ('spec', 'caliper', 'match', 'loc_match_qty', 'initial_ptr',
    'av_note', 'pick_note', 'comments', 'photo_link', 'photo_name');
  if coalesce(cardinality(v_unexpected_keys), 0) > 0 then
    raise exception using errcode = '22023', message = 'UNSUPPORTED_DRIVE_EVIDENCE_FIELD';
  end if;
  if octet_length(v_payload::text) > 65536 or octet_length(v_baseline::text) > 65536 then
    raise exception using errcode = '22023', message = 'DRIVE_EVIDENCE_PAYLOAD_TOO_LARGE';
  end if;
  if v_payload ? 'match'
     and nullif(btrim(v_payload ->> 'match'), '') is not null
     and (v_payload ->> 'match') !~ '^([0-9]{1,2}([.][0-9]+)?|100([.]0+)?)$' then
    raise exception using errcode = '22023', message = 'INVALID_LOC_MATCH_PERCENT';
  end if;
  if v_payload ? 'photo_link' and octet_length(coalesce(v_payload ->> 'photo_link', '')) > 16000 then
    raise exception using errcode = '22023', message = 'PHOTO_REFERENCE_TOO_LARGE';
  end if;

  begin
    v_expected_signature := nullif(btrim(coalesce(p_expected_signature, '')), '')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'INVALID_EXPECTED_SIGNATURE';
  end;

  v_request_hash := md5(concat_ws('|',
    btrim(p_master_uid),
    btrim(coalesce(p_expected_itemcode, '')),
    btrim(coalesce(p_expected_locationcode, '')),
    btrim(coalesce(p_expected_lotcode, '')),
    btrim(coalesce(p_expected_signature, '')),
    v_baseline::text,
    v_payload::text,
    coalesce(p_complete, false)::text,
    v_workflow,
    coalesce(p_allow_field_merge, false)::text,
    coalesce(p_contract_version, '')
  ));

  select * into v_existing
  from private.drive_evidence_idempotency
  where profile_id = v_actor.id
    and idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing.request_hash <> v_request_hash then
      return jsonb_build_object(
        'ok', false,
        'code', 'IDEMPOTENCY_CONFLICT',
        'canonicalConfirmed', false,
        'retryBlocked', true,
        'recovered', false
      );
    end if;
    return jsonb_set(v_existing.response_payload, '{recovered}', 'true'::jsonb, true);
  end if;

  -- The idempotency and row locks are deliberately non-blocking. A busy result
  -- is transient and is never persisted, allowing the same token one bounded retry.
  if not pg_try_advisory_xact_lock(hashtextextended(
    'drive-evidence-idempotency:' || v_actor.id::text || ':' || btrim(p_idempotency_key), 0
  )) then
    return jsonb_build_object(
      'ok', false,
      'code', 'DRIVE_SAVE_BUSY',
      'canonicalConfirmed', false,
      'retryAfterMs', 250,
      'retryBlocked', false,
      'recovered', false
    );
  end if;

  select * into v_existing
  from private.drive_evidence_idempotency
  where profile_id = v_actor.id
    and idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing.request_hash <> v_request_hash then
      return jsonb_build_object(
        'ok', false,
        'code', 'IDEMPOTENCY_CONFLICT',
        'canonicalConfirmed', false,
        'retryBlocked', true,
        'recovered', false
      );
    end if;
    return jsonb_set(v_existing.response_payload, '{recovered}', 'true'::jsonb, true);
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended('drive-evidence-row:' || btrim(p_master_uid), 0)) then
    return jsonb_build_object(
      'ok', false,
      'code', 'DRIVE_SAVE_BUSY',
      'canonicalConfirmed', false,
      'retryAfterMs', 300,
      'retryBlocked', false,
      'recovered', false
    );
  end if;

  select * into v_row
  from public.ph_master_inventory
  where unique_id = btrim(p_master_uid);

  if not found then
    v_response := jsonb_build_object(
      'ok', false,
      'code', 'DRIVE_ROW_NOT_FOUND',
      'canonicalConfirmed', true,
      'retryBlocked', true,
      'recovered', false
    );
    return private.store_drive_evidence_terminal_v2(
      v_actor.id, p_idempotency_key, v_request_hash, v_response,
      'DRIVE_ROW_NOT_FOUND', now() + interval '24 hours'
    );
  end if;

  if upper(btrim(coalesce(v_row.itemcode, ''))) <> upper(btrim(coalesce(p_expected_itemcode, '')))
     or upper(btrim(coalesce(v_row.locationcode, ''))) <> upper(btrim(coalesce(p_expected_locationcode, '')))
     or upper(btrim(coalesce(v_row.lotcode, ''))) <> upper(btrim(coalesce(p_expected_lotcode, ''))) then
    v_response := jsonb_build_object(
      'ok', false,
      'code', 'DRIVE_ROW_IDENTITY_CONFLICT',
      'canonicalConfirmed', true,
      'row', to_jsonb(v_row),
      'retryBlocked', true,
      'recovered', false
    );
    return private.store_drive_evidence_terminal_v2(
      v_actor.id, p_idempotency_key, v_request_hash, v_response,
      'DRIVE_ROW_IDENTITY_CONFLICT', now() + interval '24 hours'
    );
  end if;

  v_current_fields := jsonb_build_object(
    'spec', v_row.spec,
    'caliper', v_row.caliper,
    'match', v_row.match,
    'loc_match_qty', v_row.loc_match_qty,
    'initial_ptr', v_row.initial_ptr,
    'av_note', v_row.av_note,
    'pick_note', v_row.pic_note,
    'comments', v_row.sales_note,
    'photo_link', v_row.photo_link,
    'photo_name', v_row.photo_name
  );
  v_is_stale := v_expected_signature is not null
    and v_row.last_updated is distinct from v_expected_signature;

  if v_is_stale and (not coalesce(p_allow_field_merge, false) or coalesce(p_complete, false)) then
    v_response := jsonb_build_object(
      'ok', false,
      'code', case when coalesce(p_complete, false) then 'DRIVE_COMPLETION_STALE' else 'DRIVE_ROW_STALE' end,
      'canonicalConfirmed', true,
      'row', to_jsonb(v_row),
      'conflictFields', '[]'::jsonb,
      'retryBlocked', true,
      'recovered', false
    );
    return private.store_drive_evidence_terminal_v2(
      v_actor.id, p_idempotency_key, v_request_hash, v_response,
      case when coalesce(p_complete, false) then 'DRIVE_COMPLETION_STALE' else 'DRIVE_ROW_STALE' end,
      now() + interval '24 hours'
    );
  end if;

  if v_is_stale and coalesce(p_allow_field_merge, false) then
    select coalesce(array_agg(key order by key), '{}'::text[])
      into v_conflict_fields
    from jsonb_object_keys(v_payload) as keys(key)
    where not (v_baseline ? key)
       or coalesce(v_baseline ->> key, '') is distinct from coalesce(v_current_fields ->> key, '');

    if cardinality(v_conflict_fields) > 0 then
      v_response := jsonb_build_object(
        'ok', false,
        'code', 'DRIVE_FIELD_CONFLICT',
        'canonicalConfirmed', true,
        'row', to_jsonb(v_row),
        'conflictFields', to_jsonb(v_conflict_fields),
        'retryBlocked', true,
        'recovered', false
      );
      return private.store_drive_evidence_terminal_v2(
        v_actor.id, p_idempotency_key, v_request_hash, v_response,
        'DRIVE_FIELD_CONFLICT', now() + interval '24 hours'
      );
    end if;
  end if;

  update public.ph_master_inventory
  set spec = case when v_payload ? 'spec' then nullif(btrim(v_payload ->> 'spec'), '') else spec end,
      caliper = case when v_payload ? 'caliper' then nullif(btrim(v_payload ->> 'caliper'), '') else caliper end,
      match = case when v_payload ? 'match' then nullif(btrim(v_payload ->> 'match'), '') else match end,
      loc_match_qty = case when v_payload ? 'loc_match_qty' then nullif(btrim(v_payload ->> 'loc_match_qty'), '') else loc_match_qty end,
      initial_ptr = case when v_payload ? 'initial_ptr' then nullif(btrim(v_payload ->> 'initial_ptr'), '') else initial_ptr end,
      av_note = case when v_payload ? 'av_note' then nullif(btrim(v_payload ->> 'av_note'), '') else av_note end,
      pic_note = case when v_payload ? 'pick_note' then nullif(btrim(v_payload ->> 'pick_note'), '') else pic_note end,
      sales_note = case when v_payload ? 'comments' then nullif(v_payload ->> 'comments', '') else sales_note end,
      photo_link = case when v_payload ? 'photo_link' then nullif(btrim(v_payload ->> 'photo_link'), '') else photo_link end,
      photo_name = case when v_payload ? 'photo_name' then nullif(btrim(v_payload ->> 'photo_name'), '') else photo_name end,
      date_completed = case when coalesce(p_complete, false) then v_saved_at else date_completed end,
      app_tab_assignment = case when coalesce(p_complete, false) then v_workflow else app_tab_assignment end,
      av_rule_priority_snapshot = case when v_payload <> '{}'::jsonb then priority else av_rule_priority_snapshot end,
      av_rule_holdstop_snapshot = case when v_payload <> '{}'::jsonb then concat_ws('|',
        nullif(btrim(coalesce(holdstopcode, '')), ''),
        nullif(btrim(coalesce(holdstopreason, '')), '')
      ) else av_rule_holdstop_snapshot end,
      av_rule_spec_updated_at = case when v_payload ? 'spec' then v_saved_at else av_rule_spec_updated_at end,
      av_rule_caliper_updated_at = case when v_payload ? 'caliper' then v_saved_at else av_rule_caliper_updated_at end,
      av_rule_match_updated_at = case when v_payload ? 'match' then v_saved_at else av_rule_match_updated_at end,
      av_rule_av_note_updated_at = case when v_payload ? 'av_note' then v_saved_at else av_rule_av_note_updated_at end,
      av_rule_photo_updated_at = case when v_payload ? 'photo_link' or v_payload ? 'photo_name' then v_saved_at else av_rule_photo_updated_at end,
      av_rule_bundle_updated_at = case when v_payload <> '{}'::jsonb then v_saved_at else av_rule_bundle_updated_at end,
      last_updated = v_saved_at
  where unique_id = v_row.unique_id
    and last_updated is not distinct from v_row.last_updated
  returning * into v_saved;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'DRIVE_SAVE_BUSY',
      'canonicalConfirmed', false,
      'retryAfterMs', 350,
      'retryBlocked', false,
      'recovered', false
    );
  end if;

  with updated_requests as (
    update public.ph_active_request request
    set req_spec = v_saved.spec,
        req_caliper = v_saved.caliper,
        req_match = private.eval_work_safe_numeric_v1(v_saved.match),
        req_pic_note = v_saved.pic_note,
        req_sales_note = v_saved.sales_note,
        req_comments = v_saved.sales_note,
        av_note = v_saved.av_note,
        req_photo_link = v_saved.photo_link,
        req_photo_name = v_saved.photo_name,
        req_status = case when coalesce(p_complete, false) then 'Complete' else request.req_status end,
        date_completed = case when coalesce(p_complete, false) then v_saved_at::text else request.date_completed end,
        completed_by_username = case when coalesce(p_complete, false) then lower(btrim(v_actor.username)) else request.completed_by_username end,
        completed_by_display = case when coalesce(p_complete, false) then coalesce(nullif(btrim(v_actor.display_name), ''), v_actor.username) else request.completed_by_display end,
        app_tab_assignment = v_saved.app_tab_assignment,
        master_app_tab_assignment = v_saved.app_tab_assignment,
        row_version = coalesce(request.row_version, 0) + 1,
        updated_at = v_saved_at
    where request.master_id = v_row.unique_id
      and upper(btrim(coalesce(request.itemcode, ''))) = upper(btrim(coalesce(v_row.itemcode, '')))
      and upper(btrim(coalesce(request.locationcode, ''))) = upper(btrim(coalesce(v_row.locationcode, '')))
      and upper(btrim(coalesce(request.lotcode, ''))) = upper(btrim(coalesce(v_row.lotcode, '')))
      and coalesce(request.req_archived, false) = false
      and lower(btrim(coalesce(request.req_status, 'pending'))) not in ('complete','completed','done','archived','cancelled','canceled')
    returning request.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated_requests) order by updated_requests.unique_id), '[]'::jsonb)
    into v_request_rows
  from updated_requests;

  v_response := jsonb_build_object(
    'ok', true,
    'code', 'SAVED',
    'contractVersion', coalesce(nullif(btrim(p_contract_version), ''), 'save-drive-evidence-v2'),
    'row', to_jsonb(v_saved),
    'requestRows', v_request_rows,
    'completed', coalesce(p_complete, false),
    'canonicalConfirmed', true,
    'mergedUnrelatedChanges', v_is_stale,
    'retryBlocked', false,
    'recovered', false
  );

  return private.store_drive_evidence_terminal_v2(
    v_actor.id, p_idempotency_key, v_request_hash, v_response, 'SAVED', null
  );
end
$function$;

revoke all on function private.save_drive_evidence_core_v2(
  text, text, text, text, text, jsonb, jsonb, boolean, text, text, boolean, text
) from public, anon, authenticated;

-- Compatibility endpoint for already-open shells. Its signature is unchanged,
-- but stale/identity/missing outcomes are now sanitized HTTP-200 JSON results.
create or replace function public.save_drive_evidence_v1(
  p_master_uid text,
  p_expected_itemcode text,
  p_expected_locationcode text,
  p_expected_lotcode text,
  p_expected_signature text,
  p_evidence jsonb,
  p_complete boolean,
  p_workflow text,
  p_idempotency_key text
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select private.save_drive_evidence_core_v2(
    p_master_uid,
    p_expected_itemcode,
    p_expected_locationcode,
    p_expected_lotcode,
    p_expected_signature,
    '{}'::jsonb,
    p_evidence,
    p_complete,
    p_workflow,
    p_idempotency_key,
    false,
    'save-drive-evidence-v1-compatible'
  );
$function$;

create or replace function public.save_drive_evidence_v2(
  p_master_uid text,
  p_expected_itemcode text,
  p_expected_locationcode text,
  p_expected_lotcode text,
  p_expected_signature text,
  p_baseline jsonb,
  p_evidence jsonb,
  p_complete boolean,
  p_workflow text,
  p_idempotency_key text
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select private.save_drive_evidence_core_v2(
    p_master_uid,
    p_expected_itemcode,
    p_expected_locationcode,
    p_expected_lotcode,
    p_expected_signature,
    p_baseline,
    p_evidence,
    p_complete,
    p_workflow,
    p_idempotency_key,
    true,
    'save-drive-evidence-v2-field-merge'
  );
$function$;

create or replace function public.get_drive_evidence_save_health_v2()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_active_sessions bigint := 0;
  v_lock_waits bigint := 0;
  v_recent_outcomes jsonb := '{}'::jsonb;
  v_recent_unique_tokens bigint := 0;
begin
  select
    count(*) filter (where state <> 'idle'),
    count(*) filter (where state <> 'idle' and wait_event_type = 'Lock')
  into v_active_sessions, v_lock_waits
  from pg_catalog.pg_stat_activity
  where pid <> pg_backend_pid()
    and datname = current_database()
    and query ilike '%save_drive_evidence%';

  select coalesce(jsonb_object_agg(outcome_code, outcome_count), '{}'::jsonb),
         coalesce(sum(outcome_count), 0)
  into v_recent_outcomes, v_recent_unique_tokens
  from (
    select upper(btrim(coalesce(outcome_code, 'UNKNOWN'))) as outcome_code,
           count(*)::bigint as outcome_count
    from private.drive_evidence_idempotency
    where created_at >= now() - interval '5 minutes'
    group by upper(btrim(coalesce(outcome_code, 'UNKNOWN')))
  ) recent;

  return jsonb_build_object(
    'contractVersion', 'drive-evidence-save-health-v2',
    'windowMinutes', 5,
    'recentUniqueTokens', v_recent_unique_tokens,
    'outcomes', v_recent_outcomes,
    'activeSaveSessions', v_active_sessions,
    'lockWaits', v_lock_waits,
    'healthy', v_lock_waits = 0 and v_active_sessions <= 10
  );
end
$function$;

revoke all on function public.save_drive_evidence_v1(
  text, text, text, text, text, jsonb, boolean, text, text
) from public, anon;
revoke all on function public.save_drive_evidence_v2(
  text, text, text, text, text, jsonb, jsonb, boolean, text, text
) from public, anon;
revoke all on function public.get_drive_evidence_save_health_v2()
  from public, anon, authenticated;

grant execute on function public.save_drive_evidence_v1(
  text, text, text, text, text, jsonb, boolean, text, text
) to authenticated;
grant execute on function public.save_drive_evidence_v2(
  text, text, text, text, text, jsonb, jsonb, boolean, text, text
) to authenticated;
grant execute on function public.get_drive_evidence_save_health_v2()
  to service_role;

comment on function public.save_drive_evidence_v1(text, text, text, text, text, jsonb, boolean, text, text) is
  'Compatibility Drive evidence save. Expected conflicts return sanitized JSON and never wait on row locks.';
comment on function public.save_drive_evidence_v2(text, text, text, text, text, jsonb, jsonb, boolean, text, text) is
  'Admin-only Drive evidence save with field-level optimistic merge, non-blocking concurrency, and idempotent outcomes.';
comment on function public.get_drive_evidence_save_health_v2() is
  'Service-only sanitized five-minute Drive evidence save concurrency and outcome health.';

commit;
