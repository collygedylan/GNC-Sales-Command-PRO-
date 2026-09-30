begin;

-- Completion history is evidence of values that were saved at completion time.
-- Empty history fields are not evidence that later master values should be erased.
create or replace function public.get_request_drive_evidence_health_snapshot_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  mismatch_count bigint := 0;
  checked_count bigint := 0;
  mismatch_request_ids jsonb := '[]'::jsonb;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'REQUEST_DRIVE_HEALTH_FORBIDDEN';
  end if;

  with latest_completion as (
    select distinct on (history.master_id)
      history.unique_id,
      history.master_id,
      history.req_spec,
      history.req_caliper,
      history.req_match,
      history.req_pic_note,
      history.av_note,
      history.req_photo_link,
      history.req_photo_name,
      coalesce(history.date_completed, history.updated_at) as completed_at,
      master.spec as master_spec,
      master.caliper as master_caliper,
      master.match as master_match,
      master.pic_note as master_pic_note,
      master.av_note as master_av_note,
      master.photo_link as master_photo_link,
      master.photo_name as master_photo_name,
      master.av_rule_bundle_updated_at,
      master.av_rule_av_note_updated_at,
      master.av_rule_spec_updated_at,
      master.av_rule_match_updated_at,
      master.av_rule_caliper_updated_at,
      master.av_rule_photo_updated_at
    from public.ph_request_history history
    join public.ph_master_inventory master on master.unique_id = history.master_id
    where history.date_completed >= now() - interval '48 hours'
      and lower(btrim(coalesce(history.req_status, ''))) in ('complete','completed','done')
    order by history.master_id, history.date_completed desc nulls last, history.updated_at desc nulls last
  ), evaluated as (
    select completion.*,
      (
        (
          nullif(btrim(completion.req_spec), '') is not null
          and coalesce(btrim(completion.req_spec), '') is distinct from coalesce(btrim(completion.master_spec), '')
          and (completion.av_rule_spec_updated_at is null or completion.av_rule_spec_updated_at <= completion.completed_at)
        )
        or (
          nullif(btrim(completion.req_caliper), '') is not null
          and coalesce(btrim(completion.req_caliper), '') is distinct from coalesce(btrim(completion.master_caliper), '')
          and (completion.av_rule_caliper_updated_at is null or completion.av_rule_caliper_updated_at <= completion.completed_at)
        )
        or (
          nullif(btrim(completion.req_match), '') is not null
          and coalesce(btrim(completion.req_match), '') is distinct from coalesce(btrim(completion.master_match), '')
          and (completion.av_rule_match_updated_at is null or completion.av_rule_match_updated_at <= completion.completed_at)
        )
        or (
          nullif(btrim(completion.req_pic_note), '') is not null
          and coalesce(btrim(completion.req_pic_note), '') is distinct from coalesce(btrim(completion.master_pic_note), '')
        )
        or (
          nullif(btrim(completion.av_note), '') is not null
          and coalesce(btrim(completion.av_note), '') is distinct from coalesce(btrim(completion.master_av_note), '')
          and (completion.av_rule_av_note_updated_at is null or completion.av_rule_av_note_updated_at <= completion.completed_at)
        )
        or (
          nullif(btrim(completion.req_photo_link), '') is not null
          and coalesce(btrim(completion.req_photo_link), '') is distinct from coalesce(btrim(completion.master_photo_link), '')
          and (completion.av_rule_photo_updated_at is null or completion.av_rule_photo_updated_at <= completion.completed_at)
        )
        or (
          nullif(btrim(completion.req_photo_name), '') is not null
          and coalesce(btrim(completion.req_photo_name), '') is distinct from coalesce(btrim(completion.master_photo_name), '')
          and (completion.av_rule_photo_updated_at is null or completion.av_rule_photo_updated_at <= completion.completed_at)
        )
      )
      and (
        completion.av_rule_bundle_updated_at is null
        or completion.av_rule_bundle_updated_at <= completion.completed_at
      ) as has_repairable_mismatch
    from latest_completion completion
  )
  select
    count(*),
    count(*) filter (where evaluated.has_repairable_mismatch),
    coalesce(
      jsonb_agg(to_jsonb(evaluated.unique_id) order by evaluated.completed_at, evaluated.unique_id)
        filter (where evaluated.has_repairable_mismatch and evaluated.unique_id is not null),
      '[]'::jsonb
    )
  into checked_count, mismatch_count, mismatch_request_ids
  from evaluated;

  return jsonb_build_object(
    'contract_version', 'request-drive-evidence-health-v1',
    'recent_completed_count', checked_count,
    'evidence_mismatch_count', mismatch_count,
    'mismatch_request_ids', mismatch_request_ids
  );
end
$function$;

create or replace function public.repair_request_drive_evidence_v1(
  p_request_ids text[],
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate record;
  eligible_count integer := 0;
  repaired_count integer := 0;
  skipped_newer_count integer := 0;
  affected_count integer := 0;
  completed_at timestamptz;
  raw_mismatch boolean;
  repair_spec boolean;
  repair_caliper boolean;
  repair_match boolean;
  repair_pic_note boolean;
  repair_av_note boolean;
  repair_photo_link boolean;
  repair_photo_name boolean;
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'REQUEST_DRIVE_REPAIR_FORBIDDEN';
  end if;
  if cardinality(coalesce(p_request_ids, '{}'::text[])) < 1
     or cardinality(p_request_ids) > 100 then
    raise exception using errcode = '22023', message = 'REQUEST_DRIVE_REPAIR_SCOPE_INVALID';
  end if;

  for candidate in
    with latest_completion as (
      select distinct on (history.master_id)
        history.*,
        master.spec as master_spec,
        master.caliper as master_caliper,
        master.match as master_match,
        master.pic_note as master_pic_note,
        master.av_note as master_av_note,
        master.photo_link as master_photo_link,
        master.photo_name as master_photo_name,
        master.av_rule_bundle_updated_at,
        master.av_rule_av_note_updated_at,
        master.av_rule_spec_updated_at,
        master.av_rule_match_updated_at,
        master.av_rule_caliper_updated_at,
        master.av_rule_photo_updated_at
      from public.ph_request_history history
      join public.ph_master_inventory master on master.unique_id = history.master_id
      where lower(btrim(coalesce(history.req_status, ''))) in ('complete','completed','done')
      order by history.master_id, history.date_completed desc nulls last, history.updated_at desc nulls last
    )
    select completion.*
    from latest_completion completion
    where completion.unique_id = any(p_request_ids)
    order by completion.master_id
  loop
    completed_at := coalesce(candidate.date_completed, candidate.updated_at);
    raw_mismatch :=
      (nullif(btrim(candidate.req_spec), '') is not null and coalesce(btrim(candidate.req_spec), '') is distinct from coalesce(btrim(candidate.master_spec), ''))
      or (nullif(btrim(candidate.req_caliper), '') is not null and coalesce(btrim(candidate.req_caliper), '') is distinct from coalesce(btrim(candidate.master_caliper), ''))
      or (nullif(btrim(candidate.req_match), '') is not null and coalesce(btrim(candidate.req_match), '') is distinct from coalesce(btrim(candidate.master_match), ''))
      or (nullif(btrim(candidate.req_pic_note), '') is not null and coalesce(btrim(candidate.req_pic_note), '') is distinct from coalesce(btrim(candidate.master_pic_note), ''))
      or (nullif(btrim(candidate.av_note), '') is not null and coalesce(btrim(candidate.av_note), '') is distinct from coalesce(btrim(candidate.master_av_note), ''))
      or (nullif(btrim(candidate.req_photo_link), '') is not null and coalesce(btrim(candidate.req_photo_link), '') is distinct from coalesce(btrim(candidate.master_photo_link), ''))
      or (nullif(btrim(candidate.req_photo_name), '') is not null and coalesce(btrim(candidate.req_photo_name), '') is distinct from coalesce(btrim(candidate.master_photo_name), ''));

    if not raw_mismatch then
      continue;
    end if;
    if candidate.av_rule_bundle_updated_at is not null
       and candidate.av_rule_bundle_updated_at > completed_at then
      skipped_newer_count := skipped_newer_count + 1;
      continue;
    end if;

    repair_spec := nullif(btrim(candidate.req_spec), '') is not null
      and coalesce(btrim(candidate.req_spec), '') is distinct from coalesce(btrim(candidate.master_spec), '')
      and (candidate.av_rule_spec_updated_at is null or candidate.av_rule_spec_updated_at <= completed_at);
    repair_caliper := nullif(btrim(candidate.req_caliper), '') is not null
      and coalesce(btrim(candidate.req_caliper), '') is distinct from coalesce(btrim(candidate.master_caliper), '')
      and (candidate.av_rule_caliper_updated_at is null or candidate.av_rule_caliper_updated_at <= completed_at);
    repair_match := nullif(btrim(candidate.req_match), '') is not null
      and coalesce(btrim(candidate.req_match), '') is distinct from coalesce(btrim(candidate.master_match), '')
      and (candidate.av_rule_match_updated_at is null or candidate.av_rule_match_updated_at <= completed_at);
    repair_pic_note := nullif(btrim(candidate.req_pic_note), '') is not null
      and coalesce(btrim(candidate.req_pic_note), '') is distinct from coalesce(btrim(candidate.master_pic_note), '');
    repair_av_note := nullif(btrim(candidate.av_note), '') is not null
      and coalesce(btrim(candidate.av_note), '') is distinct from coalesce(btrim(candidate.master_av_note), '')
      and (candidate.av_rule_av_note_updated_at is null or candidate.av_rule_av_note_updated_at <= completed_at);
    repair_photo_link := nullif(btrim(candidate.req_photo_link), '') is not null
      and coalesce(btrim(candidate.req_photo_link), '') is distinct from coalesce(btrim(candidate.master_photo_link), '')
      and (candidate.av_rule_photo_updated_at is null or candidate.av_rule_photo_updated_at <= completed_at);
    repair_photo_name := nullif(btrim(candidate.req_photo_name), '') is not null
      and coalesce(btrim(candidate.req_photo_name), '') is distinct from coalesce(btrim(candidate.master_photo_name), '')
      and (candidate.av_rule_photo_updated_at is null or candidate.av_rule_photo_updated_at <= completed_at);

    if not (repair_spec or repair_caliper or repair_match or repair_pic_note or repair_av_note or repair_photo_link or repair_photo_name) then
      skipped_newer_count := skipped_newer_count + 1;
      continue;
    end if;
    eligible_count := eligible_count + 1;

    if not coalesce(p_dry_run, true) then
      update public.ph_master_inventory as master
      set spec = case when repair_spec then nullif(btrim(candidate.req_spec), '') else master.spec end,
          caliper = case when repair_caliper then nullif(btrim(candidate.req_caliper), '') else master.caliper end,
          match = case when repair_match then nullif(btrim(candidate.req_match), '') else master.match end,
          pic_note = case when repair_pic_note then nullif(btrim(candidate.req_pic_note), '') else master.pic_note end,
          av_note = case when repair_av_note then nullif(btrim(candidate.av_note), '') else master.av_note end,
          photo_link = case when repair_photo_link then nullif(btrim(candidate.req_photo_link), '') else master.photo_link end,
          photo_name = case when repair_photo_name then nullif(btrim(candidate.req_photo_name), '') else master.photo_name end,
          av_rule_bundle_updated_at = completed_at,
          av_rule_av_note_updated_at = case when repair_av_note then completed_at else master.av_rule_av_note_updated_at end,
          av_rule_spec_updated_at = case when repair_spec then completed_at else master.av_rule_spec_updated_at end,
          av_rule_match_updated_at = case when repair_match then completed_at else master.av_rule_match_updated_at end,
          av_rule_caliper_updated_at = case when repair_caliper then completed_at else master.av_rule_caliper_updated_at end,
          av_rule_photo_updated_at = case when repair_photo_link or repair_photo_name then completed_at else master.av_rule_photo_updated_at end,
          last_updated = now()
      where master.unique_id = candidate.master_id
        and master.av_rule_bundle_updated_at is not distinct from candidate.av_rule_bundle_updated_at
        and (not repair_spec or (master.spec is not distinct from candidate.master_spec and master.av_rule_spec_updated_at is not distinct from candidate.av_rule_spec_updated_at))
        and (not repair_caliper or (master.caliper is not distinct from candidate.master_caliper and master.av_rule_caliper_updated_at is not distinct from candidate.av_rule_caliper_updated_at))
        and (not repair_match or (master.match is not distinct from candidate.master_match and master.av_rule_match_updated_at is not distinct from candidate.av_rule_match_updated_at))
        and (not repair_pic_note or master.pic_note is not distinct from candidate.master_pic_note)
        and (not repair_av_note or (master.av_note is not distinct from candidate.master_av_note and master.av_rule_av_note_updated_at is not distinct from candidate.av_rule_av_note_updated_at))
        and (not (repair_photo_link or repair_photo_name) or (master.photo_link is not distinct from candidate.master_photo_link and master.photo_name is not distinct from candidate.master_photo_name and master.av_rule_photo_updated_at is not distinct from candidate.av_rule_photo_updated_at));
      get diagnostics affected_count = row_count;
      if affected_count = 1 then
        repaired_count := repaired_count + 1;
      else
        skipped_newer_count := skipped_newer_count + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'contract_version', 'request-drive-evidence-repair-v1',
    'dry_run', coalesce(p_dry_run, true),
    'eligible_count', eligible_count,
    'repaired_count', repaired_count,
    'skipped_newer_count', skipped_newer_count
  );
end
$function$;

revoke all on function public.get_request_drive_evidence_health_snapshot_v1() from public, anon, authenticated;
revoke all on function public.repair_request_drive_evidence_v1(text[], boolean) from public, anon, authenticated;
grant execute on function public.get_request_drive_evidence_health_snapshot_v1() to service_role;
grant execute on function public.repair_request_drive_evidence_v1(text[], boolean) to service_role;

comment on function public.get_request_drive_evidence_health_snapshot_v1() is
  'Service-only health snapshot. Flags only non-empty completion evidence that can be repaired without overwriting a newer master-field update.';
comment on function public.repair_request_drive_evidence_v1(text[], boolean) is
  'Service-only bounded repair. Never clears a master field from empty history and uses optimistic timestamp/value guards against concurrent or newer writes.';

-- Trigger and maintenance functions do not need direct browser execution. Remove
-- default PUBLIC grants and keep only the service-role path used by trusted jobs.
do $block$
declare
  target text;
  target_oid regprocedure;
begin
  foreach target in array array[
    'public.add_default_walkie_channels_for_user()',
    'public.dispatch_github_ml_worker()',
    'public.emit_v2_app_live_event()',
    'public.ph_prepare_hold_learning_refresh_chunked(text)',
    'public.ph_refresh_hold_learning_itemcode_batch(text,integer)',
    'public.ph_refresh_hold_learning_summary_batch(text,integer)',
    'public.ph_refresh_hold_stop_itemcode_summaries()',
    'public.ph_start_hold_learning_refresh_chunked(text,integer,integer)',
    'public.prune_v2_app_live_events(integer)',
    'public.prune_v2_app_live_events_by_count(integer)',
    'public.send_onesignal_push(text,text)',
    'public.upsert_v2_crop_roll_drive_row_from_master()',
    'public.v2_capture_hold_learning_event()',
    'public.v2_dispatch_ml_worker_for_disease_asset()',
    'public.v2_dispatch_ml_worker_for_image_job()',
    'public.v2_refresh_hold_learning_from_drive_around_rows(integer)',
    'public.v2_refresh_hold_learning_from_drive_around_rows_range(date,date,integer)',
    'public.v2_refresh_hold_stop_itemcode_episode_learning(date,date,integer)'
  ]
  loop
    target_oid := to_regprocedure(target);
    if target_oid is not null then
      execute format('revoke all on function %s from public, anon, authenticated', target_oid);
      execute format('grant execute on function %s to service_role', target_oid);
    end if;
  end loop;

  target_oid := to_regprocedure('public.v2_master_inventory_for_assigned_user(text)');
  if target_oid is not null then
    execute format('revoke all on function %s from public, anon, authenticated', target_oid);
    execute format('grant execute on function %s to authenticated, service_role', target_oid);
  end if;

  target_oid := to_regprocedure('public.send_onesignal_push(text,text)');
  if target_oid is not null then
    execute format('alter function %s set search_path = %L', target_oid, '');
  end if;
end
$block$;

commit;
