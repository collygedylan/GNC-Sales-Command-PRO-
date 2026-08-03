-- Superseded by 20260803042441_weather_hold_risk_fast_refresh_weather_columns.sql.
-- Production received an intermediate version of the fast refresh function here,
-- then immediately replaced it with the corrected weather column names. A tiny
-- placeholder keeps fresh database replays valid until the corrected migration
-- replaces it.
create or replace function public.ph_refresh_hold_stop_itemcode_cycles_fast(
  p_start_date date default null,
  p_end_date date default null
)
returns table(snapshot_rows integer, itemcode_cycles integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  snapshot_rows := 0;
  itemcode_cycles := 0;
  return next;
end;
$$;

revoke all on function public.ph_refresh_hold_stop_itemcode_cycles_fast(date, date) from public, anon, authenticated;
grant execute on function public.ph_refresh_hold_stop_itemcode_cycles_fast(date, date) to service_role;
