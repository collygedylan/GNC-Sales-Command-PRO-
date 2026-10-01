begin;

-- Only live assignment columns are changed. Source snapshots, completed rows,
-- author/completer fields and delivery history are never transfer targets.
create or replace function private.handover_replace_identity_v1(value text)
returns text language sql immutable set search_path='' as $$
  select case when value is null then null else regexp_replace(regexp_replace(value,
    '(^|[^a-z0-9_@.+-])kayla_knepp@greenleafnursery[.]com(?=$|[^a-z0-9_@.+-])',
    '\1nelly_aguilar@greenleafnursery.com', 'gi'),
    '(^|[^a-z0-9_@.+-])kayla[ _.-]+knepp(?=$|[^a-z0-9_@.+-])',
    '\1nelly_aguilar', 'gi') end
$$;
revoke all on function private.handover_replace_identity_v1(text) from public,anon,authenticated;

create or replace function private.handover_assignment_targets_v1()
returns table(table_name text,key_name text,field_names text[],eligibility text)
language sql immutable set search_path='' as $$
  values
  ('ph_eval_assignment_rules','id',array['assignedto'],'r.active is true'),
  ('ph_warehouse_assigned_items','id',array['assignedto'],'r.present_in_drive is true'),
  ('ph_inventory_edit_requests','id',array['assignedto'],
    'lower(coalesce(r.status,''pending'')) not in (''complete'',''completed'',''cancelled'',''canceled'',''archived'',''closed'') and (r.inventory_edit_completed_at is null or r.photo_data_completed_at is null)'),
  ('ph_master_inventory','unique_id',array['assignedto'], 'r.date_completed is null and r.eval_task_completed_at is null'),
  ('ph_master_inventory','unique_id',array['flyer_assigned'], 'r.flyer_completed is null'),
  ('ph_reserves','unique_id',array['assignedto','assigned_to'], 'nullif(btrim(r.date_completed),'''') is null'),
  ('ph_reserves','unique_id',array['flyer_assigned'], 'nullif(btrim(r.flyer_completed),'''') is null'),
  ('ph_soc_master','unique_id',array['assignedto'], 'r.date_completed is null'),
  ('ph_soc_master','unique_id',array['flyer_assigned'], 'nullif(btrim(r.flyer_completed),'''') is null')
$$;
revoke all on function private.handover_assignment_targets_v1() from public,anon,authenticated;

-- Normalize future imported/current assignments as well as the one-time batch.
-- This prevents an old source rule from assigning Kayla fresh work after cutoff.
create or replace function private.handover_normalize_assignment_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare h private.scheduled_account_handover_v1; cfg record; eligible boolean;
  doc jsonb:=to_jsonb(new); patch jsonb:='{}'::jsonb; col text; replacement text;
begin
  select * into h from private.scheduled_account_handover_v1
    where transition_key='kayla_knepp_to_nelly_aguilar_20261002';
  if h.transition_key is null or now()<h.effective_at then return new; end if;
  for cfg in select * from private.handover_assignment_targets_v1() where table_name=tg_table_name loop
    execute format('select %s from jsonb_populate_record(null::public.%I,$1) r',cfg.eligibility,cfg.table_name)
      into eligible using doc;
    if not coalesce(eligible,false) then continue; end if;
    foreach col in array cfg.field_names loop
      replacement:=private.handover_replace_identity_v1(doc->>col);
      if replacement is distinct from doc->>col then patch:=patch||jsonb_build_object(col,replacement); end if;
    end loop;
  end loop;
  if patch='{}'::jsonb then return new; end if;
  insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
  values(h.transition_key,'future:'||tg_table_name||':'||coalesce(doc->>'unique_id',doc->>'id')||':'||md5(patch::text||coalesce(doc->>'assignedto','')||coalesce(doc->>'flyer_assigned','')),
    'assignment_transferred',jsonb_build_object('table',tg_table_name,'id',coalesce(doc->>'unique_id',doc->>'id'),'source','future_assignment','after',patch))
  on conflict(event_key) do nothing;
  new:=jsonb_populate_record(new,patch);
  return new;
end
$$;
revoke all on function private.handover_normalize_assignment_v1() from public,anon,authenticated;

do $triggers$
declare cfg record;
begin
  for cfg in select table_name,array_agg(distinct col order by col) fields
    from private.handover_assignment_targets_v1() cross join lateral unnest(field_names) col group by table_name
  loop
    execute format('create trigger scheduled_handover_normalize_assignment before insert or update of %s on public.%I for each row execute function private.handover_normalize_assignment_v1()',
      (select string_agg(quote_ident(c),',') from unnest(cfg.fields) c),cfg.table_name);
  end loop;
end
$triggers$;

create or replace function private.transfer_remaining_handover_assignments_v1(p_transition_key text,p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h private.scheduled_account_handover_v1; cfg record; entry record; col text;
  match_sql text; fields_sql text; set_sql text; changed integer:=0; remaining boolean:=false; found_more boolean;
  cap integer:=greatest(1,least(coalesce(p_limit,100),500)); prior jsonb; after_values jsonb;
  nelly public.profiles; nelly_email text; profiles jsonb; names text[]; emails text[];
begin
  if p_transition_key<>'kayla_knepp_to_nelly_aguilar_20261002' then raise exception using errcode='PT400',message='HANDOVER_KEY_INVALID'; end if;
  select * into strict h from private.scheduled_account_handover_v1 where transition_key=p_transition_key for update;
  if now()<h.effective_at then return jsonb_build_object('changed',0,'remaining',false,'due',false); end if;
  select * into strict nelly from public.profiles where id=h.successor_profile_id;
  if nelly.disabled_at is not null or (nelly.locked_until is not null and nelly.locked_until>now()) then
    raise exception using errcode='PT409',message='HANDOVER_SUCCESSOR_INACTIVE';
  end if;
  select email into strict nelly_email from auth.users where id=nelly.id;
  for cfg in select * from private.handover_assignment_targets_v1() loop
    select string_agg(format('r.%1$I is distinct from private.handover_replace_identity_v1(r.%1$I)',c),' or '),
      string_agg(format('%L,r.%I',c,c),','),
      string_agg(format('%1$I=private.handover_replace_identity_v1(r.%1$I)',c),',')
      into match_sql,fields_sql,set_sql from unnest(cfg.field_names) c;
    for entry in execute format('select r.%I::text row_key,jsonb_build_object(%s) before_values from public.%I r where (%s) and (%s) order by r.%I for update skip locked limit $1',
      cfg.key_name,fields_sql,cfg.table_name,cfg.eligibility,match_sql,cfg.key_name) using greatest(0,cap-changed)
    loop
      execute format('update public.%I r set %s where r.%I::text=$1 returning jsonb_build_object(%s)',cfg.table_name,set_sql,cfg.key_name,fields_sql)
        into after_values using entry.row_key;
      insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
      values(h.transition_key,'transfer:'||cfg.table_name||':'||entry.row_key||':'||md5(entry.before_values::text),
        'assignment_transferred',jsonb_build_object('table',cfg.table_name,'id',entry.row_key,'before',entry.before_values,'after',after_values))
      on conflict(event_key) do nothing;
      changed:=changed+1;
    end loop;
    execute format('select exists(select 1 from public.%I r where (%s) and (%s))',cfg.table_name,cfg.eligibility,match_sql) into found_more;
    remaining:=remaining or found_more;
  end loop;

  -- Location Work assignments are live associations. The immutable line
  -- snapshots and delivery events keep their original author/assignee record.
  for entry in select j.id from public.ph_location_work_jobs j where j.status in ('open','in_progress')
    and (exists(select 1 from unnest(j.assigned_usernames) v where v is distinct from private.handover_replace_identity_v1(v))
      or exists(select 1 from public.ph_location_work_assignments a where a.job_id=j.id and a.profile_id=h.departing_profile_id))
    order by j.id for update skip locked limit greatest(0,cap-changed)
  loop
    select jsonb_build_object('assigned_usernames',assigned_usernames) into prior from public.ph_location_work_jobs where id=entry.id;
    insert into public.ph_location_work_assignments(job_id,profile_id,username,display_name,email)
      values(entry.id,nelly.id,nelly.username,coalesce(nelly.display_name,nelly.username),nelly_email) on conflict(job_id,profile_id) do nothing;
    delete from public.ph_location_work_assignments where job_id=entry.id and profile_id=h.departing_profile_id;
    update public.ph_location_work_jobs j set assigned_usernames=(select array_agg(distinct private.handover_replace_identity_v1(v)) from unnest(j.assigned_usernames||array[nelly.username]) v),
      revision=revision+1,updated_at=now() where id=entry.id;
    insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
    values(h.transition_key,'transfer:location_work:'||entry.id,'assignment_transferred',jsonb_build_object('table','ph_location_work_jobs','id',entry.id,'before',prior,'successor',nelly.username)) on conflict(event_key) do nothing;
    changed:=changed+1;
  end loop;
  remaining:=remaining or exists(select 1 from public.ph_location_work_jobs j where j.status in ('open','in_progress')
    and (exists(select 1 from unnest(j.assigned_usernames) v where v is distinct from private.handover_replace_identity_v1(v))
      or exists(select 1 from public.ph_location_work_assignments a where a.job_id=j.id and a.profile_id=h.departing_profile_id)));

  -- Shear row.assignedto is a snapshot, not live routing. Only the open
  -- inquiry's recipient collection is transferred, keeping parallel arrays aligned.
  for entry in select * from public.ph_shear_location_inquiries i where i.status in ('open','in_progress')
    and exists(select 1 from unnest(i.recipient_usernames) v where v is distinct from private.handover_replace_identity_v1(v))
    order by i.id for update skip locked limit greatest(0,cap-changed)
  loop
    select coalesce(jsonb_agg(p order by ordinal),'[]'::jsonb) into profiles from (
      select distinct on (lower(p->>'username')) p,ordinal from (
        select case when private.handover_replace_identity_v1(value->>'username') is distinct from value->>'username'
          then value||jsonb_build_object('profileId',nelly.id,'username',nelly.username,'display',coalesce(nelly.display_name,nelly.username),'email',nelly_email) else value end p,ordinal
        from jsonb_array_elements(entry.recipient_profiles) with ordinality a(value,ordinal)
      ) mapped order by lower(p->>'username'),ordinal
    ) deduped;
    select array_agg(p->>'username' order by ordinal),array_agg(p->>'email' order by ordinal)
      into names,emails from jsonb_array_elements(profiles) with ordinality a(p,ordinal);
    if cardinality(names)=0 or names is null then raise exception using errcode='PT409',message='HANDOVER_SHEAR_RECIPIENTS_INVALID'; end if;
    update public.ph_shear_location_inquiries set recipient_profiles=profiles,recipient_usernames=names,recipient_emails=emails,revision=revision+1,updated_at=now() where id=entry.id;
    insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
    values(h.transition_key,'transfer:shear:'||entry.id,'assignment_transferred',jsonb_build_object('table','ph_shear_location_inquiries','id',entry.id,'before',entry.recipient_usernames,'after',names)) on conflict(event_key) do nothing;
    changed:=changed+1;
  end loop;
  remaining:=remaining or exists(select 1 from public.ph_shear_location_inquiries i where i.status in ('open','in_progress')
    and exists(select 1 from unnest(i.recipient_usernames) v where v is distinct from private.handover_replace_identity_v1(v)));

  -- These are current assignment links, not imported source or delivery history.
  for entry in select a.* from public.ph_master_inventory_user_assignments a
    join public.ph_master_inventory m on m.unique_id=a.master_unique_id
    where m.date_completed is null and m.eval_task_completed_at is null
      and a.assignedto is distinct from private.handover_replace_identity_v1(a.assignedto)
    order by a.master_unique_id,a.assignedto,a.assignment_source
    for update of a skip locked limit greatest(0,cap-changed)
  loop
    insert into public.ph_master_inventory_user_assignments(master_unique_id,assignedto,assignment_source,source_assignedto,itemcode,lotcode,locationcode,source,created_at,updated_at)
    values(entry.master_unique_id,private.handover_replace_identity_v1(entry.assignedto),entry.assignment_source,entry.source_assignedto,
      entry.itemcode,entry.lotcode,entry.locationcode,entry.source,entry.created_at,now())
    on conflict(master_unique_id,assignedto,assignment_source) do nothing;
    delete from public.ph_master_inventory_user_assignments where master_unique_id=entry.master_unique_id
      and assignedto=entry.assignedto and assignment_source=entry.assignment_source;
    insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
    values(h.transition_key,'transfer:inventory_link:'||md5(jsonb_build_array(entry.master_unique_id,entry.assignedto,entry.assignment_source)::text),'assignment_transferred',
      jsonb_build_object('table','ph_master_inventory_user_assignments','id',entry.master_unique_id,'before',entry.assignedto,'after',nelly.username,'assignment_source',entry.assignment_source))
    on conflict(event_key) do nothing;
    changed:=changed+1;
  end loop;
  remaining:=remaining or exists(select 1 from public.ph_master_inventory_user_assignments a
    join public.ph_master_inventory m on m.unique_id=a.master_unique_id
    where m.date_completed is null and m.eval_task_completed_at is null
      and a.assignedto is distinct from private.handover_replace_identity_v1(a.assignedto));

  for entry in select id from bunch_note_private.jobs where status='open' and owner_id=h.departing_profile_id
    order by id for update skip locked limit greatest(0,cap-changed)
  loop
    update bunch_note_private.jobs set owner_id=nelly.id,revision=revision+1,updated_at=now() where id=entry.id;
    insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
    values(h.transition_key,'transfer:bunch_note:'||entry.id,'assignment_transferred',
      jsonb_build_object('table','bunch_note_private.jobs','id',entry.id,'before',h.departing_profile_id,'after',nelly.id)) on conflict(event_key) do nothing;
    changed:=changed+1;
  end loop;
  remaining:=remaining or exists(select 1 from bunch_note_private.jobs where status='open' and owner_id=h.departing_profile_id);
  return jsonb_build_object('changed',changed,'remaining',remaining,'errorCode',null);
end
$$;
revoke all on function private.transfer_remaining_handover_assignments_v1(text,integer) from public,anon,authenticated;
grant execute on function private.transfer_remaining_handover_assignments_v1(text,integer) to service_role;

commit;
