-- DO NOT RUN without a separate production approval after at least 14 days of
-- direct postgres_changes parity and a verified rollback backup.
-- RESTRICT intentionally stops this script if any dependency remains.
begin;

update public.ph_runtime_feature_flags
set enabled = false, rollout_percent = 0, updated_at = now()
where flag_key = 'legacy_live_events';

drop table public.ph_app_live_events restrict;

-- Replace this rollback with COMMIT only after the dependency report is empty,
-- Edge Function calls are down >=95%, and workflow update parity is proven.
rollback;
