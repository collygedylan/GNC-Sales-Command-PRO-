create temporary table master_eval_guard_probe (like public.ph_master_inventory including defaults);
create trigger evidence_before before insert on master_eval_guard_probe
  for each row execute function private.apply_inventory_location_evidence_v1();
create trigger evidence_projection before insert on master_eval_guard_probe
  for each row execute function private.sync_master_inventory_canonical_v2362();
select set_config('request.jwt.claim.role','service_role',true);
select set_config('app.eval_publication_v309','on',true);
select set_config('app.eval_publication_uid_v309','erp-guard-exact',true);
insert into master_eval_guard_probe(unique_id,itemcode,locationcode,lotcode,ptronhand,initial_ptr,spec,loc_photo_match)
values ('erp-guard-exact','ERP-GUARD-3047','X.92.001','28.F1','100','200','saved exact',20),
  ('erp-guard-other','ERP-GUARD-3047','X.92.002','28.F1','100','200','saved other',20);
select set_config('app.eval_publication_v309','',true);
insert into master_eval_guard_probe(unique_id,itemcode,locationcode,lotcode,ptronhand,initial_ptr,spec,loc_photo_match)
values ('erp-guard-no-marker','ERP-GUARD-3047','X.92.003','28.F1','100','210','saved normal',20);

select set_config('agdata.bulk_import.ph_master_inventory','on',true);
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,ptronhand,initial_ptr)
values ('erp-guard-bulk','ERP-GUARD-3047','X.92.004','28.F1','100','225');
update public.ph_master_inventory set av_note='fixture bulk text' where unique_id='erp-guard-bulk';
select set_config('agdata.bulk_import.ph_master_inventory','off',true);

do $test$
begin
  if not exists(select 1 from master_eval_guard_probe where unique_id='erp-guard-exact'
      and spec='saved exact' and baseline_on_hand is null)
    or not exists(select 1 from master_eval_guard_probe where unique_id='erp-guard-other' and baseline_on_hand=200)
    or not exists(select 1 from master_eval_guard_probe where unique_id='erp-guard-no-marker' and baseline_on_hand=210) then
    raise exception 'ERP_MASTER_EVAL_EXACT_OR_NORMAL_PATH_CHANGED';
  end if;
  if not exists(select 1 from public.ph_master_inventory where unique_id='erp-guard-bulk' and baseline_on_hand is null)
    or exists(select 1 from app_sync_private.inventory_location_evidence_v1 where source_unique_id='erp-guard-bulk') then
    raise exception 'ERP_MASTER_EVAL_BULK_CAPTURE_CHANGED';
  end if;
end
$test$;

select set_config('app.eval_publication_v309','on',true);
select set_config('app.eval_publication_uid_v309','erp-guard-bulk',true);
select set_config('gnc.inventory_edit_actor','erp_guard_fixture_actor',true);
update public.ph_master_inventory set av_note='fixture interactive text' where unique_id='erp-guard-bulk';
do $test$
begin
  if not exists(select 1 from app_sync_private.inventory_location_evidence_v1
    where source_unique_id='erp-guard-bulk' and av_note='fixture interactive text' and updated_by='erp_guard_fixture_actor') then
    raise exception 'ERP_MASTER_EVAL_CAPTURE_ACTOR_CHANGED';
  end if;
end
$test$;
