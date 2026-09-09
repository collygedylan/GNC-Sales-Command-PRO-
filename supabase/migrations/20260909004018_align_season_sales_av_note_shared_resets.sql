begin;

-- The existing inventory trigger clears AV/photo/spec together for these
-- transitions. Record the reset so every Season projection can honor it.
-- This name sorts before trigger_inventory_changes, which performs the clear.
create or replace function private.stamp_season_sales_av_reset_v1()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if old.priority is distinct from new.priority then
    new.av_rule_last_clear_reason := 'priority_changed';
    new.av_rule_last_cleared_at := clock_timestamp();
  elsif (upper(coalesce(old.holdstopcode, '')) ~ '[HS]')
        is distinct from (upper(coalesce(new.holdstopcode, '')) ~ '[HS]') then
    new.av_rule_last_clear_reason := 'hold_stop_changed';
    new.av_rule_last_cleared_at := clock_timestamp();
  elsif new.av_rule_last_cleared_at is not null
        and new.av_rule_last_cleared_at is distinct from old.av_rule_last_cleared_at
        and nullif(btrim(new.av_note), '') is null
        and nullif(btrim(new.spec), '') is null
        and nullif(btrim(new.photo_link), '') is null
        and nullif(btrim(new.photo_name), '') is null then
    -- A reset may have waited for an inventory row lock. Its epoch is when
    -- the reset occurs, not when that transaction or the client request began.
    new.av_rule_last_cleared_at := clock_timestamp();
  end if;
  return new;
end
$function$;

create trigger stamp_season_sales_av_reset
before update of priority, holdstopcode, av_rule_last_cleared_at on public.ph_master_inventory
for each row execute function private.stamp_season_sales_av_reset_v1();

-- Called only while holding the existing Season lifecycle advisory lock.
-- An imported AV-note blank alone and photo-only removal are not resets.
create or replace function private.clear_season_sales_av_note_for_reset_v1(
  p_master public.ph_master_inventory
)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  state_row public.ph_season_sales_office_state;
  evidence jsonb;
  previous_note text;
  previous_note_at timestamptz;
begin
  -- The reset epoch remains authoritative if newer photo/spec data arrives
  -- before a deferred reset is reconciled. Only a newer saved note supersedes
  -- it; later unrelated evidence must not resurrect the old retained text.
  if p_master.av_rule_last_cleared_at is null then return; end if;
  select * into state_row
  from public.ph_season_sales_office_state state
  where state.winner_unique_id = p_master.unique_id
    and state.season_code = upper(btrim(private.season_sales_settings_v1()->>'seasonCode'))
    and state.sales_year = private.season_sales_year_v1(private.season_sales_settings_v1()->>'salesYear')
    and nullif(btrim(state.retained_av_note), '') is not null
    and state.retained_av_note_at <= p_master.av_rule_last_cleared_at
  for update;
  if not found then return; end if;

  previous_note := state_row.retained_av_note;
  previous_note_at := state_row.retained_av_note_at;
  evidence := private.season_sales_evidence_v1(to_jsonb(p_master) || jsonb_build_object('av_note', null));
  update public.ph_season_sales_office_state state set
    retained_av_note = null,
    retained_av_note_at = p_master.av_rule_last_cleared_at,
    revision = state.revision + 1,
    readiness_status = case
      when state.status = 'done' then 'done'
      when state.status = 'retired' then 'retired'
      when state.reopen_reason = 'cav_blank' then 'reopened_cav_blank'
      when state.reopen_reason = 'evidence_invalid' then 'reopened_evidence_invalid'
      else evidence->>'status' end,
    current_evidence_snapshot = evidence,
    source_fingerprint = evidence->>'fingerprint',
    updated_at = now()
  where state.id = state_row.id returning * into state_row;

  -- Only the current existing Season mirror is affected. Lifecycle decisions,
  -- completion history, and arrival time remain the reconciler's responsibility.
  update public.ph_sales_office sales set
    av_note = null,
    spec = p_master.spec,
    caliper = p_master.caliper,
    photo_link = p_master.photo_link,
    photo_name = p_master.photo_name,
    state_revision = state_row.revision,
    workflow_status = state_row.readiness_status,
    workflow_detail = evidence,
    updated_at = now()
  where state_row.status = 'open'
    and sales.unique_id = state_row.winner_unique_id
    and lower(btrim(coalesce(sales.so_source, 'season'))) = 'season';

  insert into public.ph_season_sales_office_events (
    state_id, event_type, actor_username, revision, reason_code, metadata
  ) values (
    state_row.id, 'av_note_saved', 'service_role', state_row.revision,
    'shared_av_rule_reset',
    jsonb_build_object('resetReason', p_master.av_rule_last_clear_reason,
      'resetAt', p_master.av_rule_last_cleared_at,
      'previousNote', left(previous_note, 500),
      'previousNoteTruncated', length(previous_note) > 500,
      'previousNoteCapturedAt', previous_note_at)
  );
end
$function$;

create or replace function private.sync_season_sales_av_note_reset_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.av_rule_last_cleared_at is not null
     and (new.av_rule_last_cleared_at is distinct from old.av_rule_last_cleared_at
       or new.priority is distinct from old.priority
       or (upper(coalesce(old.holdstopcode, '')) ~ '[HS]')
          is distinct from (upper(coalesce(new.holdstopcode, '')) ~ '[HS]'))
     and nullif(btrim(new.av_note), '') is null
     and nullif(btrim(new.spec), '') is null
     and nullif(btrim(new.photo_link), '') is null
     and nullif(btrim(new.photo_name), '') is null then
    -- Imports already hold inventory row locks. Never wait for a lifecycle
    -- lock held by a user save/Done operation that may need that inventory row.
    -- Reconciliation retries the durable reset marker when the lock is busy.
    if pg_try_advisory_xact_lock(hashtextextended('season-sales-office-v1', 0)) then
      perform private.clear_season_sales_av_note_for_reset_v1(new);
    end if;
  end if;
  return new;
end
$function$;

create trigger sync_season_sales_av_note_reset
after update on public.ph_master_inventory
for each row execute function private.sync_season_sales_av_note_reset_v1();

revoke all on function private.stamp_season_sales_av_reset_v1() from public, anon, authenticated;
revoke all on function private.clear_season_sales_av_note_for_reset_v1(public.ph_master_inventory) from public, anon, authenticated;
revoke all on function private.sync_season_sales_av_note_reset_v1() from public, anon, authenticated;

do $patch$
declare
  definition text;
  before_text text;
  after_text text;
begin
  definition := replace(pg_get_functiondef('public.reconcile_season_sales_office_v1(text[],boolean,text,text)'::regprocedure), E'\r\n', E'\n');
  before_text := $old$if state_row.id is not null and state_row.winner_unique_id = winner.unique_id then
      winner.av_note := state_row.retained_av_note;
    end if;$old$;
  after_text := $new$if state_row.id is not null and state_row.winner_unique_id = winner.unique_id then
      perform private.clear_season_sales_av_note_for_reset_v1(winner);
      select * into state_row from public.ph_season_sales_office_state state where state.id = state_row.id;
      winner.av_note := state_row.retained_av_note;
    end if;$new$;
  if (length(definition) - length(replace(definition, before_text, ''))) / length(before_text) <> 1 then
    raise exception 'SEASON_SALES_SHARED_RESET_RECONCILE_PATCH_FAILED';
  end if;
  execute replace(definition, before_text, after_text);

  definition := replace(pg_get_functiondef('public.save_season_sales_office_av_note_v1(text,text,integer,text,text)'::regprocedure), E'\r\n', E'\n');
  before_text := E'begin\n  if length(btrim(coalesce(p_idempotency_key, ''''))) < 12 then';
  after_text := E'begin\n  perform pg_advisory_xact_lock(hashtextextended(''season-sales-office-v1'', 0));\n  if length(btrim(coalesce(p_idempotency_key, ''''))) < 12 then';
  if (length(definition) - length(replace(definition, before_text, ''))) / length(before_text) <> 1 then
    raise exception 'SEASON_SALES_SHARED_RESET_SAVE_LOCK_PATCH_FAILED';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := 'retained_av_note = winner.av_note, retained_av_note_at = now(),';
  after_text := 'retained_av_note = winner.av_note, retained_av_note_at = clock_timestamp(),';
  if (length(definition) - length(replace(definition, before_text, ''))) / length(before_text) <> 1 then
    raise exception 'SEASON_SALES_SHARED_RESET_SAVE_CLOCK_PATCH_FAILED';
  end if;
  execute replace(definition, before_text, after_text);

  definition := pg_get_functiondef('private.capture_season_sales_av_note_v1()'::regprocedure);
  before_text := 'new.retained_av_note_at := now();';
  after_text := 'new.retained_av_note_at := clock_timestamp();';
  if (length(definition) - length(replace(definition, before_text, ''))) / length(before_text) <> 1 then
    raise exception 'SEASON_SALES_SHARED_RESET_CAPTURE_CLOCK_PATCH_FAILED';
  end if;
  definition := replace(definition, before_text, after_text);
  -- A new winner must wait for an in-flight master reset before capturing its
  -- note. Otherwise old committed text could receive a newer capture epoch.
  before_text := 'where master.unique_id = new.winner_unique_id;';
  after_text := 'where master.unique_id = new.winner_unique_id for share;';
  if (length(definition) - length(replace(definition, before_text, ''))) / length(before_text) <> 1 then
    raise exception 'SEASON_SALES_SHARED_RESET_CAPTURE_LOCK_PATCH_FAILED';
  end if;
  execute replace(definition, before_text, after_text);
end
$patch$;

commit;
