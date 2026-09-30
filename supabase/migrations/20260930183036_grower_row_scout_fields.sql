alter table public.ph_grower_scout_reports
  add column source_inventory_uid text,
  add column lotcode text,
  add column pest_code text,
  add column sev_score smallint,
  add constraint ph_grower_scout_reports_sev_score_range
    check (sev_score is null or sev_score between 0 and 50);
