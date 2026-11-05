BEGIN;
SET LOCAL lock_timeout='1200ms';
SET LOCAL statement_timeout='5s';
-- Only change queue membership. Current SOC data, inventory evidence, genuine
-- tag closures, mapped evaluator ownership, and caller permissions are retained.
DO $membership$
DECLARE prior text:=pg_get_viewdef('public.ph_active_suspend'::regclass,true);
BEGIN
 IF position(') workbook_suspend' in prior)=0 THEN
  EXECUTE 'CREATE OR REPLACE VIEW public.ph_active_suspend WITH (security_invoker=true) AS SELECT workbook_suspend.* FROM ('
   || regexp_replace(prior,';[[:space:]]*$','') || ') workbook_suspend WHERE '
   || 'upper(btrim(coalesce(workbook_suspend.suspend,''''))) IN (''SUSPEND'',''SUSPENDED'') '
   || 'AND lower(btrim(coalesce(workbook_suspend.suspend_to,'''')))=''dc'' '
   || 'AND lower(btrim(coalesce(workbook_suspend.suspend_candidate_state,''''))) NOT IN (''approved'',''rejected'',''replaced'',''denied'',''canceled'',''cancelled'') '
   || 'AND NOT workbook_suspend.suspend_completed '
   || 'AND lower(btrim(coalesce(workbook_suspend.status,''''))) NOT IN (''complete'',''completed'',''deleted'')';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.ph_active_suspend'::regclass AND reloptions @> ARRAY['security_invoker=true']) THEN
  RAISE EXCEPTION 'SUSPEND_INVOKER_REQUIRED';
 END IF;
END $membership$;
COMMIT;
