-- Marketing material exports for the Advertisement editor.
-- Run this once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.marketing_materials (
  unique_id text primary key,
  title text,
  format text not null default 'png',
  image_url text,
  image_path text,
  design_json jsonb not null default '{}'::jsonb,
  created_by_username text,
  created_by_display text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_marketing_materials_created_at
  on public.marketing_materials (created_at desc);

create index if not exists idx_marketing_materials_created_by
  on public.marketing_materials (created_by_username);

create or replace function public.v2_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_marketing_materials_updated_at on public.marketing_materials;
create trigger trg_marketing_materials_updated_at
before update on public.marketing_materials
for each row
execute function public.v2_touch_updated_at();

alter table public.marketing_materials enable row level security;

drop policy if exists "Allow app access to marketing materials" on public.marketing_materials;
create policy "Allow app access to marketing materials"
  on public.marketing_materials
  for all
  using (true)
  with check (true);

insert into storage.buckets (id, name, public)
values ('marketing_materials', 'marketing_materials', true)
on conflict (id) do update
set public = true;

drop policy if exists "Allow marketing material public reads" on storage.objects;
create policy "Allow marketing material public reads"
  on storage.objects
  for select
  using (bucket_id = 'marketing_materials');

drop policy if exists "Allow marketing material uploads" on storage.objects;
create policy "Allow marketing material uploads"
  on storage.objects
  for insert
  with check (bucket_id = 'marketing_materials');

drop policy if exists "Allow marketing material updates" on storage.objects;
create policy "Allow marketing material updates"
  on storage.objects
  for update
  using (bucket_id = 'marketing_materials')
  with check (bucket_id = 'marketing_materials');

alter table public.marketing_materials replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.marketing_materials;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
