begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

do $migration$
declare
  target regprocedure := 'suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure;
  definition text := pg_get_functiondef(target);
  old_text text;
  new_text text;
begin
  if position('suspend-close-stable-identity-v2392' in definition) > 0 then return; end if;

  old_text := $old$select * into s from public.ph_soc_master where unique_id=uid for update;
 if p_operation<>'decide' then
   if p_operation<>'dock_review' and not suspend_tag_private.eligible(s.suspend,s.suspend_to) then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;
   if not (p_payload ? 'expectedLastUpdated') or s.last_updated is distinct from (p_payload->>'expectedLastUpdated')::timestamptz then
     raise exception 'SUSPEND_TAG_SOURCE_CHANGED' using errcode='PT409'; end if;$old$;
  new_text := $new$-- suspend-close-stable-identity-v2392: close the active physical tag even when an import changes its UID or timestamp.
 select * into s from public.ph_soc_master where unique_id=uid for update;
 if p_operation='close' and (s.unique_id is null or not suspend_tag_private.eligible(s.suspend,s.suspend_to))
    and jsonb_typeof(p_payload->'sourceIdentity')='object' then
   select candidate.* into s from public.ph_soc_master candidate
    where suspend_tag_private.eligible(candidate.suspend,candidate.suspend_to)
      and upper(btrim(coalesce(candidate.transactionnumber,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'transactionnumber','')))
      and upper(btrim(coalesce(candidate.dock,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'dock','')))
      and upper(btrim(coalesce(candidate.stopnumber,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'stopnumber','')))
      and upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'itemcode','')))
      and upper(btrim(coalesce(candidate.locationcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'locationcode','')))
      and upper(btrim(coalesce(candidate.lotcode,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'lotcode','')))
      and upper(btrim(coalesce(candidate.consigneeidentityid,candidate.consigneename,'')))=upper(btrim(coalesce(p_payload->'sourceIdentity'->>'consignee','')))
    order by candidate.last_updated desc,candidate.unique_id limit 1 for update;
   if s.unique_id is not null then uid:=s.unique_id; end if;
 end if;
 if p_operation<>'decide' then
   if p_operation<>'dock_review' and not suspend_tag_private.eligible(s.suspend,s.suspend_to) then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;
   if p_operation<>'close' and (not (p_payload ? 'expectedLastUpdated') or s.last_updated is distinct from (p_payload->>'expectedLastUpdated')::timestamptz) then
     raise exception 'SUSPEND_TAG_SOURCE_CHANGED' using errcode='PT409'; end if;$new$;
  if (length(definition) - length(replace(definition, old_text, ''))) / length(old_text) <> 1 then
    raise exception 'AGDATA_V2392_SUSPEND_SOURCE_ANCHOR_MISMATCH';
  end if;
  definition := replace(definition, old_text, new_text);

  old_text := $old$elsif p_operation='close' then
   update suspend_tag_private.approvals set status='superseded' where id=w.current_approval_id and status='pending';
   update public.ph_soc_master set suspend=null,suspend_to=null,date_completed=stamp where unique_id=uid;$old$;
  new_text := $new$elsif p_operation='close' then
   insert into public.ph_productivity_history(event_key,completed_by_username,completed_by_display,completed_at,
     source_table,source_kind,source_unique_id,source_assignment,itemcode,commonname,contsize,locationcode,lotcode,
     customer_name,request_folder,snapshot)
   values('suspend-tag-complete:'||uid,actor.username,coalesce(nullif(actor.display_name,''),actor.username),stamp,
     'ph_soc_master','Suspend Tag',uid,to_jsonb(s)->>'assignedto',s.itemcode,s.commonname,s.contsize,s.locationcode,s.lotcode,
     coalesce(to_jsonb(s)->>'customername',to_jsonb(s)->>'consigneename'),to_jsonb(s)->>'request_folder',
     to_jsonb(s)||jsonb_build_object('completed_at',stamp,'completed_by_username',actor.username))
   on conflict(event_key) do nothing;
   update suspend_tag_private.approvals set status='superseded' where id=w.current_approval_id and status='pending';
   update public.ph_soc_master set suspend=null,suspend_to=null,date_completed=stamp where unique_id=uid;$new$;
  if (length(definition) - length(replace(definition, old_text, ''))) / length(old_text) <> 1 then
    raise exception 'AGDATA_V2392_SUSPEND_ARCHIVE_ANCHOR_MISMATCH';
  end if;
  execute replace(definition, old_text, new_text);
end
$migration$;

insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('app_version',jsonb_build_object('release','AgData v2.3.92','app_version','2.3.92'),
  'release-v2.3.92',clock_timestamp())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

do $verify$
declare definition text := pg_get_functiondef('suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure);
begin
  if position('suspend-close-stable-identity-v2392' in definition)=0
     or position('suspend-tag-complete:' in definition)=0
     or position('p_operation<>''close''' in definition)=0
     or not exists(select 1 from public.ph_app_settings where key='app_version' and value->>'app_version'='2.3.92') then
    raise exception 'AGDATA_V2392_SUSPEND_CLOSE_INSTALL_FAILED';
  end if;
  if not exists(select 1 from pg_class where oid='public.ph_suspend_history'::regclass and reloptions @> array['security_invoker=true']) then
    raise exception 'AGDATA_V2392_SUSPEND_HISTORY_SECURITY_INVOKER_REQUIRED';
  end if;
end
$verify$;

commit;
