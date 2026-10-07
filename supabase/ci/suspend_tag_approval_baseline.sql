-- Disposable release replay only. Its older HL fixture creates a reduced SOC
-- table before the production-shaped handover fixture's CREATE IF NOT EXISTS.
-- Supply the existing production columns; this is not a production migration.
alter table public.ph_soc_master
  add column if not exists last_updated timestamptz default now(),
  add column if not exists date_completed timestamptz,
  add column if not exists suspend text,
  add column if not exists suspend_to text,
  add column if not exists dock_spec text,
  add column if not exists dock_caliper text,
  add column if not exists dock_note text,
  add column if not exists dock_photo_link text,
  add column if not exists dock_photo_name text,
  add column if not exists av_note text,
  add column if not exists match text,
  add column if not exists loc_match_qty text,
  add column if not exists initial_ptr text,
  add column if not exists holdstopcode text;
