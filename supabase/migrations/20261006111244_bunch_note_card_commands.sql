begin;

create function bunch_note_private.card_allowed(p_actor uuid,p_job bunch_note_private.jobs,p_card uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from bunch_note_private.bunch_notes n
  join bunch_note_private.bunch_note_work_cards wc on wc.bunch_note_id=n.id
  where n.job_id=(p_job).id and wc.card_id=p_card and wc.active
   and ((select p.username from public.profiles p where p.id=p_actor)='dylan_collyge'
    or wc.owner_id=p_actor
    or (wc.owner_id is null and wc.status='open' and (p_job).status='open')))
$$;

create function bunch_note_private.card_actions(p_job bunch_note_private.jobs) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a jsonb; output jsonb:='[]'; note_id uuid; target uuid;
begin
 select n.id into note_id from bunch_note_private.bunch_notes n where n.job_id=(p_job).id;
 for a in select value from jsonb_array_elements(bunch_note_private.actions(p_job)) loop
  if nullif(a->>'card_id','') is null then
   target:=null;
   if a->>'scope'='rows' then
    select wc.card_id into target from bunch_note_private.bunch_note_work_cards wc
     where wc.bunch_note_id=note_id and wc.active and wc.kind='inventory' and wc.row_ids @> coalesce(a->'row_ids','[]'::jsonb)
      and (select count(*) from jsonb_array_elements_text(a->'row_ids'))>0 limit 1;
   end if;
   if target is null then select wc.card_id into target from bunch_note_private.bunch_note_work_cards wc
     where wc.bunch_note_id=note_id and wc.active and wc.kind='shared' limit 1; end if;
   if target is not null then a:=a||jsonb_build_object('card_id',target); end if;
  end if;
  output:=output||jsonb_build_array(a);
 end loop;
 for a in select w.action from bunch_note_private.worker_actions w where w.job_id=(p_job).id order by w.created_at,w.id loop
  if nullif(a->>'card_id','') is null then
   target:=null;
   if a->>'scope'='rows' then
    select wc.card_id into target from bunch_note_private.bunch_note_work_cards wc
     where wc.bunch_note_id=note_id and wc.active and wc.kind='inventory' and wc.row_ids @> coalesce(a->'row_ids','[]'::jsonb)
      and (select count(*) from jsonb_array_elements_text(a->'row_ids'))>0 limit 1;
   end if;
   if target is null then select wc.card_id into target from bunch_note_private.bunch_note_work_cards wc
     where wc.bunch_note_id=note_id and wc.active and wc.kind='shared' limit 1; end if;
   if target is not null then a:=a||jsonb_build_object('card_id',target); end if;
  end if;
  output:=output||jsonb_build_array(a);
 end loop;
 return output;
end $$;

create function bunch_note_private.card_safe_job(p_job bunch_note_private.jobs,p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare author boolean; note_id uuid; cards jsonb:='[]'; definitions jsonb:='[]'; actions jsonb:='[]'; all_actions jsonb:='[]'; source jsonb:='[]'; progress_json jsonb:='{}';
 worker_actions_json jsonb:='[]'; actuals_json jsonb:='[]'; audit_json jsonb:='[]'; card_ids uuid[]:='{}'; action_ids text[]:='{}'; row_ids text[]:='{}';
 c record; a jsonb; entry_row record; base jsonb; body_json jsonb; card_value jsonb; current_owner uuid; shared_id uuid;
begin
 author:=exists(select 1 from public.profiles p where p.id=p_actor and p.username='dylan_collyge');
 select n.id into note_id from bunch_note_private.bunch_notes n where n.job_id=(p_job).id;
 if note_id is null then
  if coalesce(((p_job).body->>'format_version')::integer,0)>=5 then raise exception 'BUNCH_NOTE_CARD_STATE_INVALID' using errcode='42501'; end if;
  return bunch_note_private.job_json(p_job);
 end if;
 select wc.card_id into shared_id from bunch_note_private.bunch_note_work_cards wc where wc.bunch_note_id=note_id and wc.kind='shared' and wc.active limit 1;
 for c in select wc.*,p.display_name owner_name from bunch_note_private.bunch_note_work_cards wc
  left join public.profiles p on p.id=wc.owner_id
  where wc.bunch_note_id=note_id and (wc.active or (author and (p_job).status='cancelled'))
   and (author or wc.owner_id=p_actor or (wc.owner_id is null and wc.status='open' and (p_job).status='open'))
  order by wc.kind,wc.location_code,wc.commonname,wc.itemcode,wc.contsize,wc.card_id loop
  card_ids:=array_append(card_ids,c.card_id);
  row_ids:=row_ids||array(select jsonb_array_elements_text(c.row_ids));
  select value into card_value from jsonb_array_elements(coalesce((p_job).body->'cards','[]')) where value->>'id'=c.card_id::text;
  cards:=cards||jsonb_build_array(coalesce(card_value,'{}'::jsonb)||jsonb_build_object(
   'id',c.card_id,'kind',c.kind,'location_code',c.location_code,'itemcode',c.itemcode,'commonname',c.commonname,
   'contsize',c.contsize,'row_ids',c.row_ids,'owner_id',c.owner_id,'owner_name',c.owner_name,'house',c.house,'direction',c.direction,
   'status',c.status,'revision',c.revision));
 end loop;
 if not author and cardinality(card_ids)=0 then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
 select coalesce(jsonb_agg(a order by ord),'[]') into all_actions from (
  select value a,ordinality ord from jsonb_array_elements(bunch_note_private.card_actions(p_job)) with ordinality
 ) q where author or a->>'card_id'=any(array(select unnest(card_ids)::text));
  select coalesce(jsonb_agg(a order by ord),'[]') into actions from (
   select value a,ordinality ord from jsonb_array_elements(all_actions) with ordinality
  ) q where not coalesce((a->>'worker_added')::boolean,false);
 select coalesce(array_agg(a->>'id'),'{}') into action_ids from jsonb_array_elements(all_actions) a;
 select coalesce(jsonb_agg(d.value order by d.ordinality),'[]') into definitions from jsonb_array_elements(coalesce((p_job).body->'cards','[]')) with ordinality d(value,ordinality)
  where author or d.value->>'id'=any(array(select unnest(card_ids)::text));
 select coalesce(jsonb_agg(r order by r->>'unique_id'),'[]') into source from jsonb_array_elements(bunch_note_private.work_source(p_job)) r
  where author or (r->>'unique_id')=any(row_ids);
 for entry_row in select key,value from jsonb_each(coalesce((p_job).progress,'{}')) loop
  if author or entry_row.key=any(action_ids) then progress_json:=progress_json||jsonb_build_object(entry_row.key,entry_row.value); end if;
 end loop;
 select coalesce(jsonb_agg(case when nullif(w.action->>'card_id','') is null and mapped.action is not null
   then w.action||jsonb_build_object('card_id',mapped.action->'card_id') else w.action end order by w.created_at,w.id),'[]') into worker_actions_json
  from bunch_note_private.worker_actions w
  left join lateral (select value action from jsonb_array_elements(bunch_note_private.card_actions(p_job)) value where value->>'id'=w.action->>'id' limit 1) mapped on true
  where w.job_id=(p_job).id and (author or (w.action->>'id'=any(action_ids)));
 select coalesce(jsonb_agg(to_jsonb(h)||jsonb_build_object('superseded',exists(select 1 from bunch_note_private.actuals newer where newer.replaces_id=h.id)) order by h.created_at,h.id),'[]') into actuals_json
  from bunch_note_private.actuals h where h.job_id=(p_job).id and (author or h.action_id=any(action_ids)
   or h.action_snapshot->>'card_id'=any(array(select unnest(card_ids)::text))
   or (h.action_snapshot->>'scope'='rows' and exists(select 1 from unnest(card_ids) ac join bunch_note_private.bunch_note_work_cards wc on wc.bunch_note_id=note_id and wc.card_id=ac
    where wc.row_ids @> coalesce(h.action_snapshot->'row_ids','[]'::jsonb))));
 body_json:=((p_job).body-'source_all')||jsonb_build_object('cards',definitions,'actions',actions,'source',source,
  'row_ids',to_jsonb(row_ids));
  base:=to_jsonb(p_job)||jsonb_build_object('body',body_json,'cards',cards,'worker_actions',worker_actions_json,'actuals',actuals_json,'progress',progress_json,
   'delivery_status',coalesce((select p.delivery_status from bunch_note_private.versions v join bunch_note_private.previews p on p.id=v.preview_id
    where v.job_id=(p_job).id order by v.instruction_revision desc limit 1),'not_sent'));
 if author then
  select coalesce(jsonb_agg(to_jsonb(au) order by au.id),'[]') into audit_json from bunch_note_private.audit au where au.job_id=(p_job).id;
  return base||jsonb_build_object('audit',audit_json,'versions',(select coalesce(jsonb_agg(jsonb_build_object(
   'instruction_revision',v.instruction_revision,'delivery_status',p.delivery_status,'preview_id',p.id)
   order by v.instruction_revision desc),'[]') from bunch_note_private.versions v join bunch_note_private.previews p on p.id=v.preview_id where v.job_id=(p_job).id),
   'work_reports',(select coalesce(jsonb_agg(jsonb_build_object('preview_id',p.id,'job_revision',p.job_revision,'delivery_status',p.delivery_status) order by p.created_at desc),'[]')
    from bunch_note_private.previews p where p.job_id=(p_job).id and p.report_kind='completed_work' and p.published));
 end if;
 return base;
end $$;

create function bunch_note_private.guard_card_job_write() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and coalesce((old.body->>'format_version')::integer,0)>=5
  and (new.owner_id is distinct from old.owner_id or new.status is distinct from old.status or new.progress is distinct from old.progress)
  and coalesce(current_setting('bunch_note.card_command',true),'')<>'on' then
  raise exception 'BUNCH_NOTE_CARD_COMMAND_REQUIRED';
 end if;
 if tg_op='UPDATE' and coalesce((old.body->>'format_version')::integer,0)>=5 and new.status='complete'
  and exists(select 1 from bunch_note_private.bunch_notes n join bunch_note_private.bunch_note_work_cards wc on wc.bunch_note_id=n.id
   where n.job_id=old.id and wc.active and wc.status<>'complete') then raise exception 'BUNCH_NOTE_CARDS_INCOMPLETE'; end if;
 if tg_op='INSERT' and coalesce((new.body->>'format_version')::integer,0)>=5 then new.owner_id:=null; end if;
 return new;
end $$;
create trigger bunch_note_job_card_write_guard before insert or update of owner_id,status,progress on bunch_note_private.jobs
 for each row execute function bunch_note_private.guard_card_job_write();

create function bunch_note_private.guard_card_ledger_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare jid uuid; is_card boolean;
begin
 jid:=case when tg_table_name='worker_actions' then new.job_id else new.job_id end;
 select coalesce((j.body->>'format_version')::integer,0)>=5 into is_card from bunch_note_private.jobs j where j.id=jid;
 if is_card and coalesce(current_setting('bunch_note.card_command',true),'')<>'on' then raise exception 'BUNCH_NOTE_CARD_COMMAND_REQUIRED'; end if;
 return new;
end $$;
create trigger bunch_note_worker_card_write_guard before insert or update on bunch_note_private.worker_actions
 for each row execute function bunch_note_private.guard_card_ledger_write();
create trigger bunch_note_actual_card_write_guard before insert or update on bunch_note_private.actuals
 for each row execute function bunch_note_private.guard_card_ledger_write();

create function bunch_note_private.card_destination_view(p_actor public.profiles,p_location text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare j bunch_note_private.jobs; item jsonb; act jsonb; actual jsonb; safe jsonb; locs text[]; dest text:=nullif(upper(btrim(p_location)),'');
 jobs_json jsonb:='[]'; incoming jsonb:='[]'; matching_actuals jsonb; targets jsonb; planned text;
begin
 select array_agg(distinct upper(btrim(locationcode))) into locs from public.ph_master_inventory where nullif(btrim(locationcode),'') is not null;
 for j in select job.* from bunch_note_private.jobs job
  where (coalesce((job.body->>'format_version')::integer,0)>=5 and exists(
    select 1 from bunch_note_private.bunch_notes n join bunch_note_private.bunch_note_work_cards wc on wc.bunch_note_id=n.id
    where n.job_id=job.id and (p_actor.username='dylan_collyge' or (wc.active and (wc.owner_id=p_actor.id or (wc.owner_id is null and wc.status='open' and job.status='open'))))))
   or (coalesce((job.body->>'format_version')::integer,0)<5 and bunch_note_private.can_read(p_actor,job))
 loop
  safe:=case when coalesce((j.body->>'format_version')::integer,0)>=5 then bunch_note_private.card_safe_job(j,p_actor.id) else bunch_note_private.job_json(j) end;
  locs:=array_append(locs,upper(btrim(j.location)));
  if dest is not null and upper(btrim(j.location))=dest then jobs_json:=jobs_json||jsonb_build_array(safe); end if;
  for act in select value from (
   select value from jsonb_array_elements(coalesce(safe->'body'->'actions','[]'))
   union all select value from jsonb_array_elements(coalesce(safe->'worker_actions','[]'))
  ) all_actions loop
   if bunch_note_private.action_kind(act) not in ('move','hauling') then continue; end if;
   planned:=nullif(upper(btrim(act->>'destination')),'');
   if planned is not null then locs:=array_append(locs,planned); end if;
   select coalesce(jsonb_agg(v),'[]') into matching_actuals from jsonb_array_elements(coalesce(safe->'actuals','[]')) v
    where v->>'action_id'=act->>'id' and not coalesce((v->>'superseded')::boolean,false) and upper(btrim(v->>'destination'))=dest;
   if dest is not null and (planned=dest or jsonb_array_length(matching_actuals)>0) then
    select coalesce(jsonb_agg(r),'[]') into targets from jsonb_array_elements(coalesce(safe->'body'->'source','[]')) r
     where act->>'scope'='location' or act->'row_ids' ? (r->>'unique_id');
    incoming:=incoming||jsonb_build_array(jsonb_build_object('job_id',j.id,'note_number',j.note_number,'source_location',j.location,
     'status',j.status,'action',act,'source',targets,'planned_here',planned=dest,'actuals',matching_actuals,'card_id',act->'card_id'));
   end if;
  end loop;
  for actual in select value from jsonb_array_elements(coalesce(safe->'actuals','[]')) v where not coalesce((v->>'superseded')::boolean,false) loop
   if nullif(btrim(actual->>'destination'),'') is not null then locs:=array_append(locs,upper(btrim(actual->>'destination'))); end if;
   if dest is not null and upper(btrim(actual->>'destination'))=dest and not exists(
    select 1 from (select value from jsonb_array_elements(coalesce(safe->'body'->'actions','[]'))
     union all select value from jsonb_array_elements(coalesce(safe->'worker_actions','[]'))) actions_union where actions_union.value->>'id'=actual->>'action_id') then
    incoming:=incoming||jsonb_build_array(jsonb_build_object('job_id',j.id,'note_number',j.note_number,'source_location',j.location,
     'status',j.status,'action',actual->'action_snapshot','source',jsonb_build_array(actual->'source_snapshot'),'planned_here',false,'actuals',jsonb_build_array(actual),
     'card_id',actual->'action_snapshot'->'card_id'));
   end if;
  end loop;
 end loop;
 return jsonb_build_object('locations',(select coalesce(jsonb_agg(v order by v),'[]') from (select distinct unnest(locs) v) q),
  'location',dest,'jobs',jobs_json,'incoming',incoming);
end $$;

create function bunch_note_private.card_command(p_actor uuid,p_operation text,p_payload jsonb default '{}'::jsonb,
 p_command_id uuid default null,p_expected_revision bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; author boolean; job bunch_note_private.jobs; prior bunch_note_private.commands;
 card bunch_note_private.bunch_note_work_cards; note_id uuid; request jsonb; result jsonb; action jsonb; source_row jsonb;
  v_card_id uuid; v_action_id text; option_value bunch_note_private.options; state text; reason text; flags jsonb; owner uuid; command_job uuid;
begin
 actor:=bunch_note_private.actor(p_actor); author:=actor.username='dylan_collyge';
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2000000 then raise exception 'BUNCH_NOTE_PAYLOAD_INVALID'; end if;
 if p_operation='list' then
   return jsonb_build_object('jobs',(select coalesce(jsonb_agg((case when coalesce((j.body->>'format_version')::integer,0)>=5
     then bunch_note_private.card_safe_job(j,actor.id) else bunch_note_private.job_json(j) end)||jsonb_build_object('delivery_status',
      coalesce((select p.delivery_status from bunch_note_private.versions v join bunch_note_private.previews p on p.id=v.preview_id
       where v.job_id=j.id order by v.instruction_revision desc limit 1),'not_sent')) order by j.updated_at desc),'[]')
   from bunch_note_private.jobs j where (coalesce((j.body->>'format_version')::integer,0)>=5 and exists(
    select 1 from bunch_note_private.bunch_notes n join bunch_note_private.bunch_note_work_cards wc on wc.bunch_note_id=n.id
    where n.job_id=j.id and (author or (wc.active and (wc.owner_id=actor.id or (wc.owner_id is null and wc.status='open' and j.status='open'))))))
    or (coalesce((j.body->>'format_version')::integer,0)<5 and bunch_note_private.can_read(actor,j))));
 elsif p_operation in ('get','pdf') then
  select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid;
  if not found then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  if coalesce((job.body->>'format_version')::integer,0)>=5 then
   if p_operation='pdf' then
    if not author then raise exception 'BUNCH_NOTE_AUTHOR_ONLY' using errcode='42501'; end if;
    if not exists(select 1 from bunch_note_private.versions v join bunch_note_private.previews p on p.id=v.preview_id
     where v.job_id=job.id and v.instruction_revision=coalesce((p_payload->>'instruction_revision')::integer,job.instruction_revision)) then raise exception 'BUNCH_NOTE_NOT_FOUND'; end if;
    return bunch_note_private.bunch_note_command_legacy(p_actor,'pdf',p_payload,null,null);
   end if;
   result:=bunch_note_private.card_safe_job(job,actor.id);
   if author then return jsonb_build_object('job',result-'audit'-'versions'-'work_reports','versions',result->'versions','work_reports',result->'work_reports','audit',result->'audit'); end if;
   return jsonb_build_object('job',result);
  end if;
  return bunch_note_private.bunch_note_command_legacy(p_actor,p_operation,p_payload,null,null);
 elsif p_operation in ('destinations','destination_detail') then
  return bunch_note_private.card_destination_view(actor,case when p_operation='destination_detail' then p_payload->>'location' else null end);
 elsif p_operation='work_pdf' then
  select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid;
  if not found then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  if coalesce((job.body->>'format_version')::integer,0)>=5 and not author then raise exception 'BUNCH_NOTE_AUTHOR_ONLY' using errcode='42501'; end if;
  return bunch_note_private.bunch_note_command_legacy(p_actor,p_operation,p_payload,p_command_id,p_expected_revision);
 elsif p_operation='destination_lookup' then
  if not author then
   v_card_id:=nullif(p_payload->>'card_id','')::uuid;
   select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid;
   if not found then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
   if coalesce((job.body->>'format_version')::integer,0)>=5 then
    if v_card_id is null or not bunch_note_private.card_allowed(actor.id,job,v_card_id) then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
   elsif not bunch_note_private.can_read(actor,job) then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
   if coalesce((job.body->>'format_version')::integer,0)>=5 then
    select n.id into note_id from bunch_note_private.bunch_notes n where n.job_id=job.id;
    select * into card from bunch_note_private.bunch_note_work_cards wc where wc.bunch_note_id=note_id and wc.card_id=v_card_id and wc.active;
    if exists(select 1 from jsonb_array_elements_text(coalesce(p_payload->'source_ids','[]')) sid where not(card.row_ids ? sid)) then raise exception 'BUNCH_NOTE_CARD_SOURCE_INVALID'; end if;
   end if;
  end if;
  return bunch_note_private.destination_lookup(actor,p_payload);
 end if;
 if p_operation not in ('assign_card','claim_card','release_card','complete_card','progress','actual','add_action','option_add','cancel') then
  raise exception 'BUNCH_NOTE_OPERATION_INVALID';
 end if;
 if p_command_id is null then raise exception 'BUNCH_NOTE_COMMAND_REQUIRED'; end if;
 request:=jsonb_build_object('operation',p_operation,'payload',p_payload,'revision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
 select * into prior from bunch_note_private.commands where id=p_command_id;
 if found then
  if prior.actor_id<>actor.id or prior.request<>request then raise exception 'BUNCH_NOTE_COMMAND_CONFLICT'; end if;
  if prior.response ? 'job' then
   command_job:=(prior.response->'job'->>'id')::uuid;
   select * into job from bunch_note_private.jobs where id=command_job;
   if not found then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
   if coalesce((job.body->>'format_version')::integer,0)>=5 then result:=bunch_note_private.card_safe_job(job,actor.id);
    return jsonb_set(prior.response,'{job}',result,false); end if;
  end if;
  return prior.response;
 end if;
 if p_operation='cancel' then
  select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid for update;
  if not found then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  if coalesce((job.body->>'format_version')::integer,0)<5 then
   return bunch_note_private.bunch_note_command_legacy(p_actor,p_operation,p_payload,p_command_id,p_expected_revision);
  end if;
  if not author or nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'BUNCH_NOTE_AUTHOR_ONLY' using errcode='42501'; end if;
  if job.revision is distinct from p_expected_revision or job.status<>'open' then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
  perform set_config('bunch_note.card_command','on',true);
  update bunch_note_private.bunch_note_work_cards wc set status='retired',active=false,revision=revision+1,updated_at=now()
   from bunch_note_private.bunch_notes n where n.job_id=job.id and wc.bunch_note_id=n.id and wc.active;
  update bunch_note_private.jobs set status='cancelled',revision=revision+1,updated_at=now() where id=job.id returning * into job;
  insert into bunch_note_private.audit(job_id,actor_id,operation,detail) values(job.id,actor.id,p_operation,p_payload||jsonb_build_object('job_revision',job.revision));
  result:=jsonb_build_object('job',bunch_note_private.card_safe_job(job,actor.id));
 else
  v_card_id:=nullif(p_payload->>'card_id','')::uuid;
  select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid for update;
  if not found or coalesce((job.body->>'format_version')::integer,0)<5 then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  select n.id into note_id from bunch_note_private.bunch_notes n where n.job_id=job.id;
  select * into card from bunch_note_private.bunch_note_work_cards wc where wc.bunch_note_id=note_id and wc.card_id=v_card_id and wc.active for update;
  if not found or v_card_id is null or job.revision is null then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  if p_expected_revision is distinct from card.revision then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
  if p_operation='assign_card' then
   if not author or job.status<>'open' or card.status<>'open' then raise exception 'BUNCH_NOTE_AUTHOR_ONLY' using errcode='42501'; end if;
   owner:=nullif(p_payload->>'owner_id','')::uuid;
   if not bunch_note_private.active_card_owner(owner) then raise exception 'BUNCH_NOTE_CARD_OWNER_INVALID'; end if;
   update bunch_note_private.bunch_note_work_cards set owner_id=owner,revision=revision+1,updated_at=now() where bunch_note_id=note_id and card_id=v_card_id returning * into card;
  elsif p_operation='claim_card' then
   if job.status<>'open' or card.status<>'open' or card.owner_id is not null then raise exception 'BUNCH_NOTE_ALREADY_CLAIMED'; end if;
   update bunch_note_private.bunch_note_work_cards set owner_id=actor.id,revision=revision+1,updated_at=now() where bunch_note_id=note_id and card_id=v_card_id returning * into card;
  elsif p_operation='release_card' then
   if job.status<>'open' or card.status<>'open' or (card.owner_id is distinct from actor.id and not author) then raise exception 'BUNCH_NOTE_OWNER_ONLY' using errcode='42501'; end if;
   update bunch_note_private.bunch_note_work_cards set owner_id=null,revision=revision+1,updated_at=now() where bunch_note_id=note_id and card_id=v_card_id returning * into card;
  else
   if card.owner_id is distinct from actor.id and not (author and p_operation='actual' and nullif(p_payload->>'replaces_id','') is not null) then raise exception 'BUNCH_NOTE_OWNER_ONLY' using errcode='42501'; end if;
   if job.status<>'open' and not (author and p_operation='actual' and nullif(p_payload->>'replaces_id','') is not null) then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
   if card.status<>'open' and not (author and p_operation='actual' and nullif(p_payload->>'replaces_id','') is not null) then raise exception 'BUNCH_NOTE_CARD_COMPLETE'; end if;
   perform set_config('bunch_note.card_command','on',true);
   if p_operation='progress' then
    if card.status<>'open' then raise exception 'BUNCH_NOTE_CARD_COMPLETE'; end if;
    state:=p_payload->>'status'; reason:=nullif(btrim(p_payload->>'reason'),'');
    if state not in ('done','not_needed') or state is null then raise exception 'BUNCH_NOTE_PROGRESS_INVALID'; end if;
   select a into action from jsonb_array_elements(bunch_note_private.card_actions(job)) a where a->>'id'=p_payload->>'action_id';
    if action is null or action->>'card_id' is distinct from v_card_id::text then raise exception 'BUNCH_NOTE_ACTION_CARD_INVALID'; end if;
    if state='not_needed' and reason is null then raise exception 'BUNCH_NOTE_REASON_REQUIRED'; end if;
    flags:='[]'; if state='done' then flags:=bunch_note_private.check_done(job,action,reason); end if;
    update bunch_note_private.jobs set progress=progress||jsonb_build_object(action->>'id',jsonb_build_object('status',state,'reason',reason,
     'review_flags',flags,'actor_id',actor.id,'at',now())) where id=job.id;
   elsif p_operation='actual' then
   select a into action from jsonb_array_elements(bunch_note_private.card_actions(job)) a where a->>'id'=p_payload->>'action_id';
     if action is null or action->>'card_id' is distinct from v_card_id::text then raise exception 'BUNCH_NOTE_ACTION_CARD_INVALID'; end if;
    if not(card.row_ids ? (p_payload->>'source_id')) then raise exception 'BUNCH_NOTE_CARD_SOURCE_INVALID'; end if;
    select r into source_row from jsonb_array_elements(bunch_note_private.work_source(job)) r where r->>'unique_id'=p_payload->>'source_id';
    if source_row is null then raise exception 'BUNCH_NOTE_CARD_SOURCE_INVALID'; end if;
    v_action_id:=action->>'id';
    if exists(select 1 from bunch_note_private.worker_actions w where w.job_id=job.id and w.action->>'id'=v_action_id and nullif(w.action->>'card_id','') is null) then
     update bunch_note_private.worker_actions wa set action=wa.action||jsonb_build_object('card_id',v_card_id)
      where wa.job_id=job.id and wa.action->>'id'=v_action_id;
   end if;
    perform bunch_note_private.validate_destination(p_payload||jsonb_build_object('scope','location'),jsonb_build_array(source_row));
    perform bunch_note_private.record_actual(job,p_payload,actor.id);
   elsif p_operation='add_action' then
    if jsonb_array_length(bunch_note_private.actions(job))>=200 then raise exception 'BUNCH_NOTE_ACTION_LIMIT'; end if;
    action:=p_payload->'action';
     if action is null or action->>'card_id' is distinct from v_card_id::text then raise exception 'BUNCH_NOTE_ACTION_CARD_INVALID'; end if;
    if nullif(action->>'option_id','') is null then raise exception 'BUNCH_NOTE_OPTION_REQUIRED'; end if;
    if action->>'scope'='location' and not coalesce((action->>'freeform')::boolean,false) then
     action:=action||jsonb_build_object('scope','rows','row_ids',card.row_ids);
    end if;
    action:=(bunch_note_private.structured_note(job.body||jsonb_build_object('source',bunch_note_private.work_source(job),'actions',jsonb_build_array(action)))->'actions')->0;
    if exists(select 1 from jsonb_array_elements(bunch_note_private.actions(job)) a where a->>'id'=action->>'id')
     or exists(select 1 from bunch_note_private.actuals a where a.job_id=job.id and a.action_id=action->>'id') then raise exception 'BUNCH_NOTE_ACTION_ID_REUSED'; end if;
    if action->>'scope'='rows' and not(card.row_ids @> action->'row_ids') then raise exception 'BUNCH_NOTE_ACTION_CARD_ROWS_INVALID'; end if;
    action:=bunch_note_private.validate_action(action,(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(bunch_note_private.work_source(job)) r where card.row_ids ? (r->>'unique_id')));
    perform bunch_note_private.validate_destination(action,bunch_note_private.work_source(job));
    action:=(action-'quantity'-'percentage')||jsonb_build_object('card_id',v_card_id,'worker_added',true,'actor_id',actor.id,'created_at',now(),
     'destination',upper(btrim(coalesce(action->>'destination',''))),'source_snapshot',(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(bunch_note_private.work_source(job)) r where card.row_ids ? (r->>'unique_id')));
    insert into bunch_note_private.worker_actions(job_id,action,actor_id) values(job.id,action,actor.id);
   elsif p_operation='option_add' then
    insert into bunch_note_private.options(category,label,kind,created_by) values(p_payload->>'category',btrim(p_payload->>'label'),p_payload->>'kind',actor.id) returning * into option_value;
   end if;
   if p_operation='complete_card' then
    if card.owner_id is distinct from actor.id or job.status<>'open' or card.status<>'open' then raise exception 'BUNCH_NOTE_OWNER_ONLY' using errcode='42501'; end if;
    if exists(select 1 from jsonb_array_elements(bunch_note_private.card_actions(job)) a where a->>'card_id'=v_card_id::text and not(job.progress ? (a->>'id'))) then raise exception 'BUNCH_NOTE_UNRESOLVED_ACTIONS'; end if;
    update bunch_note_private.bunch_note_work_cards set status='complete',revision=revision+1,updated_at=now() where bunch_note_id=note_id and card_id=v_card_id returning * into card;
   else
    update bunch_note_private.bunch_note_work_cards set revision=revision+1,updated_at=now(),
     status=case when p_operation='actual' and job.status='open' then 'open' else status end where bunch_note_id=note_id and card_id=v_card_id returning * into card;
   end if;
  end if;
  update bunch_note_private.jobs set revision=revision+1,updated_at=now() where id=job.id;
  if p_operation='complete_card' and not exists(select 1 from bunch_note_private.bunch_note_work_cards wc where wc.bunch_note_id=note_id and wc.active and wc.status<>'complete') then
   update bunch_note_private.jobs set status='complete',revision=revision+1,updated_at=now() where id=job.id;
  end if;
  select * into job from bunch_note_private.jobs where id=job.id;
  insert into bunch_note_private.audit(job_id,actor_id,operation,detail) values(job.id,actor.id,p_operation,
   p_payload||jsonb_build_object('card_id',v_card_id,'card_revision',card.revision,'job_revision',job.revision));
  result:=jsonb_build_object('job',bunch_note_private.card_safe_job(job,actor.id));
  if p_operation='option_add' then result:=result||jsonb_build_object('option',to_jsonb(option_value)); end if;
 end if;
 insert into bunch_note_private.commands(id,actor_id,request,response) values(p_command_id,actor.id,request,result);
 return result;
end $$;

create function bunch_note_private.invoke_card_command(p_actor uuid,p_operation text,p_payload jsonb,p_command uuid,p_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old_mode text; result jsonb;
begin
 old_mode:=coalesce(current_setting('bunch_note.card_command',true),'');
 result:=bunch_note_private.card_command(p_actor,p_operation,p_payload,p_command,p_revision);
 perform set_config('bunch_note.card_command',old_mode,true);
 return result;
end $$;

create function public.bunch_note_card_command_v1(p_actor_id uuid,p_operation text,p_payload jsonb default '{}'::jsonb,
 p_command_id uuid default null,p_expected_revision bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 return bunch_note_private.invoke_card_command(p_actor_id,p_operation,p_payload,p_command_id,p_expected_revision);
end
$$;

create or replace function bunch_note_private.require_ready(entry jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare a jsonb; card_aware boolean;
begin
 card_aware:=coalesce((entry->>'format_version')::integer,0)>=5;
 if nullif(btrim(entry->>'purposes'),'') is null or jsonb_typeof(entry->'actions') is distinct from 'array'
  or jsonb_array_length(entry->'actions')>200 or (not card_aware and jsonb_array_length(entry->'actions')=0) then
  raise exception 'BUNCH_NOTE_INSTRUCTIONS_REQUIRED';
 end if;
 if card_aware and (jsonb_typeof(entry->'cards') is distinct from 'array' or jsonb_array_length(entry->'cards')=0) then
  raise exception 'BUNCH_NOTE_CARDS_REQUIRED';
 end if;
 for a in select value from jsonb_array_elements(entry->'actions') loop
  if nullif(btrim(a->>'instructions'),'') is null then raise exception 'BUNCH_NOTE_INSTRUCTIONS_REQUIRED'; end if;
  if bunch_note_private.action_kind(a) in ('move','hauling') and nullif(btrim(a->>'destination'),'') is null then
   raise exception 'BUNCH_NOTE_DESTINATION_REQUIRED';
  end if;
 end loop;
end $$;

create function bunch_note_private.enrich_preview_cards() returns trigger
language plpgsql security definer set search_path='' as $$
declare report jsonb; reports jsonb; card jsonb; cards jsonb; card_row record; header_id uuid; idx bigint;
begin
 if jsonb_typeof(new.reports) is distinct from 'array' then return new; end if;
 reports:=new.reports;
 for report in select value from jsonb_array_elements(reports) loop
  if jsonb_typeof(report->'cards') is distinct from 'array' then continue; end if;
  report:=report||jsonb_build_object('format_version',5);
  select n.id into header_id from bunch_note_private.bunch_notes n
   where n.job_id=nullif(report->>'job_id','')::uuid and n.job_id is not null;
  if header_id is null then select n.id into header_id from bunch_note_private.bunch_notes n
    where n.batch_id=new.batch_id and n.location_code=upper(btrim(report->>'location')); end if;
  if header_id is null then raise exception 'BUNCH_NOTE_CARD_STATE_INVALID'; end if;
  cards:='[]';
  for card in select value from jsonb_array_elements(report->'cards') loop
   select wc.owner_id,p.display_name into card_row from bunch_note_private.bunch_note_work_cards wc
    left join public.profiles p on p.id=wc.owner_id where wc.bunch_note_id=header_id and wc.card_id=(card->>'id')::uuid;
   if not found then raise exception 'BUNCH_NOTE_CARD_STATE_INVALID'; end if;
   cards:=cards||jsonb_build_array(card||jsonb_build_object('owner_id',card_row.owner_id,'owner_name',card_row.display_name));
  end loop;
  select ordinality into idx from jsonb_array_elements(reports) with ordinality where value->>'location'=report->>'location' limit 1;
  reports:=jsonb_set(reports,array[(idx-1)::text],report||jsonb_build_object('cards',cards,'format_version',5),false);
 end loop;
 new.reports:=reports;
 return new;
end $$;
create trigger bunch_note_preview_card_owner_names before insert or update of reports on bunch_note_private.previews
 for each row execute function bunch_note_private.enrich_preview_cards();

revoke all on function bunch_note_private.active_card_owner(uuid),bunch_note_private.card_key(jsonb),
 bunch_note_private.normalize_work_cards(jsonb,jsonb),bunch_note_private.sync_work_cards(),bunch_note_private.mirror_work_cards(),
 bunch_note_private.normalize_card_actions(jsonb,jsonb,jsonb),bunch_note_private.card_instruction_snapshot(jsonb,uuid),
 bunch_note_private.card_allowed(uuid,bunch_note_private.jobs,uuid),bunch_note_private.card_actions(bunch_note_private.jobs),bunch_note_private.card_safe_job(bunch_note_private.jobs,uuid),
 bunch_note_private.guard_card_job_write(),bunch_note_private.guard_card_ledger_write(),
 bunch_note_private.card_destination_view(public.profiles,text),bunch_note_private.card_command(uuid,text,jsonb,uuid,bigint),
 bunch_note_private.invoke_card_command(uuid,text,jsonb,uuid,bigint),
 bunch_note_private.enrich_preview_cards(),
 public.bunch_note_card_command_v1(uuid,text,jsonb,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.bunch_note_card_command_v1(uuid,text,jsonb,uuid,bigint) to service_role;

alter function public.bunch_note_command_v1(uuid,text,jsonb,uuid,bigint) set schema bunch_note_private;
alter function bunch_note_private.bunch_note_command_v1(uuid,text,jsonb,uuid,bigint) rename to bunch_note_command_legacy;
create function public.bunch_note_command_v1(p_actor_id uuid,p_operation text,p_payload jsonb default '{}'::jsonb,
 p_command_id uuid default null,p_expected_revision bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; job bunch_note_private.jobs; old_mode text; result jsonb;
begin
 if p_operation in ('list','get','pdf','destinations','destination_detail','destination_lookup','work_pdf','cancel',
  'assign_card','claim_card','release_card','complete_card') then
  return bunch_note_private.invoke_card_command(p_actor_id,p_operation,p_payload,p_command_id,p_expected_revision);
 end if;
 if p_operation in ('progress','actual','add_action','option_add','assign','claim','release','complete')
  and nullif(p_payload->>'job_id','') is not null then
  select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid;
  if found and coalesce((job.body->>'format_version')::integer,0)>=5 then
   if p_operation in ('progress','actual','add_action','option_add') then
    if nullif(p_payload->>'card_id','') is null then raise exception 'BUNCH_NOTE_CARD_ID_REQUIRED'; end if;
    return bunch_note_private.invoke_card_command(p_actor_id,p_operation,p_payload,p_command_id,p_expected_revision);
   end if;
   raise exception 'BUNCH_NOTE_CARD_OPERATION_REQUIRED';
  end if;
 end if;
 if p_operation in ('save','preview','publish','revise') then
  actor:=bunch_note_private.actor(p_actor_id);
  if actor.username='dylan_collyge' then
   old_mode:=coalesce(current_setting('bunch_note.card_command',true),'');
   perform set_config('bunch_note.card_command','on',true);
   result:=bunch_note_private.bunch_note_command_legacy(p_actor_id,p_operation,p_payload,p_command_id,p_expected_revision);
   perform set_config('bunch_note.card_command',old_mode,true);
   return result;
  end if;
 end if;
 return bunch_note_private.bunch_note_command_legacy(p_actor_id,p_operation,p_payload,p_command_id,p_expected_revision);
end $$;
revoke all on function public.bunch_note_command_v1(uuid,text,jsonb,uuid,bigint),
 bunch_note_private.bunch_note_command_legacy(uuid,text,jsonb,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.bunch_note_command_v1(uuid,text,jsonb,uuid,bigint) to service_role;
notify pgrst,'reload schema';
commit;
