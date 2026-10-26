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
      'requested_by',min(proof.requested_by),
      'request_created_by_username',min(proof.request_created_by_username),
      'request_created_by_email',min(proof.request_created_by_email),
      'request_selected_rep_username',min(proof.request_selected_rep_username),
      'request_selected_rep_display',min(proof.request_selected_rep_display),
      'request_selected_rep_email',min(proof.request_selected_rep_email),
      'request_folder',min(proof.request_folder)
    ) into canary_proof
    from (
      select active.requested_by,active.request_created_by_username,active.request_created_by_email,
        active.request_selected_rep_username,active.request_selected_rep_display,active.request_selected_rep_email,active.request_folder
      from public.ph_active_request active
      where active.client_batch_id=verify_request_batch_submission_v2368.client_batch_id
      union all
      select history.requested_by,history.request_created_by_username,history.request_created_by_email,
        history.request_selected_rep_username,history.request_selected_rep_display,history.request_selected_rep_email,history.request_folder
      from public.ph_request_history history
      where history.client_batch_id=verify_request_batch_submission_v2368.client_batch_id
    ) proof;
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
