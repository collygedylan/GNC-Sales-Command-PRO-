-- Roll back this fixture on an isolated PG17 database. The two stages have
-- the same physical UIDs so a missing stage predicate is observable.
create function pg_temp.seed_compiled_drive_fixture(p_stage uuid,p_count integer,p_label text)
returns void language plpgsql as $seed$
begin
  insert into private.fast_erp_stage_runs_v1(stage_id,dataset_key,file_meta,source_fingerprint,expected_rows,staged_rows)
    values(p_stage,'drive_around',jsonb_build_object('file_name',p_label),p_label,p_count,p_count);
  insert into private.erp_stage_publication_jobs_v3042(stage_id,prepared_rows) values(p_stage,p_count);
  insert into private.erp_drive_publication_parts_v3042(stage_id,first_row,row_count,raw_bytes,body)
    select p_stage,1,p_count,sum(octet_length(v)+2),string_agg(v,',' order by n) from (
      select n,jsonb_build_object('values',jsonb_build_object('unique_id','fixture-work-'||n,'itemcode',p_label,
        'lotcode','26.F1','locationcode','D.01','ptronhand','8'),'rawFields','[]'::jsonb)::text v from generate_series(1,p_count) n) rows;
  loop exit when private.prepare_drive_typed_part_v3077(p_stage); end loop;
  assert not private.seal_drive_preparation_v3078(p_stage);
  drop table pg_temp.agdata_drive_publication_input_v3042,pg_temp.ph_master_bulk_stage_v1,pg_temp.ph_master_bulk_tuples_v3046;
end
$seed$;
select pg_temp.seed_compiled_drive_fixture('e3078000-0000-4000-8000-000000000341',260,'first.xlsx');
select pg_temp.seed_compiled_drive_fixture('e3078000-0000-4000-8000-000000000342',1,'second.xlsx');
select private.prepare_erp_publication_v3077('e3078000-0000-4000-8000-000000000341');
create temp table compiled_prefix as select row_number,source_hash,ctid::text original_ctid
from private.erp_drive_compiled_rows_v3078 where stage_id='e3078000-0000-4000-8000-000000000341';
savepoint interrupted_range;
create or replace function private.copy_drive_work_range_v3078(p_stage uuid,p_before integer,p_after integer)
returns void language plpgsql set search_path='' as $fault$ begin perform pg_sleep(0.2); end $fault$;
set local statement_timeout='25ms';
select private.run_erp_stage_publication_v3042('e3078000-0000-4000-8000-000000000341');
set local statement_timeout='240s';
do $interrupt$
declare stage uuid:='e3078000-0000-4000-8000-000000000341';
begin
  assert (select failures=1 and last_error='57014' and last_error_phase='prepare' from private.erp_stage_publication_jobs_v3042 where stage_id=stage);
  assert (select compiled_rows=250 and not ready and not dirty from private.erp_drive_compiled_headers_v3078 where stage_id=stage);
  assert (select committed_result is null from private.fast_erp_stage_runs_v1 where stage_id=stage);
end $interrupt$;
rollback to interrupted_range;

do $ready$
declare a uuid:='e3078000-0000-4000-8000-000000000341'; b uuid:='e3078000-0000-4000-8000-000000000342';
begin
  assert not private.prepare_erp_publication_v3077(a);
  assert (select compiled_rows=260 and not ready from private.erp_drive_compiled_headers_v3078 where stage_id=a);
  assert not private.prepare_erp_publication_v3077(a),'global sealing is preparation only';
  if to_regprocedure('private.certify_drive_final_input_v3078(uuid)') is not null then
    assert not private.prepare_erp_publication_v3077(a),'compiled count is an independent certification transaction';
  end if;
  assert private.prepare_erp_publication_v3077(a);
  assert (select count(*)=250 from private.erp_drive_compiled_rows_v3078 r join compiled_prefix p using(row_number,source_hash)
    where r.stage_id=a and r.ctid::text=p.original_ctid);
  assert not private.prepare_erp_publication_v3077(b);
  assert not private.prepare_erp_publication_v3077(b);
  if to_regprocedure('private.certify_drive_final_input_v3078(uuid)') is not null then assert not private.prepare_erp_publication_v3077(b); end if;
  assert private.prepare_erp_publication_v3077(b);
  assert (select count(*)=3 from pg_class where oid in('private.erp_drive_compiled_rows_v3078'::regclass,
    'private.erp_drive_compiled_cohorts_v3078'::regclass,'private.erp_drive_compiled_headers_v3078'::regclass)
    and relpersistence='u' and relrowsecurity and not has_table_privilege('authenticated',oid,'SELECT')
    and not has_table_privilege('service_role',oid,'UPDATE'));
end $ready$;

savepoint owned_overlay;
select private.load_drive_preparation_seal_v3078('e3078000-0000-4000-8000-000000000341');
do $alias$
declare a uuid:='e3078000-0000-4000-8000-000000000341'; b uuid:='e3078000-0000-4000-8000-000000000342';
begin
  assert private.has_drive_work_binding_v3078();
  assert (select count(*)=260 and bool_and(itemcode='first.xlsx') from pg_temp.ph_master_bulk_stage_v1);
  update pg_temp.ph_master_bulk_stage_v1 set ptronhand='4' where row_number=1;
  assert (select dirty from private.erp_drive_compiled_headers_v3078 where stage_id=a);
  assert (select ptronhand='8' from private.erp_drive_compiled_rows_v3078 where stage_id=b and row_number=1);
  assert (select (erp_row).ptronhand='8' from private.erp_drive_typed_rows_v3077 where stage_id=a and row_number=1);
  perform private.prepare_master_bulk_stage_v3046('[{"values":{"unique_id":"direct-raw"},"rawFields":[]}]');
  assert (select relkind='r' from pg_class where oid='pg_temp.ph_master_bulk_stage_v1'::regclass);
  assert (select count(*)=1 and min(unique_id)='direct-raw' from pg_temp.ph_master_bulk_stage_v1);
end $alias$;
rollback to owned_overlay;

savepoint forged_alias;
set local role service_role;
create temp table agdata_drive_work_binding_v3078(stage_id uuid);
insert into pg_temp.agdata_drive_work_binding_v3078 values('e3078000-0000-4000-8000-000000000341');
create temp view ph_master_bulk_stage_v1 with(security_invoker=true) as select * from pg_temp.agdata_drive_work_binding_v3078;
reset role;
do $forged$
begin
  assert not private.has_drive_work_binding_v3078(false);
  begin
    perform private.drive_work_index_or_analyze_v3078(repeat('a',64),true);
    raise exception 'untrusted same-name view accepted as a compiled stage';
  exception when others then if sqlerrm<>'ERP_COMPILED_BINDING_UNTRUSTED' then raise; end if; end;
end $forged$;
rollback to forged_alias;

do $corruption$
declare stage uuid:='e3078000-0000-4000-8000-000000000341';
begin
  begin
    update private.erp_drive_compiled_rows_v3078 set ptronhand='999' where stage_id=stage and row_number=1;
    perform private.load_drive_preparation_seal_v3078(stage); raise exception 'changed compiled row accepted';
  exception when others then if sqlerrm<>'ERP_COMPILED_NOT_READY' then raise; end if; end;
  begin
    update private.erp_drive_compiled_cohorts_v3078 set complete_hold_tuple=not complete_hold_tuple where stage_id=stage;
    perform private.load_drive_preparation_seal_v3078(stage); raise exception 'changed cohort accepted';
  exception when others then if sqlerrm<>'ERP_COMPILED_NOT_READY' then raise; end if; end;
  begin
    update private.erp_drive_publication_parts_v3042 set body=replace(body,'first.xlsx','wrong.xlsx') where stage_id=stage;
    perform private.load_drive_preparation_seal_v3078(stage); raise exception 'changed source accepted';
  exception when others then if sqlerrm<>(case when to_regprocedure('private.certify_drive_final_input_v3078(uuid)') is null
    then 'ERP_TYPED_SOURCE_PART_CHANGED' else 'ERP_FINAL_CERTIFICATE_MISSING_OR_INVALIDATED' end) then raise; end if; end;
  update private.fast_erp_stage_runs_v1 set expires_at=clock_timestamp()-interval '1 second' where stage_id=stage;
  delete from private.fast_erp_stage_runs_v1 where stage_id=stage and expires_at<=clock_timestamp();
  assert not exists(select 1 from private.erp_drive_compiled_rows_v3078 where stage_id=stage);
  assert not exists(select 1 from private.erp_drive_compiled_cohorts_v3078 where stage_id=stage);
  assert not exists(select 1 from private.erp_drive_compiled_headers_v3078 where stage_id=stage);
end $corruption$;
