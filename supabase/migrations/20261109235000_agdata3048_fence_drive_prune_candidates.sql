begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- Prove source absence before evaluating any of the live retention checks.
-- Retain the statement's physical tuple witness so concurrent row changes
-- cannot turn a previously eligible snapshot row into an unsafe delete.
do $prune$
declare
  definition text := pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  delete_start text := $start$  with deleted as (
    delete from public.ph_master_inventory live
    where not exists ($start$;
  delete_end text := $end$      and not exists (
      select 1 from pg_temp.ph_master_bulk_map_v1 m where m.canonical_unique_id = live.unique_id
    ) returning unique_id$end$;
  start_at integer := strpos(definition,delete_start);
  end_at integer := strpos(definition,delete_end);
begin
  if start_at=0 or end_at<=start_at then raise exception 'ERP_DRIVE_PRUNE_CANDIDATE_ANCHOR_MISSING'; end if;
  definition:=replace(definition,delete_start,$start$  with missing_source as materialized (
    select live.unique_id,live.ctid as physical_tid,live.itemcode,live.lotcode,live.season
    from public.ph_master_inventory live
    where not exists (
      select 1 from pg_temp.ph_master_bulk_map_v1 m where m.canonical_unique_id=live.unique_id
    )
  ), eligible_missing_source as materialized (
    select live.unique_id,live.physical_tid from missing_source live
    where not exists ($start$);
  execute replace(definition,delete_end,$end$  ), deleted as (
    delete from public.ph_master_inventory live using eligible_missing_source candidate
    where live.unique_id=candidate.unique_id and live.ctid=candidate.physical_tid
    returning live.unique_id$end$);
end
$prune$;

commit;
