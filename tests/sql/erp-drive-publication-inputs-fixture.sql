select set_config('request.jwt.claim.role','service_role',true);
select public.begin_dataset_import_v1(array['ph_master_inventory'],'a3048000-0000-4000-8000-000000000011',
  array['ph_master_inventory'])->>'state';

create function pg_temp.assert_drive_item6_mask_rejected(p_values jsonb,p_mask jsonb)
returns void language plpgsql as $invalid$
begin
  perform public.bulk_import_master_snapshot_v2374_base('a3048000-0000-4000-8000-000000000011',
    'a3048000-0000-4000-8000-000000000012',
    jsonb_build_array(jsonb_build_object('values',p_values,'rawFields',p_mask)),repeat('a',64));
  raise exception 'ERP_DRIVE_INVALID_ITEM6_MASK_ACCEPTED';
exception when sqlstate '22023' then
  if sqlerrm<>'BULK_MASTER_IMPORT_ITEM6_MASK_INVALID' then raise; end if;
end
$invalid$;

do $masks$
declare input jsonb := '{"unique_id":"narrow-drive-stock","itemcode":"NARROW-DRIVE","locationcode":"D.08.000","lotcode":"28.F1"}';
begin
  perform pg_temp.assert_drive_item6_mask_rejected(input,'["locationnote"]');
  perform pg_temp.assert_drive_item6_mask_rejected(input||'{"locationnote":null}','[]');
  perform pg_temp.assert_drive_item6_mask_rejected(input||'{"commonname":"Hosta"}','["commonname"]');
end
$masks$;

set local role service_role;
create temporary table agdata_drive_publication_input_v3042(forged boolean);
create temporary table ph_master_bulk_stage_v1(forged boolean);
create temporary table ph_master_bulk_tuples_v3046(forged boolean);
select set_config('agdata.erp.prepared_drive','on',true);
reset role;
select pg_temp.assert_drive_item6_mask_rejected(
  '{"unique_id":"narrow-drive-stock","itemcode":"NARROW-DRIVE","locationcode":"D.08.000","lotcode":"28.F1"}',
  '["locationnote"]');
drop table pg_temp.agdata_drive_publication_input_v3042,pg_temp.ph_master_bulk_stage_v1,pg_temp.ph_master_bulk_tuples_v3046;
select set_config('agdata.erp.prepared_drive','off',true);

select set_config('agdata.bulk_import.ph_master_inventory','on',true);
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,ptronhand,ptrreviewed,ptravailable)
values ('narrow-drive-stock','NARROW-DRIVE','D.08.000','28.F1','8','4','4');
select set_config('agdata.bulk_import.ph_master_inventory','off',true);
insert into app_sync_private.inventory_live_overrides_v1 as e(canonical_unique_id,field_name,erp_baseline_value,app_override_value,latest_erp_value,pending,updated_by)
values ('narrow-drive-stock','ptronhand','"12"','"8"','"12"',true,'fixture'),
  ('narrow-drive-stock','ptrreviewed','3','4','3',false,'fixture')
on conflict(canonical_unique_id,field_name) do update set erp_baseline_value=excluded.erp_baseline_value,
  app_override_value=excluded.app_override_value,latest_erp_value=excluded.latest_erp_value,pending=excluded.pending;

select private.prepare_master_bulk_stage_v3046(
  '[{"values":{"unique_id":"narrow-drive-stock","itemcode":"NARROW-DRIVE","locationcode":"D.08.000",
    "lotcode":"28.F1","ptronhand":"10","ptrreviewed":"5","ptravailable":"5","locationnote":null},"rawFields":["locationnote"]}]');
create temporary table ph_master_bulk_map_v1(row_number bigint,canonical_unique_id text,candidate_count integer);
insert into ph_master_bulk_map_v1 values(1,'narrow-drive-stock',1);
select private.apply_inventory_live_overrides_bulk_v1('a3048000-0000-4000-8000-000000000011');

do $stock$
begin
  if not exists(select 1 from pg_temp.erp_order_delta_v23196 where unique_id='narrow-drive-stock'
      and (old_oh,old_review,new_oh,new_review,pending_out,order_delta)=(12,3,10,5,4,2))
    or not exists(select 1 from pg_temp.ph_master_bulk_stage_v1 where unique_id='narrow-drive-stock' and ptronhand='6')
    or not exists(select 1 from app_sync_private.inventory_live_overrides_v1 where canonical_unique_id='narrow-drive-stock'
      and field_name='ptronhand' and pending and erp_baseline_value='"10"' and app_override_value='"6"') then
    raise exception 'ERP_DRIVE_TYPED_STOCK_WITNESS_CHANGED';
  end if;
end
$stock$;

do $classification$
begin
  if exists(
    select 1 from (values
      ('Hosta','Hosta','140_GRASS','D.08.000','dylan_collyge'),
      ('Hydrangea','Hydrangea m','140_GRASS','D.08.000','megan_kelly'),
      ('Hosta','Hosta',null,'D.08.000','zoe_green'),
      ('Hosta',null,null,null,'bobby_adair'),
      (null,null,null,null,null)
    ) sample(commonname,genusname,plantgroupcode,locationcode,expected)
    cross join lateral jsonb_populate_record(null::public.ph_master_inventory,to_jsonb(sample)) row_data
    where private.ph_master_bulk_assignedto_override_v1(to_jsonb(row_data)) is distinct from sample.expected
      or private.ph_master_bulk_assignedto_override_v1(jsonb_build_object('commonname',row_data.commonname,
        'genusname',row_data.genusname,'locationcode',row_data.locationcode,'plantgroupcode',row_data.plantgroupcode))
        is distinct from sample.expected
  ) then raise exception 'ERP_DRIVE_NARROW_ASSIGNMENT_CLASSIFICATION_CHANGED'; end if;
end
$classification$;
