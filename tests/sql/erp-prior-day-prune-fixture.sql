-- Run only on a disposable PG17 clone of the certified 9,610-row fixture.
-- Every publication and evidence mutation below rolls back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='60s';
create temp table prior_day_target as
  select m.unique_id,m.itemcode,m.locationcode from public.ph_master_inventory m
  where m.itemcode is not null and m.locationcode is not null
    and not exists(select 1 from private.erp_drive_compiled_rows_v3078 s
      where s.stage_id='e3078000-0000-4000-8000-000000000078' and s.unique_id=m.unique_id)
    and not exists(select 1 from app_sync_private.ph_master_inventory_app_edits e where e.canonical_unique_id=m.unique_id)
    and not exists(select 1 from app_sync_private.inventory_location_evidence_v1 e where e.source_unique_id=m.unique_id)
    and not exists(select 1 from app_sync_private.inventory_live_overrides_v1 e where e.canonical_unique_id=m.unique_id and e.pending)
    and not exists(select 1 from public.app_row_actions a where a.canonical_unique_id=m.unique_id and a.reconciliation_status='pending')
    and not exists(select 1 from private.ph_inventory_reclass_movements_v1 r where r.status in ('pending','conflict')
      and (r.source_unique_id=m.unique_id or r.destination_unique_id=m.unique_id))
  limit 1;
do $target$ begin if (select count(*) from prior_day_target)<>1 then raise exception 'FIXTURE_MISSING_PRUNE_TARGET'; end if; end $target$;
create temp table prior_day_master_before as select md5(string_agg(md5(to_jsonb(m)::text),'' order by m.unique_id)) hash,count(*) n from public.ph_master_inventory m;
create temp table prior_day_receipts_before as select count(*) n from app_sync_private.ph_master_bulk_import_receipts_v1;
insert into private.erp_sync_jobs(run_id,command_id,requested_by,active,status,started_at) values
 ('e3078000-0000-4000-8000-000000000099','fixture-prior-day','fixture_actor',false,'{}',statement_timestamp()-interval '1 day');
update private.fast_erp_stage_runs_v1 set file_meta=file_meta||'{"sync_run_id":"e3078000-0000-4000-8000-000000000099"}'::jsonb
  where stage_id='e3078000-0000-4000-8000-000000000078';
delete from private.erp_drive_final_certificates_v3078 where stage_id='e3078000-0000-4000-8000-000000000078';
select private.certify_drive_final_input_v3078('e3078000-0000-4000-8000-000000000078');
select private.certify_drive_final_input_v3078('e3078000-0000-4000-8000-000000000078');
insert into app_sync_private.ph_master_inventory_app_edits(canonical_unique_id,lineage_key,updated_at)
  select unique_id,'fixture-prior-day',(date_trunc('day',statement_timestamp() at time zone 'America/Chicago') at time zone 'America/Chicago')-interval '12 hours' from prior_day_target;
select private.schedule_erp_stage_publication_v3057('e3078000-0000-4000-8000-000000000078');
select private.run_erp_stage_publication_v3042('e3078000-0000-4000-8000-000000000078');
do $blocked$
declare j private.erp_stage_publication_jobs_v3042%rowtype;
begin
  select * into strict j from private.erp_stage_publication_jobs_v3042 where stage_id='e3078000-0000-4000-8000-000000000078';
  if j.last_error is distinct from '55000' or j.last_error_message is distinct from 'ERP_PRIOR_RUN_DAY_PRUNE_REVIEW_REQUIRED'
    or j.last_error_detail::jsonb->>'canonical_unique_id' is distinct from (select unique_id from prior_day_target)
    or (j.last_error_detail::jsonb->>'prior_day_start')::timestamptz is distinct from
      (select date_trunc('day',r.started_at at time zone 'America/Chicago') at time zone 'America/Chicago' from private.erp_sync_jobs r where r.run_id='e3078000-0000-4000-8000-000000000099')
    or not exists(select 1 from private.fast_erp_stage_runs_v1 where stage_id=j.stage_id and stage_state='staging' and committed_result is null)
    or (select hash from prior_day_master_before) is distinct from (select md5(string_agg(md5(to_jsonb(m)::text),'' order by m.unique_id)) from public.ph_master_inventory m)
    or (select n from prior_day_receipts_before) is distinct from (select count(*) from app_sync_private.ph_master_bulk_import_receipts_v1)
    or not exists(select 1 from public.ph_master_inventory m join prior_day_target t using(unique_id)) then
    raise exception 'PRIOR_DAY_ABORT_ROLLBACK_FAILED';
  end if;
end
$blocked$;
rollback;

-- A current-day independent evidence fence removes the row from the exact
-- canonical delete set; the guard must not abort that safe publication.
begin;
set local statement_timeout='60s';
create temp table prior_day_target as
  select m.unique_id,m.itemcode,m.locationcode from public.ph_master_inventory m
  where m.itemcode is not null and m.locationcode is not null
    and not exists(select 1 from private.erp_drive_compiled_rows_v3078 s
      where s.stage_id='e3078000-0000-4000-8000-000000000078' and s.unique_id=m.unique_id)
    and not exists(select 1 from app_sync_private.ph_master_inventory_app_edits e where e.canonical_unique_id=m.unique_id)
    and not exists(select 1 from app_sync_private.inventory_location_evidence_v1 e where e.source_unique_id=m.unique_id)
    and not exists(select 1 from app_sync_private.inventory_live_overrides_v1 e where e.canonical_unique_id=m.unique_id and e.pending)
    and not exists(select 1 from public.app_row_actions a where a.canonical_unique_id=m.unique_id and a.reconciliation_status='pending')
    and not exists(select 1 from private.ph_inventory_reclass_movements_v1 r where r.status in ('pending','conflict')
      and (r.source_unique_id=m.unique_id or r.destination_unique_id=m.unique_id))
  limit 1;
do $target$ begin if (select count(*) from prior_day_target)<>1 then raise exception 'FIXTURE_MISSING_PRUNE_TARGET'; end if; end $target$;
create temp table prior_day_master_before as select md5(string_agg(md5(to_jsonb(m)::text),'' order by m.unique_id)) hash,count(*) n from public.ph_master_inventory m;
create temp table prior_day_receipts_before as select count(*) n from app_sync_private.ph_master_bulk_import_receipts_v1;
insert into private.erp_sync_jobs(run_id,command_id,requested_by,active,status,started_at) values
 ('e3078000-0000-4000-8000-000000000099','fixture-prior-day','fixture_actor',false,'{}',statement_timestamp()-interval '1 day');
update private.fast_erp_stage_runs_v1 set file_meta=file_meta||'{"sync_run_id":"e3078000-0000-4000-8000-000000000099"}'::jsonb
  where stage_id='e3078000-0000-4000-8000-000000000078';
delete from private.erp_drive_final_certificates_v3078 where stage_id='e3078000-0000-4000-8000-000000000078';
select private.certify_drive_final_input_v3078('e3078000-0000-4000-8000-000000000078');
select private.certify_drive_final_input_v3078('e3078000-0000-4000-8000-000000000078');
insert into app_sync_private.ph_master_inventory_app_edits(canonical_unique_id,lineage_key,updated_at)
  select unique_id,'fixture-prior-day',(date_trunc('day',statement_timestamp() at time zone 'America/Chicago') at time zone 'America/Chicago')-interval '12 hours' from prior_day_target;
insert into app_sync_private.inventory_location_evidence_v1(itemcode_key,locationcode_key,itemcode,locationcode,source_unique_id,updated_by,updated_at)
  select lower(btrim(itemcode)),lower(btrim(locationcode)),itemcode,locationcode,unique_id,'fixture_actor',statement_timestamp() from prior_day_target;
select private.schedule_erp_stage_publication_v3057('e3078000-0000-4000-8000-000000000078');
select private.run_erp_stage_publication_v3042('e3078000-0000-4000-8000-000000000078');
do $safe$
begin
  if not exists(select 1 from private.fast_erp_stage_runs_v1 where stage_id='e3078000-0000-4000-8000-000000000078'
      and stage_state='committed' and committed_result->>'stage_commit'='canonical_atomic_import'
      and (committed_result->>'inserted')::integer=26 and (committed_result->>'updated')::integer=974
      and (committed_result->>'deleted')::integer=35 and (committed_result->>'unchanged')::integer=8610)
    or not exists(select 1 from public.ph_master_inventory m join prior_day_target t using(unique_id)) then
    raise exception 'PRIOR_DAY_SAFE_CURRENT_FENCE_FAILED';
  end if;
end
$safe$;
rollback;

-- Same-day certified runs retain the original pruning behavior.
begin;
set local statement_timeout='60s';
create temp table prior_day_target as
  select m.unique_id,m.itemcode,m.locationcode from public.ph_master_inventory m
  where m.itemcode is not null and m.locationcode is not null
    and not exists(select 1 from private.erp_drive_compiled_rows_v3078 s
      where s.stage_id='e3078000-0000-4000-8000-000000000078' and s.unique_id=m.unique_id)
    and not exists(select 1 from app_sync_private.ph_master_inventory_app_edits e where e.canonical_unique_id=m.unique_id)
    and not exists(select 1 from app_sync_private.inventory_location_evidence_v1 e where e.source_unique_id=m.unique_id)
    and not exists(select 1 from app_sync_private.inventory_live_overrides_v1 e where e.canonical_unique_id=m.unique_id and e.pending)
    and not exists(select 1 from public.app_row_actions a where a.canonical_unique_id=m.unique_id and a.reconciliation_status='pending')
    and not exists(select 1 from private.ph_inventory_reclass_movements_v1 r where r.status in ('pending','conflict')
      and (r.source_unique_id=m.unique_id or r.destination_unique_id=m.unique_id))
  limit 1;
do $target$ begin if (select count(*) from prior_day_target)<>1 then raise exception 'FIXTURE_MISSING_PRUNE_TARGET'; end if; end $target$;
create temp table prior_day_master_before as select md5(string_agg(md5(to_jsonb(m)::text),'' order by m.unique_id)) hash,count(*) n from public.ph_master_inventory m;
create temp table prior_day_receipts_before as select count(*) n from app_sync_private.ph_master_bulk_import_receipts_v1;
insert into private.erp_sync_jobs(run_id,command_id,requested_by,active,status,started_at) values
 ('e3078000-0000-4000-8000-000000000099','fixture-prior-day','fixture_actor',false,'{}',statement_timestamp());
update private.fast_erp_stage_runs_v1 set file_meta=file_meta||'{"sync_run_id":"e3078000-0000-4000-8000-000000000099"}'::jsonb
  where stage_id='e3078000-0000-4000-8000-000000000078';
delete from private.erp_drive_final_certificates_v3078 where stage_id='e3078000-0000-4000-8000-000000000078';
select private.certify_drive_final_input_v3078('e3078000-0000-4000-8000-000000000078');
select private.certify_drive_final_input_v3078('e3078000-0000-4000-8000-000000000078');
insert into app_sync_private.ph_master_inventory_app_edits(canonical_unique_id,lineage_key,updated_at)
  select unique_id,'fixture-prior-day',(date_trunc('day',statement_timestamp() at time zone 'America/Chicago') at time zone 'America/Chicago')-interval '12 hours' from prior_day_target;
select private.schedule_erp_stage_publication_v3057('e3078000-0000-4000-8000-000000000078');
select private.run_erp_stage_publication_v3042('e3078000-0000-4000-8000-000000000078');
do $same$
begin
  if not exists(select 1 from private.fast_erp_stage_runs_v1 where stage_id='e3078000-0000-4000-8000-000000000078'
      and stage_state='committed' and committed_result->>'stage_commit'='canonical_atomic_import'
      and (committed_result->>'inserted')::integer=26 and (committed_result->>'updated')::integer=974
      and (committed_result->>'deleted')::integer=36 and (committed_result->>'unchanged')::integer=8610)
    or exists(select 1 from public.ph_master_inventory m join prior_day_target t using(unique_id)) then
    raise exception 'PRIOR_DAY_SAME_DAY_PARITY_FAILED';
  end if;
end
$same$;
rollback;

-- Raw/unbound callers have no certified Drive scope.
do $unbound$
begin
  if private.erp_prior_run_day_cutoff_v3078(repeat('a',64)) is not null
    or private.assert_prior_run_day_prune_safe_v3078(array['fixture-unbound'],null) is distinct from true then
    raise exception 'PRIOR_DAY_UNBOUND_CALLER_CHANGED';
  end if;
end
$unbound$;

-- Each of the four original evidence sources is checked using only the
-- candidate UID; blank actors and unrelated/current-day evidence are not hits.
begin;
create function pg_temp.expect_prior_day_guard(p_uid text,p_block boolean) returns void language plpgsql as $expect$
declare cutoff timestamptz:=date_trunc('day',statement_timestamp() at time zone 'America/Chicago') at time zone 'America/Chicago'; detail_text text;
begin
  begin
    perform private.assert_prior_run_day_prune_safe_v3078(array[p_uid],cutoff-interval '1 day');
    if p_block then raise exception 'FIXTURE_EXPECTED_PRIOR_DAY_BLOCK'; end if;
  exception when sqlstate '55000' then
    get stacked diagnostics detail_text=PG_EXCEPTION_DETAIL;
    if not p_block or sqlerrm<>'ERP_PRIOR_RUN_DAY_PRUNE_REVIEW_REQUIRED'
      or detail_text::jsonb->>'canonical_unique_id' is distinct from p_uid then raise; end if;
  end;
end
$expect$;
savepoint app_edit;
insert into app_sync_private.ph_master_inventory_app_edits(canonical_unique_id,lineage_key,updated_at)
values('fixture-prior-app','fixture',date_trunc('day',statement_timestamp() at time zone 'America/Chicago') at time zone 'America/Chicago'-interval '12 hours');
select pg_temp.expect_prior_day_guard('fixture-prior-app',true);
select pg_temp.expect_prior_day_guard('fixture-unrelated',false);
rollback to app_edit;
savepoint live_override;
insert into app_sync_private.inventory_live_overrides_v1(canonical_unique_id,field_name,pending,updated_by,updated_at)
values('fixture-prior-override','priority',false,'fixture_actor',date_trunc('day',statement_timestamp() at time zone 'America/Chicago') at time zone 'America/Chicago'-interval '12 hours');
select pg_temp.expect_prior_day_guard('fixture-prior-override',true);
update app_sync_private.inventory_live_overrides_v1 set updated_by='' where canonical_unique_id='fixture-prior-override';
select pg_temp.expect_prior_day_guard('fixture-prior-override',false);
rollback to live_override;
savepoint location_evidence;
insert into app_sync_private.inventory_location_evidence_v1(itemcode_key,locationcode_key,itemcode,locationcode,source_unique_id,updated_by,updated_at)
values('fixture','fixture','fixture','fixture','fixture-prior-location','fixture_actor',date_trunc('day',statement_timestamp() at time zone 'America/Chicago') at time zone 'America/Chicago'-interval '12 hours');
select pg_temp.expect_prior_day_guard('fixture-prior-location',true);
update app_sync_private.inventory_location_evidence_v1 set updated_by='' where source_unique_id='fixture-prior-location';
select pg_temp.expect_prior_day_guard('fixture-prior-location',false);
rollback to location_evidence;
savepoint productivity;
insert into public.ph_productivity_history(event_key,completed_by_username,completed_by_display,completed_at,source_table,source_kind,source_unique_id,snapshot)
values('fixture-prior-history','fixture','fixture',date_trunc('day',statement_timestamp() at time zone 'America/Chicago') at time zone 'America/Chicago'-interval '12 hours','ph_master_inventory','fixture','fixture-prior-history','{}');
select pg_temp.expect_prior_day_guard('fixture-prior-history',true);
update public.ph_productivity_history set completed_at=statement_timestamp() where event_key='fixture-prior-history';
select pg_temp.expect_prior_day_guard('fixture-prior-history',false);
rollback to productivity;
rollback;

-- A direct, unbound service import retains its existing behavior even with
-- prior-day evidence; this is not the certified delayed Drive path.
begin;
set local statement_timeout='30s';
select set_config('request.jwt.claim.role','service_role',true);
insert into app_sync_private.ph_master_inventory_app_edits(canonical_unique_id,lineage_key,updated_at)
  select m.unique_id,'fixture-unbound',date_trunc('day',statement_timestamp() at time zone 'America/Chicago') at time zone 'America/Chicago'-interval '12 hours'
  from public.ph_master_inventory m where not exists(select 1 from app_sync_private.ph_master_inventory_app_edits e where e.canonical_unique_id=m.unique_id) limit 1;
select public.begin_dataset_import_v1(array['ph_master_inventory'],'e3078000-0000-4000-8000-000000000101',array['ph_master_inventory']);
create temp table prior_day_raw_receipt as select public.bulk_import_master_snapshot_v1(
  'e3078000-0000-4000-8000-000000000101','e3078000-0000-4000-8000-000000000102',
  '[{"values":{"unique_id":"raw-prune-control","itemcode":"CONTROL","locationcode":"A.01.001","lotcode":"28.F1"},"rawFields":[]}]'::jsonb,repeat('a',64)) receipt;
do $raw$
begin
  if not exists(select 1 from prior_day_raw_receipt where receipt->>'published'='true'
      and (receipt->>'sourceRows')::integer=1 and (receipt->>'inserted')::integer=1 and (receipt->>'deleted')::integer=9620)
    or not exists(select 1 from public.ph_master_inventory where unique_id='raw-prune-control') then
    raise exception 'PRIOR_DAY_RAW_CALLER_PARITY_FAILED';
  end if;
end
$raw$;
rollback;
