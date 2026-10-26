begin;

update public.ph_soc_master
set suspend='SUSPEND',
  suspend_to='dc'
where upper(btrim(coalesce(suspend,'')))='SUSPEND'
  and lower(btrim(coalesce(suspend_to,'')))='dc'
  and (suspend is distinct from 'SUSPEND' or suspend_to is distinct from 'dc');

grant select on public.ph_active_suspend to anon,authenticated,service_role;

insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('app_version',jsonb_build_object('app_version','2.3.77','release','AgData v2.3.77'),'release-v2.3.77',now())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

notify pgrst,'reload schema';
notify pgrst,'reload config';

do $v2377_contract$
begin
  if not coalesce((select reloptions @> array['security_invoker=true'] from pg_class
    where oid='public.ph_active_suspend'::regclass),false) then
    raise exception 'SUSPEND_SECURITY_INVOKER_MISSING';
  end if;
  if not has_table_privilege('anon','public.ph_active_suspend','select') then
    raise exception 'SUSPEND_ANON_READ_MISSING';
  end if;
  if (select count(*) from public.ph_active_suspend)<>(select count(*) from public.ph_soc_master
    where upper(btrim(coalesce(suspend,'')))='SUSPEND'
      and lower(btrim(coalesce(suspend_to,'')))='dc'
      and date_completed is null
      and lower(btrim(coalesce(suspend_candidate_state,'pending'))) not in ('complete','completed','approved','rejected')) then
    raise exception 'SUSPEND_ACTIVE_COUNT_MISMATCH';
  end if;
end
$v2377_contract$;

commit;
