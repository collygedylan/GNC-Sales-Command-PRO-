begin;

-- The production pgcrypto extension is installed in `extensions`. The
-- lifecycle functions use an intentionally restricted search_path, so make
-- that trusted schema explicit for the already-installed function bodies.
alter function private.season_sales_evidence_v1(jsonb)
  set search_path = pg_catalog, extensions;
alter function public.reconcile_season_sales_office_v1(text[], boolean, text, text)
  set search_path = pg_catalog, extensions;
alter function public.save_season_sales_office_av_note_v1(text, text, integer, text, text)
  set search_path = pg_catalog, extensions;
alter function public.complete_season_sales_office_v1(text, text, integer, text)
  set search_path = pg_catalog, extensions;

commit;
