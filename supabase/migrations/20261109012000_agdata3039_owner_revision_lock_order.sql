begin;

-- Serialize competing owner commands before taking the ready revision lock.
-- The owner write can advance that revision through the master triggers.
do $repair$
declare
  target regprocedure:='public.set_itemcode_default_owners_v1(jsonb,uuid)'::regprocedure;
  definition text:=pg_get_functiondef(target);
  ready_guard constant text:=$guard$  select r.revision into source_revision from public.app_dataset_revisions r
    where r.key = 'ph_master_inventory' and r.state = 'ready' for share;
  if not found then
    raise exception using errcode = '55000', message = 'ITEMCODE_DEFAULT_OWNER_SOURCE_NOT_READY';
  end if;$guard$;
  assignment_lock constant text:=$lock$  perform pg_advisory_xact_lock(hashtextextended('gnc-reconcile-eval-itemcodes-v2', 0));$lock$;
  previous text:=ready_guard||chr(10)||assignment_lock;
  ordered text:=assignment_lock||chr(10)||ready_guard;
begin
  if cardinality(string_to_array(definition,ordered))=2 then return; end if;
  if cardinality(string_to_array(definition,previous))<>2 then
    raise exception 'AGDATA3039_OWNER_REVISION_LOCK_ANCHOR_CHANGED';
  end if;
  execute replace(definition,previous,ordered);
end
$repair$;

commit;
