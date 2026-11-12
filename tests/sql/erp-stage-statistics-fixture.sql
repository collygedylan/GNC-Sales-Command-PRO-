-- The caller prepares the actual 9,610-row workbook in this disposable
-- transaction, then rolls it back. No operational relation is modified here.
create temp table erp77_legacy_cohort as
select row_number,raw_item6_fields,field_keys from pg_temp.ph_master_bulk_stage_v1;
analyze erp77_legacy_cohort (row_number);
create temp table erp77_cohort_plans(label text,estimated_rows integer,actual_rows integer);

create function pg_temp.capture_erp77_cohort_plan(p_relation regclass,p_label text)
returns void language plpgsql as $plan$
declare raw text[]; fields text[]; plan jsonb;
begin
  select raw_item6_fields,field_keys into raw,fields from pg_temp.ph_master_bulk_stage_v1 limit 1;
  execute format('explain(analyze,format json) select row_number from %s where raw_item6_fields=$1 and field_keys=$2',p_relation)
    into plan using raw,fields;
  insert into erp77_cohort_plans values(p_label,(plan#>>'{0,Plan,Plan Rows}')::integer,
    (plan#>>'{0,Plan,Actual Rows}')::integer);
end
$plan$;
select pg_temp.capture_erp77_cohort_plan('pg_temp.erp77_legacy_cohort','before');
select pg_temp.capture_erp77_cohort_plan('pg_temp.ph_master_bulk_stage_v1','after');

do $assert$
begin
  assert (select estimated_rows=1 and actual_rows=9610 from erp77_cohort_plans where label='before');
  assert (select estimated_rows=9610 and actual_rows=9610 from erp77_cohort_plans where label='after');
  assert not exists((select row_number,raw_item6_fields,field_keys from pg_temp.ph_master_bulk_stage_v1
    except select * from erp77_legacy_cohort) union all
    (select * from erp77_legacy_cohort except select row_number,raw_item6_fields,field_keys from pg_temp.ph_master_bulk_stage_v1));
end
$assert$;

-- Distinct field-key sets are counted independently from raw-field cohorts.
-- Three physical cohorts below have only two different field-key arrays.
select private.prepare_master_bulk_stage_v3046('[
  {"values":{"unique_id":"stats-a","itemcode":"ERP77"},"rawFields":[]},
  {"values":{"unique_id":"stats-b","itemcode":"ERP77"},"rawFields":["locationnote"]},
  {"values":{"unique_id":"stats-c","itemcode":"ERP77","commonname":"Fixture"},"rawFields":[]}
]'::jsonb);
do $distinct$
begin
  assert (select count(*)=3 from pg_temp.ph_master_bulk_tuples_v3046);
  assert (select attoptions @> array['n_distinct=2'] from pg_attribute
    where attrelid='pg_temp.ph_master_bulk_stage_v1'::regclass and attname='field_keys');
  assert (select count(*)=3 from pg_temp.ph_master_bulk_stage_v1);
  assert not has_function_privilege('service_role','private.refresh_drive_stage_cohort_statistics_v3077()','EXECUTE');
end
$distinct$;
