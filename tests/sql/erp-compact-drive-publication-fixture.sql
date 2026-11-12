-- Run inside a rolled-back transaction in a disposable migrated database.
create temp table compact_fixture_input(ordinal integer primary key, row_value jsonb);
insert into compact_fixture_input values
  (1,'{"values":{"unique_id":"compact-a","itemcode":"A},{B","locationcode":"C.01","lotcode":"26.F1"},"rawFields":[]}'),
  (2,'{"rawFields":["locationnote"],"values":{"unique_id":"compact-b","itemcode":17,"locationcode":null,"locationnote":"x, y"}}'),
  (3,'{"values":{"unique_id":"compact-c","lotcode":"26.F2","itemcode":"é"},"rawFields":[]}');
insert into private.fast_erp_stage_runs_v1(stage_id,dataset_key,file_meta,source_fingerprint,expected_rows,staged_rows)
values('e3078000-0000-4000-8000-000000000003','drive_around','{"file_name":"compact.xlsx"}','compact-fixture',3,3);
insert into private.erp_stage_publication_jobs_v3042(stage_id,prepared_rows)
values('e3078000-0000-4000-8000-000000000003',3);
insert into private.erp_drive_publication_parts_v3042(stage_id,first_row,row_count,raw_bytes,body)
select 'e3078000-0000-4000-8000-000000000003',min(ordinal),count(*),sum(octet_length(row_value::text)+2),
  string_agg(row_value::text,',' order by ordinal)
from compact_fixture_input group by (ordinal-1)/2;

do $counterexamples$
declare stage uuid:='e3078000-0000-4000-8000-000000000003';
begin
  assert private.drive_parts_fit_one_attempt_v3078(stage);
  update private.erp_stage_publication_jobs_v3042 set last_error_phase='prepare' where stage_id=stage;
  assert not private.drive_parts_fit_one_attempt_v3078(stage),'a failed preparation must use durable checkpoints';
  update private.erp_stage_publication_jobs_v3042 set last_error_phase=null where stage_id=stage;
  begin
    update private.erp_drive_publication_parts_v3042 set first_row=4 where stage_id=stage and first_row=3;
    perform private.load_drive_erp_publication_input_v3042(stage);
    raise exception 'accepted non-contiguous source ordinals';
  exception when others then if sqlerrm<>'ERP_DRIVE_DECODE_COUNT_CHANGED' then raise; end if; end;
  begin
    update private.erp_drive_publication_parts_v3042 set body=replace(body,'compact-c','compact-a') where stage_id=stage and first_row=3;
    perform private.load_drive_erp_publication_input_v3042(stage);
    raise exception 'accepted a duplicated physical UID across source parts';
  exception when sqlstate '22023' then assert sqlerrm='BULK_MASTER_IMPORT_DUPLICATE_UNIQUE_ID'; end;
  begin
    update private.erp_drive_publication_parts_v3042 set body=(body::jsonb||'{"other":true}'::jsonb)::text
      where stage_id=stage and first_row=3;
    perform private.load_drive_erp_publication_input_v3042(stage);
    raise exception 'accepted an unexpected source field';
  exception when sqlstate '22023' then assert sqlerrm='BULK_MASTER_IMPORT_ROW_INVALID'; end;
  assert not has_function_privilege('service_role','private.load_drive_fast_parts_v3078(uuid,integer)','EXECUTE');
end
$counterexamples$;

select private.prepare_master_bulk_stage_v3046(jsonb_agg(row_value order by ordinal)) from compact_fixture_input;
create temp table compact_expected_rows as select row_number,to_jsonb(s) expected from pg_temp.ph_master_bulk_stage_v1 s;
select private.load_drive_erp_publication_input_v3042('e3078000-0000-4000-8000-000000000003');
do $parity$
declare digest text; compact jsonb; canonical jsonb;
begin
  select payload,source_digest into strict compact,digest from pg_temp.agdata_drive_publication_input_v3042;
  select jsonb_agg(row_value order by ordinal) into canonical from compact_fixture_input;
  assert digest=encode(extensions.digest(convert_to(canonical::text,'UTF8'),'sha256'),'hex');
  assert jsonb_array_length(compact)=3 and compact#>>'{0,$erpDigest}'=digest;
  assert (select bool_and((row_value->'values'->>'itemcode', row_value->'values'->>'locationcode',row_value->'values'->>'lotcode')
    is not distinct from (compact->(ordinal-1)->>'itemcode',compact->(ordinal-1)->>'locationcode',compact->(ordinal-1)->>'lotcode'))
    from compact_fixture_input),'SOC pair semantics must cover numeric, missing, null and special characters';
  assert (select count(*)=3 and bool_and(to_jsonb(s)=e.expected)
    from pg_temp.ph_master_bulk_stage_v1 s join compact_expected_rows e using(row_number));
  begin
    perform private.prepare_master_bulk_stage_v3046(compact);
    raise exception 'a compact handle cannot be reimported as raw input';
  exception when sqlstate '22023' then assert sqlerrm='BULK_MASTER_IMPORT_ROW_INVALID'; end;
  assert not exists(select 1 from private.fast_erp_stage_runs_v1 where stage_id='e3078000-0000-4000-8000-000000000003'
    and committed_result is not null),'preparation alone cannot publish inventory';
end
$parity$;
