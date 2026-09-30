begin;

-- ph_sales_office.updated_at changes during routine reconciliation.  Keep the
-- original open/reopen transition separately so the Season Sales Notes card
-- can show when the work actually entered Sales Office.
alter table public.ph_sales_office
  add column if not exists arrived_at timestamptz;

comment on column public.ph_sales_office.arrived_at is
  'Immutable time the current Season Sales Notes winner entered the open Sales Office mirror.';

with latest_transition as (
  select distinct on (event.state_id, event.revision)
    event.state_id,
    event.revision,
    event.created_at
  from public.ph_season_sales_office_events event
  where event.event_type in ('opened', 'winner_changed', 'reopened')
  order by event.state_id, event.revision, event.created_at desc, event.id desc
)
update public.ph_sales_office sales
set arrived_at = coalesce(transition.created_at, state.created_at)
from public.ph_season_sales_office_state state
left join latest_transition transition
  on transition.state_id = state.id
 and transition.revision = state.revision
where lower(btrim(coalesce(sales.so_source, 'season'))) = 'season'
  and state.status = 'open'
  and state.winner_unique_id = coalesce(sales.master_id, sales.unique_id)
  and state.itemcode_normalized = upper(btrim(coalesce(sales.itemcode, '')))
  and sales.arrived_at is null;

create index if not exists ph_sales_office_season_arrived_at_idx
  on public.ph_sales_office (arrived_at desc)
  where lower(btrim(coalesce(so_source, 'season'))) = 'season';

create or replace function private.season_sales_mirror_winner_v1(
  p_winner public.ph_master_inventory,
  p_state public.ph_season_sales_office_state
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  arrival_time timestamptz;
begin
  select event.created_at
  into arrival_time
  from public.ph_season_sales_office_events event
  where event.state_id = p_state.id
    and event.revision = p_state.revision
    and event.event_type in ('opened', 'winner_changed', 'reopened')
  order by event.created_at desc, event.id desc
  limit 1;

  arrival_time := coalesce(
    arrival_time,
    case when p_state.revision = 1 then p_state.created_at else p_state.updated_at end,
    now()
  );

  delete from public.ph_sales_office sales
  where lower(btrim(coalesce(sales.so_source, 'season'))) = 'season'
    and upper(btrim(coalesce(sales.itemcode, ''))) = p_state.itemcode_normalized
    and coalesce(sales.master_id, sales.unique_id) <> p_winner.unique_id;

  insert into public.ph_sales_office as sales (
    unique_id, master_id, so_source, itemcode, commonname, contsize,
    locationcode, lotcode, ptravailable, priority, av_note, sales_note,
    spec, caliper, photo_link, photo_name, completed_by, completed_at,
    workflow_status, workflow_detail, state_revision, reopen_reason,
    source_revision, arrived_at, updated_at
  ) values (
    p_winner.unique_id, p_winner.unique_id, 'season', p_winner.itemcode,
    p_winner.commonname, p_winner.contsize, p_winner.locationcode,
    p_winner.lotcode, p_winner.ptravailable, p_winner.priority,
    p_winner.av_note, p_winner.sales_note, p_winner.spec, p_winner.caliper,
    p_winner.photo_link, p_winner.photo_name, null, null,
    p_state.readiness_status, p_state.current_evidence_snapshot,
    p_state.revision, p_state.reopen_reason, p_state.import_revision,
    arrival_time, now()
  )
  on conflict (unique_id) do update set
    master_id = excluded.master_id,
    so_source = excluded.so_source,
    itemcode = excluded.itemcode,
    commonname = excluded.commonname,
    contsize = excluded.contsize,
    locationcode = excluded.locationcode,
    lotcode = excluded.lotcode,
    ptravailable = excluded.ptravailable,
    priority = excluded.priority,
    av_note = excluded.av_note,
    sales_note = excluded.sales_note,
    spec = excluded.spec,
    caliper = excluded.caliper,
    photo_link = excluded.photo_link,
    photo_name = excluded.photo_name,
    completed_by = null,
    completed_at = null,
    workflow_status = excluded.workflow_status,
    workflow_detail = excluded.workflow_detail,
    state_revision = excluded.state_revision,
    reopen_reason = excluded.reopen_reason,
    source_revision = excluded.source_revision,
    arrived_at = coalesce(sales.arrived_at, excluded.arrived_at),
    updated_at = now();
end
$function$;

revoke all on function private.season_sales_mirror_winner_v1(
  public.ph_master_inventory,
  public.ph_season_sales_office_state
) from public, anon, authenticated;

commit;
