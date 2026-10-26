create or replace function public.verify_request_batch_submission_v2368(client_batch_id uuid,requests jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles%rowtype;
  receipt jsonb;
  canary_proof jsonb;
  receipt_text text;
begin
  actor:=private.current_active_profile();
  if lower(btrim(coalesce(actor.username,'')))<>'dylan_collyge' then
    raise exception using errcode='42501',message='REQUEST_CANARY_DYLAN_ONLY';
  end if;
  begin
    receipt:=private.insert_request_batch(client_batch_id,private.stamp_request_batch_creator(requests),'general');
    select jsonb_build_object(
      'requested_by',min(active.requested_by),
      'request_created_by_username',min(active.request_created_by_username),
      'request_created_by_email',min(active.request_created_by_email),
      'request_selected_rep_username',min(active.request_selected_rep_username),
      'request_selected_rep_display',min(active.request_selected_rep_display),
      'request_selected_rep_email',min(active.request_selected_rep_email),
      'request_folder',min(active.request_folder)
    ) into canary_proof
    from public.ph_active_request active
    where active.client_batch_id=verify_request_batch_submission_v2368.client_batch_id;
    raise exception using errcode='P2368',message='REQUEST_CANARY_ROLLBACK',
      detail=(receipt||jsonb_build_object('canary_proof',canary_proof))::text;
  exception when sqlstate 'P2368' then
    get stacked diagnostics receipt_text=PG_EXCEPTION_DETAIL;
  end;
  return receipt_text::jsonb || jsonb_build_object('ok',true,'canary_rolled_back',true);
end
$function$;

revoke all on function public.verify_request_batch_submission_v2368(uuid,jsonb) from public,anon;
grant execute on function public.verify_request_batch_submission_v2368(uuid,jsonb) to authenticated;
