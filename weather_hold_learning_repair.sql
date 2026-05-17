-- Repair Weather / Hold Risk learning functions.
-- Run this once in Supabase SQL Editor if the GitHub weather workflow fails with:
--   function digest(text, unknown) does not exist

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
end;
$$;

select public.v2_refresh_hold_learning_profiles() as refreshed_hold_learning_profiles;
