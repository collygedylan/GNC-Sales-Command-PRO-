-- Run after erp-compiled-drive-work-fixture.sql inside a local rollback.
create function pg_temp.reject_stale_certificate(target uuid, mutation text, expected text)
returns void language plpgsql as $test$
begin
  begin
    execute mutation using target;
    perform private.match_drive_final_certificate_v3078(private.lock_drive_final_input_v3078(target));
    raise exception 'stale certificate accepted: %',mutation;
  exception when others then if sqlerrm<>expected then raise; end if; end;
end $test$;

do $mutations$
declare stage uuid:='e3078000-0000-4000-8000-000000000342'; op text;
  stale constant text:='ERP_FINAL_CERTIFICATE_MISSING_OR_INVALIDATED';
begin
  assert private.match_drive_final_certificate_v3078(private.lock_drive_final_input_v3078(stage));
  foreach op in array array[
    'insert into private.fast_erp_stage_rows_v1(stage_id,row_ordinal,unique_id,row_value) values($1,2,''unexpected'',''{}'')',
    'update private.erp_drive_publication_parts_v3042 set body=body where stage_id=$1',
    'update private.erp_drive_typed_rows_v3077 set source_hash=source_hash where stage_id=$1',
    'update private.erp_drive_typed_parts_v3077 set decoded_rows_hash=decoded_rows_hash where stage_id=$1',
    'update private.erp_drive_preparation_seals_v3078 set source_digest=source_digest where stage_id=$1',
    'update private.fast_erp_stage_runs_v1 set file_meta=file_meta||''{"unexpected":true}'' where stage_id=$1',
    'update private.fast_erp_stage_runs_v1 set stage_state=''committing'' where stage_id=$1',
    'delete from private.erp_drive_typed_rows_v3077 where stage_id=$1',
    'truncate table private.fast_erp_stage_rows_v1','truncate table private.erp_drive_publication_parts_v3042',
    'truncate table private.erp_drive_typed_rows_v3077','truncate table private.erp_drive_typed_parts_v3077',
    'truncate table private.erp_drive_preparation_seals_v3078','truncate table private.erp_drive_compiled_rows_v3078',
    'truncate table private.erp_drive_compiled_cohorts_v3078'
  ] loop
    if op like '%stage_state=%' then perform pg_temp.reject_stale_certificate(stage,op,'ERP_FINAL_CERTIFICATE_STAGE_CHANGED');
    elsif op='truncate table private.erp_drive_preparation_seals_v3078' then
      perform pg_temp.reject_stale_certificate(stage,op,'ERP_FINAL_CERTIFICATE_WORK_CHANGED');
    else perform pg_temp.reject_stale_certificate(stage,op,stale); end if;
  end loop;
  assert not has_table_privilege('authenticated','private.erp_drive_final_certificates_v3078','SELECT');
  assert not has_table_privilege('service_role','private.erp_drive_final_certificates_v3078','INSERT');
  assert not has_function_privilege('service_role','private.certify_drive_final_input_v3078(uuid)','EXECUTE');
  begin
    update private.erp_drive_final_certificates_v3078 set ready=true where stage_id=stage;
    raise exception 'rewrote a certified header';
  exception when others then if sqlerrm<>'ERP_FINAL_CERTIFICATE_PHASE_INVALID' then raise; end if; end;
end $mutations$;

select pg_temp.seed_compiled_drive_fixture('e3078000-0000-4000-8000-000000000343',1,'third.xlsx');
do $move$
declare a uuid:='e3078000-0000-4000-8000-000000000342'; b uuid:='e3078000-0000-4000-8000-000000000343';
  a_epoch uuid; b_epoch uuid;
begin
  for tick in 1..3 loop assert not private.prepare_erp_publication_v3077(b); end loop;
  assert private.prepare_erp_publication_v3077(b);
  select drive_input_epoch_v3078 into a_epoch from private.fast_erp_stage_runs_v1 where stage_id=a;
  select drive_input_epoch_v3078 into b_epoch from private.fast_erp_stage_runs_v1 where stage_id=b;
  begin
    update private.erp_drive_publication_parts_v3042 set stage_id=b,first_row=2 where stage_id=a;
    assert (select drive_input_epoch_v3078<>a_epoch from private.fast_erp_stage_runs_v1 where stage_id=a);
    assert (select drive_input_epoch_v3078<>b_epoch from private.fast_erp_stage_runs_v1 where stage_id=b);
    raise exception using errcode='P0345',message='roll back stage move';
  exception when sqlstate 'P0345' then null; end;
end $move$;

-- Simulate loss of ALL unlogged stage scratch after a crash. A durable stage
-- and old input epoch alone cannot authorize publication. The worker rebuilds.
truncate table private.erp_drive_compiled_rows_v3078,private.erp_drive_compiled_cohorts_v3078,
  private.erp_drive_compiled_headers_v3078,private.erp_drive_final_certificates_v3078;
do $crash$
declare stage uuid:='e3078000-0000-4000-8000-000000000342';
begin
  assert not private.prepare_erp_publication_v3077(stage);
  assert not exists(select 1 from private.erp_drive_final_certificates_v3078 where stage_id=stage);
  assert (select not ready and compiled_rows=1 from private.erp_drive_compiled_headers_v3078 where stage_id=stage);
  assert (select stage_state='staging' and committed_result is null from private.fast_erp_stage_runs_v1 where stage_id=stage);
end $crash$;
