-- Keep the public RPC security-invoker while retaining a protected write path.
-- The internal writer is outside the exposed Data API schema and repeats the
-- Dylan/Megan profile check before changing the single settings row.

create or replace function private.set_eval_report_settings_internal(
  p_low_stock_max_slts numeric,
  p_hold_age_days integer,
  p_location_note_age_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.ph_eval_report_settings%rowtype;
  manager_username text;
begin
  if not private.can_manage_eval_assignments() then
    raise exception using errcode = '42501', message = 'EVAL_REPORT_SETTINGS_FORBIDDEN';
  end if;
  if p_low_stock_max_slts is null
     or p_low_stock_max_slts < 0
     or p_low_stock_max_slts > 100000000 then
    raise exception using errcode = '22023', message = 'EVAL_REPORT_LOW_STOCK_LIMIT_INVALID';
  end if;
  if p_hold_age_days is null or p_hold_age_days < 0 or p_hold_age_days > 3650 then
    raise exception using errcode = '22023', message = 'EVAL_REPORT_HOLD_AGE_INVALID';
  end if;
  if p_location_note_age_days is null
     or p_location_note_age_days < 0
     or p_location_note_age_days > 3650 then
    raise exception using errcode = '22023', message = 'EVAL_REPORT_LOCATION_NOTE_AGE_INVALID';
  end if;

  manager_username := (private.current_active_profile()).username;

  insert into public.ph_eval_report_settings (
    singleton,
    low_stock_max_slts,
    hold_age_days,
    location_note_age_days,
    updated_by,
    updated_at
  ) values (
    true,
    p_low_stock_max_slts,
    p_hold_age_days,
    p_location_note_age_days,
    manager_username,
    now()
  )
  on conflict (singleton) do update set
    low_stock_max_slts = excluded.low_stock_max_slts,
    hold_age_days = excluded.hold_age_days,
    location_note_age_days = excluded.location_note_age_days,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning * into settings;

  return jsonb_build_object(
    'low_stock_max_slts', settings.low_stock_max_slts,
    'hold_age_days', settings.hold_age_days,
    'location_note_age_days', settings.location_note_age_days,
    'updated_by', settings.updated_by,
    'updated_at', settings.updated_at
  );
end;
$$;

revoke all on function private.set_eval_report_settings_internal(numeric, integer, integer) from public, anon;
grant execute on function private.set_eval_report_settings_internal(numeric, integer, integer) to authenticated;

create or replace function public.set_eval_report_settings(
  low_stock_max_slts numeric,
  hold_age_days integer,
  location_note_age_days integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.can_manage_eval_assignments() then
    raise exception using errcode = '42501', message = 'EVAL_REPORT_SETTINGS_FORBIDDEN';
  end if;

  return private.set_eval_report_settings_internal(
    low_stock_max_slts,
    hold_age_days,
    location_note_age_days
  );
end;
$$;

revoke all on function public.set_eval_report_settings(numeric, integer, integer) from public, anon;
grant execute on function public.set_eval_report_settings(numeric, integer, integer) to authenticated;

comment on function private.set_eval_report_settings_internal(numeric, integer, integer) is
  'Non-exposed, manager-checked writer used by the security-invoker Eval Report settings RPC.';
comment on function public.set_eval_report_settings(numeric, integer, integer) is
  'Security-invoker RPC that validates manager access before delegating the protected settings write.';
