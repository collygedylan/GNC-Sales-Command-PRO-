-- Fix pgcrypto digest() lookup for hold-learning functions.
-- Safe to run more than once.
--
-- This repairs errors like:
--   function digest(text, unknown) does not exist
--
-- Cause:
--   pgcrypto is installed in the extensions schema, but one or more
--   SECURITY DEFINER functions were created without extensions in the
--   function search_path.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if to_regprocedure('public.v2_capture_hold_learning_event()') is not null then
    execute 'alter function public.v2_capture_hold_learning_event() set search_path = public, extensions';
  end if;

  if to_regprocedure('public.v2_refresh_hold_learning_weather_features(integer)') is not null then
    execute 'alter function public.v2_refresh_hold_learning_weather_features(integer) set search_path = public, extensions';
  end if;

  if to_regprocedure('public.v2_refresh_hold_learning_profiles()') is not null then
    execute 'alter function public.v2_refresh_hold_learning_profiles() set search_path = public, extensions';
  end if;

  if to_regprocedure('public.v2_refresh_hold_learning_from_drive_around_rows(integer)') is not null then
    execute 'alter function public.v2_refresh_hold_learning_from_drive_around_rows(integer) set search_path = public, extensions';
  end if;

  if to_regprocedure('public.v2_refresh_hold_learning_from_drive_around_rows_range(date,date,integer)') is not null then
    execute 'alter function public.v2_refresh_hold_learning_from_drive_around_rows_range(date,date,integer) set search_path = public, extensions';
  end if;
end;
$$;

select
  n.nspname as digest_schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'digest'
order by n.nspname, p.proname;
