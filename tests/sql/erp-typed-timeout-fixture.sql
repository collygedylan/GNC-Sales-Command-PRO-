-- Caller has seeded the private fixture stage/parts but has not decoded any.
-- This local transaction is rolled back, including the temporary decoder fault.
create temp table erp77_saved_decoder as
select pg_get_functiondef('private.prepare_master_bulk_stage_v3046(jsonb)'::regprocedure) definition;
create or replace function private.prepare_master_bulk_stage_v3046(p_rows jsonb)
returns void language plpgsql set search_path = '' as $timeout$
begin
  perform pg_sleep(0.2);
end
$timeout$;
set local statement_timeout = '25ms';
select private.run_erp_stage_publication_v3042('e3077000-0000-4000-8000-000000000071');
set local statement_timeout = '90s';
do $failed$
begin
  assert (select typed_prepared_rows=0 and failures=1 and last_error='57014' and last_error_phase='prepare'
    from private.erp_stage_publication_jobs_v3042 where stage_id='e3077000-0000-4000-8000-000000000071');
  assert not exists(select 1 from private.erp_drive_typed_rows_v3077
    where stage_id='e3077000-0000-4000-8000-000000000071');
  assert not exists(select 1 from private.erp_drive_typed_parts_v3077
    where stage_id='e3077000-0000-4000-8000-000000000071');
  assert (select stage_state='staging' and committed_result is null from private.fast_erp_stage_runs_v1
    where stage_id='e3077000-0000-4000-8000-000000000071');
end
$failed$;
do $restore$
begin
  execute (select definition from erp77_saved_decoder);
end
$restore$;
update private.erp_stage_publication_jobs_v3042 set next_attempt_at=clock_timestamp()
where stage_id='e3077000-0000-4000-8000-000000000071';
select private.run_erp_stage_publication_v3042('e3077000-0000-4000-8000-000000000071');
do $resumed$
begin
  assert (select typed_prepared_rows=1000 and failures=0 and last_error is null
    from private.erp_stage_publication_jobs_v3042 where stage_id='e3077000-0000-4000-8000-000000000071');
  assert (select count(*)=1000 from private.erp_drive_typed_rows_v3077
    where stage_id='e3077000-0000-4000-8000-000000000071');
  assert not exists(select 1 from private.fast_erp_stage_runs_v1
    where stage_id='e3077000-0000-4000-8000-000000000071' and committed_result is not null);
end
$resumed$;
