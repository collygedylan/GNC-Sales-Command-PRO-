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

select ok((select position('if p_operation=''close'' then' in prosrc)>0
  and position('perform suspend_tag_private.validate_review(s)' in prosrc)>0
  and position('SUSPEND_TAG_INVENTORY_AMBIGUOUS' in prosrc)>0
  and position('''inventoryRow''' in prosrc)>0
  from pg_proc where oid='suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure),
  'close validates persisted evidence and returns canonical inventory sync status');
select ok((select position('select * into receipt from suspend_tag_private.commands' in prosrc)
  < position('select * into s from public.ph_soc_master' in prosrc)
  and position('return receipt.response' in prosrc)
  < position('select * into s from public.ph_soc_master' in prosrc)
  from pg_proc where oid='suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure),
  'closed command receipts replay before source eligibility is checked');
select ok((select close_branch like '%status=''superseded''%'
  and close_branch like '%suspend=null,suspend_to=null%'
  and close_branch like '%status=''completed''%'
  and close_branch not like '%request_approval%'
  and close_branch not like '%ph_request_delivery_outbox%'
  from (select substring(prosrc from position('if p_operation=''close'' then' in prosrc)
      for position('elsif p_operation=''send'' then' in prosrc)-position('if p_operation=''close'' then' in prosrc)) close_branch
    from pg_proc where oid='suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure) close_sql),
  'close supersedes a pending review, clears Suspend, and emits no email or decision event');
select ok((select position('av_rule_spec_updated_at' in prosrc)>0
  and position('av_rule_match_updated_at' in prosrc)>0
  and position('av_rule_photo_updated_at' in prosrc)>0
  and position('av_rule_bundle_updated_at' in prosrc)>0
  from pg_proc where oid='suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure),
  'shared AV evidence updates refresh Drive rule timestamps');
select ok((select position('matched_inventory.av_rule_photo_updated_at is null' in prosrc)>0
  and position('matched_inventory.av_rule_spec_updated_at is null' in prosrc)>0
  and position('hold_begin_value:=to_jsonb(matched_inventory)->>''holdstopbegindate''' in prosrc)>0
  and position('hold_begin_at<=matched_inventory.hold_release_approved_at' in prosrc)>0
  from pg_proc where oid='suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure),
  'matching saved evidence repairs missing timestamps and hold release uses the current hold begin date');
select ok((select position('if p_operation=''close'' then' in prosrc)>0
  and position('inventory_row:=to_jsonb(matched_inventory)' in prosrc)>0
  and position('sync_photo_link:=nullif(s.dock_photo_link' in prosrc)>0
  from pg_proc where oid='suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure),
  'close returns canonical inventory without rewriting it and unrelated saves preserve newer master evidence');
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
