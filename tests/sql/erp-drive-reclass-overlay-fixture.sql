-- Supply committed movement receipts to the native importer overlay. These
-- four synthetic physical rows cover both movement directions and catch-up.
create temporary table erp_reclass_overlay_input as
select command_id,direction,source_uid,destination_uid,qty,
  jsonb_build_object('unique_id',source_uid,'itemcode','ERP-RECLASS-'||direction,
    'contsize','#2','locationcode','X.92.003','lotcode','28.F1','source','PH',
    'warehouseid','10','season','F1','ptronhand','12','ptravailable','10') source_before,
  jsonb_build_object('unique_id',destination_uid,'itemcode','ERP-RECLASS-'||direction,
    'contsize','#2','locationcode','X.92.003','lotcode',destination_lot,'source','PH',
    'warehouseid','10','season',destination_season,'ptronhand',qty::text,'ptravailable',qty::text) destination_after
from (values
  ('a3047000-0000-4000-8000-000000000001'::uuid,'move_up','erp-reclass-up-source','erp-reclass-up-destination',2,'28.U1','U1'),
  ('a3047000-0000-4000-8000-000000000002'::uuid,'move_down','erp-reclass-down-source','erp-reclass-down-destination',3,'28.S1','S1')
) fixtures(command_id,direction,source_uid,destination_uid,qty,destination_lot,destination_season);

insert into private.ph_inventory_reclass_commands_v1(request_id,actor_id,command_id,request)
select command_id,'a3047000-0000-4000-8000-000000000003',source_uid,jsonb_build_object('sourceUid',source_uid)
from erp_reclass_overlay_input;
insert into private.ph_inventory_reclass_movements_v1(request_id,line_index,direction,destination_season,quantity,
  source_unique_id,destination_unique_id,source_lineage_key,destination_lineage_key,source_identity,
  destination_identity,source_before,source_after,destination_after)
select command_id,0,direction,destination_after->>'season',qty,source_uid,destination_uid,
  private.ph_master_inventory_lineage_key_v1(source_before),private.ph_master_inventory_lineage_key_v1(destination_after),
  source_before,destination_after,source_before,
  source_before||jsonb_build_object('ptronhand',(12-qty)::text,'ptravailable',(10-qty)::text),destination_after
from erp_reclass_overlay_input;
insert into private.ph_inventory_reclass_import_aliases_v1(lineage_key,canonical_unique_id,request_id)
select private.ph_master_inventory_lineage_key_v1(destination_after),destination_uid,command_id
from erp_reclass_overlay_input;

create function pg_temp.prepare_erp_reclass_overlay_fixture(caught_up boolean)
returns void language plpgsql as $prepare$
declare payload jsonb;
begin
  select jsonb_agg(jsonb_build_object('values',values_json,'rawFields','[]'::jsonb)) into payload from (
    select case when caught_up then m.source_after else m.source_before end values_json
    from private.ph_inventory_reclass_movements_v1 m join erp_reclass_overlay_input i on i.command_id=m.request_id
    union all
    select i.destination_after from erp_reclass_overlay_input i where caught_up
  ) input;
  perform private.prepare_master_bulk_stage_v3046(payload);
  drop table if exists pg_temp.ph_master_bulk_map_v1;
  create temporary table ph_master_bulk_map_v1 as
    select row_number,unique_id as source_unique_id,unique_id as canonical_unique_id,1 as candidate_count
    from pg_temp.ph_master_bulk_stage_v1;
end
$prepare$;

do $test$
declare run_id uuid := 'a3047000-0000-4000-8000-000000000004';
begin
  perform pg_temp.prepare_erp_reclass_overlay_fixture(false);
  perform private.apply_inventory_reclass_import_overlay_v1(run_id,'a3047000-0000-4000-8000-000000000005');
  if (select count(*) from public.ph_reclass_history h join erp_reclass_overlay_input i on i.command_id=h.request_id
    where not h.absorbed_by_erp)<>2
    or (select count(*) from pg_temp.ph_master_bulk_stage_v1 s join erp_reclass_overlay_input i on i.source_uid=s.unique_id
      where s.ptronhand=(12-i.qty)::text and s.ptravailable=(10-i.qty)::text
        and s.raw_values->>'ptronhand'='12')<>2 then
    raise exception 'ERP_RECLASS_OVERLAY_DID_NOT_RETAIN_UNABSORBED_MOVES';
  end if;

  perform pg_temp.prepare_erp_reclass_overlay_fixture(true);
  perform private.apply_inventory_reclass_import_overlay_v1(run_id,'a3047000-0000-4000-8000-000000000006');
  if (select count(*) from public.ph_reclass_history h join erp_reclass_overlay_input i on i.command_id=h.request_id
    where h.absorbed_by_erp)<>2
    or (select count(*) from pg_temp.ph_master_bulk_stage_v1 s join erp_reclass_overlay_input i on i.destination_uid=s.unique_id
      where s.ptronhand=i.qty::text and s.ptravailable=i.qty::text)<>2 then
    raise exception 'ERP_RECLASS_OVERLAY_DID_NOT_ACKNOWLEDGE_EXACT_CATCHUP';
  end if;
end
$test$;
