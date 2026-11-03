BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.ph_master_inventory
  ADD COLUMN IF NOT EXISTS default_owner text,
  ADD COLUMN IF NOT EXISTS effective_worker text,
  ADD COLUMN IF NOT EXISTS eval_user text;

DO $guard_owner_mirror$
DECLARE
  definition text;
  needle text := $needle$  if not exists(select 1 from private.ph_inventory_row_assignment_policy_state s where s.singleton and s.active) then$needle$;
  guard_text text := $guard$current_user = 'postgres' and current_setting('agdata.owner_master_mirror',true)='on'$guard$;
  replacement text := $replacement$  if current_user = 'postgres' and current_setting('agdata.owner_master_mirror',true)='on' then return null; end if;
  if not exists(select 1 from private.ph_inventory_row_assignment_policy_state s where s.singleton and s.active) then$replacement$;
BEGIN
  definition := replace(pg_get_functiondef('private.sync_inventory_row_assignment_statement_v1()'::regprocedure), E'\r\n', E'\n');
  IF position(guard_text IN definition) > 0 THEN RETURN; END IF;
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle) <> 1 THEN
    RAISE EXCEPTION 'V23154_OWNER_MIRROR_TRIGGER_ANCHOR_MISMATCH';
  END IF;
  EXECUTE replace(definition,needle,replacement);
END
$guard_owner_mirror$;

SET LOCAL agdata.owner_master_mirror = 'on';

WITH expected AS MATERIALIZED (
  SELECT m.unique_id, d.assignedto AS default_owner,
    COALESCE(a.assignedto, d.assignedto) AS effective_worker
  FROM public.ph_master_inventory m
  JOIN public.ph_itemcode_default_owners d
    ON d.itemcode_normalized = upper(btrim(COALESCE(m.itemcode, '')))
  LEFT JOIN public.ph_inventory_row_assignments a
    ON a.master_unique_id = m.unique_id
    AND a.itemcode_normalized = d.itemcode_normalized
    AND a.present_in_drive
)
UPDATE public.ph_master_inventory m
SET default_owner = e.default_owner,
    effective_worker = e.effective_worker,
    eval_user = e.effective_worker
FROM expected e
WHERE e.unique_id = m.unique_id
  AND (m.default_owner, m.effective_worker, m.eval_user)
    IS DISTINCT FROM (e.default_owner, e.effective_worker, e.effective_worker);
SET LOCAL agdata.owner_master_mirror = '';

DO $sync_owner_fields$
DECLARE
  definition text;
  needle text := $needle$  select coalesce(jsonb_agg(jsonb_build_object('itemcode',d.itemcode_normalized,$needle$;
  replacement text := $replacement$  -- Publish the authorized itemcode owner to each exact physical master row in one guarded statement.
  perform set_config('agdata.owner_master_mirror','on',true);
  update public.ph_master_inventory m
  set default_owner=a.default_assignedto, effective_worker=a.assignedto, eval_user=a.assignedto
  from public.ph_inventory_row_assignments a
  where a.master_unique_id=m.unique_id and a.present_in_drive
    and a.itemcode_normalized=any(changed_itemcodes)
    and (m.default_owner,m.effective_worker,m.eval_user) is distinct from
        (a.default_assignedto,a.assignedto,a.assignedto);
  perform set_config('agdata.owner_master_mirror','',true);

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
