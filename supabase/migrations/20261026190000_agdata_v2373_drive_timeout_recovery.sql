begin;

set local lock_timeout='5s';
set local statement_timeout='120s';

alter function public.fast_ingest_drive_around_v1(jsonb,jsonb)
  set statement_timeout='120s';

do $v2373_drive_timeout_contract$
declare
  function_settings text[];
begin
  select proconfig into function_settings
  from pg_proc
  where oid='public.fast_ingest_drive_around_v1(jsonb,jsonb)'::regprocedure;

  if not coalesce(function_settings @> array['statement_timeout=120s'],false) then
    raise exception using errcode='55000',message='V2373_DRIVE_TIMEOUT_RECOVERY_MISSING';
  end if;
end
$v2373_drive_timeout_contract$;

notify pgrst,'reload schema';

commit;
