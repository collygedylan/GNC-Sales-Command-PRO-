select set_config('request.jwt.claim.role','service_role',true);
select set_config('agdata.bulk_import.ph_master_inventory','on',true);
insert into public.ph_eval_assignment_users(username,display_name,active)
values('mitch_kaiser','Mitch',true),('zoe_green','Zoe',true)
on conflict(username) do update set active=true;
update public.profiles set disabled_at=null,locked_until=null where username in ('mitch_kaiser','zoe_green');
insert into public.ph_itemcode_default_owners(itemcode_normalized,assignedto,assigned_at,revision,updated_by)
values('ERP64-OWNER','mitch_kaiser','2026-11-10T12:00:00Z',7,'fixture');
create temporary table erp64_owner_before as select * from public.ph_itemcode_default_owners where itemcode_normalized='ERP64-OWNER';
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,source)
values('erp64-owner-inside','ERP64-OWNER','Fixture','#2','C.06.002','28.F1','PH'),
  ('erp64-owner-outside','ERP64-OWNER','Fixture','#2','X.91.007','28.F1','PH');
select set_config('agdata.bulk_import.ph_master_inventory','off',true);
create temporary table erp64_owner_source as select * from public.ph_master_inventory where unique_id like 'erp64-owner-%';
do $scope$
declare definition text;
begin
  definition:=pg_get_functiondef('private.plan_drive_row_assignments_v3047(bigint)'::regprocedure);
  execute replace(definition,'from public.ph_master_inventory','from pg_temp.erp64_owner_source');
  definition:=pg_get_functiondef('private.reconcile_drive_row_assignments_v3047(uuid)'::regprocedure);
  execute replace(definition,'where a.present_in_drive and not exists',
    'where a.master_unique_id like ''erp64-owner-%'' and a.present_in_drive and not exists');
end
$scope$;
do $verify$
declare run uuid:=gen_random_uuid(); result jsonb;
begin
  result:=public.begin_dataset_import_v1(array['ph_master_inventory'],run,array['ph_master_inventory']);
  assert result->>'state'='active';
  perform private.reconcile_drive_row_assignments_v3047(run);
  assert exists(select 1 from public.ph_inventory_row_assignments where master_unique_id='erp64-owner-inside'
    and assignedto='zoe_green' and assignment_reason='zone_zoe');
  assert exists(select 1 from public.ph_inventory_row_assignments where master_unique_id='erp64-owner-outside'
    and assignedto='mitch_kaiser' and assignment_reason='itemcode_default');
  assert exists(select 1 from public.ph_master_inventory where unique_id='erp64-owner-inside'
    and default_owner='mitch_kaiser' and effective_worker='zoe_green');
  assert exists(select 1 from public.ph_master_inventory where unique_id='erp64-owner-outside'
    and default_owner='mitch_kaiser' and effective_worker='mitch_kaiser');
  assert (select to_jsonb(before)=to_jsonb(after) from erp64_owner_before before
    join public.ph_itemcode_default_owners after using(itemcode_normalized)), 'default ledger must remain exact';
end
$verify$;
