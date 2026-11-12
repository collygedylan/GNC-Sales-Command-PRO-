-- Run inside a rollback transaction on the fully migrated local SQL fixture.
create temp table incremental_source(ordinal integer primary key, v jsonb);
insert into incremental_source select n,jsonb_build_object('values',jsonb_build_object('unique_id','slice-'||n,
  'itemcode','item-'||n,'locationcode','C.01','lotcode','26.F1','locationnote','quoted },{"values": { é'),'rawFields',jsonb_build_array('locationnote'))
  from generate_series(1,501) n;
insert into private.fast_erp_stage_runs_v1(stage_id,dataset_key,file_meta,source_fingerprint,expected_rows,staged_rows)
  values('e3078000-0000-4000-8000-000000000310','drive_around','{"file_name":"range.xlsx"}','range-fp',501,501);
insert into private.erp_stage_publication_jobs_v3042(stage_id,prepared_rows)
  values('e3078000-0000-4000-8000-000000000310',501);
insert into private.erp_drive_publication_parts_v3042(stage_id,first_row,row_count,raw_bytes,body)
  select 'e3078000-0000-4000-8000-000000000310',1,501,sum(octet_length(v::text)+2),string_agg(v::text,',' order by ordinal) from incremental_source;

savepoint timeout_probe;
select private.prepare_erp_publication_v3077('e3078000-0000-4000-8000-000000000310');
create temporary table before_timeout as select row_number,decoded_row_hash from private.erp_drive_typed_rows_v3077
  where stage_id='e3078000-0000-4000-8000-000000000310';
create or replace function private.prepare_master_bulk_stage_v3046(p_rows jsonb) returns void
  language plpgsql set search_path='' as $fault$ begin perform pg_sleep(0.2); end $fault$;
set local statement_timeout='25ms';
select private.run_erp_stage_publication_v3042('e3078000-0000-4000-8000-000000000310');
set local statement_timeout='240s';
do $timeout$
declare target uuid:='e3078000-0000-4000-8000-000000000310';
begin
  assert (select failures=1 and last_error='57014' and last_error_phase='prepare' and typed_prepared_rows=250
    from private.erp_stage_publication_jobs_v3042 where stage_id=target);
  assert (select count(*)=250 from private.erp_drive_typed_rows_v3077 r join before_timeout using(row_number,decoded_row_hash)
    where r.stage_id=target);
  assert not exists(select 1 from private.erp_drive_preparation_seals_v3078 where stage_id=target);
  assert (select committed_result is null from private.fast_erp_stage_runs_v1 where stage_id=target);
end
$timeout$;
rollback to timeout_probe;

do $slices$
declare target uuid:='e3078000-0000-4000-8000-000000000310'; prefix text; parsed jsonb;
begin
  assert private.drive_typed_slice_v3078(' {"other": 1}, {"values": {}} ',2,1,1)='[{"values":{}}]'::jsonb;
  begin
    perform private.drive_typed_slice_v3078('{}',1,0,251);
    raise exception 'oversized range accepted';
  exception when others then if sqlerrm<>'ERP_TYPED_SOURCE_SLICE_INVALID' then raise; end if; end;
  assert not private.prepare_erp_publication_v3077(target);
  select string_agg(decoded_row_hash,',' order by row_number) into prefix from private.erp_drive_typed_rows_v3077 where stage_id=target;
  assert (select typed_prepared_rows=250 from private.erp_stage_publication_jobs_v3042 where stage_id=target);
  begin
    update private.fast_erp_stage_runs_v1 set source_fingerprint='wrong' where stage_id=target;
    perform private.prepare_erp_publication_v3077(target);
    raise exception 'wrong fingerprint accepted';
  exception when others then if sqlerrm<>'ERP_TYPED_STAGE_IDENTITY_CHANGED' then raise; end if; end;
  assert not private.prepare_erp_publication_v3077(target);
  assert (select typed_prepared_rows=500 from private.erp_stage_publication_jobs_v3042 where stage_id=target);
  assert prefix=(select string_agg(decoded_row_hash,',' order by row_number) from private.erp_drive_typed_rows_v3077
    where stage_id=target and row_number<=250);
  assert not private.prepare_erp_publication_v3077(target);
  assert (select typed_prepared_rows=501 from private.erp_stage_publication_jobs_v3042 where stage_id=target);
  assert not exists(select 1 from private.erp_drive_preparation_seals_v3078 where stage_id=target);
  assert not private.prepare_erp_publication_v3077(target),'sealing preparation cannot dispatch the final write';
  select jsonb_agg(v order by ordinal) into parsed from incremental_source;
  assert (select source_digest=encode(extensions.digest(convert_to(parsed::text,'UTF8'),'sha256'),'hex')
    from private.erp_drive_preparation_seals_v3078 where stage_id=target);
  assert (select stage_state='staging' and committed_result is null from private.fast_erp_stage_runs_v1 where stage_id=target);
  if to_regprocedure('private.prepare_drive_work_v3078(uuid)') is null then
    assert private.prepare_erp_publication_v3077(target),'the next transaction may now enter canonical publication';
  else
    assert not private.prepare_erp_publication_v3077(target),'compilation advances before publication';
    assert not private.prepare_erp_publication_v3077(target),'second 250-row compile range';
    assert not private.prepare_erp_publication_v3077(target),'final physical row';
    assert not private.prepare_erp_publication_v3077(target),'global compiled readiness';
    if to_regprocedure('private.certify_drive_final_input_v3078(uuid)') is not null then
      assert not private.prepare_erp_publication_v3077(target),'count certification cannot publish';
    end if;
    assert private.prepare_erp_publication_v3077(target),'a verified compiled stage may now enter publication';
  end if;
end
$slices$;

do $rejections$
declare target uuid:='e3078000-0000-4000-8000-000000000310';
begin
  begin
    update private.erp_drive_preparation_seals_v3078 set source_digest=repeat('f',64) where stage_id=target;
    raise exception 'single-field seal digest forgery accepted';
  exception when check_violation then null; end;
  begin
    update private.erp_drive_typed_parts_v3077 set decoded_rows_hash=repeat('0',64) where stage_id=target and first_row=1;
    perform private.load_drive_preparation_seal_v3078(target);
    raise exception 'mismatching typed receipt accepted';
  exception when others then if sqlerrm<>'ERP_DRIVE_PREPARATION_SEAL_CHANGED' then raise; end if; end;
  begin
    update private.erp_drive_publication_parts_v3042 set body=replace(body,'slice-1','other-1') where stage_id=target;
    perform private.load_drive_preparation_seal_v3078(target);
    raise exception 'mismatching immutable part accepted';
  exception when others then if sqlerrm<>(case when to_regprocedure('private.certify_drive_final_input_v3078(uuid)') is null
    then 'ERP_TYPED_SOURCE_PART_CHANGED' else 'ERP_FINAL_CERTIFICATE_MISSING_OR_INVALIDATED' end) then raise; end if; end;
  assert not has_table_privilege('anon','private.erp_drive_preparation_seals_v3078','SELECT');
  assert not has_table_privilege('authenticated','private.erp_drive_preparation_seals_v3078','SELECT');
  assert not has_table_privilege('service_role','private.erp_drive_preparation_seals_v3078','UPDATE');
  assert not has_function_privilege('service_role','private.seal_drive_preparation_v3078(uuid)','EXECUTE');
end
$rejections$;
