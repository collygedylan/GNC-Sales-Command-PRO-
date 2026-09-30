-- Daily, verified Supabase Storage -> Google Drive photo archive lifecycle.
-- These tables are intentionally service-role only. The browser app has no access.

create table if not exists public.ph_photo_archive_runs (
  id uuid primary key default gen_random_uuid(),
  local_archive_date date not null unique,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  release text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  candidates_found integer not null default 0,
  copied_count integer not null default 0,
  verified_count integer not null default 0,
  deleted_count integer not null default 0,
  failed_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  error_code text,
  updated_at timestamptz not null default now()
);

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

create index if not exists ph_photo_archive_jobs_status_quarantine_idx
  on public.ph_photo_archive_jobs (status, quarantine_until)
  where status in ('verified', 'quarantined', 'blocked_valid_reference', 'failed');

alter table public.ph_photo_archive_runs enable row level security;
alter table public.ph_photo_archive_jobs enable row level security;

revoke all on table public.ph_photo_archive_runs from anon, authenticated;
revoke all on table public.ph_photo_archive_jobs from anon, authenticated;
grant select, insert, update on table public.ph_photo_archive_runs to service_role;
grant select, insert, update on table public.ph_photo_archive_jobs to service_role;

comment on table public.ph_photo_archive_runs is
  'Service-only audit trail for the daily 1:00 a.m. America/Chicago photo archive job.';
comment on table public.ph_photo_archive_jobs is
  'Service-only copy/verify/quarantine/delete lifecycle for expired master-row photos.';

