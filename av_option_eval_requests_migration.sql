create extension if not exists pgcrypto;

create table if not exists public.ph_av_option_eval_requests (
  id uuid primary key default gen_random_uuid(),
  unique_id text generated always as (id::text) stored,
  status text not null default 'open',
  assignedto text not null,
  instructions text not null,
  selected_row_snapshot jsonb not null default '{}'::jsonb,
  original_row_snapshot jsonb not null default '{}'::jsonb,
  itemcode text,
  commonname text,
  contsize text,
  locationcode text,
  lotcode text,
  priority text,
  ptronhand numeric,
  ptravailable numeric,
  s_lts numeric,
  source text,
  selected_photo_link text,
  selected_photo_name text,
  selected_spec text,
  selected_caliper text,
  selected_av_note text,
  original_itemcode text,
  original_commonname text,
  original_contsize text,
  original_locationcode text,
  original_lotcode text,
  original_priority text,
  original_ptronhand numeric,
  original_ptravailable numeric,
  original_s_lts numeric,
  original_source text,
  original_photo_link text,
  original_photo_name text,
  original_spec text,
  original_caliper text,
  original_av_note text,
  result_photo_link text,
  result_photo_name text,
  result_spec text,
  result_caliper text,
  result_loc_match_percent numeric,
  result_pick_note text,
  result_comments text,
  result_av_note text,
  created_by text,
  created_by_display text,
  completed_by text,
  completed_by_display text,
  completed_at timestamptz,
  updated_by text,
  updated_by_display text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ph_av_option_eval_requests_status_check
    check (status in ('open', 'in_progress', 'complete', 'cancelled'))
);

create index if not exists ph_av_option_eval_requests_assigned_status_idx
  on public.ph_av_option_eval_requests (assignedto, status, created_at desc);
create index if not exists ph_av_option_eval_requests_created_by_idx
  on public.ph_av_option_eval_requests (created_by, created_at desc);
create index if not exists ph_av_option_eval_requests_itemcode_idx
  on public.ph_av_option_eval_requests (itemcode, created_at desc);
create index if not exists ph_av_option_eval_requests_status_idx
  on public.ph_av_option_eval_requests (status, created_at desc);

create or replace function public.ph_touch_av_option_eval_requests_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ph_touch_av_option_eval_requests_updated_at
  on public.ph_av_option_eval_requests;
create trigger ph_touch_av_option_eval_requests_updated_at
before update on public.ph_av_option_eval_requests
for each row
execute function public.ph_touch_av_option_eval_requests_updated_at();

alter table public.ph_av_option_eval_requests enable row level security;

drop policy if exists "Service role manages AV option eval requests"
  on public.ph_av_option_eval_requests;
create policy "Service role manages AV option eval requests"
on public.ph_av_option_eval_requests
for all
to service_role
using (true)
with check (true);

drop policy if exists "Authenticated users read their AV option eval requests"
  on public.ph_av_option_eval_requests;
create policy "Authenticated users read their AV option eval requests"
on public.ph_av_option_eval_requests
for select
to authenticated
using (
  lower(coalesce(auth.jwt() ->> 'username', auth.jwt() ->> 'preferred_username', auth.jwt() ->> 'email', '')) in ('dylan_collyge', 'jd_jones', 'megan_kelly')
  or lower(assignedto) = lower(coalesce(auth.jwt() ->> 'username', auth.jwt() ->> 'preferred_username', auth.jwt() ->> 'email', ''))
  or lower(coalesce(created_by, '')) = lower(coalesce(auth.jwt() ->> 'username', auth.jwt() ->> 'preferred_username', auth.jwt() ->> 'email', ''))
);

drop policy if exists "Authenticated users create AV option eval requests"
  on public.ph_av_option_eval_requests;
create policy "Authenticated users create AV option eval requests"
on public.ph_av_option_eval_requests
for insert
to authenticated
with check (true);

drop policy if exists "Authenticated evaluators update AV option eval requests"
  on public.ph_av_option_eval_requests;
create policy "Authenticated evaluators update AV option eval requests"
on public.ph_av_option_eval_requests
for update
to authenticated
using (
  lower(coalesce(auth.jwt() ->> 'username', auth.jwt() ->> 'preferred_username', auth.jwt() ->> 'email', '')) in ('dylan_collyge', 'jd_jones', 'megan_kelly')
  or lower(assignedto) = lower(coalesce(auth.jwt() ->> 'username', auth.jwt() ->> 'preferred_username', auth.jwt() ->> 'email', ''))
)
with check (
  lower(coalesce(auth.jwt() ->> 'username', auth.jwt() ->> 'preferred_username', auth.jwt() ->> 'email', '')) in ('dylan_collyge', 'jd_jones', 'megan_kelly')
  or lower(assignedto) = lower(coalesce(auth.jwt() ->> 'username', auth.jwt() ->> 'preferred_username', auth.jwt() ->> 'email', ''))
);

grant select, insert, update on public.ph_av_option_eval_requests to authenticated;
grant select, insert, update, delete on public.ph_av_option_eval_requests to service_role;
