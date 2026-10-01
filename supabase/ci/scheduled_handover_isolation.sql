-- Disposable release CI ONLY. Never copied to the production migration set.
-- Tests drive the worker explicitly; real wall-clock cron must not mutate
-- fixtures when this historical release is tested after its cutoff date.
update cron.job set active=false where jobname='scheduled_handover_kayla_nelly_20261002';
