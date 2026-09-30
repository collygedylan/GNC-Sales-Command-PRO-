create or replace function public.v2_refresh_hold_learning_from_drive_around_rows_range(
  p_start_date date default null,
  p_end_date date default null,
  p_limit integer default 200000
)
returns table(hold_events_upserted integer, release_cycles_upserted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot_rows integer := 0;
  v_cycle_rows integer := 0;
begin
  select fast.snapshot_rows, fast.itemcode_cycles
  into v_snapshot_rows, v_cycle_rows
  from public.ph_refresh_hold_stop_itemcode_cycles_fast(p_start_date, p_end_date) fast;

  hold_events_upserted := coalesce(v_snapshot_rows, 0);
  release_cycles_upserted := coalesce(v_cycle_rows, 0);
  return next;
end;
$$;

create or replace function public.v2_refresh_hold_learning_from_drive_around_rows(p_limit integer default 100000)
returns table(hold_events_upserted integer, release_cycles_upserted integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select *
  from public.v2_refresh_hold_learning_from_drive_around_rows_range(null, null, p_limit);
end;
$$;

grant execute on function public.v2_refresh_hold_learning_from_drive_around_rows_range(date, date, integer) to service_role;
grant execute on function public.v2_refresh_hold_learning_from_drive_around_rows(integer) to service_role;
