BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
SELECT pg_advisory_xact_lock(hashtext('ph_prune_supabase_bloat_v1'));

-- Historical evidence only: never requeue a delivered event or fabricate channel delivery.
CREATE TABLE IF NOT EXISTS private.request_delivery_order_reconciliations_v23133 (
  completion_event_id uuid NOT NULL REFERENCES public.ph_request_delivery_outbox(event_id) ON DELETE RESTRICT,
  dependency_event_key text NOT NULL,
  thread_record_id uuid NOT NULL REFERENCES public.ph_request_email_threads(id) ON DELETE RESTRICT,
  initial_email_sent_at timestamptz NOT NULL,
  initial_thread_id text NOT NULL,
  initial_message_id text NOT NULL,
  completion_receipt jsonb NOT NULL,
  reconciliation_reason text NOT NULL DEFAULT 'CREATION_RECEIPT_PRUNED_THREAD_EVIDENCE_RETAINED',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (completion_event_id, dependency_event_key),
  CHECK (initial_thread_id <> '' AND initial_message_id <> ''),
  CHECK (completion_receipt->>'event_id' = completion_event_id::text)
);
ALTER TABLE private.request_delivery_order_reconciliations_v23133 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.request_delivery_order_reconciliations_v23133 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON private.request_delivery_order_reconciliations_v23133 TO service_role;
COMMENT ON TABLE private.request_delivery_order_reconciliations_v23133 IS
  'Audited recovery of two pruned creation dependencies from retained initial Gmail receipts; does not assert push delivery or modify completion history.';

INSERT INTO private.request_delivery_order_reconciliations_v23133
  (completion_event_id, dependency_event_key, thread_record_id, initial_email_sent_at,
   initial_thread_id, initial_message_id, completion_receipt)
SELECT c.event_id, target.dependency_event_key, t.id, t.initial_email_sent_at,
       t.initial_thread_id, t.initial_message_id, to_jsonb(c)
FROM (VALUES
  ('7f0335e7-e798-49ed-8b6f-53b0364213f1'::uuid, 'request-created:aa7fe2ee-4ae1-4975-bd5c-9c93262acdbb'),
  ('b64c2bc5-d01a-4c6f-b344-767b33dcc0a0'::uuid, 'request-created:c20a6c65-9bb4-4748-b2b1-2421ae423dde')
) target(completion_event_id, dependency_event_key)
JOIN public.ph_request_delivery_outbox c ON c.event_id = target.completion_event_id
JOIN public.ph_request_email_threads t ON t.request_folder = c.request_folder
WHERE c.event_type = 'request_completed' AND c.status = 'delivered'
  AND c.payload->>'contractVersion' = 'request-folder-completion-v2'
  AND c.payload->'dependencyEventKeys' ? target.dependency_event_key
  AND t.initial_email_sent_at IS NOT NULL AND t.initial_email_sent_at <= c.delivered_at
  AND nullif(t.initial_thread_id, '') = c.channel_results #>> '{email,thread_id}'
  AND nullif(t.initial_message_id, '') = c.channel_results #>> '{email,reply_to_message_id}'
  AND c.channel_results #>> '{email,mode}' = 'gmail_api_threaded'
  AND t.metadata->>'delivery_event_id' = c.event_id::text
  AND NOT EXISTS (SELECT 1 FROM public.ph_request_delivery_outbox d WHERE d.event_key = target.dependency_event_key)
ON CONFLICT (completion_event_id, dependency_event_key) DO NOTHING;

DO $reconcile$
DECLARE definition text; original_predicate text; replacement_predicate text;
BEGIN
  IF (SELECT count(*) FROM private.request_delivery_order_reconciliations_v23133
      WHERE completion_event_id IN ('7f0335e7-e798-49ed-8b6f-53b0364213f1','b64c2bc5-d01a-4c6f-b344-767b33dcc0a0')) <> 2 THEN
    RAISE EXCEPTION 'DELIVERY_ORDER_RECONCILIATION_EVIDENCE_MISSING';
  END IF;
  definition := replace(pg_get_functiondef('public.get_eval_request_delivery_health_snapshot_v2()'::regprocedure), E'\r\n', E'\n');
  IF position('request_delivery_order_reconciliations_v23133' in definition) = 0 THEN
    original_predicate := $old$where created.event_id is null or created.status <> 'delivered'
         or created.delivered_at is null or completion.delivered_at is null
         or created.delivered_at > completion.delivered_at$old$;
    replacement_predicate := $new$where completion.delivered_at is null
         or (created.event_id is not null and
             (created.status <> 'delivered' or created.delivered_at is null or created.delivered_at > completion.delivered_at))
         or (created.event_id is null and not exists (
           select 1 from private.request_delivery_order_reconciliations_v23133 evidence
           where evidence.completion_event_id = completion.event_id
             and evidence.dependency_event_key = dependency.event_key
             and evidence.initial_email_sent_at <= completion.delivered_at
             and evidence.initial_thread_id = completion.channel_results #>> '{email,thread_id}'
             and evidence.initial_message_id = completion.channel_results #>> '{email,reply_to_message_id}'
             and evidence.completion_receipt->'payload' = completion.payload
             and evidence.completion_receipt->'channel_results' = completion.channel_results
         ))$new$;
    IF position(original_predicate in definition) = 0 THEN RAISE EXCEPTION 'DELIVERY_ORDER_HEALTH_CONTRACT_CHANGED'; END IF;
    EXECUTE replace(definition, original_predicate, replacement_predicate);
  END IF;
  definition := pg_get_functiondef('public.ph_prune_supabase_bloat_v1()'::regprocedure);
  IF position('dependency_owner.payload' in definition) = 0 THEN
    original_predicate := $old$  execute 'delete from public.ph_request_delivery_outbox o $old$;
    replacement_predicate := $new$  -- JSON event-key references are dependencies even without SQL foreign keys.
  guards := guards || ' and not exists (select 1 from public.ph_request_delivery_outbox dependency_owner where dependency_owner.event_id <> o.event_id and coalesce(dependency_owner.payload->''dependencyEventKeys'', ''[]''::jsonb) ? o.event_key)';
  execute 'delete from public.ph_request_delivery_outbox o $new$;
    IF position(original_predicate in definition) = 0 THEN RAISE EXCEPTION 'DELIVERY_ORDER_RETENTION_CONTRACT_CHANGED'; END IF;
    EXECUTE replace(definition, original_predicate, replacement_predicate);
  END IF;
END $reconcile$;

REVOKE ALL ON FUNCTION public.get_eval_request_delivery_health_snapshot_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_eval_request_delivery_health_snapshot_v2() TO service_role;
REVOKE ALL ON FUNCTION public.ph_prune_supabase_bloat_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ph_prune_supabase_bloat_v1() TO service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $verify$
BEGIN
  IF (public.get_eval_request_delivery_health_snapshot_v2()->>'creation_order_violation_count')::bigint <> 0 THEN
    RAISE EXCEPTION 'DELIVERY_ORDER_RECONCILIATION_INCOMPLETE';
  END IF;
END $verify$;
COMMIT;
