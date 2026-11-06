CREATE OR REPLACE VIEW public.ph_reclass_history WITH(security_invoker=true) AS
SELECT c.request_id,
    c.created_at,
    m.id AS movement_id,
    COALESCE(m.direction, ((c.request -> 'lines'::text) -> 0) ->> 'direction'::text, 'field_update'::text) AS reclass_type,
    COALESCE(m.source_unique_id, c.request ->> 'sourceUid'::text) AS source_row_uid,
    m.destination_unique_id AS dest_row_uid,
    COALESCE(m.quantity, 0::numeric) AS qty_delta,
    c.request -> 'lines'::text AS field_deltas,
    private.inventory_location_evidence_number_v2(m.source_before ->> 'ptronhand'::text) AS pre_erp_on_hand,
    private.inventory_location_evidence_number_v2(m.source_before ->> 'ptrreviewed'::text) AS pre_erp_ptrreview,
    COALESCE(m.status = 'acknowledged'::text, NOT (EXISTS ( SELECT 1
           FROM app_sync_private.inventory_live_overrides_v1 e
          WHERE e.canonical_unique_id = (c.request ->> 'sourceUid'::text) AND e.pending))) AS absorbed_by_erp
   FROM private.ph_inventory_reclass_commands_v1 c
     LEFT JOIN private.ph_inventory_reclass_movements_v1 m USING (request_id)
UNION ALL
SELECT NULL::uuid request_id,t.created_at,NULL::uuid movement_id,coalesce(t.raw_payload->'transaction'->'requestActions'->>0,t.action) reclass_type,t.source_unique_id,t.destination_unique_id,coalesce(t.quantity,0),coalesce(t.raw_payload->'rowOverlays',t.source_after,'{}'::jsonb),
 private.inventory_location_evidence_number_v2(coalesce(t.source_before->>'erp_on_hand',t.source_before->>'ptronhand',evidence.expected->>'ptronhand')),
 private.inventory_location_evidence_number_v2(coalesce(t.source_before->>'erp_ptrreview',t.source_before->>'ptrreviewed',evidence.expected->>'ptrreviewed')),
 coalesce(reconciled.absorbed,false)
FROM public.ph_inventory_transactions t
LEFT JOIN LATERAL(SELECT r->'expected' expected FROM jsonb_array_elements(coalesce(t.raw_payload->'rowOverlays','[]'::jsonb)) r WHERE r->>'unique_id'=t.source_unique_id LIMIT 1) evidence ON true
LEFT JOIN LATERAL(SELECT bool_and(NOT e.pending AND e.latest_erp_value IS NOT DISTINCT FROM e.app_override_value) absorbed FROM app_sync_private.inventory_live_overrides_v1 e WHERE e.canonical_unique_id=t.source_unique_id AND e.field_name=ANY(CASE coalesce(t.raw_payload->'transaction'->'requestActions'->>0,t.action) WHEN 'priority_change' THEN ARRAY['priority'] WHEN 'hold' THEN ARRAY['holdstopcode','holdstopreason','holdstopbegindate'] WHEN 'stop_ship' THEN ARRAY['holdstopcode','holdstopreason','holdstopbegindate'] WHEN 'take_off_hold' THEN ARRAY['holdstopcode','holdstopreason','holdstopbegindate'] WHEN 'inventory_fields' THEN ARRAY['lotcode','locationcode','spec','caliper','priority','desigitem','desigloc','desigcust'] WHEN 'qty' THEN ARRAY['ptronhand','ptrreviewed','ptravailable'] ELSE ARRAY[]::text[] END)) reconciled ON true
WHERE t.event_type<>'inventory_reclass_move';
REVOKE ALL ON public.ph_reclass_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ph_reclass_history TO service_role;
