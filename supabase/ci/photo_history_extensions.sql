-- Disposable CI database only. Production already has this extension.
begin;

create extension if not exists pg_trgm with schema extensions;

-- Production-baseline relation read by refresh_photo_history_catalog_v1.
-- Keep the archive metadata service-only; the fixture contains no archive jobs.
create table if not exists public.ph_photo_archive_jobs (
  source_key text primary key,
  source_bucket text not null,
  source_path text not null,
  source_url text,
  source_size bigint,
  source_created_at timestamptz,
  master_unique_ids jsonb not null default '[]'::jsonb,
  invalid_reasons jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in (
      'pending', 'copied', 'verified', 'quarantined',
      'blocked_valid_reference', 'deleted', 'failed'
    )),
  drive_folder_id text,
  drive_file_id text,
  drive_file_name text,
  sha256 text,
  attempts integer not null default 0,
  first_ref_scan_at timestamptz,
  second_ref_scan_at timestamptz,
  copied_at timestamptz,
  verified_at timestamptz,
  quarantine_until timestamptz,
  deleted_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_bucket, source_path)
);

alter table public.ph_photo_archive_jobs enable row level security;
revoke all on table public.ph_photo_archive_jobs from public, anon, authenticated, service_role;
grant all on table public.ph_photo_archive_jobs to service_role;
drop policy if exists photo_archive_jobs_deny_browser on public.ph_photo_archive_jobs;
create policy photo_archive_jobs_deny_browser
  on public.ph_photo_archive_jobs as restrictive to anon, authenticated
  using (false) with check (false);

commit;
