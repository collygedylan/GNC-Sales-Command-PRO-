-- Repair request history upserts and backfill existing active request rows.
-- Run this after request_history_migration.sql if the live v2_request_history
-- table has an id primary key instead of unique_id as the primary key.

create unique index if not exists idx_v2_request_history_unique_id
  on public.v2_request_history (unique_id);

select setval(
  pg_get_serial_sequence('public.v2_request_history', 'id'),
  coalesce((select max(id) from public.v2_request_history), 0) + 1,
  false
)
where pg_get_serial_sequence('public.v2_request_history', 'id') is not null;

insert into public.v2_request_history (id, unique_id)
select nextval(pg_get_serial_sequence('public.v2_request_history', 'id')::regclass), ar.unique_id
from public.v2_active_request ar
where ar.unique_id is not null
  and btrim(ar.unique_id) <> ''
on conflict (unique_id) do nothing;

update public.v2_request_history h
set
  master_id = ar.master_id,
  master_unique_id = ar.master_id,
  source_table = 'v2_active_request',
  requested_by = ar.requested_by,
  request_folder = ar.request_folder,
  req_customer = ar.req_customer,
  request_customer = ar.req_customer,
  req_status = coalesce(nullif(ar.req_status, ''), 'Pending'),
  req_archived = coalesce(ar.req_archived, false),
  req_rep_action = ar.req_rep_action,
  req_qty = ar.req_qty,
  req_reserve = ar.req_reserve
from public.v2_active_request ar
where h.unique_id = ar.unique_id;

update public.v2_request_history h
set
  commonname = ar.commonname,
  contsize = ar.contsize,
  locationcode = ar.locationcode,
  lotcode = ar.lotcode,
  itemcode = ar.itemcode,
  ptravailable = ar.ptravailable,
  season_supply = ar.season_supply,
  priority = ar.priority,
  qualitycode = ar.qualitycode,
  field_tag_color = ar.field_tag_color,
  plantgroupcode = ar.plantgroupcode,
  req_match = ar.req_match::text,
  req_spec = ar.req_spec,
  req_caliper = ar.req_caliper,
  req_pic_note = ar.req_pic_note,
  req_comments = ar.req_comments,
  av_note = ar.av_note
from public.v2_active_request ar
where h.unique_id = ar.unique_id;

update public.v2_request_history h
set
  req_photo_link = ar.req_photo_link,
  req_photo_name = ar.req_photo_name,
  photo_link = ar.req_photo_link,
  photo_name = ar.req_photo_name,
  desired_spec = ar.desired_spec,
  desired_caliper = ar.desired_caliper,
  est_ship = ar.est_ship,
  date_completed = case
    when nullif(ar.date_completed, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
      then ar.date_completed::timestamptz
    else null
  end,
  snapshot = to_jsonb(ar),
  last_event = case
    when coalesce(nullif(ar.req_status, ''), 'Pending') = 'Complete'
      then 'backfill-completed'
    else 'backfill-active'
  end,
  completed_by_username = ar.completed_by_username,
  completed_by_display = ar.completed_by_display,
  completed_by_email = ar.completed_by_email
from public.v2_active_request ar
where h.unique_id = ar.unique_id;
