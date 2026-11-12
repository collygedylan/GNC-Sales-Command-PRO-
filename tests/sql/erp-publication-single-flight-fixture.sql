\set ON_ERROR_STOP on
create extension if not exists dblink;
create schema private;
create table private.erp_stage_publication_jobs_v3042(stage_id uuid primary key, attempts integer not null default 0);
insert into private.erp_stage_publication_jobs_v3042(stage_id) values
  ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
create function private.run_erp_stage_publication_v3042(p_stage_id uuid) returns void
language plpgsql set search_path = '' as $worker$
declare job private.erp_stage_publication_jobs_v3042%rowtype;
begin
  select * into job from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id for update skip locked;
  if not found then return; end if;
  update private.erp_stage_publication_jobs_v3042 set attempts=attempts+1 where stage_id=p_stage_id;
end
$worker$;
revoke all on function private.run_erp_stage_publication_v3042(uuid) from public;
create temporary table original_definition as
  select pg_get_functiondef('private.run_erp_stage_publication_v3042(uuid)'::regprocedure) as definition;
\ir ../../supabase/migrations/20261112021631_agdata3078_publication_single_flight.sql
\ir ../../supabase/migrations/20261112021631_agdata3078_publication_single_flight.sql

do $check$
declare definition text; original text; started timestamptz;
begin
  select pg_get_functiondef('private.run_erp_stage_publication_v3042(uuid)'::regprocedure),o.definition
    into definition,original from original_definition o;
  if replace(definition,E'  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(''agdata:erp-publication-worker:v3078'',0)) then return; end if;\n','') <> original then
    raise exception 'worker changed beyond the single-flight guard';
  end if;
  if has_function_privilege('public','private.run_erp_stage_publication_v3042(uuid)','execute') then
    raise exception 'worker privileges changed';
  end if;
  perform dblink_connect('lock_holder',format('dbname=%L user=%L',current_database(),current_user));
  perform dblink_exec('lock_holder','begin');
  perform locked from dblink('lock_holder',
    $query$select pg_advisory_xact_lock(hashtextextended('agdata:erp-publication-worker:v3078',0)),true$query$)
    as held(ignored text,locked boolean);
  started:=clock_timestamp();
  perform private.run_erp_stage_publication_v3042('00000000-0000-0000-0000-000000000001');
  if clock_timestamp()-started > interval '100 milliseconds' then raise exception 'contender waited'; end if;
  if exists(select 1 from private.erp_stage_publication_jobs_v3042 where attempts<>0) then
    raise exception 'contender performed work';
  end if;
  perform dblink_exec('lock_holder','commit');
  perform dblink_disconnect('lock_holder');
end
$check$;

do $check$
begin
  perform dblink_connect('row_holder',format('dbname=%L user=%L',current_database(),current_user));
  perform dblink_exec('row_holder','begin');
  perform stage_id from dblink('row_holder',
    $query$select stage_id from private.erp_stage_publication_jobs_v3042
      where stage_id='00000000-0000-0000-0000-000000000001' for update$query$) as held(stage_id uuid);
  perform private.run_erp_stage_publication_v3042('00000000-0000-0000-0000-000000000001');
  perform private.run_erp_stage_publication_v3042('00000000-0000-0000-0000-000000000002');
  if (select attempts from private.erp_stage_publication_jobs_v3042 where stage_id='00000000-0000-0000-0000-000000000001')<>0
    or (select attempts from private.erp_stage_publication_jobs_v3042 where stage_id='00000000-0000-0000-0000-000000000002')<>1 then
    raise exception 'per-stage skip locked behavior changed';
  end if;
  perform dblink_exec('row_holder','rollback');
  perform dblink_disconnect('row_holder');
end
$check$;
update private.erp_stage_publication_jobs_v3042 set attempts=0;
select private.run_erp_stage_publication_v3042('00000000-0000-0000-0000-000000000099');
select private.run_erp_stage_publication_v3042('00000000-0000-0000-0000-000000000001');
select private.run_erp_stage_publication_v3042('00000000-0000-0000-0000-000000000002');
do $check$
begin
  if (select sum(attempts) from private.erp_stage_publication_jobs_v3042)<>2
    or exists(select 1 from private.erp_stage_publication_jobs_v3042 where attempts<>1) then
    raise exception 'idle or uncontended publication behavior changed';
  end if;
end
$check$;
