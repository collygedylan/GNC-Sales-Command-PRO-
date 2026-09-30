-- PostgREST starts the authenticator's eight-second deadline before entering
-- PL/pgSQL. set_config() inside reconciliation cannot extend that active timer.
-- Function metadata lets PostgREST establish the bounded deadline beforehand.
-- Keep role-wide deadlines, import fences, lock timeouts and grants unchanged.
alter function public.reconcile_season_sales_office_v1(text[], boolean, text, text)
  set statement_timeout = '60s';

notify pgrst, 'reload schema';
