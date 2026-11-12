begin;
set local statement_timeout='30s';
set local lock_timeout='1500ms';

do $resume$
declare stage private.fast_erp_stage_runs_v1%rowtype; publication_job bigint;
begin
  select * into stage from private.fast_erp_stage_runs_v1
  where stage_id='60393f40-ec61-458a-98e7-b561116da703' and stage_state='staging';
  if not found then return; end if;
  if stage.expected_rows<>9610 or stage.staged_rows<>9610
    or stage.file_meta->>'file_id' is distinct from '19vAFlebg5A4DTdsHcEJzlGOrIFpyxNpR'
    or stage.file_meta->>'sync_run_id' is distinct from '3faf2a4d-0c73-4a18-9896-6fd0a4f83480'
    or to_regprocedure('private.refresh_drive_stage_cohort_statistics_v3077()') is null then
    raise exception 'ERP_CONTROLLED_RESUME_IDENTITY_MISMATCH';
  end if;
  publication_job:=private.schedule_erp_stage_publication_v3057(stage.stage_id);
  perform cron.alter_job(publication_job,active:=true);
end
$resume$;
commit;
