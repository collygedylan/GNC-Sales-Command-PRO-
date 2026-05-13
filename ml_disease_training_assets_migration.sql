-- Disease and lab-report asset mirror for the GNC ML pipeline.
-- Run once in the Supabase SQL Editor before syncing disease folders from Google Drive.

create extension if not exists pgcrypto;

create table if not exists public.v2_disease_training_assets (
  unique_id text primary key,
  drive_file_id text not null unique,
  drive_parent_id text,
  drive_path text,
  folder_path text,
  label text,
  asset_kind text not null default 'diagnostic_photo',
  bucket text not null default 'disease_training_assets',
  storage_path text not null,
  public_url text,
  mime_type text,
  file_name text,
  file_size bigint,
  checksum text,
  processed_status text not null default 'pending_ml',
  diagnosis text,
  recommended_treatment text,
  confidence numeric,
  worker_id text,
  attempts integer not null default 0,
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint v2_disease_training_assets_kind_check
    check (asset_kind in ('diagnostic_photo', 'lab_report', 'other')),
  constraint v2_disease_training_assets_status_check
    check (processed_status in ('pending_ml', 'processing', 'processed', 'failed', 'ignored'))
);

create index if not exists idx_v2_disease_training_assets_status
  on public.v2_disease_training_assets (processed_status, updated_at desc);

create index if not exists idx_v2_disease_training_assets_label
  on public.v2_disease_training_assets (label);

create index if not exists idx_v2_disease_training_assets_folder
  on public.v2_disease_training_assets (folder_path);

create index if not exists idx_v2_disease_training_assets_created_at
  on public.v2_disease_training_assets (created_at desc);

create or replace function public.v2_touch_disease_training_assets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_v2_disease_training_assets_updated_at on public.v2_disease_training_assets;
create trigger trg_v2_disease_training_assets_updated_at
before update on public.v2_disease_training_assets
for each row
execute function public.v2_touch_disease_training_assets_updated_at();

alter table public.v2_disease_training_assets enable row level security;

drop policy if exists "Allow app read disease training assets" on public.v2_disease_training_assets;
create policy "Allow app read disease training assets"
  on public.v2_disease_training_assets
  for select
  using (true);

drop policy if exists "Allow app write disease training assets" on public.v2_disease_training_assets;
create policy "Allow app write disease training assets"
  on public.v2_disease_training_assets
  for all
  using (true)
  with check (true);

insert into storage.buckets (id, name, public)
values ('disease_training_assets', 'disease_training_assets', true)
on conflict (id) do update
set public = true;

drop policy if exists "Allow disease training asset public reads" on storage.objects;
create policy "Allow disease training asset public reads"
  on storage.objects
  for select
  using (bucket_id = 'disease_training_assets');

drop policy if exists "Allow disease training asset uploads" on storage.objects;
create policy "Allow disease training asset uploads"
  on storage.objects
  for insert
  with check (bucket_id = 'disease_training_assets');

drop policy if exists "Allow disease training asset updates" on storage.objects;
create policy "Allow disease training asset updates"
  on storage.objects
  for update
  using (bucket_id = 'disease_training_assets')
  with check (bucket_id = 'disease_training_assets');

alter table public.v2_disease_training_assets replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.v2_disease_training_assets;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
