-- Live-read and quota-control support for the Queue tab.
-- This keeps completed request history in v2_active_request, while letting
-- the app poll only the rows that should still be visible in Queue.

create index if not exists idx_v2_active_request_live_rows_order
  on public.v2_active_request (unique_id desc)
  where req_archived is not true
    and nullif(btrim(coalesce(date_completed, '')), '') is null
    and coalesce(lower(nullif(btrim(req_status), '')), 'pending') not in (
      'complete',
      'completed',
      'done',
      'closed',
      'cancelled',
      'canceled',
      'removed'
    );

create index if not exists idx_v2_app_live_events_created_at
  on public.v2_app_live_events (created_at desc);

create or replace view public.v2_active_request_live_rows
with (security_invoker = true)
as
select *
from public.v2_active_request
where req_archived is not true
  and nullif(btrim(coalesce(date_completed, '')), '') is null
  and coalesce(lower(nullif(btrim(req_status), '')), 'pending') not in (
    'complete',
    'completed',
    'done',
    'closed',
    'cancelled',
    'canceled',
    'removed'
  );

grant select on public.v2_active_request_live_rows to anon, authenticated;

create or replace function public.prune_v2_app_live_events(retention_days integer default 3)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  delete from public.v2_app_live_events
  where created_at < now() - make_interval(days => greatest(coalesce(retention_days, 3), 1));

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.prune_v2_app_live_events(integer) to anon, authenticated;

-- Crop Roll navigation summaries. These let the app fetch location/size
-- counts separately from the full row detail list.

create or replace view public.v2_crop_roll_open_navigation_counts
with (security_invoker = true)
as
select
  crop_roll_view,
  blockalpha,
  locationcode,
  coalesce(nullif(btrim(contsize), ''), 'Unknown') as contsize,
  count(*)::bigint as row_count,
  count(distinct itemcode)::bigint as item_count,
  count(distinct lotcode)::bigint as lot_count,
  sum(nullif(regexp_replace(coalesce(ptravailable, ''), '[^0-9.-]', '', 'g'), '')::numeric) as ptravailable_total
from public.v2_crop_roll_open_rows
group by crop_roll_view, blockalpha, locationcode, coalesce(nullif(btrim(contsize), ''), 'Unknown');

grant select on public.v2_crop_roll_open_navigation_counts to anon, authenticated;

create or replace view public.v2_crop_roll_open_location_counts
with (security_invoker = true)
as
with location_counts as (
  select
    crop_roll_view,
    blockalpha,
    locationcode,
    count(*)::bigint as row_count,
    count(distinct itemcode)::bigint as item_count,
    count(distinct coalesce(nullif(btrim(contsize), ''), 'Unknown'))::bigint as size_count,
    count(distinct lotcode)::bigint as lot_count,
    sum(nullif(regexp_replace(coalesce(ptravailable, ''), '[^0-9.-]', '', 'g'), '')::numeric) as ptravailable_total
  from public.v2_crop_roll_open_rows
  group by crop_roll_view, blockalpha, locationcode
),
size_counts as (
  select
    crop_roll_view,
    blockalpha,
    locationcode,
    coalesce(nullif(btrim(contsize), ''), 'Unknown') as contsize,
    count(*)::bigint as row_count
  from public.v2_crop_roll_open_rows
  group by crop_roll_view, blockalpha, locationcode, coalesce(nullif(btrim(contsize), ''), 'Unknown')
)
select
  lc.crop_roll_view,
  lc.blockalpha,
  lc.locationcode,
  lc.row_count,
  lc.item_count,
  lc.size_count,
  lc.lot_count,
  lc.ptravailable_total,
  coalesce(jsonb_object_agg(sc.contsize, sc.row_count order by sc.contsize) filter (where sc.contsize is not null), '{}'::jsonb) as contsize_counts
from location_counts lc
left join size_counts sc
  on sc.crop_roll_view = lc.crop_roll_view
  and sc.blockalpha = lc.blockalpha
  and sc.locationcode = lc.locationcode
group by lc.crop_roll_view, lc.blockalpha, lc.locationcode, lc.row_count, lc.item_count, lc.size_count, lc.lot_count, lc.ptravailable_total;

grant select on public.v2_crop_roll_open_location_counts to anon, authenticated;
