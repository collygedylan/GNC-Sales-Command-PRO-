-- Run in a disposable local database after the migration, inside BEGIN/ROLLBACK.
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
create function pg_temp.action_check(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'v3070 verification: %',msg; end if; end $$;
create temp table action_proof_actor on commit drop as
  select id from public.profiles where private.user_access_has_permission_v1(id,'can_access_manager_tab') and role ilike '%admin%' limit 1;
select pg_temp.action_check((select count(*)=1 from action_proof_actor),'fixture Manager');
select pg_temp.action_check(private.action_diff_v3070(null,'{"s_lts":"50","season_oh":"30.0"}','{"s_lts":"50.00","season_oh":"30"}')='[]',
  'numeric formatting does not create a discrepancy');
set local agdata.bulk_import.ph_master_inventory='on';
insert into public.ph_master_inventory(unique_id,itemcode,lotcode,locationcode,commonname,contsize,ptronhand,ptravailable,ptrreviewed,s_lts,season,source,saleyear)
  select uid,'ACTION-V3070-'||grp,lot,'D.28.000','Baby Gem Boxwood','3DP',qty,qty,'0','120',split_part(lot,'.',2),'PH',left(lot,2)
  from (values ('act70-a','1','26.U1','120'),('act70-b','1','27.F1','0'),('act70-c','2','26.U1','120'),
    ('act70-d','2','27.F1','0'),('act70-e','3','26.U1','120'),('act70-f','4','28.U1','15')) t(uid,grp,lot,qty);
set local agdata.bulk_import.ph_master_inventory='off';
update public.ph_master_inventory set spec='12 in',av_note='field evaluation' where unique_id in ('act70-e','act70-f');
create temp table action_proof_baselines on commit drop as select unique_id,private.action_snapshot_v3070(to_jsonb(m)) r
  from public.ph_master_inventory m where unique_id in ('act70-a','act70-b','act70-c','act70-d','act70-e');
create function pg_temp.action_transfer(src text,dst text) returns jsonb language plpgsql as $$
declare s jsonb; t jsonb; cmd text:='test-transfer-v3070-'||src; actor uuid:=(select id from action_proof_actor);
begin
  select to_jsonb(m) into strict s from public.ph_master_inventory m where unique_id=src;
  select to_jsonb(m) into strict t from public.ph_master_inventory m where unique_id=dst;
  return public.apply_inventory_transaction_v1(actor,cmd,jsonb_build_object('src',src,'dst',dst),jsonb_build_array(
    jsonb_build_object('kind','update','table','ph_master_inventory','unique_id',src,'expected',s,'patch','{"ptronhand":"70","ptravailable":"70"}'::jsonb),
    jsonb_build_object('kind','update','table','ph_master_inventory','unique_id',dst,'expected',t,'patch','{"ptronhand":"50","ptravailable":"50"}'::jsonb)),
    jsonb_build_object('action','transfer','quantity','50','source_table','ph_master_inventory','source_unique_id',src,
      'destination_table','ph_master_inventory','destination_unique_id',dst,'source_lotcode',s->>'lotcode','destination_lotcode',t->>'lotcode',
      'source_locationcode',s->>'locationcode','destination_locationcode',t->>'locationcode'));
end $$;
select pg_temp.action_check((pg_temp.action_transfer('act70-a','act70-b')->>'ok')::boolean,'real two-leg inventory transaction');
select pg_temp.action_check((pg_temp.action_transfer('act70-a','act70-b')->>'duplicate')::boolean,'same-command replay');
select pg_temp.action_check((select count(*)=2 from public.app_row_actions where canonical_unique_id in ('act70-a','act70-b')),'exactly two physical legs');
create temp table ph_master_bulk_map_v1(row_number bigint primary key,canonical_unique_id text,candidate_count int) on commit drop;
create temp table ph_master_bulk_stage_v1 on commit drop as
 select row_number() over(order by m.unique_id) as row_number,to_jsonb(m) as raw_values,private.ph_master_inventory_lineage_key_v1(to_jsonb(m)) lineage_key,m.*
 from public.ph_master_inventory m where m.unique_id in ('act70-a','act70-b');
update ph_master_bulk_stage_v1 s set raw_values=b.r||'{"filename":"DylanDriveAround.xlsx"}'
 from action_proof_baselines b where b.unique_id=s.unique_id;
insert into ph_master_bulk_map_v1 select row_number,unique_id,1 from ph_master_bulk_stage_v1;
select private.publish_actions_v3070('00000000-0000-4000-8000-000000003070');
select pg_temp.action_check((select array_agg(ptronhand order by unique_id)=array['70','50'] from ph_master_bulk_stage_v1)
 and (select bool_and(not absorbed_by_erp) from public.app_row_actions where canonical_unique_id in ('act70-a','act70-b')),'baseline keeps both app legs');
update ph_master_bulk_stage_v1 s set raw_values=a.app_update_row||jsonb_build_object('filename','Round2.xlsx')
  ||case when s.unique_id='act70-a' then '{"ptravailable":"65","ptrreviewed":"5"}'::jsonb else '{}' end
 from public.app_row_actions a where a.canonical_unique_id=s.unique_id;
update ph_master_bulk_stage_v1 set ptravailable=raw_values->>'ptravailable',ptrreviewed=raw_values->>'ptrreviewed',ptronhand=raw_values->>'ptronhand';
set local agdata.erp.sync_job_v3070='00000000-0000-4000-8000-000000003079';
select private.publish_actions_v3070('00000000-0000-4000-8000-000000003071');
select private.publish_actions_v3070('00000000-0000-4000-8000-000000003071');
select pg_temp.action_check((select ptravailable='65' and ptrreviewed='5' from ph_master_bulk_stage_v1 where unique_id='act70-a')
 and (select reconciliation_status='matched' and absorbed_by_erp from public.app_row_actions where canonical_unique_id='act70-b'),
 'discrepant source adopts ERP, matched destination acknowledged');
select pg_temp.action_check((select source_file_name='Round2.xlsx' and sync_run_id='00000000-0000-4000-8000-000000003079'
 and import_run_id='00000000-0000-4000-8000-000000003071' and app_update_action->>'actor'=(select id::text from action_proof_actor)
 and app_update_row->>'ptravailable'='70' and report_update_row->>'ptravailable'='65' and jsonb_array_length(discrepancy_diff)=2
 and discrepancy_diff @> '[{"field":"ptravailable","baseline_value":"120","app_expected_value":"70","report_actual_value":"65","delta":-5}]'
 from public.ph_action_discrepancies where itemcode='ACTION-V3070-1'),'complete exact discrepancy');
do $manager$
declare actor uuid:=(select id from action_proof_actor); discrepancy bigint; taught jsonb;
begin
  select id into strict discrepancy from public.ph_action_discrepancies where itemcode='ACTION-V3070-1';
  perform pg_temp.action_check(public.manager_action_discrepancies_v3070(actor,'read','{"limit":1}')#>>'{rows,0,id}'=discrepancy::text,'first page');
  taught:=public.manager_action_discrepancies_v3070(actor,'teach',jsonb_build_object('id',discrepancy));
  perform pg_temp.action_check(taught#>>'{row,status}'='learned' and (taught#>>'{row,learned_rule,sample_count}')::int=1,'teach and idempotent sample');
  begin
    perform public.manager_action_discrepancies_v3070(gen_random_uuid(),'teach',jsonb_build_object('id',discrepancy));
    raise exception 'nonmanager taught rule';
  exception when insufficient_privilege then null;
  end;
end $manager$;
select pg_temp.action_check((pg_temp.action_transfer('act70-c','act70-d')->>'ok')::boolean,'future command');
select pg_temp.action_check((select ptravailable='65' and ptrreviewed='5' and ptronhand='70' from public.ph_master_inventory where unique_id='act70-c')
 and (select ptravailable='50' and ptrreviewed='0' from public.ph_master_inventory where unique_id='act70-d'),'exact taught source formula and target isolation');
do $move$
declare actor uuid:=(select id from action_proof_actor); m public.ph_master_inventory; rev bigint; receipt jsonb;
begin
  select * into strict m from public.ph_master_inventory where unique_id='act70-e';
  select revision into strict rev from public.app_dataset_revisions where key='ph_master_inventory';
  receipt:=public.apply_inventory_reclass_move_v1(actor,'test-move-up-v3070-e',rev,m.unique_id,
    (select jsonb_object_agg(k,to_jsonb(m)->k) from unnest(array['unique_id','itemcode','contsize','locationcode','lotcode','season','ptronhand','ptravailable']) k),
    '[{"direction":"move_up","destinationSeason":"F1","quantity":50}]');
  perform pg_temp.action_check(receipt->>'status'='applied' and exists(select 1 from public.app_row_actions
    where canonical_unique_id=m.unique_id and app_update_action->>'action_type'='move_up' and app_update_action->>'quantity'='50'),
    'existing Move Up RPC recorded actual direction and quantity');
end $move$;
select pg_temp.action_check(not has_table_privilege('authenticated','public.ph_action_learning_rules','update')
 and not has_function_privilege('anon','public.manager_action_discrepancies_v3070(uuid,text,jsonb)','execute'),
 'browser roles cannot bypass authenticated manager commands');

-- Multiple pending edits may be keyed across separate ERP runs. Evaluation
-- changes never enter their snapshots or create an action on their own.
do $chain$
declare uid text:='act70-chain'; b jsonb; a1 jsonb; latest jsonb; patch jsonb; act public.app_row_actions; diff jsonb; recipe jsonb; disc bigint;
  actor uuid:=(select id from action_proof_actor); run_id uuid:=gen_random_uuid();
begin
  insert into public.ph_master_inventory(unique_id,itemcode,lotcode,locationcode,commonname,contsize,priority,spec)
    values(uid,'ACTION-CHAIN','27.F1','D.28.000','Baby Gem Boxwood','3DP','0','12 in');
  select private.action_snapshot_v3070(to_jsonb(m)) into b from public.ph_master_inventory m where unique_id=uid;
  update public.ph_master_inventory set spec='18 in',av_note='retain' where unique_id=uid;
  perform pg_temp.action_check(not exists(select 1 from public.app_row_actions where canonical_unique_id=uid),'unrelated evaluation excluded');
  update public.ph_master_inventory set priority='1' where unique_id=uid;
  select app_update_row into strict a1 from public.app_row_actions where canonical_unique_id=uid;
  update public.ph_master_inventory set priority='2' where unique_id=uid;
  select app_update_row into strict latest from public.app_row_actions where canonical_unique_id=uid order by id desc limit 1;
  patch:=private.reconcile_action_row_v3070(uid,b,'early.xlsx',run_id);
  perform pg_temp.action_check(patch->>'priority'='2','initial baseline keeps both pending');
  patch:=private.reconcile_action_row_v3070(uid,a1,'intermediate.xlsx',run_id);
  perform pg_temp.action_check(patch->>'priority'='2' and (select count(*)=1 from public.app_row_actions
    where canonical_unique_id=uid and absorbed_by_erp),'intermediate acknowledgement keeps later edit');
  patch:=private.reconcile_action_row_v3070(uid,latest,'complete.xlsx',run_id);
  perform pg_temp.action_check((select bool_and(absorbed_by_erp) from public.app_row_actions where canonical_unique_id=uid)
    and not (latest ?| array['spec','av_note','photos','caliper','photo_date','locationnote','pick_note']),'final receipt and evidence isolation');
  select * into strict act from public.app_row_actions where canonical_unique_id=uid order by id desc limit 1;
  diff:=private.action_diff_v3070(b,latest,latest||'{"locationcode":"D.29.000","priority":"3"}');
  perform private.record_discrepancy_v3070(act,latest||'{"locationcode":"D.29.000","priority":"3"}',diff,'rekey.xlsx',run_id);
  select d.id,r.field_transition_formula into strict disc,recipe from public.ph_action_discrepancies d
    join public.ph_action_learning_rules r on r.id=d.rule_id where d.action_id=act.id and not r.teachable;
  perform pg_temp.action_check(recipe ?& array['locationcode','priority'],'physical identity observations retain entire formula');
  begin
    perform public.manager_action_discrepancies_v3070(actor,'teach',jsonb_build_object('id',disc));
    raise exception 'identity formula was enabled';
  exception when invalid_parameter_value then null;
  end;
end $chain$;

-- Exercise both rounds through the existing canonical snapshot publisher, including
-- physical master writes and receipt-bound cleanup. Run this fixture only locally.
create function pg_temp.action_publish(rows jsonb) returns void language plpgsql as $$
declare run_id uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid(); receipt jsonb;
begin
  perform public.begin_dataset_import_v1(array['ph_master_inventory'],run_id,array['ph_master_inventory']);
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',run_id)::text,true);
  receipt:=public.bulk_import_master_snapshot_v1(run_id,request_id,rows,encode(extensions.digest(rows::text,'sha256'),'hex'));
  perform pg_temp.action_check(receipt->>'published'='true','atomic master publication receipt');
  perform public.finish_dataset_import_v1(run_id);
  perform set_config('request.headers','{}',true);
end $$;
do $publication$
declare src text:='act70-e'; dst text; pre jsonb; post_source jsonb; post_target jsonb; raw jsonb;
begin
  select destination_unique_id into strict dst from private.ph_inventory_reclass_movements_v1 where source_unique_id=src;
  select r into strict pre from action_proof_baselines where unique_id=src;
  perform pg_temp.action_publish(jsonb_build_array(jsonb_build_object('values',jsonb_strip_nulls(pre)
    ||jsonb_build_object('unique_id',src,'filename','DylanDriveAround.xlsx'),'rawFields','[]'::jsonb)));
  perform pg_temp.action_check((select ptronhand='70' from public.ph_master_inventory where unique_id=src)
    and (select ptronhand='50' from public.ph_master_inventory where unique_id=dst),'unkeyed Move Up retained by real master publisher');
  select app_update_row into strict post_source from public.app_row_actions where canonical_unique_id=src order by id desc limit 1;
  select app_update_row into strict post_target from public.app_row_actions where canonical_unique_id=dst order by id desc limit 1;
  select jsonb_agg(jsonb_build_object('values',jsonb_strip_nulls(row_values)||jsonb_build_object('unique_id',uid,'filename','Dylan-Keyed.xlsx'),
    'rawFields',case when row_values ? 'salesnote' and row_values->>'salesnote' is not null then '["salesnote"]'::jsonb else '[]'::jsonb end)) into raw from (values
    (src,post_source||'{"ptravailable":"66","ptrreviewed":"4"}'),(dst,post_target),('act70-f',
     '{"itemcode":"ACTION-V3070-4","lotcode":"28.U1","locationcode":"D.28.000","source":"PH","season":"U1","contsize":"3DP",
      "ptronhand":"19","ptravailable":"14","ptrreviewed":"5","s_lts":"9","priority":"2","holdstopcode":"H","holdstopreason":"ERP only","salesnote":"New report"}'::jsonb)
    ) data(uid,row_values);
  perform pg_temp.action_publish(raw);
  perform pg_temp.action_check((select ptronhand='70' and ptravailable='66' and ptrreviewed='4' and spec='12 in' from public.ph_master_inventory where unique_id=src)
    and (select ptronhand='50' from public.ph_master_inventory where unique_id=dst)
    and exists(select 1 from public.ph_action_discrepancies where itemcode='ACTION-V3070-3' and source_file_name='Dylan-Keyed.xlsx')
    and exists(select 1 from private.ph_inventory_reclass_movements_v1 where source_unique_id=src and status='acknowledged'),
    'real master publication accepts the keyed discrepancy and acknowledges both legs');
  perform pg_temp.action_check((select ptronhand='19' and ptravailable='14' and ptrreviewed='5' and s_lts='9'
    and priority='2' and holdstopcode='H' and holdstopreason='ERP only' and salesnote='New report'
    and spec='12 in' and av_note='field evaluation' from public.ph_master_inventory where unique_id='act70-f'),
    'untouched row adopts supplied ERP fields and preserves evaluation');
end $publication$;
