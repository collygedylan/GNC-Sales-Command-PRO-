begin;
set local lock_timeout='1500ms';
set local statement_timeout='15s';
alter table public.ph_app_health_events add column if not exists resolved boolean not null default false,
 add column if not exists resolved_at timestamptz, add column if not exists resolved_in_version text;
create or replace function private.app_version_precedes_v1(observed text, canonical text)
returns boolean language sql immutable set search_path='' as $$
 select coalesce((regexp_match(observed,'^(?:AgData\s+v|v)?([0-9]{1,6})\.([0-9]{1,6})\.([0-9]{1,6})$','i'))::integer[]
 < (regexp_match(canonical,'^(?:AgData\s+v|v)?([0-9]{1,6})\.([0-9]{1,6})\.([0-9]{1,6})$','i'))::integer[],false)
$$;
revoke all on function private.app_version_precedes_v1(text,text) from public,anon,authenticated;
create or replace function private.resolve_superseded_client_event_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare canonical text;
begin
 select value->>'app_version' into canonical from public.ph_app_settings where key='app_version';
 if tg_table_name='app_runtime_watchdog_events' then
  if private.app_version_precedes_v1(new.app_version,canonical) then
   new.status:='resolved';new.resolved_at:=coalesce(new.resolved_at,now());new.resolved_in_version:=canonical;
  end if;
 else
  if private.app_version_precedes_v1(new.app_build,canonical) then
   new.resolved:=true;new.resolved_at:=coalesce(new.resolved_at,now());new.resolved_in_version:=canonical;
  end if;
 end if;
 return new;
end;
$$;
revoke all on function private.resolve_superseded_client_event_v1() from public,anon,authenticated;
drop trigger if exists zz_resolve_superseded_client_event on public.app_runtime_watchdog_events;
create trigger zz_resolve_superseded_client_event before insert or update on public.app_runtime_watchdog_events for each row execute function private.resolve_superseded_client_event_v1();
drop trigger if exists resolve_superseded_client_event on public.ph_app_health_events;
create trigger resolve_superseded_client_event before insert or update on public.ph_app_health_events for each row execute function private.resolve_superseded_client_event_v1();
insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('app_version',jsonb_build_object('release','AgData v2.3.141','app_version','2.3.141'),'client-cutover-release',now())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
update public.app_runtime_watchdog_events set status='resolved',resolved_at=coalesce(resolved_at,now()),resolved_in_version='2.3.141'
where status='open' and private.app_version_precedes_v1(app_version,'2.3.141');
update public.ph_app_health_events set resolved=true,resolved_at=coalesce(resolved_at,now()),resolved_in_version='2.3.141'
where not resolved and private.app_version_precedes_v1(app_build,'2.3.141');
notify pgrst,'reload schema';
commit;
