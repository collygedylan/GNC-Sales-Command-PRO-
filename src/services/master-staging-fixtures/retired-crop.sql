select ok((select count(*)=3 and bool_and(tgenabled='D') from pg_trigger
    where tgrelid='public.ph_master_inventory'::regclass and tgname=any(array[
      'trg_v2_master_inventory_crop_roll_drive_rows','trg_v2_master_inventory_crop_roll_drive_rows_insert',
      'trg_v2_master_inventory_crop_roll_drive_rows_delete']))
  and (select bool_and(pg_get_functiondef(oid) !~ 'sync_ph_master_bulk_crop_roll_v1|master_bulk_crop_roll_deferred')
    from pg_proc where oid=any(array[
      'public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure,
      'public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure]))
  and (select prosecdef from pg_proc where oid='private.sync_ph_master_bulk_crop_roll_v1(uuid,uuid,text[])'::regprocedure),
  'registered retirement keeps exactly three crop hooks disabled and both publishers free of retired projection calls');

create or replace function pg_temp.v2313_forged_marker_case()
returns jsonb language plpgsql as $forged$
declare
  uid text:='v2313-context-forged'; inserted boolean; updated boolean; deleted boolean;
begin
  perform set_config('gnc.master_snapshot_verified_insert',pg_backend_pid()::text||':'||txid_current()::text,true);
  insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,source,warehouseid)
  values(uid,'FORGED-CROP','Original forged marker row','#1','Z.98.010','27.CANARY','PH','10');
  inserted:=current_setting('gnc.master_snapshot_verified_insert',true)=''
    and exists(select 1 from public.ph_master_inventory where unique_id=uid and commonname='Original forged marker row')
    and not exists(select 1 from public.ph_crop_roll_drive_rows where master_unique_id=uid);
  perform set_config('gnc.master_snapshot_verified_insert',pg_backend_pid()::text||':'||txid_current()::text,true);
  update public.ph_master_inventory set commonname='Updated forged marker row' where unique_id=uid;
  updated:=exists(select 1 from public.ph_master_inventory where unique_id=uid and commonname='Updated forged marker row')
    and not exists(select 1 from public.ph_crop_roll_drive_rows where master_unique_id=uid);
  perform set_config('gnc.master_snapshot_verified_insert',pg_backend_pid()::text||':'||txid_current()::text,true);
  delete from public.ph_master_inventory where unique_id=uid;
  deleted:=not exists(select 1 from public.ph_master_inventory where unique_id=uid)
    and not exists(select 1 from public.ph_crop_roll_drive_rows where master_unique_id=uid);
  return jsonb_build_object('insert',inserted,'update',updated,'delete',deleted);
end $forged$;
