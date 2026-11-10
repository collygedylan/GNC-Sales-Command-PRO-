create temporary table prune_fixture_master(like public.ph_master_inventory including defaults);
create unique index on prune_fixture_master(unique_id);
create temporary table ph_master_bulk_map_v1(canonical_unique_id text);
create index on ph_master_bulk_map_v1(canonical_unique_id);

insert into prune_fixture_master(unique_id,itemcode,locationcode,lotcode,season)
select 'prune-fixture-'||id,'PRUNE-FIXTURE-'||id,'D.08.000','28.F1','F1'
from unnest(array['mapped','delete','app-edit','ledger-today','evidence','history','reclass','ledger-pending','season']) ids(id);
insert into ph_master_bulk_map_v1 values ('prune-fixture-mapped'),(null);
analyze pg_temp.prune_fixture_master;
analyze pg_temp.ph_master_bulk_map_v1;

insert into app_sync_private.ph_master_inventory_app_edits(canonical_unique_id,lineage_key,updated_at)
values ('prune-fixture-app-edit','prune-fixture-app-edit',statement_timestamp());
insert into app_sync_private.inventory_live_overrides_v1(canonical_unique_id,field_name,updated_by,updated_at,pending)
values ('prune-fixture-ledger-today','spec','fixture',statement_timestamp(),false),
  ('prune-fixture-ledger-pending','spec','fixture',statement_timestamp()-interval '3 days',true);
insert into app_sync_private.inventory_location_evidence_v1(itemcode_key,locationcode_key,itemcode,locationcode,source_unique_id,updated_by,updated_at)
values ('PRUNE-FIXTURE-EVIDENCE','D.08.000','PRUNE-FIXTURE-EVIDENCE','D.08.000','prune-fixture-evidence','fixture',statement_timestamp());
insert into public.ph_productivity_history(event_key,completed_by_username,completed_by_display,completed_at,source_table,source_kind,source_unique_id,snapshot)
values ('prune-fixture-history','fixture','Fixture',statement_timestamp(),'ph_master_inventory','evaluation','prune-fixture-history','{}');
insert into private.ph_inventory_reclass_commands_v1(request_id,actor_id,command_id,request)
values ('a3048000-0000-4000-8000-000000000031','a3048000-0000-4000-8000-000000000032','prune-fixture-reclass','{}');
insert into private.ph_inventory_reclass_movements_v1(request_id,line_index,direction,destination_season,quantity,
  source_unique_id,destination_unique_id,source_lineage_key,destination_lineage_key,source_identity,destination_identity,
  source_before,source_after,destination_after,status)
values ('a3048000-0000-4000-8000-000000000031',0,'move_up','U1',2,
  'prune-fixture-reclass','prune-fixture-reclass-target','fixture-source','fixture-target','{}','{}','{}','{}','{}','conflict');
insert into app_sync_private.inventory_season_stock_overrides_v1(itemcode,season,open_stock,season_oh,updated_by,pending)
values ('PRUNE-FIXTURE-season','F1',4,7,'fixture',true);

do $test$
declare
  definition text := pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  start_at integer := strpos(definition,'  with missing_source as materialized (');
  span integer := strpos(substring(definition from start_at),') select count(*)::integer')-1;
  statement text;
  plan jsonb;
  candidates jsonb;
  eligibility jsonb;
  removed text[];
begin
  if start_at=0 or span<=0 then raise exception 'ERP_PRUNE_FIXTURE_ANCHOR_MISSING'; end if;
  statement:=replace(substring(definition from start_at for span),
    'public.ph_master_inventory live','pg_temp.prune_fixture_master live')||') select array_agg(unique_id) from deleted';
  execute 'explain (format json,costs off) '||statement into plan;
  candidates:=jsonb_path_query_first(plan,'$.** ? (@."Subplan Name" == "CTE missing_source")');
  eligibility:=jsonb_path_query_first(plan,'$.** ? (@."Subplan Name" == "CTE eligible_missing_source")');
  if candidates is null or eligibility is null
    or not jsonb_path_exists(candidates,'$.** ? (@."Join Type" == "Anti")')
    or not jsonb_path_exists(candidates,'$.** ? (@."Relation Name" == "ph_master_bulk_map_v1")')
    or not jsonb_path_exists(eligibility,'$.** ? (@."CTE Name" == "missing_source")')
    or candidates::text ~ 'ph_productivity_history|ph_master_inventory_app_edits|inventory_live_overrides|inventory_location_evidence|inventory_season_stock_overrides|ph_inventory_reclass_movements'
    or not jsonb_path_exists(plan,'$.** ? (@."CTE Name" == "eligible_missing_source")') then
    raise exception 'ERP_PRUNE_FIXTURE_UNBOUNDED_CANDIDATE_FLOW: %',plan;
  end if;

  execute statement into removed;
  if removed is distinct from array['prune-fixture-delete']::text[]
    or (select count(*) from pg_temp.prune_fixture_master)<>8 then
    raise exception 'ERP_PRUNE_FIXTURE_DELETION_PROTECTIONS_CHANGED: %',removed;
  end if;
end
$test$;
