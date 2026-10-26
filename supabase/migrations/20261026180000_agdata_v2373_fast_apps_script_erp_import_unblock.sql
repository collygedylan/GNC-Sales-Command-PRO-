begin;

set local lock_timeout='5s';
set local statement_timeout='120s';

drop trigger if exists ph_drive_around_report_state_merge_v2366 on public.ph_drive_around_report_rows;

create index if not exists ph_drive_around_report_rows_file_unique_v2373
  on public.ph_drive_around_report_rows(file_id,unique_id);

alter role anon set statement_timeout='120s';
alter role authenticated set statement_timeout='120s';
alter role authenticator set statement_timeout='120s';
alter role service_role set statement_timeout='120s';

grant select,insert,update,delete on table
  public.ph_master_inventory,
  public.ph_cav_import,
  public.ph_soc_master,
  public.ph_reserves,
  public.ph_drive_around_report_files,
  public.ph_drive_around_report_rows,
  public.app_dataset_revisions,
  public.app_manual_sync_status,
  public.ph_warehouse_assigned_items,
  public.ph_request_delivery_outbox
to service_role;

revoke insert,update,delete on table
  public.ph_master_inventory,
  public.ph_cav_import,
  public.ph_soc_master,
  public.ph_reserves,
  public.ph_drive_around_report_files,
  public.ph_drive_around_report_rows,
  public.app_dataset_revisions,
  public.app_manual_sync_status,
  public.ph_warehouse_assigned_items,
  public.ph_request_delivery_outbox
from anon,authenticated;

insert into public.ph_app_settings(key,value,updated_by,updated_at)
values ('app_version',jsonb_build_object('app_version','2.3.73','release','AgData v2.3.73'),'release-v2.3.73',now())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

notify pgrst,'reload config';

do $v2373_contract$
begin
  if exists(select 1 from pg_trigger where tgrelid='public.ph_drive_around_report_rows'::regclass
      and tgname='ph_drive_around_report_state_merge_v2366' and not tgisinternal) then
    raise exception using errcode='55000',message='V2373_DRIVE_ARCHIVE_ROW_TRIGGER_REMAINS';
  end if;
  if position('ph_master_bulk_crop_roll_defer_active_v1' in pg_get_functiondef(
      'public.upsert_v2_crop_roll_drive_row_from_master()'::regprocedure))=0 then
    raise exception using errcode='55000',message='V2373_MASTER_BULK_CROP_DEFER_MISSING';
  end if;
  if not has_table_privilege('service_role','public.ph_master_inventory','insert,update,delete')
     or not has_table_privilege('service_role','public.ph_drive_around_report_rows','insert,update,delete')
     or has_table_privilege('anon','public.ph_master_inventory','insert,update,delete')
     or has_table_privilege('authenticated','public.ph_master_inventory','insert,update,delete') then
    raise exception using errcode='42501',message='V2373_IMPORT_PRIVILEGE_CONTRACT_FAILED';
  end if;
end
$v2373_contract$;

commit;
