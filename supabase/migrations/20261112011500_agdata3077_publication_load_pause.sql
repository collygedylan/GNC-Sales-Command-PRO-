begin;
set local statement_timeout='30s';
set local lock_timeout='1500ms';

create function private.pause_erp_publication_v3077(p_stage_id uuid,p_reason text)
returns jsonb language plpgsql set search_path='' as $pause$
declare job_id bigint; canceled integer;
begin
  select jobid into job_id from cron.job
  where jobname='agdata-erp-publication-'||p_stage_id;
  if job_id is null then return jsonb_build_object('paused',false,'stage_id',p_stage_id); end if;
  select count(*) into canceled from pg_stat_activity backend
  where backend.pid<>pg_backend_pid() and backend.state='active'
    and backend.application_name in ('pg_cron','agdata_erp_publication')
    and backend.query like '%private.run_erp_stage_publication_v3042(%'
    and position(p_stage_id::text in backend.query)>0
    and pg_cancel_backend(backend.pid);
  perform cron.alter_job(job_id,active:=false);
  return jsonb_build_object('paused',true,'stage_id',p_stage_id,'job_id',job_id,
    'canceled',canceled,'reason',left(p_reason,500));
end
$pause$;
revoke all on function private.pause_erp_publication_v3077(uuid,text) from public,anon,authenticated,service_role;

do $current$
begin
  if exists(select 1 from private.erp_stage_publication_jobs_v3042
    where stage_id='60393f40-ec61-458a-98e7-b561116da703' and failures>0) then
    perform private.pause_erp_publication_v3077('60393f40-ec61-458a-98e7-b561116da703',
      'Pause verified master-update statement timeouts while the scoped ERP write is optimized.');
  end if;
end
$current$;
commit;
