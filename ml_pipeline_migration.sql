-- Agricultural AI pipeline tables and storage.
-- Run once in the Supabase SQL Editor before enabling AI Capture in production.

create extension if not exists pgcrypto;

create table if not exists public.v2_ml_image_jobs (
  unique_id text primary key,
  status text not null default 'pending_ml',
  image_bucket text not null default 'ml_capture_photos',
  image_path text not null,
  image_url text,
  source_table text,
  source_unique_id text,
  season text,
  block text,
  itemcode text,
  genus text,
  common_name text,
  contsize text,
  locationcode text,
  lotcode text,
  ptravailable numeric,
  ml_genus text,
  ml_common_name text,
  ml_grade_raw text,
  ml_grade text,
  ml_confidence numeric,
  matched_inventory_key text,
  diagnosis text,
  recommended_treatment text,
  manual_review boolean not null default false,
  approved_s1 numeric not null default 0,
  approved_f1 numeric not null default 0,
  approved_u1 numeric not null default 0,
  approved_u2 numeric not null default 0,
  approved_u3 numeric not null default 0,
  approved_x numeric not null default 0,
  approved_by_username text,
  approved_by_display text,
  approved_at timestamptz,
  worker_id text,
  attempts integer not null default 0,
  processing_started_at timestamptz,
  ml_completed_at timestamptz,
  last_error text,
  created_by_username text,
  created_by_display text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint v2_ml_image_jobs_status_check
    check (status in ('pending_ml', 'processing', 'pending_approval', 'approved', 'ml_failed'))
);

create index if not exists idx_v2_ml_image_jobs_status
  on public.v2_ml_image_jobs (status, updated_at desc);

create index if not exists idx_v2_ml_image_jobs_created_at
  on public.v2_ml_image_jobs (created_at desc);

create index if not exists idx_v2_ml_image_jobs_created_by
  on public.v2_ml_image_jobs (created_by_username);

create index if not exists idx_v2_ml_image_jobs_source
  on public.v2_ml_image_jobs (source_table, source_unique_id);

create index if not exists idx_v2_ml_image_jobs_block
  on public.v2_ml_image_jobs (block);

create or replace function public.v2_touch_ml_image_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_v2_ml_image_jobs_updated_at on public.v2_ml_image_jobs;
create trigger trg_v2_ml_image_jobs_updated_at
before update on public.v2_ml_image_jobs
for each row
execute function public.v2_touch_ml_image_jobs_updated_at();

alter table public.v2_ml_image_jobs enable row level security;

drop policy if exists "Allow app read ml image jobs" on public.v2_ml_image_jobs;
create policy "Allow app read ml image jobs"
  on public.v2_ml_image_jobs
  for select
  using (true);

drop policy if exists "Allow app write ml image jobs" on public.v2_ml_image_jobs;
create policy "Allow app write ml image jobs"
  on public.v2_ml_image_jobs
  for all
  using (true)
  with check (true);

insert into storage.buckets (id, name, public)
values ('ml_capture_photos', 'ml_capture_photos', true)
on conflict (id) do update
set public = true;

drop policy if exists "Allow ml capture photo public reads" on storage.objects;
create policy "Allow ml capture photo public reads"
  on storage.objects
  for select
  using (bucket_id = 'ml_capture_photos');

drop policy if exists "Allow ml capture photo uploads" on storage.objects;
create policy "Allow ml capture photo uploads"
  on storage.objects
  for insert
  with check (bucket_id = 'ml_capture_photos');

drop policy if exists "Allow ml capture photo updates" on storage.objects;
create policy "Allow ml capture photo updates"
  on storage.objects
  for update
  using (bucket_id = 'ml_capture_photos')
  with check (bucket_id = 'ml_capture_photos');

alter table public.v2_ml_image_jobs replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.v2_ml_image_jobs;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
