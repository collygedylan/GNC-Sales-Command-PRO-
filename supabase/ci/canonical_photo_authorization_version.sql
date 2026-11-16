begin;
do $fixture$
begin
 if to_regclass('private.ci_schema_workspace_guard') is null then
 raise exception 'CANONICAL_PHOTO_VERSION_FIXTURE_ONLY'; end if;
 if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
 raise exception 'CANONICAL_PHOTO_VERSION_FIXTURE_ONLY'; end if;
end $fixture$;
insert into public.ph_app_settings(key,value,updated_by)
values('app_version','{"app_version":"3.0.72","release":"AgData v3.0.72"}','ci-photo-version-prerequisite')
on conflict(key) do update set value=ph_app_settings.value||excluded.value,updated_by=excluded.updated_by;
commit;
