-- Diagnostic review feedback and lab-case workflow.
-- Run after ml_pipeline_migration.sql, ml_disease_training_assets_migration.sql,
-- disease_training_asset_filename_fields_migration.sql, and diagnostic_reference_report_migration.sql.

create extension if not exists pgcrypto;

alter table public.v2_ml_image_jobs
  add column if not exists diagnostic_review_decision text,
  add column if not exists diagnostic_reviewer_report text,
  add column if not exists diagnostic_reviewer_diagnosis text,
  add column if not exists diagnostic_reviewer_treatment text,
  add column if not exists diagnostic_reviewed_by_username text,
  add column if not exists diagnostic_reviewed_by_display text,
  add column if not exists diagnostic_reviewed_at timestamptz,
  add column if not exists diagnostic_lab_case_id text,
  add column if not exists diagnostic_lab_status text,
  add column if not exists diagnostic_lab_label_printed_at timestamptz,
  add column if not exists diagnostic_lab_report_bucket text,
  add column if not exists diagnostic_lab_report_path text,
  add column if not exists diagnostic_lab_report_url text,
  add column if not exists diagnostic_lab_report_uploaded_at timestamptz,
  add column if not exists diagnostic_lab_report_uploaded_by text,
  add column if not exists diagnostic_learning_scope text not null default 'genus_commonname_all_contsizes';

create index if not exists idx_v2_ml_image_jobs_diagnostic_review_decision
  on public.v2_ml_image_jobs (diagnostic_review_decision, updated_at desc);

create index if not exists idx_v2_ml_image_jobs_diagnostic_lab_case_id
  on public.v2_ml_image_jobs (diagnostic_lab_case_id);

create table if not exists public.v2_diagnostic_lab_cases (
  unique_id text primary key,
  ml_job_id text not null,
  case_label text not null,
  status text not null default 'pending_lab_report',
  source_table text,
  source_unique_id text,
  itemcode text,
  genus text,
  commonname text,
  contsize text,
  locationcode text,
  lotcode text,
  season text,
  block text,
  image_url text,
  photo_link text,
  model_diagnosis text,
  model_treatment text,
  model_confidence numeric,
  reviewer_report text,
  reviewer_diagnosis text,
  reviewer_treatment text,
  reviewer_username text,
  reviewer_display text,
  reviewed_at timestamptz,
  lab_report_bucket text,
  lab_report_path text,
  lab_report_url text,
  lab_report_uploaded_by text,
  lab_report_uploaded_at timestamptz,
  learning_scope text not null default 'genus_commonname_all_contsizes',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint v2_diagnostic_lab_cases_status_check
    check (status in ('pending_lab_report', 'lab_report_uploaded', 'learned', 'closed', 'cancelled'))
);

create index if not exists idx_v2_diagnostic_lab_cases_status
  on public.v2_diagnostic_lab_cases (status, updated_at desc);

create index if not exists idx_v2_diagnostic_lab_cases_ml_job_id
  on public.v2_diagnostic_lab_cases (ml_job_id);

create index if not exists idx_v2_diagnostic_lab_cases_common_lookup
  on public.v2_diagnostic_lab_cases (genus, commonname);

create or replace function public.v2_touch_diagnostic_lab_cases_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_v2_diagnostic_lab_cases_updated_at on public.v2_diagnostic_lab_cases;
create trigger trg_v2_diagnostic_lab_cases_updated_at
before update on public.v2_diagnostic_lab_cases
for each row
execute function public.v2_touch_diagnostic_lab_cases_updated_at();

alter table public.v2_diagnostic_lab_cases enable row level security;

drop policy if exists "Allow app read diagnostic lab cases" on public.v2_diagnostic_lab_cases;
create policy "Allow app read diagnostic lab cases"
  on public.v2_diagnostic_lab_cases
  for select
  using (true);

drop policy if exists "Allow app write diagnostic lab cases" on public.v2_diagnostic_lab_cases;
create policy "Allow app write diagnostic lab cases"
  on public.v2_diagnostic_lab_cases
  for all
  using (true)
  with check (true);

alter table public.v2_disease_training_assets
  add column if not exists genus text,
  add column if not exists source_ml_job_id text,
  add column if not exists lab_case_id text,
  add column if not exists reviewer_report text,
  add column if not exists reviewer_username text,
  add column if not exists reviewer_display text,
  add column if not exists review_decision text,
  add column if not exists learning_scope text not null default 'genus_commonname_all_contsizes';

alter table public.v2_disease_training_assets
  drop constraint if exists v2_disease_training_assets_kind_check;

alter table public.v2_disease_training_assets
  add constraint v2_disease_training_assets_kind_check
  check (asset_kind in ('diagnostic_photo', 'lab_report', 'lab_report_photo', 'review_feedback', 'other'));

create index if not exists idx_v2_disease_training_assets_genus_common
  on public.v2_disease_training_assets (genus, commonname);

create index if not exists idx_v2_disease_training_assets_lab_case
  on public.v2_disease_training_assets (lab_case_id);

insert into storage.buckets (id, name, public)
values ('diagnostic_lab_reports', 'diagnostic_lab_reports', true)
on conflict (id) do update
set public = true;

drop policy if exists "Allow diagnostic lab report public reads" on storage.objects;
create policy "Allow diagnostic lab report public reads"
  on storage.objects
  for select
  using (bucket_id = 'diagnostic_lab_reports');

drop policy if exists "Allow diagnostic lab report uploads" on storage.objects;
create policy "Allow diagnostic lab report uploads"
  on storage.objects
  for insert
  with check (bucket_id = 'diagnostic_lab_reports');

drop policy if exists "Allow diagnostic lab report updates" on storage.objects;
create policy "Allow diagnostic lab report updates"
  on storage.objects
  for update
  using (bucket_id = 'diagnostic_lab_reports')
  with check (bucket_id = 'diagnostic_lab_reports');

alter table public.v2_diagnostic_lab_cases replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.v2_diagnostic_lab_cases;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
