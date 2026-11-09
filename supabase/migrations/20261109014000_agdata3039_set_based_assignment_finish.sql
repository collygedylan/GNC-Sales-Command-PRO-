begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Both missing-identity checks must finish over complete sets. A LIMIT-style
-- EXISTS estimate can prefer a nested probe even though a healthy import has
-- no mismatch to stop it early. EXCEPT verifies the same IDs in bulk.
do $migration$
declare
  definition text := pg_get_functiondef('private.inventory_row_assignment_reconcile_finish_v1(uuid)'::regprocedure);
  before_check constant text := $before$
     or exists(select 1 from public.ph_master_inventory m
       where not exists(select 1 from private.inventory_row_assignment_reconcile_worklist w
         where w.import_run_id = p_run_id and w.work_kind = 'source'
           and w.master_unique_id = m.unique_id))
     or exists(select 1 from public.ph_inventory_row_assignments a
       where a.present_in_drive and not exists(
         select 1 from public.ph_master_inventory m where m.unique_id = a.master_unique_id))$before$;
  after_check constant text := $after$
     or exists(
       select m.unique_id from public.ph_master_inventory m
       except
       select w.master_unique_id from private.inventory_row_assignment_reconcile_worklist w
         where w.import_run_id = p_run_id and w.work_kind = 'source')
     or exists(
       select a.master_unique_id from public.ph_inventory_row_assignments a where a.present_in_drive
       except
       select m.unique_id from public.ph_master_inventory m)$after$;
begin
  if (length(definition) - length(replace(definition, before_check, ''))) <> length(before_check) then
    raise exception 'ASSIGNMENT_FINISH_IDENTITY_PROOF_CHANGED';
  end if;
  execute replace(definition, before_check, after_check);
end;
$migration$;

commit;
