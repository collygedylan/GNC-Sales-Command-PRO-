-- Install the scheduler in the enclosing local PG17 rollback transaction.
do $test$
declare stage_id uuid; dataset text; scheduled bigint; command text; budget text;
begin
  foreach dataset in array array['drive_around','cav','reserves','soc'] loop
    insert into private.fast_erp_stage_runs_v1(dataset_key,file_meta,source_fingerprint,expected_rows)
      values(dataset,'{}',md5(gen_random_uuid()::text),1) returning fast_erp_stage_runs_v1.stage_id into stage_id;
    scheduled:=private.schedule_erp_stage_publication_v3057(stage_id);
    select c.command into strict command from cron.job c where c.jobid=scheduled
      and c.jobname='agdata-erp-publication-'||stage_id and c.schedule='2 seconds';
    budget:=case when dataset='drive_around' then '8s' else '120s' end;
    assert command=format('begin; set local statement_timeout = %L; set local lock_timeout = %L; select private.run_erp_stage_publication_v3042(%L::uuid); commit',
      budget,case when dataset='drive_around' then '750ms' else '15s' end,stage_id);
    assert cron.unschedule(scheduled);
  end loop;
  assert private.schedule_erp_stage_publication_v3057(gen_random_uuid()) is null;
end
$test$;
