begin;
set local lock_timeout='2s';
set local statement_timeout='10s';

alter table public.ph_soc_master add column if not exists locationcodeshipchange text,
  add column if not exists cancel_reason text;

-- The canonical command already locked the frozen candidate set and checked
-- the actor. Persist the order outcome on those physical rows only.
create or replace function suspend_tag_private.apply_dock_decision_v3040(
  p_source text,p_chosen text,p_decision text,p_rep text
) returns void language plpgsql set search_path='' as $function$
declare original public.ph_soc_master%rowtype; chosen public.ph_soc_master%rowtype; note text;
begin
  select * into strict original from public.ph_soc_master where unique_id=p_source;
  if p_decision='deny' then
    update public.ph_soc_master set status='Canceled',cancel_reason='per '||p_rep
    where unique_id=p_source and suspend_candidate_state='canceled';
    return;
  end if;
  select * into strict chosen from public.ph_soc_master where unique_id=p_chosen;
  if chosen.suspend_candidate_state is distinct from 'approved'
    or chosen.dock is distinct from original.dock or chosen.stopnumber is distinct from original.stopnumber
    or chosen.transactionnumber is distinct from original.transactionnumber then
    raise exception 'SUSPEND_TAG_APPROVAL_SUPERSEDED' using errcode='PT409';
  end if;
  if upper(btrim(chosen.locationcode)) is not distinct from upper(btrim(original.locationcode)) then return; end if;
  note:='pic approved '||chosen.locationcode||' '||p_rep;
  update public.ph_soc_master set locationcode=chosen.locationcode,lotcode=chosen.lotcode,locationcodeshipchange=note
  where unique_id in (p_source,p_chosen);
end
$function$;
revoke all on function suspend_tag_private.apply_dock_decision_v3040(text,text,text,text)
from public,anon,authenticated,service_role;

do $patch$
declare
  definition text:=pg_get_functiondef('suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure);
  anchor constant text:=$a$   if decision='approve' or remaining=0 then
     if decision='deny' then update public.ph_soc_master r set suspend_candidate_state='canceled' where r.unique_id in(select value->>'unique_id' from jsonb_array_elements(candidates)); end if;$a$;
  retention text:=pg_get_functiondef('suspend_tag_private.retain_candidate_decision()'::regprocedure);
  old_copy constant text:='    new.suspend:=old.suspend; new.suspend_to:=old.suspend_to; new.date_completed:=old.date_completed;';
  actor_anchor constant text:='   uid:=a.source_uid;';
begin
  if cardinality(string_to_array(definition,anchor))<>2 or cardinality(string_to_array(retention,old_copy))<>2
    or cardinality(string_to_array(definition,actor_anchor))<>2 then
    raise exception 'SUSPEND_DOCK_DECISION_ANCHOR_CHANGED';
  end if;
  definition:=replace(definition,actor_anchor,$a$   if p_operation='decide' and a.rep_id is distinct from actor.id
     and not private.is_full_app_administrator_v1(actor.username) then
     raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501';
   end if;
   uid:=a.source_uid;$a$);
  execute replace(definition,anchor,anchor||$a$
     perform suspend_tag_private.apply_dock_decision_v3040(a.source_uid,chosen,decision,
       coalesce(nullif(btrim(s.salesrepname),''),nullif(btrim(a.snapshot->>'rep_display'),''),
         nullif(btrim(a.snapshot->>'rep_username'),''),actor.username));$a$);
  execute replace(replace(retention,old_copy,old_copy||$a$
    new.locationcodeshipchange:=old.locationcodeshipchange; new.cancel_reason:=old.cancel_reason;
    if old.cancel_reason is not null then new.status:='Canceled'; end if;$a$),
    'new.status:=''completed'';', 'new.status:=case when new.cancel_reason is null then ''completed'' else ''Canceled'' end;');
end
$patch$;

do $docks$
declare
  definition text;
  from_anchor constant text:=E'\n   FROM ph_soc_master';
  old_filter constant text:=$f$(COALESCE(suspend_candidate_state, ''::text) <> ALL (ARRAY['replaced'::text, 'denied'::text, 'canceled'::text, 'cancelled'::text, 'rejected'::text]))$f$;
begin
  if to_regclass('public.ph_docks') is null then return; end if;
  definition:=pg_get_viewdef('public.ph_docks'::regclass,true);
  if cardinality(string_to_array(definition,from_anchor))<>2 or cardinality(string_to_array(definition,old_filter))<>2 then
    raise exception 'SUSPEND_DOCK_PROJECTION_CHANGED';
  end if;
  execute 'create or replace view public.ph_docks with (security_invoker=true) as '||
    replace(replace(definition,from_anchor,', locationcodeshipchange, cancel_reason'||from_anchor),
      old_filter,'('||old_filter||' or (status=''Canceled'' and cancel_reason is not null))');
end
$docks$;

notify pgrst, 'reload schema';
commit;
