-- Request and Flyer folder history tables
-- Keeps folder rows and photo references available after rows leave active/pending queues.

create table if not exists public.v2_request_history (
    unique_id text primary key,
    master_id text,
    master_unique_id text,
    source_table text default 'v2_active_request',
    request_folder text not null default 'Unassigned',
    request_customer text,
    requested_by text,
    req_status text default 'Pending',
    req_archived boolean default false,
    req_rep_action text,
    req_qty text,
    req_reserve text,
    req_match text,
    req_spec text,
    req_caliper text,
    req_pic_note text,
    req_comments text,
    av_note text,
    date_completed timestamptz,
    itemcode text,
    commonname text,
    contsize text,
    locationcode text,
    lotcode text,
    priority text,
    ptravailable text,
    s_lts text,
    holdstopcode text,
    season text,
    photo_link text,
    photo_name text,
    completed_by_username text,
    completed_by_display text,
    completed_by_email text,
    snapshot jsonb not null default '{}'::jsonb,
    last_event text,
    created_by_username text,
    created_by_display text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_v2_request_history_folder on public.v2_request_history (request_folder);
create index if not exists idx_v2_request_history_requested_by on public.v2_request_history (requested_by);
create index if not exists idx_v2_request_history_completed_by_username on public.v2_request_history (completed_by_username);
create index if not exists idx_v2_request_history_updated_at on public.v2_request_history (updated_at desc);
create index if not exists idx_v2_request_history_date_completed on public.v2_request_history (date_completed desc);

alter table public.v2_request_history enable row level security;

drop policy if exists "Allow app read request history" on public.v2_request_history;
create policy "Allow app read request history"
on public.v2_request_history
for select
using (true);

drop policy if exists "Allow app write request history" on public.v2_request_history;
create policy "Allow app write request history"
on public.v2_request_history
for all
using (true)
with check (true);

create table if not exists public.v2_flyer_folder_history (
    unique_id text primary key,
    master_unique_id text,
    source_table text default 'v2_master_inventory',
    flyer_title text not null default 'Unassigned',
    folder_name text,
    folder_tab text not null default 'active',
    history_state text not null default 'active',
    flyer_assigned text,
    flyer_cat text,
    flyer_inst text,
    flyer_notes text,
    flyer_completed timestamptz,
    assignedto text,
    date_completed timestamptz,
    itemcode text,
    commonname text,
    contsize text,
    locationcode text,
    lotcode text,
    priority text,
    ptravailable text,
    s_lts text,
    holdstopcode text,
    plantgroupcode text,
    locationnote text,
    av_note text,
    match numeric,
    loc_match_qty numeric,
    spec text,
    caliper text,
    pick text,
    initial_ptr numeric,
    flyer_av_note text,
    flyer_match numeric,
    flyer_loc_match_qty numeric,
    flyer_spec text,
    flyer_caliper text,
    flyer_pick text,
    flyer_initial_ptr numeric,
    flyer_photo_link text,
    flyer_photo_name text,
    snapshot jsonb not null default '{}'::jsonb,
    last_event text,
    created_by_username text,
    created_by_display text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_v2_flyer_folder_history_folder on public.v2_flyer_folder_history (folder_name);
create index if not exists idx_v2_flyer_folder_history_tab on public.v2_flyer_folder_history (folder_tab);
create index if not exists idx_v2_flyer_folder_history_master on public.v2_flyer_folder_history (master_unique_id);
create index if not exists idx_v2_flyer_folder_history_updated_at on public.v2_flyer_folder_history (updated_at desc);

alter table public.v2_flyer_folder_history enable row level security;

drop policy if exists "Allow app read flyer folder history" on public.v2_flyer_folder_history;
create policy "Allow app read flyer folder history"
on public.v2_flyer_folder_history
for select
using (true);

drop policy if exists "Allow app write flyer folder history" on public.v2_flyer_folder_history;
create policy "Allow app write flyer folder history"
on public.v2_flyer_folder_history
for all
using (true)
with check (true);

create or replace function public.touch_history_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_touch_v2_request_history_updated_at on public.v2_request_history;
create trigger trg_touch_v2_request_history_updated_at
before update on public.v2_request_history
for each row
execute function public.touch_history_updated_at();

drop trigger if exists trg_touch_v2_flyer_folder_history_updated_at on public.v2_flyer_folder_history;
create trigger trg_touch_v2_flyer_folder_history_updated_at
before update on public.v2_flyer_folder_history
for each row
execute function public.touch_history_updated_at();

do $$
begin
    alter publication supabase_realtime add table public.v2_request_history;
exception
    when duplicate_object then null;
    when undefined_object then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.v2_flyer_folder_history;
exception
    when duplicate_object then null;
    when undefined_object then null;
end $$;
