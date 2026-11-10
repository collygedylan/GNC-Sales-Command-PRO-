-- Run after the reserve handover fixture in the same local rollback.
-- Reuse the live trigger definition without invoking unrelated SOC writers.
create temporary table ph_soc_master (like public.ph_soc_master including defaults);
create unique index on pg_temp.ph_soc_master(unique_id);
do $trigger$
declare definition text;
begin
  select pg_get_triggerdef(oid) into strict definition from pg_trigger
  where tgrelid='public.ph_soc_master'::regclass and tgname='scheduled_handover_normalize_assignment';
  execute regexp_replace(definition,' ON (public[.])?ph_soc_master ',' ON pg_temp.ph_soc_master ');
end
$trigger$;

insert into pg_temp.ph_soc_master(unique_id,assignedto,flyer_assigned,date_completed,flyer_completed) values
  ('erp-soc-handover-null',null,null,null,null),
  ('erp-soc-handover-clear','explicit_owner',null,null,null),
  ('erp-soc-handover-live','kayla_knepp','kayla.knepp',null,null),
  ('erp-soc-handover-complete','kayla_knepp','kayla_knepp','2026-11-01','2026-11-01'),
  ('erp-soc-handover-blank','',null,null,null);
insert into pg_temp.ph_soc_master(unique_id,lotcode) values ('erp-soc-handover-clear','28.F1')
on conflict(unique_id) do update set lotcode=excluded.lotcode;
do $preserve$
begin
  if not exists(select 1 from pg_temp.ph_soc_master where unique_id='erp-soc-handover-clear'
      and assignedto='explicit_owner' and lotcode='28.F1') then
    raise exception 'ERP_SOC_HANDOVER_NULL_IMPORT_LOST_EXPLICIT_OWNER';
  end if;
end
$preserve$;
update pg_temp.ph_soc_master set assignedto=null,flyer_assigned=null where unique_id='erp-soc-handover-clear';

do $assert$
begin
  if exists(select 1 from reserve_handover_calls where unique_id='erp-soc-handover-null')
    or (select count(*) from reserve_handover_calls where unique_id='erp-soc-handover-clear')<>1
    or (select count(*) from reserve_handover_calls where unique_id like 'erp-soc-handover-%')<>4 then
    raise exception 'ERP_SOC_HANDOVER_NOOP_INVOKED_GENERIC_TRIGGER';
  end if;
  if not exists(select 1 from pg_temp.ph_soc_master where unique_id='erp-soc-handover-live'
      and assignedto='nelly_aguilar' and flyer_assigned='nelly_aguilar')
    or not exists(select 1 from pg_temp.ph_soc_master where unique_id='erp-soc-handover-complete'
      and assignedto='kayla_knepp' and flyer_assigned='kayla_knepp')
    or not exists(select 1 from pg_temp.ph_soc_master where unique_id='erp-soc-handover-clear'
      and assignedto is null and flyer_assigned is null)
    or not exists(select 1 from pg_temp.ph_soc_master where unique_id='erp-soc-handover-blank' and assignedto='')
    or (select count(*) from private.scheduled_account_handover_audit_v1
      where event_key like 'future:ph_soc_master:erp-soc-handover-%')<>1
    or not exists(select 1 from private.scheduled_account_handover_audit_v1
      where event_key like 'future:ph_soc_master:erp-soc-handover-live:%'
        and metadata->'after'='{"assignedto":"nelly_aguilar","flyer_assigned":"nelly_aguilar"}'::jsonb) then
    raise exception 'ERP_SOC_HANDOVER_CHANGED_ASSIGNMENT_OR_AUDIT';
  end if;
end
$assert$;
