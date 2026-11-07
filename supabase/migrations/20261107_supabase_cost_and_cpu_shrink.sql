-- AgData cost/CPU remediation. INSTALLATION ONLY; no business rows are deleted here.
-- Confirm the project in the Dashboard before running. Prepared against AgData's
-- kzrnyjsosryejjejliii schema; the ref supplied in the request was different.
-- The observed database was 30.55 GB. Protected Drive Around history alone was
-- 14.64 GB. This migration cannot honestly promise <8 GB or <20% CPU.
-- Never change the evaluation protection / completed-request publication triggers.

SELECT n.nspname AS schema_name, c.relname AS table_name,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       pg_total_relation_size(c.oid) AS total_bytes,
       pg_size_pretty(pg_indexes_size(c.oid)) AS indexes,
       pg_size_pretty(pg_table_size(c.oid)) AS heap_and_toast
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind IN ('r','m') AND n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 20;
SELECT schemaname,relname,indexrelname,pg_size_pretty(pg_relation_size(indexrelid)) AS size,
       idx_scan,pg_get_indexdef(indexrelid) AS definition
FROM pg_stat_user_indexes ORDER BY pg_relation_size(indexrelid) DESC LIMIT 20;

CREATE OR REPLACE FUNCTION private.prune_supabase_transients_20261107(p_apply boolean DEFAULT false, p_limit integer DEFAULT 2000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE target record; fk record; candidates text; guards text := ''; affected bigint;
        results jsonb := '{}'::jsonb; batch_size integer := greatest(1,least(coalesce(p_limit,2000),5000));
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('agdata-cost-cleanup-20261107')) THEN
    RETURN jsonb_build_object('busy',true,'applied',false);
  END IF;
  -- These are transient notifications / completed cron logs, never source data.
  -- Resolved-only retention deliberately preserves all open watchdog incidents.
  FOR target IN SELECT * FROM (VALUES
    ('public.ph_app_live_events','created_at < now()-interval ''14 days''','created_at'),
    ('cron.job_run_details','end_time < now()-interval ''14 days'' AND status IN (''succeeded'',''failed'')','end_time'),
    ('public.app_runtime_watchdog_events','status = ''resolved'' AND last_seen_at < now()-interval ''14 days''','last_seen_at')
  ) v(table_name,predicate,order_column) LOOP
    IF to_regclass(target.table_name) IS NULL THEN CONTINUE; END IF;
    -- Unknown FK consumers make a transient table ineligible until reviewed.
    IF EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid=to_regclass(target.table_name)) THEN
      results := results || jsonb_build_object(target.table_name,jsonb_build_object('skipped','referenced table')); CONTINUE;
    END IF;
    candidates := format('SELECT ctid FROM %s WHERE %s ORDER BY %I LIMIT %s FOR UPDATE SKIP LOCKED',
      to_regclass(target.table_name),target.predicate,target.order_column,batch_size);
    IF p_apply THEN
      EXECUTE format('WITH old AS (%s) DELETE FROM %s t USING old WHERE t.ctid=old.ctid',candidates,to_regclass(target.table_name));
      GET DIAGNOSTICS affected = ROW_COUNT;
    ELSE
      EXECUTE format('SELECT count(*) FROM (%s) s',replace(candidates,' FOR UPDATE SKIP LOCKED','')) INTO affected;
    END IF;
    results := results || jsonb_build_object(target.table_name,affected);
  END LOOP;

  -- Preserve every stage header and publication receipt. Only disposable rows
  -- of old committed stages qualify; no cleanup while ANY ERP job is active.
  IF to_regclass('private.fast_erp_stage_rows_v1') IS NOT NULL
     AND NOT EXISTS(SELECT 1 FROM private.erp_sync_jobs WHERE active OR request_lease_until > now()) THEN
    candidates := format($q$SELECT r.ctid FROM private.fast_erp_stage_rows_v1 r
      JOIN private.fast_erp_stage_runs_v1 s USING(stage_id)
      WHERE s.stage_state='committed' AND s.expires_at < now()-interval '14 days'
      AND (s.committed_result->>'ok'='true' OR s.committed_result->>'committed'='true')
      ORDER BY s.expires_at,r.row_ordinal LIMIT %s FOR UPDATE OF r,s SKIP LOCKED$q$,batch_size);
    IF p_apply THEN
      EXECUTE 'WITH old AS ('||candidates||') DELETE FROM private.fast_erp_stage_rows_v1 r USING old WHERE r.ctid=old.ctid';
      GET DIAGNOSTICS affected = ROW_COUNT;
    ELSE
      EXECUTE 'SELECT count(*) FROM ('||replace(candidates,' FOR UPDATE OF r,s SKIP LOCKED','')||') s' INTO affected;
    END IF;
    results := results || jsonb_build_object('private.fast_erp_stage_rows_v1',affected);
  ELSE results := results || jsonb_build_object('private.fast_erp_stage_rows_v1','skipped: active job/lease or unavailable'); END IF;

  -- Delivered non-request notifications only. Request IDs, active leases,
  -- all relational receipts and JSON dependencyEventKeys remain authoritative.
  -- Do not remove the row/event_key: it is the permanent idempotency receipt.
  -- Discard only delivered email bodies/attachments; retain routing and dependencies.
  FOR fk IN SELECT ns.nspname,t.relname,a.attname FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=c.conkey[1]
    WHERE c.contype='f' AND c.confrelid='public.ph_request_delivery_outbox'::regclass
  LOOP
    guards := guards || format(' AND NOT EXISTS(SELECT 1 FROM %I.%I r WHERE r.%I=o.event_id)',fk.nspname,fk.relname,fk.attname);
  END LOOP;
  candidates := format($q$SELECT o.event_id FROM public.ph_request_delivery_outbox o
    WHERE o.status='delivered' AND o.delivered_at<now()-interval '14 days'
    AND nullif(o.request_id,'') IS NULL AND (o.lease_expires_at IS NULL OR o.lease_expires_at<now())
    AND o.payload ?| ARRAY['htmlBody','textBody','attachments','inlineImages']
    AND NOT EXISTS(SELECT 1 FROM public.ph_request_delivery_outbox d
      WHERE d.event_id<>o.event_id AND coalesce(d.payload->'dependencyEventKeys','[]'::jsonb) ? o.event_key)
    %s ORDER BY o.delivered_at LIMIT %s FOR UPDATE OF o SKIP LOCKED$q$,guards,batch_size);
  IF p_apply THEN
    EXECUTE 'WITH old AS ('||candidates||') UPDATE public.ph_request_delivery_outbox o SET payload=o.payload-ARRAY[''htmlBody'',''textBody'',''attachments'',''inlineImages''] FROM old WHERE o.event_id=old.event_id';
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSE EXECUTE 'SELECT count(*) FROM ('||replace(candidates,' FOR UPDATE OF o SKIP LOCKED','')||') s' INTO affected; END IF;
  RETURN results || jsonb_build_object('delivered_outbox_bodies',affected,'applied',p_apply,'batch_limit_per_table',batch_size);
END $fn$;
REVOKE ALL ON FUNCTION private.prune_supabase_transients_20261107(boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.prune_supabase_transients_20261107(boolean,integer) TO service_role;

-- Only the inspected policy is rewritten. Preserve roles/command and exactly the
-- same enabled-profile predicate; no generic regex rewriting of security policies.
DO $policy$
DECLARE existing text;
BEGIN
  SELECT qual INTO existing FROM pg_policies WHERE schemaname='public' AND tablename='user_access' AND policyname='user_access_active_read_v23119';
  IF existing IS NOT NULL AND existing NOT LIKE '%SELECT auth.uid()%' THEN
    IF regexp_replace(existing,'\s','','g') <> regexp_replace('(EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.disabled_at IS NULL) AND (NOT p.must_change_password))))','\s','','g') THEN
      RAISE EXCEPTION 'Policy differs from inspected contract; review before changing';
    END IF;
    ALTER POLICY user_access_active_read_v23119 ON public.user_access USING (
      EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.disabled_at IS NULL AND NOT p.must_change_password));
  END IF;
END $policy$;
ALTER ROLE authenticator SET log_statement='none';

-- REVIEW OUTPUT. Run each emitted CREATE INDEX CONCURRENTLY separately, outside
-- BEGIN/COMMIT and outside migration transaction wrappers. Existing valid B-tree
-- prefixes suppress duplicates. No speculative indexes on multi-million-row history.
WITH candidates(table_name,index_name,columns) AS (VALUES
 ('public.ph_request_delivery_outbox','idx_cost_outbox_status_delivered_20261107',ARRAY['status','delivered_at']),
 ('private.fast_erp_stage_runs_v1','idx_cost_stage_state_expiry_20261107',ARRAY['stage_state','expires_at']),
 ('public.app_runtime_watchdog_events','idx_cost_watchdog_status_seen_20261107',ARRAY['status','last_seen_at'])
)
SELECT format('CREATE INDEX CONCURRENTLY IF NOT EXISTS %I ON %s (%s);',index_name,to_regclass(table_name),
  (SELECT string_agg(quote_ident(x),', ') FROM unnest(columns) x)) AS optional_index_command
FROM candidates c WHERE to_regclass(table_name) IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_am am ON am.oid=ic.relam
 WHERE i.indrelid=to_regclass(c.table_name) AND i.indisvalid AND i.indpred IS NULL AND am.amname='btree'
 AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality)
      FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
      WHERE k.ordinality<=cardinality(c.columns))=c.columns);

-- Further policy review only (auth.jwt() may require a different scalar expression).
SELECT schemaname,tablename,policyname,qual,with_check FROM pg_policies
WHERE coalesce(qual,'') ~ 'auth\.(uid|jwt)\(' OR coalesce(with_check,'') ~ 'auth\.(uid|jwt)\(';
SELECT private.prune_supabase_transients_20261107(false,2000) AS preview_only;
-- Live inventory, completed requests, evaluations, photos, permissions, suspend,
-- reclass, raw import history and all historical analytics are deliberately untouched.
