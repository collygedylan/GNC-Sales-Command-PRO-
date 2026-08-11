alter table if exists public.ph_ml_image_jobs
  add column if not exists agsight_status text,
  add column if not exists agsight_score numeric,
  add column if not exists agsight_issue_type text,
  add column if not exists agsight_summary text,
  add column if not exists agsight_reference_asset_id text,
  add column if not exists agsight_reference_url text,
  add column if not exists agsight_checked_at timestamptz,
  add column if not exists agsight_review_status text;

alter table if exists public.ph_disease_training_assets
  add column if not exists agsight_status text,
  add column if not exists agsight_score numeric,
  add column if not exists agsight_issue_type text,
  add column if not exists agsight_summary text,
  add column if not exists agsight_checked_at timestamptz;

do $$
begin
  alter table public.ph_ml_image_jobs
    add constraint ph_ml_image_jobs_agsight_status_check
    check (
      agsight_status is null
      or agsight_status in ('clear', 'flagged', 'failed', 'reference_indexed')
    );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.ph_ml_image_jobs
    add constraint ph_ml_image_jobs_agsight_review_status_check
    check (
      agsight_review_status is null
      or agsight_review_status in ('not_required', 'unreviewed', 'reviewed', 'dismissed')
    );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.ph_disease_training_assets
    add constraint ph_disease_training_assets_agsight_status_check
    check (
      agsight_status is null
      or agsight_status in ('clear', 'flagged', 'failed', 'reference_indexed')
    );
exception
  when duplicate_object then null;
end $$;

create index if not exists ph_ml_image_jobs_agsight_status_idx
  on public.ph_ml_image_jobs (agsight_status)
  where agsight_status is not null;

create index if not exists ph_ml_image_jobs_agsight_review_status_idx
  on public.ph_ml_image_jobs (agsight_review_status)
  where agsight_review_status is not null;

create index if not exists ph_ml_image_jobs_agsight_issue_type_idx
  on public.ph_ml_image_jobs (agsight_issue_type)
  where agsight_issue_type is not null;

create index if not exists ph_ml_image_jobs_agsight_checked_at_idx
  on public.ph_ml_image_jobs (agsight_checked_at desc)
  where agsight_checked_at is not null;

create index if not exists ph_disease_training_assets_agsight_kind_status_idx
  on public.ph_disease_training_assets (asset_kind, agsight_status)
  where agsight_status is not null;

create or replace view public.v2_ml_image_jobs
with (security_invoker = true) as
select * from public.ph_ml_image_jobs;

create or replace view public.v2_disease_training_assets
with (security_invoker = true) as
select * from public.ph_disease_training_assets;

grant select, insert, update, delete on table public.v2_ml_image_jobs to authenticated;
grant all on table public.v2_ml_image_jobs to service_role;
grant select, insert, update, delete on table public.v2_disease_training_assets to authenticated;
grant all on table public.v2_disease_training_assets to service_role;

notify pgrst, 'reload schema';
