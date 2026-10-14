-- @test-runtime: isolated-supabase
-- Bounded master-import reconciliation must preserve the existing row resolver
-- and publication fence while allowing the caller to make short RPCs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

select has_table('private','inventory_row_assignment_reconcile_runs',
  'per-run reconciliation progress is stored privately');
select has_table('private','inventory_row_assignment_reconcile_worklist',
  'the fenced source and retirement worklist is stored privately');
select has_function('public','reconcile_inventory_row_assignments_batch_v1',
  array['uuid','integer'],'service role can request bounded assignment reconciliation');
select ok(has_function_privilege('service_role',
    'public.reconcile_inventory_row_assignments_batch_v1(uuid,integer)','EXECUTE'),
  'service role can execute the bounded reconciliation RPC');
select ok(not has_function_privilege('authenticated',
    'public.reconcile_inventory_row_assignments_batch_v1(uuid,integer)','EXECUTE')
  and not has_function_privilege('anon',
    'public.reconcile_inventory_row_assignments_batch_v1(uuid,integer)','EXECUTE'),
  'client roles cannot execute the service reconciliation RPC');
select ok(not has_table_privilege('service_role',
    'private.inventory_row_assignment_reconcile_runs','SELECT')
  and not has_table_privilege('service_role',
    'private.inventory_row_assignment_reconcile_worklist','SELECT'),
  'checkpoint and worklist are not directly readable by API roles');
select ok(position('source_keys' in pg_get_functiondef(
    'public.reconcile_inventory_row_assignments_batch_v1(uuid,integer)'::regprocedure))>0
  and position('canonical_keys' in pg_get_functiondef(
    'public.reconcile_inventory_row_assignments_batch_v1(uuid,integer)'::regprocedure))>0,
  'batch RPC requires the same source and canonical master fence');
select ok(position('inventory_row_assignment_reconcile_finish_v1' in pg_get_functiondef(
    'app_sync_private.advance_import(uuid,text)'::regprocedure))>0
  and position('reconcile_inventory_row_assignments_v1' in pg_get_functiondef(
    'private.inventory_row_assignment_reconcile_finish_v1(uuid)'::regprocedure))>0,
  'finish validates prepared progress and retains the legacy fallback');

create function pg_temp.expect_error(command text, expected text) returns void language plpgsql as $$
begin
  begin
    execute command;
  exception when others then
    if position(expected in sqlerrm)>0 then return; end if;
    raise exception 'Expected %, got %',expected,sqlerrm;
  end;
  raise exception 'Expected error % was not raised',expected;
end $$;

-- The disposable isolated database is schema-only. Seed one current row and
-- one stale assignment row to verify that both paths use the existing resolver.
select is((select count(*) from public.ph_master_inventory),0::bigint,
  'isolated assignment batch fixture starts without business rows');
insert into public.ph_master_inventory(unique_id,itemcode,genusname,locationcode)
values ('batch-live-fixture','BATCH-LIVE','Testus','Z.99');
insert into public.ph_inventory_row_assignments(
  master_unique_id,unique_id,itemcode,itemcode_normalized,assignment_reason,
  present_in_drive,source_revision,revision
) values (
  'batch-stale-fixture','batch-stale-fixture','BATCH-STALE','BATCH-STALE',
  'existing_fixture',true,0,1
);

select app_sync_private.begin_import(
  array['ph_master_inventory'],
  'ae100000-0000-4000-8000-000000000001',
  array['ph_master_inventory']
);
create temporary table first_batch_result as
select public.reconcile_inventory_row_assignments_batch_v1(
  'ae100000-0000-4000-8000-000000000001',1
) as response;
select is((select response->>'status' from first_batch_result),'in_progress',
  'a one-row page returns in_progress when work remains');
select is((select (response->>'processed')::integer from first_batch_result),1,
  'the first RPC processes no more than the requested one row');
select is((select (response->>'total')::integer from first_batch_result),2,
  'the worklist includes one source row and one stale assignment row');
select is((select (response->>'retired')::integer from first_batch_result),0,
  'the source page does not report stale rows retired before their page');
select ok((select present_in_drive from public.ph_inventory_row_assignments
  where master_unique_id='batch-stale-fixture'),
  'the source page is processed before stale assignments');
select pg_temp.expect_error(
  $$select app_sync_private.advance_import(
    'ae100000-0000-4000-8000-000000000001','finish')$$,
  'PERENNIAL_ASSIGNMENT_RECONCILE_INCOMPLETE'
);

create temporary table second_batch_result as
select public.reconcile_inventory_row_assignments_batch_v1(
  'ae100000-0000-4000-8000-000000000001',1
) as response;
select is((select response->>'status' from second_batch_result),'completed',
  'the final bounded page completes the checkpoint');
select is((select (response->>'processed')::integer from second_batch_result),2,
  'completion reports cumulative rows processed');
select is((select (response->>'retired')::integer from second_batch_result),1,
  'completed output reports the legacy resolver retirement count');
select is((select count(*) from private.ph_inventory_row_assignment_audit
  where master_unique_id='batch-stale-fixture' and event_type='source_removed'),1::bigint,
  'bounded stale-row processing records exactly one source-removed audit');
update public.ph_inventory_row_assignments set present_in_drive=true
where master_unique_id='batch-stale-fixture';
select pg_temp.expect_error(
  $$select app_sync_private.advance_import(
    'ae100000-0000-4000-8000-000000000001','finish')$$,
  'PERENNIAL_ASSIGNMENT_RECONCILE_INCOMPLETE'
);
update public.ph_inventory_row_assignments set present_in_drive=false
where master_unique_id='batch-stale-fixture';

create temporary table retry_batch_result as
select public.reconcile_inventory_row_assignments_batch_v1(
  'ae100000-0000-4000-8000-000000000001',1
) as response;
select is((select response->>'status' from retry_batch_result),'completed',
  'retry after a completed response is idempotent');
select is((select (response->>'processed')::integer from retry_batch_result),2,
  'completed retry does not advance or duplicate the cursor');
select is((select count(*) from private.ph_inventory_row_assignment_audit
  where master_unique_id='batch-stale-fixture' and event_type='source_removed'),1::bigint,
  'completed retry does not duplicate retirement audit');
select app_sync_private.advance_import(
  'ae100000-0000-4000-8000-000000000001','finish'
);
select is((select state from public.app_dataset_revisions where key='ph_master_inventory'),
  'ready','the normal finish path publishes only after complete witnessed reconciliation');
select is((select count(*) from app_sync_private.import_leases
  where run_id='ae100000-0000-4000-8000-000000000001'),0::bigint,
  'successful finish releases the normal import lease');
select pg_temp.expect_error(
  $$select public.reconcile_inventory_row_assignments_batch_v1(null::uuid,101)$$,
  'INVENTORY_ROW_ASSIGNMENT_BATCH_SIZE_INVALID'
);

-- A changed source may reset a pass once. A second change must fail closed
-- without clearing the active import fence.
insert into public.ph_master_inventory(unique_id,itemcode,genusname,locationcode)
values ('batch-reset-one','RESET-ONE','Testus','Z.99'),
       ('batch-reset-two','RESET-TWO','Testus','Z.99');
select app_sync_private.begin_import(
  array['ph_master_inventory'],
  'ae100000-0000-4000-8000-000000000002',
  array['ph_master_inventory']
);
select is((public.reconcile_inventory_row_assignments_batch_v1(
  'ae100000-0000-4000-8000-000000000002',1)->>'status'),'in_progress',
  'second run begins with a bounded page');
select set_config('request.headers',
  '{"x-gnc-import-run-id":"ae100000-0000-4000-8000-000000000002"}',true);
update public.ph_master_inventory set itemcode='RESET-ONE-A'
where unique_id='batch-reset-one';
select is((public.reconcile_inventory_row_assignments_batch_v1(
  'ae100000-0000-4000-8000-000000000002',1)->>'status'),'reset',
  'first source witness change resets the checkpoint');
select is((select processed_count from private.inventory_row_assignment_reconcile_runs
  where import_run_id='ae100000-0000-4000-8000-000000000002'),0,
  'reset clears prior cursor coverage');
update public.ph_master_inventory set itemcode='RESET-ONE-B'
where unique_id='batch-reset-one';
select pg_temp.expect_error(
  $$select public.reconcile_inventory_row_assignments_batch_v1(
    'ae100000-0000-4000-8000-000000000002',1)$$,
  'INVENTORY_ROW_ASSIGNMENT_SOURCE_CHANGED'
);
select ok(exists(select 1 from app_sync_private.import_leases
  where key='ph_master_inventory' and run_id='ae100000-0000-4000-8000-000000000002'),
  'second witness change leaves the master import fence intact');
select app_sync_private.advance_import(
  'ae100000-0000-4000-8000-000000000002','fail'
);

select * from finish();
rollback;
