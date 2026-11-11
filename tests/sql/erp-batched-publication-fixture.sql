select set_config('request.jwt.claim.role','service_role',true);
do $fixture$
declare id uuid; source text; saved text; result jsonb; rejected boolean; started timestamptz;
begin
  foreach source in array array['drive_around','soc','reserves','cav'] loop
    id:=gen_random_uuid();
    insert into private.fast_erp_stage_runs_v1(stage_id,dataset_key,file_meta,source_fingerprint,expected_rows,staged_rows)
      values(id,source,'{"file_name":"fixture.xlsx"}',id::text,2501,2501);
    insert into private.fast_erp_stage_rows_v1(stage_id,row_ordinal,unique_id,row_value)
      select id,n,'row-'||n,jsonb_build_object('unique_id','row-'||n,'itemcode','ERP64-'||n,
        'locationcode','X.01.001','spec','keep','ptronhand',n::text) from generate_series(1,2501) n;
    insert into private.erp_stage_publication_jobs_v3042(stage_id) values(id);
    started:=clock_timestamp();
    perform private.run_erp_stage_publication_v3042(id);
    assert (select prepared_rows=1000 from private.erp_stage_publication_jobs_v3042 where stage_id=id);
    assert clock_timestamp()-started<interval '4 seconds','bounded worker batch';
    select body into saved from private.erp_drive_publication_parts_v3042 where stage_id=id and first_row=1;
    assert private.prepare_erp_publication_part_v3064(id,0,2501)=1000;
    assert (select body=saved from private.erp_drive_publication_parts_v3042 where stage_id=id and first_row=1);
    update private.fast_erp_stage_rows_v1 set row_value=row_value||'{"spec":"changed"}' where stage_id=id and row_ordinal=1;
    rejected:=false;
    begin
      perform private.prepare_erp_publication_part_v3064(id,0,2501);
    exception when others then rejected:=SQLERRM='FAST_ERP_STAGE_PART_MISMATCH'; end;
    assert rejected,'changed replay must fail';
    update private.fast_erp_stage_rows_v1 set row_value=row_value||'{"spec":"keep"}' where stage_id=id and row_ordinal=1;
    perform private.run_erp_stage_publication_v3042(id);
    perform private.run_erp_stage_publication_v3042(id);
    assert (select prepared_rows=2501 from private.erp_stage_publication_jobs_v3042 where stage_id=id);
    assert (select count(*)=3 and sum(row_count)=2501 from private.erp_drive_publication_parts_v3042 where stage_id=id);
    result:=public.fast_commit_erp_stage_swap_v1(id,true);
    assert result->>'busy'='true' and result->>'preparedRows'='2501';
    assert (select stage_state='staging' and committed_result is null from private.fast_erp_stage_runs_v1 where stage_id=id);
    if source<>'drive_around' then
      perform private.run_erp_stage_publication_v3042(id);
      assert (select jsonb_array_length(payload)=2501 from private.erp_stage_publication_jobs_v3042 where stage_id=id);
    end if;
    delete from private.erp_stage_publication_jobs_v3042 where stage_id=id;
    delete from private.fast_erp_stage_runs_v1 where stage_id=id;
  end loop;
end
$fixture$;
