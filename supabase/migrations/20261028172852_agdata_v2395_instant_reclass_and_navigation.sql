begin;

-- The production move was already committed through the canonical atomic Reclass
-- command. Refuse to replay it, and preserve the exact committed three-row state.
do $verify_reclass_move$
declare
  target regprocedure := 'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure;
begin
  if target is null
    or not has_function_privilege('service_role', target, 'execute')
    or has_function_privilege('authenticated', target, 'execute')
    or has_function_privilege('anon', target, 'execute') then
    raise exception 'AGDATA_V2395_RECLASS_RPC_CONTRACT_MISSING';
  end if;

  if not exists (
      select 1 from public.app_dataset_revisions
      where key = 'ph_master_inventory' and state = 'ready'
    )
    or (select count(*) from public.ph_master_inventory
        where btrim(itemcode) = '006192.010.1'
          and (locationcode, lotcode, ptronhand, ptrreviewed, ptravailable, s_lts) in (
            ('C.16.000','27.F1','220','0','220','150'),
            ('C.16.000','27.S1','324','0','324','4074'),
            ('H.03.000','27.S1','4000','0','4000','4074')
          )) <> 3
    or (select coalesce(sum(nullif(regexp_replace(ptronhand, '[^0-9.-]', '', 'g'), '')::numeric), 0)
        from public.ph_master_inventory
        where btrim(itemcode) = '006192.010.1' and locationcode = 'C.16.000') <> 544
    or (select coalesce(sum(nullif(regexp_replace(ptronhand, '[^0-9.-]', '', 'g'), '')::numeric), 0)
        from public.ph_master_inventory
        where btrim(itemcode) = '006192.010.1' and locationcode = 'H.03.000') <> 4000 then
    raise exception 'AGDATA_V2395_RECLASS_MOVE_STATE_MISMATCH';
  end if;
end $verify_reclass_move$;

insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('app_version',jsonb_build_object('release','AgData v2.3.95','app_version','2.3.95'),'release-v2.3.95',clock_timestamp())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

do $verify$
begin
  if not exists(select 1 from public.ph_app_settings where key='app_version' and value->>'app_version'='2.3.95') then
    raise exception 'AGDATA_V2395_INSTALL_FAILED';
  end if;
end $verify$;

commit;
