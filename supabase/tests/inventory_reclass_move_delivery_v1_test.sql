-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select has_function('public','apply_inventory_reclass_moves_with_delivery_v1',array['uuid','text','bigint','jsonb','text'],
  'the idempotent movement-plus-delivery RPC is installed');
select has_function('public','prepare_inventory_reclass_move_delivery_v1',array['uuid','uuid'],
  'the leased outbox preparation RPC is installed');
select ok(has_function_privilege('service_role','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute')
  and not has_function_privilege('authenticated','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute')
  and not has_function_privilege('anon','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute'),
  'only the trusted app-api service boundary can invoke the wrapper');
select ok(has_function_privilege('service_role','public.prepare_inventory_reclass_move_delivery_v1(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.prepare_inventory_reclass_move_delivery_v1(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.prepare_inventory_reclass_move_delivery_v1(uuid,uuid)','execute'),
  'only the trusted delivery worker and Apps Script service boundary can prepare a leased payload');

select ok(position('private.is_service_role_request()' in regexp_replace(lower(pg_get_functiondef(
  'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure)),'[[:space:]]+',' ','g'))>0
  and position('pg_advisory_xact_lock' in regexp_replace(lower(pg_get_functiondef(
  'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure)),'[[:space:]]+',' ','g'))>0,
  'wrapper is service-only and shares the movement command transaction lock');
select ok(position('apply_inventory_reclass_moves_v1(' in regexp_replace(lower(pg_get_functiondef(
  'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure)),'[[:space:]]+',' ','g'))>0
  and position('apply_inventory_reclass_moves_compact_v1(' in regexp_replace(lower(pg_get_functiondef(
  'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure)),'[[:space:]]+',' ','g'))>0,
  'full and compact inputs delegate to the existing atomic movement RPCs');
select ok(position('insert into public.ph_request_delivery_outbox' in regexp_replace(lower(pg_get_functiondef(
  'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure)),'[[:space:]]+',' ','g'))>0
  and position('inventory_reclass_move_completed' in pg_get_functiondef(
    'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure))>0
  and position('duplicate' in pg_get_functiondef(
    'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure))>0,
  'notification intent is inserted in the same transaction and same-command replays are deduplicated');

select ok(position('o.lease_token = p_lease_token' in regexp_replace(lower(pg_get_functiondef(
  'public.prepare_inventory_reclass_move_delivery_v1(uuid,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0
  and position('o.status = ''processing''' in regexp_replace(lower(pg_get_functiondef(
    'public.prepare_inventory_reclass_move_delivery_v1(uuid,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0,
  'payload preparation requires the current processing lease');
select ok(position('receipt.result->>''status'' <> ''applied''' in regexp_replace(lower(pg_get_functiondef(
  'public.prepare_inventory_reclass_move_delivery_v1(uuid,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0
  and position('deliveryrecipients' in regexp_replace(lower(pg_get_functiondef(
    'public.prepare_inventory_reclass_move_delivery_v1(uuid,uuid)'::regprocedure)),'[[:space:]]+',' ','g'))>0,
  'email payloads are tied to an applied movement receipt and validated frozen recipients');
select ok(position('fixed_recipient_emails || actor_email' in regexp_replace(lower(pg_get_functiondef(
  'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure)),'[[:space:]]+',' ','g'))>0,
  'trusted server-side recipient list always contains the active authenticated actor');
select ok(position('cardinality(fixed_recipient_emails) <> 5' in regexp_replace(lower(pg_get_functiondef(
  'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure)),'[[:space:]]+',' ','g'))>0
  and position('fixed_recipient_emails || actor_email' in regexp_replace(lower(pg_get_functiondef(
  'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure)),'[[:space:]]+',' ','g'))>0,
  'durable Reclass notification freezes the existing five fixed recipients plus the active actor');

select * from finish();
rollback;
