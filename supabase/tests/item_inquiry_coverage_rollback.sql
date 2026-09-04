begin;
set local statement_timeout='20s';
do $test$
declare
  dylan_id uuid;
  sunday_id uuid;
  state jsonb;
  next_state jsonb;
  token text := 'coverage-rollback-' || gen_random_uuid()::text;
  v_event_key text := 'coverage-rollback-' || gen_random_uuid()::text;
  recipients jsonb;
begin
  select id into dylan_id from public.profiles where lower(username)='dylan_collyge';
  select id into sunday_id from public.profiles where lower(username)='sunday_ellis';
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',dylan_id::text,true);
  state := public.get_item_inquiry_coverage_v1();
  next_state := public.set_item_inquiry_coverage_v1(true,(state->>'revision')::bigint,token);
  if next_state->>'sharonAway' <> 'true' or next_state->>'backupReady' <> 'true' then
    raise exception 'coverage state not acknowledged';
  end if;
  if public.set_item_inquiry_coverage_v1(true,(state->>'revision')::bigint,token)->>'replayed' <> 'true' then
    raise exception 'idempotent replay failed';
  end if;

  insert into public.ph_request_delivery_outbox(event_key,event_type,payload,status,next_attempt_at)
  values(v_event_key,'reclass_inquiry',jsonb_build_object('reclassPayload',jsonb_build_object(
    'recipientEmails',jsonb_build_array(private.item_inquiry_verified_email_v1('sharon_combs')))),
    'pending',now());
  select payload#>'{reclassPayload,recipientEmails}' into recipients
  from public.ph_request_delivery_outbox where ph_request_delivery_outbox.event_key=v_event_key;
  if not recipients ? private.item_inquiry_verified_email_v1('sharon_combs')
    or not recipients ? private.item_inquiry_verified_email_v1('sunday_ellis') then
    raise exception 'reclass recipients incomplete';
  end if;
  if (select payload#>>'{itemInquiryCoverage,sundayAdded}' from public.ph_request_delivery_outbox where ph_request_delivery_outbox.event_key=v_event_key) <> 'true' then
    raise exception 'coverage snapshot missing';
  end if;

  insert into public.ph_request_delivery_outbox(event_key,event_type,payload,status,next_attempt_at)
  values(v_event_key||'-completion','eval_work_completion',jsonb_build_object(
    'completionRecipients',jsonb_build_array(private.item_inquiry_verified_email_v1('sharon_combs'))),
    'pending',now());
  select payload->'completionRecipients' into recipients from public.ph_request_delivery_outbox
    where ph_request_delivery_outbox.event_key=v_event_key||'-completion';
  if not recipients ? private.item_inquiry_verified_email_v1('sunday_ellis') then
    raise exception 'completion recipient coverage missing';
  end if;

  insert into public.ph_request_delivery_outbox(event_key,event_type,payload,status,next_attempt_at)
  values(v_event_key||'-assignment','eval_work_assignment',jsonb_build_object(
    'assignmentRecipients',jsonb_build_array(private.item_inquiry_verified_email_v1('sharon_combs'))),
    'pending',now());
  if (select payload ? 'itemInquiryCoverage' from public.ph_request_delivery_outbox
      where ph_request_delivery_outbox.event_key=v_event_key||'-assignment') then
    raise exception 'initial assignment was changed';
  end if;

  perform set_config('request.jwt.claim.sub',sunday_id::text,true);
  begin
    perform public.get_item_inquiry_coverage_v1();
    raise exception 'non-manager read accepted';
  exception when insufficient_privilege then null;
  end;
end
$test$;
rollback;
