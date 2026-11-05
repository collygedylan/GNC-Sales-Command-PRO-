CREATE OR REPLACE FUNCTION public.test_reclass_transport_v1(p_command jsonb DEFAULT NULL::jsonb, p_ticket bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_uid uuid:=auth.uid(); sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid; h jsonb:=current_setting('request.headers',true)::jsonb; ticket bigint; reply net._http_response; req_headers jsonb;
begin
 if auth.role() is distinct from 'authenticated' or actor_uid is null or sid is null or not test_suspend_tag_private.session_active(actor_uid,sid) then raise exception 'RECLASS_SESSION_REQUIRED' using errcode='42501';end if;
 if p_ticket is not null then
  if not exists(select 1 from test_private.reclass_transport_receipts_v1 where request_id=p_ticket and actor=actor_uid and session_id=sid and created_at>now()-interval '10 minutes') then raise exception 'RECLASS_TICKET_FORBIDDEN' using errcode='42501';end if;
  select * into reply from net._http_response r where r.id=p_ticket;
  if not found then return jsonb_build_object('ticket',p_ticket,'pending',true);end if;
  return jsonb_build_object('ticket',p_ticket,'status',coalesce(reply.status_code,503),'body',case when reply.content_type like '%json%' and reply.content is not null then reply.content::jsonb else '{}'::jsonb end);
 end if;
 if p_command is null or octet_length(p_command::text)>524288 or not ((p_command->>'action'='drive_reclass_inquiry' and p_command->>'operation' in ('create','status','retry') and nullif(p_command->>'idempotencyToken','') is not null) or (p_command->>'action'='inventory_reclass_move' and nullif(p_command->>'commandId','') is not null)) is true then raise exception 'RECLASS_COMMAND_INVALID' using errcode='22023';end if;
 if coalesce(h->>'authorization','') not like 'Bearer %' then raise exception 'RECLASS_SESSION_REQUIRED' using errcode='42501';end if;
 delete from test_private.reclass_transport_receipts_v1 where created_at<now()-interval '10 minutes';
 req_headers:=jsonb_strip_nulls(jsonb_build_object('Content-Type','application/json','Authorization',h->>'authorization','apikey',h->>'apikey','Origin',h->>'origin','Idempotency-Key',coalesce(p_command->>'idempotencyToken',p_command->>'commandId')));
 select net.http_post(url:='https://apztnscvagayslumnalr.supabase.co/functions/v1/test-app-api',body:=p_command,headers:=req_headers,timeout_milliseconds:=20000) into ticket;
 insert into test_private.reclass_transport_receipts_v1(request_id,actor,session_id) values(ticket,actor_uid,sid);
 return jsonb_build_object('ticket',ticket,'pending',true);
end $function$
;
