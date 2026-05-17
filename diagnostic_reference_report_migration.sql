-- Diagnostic lab report reference fields.
-- Run once in Supabase SQL Editor before relying on lab-report tabs in the app.

alter table public.v2_disease_training_assets
  add column if not exists report_text text,
  add column if not exists report_rewrite text;

alter table public.v2_ml_image_jobs
  add column if not exists diagnostic_reference_asset_id text,
  add column if not exists diagnostic_reference_kind text,
  add column if not exists diagnostic_reference_file_name text,
  add column if not exists diagnostic_reference_public_url text,
  add column if not exists diagnostic_reference_label text,
  add column if not exists diagnostic_reference_score numeric,
  add column if not exists diagnostic_reference_report_text text,
  add column if not exists diagnostic_reference_report_rewrite text;

create index if not exists idx_v2_ml_image_jobs_diagnostic_reference
  on public.v2_ml_image_jobs (diagnostic_reference_asset_id);

create index if not exists idx_v2_disease_training_assets_report_lookup
  on public.v2_disease_training_assets (asset_kind, label);

-- Reprocess lab reports so the worker extracts readable text/rewrites from existing PDFs.
update public.v2_disease_training_assets
set processed_status = 'pending_ml',
    processing_started_at = null,
    worker_id = null,
    last_error = null
where asset_kind = 'lab_report'
  and coalesce(report_rewrite, '') = '';
