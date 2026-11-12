\set ON_ERROR_STOP on
create extension if not exists dblink;
create schema private;
create schema cron;
create table cron.job(jobid bigint primary key,jobname text,schedule text,database text,username text,active boolean,command text);
create table private.wake_calls(source text);
create table public.ph_request_delivery_outbox(status text,next_attempt_at timestamptz,lease_expires_at timestamptz);
insert into cron.job values (45,'gnc-request-delivery-worker','* * * * *','postgres','postgres',true,
  'select private.wake_request_delivery_worker_now(''cron'')');
create function private.wake_request_delivery_worker_now(p_source text) returns bigint language plpgsql as $wake$
begin
  insert into private.wake_calls values(p_source);
  return 42;
end
$wake$;
create function cron.alter_job(job_id bigint,schedule text default null,command text default null,
  database text default null,username text default null,active boolean default null) returns void language sql as $alter$
  update cron.job j set command=coalesce(alter_job.command,j.command) where j.jobid=alter_job.job_id
$alter$;
grant usage,create on schema private to postgres;
grant usage on schema cron to postgres;
grant all on cron.job to postgres;
set role postgres;
\ir ../../supabase/migrations/20261112022023_agdata3078_delivery_cron_single_flight.sql
\ir ../../supabase/migrations/20261112022023_agdata3078_delivery_cron_single_flight.sql
reset role;

do $check$
declare source text; calls integer;
begin
  if not exists(select 1 from cron.job where jobid=45 and jobname='gnc-request-delivery-worker'
    and schedule='* * * * *' and database='postgres' and username='postgres' and active
    and command='select private.dispatch_request_delivery_worker_cron()') then
    raise exception 'cron identity or schedule changed';
  end if;
  if has_function_privilege('anon','private.dispatch_request_delivery_worker_cron()','EXECUTE')
    or has_function_privilege('authenticated','private.dispatch_request_delivery_worker_cron()','EXECUTE')
    or has_function_privilege('service_role','private.dispatch_request_delivery_worker_cron()','EXECUTE') then
    raise exception 'cron dispatch privilege widened';
  end if;
  perform dblink_connect('lock_holder',format('dbname=%L user=%L',current_database(),current_user));
  perform dblink_exec('lock_holder','begin');
  perform locked from dblink('lock_holder',
    $query$select pg_advisory_xact_lock(hashtextextended('agdata:delivery-cron-wake:v3078',0)),true$query$)
    as held(ignored text,locked boolean);
  if private.dispatch_request_delivery_worker_cron() is not null then raise exception 'contender dispatched'; end if;
  if exists(select 1 from private.wake_calls) then raise exception 'contender issued wake'; end if;
  perform dblink_exec('lock_holder','commit');
  perform dblink_disconnect('lock_holder');
  if private.dispatch_request_delivery_worker_cron()<>42 then raise exception 'idle cron wake lost'; end if;
  insert into public.ph_request_delivery_outbox values
    ('pending',now()-interval '1 minute',null),('pending',now()+interval '1 hour',null),
    ('processing',null,now()-interval '1 minute'),('processing',null,now()+interval '1 hour');
  if private.dispatch_request_delivery_worker_cron()<>42 then raise exception 'outbox cron wake lost'; end if;
  select count(*),min(w.source) into calls,source from private.wake_calls w;
  if calls<>2 or source<>'cron' then raise exception 'cron source or cadence changed'; end if;
end
$check$;
