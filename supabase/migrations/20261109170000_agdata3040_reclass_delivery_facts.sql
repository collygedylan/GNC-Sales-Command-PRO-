begin;

set local lock_timeout = '2s';
set local statement_timeout = '10s';

-- Keep the existing service-only atomic inventory and outbox command. Freeze
-- report facts from the persisted movement rows before any later ERP import.
do $migration$
declare
  target constant regprocedure := 'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure;
  definition text := pg_get_functiondef(target);
  move_anchor constant text := $anchor$      'quantity', m.quantity,
      'source', jsonb_build_object$anchor$;
  move_facts constant text := $facts$      'quantity', m.quantity,
      'remainingSourceQuantity', m.source_after->>'ptronhand',
      'newTargetQuantity', m.destination_after->>'ptronhand',
      'botanicalname', m.source_before->>'botanicalname',
      'reclass_explanation', m.reclass_explanation,
      'submittedAt', statement_timestamp(),
      'source', jsonb_build_object$facts$;
  event_anchor constant text := $anchor$'contractVersion', 'inventory-reclass-move-completed-v1',$anchor$;
  event_facts constant text := $facts$'contractVersion', 'inventory-reclass-move-completed-v1',
        'submittedAt', moves_value->0->'submittedAt',$facts$;
begin
  if cardinality(string_to_array(definition, move_facts)) = 2
      and cardinality(string_to_array(definition, event_facts)) = 2 then
    return;
  end if;
  if cardinality(string_to_array(definition, move_anchor)) <> 2
      or cardinality(string_to_array(definition, event_anchor)) <> 2 then
    raise exception 'RECLASS_DELIVERY_FACTS_ANCHOR_CHANGED';
  end if;
  execute replace(replace(definition, move_anchor, move_facts), event_anchor, event_facts);
end
$migration$;

commit;
