-- The exact pending-movement lookup uses both indexes, even with wide rows.
select private.prepare_master_bulk_stage_v3046(
  (select jsonb_agg(jsonb_build_object('values',jsonb_build_object(
    'unique_id','ordinal-fixture-'||i,'itemcode','000154.020.1','locationcode','L.05.000',
    'lotcode','28.F1','commonname',repeat(md5(i::text),30)),'rawFields','[]'::jsonb) order by i)
    from generate_series(1,64) i)
);
create temporary table ph_master_bulk_map_v1 as
select row_number,'canonical-'||row_number as canonical_unique_id from pg_temp.ph_master_bulk_stage_v1;
create unique index ph_master_bulk_map_v1_canonical_idx on pg_temp.ph_master_bulk_map_v1(canonical_unique_id);
analyze pg_temp.ph_master_bulk_map_v1 (canonical_unique_id,row_number);
do $test$
declare
  plan_line text;
  plan text := '';
begin
  if (select s.unique_id from pg_temp.ph_master_bulk_stage_v1 s
    join pg_temp.ph_master_bulk_map_v1 mapped using(row_number)
    where mapped.canonical_unique_id='canonical-42') is distinct from 'ordinal-fixture-42' then
    raise exception 'ERP_RECLASS_ORDINAL_FIXTURE_WRONG_SOURCE';
  end if;
  -- With 64 rows the planner may prefer a tiny sequential scan. This tests
  -- that both real equality predicates can use their respective indexes.
  perform set_config('enable_seqscan','off',true);
  for plan_line in explain (costs off) select s.* from pg_temp.ph_master_bulk_stage_v1 s
    join pg_temp.ph_master_bulk_map_v1 mapped using(row_number)
    where mapped.canonical_unique_id='canonical-42'
  loop
    plan:=plan||chr(10)||plan_line;
  end loop;
  if strpos(plan,'ph_master_bulk_stage_v1_ordinal_uidx')=0 or strpos(plan,'ph_master_bulk_map_v1_canonical_idx')=0 then
    raise exception 'ERP_RECLASS_ORDINAL_FIXTURE_INDEX_MISSING: %',plan;
  end if;
end
$test$;
