-- Run after the focused native semantic-delta fixture in the same rollback
-- transaction to check its two exact ERP publications as well as live edits.
do $retired$
begin
  if exists(select 1 from public.ph_crop_roll_drive_rows where master_unique_id like 'erp-delta-fixture-%') then
    raise exception 'ERP_RETIRED_CROP_ROLL_RECEIVED_NATIVE_PUBLICATION';
  end if;
end
$retired$;

select set_config('request.headers','{}',true);
select set_config('request.jwt.claim.role','service_role',true);
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,ptronhand,spec)
values ('erp-crop-retired-live','ERP-CROP-RETIRED','D.08.000','28.F1','7','Original spec');

insert into public.ph_crop_roll_drive_rows(unique_id,master_unique_id,itemcode,locationcode,source_table,crop_roll_view,spec)
values ('erp-crop-retired-history','erp-crop-retired-live','ERP-CROP-RETIRED','D.08.000','ph_master_inventory','drive','Historical spec');

update public.ph_master_inventory set spec='Updated spec',av_note='Fixture exact AV note',ptronhand='8'
where unique_id='erp-crop-retired-live';
do $interactive$
begin
  if not exists(select 1 from public.ph_master_inventory where unique_id='erp-crop-retired-live'
    and spec='Updated spec' and av_note='Fixture exact AV note' and ptronhand='8')
    or (select count(*) from public.ph_crop_roll_drive_rows where master_unique_id='erp-crop-retired-live')<>1
    or not exists(select 1 from public.ph_crop_roll_drive_rows where unique_id='erp-crop-retired-history' and spec='Historical spec') then
    raise exception 'ERP_CROP_ROLL_RETIREMENT_CHANGED_LIVE_OR_HISTORICAL_DATA';
  end if;
end
$interactive$;

delete from public.ph_master_inventory where unique_id='erp-crop-retired-live';
do $history$
begin
  if not exists(select 1 from public.ph_crop_roll_drive_rows where unique_id='erp-crop-retired-history' and spec='Historical spec') then
    raise exception 'ERP_RETIRED_CROP_ROLL_HISTORY_WAS_REMOVED';
  end if;
end
$history$;
