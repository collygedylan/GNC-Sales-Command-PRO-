set local lock_timeout='15s';
alter table private.ph_inventory_reclass_commands_v1 add column if not exists reclass_explanations jsonb;
alter table public.ph_inventory_transactions add column if not exists reclass_explanations jsonb;
create or replace function private.attach_reclass_explanation_v303()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare explanations jsonb:=coalesce(nullif(current_setting('gnc.reclass_explanations',true),''),'{}')::jsonb; summary text; rp jsonb;
begin
 if explanations='{}'::jsonb then return new; end if;
 select string_agg(key||': '||value,E'\n' order by key) into summary from jsonb_each_text(explanations) where nullif(btrim(value),'') is not null;
 if tg_table_name='ph_inventory_reclass_commands_v1' then
   new.reclass_explanations:=explanations;
 elsif tg_table_name in ('ph_inventory_reclass_movements_v1','ph_inventory_transactions') then
   new.reclass_explanation:=nullif(btrim(explanations->>new.source_unique_id),'');
   if tg_table_name='ph_inventory_transactions' then new.reclass_explanations:=explanations; end if;
 elsif new.payload ? 'reclassPayload' then
   rp:=new.payload->'reclassPayload';
   rp:=rp||jsonb_build_object('protectedDelivery',coalesce(rp->'protectedDelivery','{}')||jsonb_build_object('reclassExplanations',explanations));
   new.payload:=new.payload||jsonb_build_object('reclassPayload',rp,'reclass_explanation',summary);
 end if;
 if tg_table_name='ph_request_delivery_outbox' then
   new.payload:=new.payload||jsonb_build_object('reclassExplanations',explanations,'reclass_explanation',summary);
 end if;
 return new;
end $fn$;

create or replace view public.ph_reclass_history with (security_invoker=true) as  SELECT c.request_id,
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
          WHERE e.canonical_unique_id = (c.request ->> 'sourceUid'::text) AND e.pending))) AS absorbed_by_erp,
    COALESCE(m.reclass_explanation, c.reclass_explanations ->> COALESCE(m.source_unique_id, c.request ->> 'sourceUid'::text)) AS reclass_explanation
   FROM private.ph_inventory_reclass_commands_v1 c
     LEFT JOIN private.ph_inventory_reclass_movements_v1 m USING (request_id)
UNION ALL
 SELECT NULL::uuid AS request_id,
    t.created_at,
    NULL::uuid AS movement_id,
    COALESCE(((t.raw_payload -> 'transaction'::text) -> 'requestActions'::text) ->> 0, t.action) AS reclass_type,
    t.source_unique_id AS source_row_uid,
    t.destination_unique_id AS dest_row_uid,
    COALESCE(t.quantity, 0::numeric) AS qty_delta,
    COALESCE(t.raw_payload -> 'rowOverlays'::text, t.source_after, '{}'::jsonb) AS field_deltas,
    private.inventory_location_evidence_number_v2(COALESCE(t.source_before ->> 'erp_on_hand'::text, t.source_before ->> 'ptronhand'::text, evidence.expected ->> 'ptronhand'::text)) AS pre_erp_on_hand,
    private.inventory_location_evidence_number_v2(COALESCE(t.source_before ->> 'erp_ptrreview'::text, t.source_before ->> 'ptrreviewed'::text, evidence.expected ->> 'ptrreviewed'::text)) AS pre_erp_ptrreview,
    COALESCE(reconciled.absorbed, false) AS absorbed_by_erp,
    t.reclass_explanation
   FROM ph_inventory_transactions t
     LEFT JOIN LATERAL ( SELECT r.value -> 'expected'::text AS expected
           FROM jsonb_array_elements(COALESCE(t.raw_payload -> 'rowOverlays'::text, '[]'::jsonb)) r(value)
          WHERE (r.value ->> 'unique_id'::text) = t.source_unique_id
         LIMIT 1) evidence ON true
     LEFT JOIN LATERAL ( SELECT bool_and(NOT e.pending AND NOT e.latest_erp_value IS DISTINCT FROM e.app_override_value) AS absorbed
           FROM app_sync_private.inventory_live_overrides_v1 e
          WHERE e.canonical_unique_id = t.source_unique_id AND (e.field_name = ANY (
                CASE COALESCE(((t.raw_payload -> 'transaction'::text) -> 'requestActions'::text) ->> 0, t.action)
                    WHEN 'priority_change'::text THEN ARRAY['priority'::text]
                    WHEN 'hold'::text THEN ARRAY['holdstopcode'::text, 'holdstopreason'::text, 'holdstopbegindate'::text]
                    WHEN 'stop_ship'::text THEN ARRAY['holdstopcode'::text, 'holdstopreason'::text, 'holdstopbegindate'::text]
                    WHEN 'take_off_hold'::text THEN ARRAY['holdstopcode'::text, 'holdstopreason'::text, 'holdstopbegindate'::text]
                    WHEN 'inventory_fields'::text THEN ARRAY['lotcode'::text, 'locationcode'::text, 'spec'::text, 'caliper'::text, 'priority'::text, 'desigitem'::text, 'desigloc'::text, 'desigcust'::text]
                    WHEN 'qty'::text THEN ARRAY['ptronhand'::text, 'ptrreviewed'::text, 'ptravailable'::text]
                    ELSE ARRAY[]::text[]
                END))) reconciled ON true
  WHERE t.event_type <> 'inventory_reclass_move'::text;
