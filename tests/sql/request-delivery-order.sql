CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA private;
CREATE TABLE public.ph_request_delivery_outbox(event_id uuid PRIMARY KEY,event_key text UNIQUE,event_type text,request_folder text,payload jsonb,status text,delivered_at timestamptz,created_at timestamptz DEFAULT now(),lease_expires_at timestamptz,channel_results jsonb DEFAULT '{}');
CREATE TABLE public.ph_request_email_threads(id uuid PRIMARY KEY,request_folder text,initial_email_sent_at timestamptz,initial_thread_id text,initial_message_id text,metadata jsonb);
INSERT INTO public.ph_request_delivery_outbox(event_id,event_key,event_type,request_folder,payload,status,delivered_at,channel_results) VALUES
('7f0335e7-e798-49ed-8b6f-53b0364213f1','completion-one','request_completed','folder-one','{"contractVersion":"request-folder-completion-v2","dependencyEventKeys":["request-created:aa7fe2ee-4ae1-4975-bd5c-9c93262acdbb"]}','delivered',now()-interval '10 days','{"email":{"mode":"gmail_api_threaded","thread_id":"thread-one","reply_to_message_id":"message-one"}}'),
('b64c2bc5-d01a-4c6f-b344-767b33dcc0a0','completion-two','request_completed','folder-two','{"contractVersion":"request-folder-completion-v2","dependencyEventKeys":["request-created:c20a6c65-9bb4-4748-b2b1-2421ae423dde"]}','delivered',now()-interval '10 days','{"email":{"mode":"gmail_api_threaded","thread_id":"thread-two","reply_to_message_id":"message-two"}}');
INSERT INTO public.ph_request_email_threads VALUES
('00000000-0000-0000-0000-000000000001','folder-one',now()-interval '20 days','thread-one','message-one','{"delivery_event_id":"7f0335e7-e798-49ed-8b6f-53b0364213f1"}'),
('00000000-0000-0000-0000-000000000002','folder-two',now()-interval '20 days','thread-two','message-two','{"delivery_event_id":"b64c2bc5-d01a-4c6f-b344-767b33dcc0a0"}');
CREATE TEMP TABLE original_receipts AS SELECT event_id,to_jsonb(o) AS receipt FROM public.ph_request_delivery_outbox o;
CREATE FUNCTION public.get_eval_request_delivery_health_snapshot_v2() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE creation_order_violations bigint;
BEGIN
  IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='DELIVERY_HEALTH_FORBIDDEN'; END IF;
  select count(*) into creation_order_violations
  from public.ph_request_delivery_outbox completion
  where completion.event_type = 'request_completed'
    and completion.status = 'delivered'
    and completion.payload->>'contractVersion' = 'request-folder-completion-v2'
    and exists (
      select 1
      from jsonb_array_elements_text(coalesce(completion.payload->'dependencyEventKeys', '[]'::jsonb)) dependency(event_key)
      left join public.ph_request_delivery_outbox created on created.event_key = dependency.event_key
      where created.event_id is null or created.status <> 'delivered'
         or created.delivered_at is null or completion.delivered_at is null
         or created.delivered_at > completion.delivered_at
    );

  RETURN jsonb_build_object('contract_version','eval-request-delivery-health-v2','required_manager_recipient_count',2,'creation_order_violation_count',creation_order_violations,'completion_membership_mismatch_count',0,'missing_completion_event_count',0,'eval_origin_scope_mismatch_count',0,'eval_required_recipient_violation_count',0);
END $fn$;
create or replace function public.ph_prune_supabase_bloat_v1()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare affected bigint; results jsonb := '{}'::jsonb; fk record; guards text := ''; target text;
begin
  perform pg_advisory_xact_lock(hashtext('ph_prune_supabase_bloat_v1'));
  if to_regclass('cron.job_run_details') is not null then
    execute 'delete from cron.job_run_details where end_time < now() - interval ''3 days''';
    get diagnostics affected = row_count; results := results || jsonb_build_object('cron',affected);
  end if;
  -- Legacy run summaries are not the private resumable ERP jobs. Never fabricate success.
  if to_regclass('public.ph_erp_sync_runs') is not null then
    execute 'update public.ph_erp_sync_runs set status=''failed'' where status=''running'' and updated_at < now()-interval ''90 seconds''';
    execute 'delete from public.ph_erp_sync_runs where status in (''completed'',''complete'') and updated_at < now()-interval ''14 days'' and id not in (select id from public.ph_erp_sync_runs order by updated_at desc limit 50)';
    get diagnostics affected = row_count; results := results || jsonb_build_object('legacy_runs',affected);
  end if;
  foreach target in array array['ph_runtime_watchdog_events','app_runtime_watchdog_events','ph_watchdog_events'] loop
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name=target and column_name='created_at' and data_type in ('timestamp with time zone','timestamp without time zone')) then
      execute format('delete from public.%I where created_at < now()-interval ''7 days''',target);
      get diagnostics affected = row_count; results := results || jsonb_build_object(target,affected);
    end if;
  end loop;
  -- Keep every referenced delivery receipt and every active lease; never cascade into crew/history records.
  for fk in select ns.nspname, t.relname, a.attname
    from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace ns on ns.oid=t.relnamespace
      join pg_attribute a on a.attrelid=t.oid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid='public.ph_request_delivery_outbox'::regclass
  loop
    guards := guards || format(' and not exists(select 1 from %I.%I r where r.%I=o.event_id)',fk.nspname,fk.relname,fk.attname);
  end loop;
  execute 'delete from public.ph_request_delivery_outbox o where status=''delivered'' and delivered_at < now()-interval ''14 days'' and (lease_expires_at is null or lease_expires_at < now())' || guards;
  get diagnostics affected = row_count;
  return results || jsonb_build_object('delivered_outbox',affected);
end $$;
SET request.jwt.claim.role='service_role';
DO $$ BEGIN IF (public.get_eval_request_delivery_health_snapshot_v2()->>'creation_order_violation_count')::int<>2 THEN RAISE EXCEPTION 'REPRODUCTION_FAILED'; END IF; END $$;
-- APPLY_RELEASE_MIGRATION
CREATE TEMP TABLE reconciliation_snapshot AS SELECT * FROM private.request_delivery_order_reconciliations_v23133;
-- APPLY_RELEASE_MIGRATION
SET request.jwt.claim.role='service_role';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM original_receipts r JOIN public.ph_request_delivery_outbox o USING(event_id) WHERE r.receipt<>to_jsonb(o)) THEN RAISE EXCEPTION 'OPERATIONAL_RECEIPT_CHANGED'; END IF;
 IF EXISTS(SELECT * FROM reconciliation_snapshot EXCEPT SELECT * FROM private.request_delivery_order_reconciliations_v23133) THEN RAISE EXCEPTION 'IDEMPOTENCY_FAILED'; END IF;
 IF has_function_privilege('authenticated','public.get_eval_request_delivery_health_snapshot_v2()','execute') OR has_table_privilege('authenticated','private.request_delivery_order_reconciliations_v23133','select') THEN RAISE EXCEPTION 'PRIVATE_BOUNDARY_CHANGED'; END IF;
END $$;
INSERT INTO public.ph_request_delivery_outbox(event_id,event_key,event_type,payload,status,delivered_at) VALUES
('00000000-0000-0000-0000-000000000011','retained-created','request_created','{}','delivered',now()-interval '20 days'),
('00000000-0000-0000-0000-000000000012','new-completion','request_completed','{"contractVersion":"request-folder-completion-v2","dependencyEventKeys":["retained-created"]}','delivered',now()-interval '1 day'),
('00000000-0000-0000-0000-000000000013','unreferenced-old','request_created','{}','delivered',now()-interval '20 days');
SELECT public.ph_prune_supabase_bloat_v1();
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ph_request_delivery_outbox WHERE event_key='retained-created') OR EXISTS(SELECT 1 FROM public.ph_request_delivery_outbox WHERE event_key='unreferenced-old') THEN RAISE EXCEPTION 'JSON_REFERENCE_RETENTION_FAILED'; END IF;
END $$;
UPDATE public.ph_request_delivery_outbox SET delivered_at=now() WHERE event_key='retained-created';
DO $$ BEGIN IF (public.get_eval_request_delivery_health_snapshot_v2()->>'creation_order_violation_count')::int<>1 THEN RAISE EXCEPTION 'LATE_RECEIPT_WAS_HIDDEN'; END IF; END $$;
UPDATE public.ph_request_delivery_outbox SET delivered_at=now()-interval '20 days' WHERE event_key='retained-created';
UPDATE public.ph_request_delivery_outbox SET payload=jsonb_set(payload,'{dependencyEventKeys}','["unaudited-missing"]') WHERE event_key='new-completion';
DO $$ BEGIN IF (public.get_eval_request_delivery_health_snapshot_v2()->>'creation_order_violation_count')::int<>1 THEN RAISE EXCEPTION 'UNKNOWN_MISSING_DEPENDENCY_WAS_HIDDEN'; END IF; END $$;
UPDATE public.ph_request_delivery_outbox SET payload=jsonb_set(payload,'{dependencyEventKeys}','["retained-created"]') WHERE event_key='new-completion';
SELECT public.get_eval_request_delivery_health_snapshot_v2();
