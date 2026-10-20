-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select has_function('private', 'reclass_delivery_recipients_v1', array['text'],
  'the private canonical Reclass recipient resolver is installed');
select has_function('public', 'get_reclass_delivery_recipients_v1', array['text'],
  'the service-boundary recipient resolver is installed');
select ok(has_function_privilege('service_role', 'public.get_reclass_delivery_recipients_v1(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.get_reclass_delivery_recipients_v1(text)', 'execute')
  and not has_function_privilege('anon', 'public.get_reclass_delivery_recipients_v1(text)', 'execute'),
  'recipient lookup is service-role-only');
select ok(lower(pg_get_functiondef('public.get_reclass_delivery_recipients_v1(text)'::regprocedure)) like '%private.is_service_role_request()%'
  and lower(pg_get_functiondef('public.get_reclass_delivery_recipients_v1(text)'::regprocedure)) like '%private.reclass_delivery_recipients_v1(p_actor_username)%',
  'the public wrapper checks its service boundary and delegates to private policy');
select ok(lower(pg_get_functiondef('private.reclass_delivery_recipients_v1(text)'::regprocedure)) like '%dylan_collyge%'
  and lower(pg_get_functiondef('private.reclass_delivery_recipients_v1(text)'::regprocedure)) like '%megan_kelly%'
  and lower(pg_get_functiondef('private.reclass_delivery_recipients_v1(text)'::regprocedure)) like '%actor_key%',
  'canonical recipients are Dylan, Megan, and the submitting actor');
select ok(lower(pg_get_functiondef('private.reclass_delivery_recipients_v1(text)'::regprocedure)) like '%disabled_at is null%'
  and lower(pg_get_functiondef('private.reclass_delivery_recipients_v1(text)'::regprocedure)) like '%locked_until%'
  and lower(pg_get_functiondef('private.reclass_delivery_recipients_v1(text)'::regprocedure)) like '%must_change_password%',
  'recipient profiles must be active, unlocked, and cleared for use');
select ok(lower(pg_get_functiondef('private.reclass_delivery_recipients_v1(text)'::regprocedure)) like '%email_confirmed_at is not null%'
  and lower(pg_get_functiondef('private.reclass_delivery_recipients_v1(text)'::regprocedure)) like '%array_agg(distinct lower(btrim(u.email))%'
  and lower(pg_get_functiondef('private.reclass_delivery_recipients_v1(text)'::regprocedure)) like '%reclass_required_recipients_unavailable%',
  'confirmed profile emails are deduplicated and missing required addresses fail closed');
select ok(has_function_privilege('service_role', 'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)', 'execute'),
  'the atomic movement and delivery wrapper retains its service-only boundary');
select ok(lower(pg_get_functiondef('public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure)) like '%private.reclass_delivery_recipients_v1(actor_username)%'
  and lower(pg_get_functiondef('public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure)) like '%actor_email <> all(recipient_emails)%',
  'completed movement resolves recipients server-side and requires the active actor address');
select ok(lower(pg_get_functiondef('public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure)) like '%b.result->''rows''%'
  and lower(pg_get_functiondef('public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure)) like '%appliedrows%',
  'the completion event contains authoritative post-move rows from the immutable receipt');
select ok(lower(pg_get_functiondef('public.prepare_inventory_reclass_move_delivery_v1(uuid,uuid)'::regprocedure)) like '%o.lease_token = p_lease_token%'
  and lower(pg_get_functiondef('public.prepare_inventory_reclass_move_delivery_v1(uuid,uuid)'::regprocedure)) like '%private.reclass_delivery_recipients_v1(actor_username)%'
  and lower(pg_get_functiondef('public.prepare_inventory_reclass_move_delivery_v1(uuid,uuid)'::regprocedure)) like '%appliedrows%',
  'leased delivery preparation refreshes canonical recipients and receipt-backed applied rows');
select ok(lower(pg_get_functiondef('public.enqueue_drive_reclass_inquiry_v7(jsonb)'::regprocedure)) like '%recipientpolicy%'
  and lower(pg_get_functiondef('public.enqueue_drive_reclass_inquiry_v7(jsonb)'::regprocedure)) like '%private.reclass_delivery_recipients_v1(actor_username)%',
  'all V7 Reclass inquiry proposals use the immutable server recipient policy');

select * from finish();
rollback;
