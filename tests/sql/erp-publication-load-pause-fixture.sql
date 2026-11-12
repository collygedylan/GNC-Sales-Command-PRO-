do $pause_fixture$
declare
  stage uuid:='e3077000-0000-4000-8000-000000000099';
  result jsonb;
begin
  insert into private.fast_erp_stage_runs_v1
    (stage_id,dataset_key,file_meta,source_fingerprint,expected_rows,staged_rows)
  values(stage,'cav','{}','pause-fixture',1,1);
  insert into private.erp_stage_publication_jobs_v3042(stage_id) values(stage);
  perform cron.schedule('agdata-erp-publication-'||stage,'0 0 1 1 *','select 1');
  result:=private.pause_erp_publication_v3077(stage,'isolated load fixture');
  assert result->>'paused'='true' and result->>'reason'='isolated load fixture';
  assert not(select active from cron.job where jobname='agdata-erp-publication-'||stage);
  assert (select stage_state='staging' and staged_rows=1 and committed_result is null
    from private.fast_erp_stage_runs_v1 where stage_id=stage);
  assert (private.pause_erp_publication_v3077(gen_random_uuid(),'unknown')->>'paused')='false';
  assert not has_function_privilege('service_role','private.pause_erp_publication_v3077(uuid,text)','execute');
  assert not has_function_privilege('authenticated','private.pause_erp_publication_v3077(uuid,text)','execute');
end
$pause_fixture$;
