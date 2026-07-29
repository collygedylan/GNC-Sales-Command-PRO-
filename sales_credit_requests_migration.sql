-- Sales rep customer credit requests
-- Keeps customer credit forms/photos tied to the same Sales Rep > Customer > Consignee request drill-down.

begin;

create table if not exists public.v2_sales_credit_requests (
  unique_id text primary key,
  request_unique_id text,
  request_folder text,
  requested_by text,
  salesrepname text,
  customername text,
  consigneename text,
  req_customer text,
  master_id text,
  master_unique_id text,
  itemcode text,
  commonname text,
  contsize text,
  locationcode text,
  lotcode text,
  priority text,
  req_qty text,
  credit_qty text,
  credit_reason text,
  credit_note text,
  credit_status text not null default 'pending',
  credit_photo_link text,
  credit_photo_name text,
  request_photo_link text,
  request_photo_name text,
  submitted_by_username text,
  submitted_by_display text,
  submitted_by_email text,
  submitted_at timestamptz not null default now(),
  reviewed_by_username text,
  reviewed_by_display text,
  reviewed_at timestamptz,
  review_note text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.v2_sales_credit_requests
  add column if not exists request_unique_id text,
  add column if not exists request_folder text,
  add column if not exists requested_by text,
  add column if not exists salesrepname text,
  add column if not exists customername text,
  add column if not exists consigneename text,
  add column if not exists req_customer text,
  add column if not exists master_id text,
  add column if not exists master_unique_id text,
  add column if not exists itemcode text,
  add column if not exists commonname text,
  add column if not exists contsize text,
  add column if not exists locationcode text,
  add column if not exists lotcode text,
  add column if not exists priority text,
  add column if not exists req_qty text,
  add column if not exists credit_qty text,
  add column if not exists credit_reason text,
  add column if not exists credit_note text,
  add column if not exists credit_status text not null default 'pending',
  add column if not exists credit_photo_link text,
  add column if not exists credit_photo_name text,
  add column if not exists request_photo_link text,
  add column if not exists request_photo_name text,
  add column if not exists submitted_by_username text,
  add column if not exists submitted_by_display text,
  add column if not exists submitted_by_email text,
  add column if not exists submitted_at timestamptz not null default now(),
  add column if not exists reviewed_by_username text,
  add column if not exists reviewed_by_display text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text,
  add column if not exists snapshot jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  alter table public.v2_sales_credit_requests
    add constraint v2_sales_credit_requests_status_check
    check (lower(coalesce(credit_status, 'pending')) in ('pending', 'approved', 'denied'));
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_v2_sales_credit_requests_request_uid
  on public.v2_sales_credit_requests (request_unique_id);

create index if not exists idx_v2_sales_credit_requests_folder
  on public.v2_sales_credit_requests (request_folder);

create index if not exists idx_v2_sales_credit_requests_rep_customer_consignee
  on public.v2_sales_credit_requests (requested_by, customername, consigneename);

create index if not exists idx_v2_sales_credit_requests_status
  on public.v2_sales_credit_requests (credit_status);

create index if not exists idx_v2_sales_credit_requests_updated_at
  on public.v2_sales_credit_requests (updated_at desc);

create or replace function public.touch_v2_sales_credit_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_v2_sales_credit_requests_updated_at
  on public.v2_sales_credit_requests;

create trigger trg_touch_v2_sales_credit_requests_updated_at
before update on public.v2_sales_credit_requests
for each row
execute function public.touch_v2_sales_credit_requests_updated_at();

alter table public.v2_sales_credit_requests enable row level security;

drop policy if exists "Allow app read sales credit requests"
  on public.v2_sales_credit_requests;
create policy "Allow app read sales credit requests"
  on public.v2_sales_credit_requests
  for select
  using (true);

drop policy if exists "Allow app write sales credit requests"
  on public.v2_sales_credit_requests;
create policy "Allow app write sales credit requests"
  on public.v2_sales_credit_requests
  for all
  using (true)
  with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'credit_photos',
  'credit_photos',
  true,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Allow credit photo public reads" on storage.objects;
create policy "Allow credit photo public reads"
  on storage.objects
  for select
  using (bucket_id = 'credit_photos');

drop policy if exists "Allow credit photo uploads" on storage.objects;
create policy "Allow credit photo uploads"
  on storage.objects
  for insert
  with check (bucket_id = 'credit_photos');

drop policy if exists "Allow credit photo updates" on storage.objects;
create policy "Allow credit photo updates"
  on storage.objects
  for update
  using (bucket_id = 'credit_photos')
  with check (bucket_id = 'credit_photos');

do $$
begin
  alter publication supabase_realtime add table public.v2_sales_credit_requests;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

grant select, insert, update, delete on public.v2_sales_credit_requests to anon, authenticated, service_role;

commit;
