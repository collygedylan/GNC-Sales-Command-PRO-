-- Two normalized rows prove the separate preload without touching live inventory.
insert into private.fast_erp_stage_runs_v1(stage_id,dataset_key,file_meta,source_fingerprint,expected_rows,staged_rows)
values ('a3046000-0000-4000-8000-000000000001','drive_around','{"file_id":"erp-plan-fixture"}','erp-plan-fixture-3046',2,2);
insert into private.erp_stage_publication_jobs_v3042(stage_id,prepared_rows)
values ('a3046000-0000-4000-8000-000000000001',2);
insert into private.erp_drive_publication_parts_v3042(stage_id,first_row,row_count,raw_bytes,body)
select 'a3046000-0000-4000-8000-000000000001',1,2,octet_length(rows),rows
from (values ($rows$
{"values":{"unique_id":"plan-a","itemcode":"000154.020.1","locationcode":"L.05.000","lotcode":"28.F1","priority":null,"holdstopcode":null,"holdstopreason":null},"rawFields":[]},
{"values":{"unique_id":"plan-b","itemcode":"000154.020.1","locationcode":"L.05.000","lotcode":"27.F1","priority":null,"holdstopcode":null},"rawFields":[]}
$rows$)) as fixture(rows);

do $test$
declare stage uuid := 'a3046000-0000-4000-8000-000000000001';
begin
  perform private.load_drive_erp_publication_input_v3042(stage);
  if current_setting('agdata.erp.loaded_drive_stage',true) is distinct from stage::text
    or (select count(*) from pg_temp.ph_master_bulk_stage_v1)<>2
    or (select count(*) from pg_temp.ph_master_bulk_tuples_v3046 where complete_hold_tuple)<>1
    or (select count(*) from pg_temp.ph_master_bulk_tuples_v3046 where not complete_hold_tuple)<>1
    or not exists(select 1 from pg_temp.agdata_drive_publication_input_v3042 where stage_id=stage
      and source_digest=encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex')) then
    raise exception 'ERP_DRIVE_TUPLE_PLAN_FIXTURE_FAILED';
  end if;
  begin
    perform private.prepare_master_bulk_stage_v3046(
      '[{"values":{"unique_id":"duplicate"},"rawFields":[]},{"values":{"unique_id":"duplicate"},"rawFields":[]}]');
    raise exception 'ERP_DRIVE_DUPLICATE_ALLOWED';
  exception when sqlstate '22023' then
    if sqlerrm<>'BULK_MASTER_IMPORT_DUPLICATE_UNIQUE_ID' then raise; end if;
  end;
end
$test$;
