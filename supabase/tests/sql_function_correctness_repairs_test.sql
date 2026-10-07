-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(21);

select has_function('public','hl_order_inventory_availability',array['text[]'],'HL order inventory availability remains present');
select has_function('public','submit_manager_season_priority_v1',array['uuid','text','integer','text','text'],'manager season submission remains present');
select has_function('public','aura_query_bunch_v1',array['uuid','text','jsonb','jsonb','integer'],'Bunch Notes read remains present');
select has_function('bunch_note_private','card_command',array['uuid','text','jsonb','uuid','bigint'],'Bunch Notes card command remains present');
select has_function('suspend_tag_private','command',array['uuid','text','jsonb','uuid','bigint'],'Suspend Tag command remains present');

select ok((select position('inventory_rows.itemcode' in prosrc)>0
  and position('inventory_rows.contsize' in prosrc)>0
  and position('inventory_rows.season_lot' in prosrc)>0
  and position('sum(inventory_rows.available)' in prosrc)>0
  from pg_proc where oid='public.hl_order_inventory_availability(text[])'::regprocedure),
  'HL inventory CTE columns are qualified');
select ok((select position('v_before_state_hash text;' in prosrc)>0
  and position('resolution_snapshot_hash = v_before_state_hash' in prosrc)>0
  and position('resolution_snapshot_hash = before_state_hash' in prosrc)=0
  from pg_proc where oid='public.submit_manager_season_priority_v1(uuid,text,integer,text,text)'::regprocedure),
  'manager receipt hash uses an unambiguous local variable');
select ok((select position('AURA_BUNCH_CREATION_DATE_UNAVAILABLE' in prosrc)>0
  and position('j.created_at' in prosrc)=0
  from pg_proc where oid='public.aura_query_bunch_v1(uuid,text,jsonb,jsonb,integer)'::regprocedure),
  'Bunch Notes rejects unsupported creation-date filters without reading a nonexistent column');
select ok((select position('card.row_ids @> (action->''row_ids'')' in prosrc)>0
  from pg_proc where oid='bunch_note_private.card_command(uuid,text,jsonb,uuid,bigint)'::regprocedure),
  'card row containment keeps JSON extraction grouped as the right operand');
select ok((select position('where outbox.event_id in' in prosrc)>0
  and position('outbox.status=''failed''' in prosrc)>0
  from pg_proc where oid='suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure),
  'Suspend Tag retry qualifies the delivery row columns');

select ok((select prosecdef from pg_proc where oid='public.hl_order_inventory_availability(text[])'::regprocedure), 'HL inventory security definer is preserved');
select ok((select prosecdef from pg_proc where oid='public.submit_manager_season_priority_v1(uuid,text,integer,text,text)'::regprocedure), 'manager command security definer is preserved');
select ok((select prosecdef from pg_proc where oid='public.aura_query_bunch_v1(uuid,text,jsonb,jsonb,integer)'::regprocedure), 'Bunch Notes reader security definer is preserved');
select ok((select prosecdef from pg_proc where oid='bunch_note_private.card_command(uuid,text,jsonb,uuid,bigint)'::regprocedure), 'Bunch Notes card command security definer is preserved');
select ok((select prosecdef from pg_proc where oid='suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure), 'Suspend Tag command security definer is preserved');

select ok(has_function_privilege('anon','public.hl_order_inventory_availability(text[])','execute')
  and has_function_privilege('authenticated','public.hl_order_inventory_availability(text[])','execute'),
  'HL inventory keeps its existing anon and authenticated grants');
select ok(has_function_privilege('service_role','public.submit_manager_season_priority_v1(uuid,text,integer,text,text)','execute')
  and not has_function_privilege('anon','public.submit_manager_season_priority_v1(uuid,text,integer,text,text)','execute')
  and not has_function_privilege('authenticated','public.submit_manager_season_priority_v1(uuid,text,integer,text,text)','execute'),
  'manager submission remains service-only');
select ok(has_function_privilege('service_role','public.aura_query_bunch_v1(uuid,text,jsonb,jsonb,integer)','execute')
  and not has_function_privilege('anon','public.aura_query_bunch_v1(uuid,text,jsonb,jsonb,integer)','execute')
  and not has_function_privilege('authenticated','public.aura_query_bunch_v1(uuid,text,jsonb,jsonb,integer)','execute'),
  'Bunch Notes Aura reader remains service-only');
select ok(not has_function_privilege('service_role','bunch_note_private.card_command(uuid,text,jsonb,uuid,bigint)','execute'),
  'Bunch Notes card command remains unavailable for direct service-role execution');
select ok(has_function_privilege('service_role','public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid)','execute')
  and not has_function_privilege('authenticated','public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid)','execute')
  and not has_function_privilege('anon','public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid)','execute'),
  'Suspend Tag retry remains available only through its service-role wrapper');

select lives_ok($$select * from public.hl_order_inventory_availability(array['AURA-REPAIR-NO-MATCH'])$$,
  'HL inventory aggregation executes with qualified row fields');

select * from finish();
rollback;
