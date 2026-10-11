begin;

-- Keep separate typed targets for dynamic assignment rows and each physical row shape.
-- Preserve the effective lock-order and default-owner guards installed on 2026-10-06.
create or replace function private.transfer_remaining_handover_assignments_v1(p_transition_key text,p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h private.scheduled_account_handover_v1; cfg record; dynamic_row_key text; dynamic_before_values jsonb;
  location_job_id public.ph_location_work_jobs.id%type;
  shear_entry public.ph_shear_location_inquiries%rowtype;
  assignment_entry public.ph_master_inventory_user_assignments%rowtype;
  bunch_job_id bunch_note_private.jobs.id%type; col text;
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
    if cfg.table_name='ph_itemcode_default_owners' then
      perform 1 from public.app_dataset_revisions r where r.key='ph_master_inventory' and r.state='ready' for share;
      if not found or exists(select 1 from app_sync_private.import_leases l where l.key='ph_master_inventory') then
        remaining := true;
        continue;
      end if;
      perform pg_advisory_xact_lock(hashtextextended('gnc-reconcile-eval-itemcodes-v2',0));
    end if;
    for dynamic_row_key,dynamic_before_values in execute format('select r.%I::text row_key,jsonb_build_object(%s) before_values from public.%I r where (%s) and (%s) order by r.%I for update skip locked limit $1',
      cfg.key_name,fields_sql,cfg.table_name,cfg.eligibility,match_sql,cfg.key_name) using greatest(0,cap-changed)
    loop
      if cfg.table_name='ph_itemcode_default_owners' then
        perform set_config('app.scheduled_handover_default_owner','on',true);
      end if;
      execute format('update public.%I r set %s where r.%I::text=$1 returning jsonb_build_object(%s)',cfg.table_name,set_sql,cfg.key_name,fields_sql)
        into after_values using dynamic_row_key;
      if cfg.table_name='ph_itemcode_default_owners' then
        perform set_config('app.scheduled_handover_default_owner','',true);
      end if;
      insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
      values(h.transition_key,'transfer:'||cfg.table_name||':'||dynamic_row_key||':'||md5(dynamic_before_values::text),
        'assignment_transferred',jsonb_build_object('table',cfg.table_name,'id',dynamic_row_key,'before',dynamic_before_values,'after',after_values))
      on conflict(event_key) do nothing;
      changed:=changed+1;
    end loop;
    execute format('select exists(select 1 from public.%I r where (%s) and (%s))',cfg.table_name,cfg.eligibility,match_sql) into found_more;
    remaining:=remaining or found_more;
  end loop;

  -- Location Work assignments are live associations. The immutable line
  -- snapshots and delivery events keep their original author/assignee record.
  for location_job_id in select j.id from public.ph_location_work_jobs j where j.status in ('open','in_progress')
    and (exists(select 1 from unnest(j.assigned_usernames) v where v is distinct from private.handover_replace_identity_v1(v))
      or exists(select 1 from public.ph_location_work_assignments a where a.job_id=j.id and a.profile_id=h.departing_profile_id))
    order by j.id for update skip locked limit greatest(0,cap-changed)
  loop
    select jsonb_build_object('assigned_usernames',assigned_usernames) into prior from public.ph_location_work_jobs where id=location_job_id;
    insert into public.ph_location_work_assignments(job_id,profile_id,username,display_name,email)
      values(location_job_id,nelly.id,nelly.username,coalesce(nelly.display_name,nelly.username),nelly_email) on conflict(job_id,profile_id) do nothing;
    delete from public.ph_location_work_assignments where job_id=location_job_id and profile_id=h.departing_profile_id;
    update public.ph_location_work_jobs j set assigned_usernames=(select array_agg(distinct private.handover_replace_identity_v1(v)) from unnest(j.assigned_usernames||array[nelly.username]) v),
      revision=revision+1,updated_at=now() where id=location_job_id;
    insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
    values(h.transition_key,'transfer:location_work:'||location_job_id,'assignment_transferred',jsonb_build_object('table','ph_location_work_jobs','id',location_job_id,'before',prior,'successor',nelly.username)) on conflict(event_key) do nothing;
    changed:=changed+1;
  end loop;
  remaining:=remaining or exists(select 1 from public.ph_location_work_jobs j where j.status in ('open','in_progress')
    and (exists(select 1 from unnest(j.assigned_usernames) v where v is distinct from private.handover_replace_identity_v1(v))
      or exists(select 1 from public.ph_location_work_assignments a where a.job_id=j.id and a.profile_id=h.departing_profile_id)));

  -- Shear row.assignedto is a snapshot, not live routing. Only the open
  -- inquiry's recipient collection is transferred, keeping parallel arrays aligned.
  for shear_entry in select * from public.ph_shear_location_inquiries i where i.status in ('open','in_progress')
    and exists(select 1 from unnest(i.recipient_usernames) v where v is distinct from private.handover_replace_identity_v1(v))
    order by i.id for update skip locked limit greatest(0,cap-changed)
  loop
    select coalesce(jsonb_agg(p order by ordinal),'[]'::jsonb) into profiles from (
      select distinct on (lower(p->>'username')) p,ordinal from (
        select case when private.handover_replace_identity_v1(value->>'username') is distinct from value->>'username'
          then value||jsonb_build_object('profileId',nelly.id,'username',nelly.username,'display',coalesce(nelly.display_name,nelly.username),'email',nelly_email) else value end p,ordinal
        from jsonb_array_elements(shear_entry.recipient_profiles) with ordinality a(value,ordinal)
      ) mapped order by lower(p->>'username'),ordinal
    ) deduped;
    select array_agg(p->>'username' order by ordinal),array_agg(p->>'email' order by ordinal)
      into names,emails from jsonb_array_elements(profiles) with ordinality a(p,ordinal);
    if cardinality(names)=0 or names is null then raise exception using errcode='PT409',message='HANDOVER_SHEAR_RECIPIENTS_INVALID'; end if;
    update public.ph_shear_location_inquiries set recipient_profiles=profiles,recipient_usernames=names,recipient_emails=emails,revision=revision+1,updated_at=now() where id=shear_entry.id;
    insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
    values(h.transition_key,'transfer:shear:'||shear_entry.id,'assignment_transferred',jsonb_build_object('table','ph_shear_location_inquiries','id',shear_entry.id,'before',shear_entry.recipient_usernames,'after',names)) on conflict(event_key) do nothing;
    changed:=changed+1;
  end loop;
  remaining:=remaining or exists(select 1 from public.ph_shear_location_inquiries i where i.status in ('open','in_progress')
    and exists(select 1 from unnest(i.recipient_usernames) v where v is distinct from private.handover_replace_identity_v1(v)));

  -- These are current assignment links, not imported source or delivery history.
  for assignment_entry in select a.* from public.ph_master_inventory_user_assignments a
    join public.ph_master_inventory m on m.unique_id=a.master_unique_id
    where m.date_completed is null and m.eval_task_completed_at is null
      and a.assignedto is distinct from private.handover_replace_identity_v1(a.assignedto)
    order by a.master_unique_id,a.assignedto,a.assignment_source
    for update of a skip locked limit greatest(0,cap-changed)
  loop
    insert into public.ph_master_inventory_user_assignments(master_unique_id,assignedto,assignment_source,source_assignedto,itemcode,lotcode,locationcode,source,created_at,updated_at)
    values(assignment_entry.master_unique_id,private.handover_replace_identity_v1(assignment_entry.assignedto),assignment_entry.assignment_source,assignment_entry.source_assignedto,
      assignment_entry.itemcode,assignment_entry.lotcode,assignment_entry.locationcode,assignment_entry.source,assignment_entry.created_at,now())
    on conflict(master_unique_id,assignedto,assignment_source) do nothing;
    delete from public.ph_master_inventory_user_assignments where master_unique_id=assignment_entry.master_unique_id
      and assignedto=assignment_entry.assignedto and assignment_source=assignment_entry.assignment_source;
    insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
    values(h.transition_key,'transfer:inventory_link:'||md5(jsonb_build_array(assignment_entry.master_unique_id,assignment_entry.assignedto,assignment_entry.assignment_source)::text),'assignment_transferred',
      jsonb_build_object('table','ph_master_inventory_user_assignments','id',assignment_entry.master_unique_id,'before',assignment_entry.assignedto,'after',nelly.username,'assignment_source',assignment_entry.assignment_source))
    on conflict(event_key) do nothing;
    changed:=changed+1;
  end loop;
  remaining:=remaining or exists(select 1 from public.ph_master_inventory_user_assignments a
    join public.ph_master_inventory m on m.unique_id=a.master_unique_id
    where m.date_completed is null and m.eval_task_completed_at is null
      and a.assignedto is distinct from private.handover_replace_identity_v1(a.assignedto));

  for bunch_job_id in select id from bunch_note_private.jobs where status='open' and owner_id=h.departing_profile_id
    order by id for update skip locked limit greatest(0,cap-changed)
  loop
    update bunch_note_private.jobs set owner_id=nelly.id,revision=revision+1,updated_at=now() where id=bunch_job_id;
    insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
    values(h.transition_key,'transfer:bunch_note:'||bunch_job_id,'assignment_transferred',
      jsonb_build_object('table','bunch_note_private.jobs','id',bunch_job_id,'before',h.departing_profile_id,'after',nelly.id)) on conflict(event_key) do nothing;
    changed:=changed+1;
  end loop;
  remaining:=remaining or exists(select 1 from bunch_note_private.jobs where status='open' and owner_id=h.departing_profile_id);
  return jsonb_build_object('changed',changed,'remaining',remaining,'errorCode',null);
end
$$;
revoke all on function private.transfer_remaining_handover_assignments_v1(text,integer) from public,anon,authenticated;
grant execute on function private.transfer_remaining_handover_assignments_v1(text,integer) to service_role;

commit;
