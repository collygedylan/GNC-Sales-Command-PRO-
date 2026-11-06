set local lock_timeout='15s';
alter table private.ph_inventory_reclass_commands_v1 add column if not exists reclass_explanations jsonb;
alter table public.ph_inventory_transactions add column if not exists reclass_explanations jsonb;
alter table private.ph_inventory_reclass_movements_v1 add column if not exists reclass_explanation text;
alter table public.ph_inventory_transactions add column if not exists reclass_explanation text;
do $view$
declare definition text; changed text;
begin
 select pg_get_viewdef('public.ph_reclass_history'::regclass,true) into definition;
 changed:=regexp_replace(definition,' AS absorbed_by_erp', ' AS absorbed_by_erp, coalesce(m.reclass_explanation,c.reclass_explanations->>coalesce(m.source_unique_id,c.request->>''sourceUid'')) as reclass_explanation');
 changed:=replace(changed,'   FROM ph_inventory_transactions t','   ,t.reclass_explanation FROM ph_inventory_transactions t');
 if changed=definition or position('t.reclass_explanation FROM' in changed)=0 then raise exception 'RECLASS_HISTORY_VIEW_ANCHOR_MISSING'; end if;
 execute 'create or replace view public.ph_reclass_history with (security_invoker=true) as '||changed;
end $view$;
create or replace function private.require_reclass_explanations_v303(p_actor_id uuid,p_map jsonb,p_uids text[])
returns void language plpgsql security definer set search_path='' as $fn$
declare actor public.profiles%rowtype; uid text; exempt boolean;
begin
 select * into actor from public.profiles where id=p_actor_id and disabled_at is null
   and not must_change_password and (locked_until is null or locked_until<=now());
 if actor.id is null then raise exception using errcode='42501',message='DRIVE_RECLASS_PROFILE_NOT_ACTIVE'; end if;
 if jsonb_typeof(p_map) is distinct from 'object' or exists(select 1 from jsonb_each(p_map) e where jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}')>4000) then
   raise exception using errcode='22023',message='DRIVE_RECLASS_EXPLANATION_INVALID'; end if;
 exempt:=regexp_replace(lower(btrim(coalesce(actor.role,''))),'[_\s]+','-','g') in ('admin','super-admin') or lower(btrim(actor.username))='dylan_collyge';
 foreach uid in array coalesce(p_uids,array[]::text[]) loop
   if not exempt and nullif(btrim(p_map->>uid),'') is null then
     raise exception using errcode='22023',message='DRIVE_RECLASS_EXPLANATION_REQUIRED';
   end if;
 end loop;
 perform set_config('gnc.reclass_explanations',p_map::text,true);
end $fn$;
revoke all on function private.require_reclass_explanations_v303(uuid,jsonb,text[]) from public,anon,authenticated;
create or replace function private.attach_reclass_explanation_v303()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare explanations jsonb:=coalesce(nullif(current_setting('gnc.reclass_explanations',true),''),'{}')::jsonb; summary text; rp jsonb;
begin
 if explanations='{}'::jsonb then return new; end if;
 select string_agg(key||': '||value,E'\n' order by key) into summary from jsonb_each_text(explanations) where nullif(btrim(value),'') is not null;
 if tg_table_name='ph_inventory_reclass_commands_v1' then
   new.reclass_explanations:=explanations;
 elsif tg_table_name in ('ph_inventory_reclass_movements_v1','ph_inventory_transactions') then
   new.reclass_explanation:=nullif(btrim(explanations->>new.source_unique_id),'');
   if tg_table_name='ph_inventory_transactions' then new.reclass_explanations:=explanations; end if;
 elsif new.payload ? 'reclassPayload' then
   rp:=new.payload->'reclassPayload';
   rp:=rp||jsonb_build_object('protectedDelivery',coalesce(rp->'protectedDelivery','{}')||jsonb_build_object('reclassExplanations',explanations));
   new.payload:=new.payload||jsonb_build_object('reclassPayload',rp,'reclass_explanation',summary);
 end if;
 if tg_table_name='ph_request_delivery_outbox' then
   new.payload:=new.payload||jsonb_build_object('reclassExplanations',explanations,'reclass_explanation',summary);
 end if;
 return new;
end $fn$;
revoke all on function private.attach_reclass_explanation_v303() from public,anon,authenticated;
create trigger reclass_explanation_history_v303 before insert on private.ph_inventory_reclass_movements_v1 for each row execute function private.attach_reclass_explanation_v303();
create trigger reclass_explanation_command_v303 before insert on private.ph_inventory_reclass_commands_v1 for each row execute function private.attach_reclass_explanation_v303();
create trigger reclass_explanation_transaction_v303 before insert on public.ph_inventory_transactions for each row execute function private.attach_reclass_explanation_v303();
create trigger reclass_explanation_outbox_v303 before insert or update of payload on public.ph_request_delivery_outbox for each row execute function private.attach_reclass_explanation_v303();
do $patch$
declare fn record; definition text; changed text;
begin
 for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('enqueue_drive_reclass_inquiry_v1','enqueue_drive_reclass_inquiry_v4','enqueue_drive_reclass_inquiry_v5','enqueue_drive_reclass_inquiry_v6','enqueue_drive_reclass_inquiry_v7') loop
   definition:=pg_get_functiondef(fn.oid);
   changed:=regexp_replace(definition,E'\\mbegin\\M',E'begin
  if auth.role() is distinct from ''service_role'' then raise exception using errcode=''42501'',message=''DRIVE_RECLASS_FORBIDDEN''; end if;
  perform private.require_reclass_explanations_v303(
    (select id from public.profiles where lower(btrim(username))=lower(btrim(p_payload->>''actorUsername''))),
    coalesce(p_payload->''reclassExplanations'',nullif(current_setting(''gnc.reclass_explanations'',true),'''')::jsonb,''{}''::jsonb),
    coalesce((select array_agg(distinct uid) from (
      select value->>''unique_id'' uid from jsonb_array_elements(coalesce(p_payload->''rowOverlays'',''[]''::jsonb))
        where jsonb_array_length(coalesce(value->''proposals'',''[]''::jsonb))>0 or jsonb_array_length(coalesce(value->''fieldEdits'',''[]''::jsonb))>0
          or value->>''resolution''=''done'' or value#>>''{action,included}''=''true''
      union select value->>''sourceUid'' from jsonb_array_elements(coalesce(p_payload#>''{transaction,holdStopProposals}'',''[]''::jsonb))
    ) targets where uid is not null),array[p_payload#>>''{source,unique_id}'']));
  p_payload:=p_payload-''reclassExplanations'';');
   if changed=definition then raise exception 'RECLASS_EXPLANATION_ANCHOR_MISSING'; end if;
   execute changed;
 end loop;
 select pg_get_functiondef('public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure) into definition;
 changed:=replace(definition,'  -- Match the movement RPC', '  perform private.require_reclass_explanations_v303(p_actor_id,
    coalesce((select jsonb_object_agg(value#>>''{source,uniqueId}'',coalesce(value->>''reclass_explanation'','''')) from jsonb_array_elements(p_moves)),''{}''::jsonb),
    array(select value#>>''{source,uniqueId}'' from jsonb_array_elements(p_moves)));
  p_moves:=(select jsonb_agg(value-''reclass_explanation'' order by n) from jsonb_array_elements(p_moves) with ordinality e(value,n));
  -- Match the movement RPC');
 if changed=definition then raise exception 'RECLASS_MOVE_EXPLANATION_ANCHOR_MISSING'; end if;
 execute changed;
end $patch$;
