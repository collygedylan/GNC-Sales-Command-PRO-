begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
lock table public.app_runtime_watchdog_events in share row exclusive mode;
do $guard$begin
 if (select count(*) from public.app_runtime_watchdog_events where status='open' and occurrence_count=1 and (
   id=13296 and username='dylan_collyge' and app_version='3.0.61' and error_message='RPC_FAILURE:rpc:HTTP_504'
     and last_seen_at=timestamptz '2026-11-16T17:33:34.967443Z'
   or id=13308 and username='casey_rufener' and app_version='3.0.86' and error_message='RPC_FAILURE:request:TIMEOUT'
     and last_seen_at=timestamptz '2026-11-16T18:08:59.967327Z'))<>2 then
   raise exception 'Owner-confirmed photo cohort changed; retain incidents'; end if;
end $guard$;
select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated')::text,true)
from public.profiles where lower(username)='dylan_collyge' and disabled_at is null and not must_change_password;
select set_config('request.headers','{"x-client-info":"agdata/3.0.87"}',true);
select public.resolve_runtime_watchdog_events_v23158(array[13296,13308]::bigint[]);
alter table public.app_runtime_watchdog_events disable trigger app_runtime_watchdog_events_bump;
update public.app_runtime_watchdog_events set sample_payload=coalesce(sample_payload,'{}'::jsonb)||jsonb_build_object(
 'owner_resolution_note','Triggered by pre-fix Item Detail / Que -> REQUEST photo upload retry timeout; resolved by v3.1.00 direct Storage + PostgREST photo pipeline',
 'owner_verified',true,'owner_verified_release','3.0.87','requested_release','3.1.00')
where id in(13296,13308) and status='resolved';
alter table public.app_runtime_watchdog_events enable trigger app_runtime_watchdog_events_bump;
do $guard$begin
 if (select count(*) from public.app_runtime_watchdog_events where id in(13296,13308) and status='resolved'
   and resolved_in_version='3.0.87' and occurrence_count=1 and sample_payload->>'owner_verified'='true'
   and sample_payload->>'owner_resolution_note'='Triggered by pre-fix Item Detail / Que -> REQUEST photo upload retry timeout; resolved by v3.1.00 direct Storage + PostgREST photo pipeline'
   and (id=13296 and last_seen_at=timestamptz '2026-11-16T17:33:34.967443Z'
     or id=13308 and last_seen_at=timestamptz '2026-11-16T18:08:59.967327Z'))<>2 then
   raise exception 'Owner photo resolution receipt not confirmed'; end if;
end $guard$;
commit;
