-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(11);

select has_function('suspend_tag_private','command',array['uuid','text','jsonb','uuid','bigint'],
  'Suspend Tag retains the existing server command entry point');
select ok((select prosecdef and proconfig @> array['search_path=""']
  from pg_proc where oid='suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure),
  'Suspend Tag command keeps its security-definer and empty search_path');
select ok(has_function_privilege('service_role','public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid)','execute')
  and not has_function_privilege('authenticated','public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid)','execute')
  and not has_function_privilege('anon','public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid)','execute'),
  'Suspend Tag command remains service-wrapper-only');

create temp view suspend_close_contract as
select prosrc as source_sql, substring(prosrc from position('elsif p_operation=''close'' then' in prosrc)
  for position('elsif p_operation=''decide'' then' in prosrc)-position('elsif p_operation=''close'' then' in prosrc)) close_branch
from pg_proc where oid='suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure;

select ok((select source_sql like '%suspend-close-stable-identity-v2392%'
  and close_branch like '%ph_productivity_history%' and close_branch like '%suspend-tag-complete:%'
  and close_branch like '%suspend_tag_private.row_json(uid)%' from suspend_close_contract),
  'close resolves physical tag identity and records the exact productivity receipt');
select ok((select position('return receipt.response' in source_sql)>0 and position('return receipt.response' in source_sql)
  < position('select * into s from public.ph_soc_master where unique_id=uid for update' in source_sql)
  from suspend_close_contract),'closed command receipts replay before the locked source check');
select ok((select close_branch like '%status=''superseded''%'
  and close_branch like '%suspend=null,suspend_to=null%'
  and close_branch like '%status=''completed''%'
  and close_branch not like '%request_approval%'
  and close_branch not like '%ph_request_delivery_outbox%' from suspend_close_contract),
  'close supersedes a pending review, clears Suspend, and emits no email or decision event');
select ok((select prosrc like '%public.save_drive_evidence_v3(m.unique_id,m.itemcode,m.locationcode,m.lotcode%'
  and prosrc like '%SUSPEND_TAG_EVIDENCE_UNCONFIRMED%'
  from pg_proc where oid='suspend_tag_private.publish_inventory_evidence_v23119(uuid,public.ph_soc_master,jsonb,uuid)'::regprocedure),
  'detail evidence uses the exact-row Drive writer and requires its matching receipt');
select ok((select prosrc like '%candidate.unique_id=wanted_uid%' and prosrc like '%SUSPEND_TAG_AMBIGUOUS_MASTER%'
  and prosrc like '%evidence<>''{}''%'
  from pg_proc where oid='suspend_tag_private.publish_inventory_evidence_v23119(uuid,public.ph_soc_master,jsonb,uuid)'::regprocedure),
  'evidence publication rejects ambiguous inventory and runs only for a nonempty exact-row patch');
select ok((select close_branch not like '%publish_inventory_evidence%' and close_branch not like '%ph_master_inventory%'
  from suspend_close_contract)
  and (select prosrc like '%set date_completed=null where unique_id=uid%'
    and prosrc like '%suspend_tag_private.publish_inventory_evidence_v23119%'
    from pg_proc where oid='suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure),
  'Complete Tag leaves inventory to the evidence owner, and detail Mark Done retains the tag');
select ok((select position('a.status=''pending''andsuspend_tag_private.eligible(s.suspend,s.suspend_to)' in source_sql)>0
  and position('w.current_approval_id=a.id' in source_sql)>0
  and position('s.last_updatedisnotdistinctfroma.source_revision' in source_sql)>0
  and position('setstatus=''suppressed''' in source_sql)>0
  and position('returnjsonb_build_object(''suppressed'',true)' in source_sql)>0
  from (select regexp_replace(prosrc,'[[:space:]]+','','g') source_sql
    from pg_proc where oid='public.prepare_suspend_tag_delivery_v1(uuid,uuid)'::regprocedure) delivery_sql),
  'late approval delivery callbacks are suppressed after close supersedes their approval');
select ok(not has_table_privilege('authenticated','public.ph_soc_master','update'),
  'closing does not restore direct authenticated SOC update privileges');

select * from finish();
rollback;
