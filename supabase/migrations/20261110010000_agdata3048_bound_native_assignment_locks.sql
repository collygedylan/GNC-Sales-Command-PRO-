begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- Native assignment publication owns the same transaction gate used by all
-- assignment writers. The set-based UPSERT still locks its physical tuples;
-- one advisory lock per source row adds no fence and exhausts shared locks.
do $assignment_locks$
declare
  definition text := pg_get_functiondef('private.reconcile_drive_row_assignments_v3047(uuid)'::regprocedure);
  ingest text := pg_get_functiondef('public.fast_ingest_drive_around_v2374_base(jsonb,jsonb)'::regprocedure);
  gate text := $lock$perform pg_advisory_xact_lock(hashtextextended('gnc-reconcile-eval-itemcodes-v2', 0));$lock$;
  ingest_gate text := $lock$perform pg_advisory_xact_lock(hashtextextended('gnc-reconcile-eval-itemcodes-v2',0));$lock$;
  plan text := 'perform private.plan_drive_row_assignments_v3047(source_rev);';
  begin_import text := 'public.begin_dataset_import_v1(';
  per_row text := $locks$  perform pg_advisory_xact_lock(hashtextextended('inventory-row-assignment:'||m.unique_id,0))
    from public.ph_master_inventory m order by m.unique_id;
$locks$;
begin
  if cardinality(string_to_array(definition,per_row))<>2 or strpos(definition,gate)=0
    or strpos(definition,plan)<=strpos(definition,gate) or strpos(ingest,ingest_gate)=0
    or strpos(ingest,begin_import)<=strpos(ingest,ingest_gate) then
    raise exception 'ERP_DRIVE_ASSIGNMENT_GLOBAL_LOCK_PROOF_MISSING';
  end if;
  execute replace(definition,per_row,'');
end
$assignment_locks$;

commit;
