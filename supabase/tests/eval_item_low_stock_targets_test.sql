begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

select has_table('private', 'ph_eval_item_low_stock_import_runs', 'immutable import manifests are private');
select has_table('private', 'ph_eval_item_low_stock_file_versions', 'file revisions are stored privately');
select has_table('private', 'ph_eval_item_low_stock_order_rows', 'source order rows are stored privately');
select has_table('private', 'ph_eval_item_low_stock_target_stats', 'per-run aggregate cache exists');
select ok((select relrowsecurity from pg_class where oid = 'private.ph_eval_item_low_stock_target_stats'::regclass), 'aggregate cache has row-level security enabled');
select ok(not has_table_privilege('authenticated', 'private.ph_eval_item_low_stock_order_rows', 'select'), 'authenticated users cannot read raw order history');
select ok(not has_table_privilege('service_role', 'private.ph_eval_item_low_stock_order_rows', 'select'), 'importer uses guarded RPCs rather than direct table access');

select has_function('public', 'begin_eval_item_low_stock_import_v1', array['jsonb'], 'manifest import RPC exists');
select has_function('public', 'prepare_eval_item_low_stock_file_v1', array['uuid','text','text','text','date','timestamp with time zone','text','text','bigint','text','integer','integer','jsonb','text','text','timestamp with time zone'], 'file preparation RPC exists');
select has_function('public', 'get_eval_item_low_stock_targets_v1', array['text[]','text','integer'], 'authorized paginated target read exists');
select has_function('public', 'set_eval_item_low_stock_override_v1', array['text','integer','bigint'], 'revision-checked override RPC exists');
select ok((select proconfig @> array['statement_timeout=55s'] from pg_proc where oid='public.activate_eval_item_low_stock_import_v1(uuid)'::regprocedure), 'archive activation is bounded below PostgREST timeout');
select ok(has_function_privilege('authenticated', 'public.get_eval_item_low_stock_targets_v1(text[],text,integer)', 'execute'), 'authenticated users can call the permission-guarded read RPC');
select ok(has_function_privilege('authenticated', 'public.set_eval_item_low_stock_override_v1(text,integer,bigint)', 'execute'), 'authenticated users can call the identity-guarded override RPC');
select ok(not has_function_privilege('authenticated', 'public.begin_eval_item_low_stock_import_v1(jsonb)', 'execute'), 'authenticated users cannot import archive history');
select ok(
  pg_get_viewdef('private.eval_item_low_stock_target_stats_v1'::regclass)
    ~ 'ph_eval_item_low_stock_target_stats'
    and pg_get_viewdef('private.eval_item_low_stock_target_stats_v1'::regclass)
      !~ 'ph_eval_item_low_stock_order_rows',
  'read path uses activation-time cached aggregates instead of rescanning raw archive rows'
);
select is((select modules::text from app_sync_private.sources where key='private.ph_eval_item_low_stock_overrides'), '{managers}', 'manual override revisions are scoped to manager clients');
select ok((select count(*)=2 from public.app_dataset_revisions where key in ('private.ph_eval_item_low_stock_overrides','private.ph_eval_item_low_stock_import_state')), 'override and activation revision keys are registered');
select is((select count(*)::integer from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname in ('ph_eval_item_low_stock_overrides','ph_eval_item_low_stock_import_state')
    and t.tgname like 'app_dataset_revision_%' and not t.tgisinternal), 8, 'both physical sources invalidate live clients on writes');

create temporary table low_stock_test_users(username text primary key, id uuid not null) on commit drop;
insert into low_stock_test_users(username, id)
select requested.username, coalesce(existing.id, gen_random_uuid())
from (values ('dylan_collyge'),('megan_kelly'),('jd_jones'),('low_stock_unrelated_manager_fixture')) requested(username)
left join lateral (select p.id from public.profiles p where lower(btrim(p.username))=requested.username limit 1) existing on true;
insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
select u.id, 'low-stock-fixture-' || u.id || '@example.invalid', '{}'::jsonb, '{}'::jsonb
from low_stock_test_users u where not exists (select 1 from auth.users a where a.id=u.id);
insert into public.profiles(id, username, display_name, role, must_change_password)
select u.id, u.username, 'Low stock SQL fixture', 'ADMIN', false
from low_stock_test_users u where not exists (select 1 from public.profiles p where p.id=u.id);
insert into private.app_access_user_overrides(policy_id, profile_id, permission_key, allowed, access_scope)
select private.resolve_app_access_policy_id_v1(false), id, 'manager.assigned_items_export.view', true, 'global'
from low_stock_test_users where username = 'dylan_collyge'
on conflict (policy_id, profile_id, permission_key) do update set allowed = excluded.allowed, access_scope = excluded.access_scope;
create temporary table low_stock_validation_rejections(test_name text primary key) on commit drop;
create temporary table low_stock_resume_state(last_row integer) on commit drop;
create temporary table low_stock_revert_state(cleared boolean) on commit drop;
create temporary table low_stock_calculated_at(value timestamptz) on commit drop;
insert into public.ph_app_settings(key,value)
values ('current_season_salesyear', '{"seasonCode":"F1","salesYear":"27"}'::jsonb)
on conflict (key) do update set value=excluded.value;

-- Import actual database fixtures through the service-only RPC contract. Two
-- same-day snapshots share a group; creation time resolves their date-only tie.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.role', 'service_role', true);
do $import$
declare manifest jsonb := jsonb_build_array(
  jsonb_build_object('drive_file_id','pgtap-soc-a','source_revision','rev-a'),
  jsonb_build_object('drive_file_id','pgtap-soc-b','source_revision','rev-b'),
  jsonb_build_object('drive_file_id','pgtap-soc-c','source_revision','rev-c'),
  jsonb_build_object('drive_file_id','pgtap-reserves','source_revision','rev-r')
); run jsonb; prepared jsonb; file_id uuid;
begin
  run := public.begin_eval_item_low_stock_import_v1(manifest);
  prepared := public.prepare_eval_item_low_stock_file_v1(
    (run->>'run_id')::uuid,'pgtap-soc-a','rev-a','SOC-01.10-a.xlsx','2026-01-10','2026-01-10 00:00:00+00',
    'filename_date',repeat('a',64),1000,'SOC 01.10',4,3,'{}','eligible',null,'2026-01-10 15:00:00+00'
  );
  file_id := (prepared->>'file_version_id')::uuid;
  perform public.stage_eval_item_low_stock_rows_v1(file_id, jsonb_build_array(
    jsonb_build_object('group_key','G1','itemcode','TARGET-ITEM','quantity_ordered',10,'dock','D1','source_row_number',2,'source_sheet_name','SOC 01.10')
  ));
  prepared := public.prepare_eval_item_low_stock_file_v1(
    (run->>'run_id')::uuid,'pgtap-soc-a','rev-a','SOC-01.10-a.xlsx','2026-01-10','2026-01-10 00:00:00+00',
    'filename_date',repeat('a',64),1000,'SOC 01.10',4,3,'{}','eligible',null,'2026-01-10 15:00:00+00'
  );
  insert into low_stock_resume_state values ((prepared->>'last_staged_row_number')::integer);
  begin
    perform public.stage_eval_item_low_stock_rows_v1(file_id, jsonb_build_array(
      jsonb_build_object('group_key','G1','itemcode','TARGET-ITEM','quantity_ordered',1,'dock','0.0','source_row_number',50,'source_sheet_name','SOC 01.10')
    ));
    raise exception 'zero dock was accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'LOW_STOCK_IMPORT_ROWS_INVALID' then raise; end if;
    insert into low_stock_validation_rejections values ('zero_dock');
  end;
  begin
    perform public.stage_eval_item_low_stock_rows_v1(file_id, jsonb_build_array(
      jsonb_build_object('group_key','G1','itemcode','TARGET-ITEM','quantity_ordered','Infinity','dock','D1','source_row_number',51,'source_sheet_name','SOC 01.10')
    ));
    raise exception 'infinite quantity was accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'LOW_STOCK_IMPORT_ROWS_INVALID' then raise; end if;
    insert into low_stock_validation_rejections values ('infinite_qty');
  end;
  begin
    perform public.stage_eval_item_low_stock_rows_v1(file_id, jsonb_build_array(
      jsonb_build_object('group_key','G1','itemcode','NULL','quantity_ordered',1,'dock','D1','source_row_number',52,'source_sheet_name','SOC 01.10')
    ));
    raise exception 'NULL itemcode sentinel was accepted';
  exception when sqlstate '22023' then
    if sqlerrm <> 'LOW_STOCK_IMPORT_ROWS_INVALID' then raise; end if;
    insert into low_stock_validation_rejections values ('null_itemcode');
  end;
  perform public.stage_eval_item_low_stock_rows_v1(file_id, jsonb_build_array(
    jsonb_build_object('group_key','G1','itemcode','TARGET-ITEM','quantity_ordered',10,'dock','D1','source_row_number',2,'source_sheet_name','SOC 01.10'),
    jsonb_build_object('group_key','G1','itemcode','TARGET-ITEM','quantity_ordered',20,'dock','D1','source_row_number',3,'source_sheet_name','SOC 01.10'),
    jsonb_build_object('group_key','G2','itemcode','TARGET-ITEM','quantity_ordered',40,'dock','D1','source_row_number',4,'source_sheet_name','SOC 01.10')
  ));
  -- Retrying an identical chunk is idempotent.
  perform public.stage_eval_item_low_stock_rows_v1(file_id, jsonb_build_array(
    jsonb_build_object('group_key','G1','itemcode','TARGET-ITEM','quantity_ordered',10,'dock','D1','source_row_number',2,'source_sheet_name','SOC 01.10'),
    jsonb_build_object('group_key','G1','itemcode','TARGET-ITEM','quantity_ordered',20,'dock','D1','source_row_number',3,'source_sheet_name','SOC 01.10'),
    jsonb_build_object('group_key','G2','itemcode','TARGET-ITEM','quantity_ordered',40,'dock','D1','source_row_number',4,'source_sheet_name','SOC 01.10')
  ));
  perform public.finalize_eval_item_low_stock_file_v1(file_id,repeat('a',64),3);

  prepared := public.prepare_eval_item_low_stock_file_v1(
    (run->>'run_id')::uuid,'pgtap-soc-b','rev-b','SOC-01.10-b.xlsx','2026-01-10','2026-01-10 00:00:00+00',
    'filename_date',repeat('b',64),1000,'SOC 01.10',3,2,'{}','eligible',null,'2026-01-10 16:00:00+00'
  );
  file_id := (prepared->>'file_version_id')::uuid;
  perform public.stage_eval_item_low_stock_rows_v1(file_id, jsonb_build_array(
    jsonb_build_object('group_key','G1','itemcode','TARGET-ITEM','quantity_ordered',100,'dock','D1','source_row_number',2,'source_sheet_name','SOC 01.10'),
    jsonb_build_object('group_key','G1','itemcode','TARGET-ITEM','quantity_ordered',100,'dock','D1','source_row_number',3,'source_sheet_name','SOC 01.10')
  ));
  perform public.finalize_eval_item_low_stock_file_v1(file_id,repeat('b',64),2);

  prepared := public.prepare_eval_item_low_stock_file_v1(
    (run->>'run_id')::uuid,'pgtap-soc-c','rev-c','SOC-01.11-0800.xlsx','2026-01-11','2026-01-11 08:00:00+00',
    'filename_timestamp',repeat('c',64),1000,'SOC 01.11',2,1,'{}','eligible',null,'2026-01-11 16:00:00+00'
  );
  file_id := (prepared->>'file_version_id')::uuid;
  perform public.stage_eval_item_low_stock_rows_v1(file_id, jsonb_build_array(
    jsonb_build_object('group_key','G1','itemcode','TARGET-ITEM','quantity_ordered',10,'dock','D1','source_row_number',2,'source_sheet_name','SOC 01.11')
  ));
  perform public.finalize_eval_item_low_stock_file_v1(file_id,repeat('c',64),1);

  prepared := public.prepare_eval_item_low_stock_file_v1(
    (run->>'run_id')::uuid,'pgtap-reserves','rev-r','SOC Reserves.xlsx','2026-01-11','2026-01-11 09:00:00+00',
    'creation_time_fallback',repeat('d',64),500,null,12,0,'{"schema":"reserves"}','excluded','non_soc_reserves',null
  );
  file_id := (prepared->>'file_version_id')::uuid;
  perform public.finalize_eval_item_low_stock_file_v1(file_id,repeat('d',64),0);
  perform public.activate_eval_item_low_stock_import_v1((run->>'run_id')::uuid);
end
$import$;

do $revert$
declare original_manifest jsonb := jsonb_build_array(
  jsonb_build_object('drive_file_id','pgtap-soc-a','source_revision','rev-a'),
  jsonb_build_object('drive_file_id','pgtap-soc-b','source_revision','rev-b'),
  jsonb_build_object('drive_file_id','pgtap-soc-c','source_revision','rev-c'),
  jsonb_build_object('drive_file_id','pgtap-reserves','source_revision','rev-r')
); changed_manifest jsonb; pending jsonb; active jsonb;
begin
  changed_manifest := original_manifest || jsonb_build_array(jsonb_build_object('drive_file_id','transient-file','source_revision','temporary-revision'));
  pending := public.begin_eval_item_low_stock_import_v1(changed_manifest);
  if pending->>'complete' <> 'false' then raise exception 'changed manifest was unexpectedly complete'; end if;
  active := public.begin_eval_item_low_stock_import_v1(original_manifest);
  insert into low_stock_revert_state values(active->>'active'='true' and
    (select pending_run_id is null from private.ph_eval_item_low_stock_import_state where singleton));
end
$revert$;
insert into low_stock_calculated_at
select calculated_at from public.get_eval_item_low_stock_targets_v1(array['TARGET-ITEM']);

select ok((select active_run_id is not null and pending_run_id is null from private.ph_eval_item_low_stock_import_state where singleton), 'complete manifest activates atomically including explicit excluded files');
select ok((select bool_and(cleared) from low_stock_revert_state), 'restoring the current active manifest clears obsolete pending work');
select is((select jsonb_build_object('lines',qualifying_line_count,'days',qualifying_day_count,'files',source_file_count,'mean',mean_quantity,'p75',p75_quantity,'suggested',suggested_qty)
  from private.eval_item_low_stock_target_stats_v1 where itemcode_normalized='TARGET-ITEM'),
  '{"lines":4,"days":2,"files":3,"mean":62.5000000000000000,"p75":100,"suggested":163}'::jsonb,
  'latest full daily group bag, flattened line mean, nearest-rank P75 and suggested threshold are persisted');
select is((select count(*)::integer from private.ph_eval_item_low_stock_target_stats stats
  join private.ph_eval_item_low_stock_import_state state on state.active_run_id=stats.run_id
  where state.singleton and stats.itemcode_normalized='TARGET-ITEM'), 1, 'activation caches one item summary for indexed reads');
select is((select count(*)::integer from low_stock_validation_rejections), 3, 'zero Dock, non-finite quantity, and null-itemcode sentinels are rejected before staging');
select is((select max(last_row) from low_stock_resume_state), 2, 'prepare reports the last confirmed staged source row for bounded resume');

select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',(select id from low_stock_test_users where username='dylan_collyge'))::text, true);
select set_config('request.jwt.claim.sub', (select id::text from low_stock_test_users where username='dylan_collyge'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((select count(*)::integer from public.get_eval_item_low_stock_targets_v1(array['TARGET-ITEM'])), 1, 'authorized Assigned Items viewer reads item target');
select throws_ok($$select public.set_eval_item_low_stock_override_v1('TARGET-ITEM',100000001,0)$$, '22023', 'LOW_STOCK_OVERRIDE_INVALID', 'manual low-stock override rejects quantities above the supported cap');
insert into public.ph_master_inventory(unique_id,itemcode,season,saleyear,s_lts) values
 ('LOW-STOCK-F1','TARGET-ITEM','F1','27','162'),('LOW-STOCK-S1','TARGET-ITEM','S1','27','500');
select ok(private.eval_report2_item_qualifies_v1('low-stock','TARGET-ITEM'), 'Eval #2 uses derived target 163 while preserving F1 and support-season membership');
insert into public.ph_master_inventory(unique_id,itemcode,season,saleyear,s_lts) values
 ('LOW-STOCK-S1-CURRENT','TARGET-ITEM','S1','27','162'),('LOW-STOCK-S1-SUPPORT','TARGET-ITEM','U1','27','300'),
 ('LOW-STOCK-S1-F1-ONLY','TARGET-F1-ONLY','F1','27','149'),('LOW-STOCK-S1-F1-ONLY-SUPPORT','TARGET-F1-ONLY','U1','27','300');
update public.ph_app_settings set value=jsonb_set(value,'{seasonCode}','"S1"'::jsonb) where key='current_season_salesyear';
select ok(private.eval_report2_item_qualifies_v1('low-stock','TARGET-ITEM'), 'Eval #2 uses current S1 inventory against the derived item target');
select ok(not private.eval_report2_item_qualifies_v1('low-stock','TARGET-F1-ONLY'), 'prior F1 inventory does not qualify as current low stock during S1');
update public.ph_app_settings set value=jsonb_set(value,'{seasonCode}','"F1"'::jsonb) where key='current_season_salesyear';
select is((select jsonb_build_object('effective_qty',effective_qty,'calculated_at',calculated_at)
    from public.set_eval_item_low_stock_override_v1('TARGET-ITEM',160,0)),
  jsonb_build_object('effective_qty',160,'calculated_at',(select value from low_stock_calculated_at)),
  'Dylan can override the target without changing aggregate calculation time');
select ok(not private.eval_report2_item_qualifies_v1('low-stock','TARGET-ITEM'), 'Eval #2 uses the manual override threshold');
select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',(select id from low_stock_test_users where username='megan_kelly'))::text, true);
select set_config('request.jwt.claim.sub', (select id::text from low_stock_test_users where username='megan_kelly'), true);
select is((select effective_qty from public.set_eval_item_low_stock_override_v1('TARGET-ITEM',161,1)), 161, 'Megan can update the optimistic override revision');
select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',(select id from low_stock_test_users where username='jd_jones'))::text, true);
select set_config('request.jwt.claim.sub', (select id::text from low_stock_test_users where username='jd_jones'), true);
select is((select effective_qty from public.set_eval_item_low_stock_override_v1('TARGET-ITEM',null,2)), 163, 'JD can reset the override to the computed threshold');
select is((select count(distinct changed_by)::integer from private.ph_eval_item_low_stock_override_audit where itemcode_normalized='TARGET-ITEM'), 3, 'all three authorized editors are audited');

select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',(select id from low_stock_test_users where username='low_stock_unrelated_manager_fixture'))::text, true);
select set_config('request.jwt.claim.sub', (select id::text from low_stock_test_users where username='low_stock_unrelated_manager_fixture'), true);
select throws_ok($$select public.set_eval_item_low_stock_override_v1('TARGET-ITEM',170,3)$$, '42501', 'LOW_STOCK_OVERRIDE_FORBIDDEN', 'other active managers cannot edit low-stock overrides');

select * from finish();
rollback;
