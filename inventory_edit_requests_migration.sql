begin;

create extension if not exists pgcrypto;

create table if not exists public.v2_inventory_edit_requests (
  id text primary key,
  status text not null default 'Eval Update Needed',
  workflow_stage text not null default 'eval',
  stage text,
  previous_stage text,
  stage_before_terminal text,
  request_type text not null default 'inventory-edit',
  priority_flag boolean not null default false,
  inventory_edit_done boolean not null default false,
  inventory_edit_completed_by text,
  inventory_edit_completed_by_display text,
  inventory_edit_completed_at timestamptz,
  photo_data_done boolean not null default false,
  photo_data_completed_by text,
  photo_data_completed_by_display text,
  photo_data_completed_at timestamptz,
  source_unique_id text,
  master_unique_id text,
  source_view text,
  commonname text,
  contsize text,
  itemcode text,
  locationcode text,
  lotcode text,
  source text,
  ptravailable text,
  s_lts text,
  assignedto text,
  current_priority text,
  current_locationnote text,
  current_pulltagnotes text,
  current_holdstopcode text,
  current_holdreason text,
  requested jsonb not null default '{}'::jsonb,
  changes jsonb not null default '[]'::jsonb,
  snapshot jsonb not null default '{}'::jsonb,
  holdreason text,
  reason text,
  supervisor_note text,
  approved_qty text,
  jd_approved_qty text,
  approved_by text,
  approved_by_display text,
  approved_at timestamptz,
  sent_by text,
  sent_by_display text,
  sent_at timestamptz not null default now(),
  edited_by text,
  edited_by_display text,
  edited_at timestamptz,
  stage_updated_by text,
  stage_updated_by_display text,
  stage_updated_at timestamptz not null default now(),
  handled_by text,
  handled_by_display text,
  handled_at timestamptz,
  handler_note text,
  notification_stage text,
  notification_sent_at timestamptz,
  inventory_edit_live boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.v2_inventory_edit_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references public.v2_inventory_edit_requests(id) on delete cascade,
  event_type text not null,
  event_stage text,
  actor_username text,
  actor_display text,
  event_note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_v2_inventory_edit_requests_stage on public.v2_inventory_edit_requests (workflow_stage, stage_updated_at desc);
create index if not exists idx_v2_inventory_edit_requests_assignedto on public.v2_inventory_edit_requests (assignedto);
create index if not exists idx_v2_inventory_edit_requests_itemcode on public.v2_inventory_edit_requests (itemcode);
create index if not exists idx_v2_inventory_edit_requests_source_uid on public.v2_inventory_edit_requests (source_unique_id);
create index if not exists idx_v2_inventory_edit_requests_master_uid on public.v2_inventory_edit_requests (master_unique_id);
create index if not exists idx_v2_inventory_edit_requests_sent_at on public.v2_inventory_edit_requests (sent_at desc);
create index if not exists idx_v2_inventory_edit_request_events_request on public.v2_inventory_edit_request_events (request_id, created_at desc);

create or replace function public.set_v2_inventory_edit_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_v2_inventory_edit_requests_updated_at on public.v2_inventory_edit_requests;
create trigger trg_v2_inventory_edit_requests_updated_at
before update on public.v2_inventory_edit_requests
for each row execute function public.set_v2_inventory_edit_requests_updated_at();

alter table public.v2_inventory_edit_requests enable row level security;
alter table public.v2_inventory_edit_request_events enable row level security;

drop policy if exists "v2_inventory_edit_requests_select_all" on public.v2_inventory_edit_requests;
create policy "v2_inventory_edit_requests_select_all" on public.v2_inventory_edit_requests for select using (true);
drop policy if exists "v2_inventory_edit_requests_insert_all" on public.v2_inventory_edit_requests;
create policy "v2_inventory_edit_requests_insert_all" on public.v2_inventory_edit_requests for insert with check (true);
drop policy if exists "v2_inventory_edit_requests_update_all" on public.v2_inventory_edit_requests;
create policy "v2_inventory_edit_requests_update_all" on public.v2_inventory_edit_requests for update using (true) with check (true);
drop policy if exists "v2_inventory_edit_requests_delete_all" on public.v2_inventory_edit_requests;
create policy "v2_inventory_edit_requests_delete_all" on public.v2_inventory_edit_requests for delete using (true);

drop policy if exists "v2_inventory_edit_request_events_select_all" on public.v2_inventory_edit_request_events;
create policy "v2_inventory_edit_request_events_select_all" on public.v2_inventory_edit_request_events for select using (true);
drop policy if exists "v2_inventory_edit_request_events_insert_all" on public.v2_inventory_edit_request_events;
create policy "v2_inventory_edit_request_events_insert_all" on public.v2_inventory_edit_request_events for insert with check (true);
drop policy if exists "v2_inventory_edit_request_events_update_all" on public.v2_inventory_edit_request_events;
create policy "v2_inventory_edit_request_events_update_all" on public.v2_inventory_edit_request_events for update using (true) with check (true);
drop policy if exists "v2_inventory_edit_request_events_delete_all" on public.v2_inventory_edit_request_events;
create policy "v2_inventory_edit_request_events_delete_all" on public.v2_inventory_edit_request_events for delete using (true);

commit;
