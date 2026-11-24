begin;
set local request.jwt.claims = '{"role":"service_role"}';
set local request.jwt.claim.role = 'service_role';
do $disposable$ begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
    raise exception 'DRIVE_SNAPSHOT_FIXTURE_REQUIRES_DISPOSABLE_DATABASE';
  end if;
end $disposable$;

insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,source,contsize,erp_source_present,
  erp_source_filename,ptronhand,spec,av_note,loc_match_pct)
values
  ('exact-a-f1','EXACT-FIXTURE','A.01.000','27.F1','HL','#2',false,'DriveAround-old.xlsx','140','Old spec','Archive this',90),
  ('exact-a-s1','EXACT-FIXTURE','A.01.000','27.S1','HL','#2',false,'DriveAround-old.xlsx','250',null,null,null),
  ('exact-b-f1','EXACT-FIXTURE','B.02.000','27.F1','HL','#2',true,'DriveAround-old.xlsx','110','Surviving spec','Keep this',90),
  ('exact-b-s1','EXACT-FIXTURE','B.02.000','27.S1','HL','#2',true,'DriveAround-old.xlsx','250',null,null,null),
  ('exact-split-old','EXACT-FIXTURE','B.02.000','26.U1','HL','#2',false,null,'4',null,null,null),
  ('exact-split-new','EXACT-FIXTURE','B.02.000','26.U2','HL','#2',false,null,'2',null,null,null),
  ('exact-unrelated','OTHER-FIXTURE','C.03.000','27.S1','OTHER','#2',false,null,'7',null,null,null);

insert into app_sync_private.inventory_live_overrides_v1(canonical_unique_id,field_name,updated_by,updated_at,pending,app_override_value)
values ('exact-a-f1','spec','fixture','2026-11-23T20:00:00Z',true,'"Old spec"'::jsonb)
on conflict(canonical_unique_id,field_name) do update set pending=true,updated_at=excluded.updated_at;

insert into private.ph_inventory_reclass_commands_v1(request_id,actor_id,command_id,request,created_at)
values ('a3088000-0000-4000-8000-000000000001','a3088000-0000-4000-8000-000000000003','exact-old','{}','2026-11-23T23:30:00Z'),
  ('a3088000-0000-4000-8000-000000000002','a3088000-0000-4000-8000-000000000003','exact-new','{}','2026-11-24T13:00:00Z');
insert into private.ph_inventory_reclass_movements_v1(request_id,line_index,direction,destination_season,quantity,
  source_unique_id,destination_unique_id,source_lineage_key,destination_lineage_key,source_identity,destination_identity,
  source_before,source_after,destination_after,updated_at)
select c.request_id,0,'move_up','U1',2,'exact-b-f1',v.destination_uid,'source',v.destination_uid,
  '{}','{}','{}','{}','{}','2026-11-24T14:05:00Z'
from (values ('exact-old','exact-split-old'),('exact-new','exact-split-new')) v(command_id,destination_uid)
join private.ph_inventory_reclass_commands_v1 c using(command_id);

do $test$
declare
  file_name text:='DriveAroundMC-10-06404820261124064048.xlsx';
  export_at timestamptz:='2026-11-24T12:40:48Z';
  run_id uuid:='a3088000-0000-4000-8000-000000000004';
  current_ids text[]:=array['exact-b-f1','exact-b-s1'];
  before_revision bigint:=(select revision from public.app_dataset_revisions where key='ph_master_inventory');
  retired_row public.ph_master_inventory;
begin
  assert private.drive_workbook_export_at_v3088(file_name)=export_at;
  assert private.drive_workbook_export_at_v3088('CAV.xlsx') is null;
  begin
    perform private.assert_exact_drive_snapshot_size_v3088(1);
    raise exception 'Accepted a truncated workbook';
  exception when invalid_parameter_value then assert sqlerrm='DRIVE_SNAPSHOT_INCOMPLETE'; end;
  begin
    perform private.prune_absent_drive_inventory_v3088(array[]::text[],export_at,run_id);
    raise exception 'Accepted an empty membership proof';
  exception when invalid_parameter_value then assert sqlerrm='DRIVE_SNAPSHOT_MEMBERSHIP_INVALID'; end;

  select * into strict retired_row from public.ph_master_inventory where unique_id='exact-a-f1';
  assert retired_row.spec='Old spec' and retired_row.av_note='Archive this','fixture must contain published text evidence';
  perform set_config('app_sync.touched','{}',true);
  assert private.prune_absent_drive_inventory_v3088(current_ids,export_at,run_id)=3;
  assert not exists(select 1 from public.ph_master_inventory where unique_id in ('exact-a-f1','exact-a-s1','exact-split-old'));
  assert (select count(*)=4 from public.ph_master_inventory
    where unique_id in ('exact-b-f1','exact-b-s1','exact-split-new','exact-unrelated'));
  assert exists(select 1 from public.ph_master_inventory where unique_id='exact-b-f1' and spec='Surviving spec');
  assert exists(select 1 from public.ph_location_sales_notes where unique_id='exact-a-f1'
    and locationcode='A.01.000' and lotcode='27.F1' and av_note='Archive this' and spec='Old spec'
    and loc_match_pct is not distinct from retired_row.loc_match_pct),'archive must retain the actual physical row evidence';
  assert not exists(select 1 from app_sync_private.inventory_live_overrides_v1 where canonical_unique_id='exact-a-f1' and pending);
  assert exists(select 1 from private.ph_inventory_reclass_movements_v1
    where destination_unique_id='exact-split-old' and conflict_reason='source_retired_by_erp');
  assert exists(select 1 from private.ph_inventory_reclass_movements_v1 where destination_unique_id='exact-split-new' and status='pending');
  assert private.prune_absent_drive_inventory_v3088(current_ids,export_at,run_id)=0;
  assert (select revision>before_revision from public.app_dataset_revisions where key='ph_master_inventory');
  assert not has_function_privilege('authenticated','private.prune_absent_drive_inventory_v3088(text[],timestamptz,uuid)','EXECUTE');
end
$test$;

select 'EXACT_DRIVE_SNAPSHOT_PASS' as result;
rollback;

begin;
set local request.jwt.claims = '{"role":"service_role"}';
set local request.jwt.claim.role = 'service_role';

insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,source,contsize,
  erp_source_present,erp_source_filename,ptronhand,spec,av_note,loc_match_pct)
values ('native-ghost','NATIVE-EXACT','A.01.000','27.F1','HL','#2',false,'DriveAround-old.xlsx','140','Retired spec','Keep this',90);

do $native_publication$
declare
  run_id uuid:='a3088000-0000-4000-8000-000000000021';
  stage_uid uuid:='a3088000-0000-4000-8000-000000000023';
  file_name text:='DriveAroundMC-10-06404820261124064048.xlsx';
  result jsonb;
  current_rows jsonb:='[
    {"values":{"unique_id":"native-current-f1","itemcode":"NATIVE-EXACT","contsize":"#2","locationcode":"B.02.000","lotcode":"27.F1","source":"HL","ptronhand":"119","filename":"DriveAroundMC-10-06404820261124064048.xlsx"},"rawFields":[]},
    {"values":{"unique_id":"native-current-s1","itemcode":"NATIVE-EXACT","contsize":"#2","locationcode":"B.02.000","lotcode":"27.S1","source":"HL","ptronhand":"250","filename":"DriveAroundMC-10-06404820261124064048.xlsx"},"rawFields":[]}
  ]';
begin
  assert (public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory'])->>'ok')::boolean;
  result:=public.bulk_import_master_snapshot_v1(run_id,'a3088000-0000-4000-8000-000000000022',
    current_rows,encode(extensions.digest(current_rows::text,'sha256'),'hex'));
  assert (result->>'published')::boolean and (result->>'deleted')::integer=1;
  assert not exists(select 1 from public.ph_master_inventory where unique_id='native-ghost');
  assert exists(select 1 from public.ph_location_sales_notes where unique_id='native-ghost' and spec='Retired spec');
  assert (select count(*)=2 and sum(ptronhand::integer)=369 from public.ph_master_inventory
    where itemcode='NATIVE-EXACT' and locationcode='B.02.000');
  assert (select count(*)=2 from app_sync_private.ph_master_bulk_import_source_v1
    where import_run_id=run_id and canonical_unique_id in ('native-current-f1','native-current-s1'));

  assert (public.finish_dataset_import_with_sources_v1(run_id,jsonb_build_array(jsonb_build_object(
    'key','ph_master_inventory','fileName',file_name,'fileId','fixture-drive-file')))->>'ok')::boolean;
  perform set_config('request.headers','{}',true);
  insert into private.fast_erp_stage_runs_v1(stage_id,dataset_key,file_meta,source_fingerprint,expected_rows,staged_rows,
    stage_state,committed_result)
  values (stage_uid,'drive_around',jsonb_build_object('file_id','fixture-drive-file','file_name',file_name),
    'fixture-drive-source',2,2,'committed',result);
  insert into private.fast_erp_stage_rows_v1(stage_id,row_ordinal,unique_id,row_value)
  select stage_uid,ord,row_value->'values'->>'unique_id',row_value
  from jsonb_array_elements(current_rows) with ordinality x(row_value,ord);
  insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,source,contsize,
    erp_source_present,erp_source_filename,ptronhand)
  values ('native-repair-ghost','NATIVE-EXACT','A.01.000','27.F1','HL','#2',false,'DriveAround-old.xlsx','140');
  begin
    delete from private.fast_erp_stage_rows_v1 r where r.stage_id=stage_uid and r.row_ordinal=2;
    perform private.reconcile_published_drive_membership_v3088();
    raise exception 'Accepted a retained stage missing a row';
  exception when others then
    if sqlerrm<>'DRIVE_SNAPSHOT_ARCHIVED_MEMBERSHIP_INCOMPLETE' then raise; end if;
  end;
  assert exists(select 1 from public.ph_master_inventory where unique_id='native-repair-ghost');
  assert private.reconcile_published_drive_membership_v3088()=1;
  assert private.reconcile_published_drive_membership_v3088()=0;
end
$native_publication$;

select 'NATIVE_DRIVE_SNAPSHOT_PASS' as result;
rollback;
