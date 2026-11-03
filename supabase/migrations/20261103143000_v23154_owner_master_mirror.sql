BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '15s';

DO $sync_owner_fields$
DECLARE
  definition text;
  needle text := $needle$  select coalesce(jsonb_agg(jsonb_build_object('itemcode',d.itemcode_normalized,$needle$;
  replacement text := $replacement$  -- Publish the authorized itemcode owner to each exact physical master row in one guarded statement.
  update public.ph_master_inventory m
  set default_owner=a.default_assignedto, effective_worker=a.assignedto, eval_user=a.assignedto
  from public.ph_inventory_row_assignments a
  where a.master_unique_id=m.unique_id and a.present_in_drive
    and a.itemcode_normalized=any(changed_itemcodes)
    and (m.default_owner,m.effective_worker,m.eval_user) is distinct from
        (a.default_assignedto,a.assignedto,a.assignedto);

$replacement$ || needle;
BEGIN
  definition := replace(pg_get_functiondef('public.set_itemcode_default_owners_v1(jsonb,uuid)'::regprocedure), E'\r\n', E'\n');
  IF position(replacement IN definition) > 0 THEN RETURN; END IF;
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle) <> 1 THEN
    RAISE EXCEPTION 'V23154_OWNER_MASTER_MIRROR_ANCHOR_MISMATCH';
  END IF;
  EXECUTE replace(definition,needle,replacement);
END
$sync_owner_fields$;

COMMIT;
