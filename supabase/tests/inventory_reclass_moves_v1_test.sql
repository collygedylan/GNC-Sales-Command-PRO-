-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

create function pg_temp.reclass_move_raw_fields_v1(p_values jsonb) returns jsonb
language sql immutable set search_path = '' as $function$
  select coalesce(jsonb_agg(k.key order by k.key),'[]'::jsonb)
  from jsonb_object_keys(p_values) as k(key)
  where k.key=any(array['locationnote','locationptn1','desigitem','desigcust','desigloc',
    'pullerresponsibility','oversellpercentage','salesnote','suspend']::text[])
$function$;

select has_function('public','apply_inventory_reclass_moves_v1',array['uuid','text','bigint','jsonb'],'atomic Reclass batch RPC exists');
select has_function('public','get_inventory_reclass_move_status_v1',array['uuid','text'],'Reclass move receipt status RPC exists');
select ok(
  private.ph_master_inventory_lineage_key_v1(row_value)=private.ph_master_inventory_lineage_key_v1(to_jsonb(row_value)),
  'typed lineage identity matches the established JSON helper including null and empty fallbacks')
from (select jsonb_populate_record(null::public.ph_master_inventory,jsonb_build_object(
  'warehouseid',null,'warehousei','WH-ALT','itemcode','','contsize',null,'locationcode','LOC',
  'lotcode',null,'source','','desigitem',null,'desigcust','','desigloc',null)) row_value) fixture;
select ok(
  private.ph_master_inventory_stable_identity_v7(row_value)=private.ph_master_inventory_stable_identity_v7(to_jsonb(row_value)),
  'typed Item6 identity matches the established JSON helper including null and empty fallbacks')
from (select jsonb_populate_record(null::public.ph_master_inventory,jsonb_build_object(
  'warehouseid',null,'warehousei','WH-ALT','itemcode','','contsize',null,'locationcode','LOC',
  'lotcode',null,'source','')) row_value) fixture;
select ok(position('select (jsonb_populate_record' in regexp_replace(lower(pg_get_functiondef(
  'public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb)'::regprocedure)),'[[:space:]]+',' ','g'))=0
  and position('from jsonb_populate_record' in regexp_replace(lower(pg_get_functiondef(
    'public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb)'::regprocedure)),'[[:space:]]+',' ','g'))>0,
  'single-source insert expands a lateral row function once rather than per projected column');
select ok(position('select (jsonb_populate_record' in regexp_replace(lower(pg_get_functiondef(
  'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))=0
  and position('cross join lateral jsonb_populate_record' in regexp_replace(lower(pg_get_functiondef(
    'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0,
  'batch insert expands a lateral row function once rather than per projected column');
select ok(position('with updated_sources as (' in regexp_replace(lower(pg_get_functiondef(
  'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0
  and position('returning m.*' in regexp_replace(lower(pg_get_functiondef(
    'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0
  and position('insert into pg_temp.reclass_batch_source_after_v1 select s.source_index,u.* from updated_sources u' in regexp_replace(lower(pg_get_functiondef(
    'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0
  and position('insert into pg_temp.reclass_batch_target_after_v1 select t.source_index,t.destination_season,i.* from inserted_targets i' in regexp_replace(lower(pg_get_functiondef(
    'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0
  and position('source_after=to_jsonb(a)-''source_index''' in regexp_replace(lower(pg_get_functiondef(
    'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0
  and position('destination_after=to_jsonb(a)-array[''source_index'',''destination_season'']' in regexp_replace(lower(pg_get_functiondef(
    'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0,
  'batch receipt snapshots come from actual source/target rows returned by DML and serialize once after mutation');
select ok(position('analyze pg_temp.reclass_batch_sources_v1' in regexp_replace(lower(pg_get_functiondef(
  'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0
  and position('analyze pg_temp.reclass_batch_lines_v1' in regexp_replace(lower(pg_get_functiondef(
    'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0
  and position('analyze pg_temp.reclass_batch_targets_v1' in regexp_replace(lower(pg_get_functiondef(
    'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0,
  'batch staging tables receive actual cardinality statistics before joins');
select ok(position('insert into pg_temp.reclass_batch_source_json_v1(source_index,source_before,source_after)' in regexp_replace(lower(pg_get_functiondef(
  'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0
  and position('select b.source_index,to_jsonb(b)-''source_index'',''{}''::jsonb' in regexp_replace(lower(pg_get_functiondef(
    'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0
  and position('private.ph_master_inventory_lineage_key_v1(j.source_before)' in regexp_replace(lower(pg_get_functiondef(
    'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0
  and position('private.ph_master_inventory_lineage_key_v1(to_jsonb(m))' in regexp_replace(lower(pg_get_functiondef(
    'private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))=0,
  'batch source rows serialize each full master row once before lineage derivation');
select ok(has_function_privilege('service_role','public.apply_inventory_reclass_moves_v1(uuid,text,bigint,jsonb)','execute'),'service role can call the batch RPC');
select ok(not has_function_privilege('authenticated','public.apply_inventory_reclass_moves_v1(uuid,text,bigint,jsonb)','execute'),'browser sessions cannot bypass app-api authorization');
select ok(not has_function_privilege('anon','public.apply_inventory_reclass_moves_v1(uuid,text,bigint,jsonb)','execute'),'anonymous sessions cannot call the batch RPC');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname=any(array['ph_inventory_reclass_commands_v1','ph_inventory_reclass_batch_receipts_v1',
    'ph_inventory_reclass_movements_v1','ph_inventory_reclass_import_aliases_v1','ph_inventory_reclass_import_conflicts_v1'])),
  'all private command, receipt, movement, and alias tables enforce RLS');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) roles(role_name)
  cross join unnest(array['ph_inventory_reclass_commands_v1','ph_inventory_reclass_batch_receipts_v1',
    'ph_inventory_reclass_movements_v1','ph_inventory_reclass_import_aliases_v1','ph_inventory_reclass_import_conflicts_v1']) tables(table_name)
  where has_table_privilege(role_name,'private.'||table_name,'select')
    or has_table_privilege(role_name,'private.'||table_name,'insert')
    or has_table_privilege(role_name,'private.'||table_name,'update')
    or has_table_privilege(role_name,'private.'||table_name,'delete')),
  'no API role may directly read or mutate private reclass data');
select ok((select count(*)=3 from pg_trigger t
  where t.tgrelid='public.ph_master_inventory'::regclass
    and t.tgname in ('aaa_ph_master_inventory_priority_hold_shield',
      'aaa_ph_master_inventory_priority_hold_shield_insert','aaa_ph_master_inventory_priority_hold_shield_delete')
    and not t.tgisinternal)
  and exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
    and t.tgname='aaa_ph_master_inventory_priority_hold_shield' and (t.tgtype & 16)<>0 and t.tgqual is not null)
  and exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
    and t.tgname='aaa_ph_master_inventory_priority_hold_shield_insert' and (t.tgtype & 4)<>0)
  and exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
    and t.tgname='aaa_ph_master_inventory_priority_hold_shield_delete' and (t.tgtype & 8)<>0),
  'priority and hold shield retains all events while quantity-only updates use a guarded fast path');
select ok((select count(*)=2 from pg_trigger t
  where t.tgrelid='public.ph_master_inventory'::regclass
    and t.tgname in ('aab_ph_master_inventory_item6_guard_v7','aab_ph_master_inventory_item6_guard_v7_delete')
    and not t.tgisinternal)
  and exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
    and t.tgname='aab_ph_master_inventory_item6_guard_v7' and (t.tgtype & 16)<>0 and t.tgqual is not null)
  and exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
    and t.tgname='aab_ph_master_inventory_item6_guard_v7_delete' and (t.tgtype & 8)<>0),
  'Item6 guard retains delete and import/protected-field updates while skipping unrelated quantity updates');
select ok((select count(*)=2 from pg_trigger t
  where t.tgrelid='public.ph_master_inventory'::regclass
    and t.tgname in ('zzz_ph_master_inventory_item6_lineage_v7','zzz_ph_master_inventory_item6_lineage_v7_update')
    and not t.tgisinternal)
  and exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
    and t.tgname='zzz_ph_master_inventory_item6_lineage_v7' and (t.tgtype & 4)<>0)
  and exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
    and t.tgname='zzz_ph_master_inventory_item6_lineage_v7_update' and (t.tgtype & 16)<>0 and t.tgqual is not null),
  'Item6 lineage keeps inserts and relevant/import updates while skipping quantity-only updates');
select ok((select bool_and(tgqual is not null) from pg_trigger
  where tgrelid='public.ph_master_inventory'::regclass
    and tgname=any(array['trigger_inventory_changes','sync_season_sales_av_note_reset','trigger_new_assignment']::text[])),
  'existing broad update handlers use OLD/NEW guards instead of UPDATE OF column lists');

create temporary table reclass_move_actor(id uuid primary key) on commit drop;
insert into reclass_move_actor values(gen_random_uuid());
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select id,'inventory-reclass-v1@example.invalid',now(),'{}'::jsonb,'{}'::jsonb from reclass_move_actor
on conflict(id) do update set email=excluded.email,email_confirmed_at=now();
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until)
select id,'inventory_reclass_v1_test','Inventory Reclass V1 Test','ADMIN',false,null,null from reclass_move_actor
on conflict(id) do update set role='ADMIN',must_change_password=false,disabled_at=null,locked_until=null;
insert into private.app_access_user_overrides(policy_id,profile_id,permission_key,allowed,access_scope)
select private.resolve_app_access_policy_id_v1(false),id,'drive.reclass.submit',true,'global' from reclass_move_actor
on conflict(policy_id,profile_id,permission_key) do update set allowed=true,access_scope='global';

create temporary table reclass_move_sources(unique_id text primary key) on commit drop;
insert into reclass_move_sources values('reclass-move-v1-a-'||gen_random_uuid()::text),('reclass-move-v1-b-'||gen_random_uuid()::text);
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,source,season,saleyear)
select unique_id,'RECLASS-MOVE-V1','Reclass fixture','#3','C.16.000',case when unique_id like '%-a-%' then '27.F1' else '28.F1' end,
  '12','9','PH','F1','27' from reclass_move_sources;
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,source,season,saleyear)
select 'reclass-existing-u1-'||gen_random_uuid()::text,'RECLASS-MOVE-V1','Existing destination fixture','#3','C.16.000','27.U1',
  '10','8','PH','U1','27';
create temporary table reclass_bad_destination(source_uid text primary key,target_uid text not null) on commit drop;
insert into reclass_bad_destination values(gen_random_uuid()::text,gen_random_uuid()::text);
create temporary table reclass_move_call(result jsonb) on commit drop;
create temporary table reclass_move_request(request jsonb) on commit drop;
create temporary table reclass_move_import(mode text primary key,result jsonb) on commit drop;
create temporary table reclass_move_delivery_results(first_result jsonb,replay_result jsonb) on commit drop;
create temporary table reclass_returning_exact_v1(passed boolean not null) on commit drop;
create temporary table reclass_child_replay_exact_v1(passed boolean not null) on commit drop;
create temporary table reclass_child_marker_guards_v1(missing_parent boolean not null,bad_index boolean not null) on commit drop;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
create function pg_temp.reclass_mutate_hold_before_v1() returns trigger
language plpgsql set search_path = '' as $function$
begin
  if new.unique_id='reclass-fastpath-before-trigger-probe' and new.ptronhand is distinct from old.ptronhand then
    new.holdstopcode:='H';
  end if;
  return new;
end
$function$;
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,
  source,season,saleyear,holdstopcode,av_note)
values('reclass-fastpath-before-trigger-probe','RECLASS-FASTPATH-PROBE','Trigger guard fixture','#3','C.16.000','1.F1',
  '1','1','PH','F1','27','','before-trigger-note');
create trigger aaa0_reclass_fastpath_before_trigger_probe before update on public.ph_master_inventory
for each row execute function pg_temp.reclass_mutate_hold_before_v1();
update public.ph_master_inventory set ptronhand='2' where unique_id='reclass-fastpath-before-trigger-probe';
select ok((select holdstopcode='H' and av_note is null from public.ph_master_inventory
  where unique_id='reclass-fastpath-before-trigger-probe'),
  'OLD/NEW trigger filters retain work for fields changed by an earlier BEFORE trigger');
drop trigger aaa0_reclass_fastpath_before_trigger_probe on public.ph_master_inventory;
drop function pg_temp.reclass_mutate_hold_before_v1();
select set_config('gnc.inventory_reclass_batch',gen_random_uuid()::text,true);
select ok(not private.ph_inventory_reclass_batch_context_v1(current_setting('gnc.inventory_reclass_batch')::uuid),
  'a caller supplied batch marker without a transaction-bound private receipt cannot defer crop-roll projection');
select set_config('gnc.inventory_reclass_batch','',true);

do $test$
declare actor_id uuid; expected_revision bigint; source_a text; source_b text; request_payload jsonb; result_value jsonb; replay_value jsonb;
  compact_result jsonb; decoded_rows jsonb;
  child_command_row private.ph_inventory_reclass_commands_v1%rowtype; child_expected jsonb; child_replay jsonb;
  marker_missing_parent boolean:=false; marker_bad_index boolean:=false;
  target_a text; target_b text; status_value jsonb; run_id uuid; import_result jsonb; imported_rows jsonb;
begin
  select id into actor_id from reclass_move_actor;
  select revision into expected_revision from public.app_dataset_revisions where key='ph_master_inventory';
  select unique_id into source_a from reclass_move_sources where unique_id like '%-a-%';
  select unique_id into source_b from reclass_move_sources where unique_id like '%-b-%';
  select jsonb_build_array(
    jsonb_build_object('source',jsonb_build_object('uniqueId',source_a,'identity',jsonb_build_object(
      'unique_id',m.unique_id,'itemcode',m.itemcode,'contsize',m.contsize,'locationcode',m.locationcode,'lotcode',m.lotcode,
      'season',m.season,'ptronhand',m.ptronhand,'ptravailable',m.ptravailable)),
      'lines',jsonb_build_array(jsonb_build_object('direction','move_up','destinationSeason','U1','quantity',3),
        jsonb_build_object('direction','move_down','destinationSeason','U1','quantity',2))),
    jsonb_build_object('source',jsonb_build_object('uniqueId',source_b,'identity',jsonb_build_object(
      'unique_id',n.unique_id,'itemcode',n.itemcode,'contsize',n.contsize,'locationcode',n.locationcode,'lotcode',n.lotcode,
      'season',n.season,'ptronhand',n.ptronhand,'ptravailable',n.ptravailable)),
      'lines',jsonb_build_array(jsonb_build_object('direction','move_up','destinationSeason','U2','quantity',4)))
  ) into request_payload
  from public.ph_master_inventory m cross join public.ph_master_inventory n where m.unique_id=source_a and n.unique_id=source_b;
  insert into reclass_move_request values(request_payload);
  result_value:=public.apply_inventory_reclass_moves_with_delivery_v1(actor_id,'reclass-move-v1-command-00001',expected_revision,request_payload,null);
  insert into reclass_move_call values(result_value);
  if nullif(current_setting('gnc.inventory_reclass_batch',true),'') is not null then raise exception 'batch defer marker leaked past operation'; end if;
  if result_value->>'status' <> 'applied' or jsonb_array_length(result_value->'movements') <> 3 then raise exception 'batch result missing movement receipts'; end if;
  if jsonb_array_length(result_value->'rows') <> 4 then raise exception 'batch result must contain two source and two target rows'; end if;
  if (select ptronhand from public.ph_master_inventory where unique_id=source_a) <> '7'
    or (select ptravailable from public.ph_master_inventory where unique_id=source_a) <> '4' then raise exception 'source A quantities not reduced'; end if;
  if (select ptronhand from public.ph_master_inventory where unique_id=source_b) <> '8'
    or (select ptravailable from public.ph_master_inventory where unique_id=source_b) <> '5' then raise exception 'source B quantities not reduced'; end if;
  if (select sum(ptronhand::numeric) from public.ph_master_inventory where itemcode='RECLASS-MOVE-V1') <> 34
    or (select sum(ptravailable::numeric) from public.ph_master_inventory where itemcode='RECLASS-MOVE-V1') <> 26 then raise exception 'OH or available quantity was not conserved'; end if;
  select value->>'destinationUniqueId' into target_a from jsonb_array_elements(result_value->'movements') e(value) where value->>'destinationSeason'='U1' limit 1;
  select value->>'destinationUniqueId' into target_b from jsonb_array_elements(result_value->'movements') e(value) where value->>'destinationSeason'='U2' limit 1;
  if target_a not like 'reclass-existing-u1-%'
    or (select ptronhand from public.ph_master_inventory where unique_id=target_a) <> '15'
    or (select ptravailable from public.ph_master_inventory where unique_id=target_a) <> '13' then raise exception 'existing U1 target identity or aggregate balance incorrect'; end if;
  if (select ptronhand from public.ph_master_inventory where unique_id=target_b) <> '4'
    or (select ptravailable from public.ph_master_inventory where unique_id=target_b) <> '4' then raise exception 'U2 target balance incorrect'; end if;
  insert into reclass_returning_exact_v1
  select count(*)=3 and bool_and(m.source_after=to_jsonb(source_row) and m.destination_after=to_jsonb(destination_row))
  from private.ph_inventory_reclass_movements_v1 m
  join public.ph_master_inventory source_row on source_row.unique_id=m.source_unique_id
  join public.ph_master_inventory destination_row on destination_row.unique_id=m.destination_unique_id
  where m.request_id in (select unnest(child_request_ids) from private.ph_inventory_reclass_batch_receipts_v1
    where command_id='reclass-move-v1-command-00001');
  if exists(select 1 from jsonb_array_elements(result_value->'rows') e(value)
    join public.ph_master_inventory master on master.unique_id=e.value#>>'{row,unique_id}'
    cross join lateral public.v2_crop_roll_drive_row_from_json(to_jsonb(master)) mapped
    left join public.ph_crop_roll_drive_rows crop on crop.master_unique_id=master.unique_id
    where crop.master_unique_id is null
      or (to_jsonb(crop)-array['created_at','updated_at']) is distinct from (to_jsonb(mapped)-array['created_at','updated_at'])) then
    raise exception 'set-based crop-roll projection differs from full authoritative mapper output';
  end if;
  if (select count(*) from public.ph_inventory_transactions where event_type='inventory_reclass_move' and raw_payload->>'commandId'='reclass-batch:'||left(encode(extensions.digest(convert_to('reclass-move-v1-command-00001:1','UTF8'),'sha256'),'hex'),40)) <> 2 then
    raise exception 'original audit lines were not retained';
  end if;
  replay_value:=public.apply_inventory_reclass_moves_with_delivery_v1(actor_id,'reclass-move-v1-command-00001',expected_revision,request_payload,null);
  if replay_value-'duplicate'-'emailQueued'-'deliveryEventId' is distinct from result_value-'duplicate'-'emailQueued'-'deliveryEventId'
    or result_value->>'duplicate'<>'false' or replay_value->>'duplicate'<>'true'
    or result_value->>'emailQueued'<>'true' or replay_value->>'emailQueued'<>'true'
    or result_value->>'deliveryEventId' is distinct from replay_value->>'deliveryEventId' then
    raise exception 'exact replay changed movement receipt or duplicated its delivery event';
  end if;
  insert into reclass_move_delivery_results values(result_value,replay_value);
  select c.* into child_command_row from private.ph_inventory_reclass_commands_v1 c
    where c.actor_id=(select id from reclass_move_actor) and c.command_id like 'reclass-batch:%' and c.request->>'sourceUid'=source_a;
  if child_command_row.request_id is null then raise exception 'batch child command receipt missing'; end if;
  child_expected:=jsonb_build_object('ok',true,'commandId',child_command_row.command_id,'requestId',child_command_row.request_id,
    'revision',result_value->'revision',
    'rows',(select coalesce(jsonb_agg(e.value order by e.ordinality),'[]'::jsonb)
      from jsonb_array_elements(result_value->'rows') with ordinality e(value,ordinality)
      where e.value#>>'{row,unique_id}' in (source_a,target_a)),
    'movements',(select coalesce(jsonb_agg(e.value-'sourceIndex' order by e.ordinality),'[]'::jsonb)
      from jsonb_array_elements(result_value->'movements') with ordinality e(value,ordinality)
      where (e.value->>'sourceIndex')::integer=1),
    'status','applied','importStatus','pending');
  child_replay:=public.apply_inventory_reclass_move_v1(actor_id,child_command_row.command_id,
    (child_command_row.request->>'expectedRevision')::bigint,child_command_row.request->>'sourceUid',
    child_command_row.request->'sourceIdentity',child_command_row.request->'lines');
  insert into reclass_child_replay_exact_v1
  values(child_command_row.result=jsonb_build_object('_batchResultReference',true,'batchRequestId',
      (select request_id from private.ph_inventory_reclass_batch_receipts_v1
       where command_id='reclass-move-v1-command-00001'), 'sourceIndex',
      (select array_position(child_request_ids,child_command_row.request_id)
       from private.ph_inventory_reclass_batch_receipts_v1 where command_id='reclass-move-v1-command-00001'))
    and child_replay=child_expected);
  begin
    update private.ph_inventory_reclass_commands_v1 set result=jsonb_set(result,'{batchRequestId}',
      to_jsonb(gen_random_uuid()::text)) where request_id=child_command_row.request_id;
    perform private.replay_inventory_reclass_batch_child_v1(child_command_row.request_id);
  exception when others then
    marker_missing_parent:=sqlerrm='INVENTORY_RECLASS_PARENT_RECEIPT_MISSING';
  end;
  update private.ph_inventory_reclass_commands_v1 set result=child_command_row.result
    where request_id=child_command_row.request_id;
  begin
    update private.ph_inventory_reclass_commands_v1 set result=jsonb_set(result,'{sourceIndex}',
      to_jsonb(3-(result->>'sourceIndex')::integer))
      where request_id=child_command_row.request_id;
    perform private.replay_inventory_reclass_batch_child_v1(child_command_row.request_id);
  exception when others then
    marker_bad_index:=sqlerrm='INVENTORY_RECLASS_CHILD_RECEIPT_INVALID';
  end;
  update private.ph_inventory_reclass_commands_v1 set result=child_command_row.result
    where request_id=child_command_row.request_id;
  insert into reclass_child_marker_guards_v1 values(marker_missing_parent,marker_bad_index);
  status_value:=public.get_inventory_reclass_move_status_v1(actor_id,'reclass-move-v1-command-00001');
  if status_value->>'status' <> 'applied' or status_value->>'importStatus' <> 'pending' then
    raise exception 'committed movement must remain applied while awaiting import acknowledgment';
  end if;
  compact_result:=public.get_inventory_reclass_move_status_compact_v1(actor_id,'reclass-move-v1-command-00001');
  select coalesce(jsonb_agg(jsonb_build_object('table',r.value->>'table','row',(
      select jsonb_object_agg(k.value,coalesce(r.value->'values'->k.value,'null'::jsonb))
      from jsonb_array_elements_text(compact_result->'rowColumns') k(value))) order by r.ordinality),'[]'::jsonb)
    into decoded_rows from jsonb_array_elements(compact_result->'rows') with ordinality r(value,ordinality);
  if compact_result->>'rowEncoding'<>'master-null-elision-v1'
     or jsonb_array_length(compact_result->'rowColumns')<>213
     or decoded_rows is distinct from status_value->'rows' then
    raise exception 'compact status codec did not reconstruct the exact full historical row set';
  end if;
  compact_result:=public.apply_inventory_reclass_moves_compact_v1(actor_id,'reclass-move-v1-command-00001',expected_revision,request_payload);
  if compact_result->>'rowEncoding'<>'master-null-elision-v1'
     or compact_result->>'revision' is distinct from result_value->>'revision'
     or compact_result->>'requestId' is distinct from result_value->>'requestId' then
    raise exception 'compact idempotent apply changed committed receipt identity';
  end if;

  -- Replaying the pre-move ERP snapshot must retain the application-applied
  -- balances and protect absent generated targets without applying twice.
  run_id:='b3000000-0000-4000-8000-000000000001';
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',run_id::text)::text,true);
  select jsonb_agg(jsonb_build_object('values',jsonb_build_object(
      'unique_id',before_row->>'unique_id','itemcode',before_row->>'itemcode','contsize',before_row->>'contsize',
      'locationcode',before_row->>'locationcode','lotcode',before_row->>'lotcode','source',before_row->>'source',
      'warehousei',before_row->>'warehousei','warehouseid',before_row->>'warehouseid','season',before_row->>'season',
      'ptronhand',before_row->>'ptronhand','ptravailable',before_row->>'ptravailable'),
      'rawFields','[]'::jsonb) order by row_uid) into imported_rows
  from (select source_uid row_uid,before_row from (
      select distinct on(m.source_unique_id) m.source_unique_id source_uid,m.source_before before_row
      from private.ph_inventory_reclass_movements_v1 m
      where m.request_id in (select unnest(child_request_ids) from private.ph_inventory_reclass_batch_receipts_v1
        where command_id='reclass-move-v1-command-00001') order by m.source_unique_id,m.line_index) source_before_rows
    union all
    select destination_uid,destination_before from (
      select distinct on(m.destination_unique_id) m.destination_unique_id destination_uid,m.destination_before
      from private.ph_inventory_reclass_movements_v1 m
      where m.request_id in (select unnest(child_request_ids) from private.ph_inventory_reclass_batch_receipts_v1
        where command_id='reclass-move-v1-command-00001') and m.destination_before is not null
      order by m.destination_unique_id,m.line_index) target_before_rows) pre_state_rows;
  import_result:=public.bulk_import_master_snapshot_v1(run_id,'b4000000-0000-4000-8000-000000000001',imported_rows,repeat('a',64));
  insert into reclass_move_import values('pre',import_result);
  if import_result->>'published' <> 'true' then raise exception 'exact pre-state import failed publication'; end if;
  if (select ptronhand from public.ph_master_inventory where unique_id=source_a) <> '7'
    or (select ptronhand from public.ph_master_inventory where unique_id=target_a) <> '15' then raise exception 'pre-state import double-applied or deleted reclass balances'; end if;
  perform public.finish_dataset_import_v1(run_id);

  -- An exact post-move snapshot acknowledges the receipt and releases its
  -- import protection while preserving the canonical target UIDs.
  run_id:='b3000000-0000-4000-8000-000000000002';
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',run_id::text)::text,true);
  select jsonb_agg(jsonb_build_object('values',to_jsonb(m),'rawFields',pg_temp.reclass_move_raw_fields_v1(to_jsonb(m))) order by m.unique_id)
    into imported_rows from public.ph_master_inventory m where m.itemcode='RECLASS-MOVE-V1';
  import_result:=public.bulk_import_master_snapshot_v1(run_id,'b4000000-0000-4000-8000-000000000002',imported_rows,repeat('b',64));
  insert into reclass_move_import values('post',import_result);
  if import_result->>'published' <> 'true' then raise exception 'exact post-state import failed publication'; end if;
  perform public.finish_dataset_import_v1(run_id);
  status_value:=public.get_inventory_reclass_move_status_v1(actor_id,'reclass-move-v1-command-00001');
  if status_value->>'status' <> 'applied' or status_value->>'importStatus' <> 'acknowledged' then
    raise exception 'exact post-state import did not acknowledge the committed movement';
  end if;
  perform set_config('request.headers','{}',true);
end
$test$;

select ok((select count(*)=1 from public.ph_request_delivery_outbox o
  cross join reclass_move_delivery_results d
  where o.event_id=(d.first_result->>'deliveryEventId')::uuid
    and o.event_key='inventory-reclass-move-completed:'||(select id::text from reclass_move_actor)||':reclass-move-v1-command-00001'
    and o.event_type='inventory_reclass_move_completed' and o.status='pending'
    and o.request_id=d.first_result->>'requestId'),
  'successful movement and one pending delivery intent share the same command receipt');
select ok((select o.payload->>'contractVersion'='inventory-reclass-move-completed-v1'
    and o.payload->>'actorProfileId'=(select id::text from reclass_move_actor)
    and o.payload->>'actorEmail'=(select lower(u.email) from auth.users u where u.id=(select id from reclass_move_actor))
    and o.payload->'deliveryRecipients' @> jsonb_build_array((select lower(u.email) from auth.users u where u.id=(select id from reclass_move_actor)))
    and jsonb_array_length(o.payload->'deliveryRecipients')=6
    and jsonb_array_length(o.payload->'moves')=3
  from public.ph_request_delivery_outbox o cross join reclass_move_delivery_results d
  where o.event_id=(d.first_result->>'deliveryEventId')::uuid),
  'outbox payload is frozen from the server receipt and includes authenticated actor, server recipients, and movement details');

select ok((select passed from reclass_returning_exact_v1),
  'movement source and destination snapshots exactly match persisted rows after all master triggers');
select ok((select passed from reclass_child_replay_exact_v1),
  'compact child receipt references replay as the exact original public single-command response');
select ok((select count(*)=1 and bool_and(missing_parent and bad_index) from reclass_child_marker_guards_v1),
  'compact child receipt rejects missing or cross-parent reference metadata');
select throws_ok($$select public.apply_inventory_reclass_move_v1(c.actor_id,c.command_id,
    (c.request->>'expectedRevision')::bigint,c.request->>'sourceUid',c.request->'sourceIdentity',
    jsonb_set(c.request->'lines','{0,quantity}','999'::jsonb))
  from private.ph_inventory_reclass_commands_v1 c
  where c.command_id like 'reclass-batch:%' and c.request->>'sourceUid' like '%-a-%'$$,
  '40001','INVENTORY_RECLASS_COMMAND_CONFLICT',
  'a compact child receipt still rejects a replay whose command contents differ');

create function pg_temp.reclass_abort_batch_receipt_result_v1() returns trigger
language plpgsql set search_path = '' as $function$
begin
  if new.command_id='reclass-pointer-rollback-0001' and new.result is distinct from '{}'::jsonb then
    raise exception using errcode='P0001',message='RECLASS_POINTER_ROLLBACK_PROBE';
  end if;
  return new;
end
$function$;
create trigger reclass_pointer_receipt_rollback_probe
before update on private.ph_inventory_reclass_batch_receipts_v1
for each row execute function pg_temp.reclass_abort_batch_receipt_result_v1();
create temporary table reclass_pointer_rollback_exact_v1(passed boolean not null) on commit drop;
do $test$
declare actor_id uuid; expected_revision bigint; source_row public.ph_master_inventory%rowtype; request_payload jsonb;
  child_command text;
begin
  select id into actor_id from reclass_move_actor;
  select revision into expected_revision from public.app_dataset_revisions where key='ph_master_inventory';
  select * into source_row from public.ph_master_inventory where unique_id in
    (select unique_id from reclass_move_sources where unique_id like '%-a-%');
  request_payload:=jsonb_build_array(jsonb_build_object('source',jsonb_build_object('uniqueId',source_row.unique_id,
    'identity',jsonb_build_object('unique_id',source_row.unique_id,'itemcode',source_row.itemcode,'contsize',source_row.contsize,
      'locationcode',source_row.locationcode,'lotcode',source_row.lotcode,'season',source_row.season,
      'ptronhand',source_row.ptronhand,'ptravailable',source_row.ptravailable)),
    'lines',jsonb_build_array(jsonb_build_object('direction','move_up','destinationSeason','U3','quantity',1))));
  child_command:='reclass-batch:'||left(encode(extensions.digest(convert_to('reclass-pointer-rollback-0001:1','UTF8'),'sha256'),'hex'),40);
  begin
    perform public.apply_inventory_reclass_moves_v1(actor_id,'reclass-pointer-rollback-0001',expected_revision,request_payload);
    raise exception using errcode='P0001',message='RECLASS_POINTER_ROLLBACK_PROBE_NOT_RAISED';
  exception when sqlstate 'P0001' then
    if sqlerrm<>'RECLASS_POINTER_ROLLBACK_PROBE' then raise; end if;
  end;
  insert into reclass_pointer_rollback_exact_v1
  values(not exists(select 1 from private.ph_inventory_reclass_batch_receipts_v1 where command_id='reclass-pointer-rollback-0001')
    and not exists(select 1 from private.ph_inventory_reclass_commands_v1 where command_id=child_command)
    and not exists(select 1 from public.ph_inventory_transactions where raw_payload->>'commandId'=child_command)
    and (select ptronhand=source_row.ptronhand and ptravailable=source_row.ptravailable
      from public.ph_master_inventory where unique_id=source_row.unique_id));
end
$test$;
select ok((select passed from reclass_pointer_rollback_exact_v1),
  'a failure finalizing the parent receipt rolls back child references, stock audit, and inventory mutation');
drop trigger reclass_pointer_receipt_rollback_probe on private.ph_inventory_reclass_batch_receipts_v1;
drop function pg_temp.reclass_abort_batch_receipt_result_v1();

insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,source,season,saleyear)
select source_uid,'RECLASS-SEASON-MISMATCH','Season mismatch fixture','#3','C.16.001','29.F1','12','9','PH','F1','29'
from reclass_bad_destination
union all
select target_uid,'RECLASS-SEASON-MISMATCH','Season mismatch fixture','#3','C.16.001','29.U1','4','3','PH','F1','29'
from reclass_bad_destination;

create temporary table reclass_move_evaluator(id uuid primary key) on commit drop;
insert into reclass_move_evaluator values(gen_random_uuid());
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select id,'inventory-reclass-evaluator@example.invalid',now(),'{}'::jsonb,'{}'::jsonb from reclass_move_evaluator
on conflict(id) do update set email=excluded.email,email_confirmed_at=now();
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until)
select id,'inventory_reclass_evaluator_test','Inventory Reclass Evaluator Test','EVAL',false,null,null from reclass_move_evaluator
on conflict(id) do update set role='EVAL',must_change_password=false,disabled_at=null,locked_until=null;
insert into private.app_access_user_overrides(policy_id,profile_id,permission_key,allowed,access_scope)
select private.resolve_app_access_policy_id_v1(false),id,'drive.reclass.submit',true,'global' from reclass_move_evaluator
on conflict(policy_id,profile_id,permission_key) do update set allowed=true,access_scope='global';
select throws_ok($$select public.apply_inventory_reclass_move_v1((select id from reclass_move_evaluator),'reclass-unassigned-source-0001',
  (select revision from public.app_dataset_revisions where key='ph_master_inventory'),
  (select unique_id from reclass_move_sources where unique_id like '%-a-%'),
  (select jsonb_build_object('unique_id',m.unique_id,'itemcode',m.itemcode,'contsize',m.contsize,'locationcode',m.locationcode,
    'lotcode',m.lotcode,'season',m.season,'ptronhand',m.ptronhand,'ptravailable',m.ptravailable)
    from public.ph_master_inventory m where m.unique_id=(select unique_id from reclass_move_sources where unique_id like '%-a-%')),
  '[{"direction":"move_up","destinationSeason":"U1","quantity":1}]'::jsonb)$$,
  '42501','DRIVE_RECLASS_ROW_NOT_ASSIGNED','evaluators cannot submit moves for rows outside their assigned inventory');
select throws_ok($$select public.apply_inventory_reclass_move_v1((select id from reclass_move_actor),'reclass-season-mismatch-command-0001',
  (select revision from public.app_dataset_revisions where key='ph_master_inventory'),
  (select source_uid from reclass_bad_destination),
  (select jsonb_build_object('unique_id',m.unique_id,'itemcode',m.itemcode,'contsize',m.contsize,'locationcode',m.locationcode,
    'lotcode',m.lotcode,'season',m.season,'ptronhand',m.ptronhand,'ptravailable',m.ptravailable)
    from public.ph_master_inventory m where m.unique_id=(select source_uid from reclass_bad_destination)),
  '[{"direction":"move_up","destinationSeason":"U1","quantity":1}]'::jsonb)$$,
  '40001','INVENTORY_RECLASS_DESTINATION_SEASON_MISMATCH','an existing destination lot with a mismatched season is rejected atomically');
select ok((select ptronhand='12' and ptravailable='9' from public.ph_master_inventory where unique_id=(select source_uid from reclass_bad_destination))
  and (select ptronhand='4' and ptravailable='3' from public.ph_master_inventory where unique_id=(select target_uid from reclass_bad_destination)),
  'season mismatch rejection preserves both source and existing target quantities');

select is((select count(*)::integer from public.ph_inventory_transactions where event_type='inventory_reclass_move'),3,'one audit row is retained per submitted split line');
select is((select count(*)::integer from private.ph_inventory_reclass_movements_v1 where status='acknowledged'),3,'exact post-state import acknowledges every movement line');
select is((select count(*)::integer from public.ph_master_inventory where itemcode='RECLASS-MOVE-V1'),4,'two new destinations are created once');
select is((select count(*)::integer from private.ph_inventory_reclass_batch_receipts_v1 where command_id='reclass-move-v1-command-00001'),1,'batch command receipt is durable');
select is((select count(*)::integer from private.ph_inventory_reclass_import_aliases_v1 where canonical_unique_id in (select unique_id from public.ph_master_inventory where itemcode='RECLASS-MOVE-V1' and season in ('U1','U2'))),2,'canonical target UIDs are recorded for import aliasing');
select is((select result->>'published' from reclass_move_import where mode='pre'),'true','pre-state bulk snapshot publishes while retaining application movement balances');
select is((select result->>'published' from reclass_move_import where mode='post'),'true','post-state bulk snapshot publishes and acknowledges movement');
select throws_ok($$select public.apply_inventory_reclass_moves_v1((select id from reclass_move_actor),'reclass-move-v1-command-00002',(select revision from public.app_dataset_revisions where key='ph_master_inventory'),
  (select jsonb_build_array(jsonb_build_object('source',jsonb_build_object('uniqueId',s.unique_id,'identity',jsonb_build_object(
    'unique_id',s.unique_id,'itemcode',s.itemcode,'contsize',s.contsize,'locationcode',s.locationcode,'lotcode',s.lotcode,
    'season',s.season,'ptronhand',s.ptronhand,'ptravailable',s.ptravailable)),
    'lines',jsonb_build_array(jsonb_build_object('direction','move_up','destinationSeason','U1','quantity',100))))
  from public.ph_master_inventory s where s.unique_id=(select unique_id from reclass_move_sources where unique_id like '%-a-%')))$$,
  '22023','INVENTORY_RECLASS_QUANTITY_UNDERFLOW','overdraw of on-hand or available balance is rejected');
select throws_ok($$select public.apply_inventory_reclass_moves_v1((select id from reclass_move_actor),'reclass-move-v1-command-00001',(select revision from public.app_dataset_revisions where key='ph_master_inventory'),(select request from reclass_move_request))$$,
  '40001','INVENTORY_RECLASS_COMMAND_CONFLICT','changed expected revision under a committed command ID conflicts');
select throws_ok($$select public.apply_inventory_reclass_moves_v1((select id from reclass_move_actor),'reclass-overlap-command-00001',(select revision from public.app_dataset_revisions where key='ph_master_inventory'),
  (select jsonb_build_array(
    jsonb_build_object('source',jsonb_build_object('uniqueId',source_f1.unique_id,'identity',jsonb_build_object(
      'unique_id',source_f1.unique_id,'itemcode',source_f1.itemcode,'contsize',source_f1.contsize,'locationcode',source_f1.locationcode,
      'lotcode',source_f1.lotcode,'season',source_f1.season,'ptronhand',source_f1.ptronhand,'ptravailable',source_f1.ptravailable)),
      'lines',jsonb_build_array(jsonb_build_object('direction','move_up','destinationSeason','U1','quantity',1))),
    jsonb_build_object('source',jsonb_build_object('uniqueId',source_u1.unique_id,'identity',jsonb_build_object(
      'unique_id',source_u1.unique_id,'itemcode',source_u1.itemcode,'contsize',source_u1.contsize,'locationcode',source_u1.locationcode,
      'lotcode',source_u1.lotcode,'season',source_u1.season,'ptronhand',source_u1.ptronhand,'ptravailable',source_u1.ptravailable)),
      'lines',jsonb_build_array(jsonb_build_object('direction','move_up','destinationSeason','U2','quantity',1))))
   from public.ph_master_inventory source_f1 cross join public.ph_master_inventory source_u1
   where source_f1.unique_id=(select unique_id from reclass_move_sources where unique_id like '%-a-%')
     and source_u1.unique_id=(select value->>'destinationUniqueId' from reclass_move_call
       cross join lateral jsonb_array_elements(result->'movements') e(value) where value->>'destinationSeason'='U1' limit 1)))$$,
  '22023','INVENTORY_RECLASS_OVERLAP_INVALID','a batch cannot target another source lineage in the same atomic request');
select is((select count(*)::integer from private.ph_inventory_reclass_batch_receipts_v1 where command_id='reclass-overlap-command-00001'),0,
  'overlap rejection rolls back its receipt and stock mutation');
select is((select count(*)::integer from public.ph_inventory_transactions where event_type='inventory_reclass_move'),3,
  'overlap rejection leaves prior movement audit lines unchanged');
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,source,season,saleyear)
select 'reclass-existing-u1-duplicate-'||gen_random_uuid()::text,'RECLASS-MOVE-V1','Duplicate destination fixture','#3','C.16.000','27.U1',
  '0','0','PH','U1','27';
select throws_ok($$select public.apply_inventory_reclass_moves_v1((select id from reclass_move_actor),'reclass-duplicate-target-0001',(select revision from public.app_dataset_revisions where key='ph_master_inventory'),
  (select jsonb_build_array(jsonb_build_object('source',jsonb_build_object('uniqueId',source.unique_id,'identity',jsonb_build_object(
    'unique_id',source.unique_id,'itemcode',source.itemcode,'contsize',source.contsize,'locationcode',source.locationcode,'lotcode',source.lotcode,
    'season',source.season,'ptronhand',source.ptronhand,'ptravailable',source.ptravailable)),
    'lines',jsonb_build_array(jsonb_build_object('direction','move_up','destinationSeason','U1','quantity',1))))
   from public.ph_master_inventory source where source.unique_id=(select unique_id from reclass_move_sources where unique_id like '%-a-%')))$$,
  '40001','INVENTORY_RECLASS_DESTINATION_AMBIGUOUS','multiple physical rows for one target lineage are rejected');
select is((select count(*)::integer from private.ph_inventory_reclass_batch_receipts_v1 where command_id='reclass-duplicate-target-0001'),0,
  'duplicate-target rejection rolls back the receipt and source quantity');
select ok((select ptronhand='7' and ptravailable='4' from public.ph_master_inventory where unique_id=(select unique_id from reclass_move_sources where unique_id like '%-a-%')),
  'duplicate-target rejection leaves source inventory unchanged');
delete from public.ph_master_inventory where unique_id like 'reclass-existing-u1-duplicate-%';

create temporary table reclass_chain_pre(row_uid text primary key,row_value jsonb) on commit drop;
insert into reclass_chain_pre
select unique_id,to_jsonb(m) from public.ph_master_inventory m where itemcode='RECLASS-MOVE-V1';

do $chain_test$
declare
  actor_id uuid; source_uid text; target_u1 text; destination_u3 text; revision_value bigint;
  first_move jsonb; second_move jsonb; third_move jsonb; result_value jsonb; intermediate_rows jsonb; first_source_after jsonb;
  first_destination_after jsonb; second_destination_after jsonb; pre_rows jsonb; run_id uuid;
  first_child text; second_child text; third_child text;
begin
  select id into actor_id from reclass_move_actor;
  select unique_id into source_uid from reclass_move_sources where unique_id like '%-a-%';
  first_child:='reclass-batch:'||left(encode(extensions.digest(convert_to('reclass-chain-command-00001:1','UTF8'),'sha256'),'hex'),40);
  second_child:='reclass-batch:'||left(encode(extensions.digest(convert_to('reclass-chain-command-00002:1','UTF8'),'sha256'),'hex'),40);
  third_child:='reclass-batch:'||left(encode(extensions.digest(convert_to('reclass-chain-command-00003:1','UTF8'),'sha256'),'hex'),40);
  select value->>'destinationUniqueId' into target_u1 from reclass_move_call, jsonb_array_elements(result->'movements') e(value)
    where value->>'destinationSeason'='U1' limit 1;
  select jsonb_build_array(jsonb_build_object('source',jsonb_build_object('uniqueId',m.unique_id,'identity',jsonb_build_object(
    'unique_id',m.unique_id,'itemcode',m.itemcode,'contsize',m.contsize,'locationcode',m.locationcode,'lotcode',m.lotcode,
    'season',m.season,'ptronhand',m.ptronhand,'ptravailable',m.ptravailable)),
    'lines',jsonb_build_array(jsonb_build_object('direction','move_up','destinationSeason','U1','quantity',1)))) into first_move
  from public.ph_master_inventory m where m.unique_id=source_uid;
  select revision into revision_value from public.app_dataset_revisions where key='ph_master_inventory';
  result_value:=public.apply_inventory_reclass_moves_v1(actor_id,'reclass-chain-command-00001',revision_value,first_move);
  if result_value->>'status'<>'applied' then raise exception 'first chained movement was not applied'; end if;
  select source_after into first_source_after from private.ph_inventory_reclass_movements_v1 m
    join private.ph_inventory_reclass_commands_v1 c using(request_id) where c.command_id=first_child and m.source_unique_id=source_uid;
  select destination_after into first_destination_after from private.ph_inventory_reclass_movements_v1 m
    join private.ph_inventory_reclass_commands_v1 c using(request_id) where c.command_id=first_child and m.source_unique_id=source_uid;
  -- Equal timestamps make UUID ordering random; operation_order must retain accepted command order.
  update private.ph_inventory_reclass_commands_v1 set created_at='2020-01-01 00:00:00+00'
    where command_id='reclass-batch:'||left(encode(extensions.digest(convert_to('reclass-chain-command-00001:1','UTF8'),'sha256'),'hex'),40);
  select jsonb_build_array(jsonb_build_object('source',jsonb_build_object('uniqueId',m.unique_id,'identity',jsonb_build_object(
    'unique_id',m.unique_id,'itemcode',m.itemcode,'contsize',m.contsize,'locationcode',m.locationcode,'lotcode',m.lotcode,
    'season',m.season,'ptronhand',m.ptronhand,'ptravailable',m.ptravailable)),
    'lines',jsonb_build_array(jsonb_build_object('direction','move_up','destinationSeason','U1','quantity',1)))) into second_move
  from public.ph_master_inventory m where m.unique_id=source_uid;
  select revision into revision_value from public.app_dataset_revisions where key='ph_master_inventory';
  result_value:=public.apply_inventory_reclass_moves_v1(actor_id,'reclass-chain-command-00002',revision_value,second_move);
  update private.ph_inventory_reclass_commands_v1 set created_at='2020-01-01 00:00:00+00'
    where command_id='reclass-batch:'||left(encode(extensions.digest(convert_to('reclass-chain-command-00002:1','UTF8'),'sha256'),'hex'),40);
  update private.ph_inventory_reclass_batch_receipts_v1 set created_at='2020-01-01 00:00:00+00' where command_id='reclass-chain-command-00002';
  select jsonb_build_array(jsonb_build_object('source',jsonb_build_object('uniqueId',m.unique_id,'identity',jsonb_build_object(
    'unique_id',m.unique_id,'itemcode',m.itemcode,'contsize',m.contsize,'locationcode',m.locationcode,'lotcode',m.lotcode,
    'season',m.season,'ptronhand',m.ptronhand,'ptravailable',m.ptravailable)),
    'lines',jsonb_build_array(jsonb_build_object('direction','move_up','destinationSeason','U3','quantity',1)))) into third_move
  from public.ph_master_inventory m where m.unique_id=source_uid;
  select revision into revision_value from public.app_dataset_revisions where key='ph_master_inventory';
  result_value:=public.apply_inventory_reclass_moves_v1(actor_id,'reclass-chain-command-00003',revision_value,third_move);
  select value->>'destinationUniqueId' into destination_u3 from jsonb_array_elements(result_value->'movements') e(value);
  select destination_after into second_destination_after from private.ph_inventory_reclass_movements_v1 m
    join private.ph_inventory_reclass_commands_v1 c using(request_id) where c.command_id=third_child and m.source_unique_id=source_uid;
  update private.ph_inventory_reclass_commands_v1 set created_at='2020-01-01 00:00:00+00'
    where command_id='reclass-batch:'||left(encode(extensions.digest(convert_to('reclass-chain-command-00003:1','UTF8'),'sha256'),'hex'),40);
  update private.ph_inventory_reclass_batch_receipts_v1 set created_at='2020-01-01 00:00:00+00' where command_id='reclass-chain-command-00003';

  run_id:='b3000000-0000-4000-8000-000000000003';
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',run_id::text)::text,true);
  select jsonb_agg(jsonb_build_object('values',row_value,'rawFields',pg_temp.reclass_move_raw_fields_v1(row_value)) order by row_uid)
    into pre_rows from reclass_chain_pre;
  result_value:=public.bulk_import_master_snapshot_v1(run_id,'b4000000-0000-4000-8000-000000000003',pre_rows,repeat('b',64));
  if result_value->>'published'<>'true' then raise exception 'pre-state chained snapshot failed publication'; end if;
  perform public.finish_dataset_import_v1(run_id);
  if (select ptronhand from public.ph_master_inventory where unique_id=source_uid)<>'4'
    or (select ptronhand from public.ph_master_inventory where unique_id=target_u1)<>'17'
    or (select ptronhand from public.ph_master_inventory where unique_id=destination_u3)<>'1' then
    raise exception 'pre-state snapshot did not retain cumulative chained balances'; end if;
  if exists(select 1 from private.ph_inventory_reclass_movements_v1 where request_id in (
    select unnest(child_request_ids) from private.ph_inventory_reclass_batch_receipts_v1 where command_id in ('reclass-chain-command-00001','reclass-chain-command-00002','reclass-chain-command-00003'))
      and status<>'pending') then raise exception 'pre-state snapshot prematurely acknowledged a chain movement'; end if;

  run_id:='b3000000-0000-4000-8000-000000000004';
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',run_id::text)::text,true);
  select jsonb_agg(jsonb_build_object('values',case when row_uid=source_uid then first_source_after
      when row_uid=target_u1 then first_destination_after else row_value end,
      'rawFields',pg_temp.reclass_move_raw_fields_v1(case when row_uid=source_uid then first_source_after
        when row_uid=target_u1 then first_destination_after else row_value end)) order by row_uid)
    into intermediate_rows from reclass_chain_pre;
  result_value:=public.bulk_import_master_snapshot_v1(run_id,'b4000000-0000-4000-8000-000000000004',intermediate_rows,repeat('c',64));
  if result_value->>'published'<>'true' then raise exception 'intermediate chained snapshot failed publication'; end if;
  perform public.finish_dataset_import_v1(run_id);
  if (select ptronhand from public.ph_master_inventory where unique_id=source_uid)<>'4'
    or (select ptronhand from public.ph_master_inventory where unique_id=target_u1)<>'17'
    or (select ptronhand from public.ph_master_inventory where unique_id=destination_u3)<>'1' then
    raise exception 'intermediate snapshot did not preserve cumulative quantity'; end if;
  if (select status from private.ph_inventory_reclass_movements_v1 where request_id=(select request_id from private.ph_inventory_reclass_commands_v1 where command_id=first_child))<>'acknowledged'
    or (select status from private.ph_inventory_reclass_movements_v1 where request_id=(select request_id from private.ph_inventory_reclass_commands_v1 where command_id=second_child))<>'pending'
    or (select status from private.ph_inventory_reclass_movements_v1 where request_id=(select request_id from private.ph_inventory_reclass_commands_v1 where command_id=third_child))<>'pending' then
    raise exception 'intermediate snapshot did not acknowledge only its committed prefix'; end if;

  run_id:='b3000000-0000-4000-8000-000000000005';
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',run_id::text)::text,true);
  select jsonb_agg(jsonb_build_object('values',to_jsonb(m),'rawFields',pg_temp.reclass_move_raw_fields_v1(to_jsonb(m))) order by m.unique_id)
    into intermediate_rows from public.ph_master_inventory m where m.itemcode='RECLASS-MOVE-V1';
  result_value:=public.bulk_import_master_snapshot_v1(run_id,'b4000000-0000-4000-8000-000000000005',intermediate_rows,repeat('d',64));
  if result_value->>'published'<>'true' then raise exception 'fully caught-up chained snapshot failed publication'; end if;
  perform public.finish_dataset_import_v1(run_id);
  perform set_config('request.headers','{}',true);
end
$chain_test$;

select is((select count(*)::integer from private.ph_inventory_reclass_movements_v1 m
  join private.ph_inventory_reclass_commands_v1 c using(request_id)
  where c.command_id in ('reclass-batch:'||left(encode(extensions.digest(convert_to('reclass-chain-command-00001:1','UTF8'),'sha256'),'hex'),40),
      'reclass-batch:'||left(encode(extensions.digest(convert_to('reclass-chain-command-00002:1','UTF8'),'sha256'),'hex'),40),
      'reclass-batch:'||left(encode(extensions.digest(convert_to('reclass-chain-command-00003:1','UTF8'),'sha256'),'hex'),40))
    and m.source_unique_id in (select unique_id from reclass_move_sources where unique_id like '%-a-%')
    and m.destination_season in ('U1','U3') and m.status='acknowledged'),3,
  'sequential moves sharing a source/target acknowledge cumulatively across intermediate and caught-up snapshots');
select is((select ptronhand from public.ph_master_inventory where unique_id=(select unique_id from reclass_move_sources where unique_id like '%-a-%')),'4',
  'cumulative source balance is retained after chained snapshot replay');
select is((select count(*)::integer from public.ph_master_inventory where itemcode='RECLASS-MOVE-V1' and season='U3'),1,
  'chained destination row remains unique after pre-state and intermediate snapshot replay');

create temporary table reclass_target_chain_pre(row_uid text primary key,row_value jsonb) on commit drop;
insert into reclass_target_chain_pre select unique_id,to_jsonb(m) from public.ph_master_inventory m where itemcode='RECLASS-MOVE-V1';
do $target_chain_test$
declare
  actor_id uuid; source_a text; source_u1 text; source_u3 text; revision_value bigint; command_result jsonb;
  move_payload jsonb; child_one uuid; child_two uuid; child_three uuid; first_source_after jsonb; first_u1_after jsonb;
  intermediate_rows jsonb; run_id uuid;
begin
  select id into actor_id from reclass_move_actor;
  select unique_id into source_a from reclass_move_sources where unique_id like '%-a-%';
  select unique_id into source_u1 from public.ph_master_inventory where itemcode='RECLASS-MOVE-V1' and season='U1';
  select revision into revision_value from public.app_dataset_revisions where key='ph_master_inventory';
  select jsonb_build_array(jsonb_build_object('source',jsonb_build_object('uniqueId',m.unique_id,'identity',jsonb_build_object(
    'unique_id',m.unique_id,'itemcode',m.itemcode,'contsize',m.contsize,'locationcode',m.locationcode,'lotcode',m.lotcode,
    'season',m.season,'ptronhand',m.ptronhand,'ptravailable',m.ptravailable)),
    'lines',jsonb_build_array(jsonb_build_object('direction','move_up','destinationSeason','U1','quantity',1)))) into move_payload
  from public.ph_master_inventory m where m.unique_id=source_a;
  command_result:=public.apply_inventory_reclass_moves_v1(actor_id,'reclass-target-chain-command-00001',revision_value,move_payload);
  if command_result->>'status'<>'applied' then raise exception 'source-to-target chained movement failed'; end if;
  select unnest(child_request_ids) into child_one from private.ph_inventory_reclass_batch_receipts_v1 where command_id='reclass-target-chain-command-00001';
  select source_after,destination_after into first_source_after,first_u1_after from private.ph_inventory_reclass_movements_v1 where request_id=child_one;
  update private.ph_inventory_reclass_commands_v1 set created_at='2020-01-03 00:00:00+00' where request_id=child_one;

  select revision into revision_value from public.app_dataset_revisions where key='ph_master_inventory';
  select jsonb_build_array(jsonb_build_object('source',jsonb_build_object('uniqueId',m.unique_id,'identity',jsonb_build_object(
    'unique_id',m.unique_id,'itemcode',m.itemcode,'contsize',m.contsize,'locationcode',m.locationcode,'lotcode',m.lotcode,
    'season',m.season,'ptronhand',m.ptronhand,'ptravailable',m.ptravailable)),
    'lines',jsonb_build_array(jsonb_build_object('direction','move_up','destinationSeason','U3','quantity',1)))) into move_payload
  from public.ph_master_inventory m where m.unique_id=source_u1;
  command_result:=public.apply_inventory_reclass_moves_v1(actor_id,'reclass-target-chain-command-00002',revision_value,move_payload);
  if command_result->>'status'<>'applied' then raise exception 'target-to-new-source movement failed'; end if;
  select unnest(child_request_ids) into child_two from private.ph_inventory_reclass_batch_receipts_v1 where command_id='reclass-target-chain-command-00002';
  select destination_unique_id into source_u3 from private.ph_inventory_reclass_movements_v1 where request_id=child_two;
  update private.ph_inventory_reclass_commands_v1 set created_at='2020-01-02 00:00:00+00' where request_id=child_two;

  select revision into revision_value from public.app_dataset_revisions where key='ph_master_inventory';
  select jsonb_build_array(jsonb_build_object('source',jsonb_build_object('uniqueId',m.unique_id,'identity',jsonb_build_object(
    'unique_id',m.unique_id,'itemcode',m.itemcode,'contsize',m.contsize,'locationcode',m.locationcode,'lotcode',m.lotcode,
    'season',m.season,'ptronhand',m.ptronhand,'ptravailable',m.ptravailable)),
    'lines',jsonb_build_array(jsonb_build_object('direction','move_down','destinationSeason','U1','quantity',2)))) into move_payload
  from public.ph_master_inventory m where m.unique_id=source_u3;
  command_result:=public.apply_inventory_reclass_moves_v1(actor_id,'reclass-target-chain-command-00003',revision_value,move_payload);
  if command_result->>'status'<>'applied' then raise exception 'round-trip movement failed'; end if;
  select unnest(child_request_ids) into child_three from private.ph_inventory_reclass_batch_receipts_v1 where command_id='reclass-target-chain-command-00003';
  update private.ph_inventory_reclass_commands_v1 set created_at='2020-01-01 00:00:00+00' where request_id=child_three;

  run_id:='b3000000-0000-4000-8000-000000000006';
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',run_id::text)::text,true);
  select jsonb_agg(jsonb_build_object('values',row_value,'rawFields',pg_temp.reclass_move_raw_fields_v1(row_value)) order by row_uid) into intermediate_rows from reclass_target_chain_pre;
  command_result:=public.bulk_import_master_snapshot_v1(run_id,'b4000000-0000-4000-8000-000000000006',intermediate_rows,repeat('e',64));
  if command_result->>'published'<>'true' then raise exception 'target chain pre-state snapshot failed'; end if;
  perform public.finish_dataset_import_v1(run_id);
  if exists(select 1 from private.ph_inventory_reclass_movements_v1 where request_id in (child_one,child_two,child_three) and status<>'pending') then
    raise exception 'pre-state snapshot changed target chain status'; end if;

  run_id:='b3000000-0000-4000-8000-000000000007';
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',run_id::text)::text,true);
  select jsonb_agg(jsonb_build_object('values',case when row_uid=source_a then first_source_after
      when row_uid=source_u1 then first_u1_after else row_value end,
      'rawFields',pg_temp.reclass_move_raw_fields_v1(case when row_uid=source_a then first_source_after
        when row_uid=source_u1 then first_u1_after else row_value end)) order by row_uid)
    into intermediate_rows from reclass_target_chain_pre;
  command_result:=public.bulk_import_master_snapshot_v1(run_id,'b4000000-0000-4000-8000-000000000007',intermediate_rows,repeat('f',64));
  if command_result->>'published'<>'true' then raise exception 'target chain intermediate snapshot failed'; end if;
  perform public.finish_dataset_import_v1(run_id);
  if (select status from private.ph_inventory_reclass_movements_v1 where request_id=child_one)<>'acknowledged'
    or (select status from private.ph_inventory_reclass_movements_v1 where request_id=child_two)<>'pending'
    or (select status from private.ph_inventory_reclass_movements_v1 where request_id=child_three)<>'pending' then
    raise exception 'intermediate target-source snapshot did not acknowledge only its confirmed prefix'; end if;

  run_id:='b3000000-0000-4000-8000-000000000008';
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',run_id::text)::text,true);
  select jsonb_agg(jsonb_build_object('values',to_jsonb(m),'rawFields',pg_temp.reclass_move_raw_fields_v1(to_jsonb(m))) order by m.unique_id)
    into intermediate_rows from public.ph_master_inventory m where m.itemcode='RECLASS-MOVE-V1';
  command_result:=public.bulk_import_master_snapshot_v1(run_id,'b4000000-0000-4000-8000-000000000008',intermediate_rows,repeat('a',64));
  if command_result->>'published'<>'true' then raise exception 'target chain final snapshot failed'; end if;
  perform public.finish_dataset_import_v1(run_id);
  if exists(select 1 from private.ph_inventory_reclass_movements_v1 where request_id in (child_one,child_two,child_three) and status<>'acknowledged') then
    raise exception 'target-becomes-source round-trip did not acknowledge after full ERP catch-up'; end if;

  -- Acknowledged history must not keep overriding later legitimate ERP quantities.
  run_id:='b3000000-0000-4000-8000-000000000009';
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',run_id::text)::text,true);
  select jsonb_agg(jsonb_build_object('values',case when m.unique_id=source_a then jsonb_set(to_jsonb(m),'{ptronhand}',to_jsonb('4'::text),true)
      when m.unique_id=source_u1 then jsonb_set(to_jsonb(m),'{ptronhand}',to_jsonb('2'::text),true)
      when m.unique_id=source_u3 then jsonb_set(to_jsonb(m),'{ptronhand}',to_jsonb('6'::text),true)
      else to_jsonb(m) end,
      'rawFields',pg_temp.reclass_move_raw_fields_v1(case when m.unique_id=source_a then jsonb_set(to_jsonb(m),'{ptronhand}',to_jsonb('4'::text),true)
        when m.unique_id=source_u1 then jsonb_set(to_jsonb(m),'{ptronhand}',to_jsonb('2'::text),true)
        when m.unique_id=source_u3 then jsonb_set(to_jsonb(m),'{ptronhand}',to_jsonb('6'::text),true)
        else to_jsonb(m) end)) order by m.unique_id)
    into intermediate_rows from public.ph_master_inventory m where m.itemcode='RECLASS-MOVE-V1';
  command_result:=public.bulk_import_master_snapshot_v1(run_id,'b4000000-0000-4000-8000-000000000009',intermediate_rows,repeat('b',64));
  if command_result->>'published'<>'true' then raise exception 'post-ack legitimate quantity snapshot failed'; end if;
  perform public.finish_dataset_import_v1(run_id);
  perform set_config('request.headers','{}',true);
end
$target_chain_test$;

select ok((select count(*)::integer=3 from private.ph_inventory_reclass_movements_v1 m
  join private.ph_inventory_reclass_batch_receipts_v1 b on m.request_id=any(b.child_request_ids)
  where b.command_id like 'reclass-target-chain-command-%' and m.status='acknowledged')
  and (select count(*)::integer=3 from private.ph_inventory_reclass_batch_receipts_v1
    where command_id like 'reclass-target-chain-command-%' and result->>'status'='applied'),
  'target-to-source chain reconciles snapshots and retains applied receipts through frontend-only rollback');
select ok((select ptronhand from public.ph_master_inventory where unique_id=(select unique_id from reclass_move_sources where unique_id like '%-a-%'))='4'
    and (select ptronhand from public.ph_master_inventory where itemcode='RECLASS-MOVE-V1' and season='U1')='2'
    and (select ptronhand from public.ph_master_inventory where itemcode='RECLASS-MOVE-V1' and season='U3')='6',
  'acknowledged move history permits later ERP quantity corrections');
select ok((select array_agg(e.child_request_id order by b.command_id,e.ordinality)=array_agg(c.request_id order by c.operation_order)
    and array_agg(c.created_at order by c.operation_order)=array['2020-01-03 00:00:00+00','2020-01-02 00:00:00+00','2020-01-01 00:00:00+00']::timestamptz[]
  from private.ph_inventory_reclass_batch_receipts_v1 b
  cross join lateral unnest(b.child_request_ids) with ordinality e(child_request_id,ordinality)
  join private.ph_inventory_reclass_commands_v1 c on c.request_id=e.child_request_id
  where b.command_id like 'reclass-target-chain-command-%'),
  'monotonic accepted command identity preserves move order despite reversed timestamps');

select is(private.encode_inventory_reclass_rows_v1(jsonb_build_object('ok',true,'status','missing','rows','[]'::jsonb)),
  jsonb_build_object('ok',true,'status','missing','rows','[]'::jsonb),
  'compact encoder passes through missing or empty-row receipts unchanged');
with row_data as (
  select jsonb_object_agg('k'||lpad(i::text,3,'0'),case when i=1 then 'null'::jsonb
    when i=2 then jsonb_build_object('keep',null) else to_jsonb(i::text) end) row_value
  from generate_series(1,213) g(i)
), encoded as (
  select private.encode_inventory_reclass_rows_v1(jsonb_build_object('revision',7,'rows',jsonb_build_array(
    jsonb_build_object('table','ph_master_inventory','row',row_value)))) receipt from row_data
)
select ok(receipt->>'rowEncoding'='master-null-elision-v1'
    and jsonb_array_length(receipt->'rowColumns')=213
    and receipt->'rowColumns'=(select jsonb_agg('k'||lpad(i::text,3,'0') order by ('k'||lpad(i::text,3,'0')) collate "C") from generate_series(1,213) g(i))
    and not ((receipt#>'{rows,0,values}') ? 'k001')
    and receipt#>'{rows,0,values,k002}'='{"keep":null}'::jsonb,
  'compact encoding declares all 213 sorted keys, elides top-level nulls, and preserves nested nulls') from encoded;
with row_data as (
  select jsonb_object_agg('k'||lpad(i::text,3,'0'),'null'::jsonb) row_value
  from generate_series(1,213) g(i)
), encoded as (
  select private.encode_inventory_reclass_rows_v1(jsonb_build_object('rows',jsonb_build_array(
    jsonb_build_object('table','ph_master_inventory','row',row_value)))) receipt from row_data
)
select ok(jsonb_array_length(receipt->'rowColumns')=213 and receipt#>'{rows,0,values}'='{}'::jsonb,
  'compact encoding handles an all-null 213-field row while retaining the full decode schema') from encoded;
select throws_ok($$with row_a as (
  select jsonb_object_agg('k'||lpad(i::text,3,'0'),to_jsonb(i::text)) row_value from generate_series(1,213) g(i)
), row_b as (
  select jsonb_object_agg(case when i=213 then 'z213' else 'k'||lpad(i::text,3,'0') end,to_jsonb(i::text)) row_value
  from generate_series(1,213) g(i)
), receipt as (
  select jsonb_build_object('rows',jsonb_build_array(
    jsonb_build_object('table','ph_master_inventory','row',a.row_value),
    jsonb_build_object('table','ph_master_inventory','row',b.row_value))) value from row_a a cross join row_b b
) select private.encode_inventory_reclass_rows_v1(value) from receipt$$,
  '55000','INVENTORY_RECLASS_ROW_SCHEMA_MISMATCH',
  'compact encoding fails closed when historical row keysets differ');

-- Run the representative maximum-size timing after the behavioral assertions,
-- so its 100 synthetic rows cannot influence the rest of this contract.
-- No delivery worker or email runs; the enclosing pgTAP rollback discards it.
create temporary table v2311_reclass_perf_evidence(payload jsonb) on commit drop;
do $v2311_reclass_perf$
declare
  actor_id uuid;
  expected_revision bigint;
  moves_value jsonb;
  ids text[];
  first_result jsonb;
  retry_result jsonb;
  first_ms numeric;
  retry_ms numeric;
  started_at timestamptz;
  event_count integer;
  retry_event_count integer;
begin
  select id into actor_id from reclass_move_actor;
  insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,
      ptronhand,ptravailable,source,season,saleyear)
    select 'reclass-v2311-perf-'||n::text,'RECLASS-V2311-'||lpad(n::text,3,'0'),
      'Reclass performance fixture','#3','C.29.001','27.F1','10','10','PH','F1','27'
    from generate_series(1,100) n;
  select array_agg(unique_id order by unique_id) into ids from public.ph_master_inventory
    where unique_id like 'reclass-v2311-perf-%';
  select coalesce(jsonb_agg(jsonb_build_object(
      'source',jsonb_build_object('uniqueId',m.unique_id,'identity',jsonb_build_object(
        'unique_id',m.unique_id,'itemcode',m.itemcode,'contsize',m.contsize,'locationcode',m.locationcode,
        'lotcode',m.lotcode,'season',m.season,'ptronhand',m.ptronhand,'ptravailable',m.ptravailable)),
      'lines',jsonb_build_array(jsonb_build_object('direction','move_up','destinationSeason','U1','quantity',1))
    ) order by m.unique_id),'[]'::jsonb) into moves_value
    from public.ph_master_inventory m where m.unique_id=any(ids);
  select revision into expected_revision from public.app_dataset_revisions where key='ph_master_inventory';
  started_at:=clock_timestamp();
  first_result:=public.apply_inventory_reclass_moves_with_delivery_v1(actor_id,
    'reclass-v2311-perf-100-source-00001',expected_revision,moves_value,null);
  first_ms:=extract(epoch from(clock_timestamp()-started_at))*1000;
  select count(*)::integer into event_count from public.ph_request_delivery_outbox
    where event_key='inventory-reclass-move-completed:'||actor_id::text||':reclass-v2311-perf-100-source-00001'
      and event_type='inventory_reclass_move_completed';
  started_at:=clock_timestamp();
  retry_result:=public.apply_inventory_reclass_moves_with_delivery_v1(actor_id,
    'reclass-v2311-perf-100-source-00001',expected_revision,moves_value,null);
  retry_ms:=extract(epoch from(clock_timestamp()-started_at))*1000;
  select count(*)::integer into retry_event_count from public.ph_request_delivery_outbox
    where event_key='inventory-reclass-move-completed:'||actor_id::text||':reclass-v2311-perf-100-source-00001'
      and event_type='inventory_reclass_move_completed';
  insert into v2311_reclass_perf_evidence(payload) values(jsonb_build_object(
    'source_count',cardinality(ids),'submitted_move_count',jsonb_array_length(moves_value),
    'first_atomic_rpc_ms',round(first_ms,3),'retry_rpc_ms',round(retry_ms,3),
    'first_status',first_result->>'status','first_movement_count',jsonb_array_length(first_result->'movements'),
    'first_outbox_event_count',event_count,'retry_duplicate',retry_result->>'duplicate',
    'retry_event_count',retry_event_count,'request_id',first_result->>'requestId',
    'retry_request_id',retry_result->>'requestId','delivery_event_id',first_result->>'deliveryEventId',
    'retry_delivery_event_id',retry_result->>'deliveryEventId'));
end
$v2311_reclass_perf$;
select is((select (payload->>'source_count')::integer from v2311_reclass_perf_evidence),100,
  'the performance fixture contains 100 distinct source rows');
select ok((select payload->>'first_status'='applied' and (payload->>'first_movement_count')::integer=100
  from v2311_reclass_perf_evidence),'atomic Reclass receipt covers all 100 requested movements');
select ok((select (payload->>'first_atomic_rpc_ms')::numeric<=1000 from v2311_reclass_perf_evidence),
  '100-source atomic Reclass plus durable delivery enqueue is within 1000ms');
select is((select (payload->>'first_outbox_event_count')::integer from v2311_reclass_perf_evidence),1,
  'the completed movement and its durable notification intent commit exactly once');
select ok((select payload->>'retry_duplicate'='true' and (payload->>'retry_event_count')::integer=1
  and payload->>'request_id'=payload->>'retry_request_id'
  and payload->>'delivery_event_id'=payload->>'retry_delivery_event_id'
  from v2311_reclass_perf_evidence),'same-command retry reuses its receipt and does not enqueue a second event');
select diag('V2311_RECLASS_PERFORMANCE_JSON='||(select payload::text from v2311_reclass_perf_evidence));

select * from finish();
rollback;

