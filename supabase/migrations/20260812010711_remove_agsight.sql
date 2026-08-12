-- Remove the retired AgSight database surface.
-- Supabase Storage buckets and files are intentionally left untouched.

drop view if exists public.v2_ml_image_jobs;
drop view if exists public.v2_disease_training_assets;

drop table if exists public.ph_diagnostic_review_feedback cascade;
drop table if exists public.ph_diagnostic_reference_reports cascade;
drop table if exists public.ph_diagnostic_lab_cases cascade;
drop table if exists public.ph_disease_training_assets cascade;
drop table if exists public.ph_ml_image_jobs cascade;

notify pgrst, 'reload schema';
