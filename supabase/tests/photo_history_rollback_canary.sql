-- Rollback-only canary. No email event becomes visible to a worker.
begin;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare actor uuid; rep uuid; asset uuid; packet jsonb; first_result jsonb; replay jsonb; ev uuid; count_before bigint;
begin
  assert not has_table_privilege('authenticated','public.ph_photo_history_assets','SELECT');
  assert not has_table_privilege('authenticated','public.ph_photo_history_shares','INSERT');
  assert not has_function_privilege('anon','public.photo_history_gallery_v1(uuid,text,jsonb)','EXECUTE');
  assert not has_function_privilege('authenticated','public.photo_history_gallery_v1(uuid,text,jsonb)','EXECUTE');
  select id into actor from public.profiles where username='dylan_collyge';
  select (r->>'id')::uuid into rep from jsonb_array_elements(public.photo_history_gallery_v1(actor,'recipients','{}')->'recipients')r limit 1;
  select id into asset from public.ph_photo_history_assets where commonname='Lemon Grass' order by photo_at desc limit 1;
  assert actor is not null and rep is not null and asset is not null, 'CANARY_FIXTURE_UNAVAILABLE';
  begin
    perform public.photo_history_gallery_v1(gen_random_uuid(),'search','{}');
    raise exception 'FORBIDDEN_WAS_NOT_REJECTED';
  exception when insufficient_privilege then null; end;
  select count(*) into count_before from public.ph_request_delivery_outbox where event_type='photo_history_share';
  packet:=jsonb_build_object('ids',jsonb_build_array(asset,asset),'recipientId',rep,'message','Rollback-only test',
    'idempotencyKey','photo-history-rollback-'||gen_random_uuid(),'recipientEmails',jsonb_build_array('untrusted@example.invalid'),'actorUsername','someone_else');
  first_result:=public.photo_history_gallery_v1(actor,'send',packet);
  replay:=public.photo_history_gallery_v1(actor,'send',packet);
  assert first_result->>'id'=replay->>'id' and (replay->>'duplicate')::boolean;
  assert (select count(*) from public.ph_request_delivery_outbox where event_type='photo_history_share')=count_before+1;
  select event_id into ev from public.ph_photo_history_shares where id=(first_result->>'id')::uuid;
  assert (select photo_count from public.ph_photo_history_shares where event_id=ev)=1;
  assert (select payload->>'actorUsername' from public.ph_request_delivery_outbox where event_id=ev)='dylan_collyge';
  assert (select payload->'recipientEmails' from public.ph_request_delivery_outbox where event_id=ev)<>jsonb_build_array('untrusted@example.invalid');
  assert (select jsonb_array_length(payload->'photos') from public.ph_request_delivery_outbox where event_id=ev)=1;
  begin
    perform public.photo_history_gallery_v1(actor,'send',packet||jsonb_build_object('message','changed'));
    raise exception 'TOKEN_CONFLICT_WAS_NOT_REJECTED';
  exception when raise_exception then
    if sqlerrm<>'PHOTO_HISTORY_TOKEN_CONFLICT' then raise; end if;
  end;
  update public.ph_request_delivery_outbox set status='delivered',email_delivered_at=now() where event_id=ev;
  perform public.photo_history_gallery_v1(actor,'retry',jsonb_build_object('id',first_result->>'id'));
  assert (select status from public.ph_request_delivery_outbox where event_id=ev)='delivered';
end $$;
select 'photo_history_rollback_canary_passed' result;
rollback;
