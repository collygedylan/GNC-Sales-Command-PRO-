insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
  ('e3048000-0000-4000-8000-000000000271','reserve-handover-from@example.invalid','{}','{}'),
  ('e3048000-0000-4000-8000-000000000272','reserve-handover-to@example.invalid','{}','{}');
insert into public.profiles(id,username,display_name,role) values
  ('e3048000-0000-4000-8000-000000000271','reserve_fixture_from','Reserve Fixture From','REP'),
  ('e3048000-0000-4000-8000-000000000272','reserve_fixture_to','Reserve Fixture To','REP');
insert into private.scheduled_account_handover_v1(transition_key,departing_profile_id,successor_profile_id,effective_at)
values('kayla_knepp_to_nelly_aguilar_20261002','e3048000-0000-4000-8000-000000000271',
  'e3048000-0000-4000-8000-000000000272','2026-10-03T04:00:00Z')
on conflict(transition_key) do update set effective_at=excluded.effective_at;

create temporary table reserve_handover_calls (unique_id text);
do $probe$
declare definition text := pg_get_functiondef('private.handover_normalize_assignment_v1()'::regprocedure);
  start_at integer := strpos(definition,'begin'||chr(10));
begin
  execute overlay(definition placing E'  insert into pg_temp.reserve_handover_calls values(new.unique_id);\n'
    from start_at+length('begin'||chr(10)) for 0);
end
$probe$;
select set_config('request.jwt.claim.role','service_role',true),set_config('agdata.fast_erp_defer_history','on',true);

insert into public.ph_reserves(unique_id,assignedto,assigned_to,flyer_assigned,date_completed,flyer_completed) values
  ('erp-reserve-handover-null',null,null,null,null,null),
  ('erp-reserve-handover-clear','explicit_owner',null,null,null,null),
  ('erp-reserve-handover-live','kayla_knepp','kayla.knepp','kayla_knepp',null,null),
  ('erp-reserve-handover-complete','kayla_knepp','kayla_knepp','kayla_knepp','2026-11-01','2026-11-01'),
  ('erp-reserve-handover-blank','',null,null,null,null);
insert into public.ph_reserves(unique_id,lotcode) values ('erp-reserve-handover-clear','28.F1')
on conflict(unique_id) do update set lotcode=excluded.lotcode;
do $preserve$
begin
  if not exists(select 1 from public.ph_reserves where unique_id='erp-reserve-handover-clear'
      and assignedto='explicit_owner' and lotcode='28.F1') then
    raise exception 'ERP_RESERVE_HANDOVER_NULL_IMPORT_LOST_EXPLICIT_OWNER';
  end if;
end
$preserve$;
update public.ph_reserves set assignedto=null,assigned_to=null,flyer_assigned=null
where unique_id='erp-reserve-handover-clear';

do $assert$
begin
  if exists(select 1 from reserve_handover_calls where unique_id='erp-reserve-handover-null')
    or (select count(*) from reserve_handover_calls where unique_id='erp-reserve-handover-clear')<>1
    or (select count(*) from reserve_handover_calls)<>4 then
    raise exception 'ERP_RESERVE_HANDOVER_NOOP_INVOKED_GENERIC_TRIGGER';
  end if;
  if not exists(select 1 from public.ph_reserves where unique_id='erp-reserve-handover-live'
      and assignedto='nelly_aguilar' and assigned_to='nelly_aguilar' and flyer_assigned='nelly_aguilar')
    or not exists(select 1 from public.ph_reserves where unique_id='erp-reserve-handover-complete'
      and assignedto='kayla_knepp' and assigned_to='kayla_knepp' and flyer_assigned='kayla_knepp')
    or not exists(select 1 from public.ph_reserves where unique_id='erp-reserve-handover-clear'
      and assignedto is null and assigned_to is null and flyer_assigned is null)
    or not exists(select 1 from public.ph_reserves where unique_id='erp-reserve-handover-blank' and assignedto='')
    or (select count(*) from private.scheduled_account_handover_audit_v1
      where event_key like 'future:ph_reserves:erp-reserve-handover-%')<>1
    or not exists(select 1 from private.scheduled_account_handover_audit_v1
      where event_key like 'future:ph_reserves:erp-reserve-handover-live:%'
        and metadata->'after'='{"assignedto":"nelly_aguilar","assigned_to":"nelly_aguilar","flyer_assigned":"nelly_aguilar"}'::jsonb) then
    raise exception 'ERP_RESERVE_HANDOVER_CHANGED_ASSIGNMENT_OR_AUDIT';
  end if;
end
$assert$;
