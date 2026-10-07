begin;

-- The command API remains the only writer. JSON reports are compatibility and
-- immutable publication snapshots; these tables give current drafts/jobs a
-- relational header/line representation in the same transaction.
create table bunch_note_private.bunch_notes (
 id uuid primary key default gen_random_uuid(),
 batch_id uuid references bunch_note_private.batches(id) on delete cascade,
 job_id uuid references bunch_note_private.jobs(id) on delete cascade,
 location_code text not null, direction text not null default '',
 target_houses text not null default '', general_instructions text not null default '',
 purpose text not null default '', priority text not null default '', prerequisites text not null default '',
 house_sections jsonb not null default '[]' check(jsonb_typeof(house_sections)='array'),
 revision bigint not null, updated_at timestamptz not null default now(),
 check((batch_id is null) <> (job_id is null)),
 unique(batch_id,location_code), unique(job_id)
);
create table bunch_note_private.bunch_note_lines (
 id uuid primary key default gen_random_uuid(),
 bunch_note_id uuid not null references bunch_note_private.bunch_notes(id) on delete cascade,
 action_id text not null, sequence_order integer not null check(sequence_order>0),
 section_id text not null default '', sub_location text not null default '',
 margin_tag text not null default '', item_size text not null default '', item_desc text not null default '',
 quantity_constraint text not null default '', action_instruction text not null,
 action_metadata jsonb not null,
 unique(bunch_note_id,action_id),
 unique(bunch_note_id,sequence_order) deferrable initially deferred
);
alter table bunch_note_private.bunch_notes enable row level security;
alter table bunch_note_private.bunch_note_lines enable row level security;
revoke all on bunch_note_private.bunch_notes,bunch_note_private.bunch_note_lines from public,anon,authenticated,service_role;

-- Freeform instructions have a trusted, non-quantity-bearing action kind.
insert into bunch_note_private.options(id,category,label,kind)
values('bb000000-0000-4000-8000-000000000001','sequence','Freeform operational task','instruction');

create function bunch_note_private.structured_note(entry jsonb, prior jsonb default '{}') returns jsonb
language plpgsql stable set search_path='' as $$
declare sections jsonb; s jsonb; a jsonb; old jsonb; actions jsonb:='[]';
 ids text[]:='{}'; aid text[]:='{}'; label text; text_key text; source jsonb; n integer:=0;
begin
 if jsonb_typeof(entry) is distinct from 'object' then raise exception 'BUNCH_NOTE_STRUCTURE_INVALID'; end if;
 -- A legacy editor must not silently erase newly added header/line fields.
 foreach text_key in array array['direction','target_houses','house_sections'] loop
  if not(entry ? text_key) and prior ? text_key then entry:=entry||jsonb_build_object(text_key,prior->text_key); end if;
 end loop;
 entry:=entry||jsonb_build_object('format_version',4,
  'location_code',upper(btrim(coalesce(entry->>'location',entry->>'location_code',''))),
  'direction',coalesce(entry->>'direction',''),'target_houses',coalesce(entry->>'target_houses',''),
  'general_instructions',coalesce(entry->>'instructions',entry->>'general_instructions',''));
 entry:=entry||jsonb_build_object('instructions',entry->>'general_instructions');
 if length(entry->>'direction')>200 or length(entry->>'target_houses')>500 or length(entry->>'instructions')>8000
 then raise exception 'BUNCH_NOTE_STRUCTURE_TOO_LONG'; end if;
 sections:=coalesce(entry->'house_sections','[]');
 if jsonb_typeof(sections)<>'array' or jsonb_array_length(sections)>200 then raise exception 'BUNCH_NOTE_SECTIONS_INVALID'; end if;
 for s in select value from jsonb_array_elements(sections) loop
  if nullif(btrim(s->>'id'),'') is null or length(s->>'id')>100 or s->>'id'=any(ids)
   or length(btrim(coalesce(s->>'name',''))) not between 1 and 200 or length(coalesce(s->>'direction',''))>200
  then raise exception 'BUNCH_NOTE_SECTIONS_INVALID'; end if;
  ids:=array_append(ids,s->>'id');
 end loop;
 if jsonb_typeof(entry->'actions') is distinct from 'array' then raise exception 'BUNCH_NOTE_ACTION_INVALID'; end if;
 for a in select value from jsonb_array_elements(entry->'actions') loop
  if nullif(a->>'id','') is null or a->>'id'=any(aid) then raise exception 'BUNCH_NOTE_ACTION_INVALID'; end if;
  aid:=array_append(aid,a->>'id');
  select value into old from jsonb_array_elements(coalesce(prior->'actions','[]')) where value->>'id'=a->>'id';
  foreach text_key in array array['section_id','margin_tag','quantity_constraint','item_size','item_desc','freeform'] loop
   if not(a ? text_key) and old ? text_key then a:=a||jsonb_build_object(text_key,old->text_key); end if;
  end loop;
  if nullif(a->>'section_id','') is not null and not(a->>'section_id'=any(ids)) then raise exception 'BUNCH_NOTE_SECTION_NOT_FOUND'; end if;
  label:='';
  select s1->>'name' into label from jsonb_array_elements(sections) s1 where s1->>'id'=a->>'section_id';
  a:=a||jsonb_build_object('section_id',coalesce(a->>'section_id',''),'sub_location',coalesce(label,''),
   'margin_tag',btrim(coalesce(a->>'margin_tag',a->>'crew','')),
   'quantity_constraint',coalesce(a->>'quantity_constraint',a->>'quantity',''),
   'action_instruction',coalesce(a->>'instructions',a->>'action_instruction',''));
  a:=a||jsonb_build_object('instructions',a->>'action_instruction','crew',a->>'margin_tag');
  if length(a->>'margin_tag')>80 or length(a->>'quantity_constraint')>200 or length(coalesce(a->>'item_size',''))>200
   or length(coalesce(a->>'item_desc',''))>2000 or length(a->>'instructions') not between 1 and 4000
  then raise exception 'BUNCH_NOTE_LINE_INVALID'; end if;
  if coalesce((a->>'freeform')::boolean,false) then
   if coalesce(a->>'kind','instruction')<>'instruction' or coalesce(a->>'scope','location')<>'location'
    or nullif(a->>'quantity','') is not null or nullif(a->>'percentage','') is not null
   then raise exception 'BUNCH_NOTE_FREEFORM_INVALID'; end if;
   a:=a||jsonb_build_object('option_id','bb000000-0000-4000-8000-000000000001','kind','instruction',
    'label','Freeform operational task','group','sequence','scope','location','row_ids','[]'::jsonb);
  end if;
  source:=coalesce(entry->'source_all',entry->'source','[]');
  if a->>'scope'='rows' then
   a:=a||jsonb_build_object('item_size',coalesce((select string_agg(distinct r->>'contsize',', ' order by r->>'contsize') from jsonb_array_elements(source) r where a->'row_ids' ? (r->>'unique_id')),''),
    'item_desc',coalesce((select string_agg(distinct r->>'commonname',', ' order by r->>'commonname') from jsonb_array_elements(source) r where a->'row_ids' ? (r->>'unique_id')),''));
  else
   a:=a||jsonb_build_object('item_size',coalesce(a->>'item_size',''),'item_desc',coalesce(a->>'item_desc',''));
  end if;
  actions:=actions||jsonb_build_array(a);
 end loop;
 -- House order wins; preserve input order within a house. Unassigned tasks lead.
 select coalesce(jsonb_agg(ordered.a||jsonb_build_object('sequence_order',ordered.ordinal) order by ordered.ordinal),'[]') into actions from (
  select x.a,row_number() over(order by coalesce((select h.ord from jsonb_array_elements(sections) with ordinality h(v,ord) where h.v->>'id'=x.a->>'section_id'),0),x.ord) ordinal
  from jsonb_array_elements(actions) with ordinality x(a,ord)
 ) ordered;
 return entry||jsonb_build_object('house_sections',sections,'actions',actions);
end $$;

create function bunch_note_private.store_structure(p_batch uuid,p_job uuid,entry jsonb,p_revision bigint) returns void
language plpgsql set search_path='' as $$
declare note_id uuid; a jsonb; n integer:=0;
begin
 if p_job is null then
  select id into note_id from bunch_note_private.bunch_notes where batch_id=p_batch and location_code=entry->>'location';
 else
  select id into note_id from bunch_note_private.bunch_notes where job_id=p_job;
 end if;
 if note_id is null then
  insert into bunch_note_private.bunch_notes(batch_id,job_id,location_code,revision)
   values(p_batch,p_job,entry->>'location',p_revision) returning id into note_id;
 end if;
 update bunch_note_private.bunch_notes set direction=entry->>'direction',target_houses=entry->>'target_houses',
  general_instructions=entry->>'instructions',purpose=coalesce(entry->>'purposes',''),priority=coalesce(entry->>'priority',''),
  prerequisites=coalesce(entry->>'prerequisites',''),house_sections=entry->'house_sections',revision=p_revision,updated_at=now()
  where id=note_id;
 delete from bunch_note_private.bunch_note_lines l where l.bunch_note_id=note_id
  and not exists(select 1 from jsonb_array_elements(entry->'actions') x(v) where x.v->>'id'=l.action_id);
 for a in select value from jsonb_array_elements(entry->'actions') loop
  n:=n+1;
  insert into bunch_note_private.bunch_note_lines(bunch_note_id,action_id,sequence_order,section_id,sub_location,margin_tag,item_size,item_desc,quantity_constraint,action_instruction,action_metadata)
   values(note_id,a->>'id',n,a->>'section_id',a->>'sub_location',a->>'margin_tag',a->>'item_size',a->>'item_desc',a->>'quantity_constraint',a->>'instructions',a)
   on conflict(bunch_note_id,action_id) do update set sequence_order=excluded.sequence_order,section_id=excluded.section_id,
    sub_location=excluded.sub_location,margin_tag=excluded.margin_tag,item_size=excluded.item_size,item_desc=excluded.item_desc,
    quantity_constraint=excluded.quantity_constraint,action_instruction=excluded.action_instruction,action_metadata=excluded.action_metadata;
 end loop;
end $$;

create function bunch_note_private.sync_structure() returns trigger
language plpgsql security definer set search_path='' as $$
declare entry jsonb; entries jsonb:='[]'; j bunch_note_private.jobs;
begin
 if tg_table_name='batches' then
  for entry in select value from jsonb_array_elements(coalesce(new.body->'locations','[]')) loop
   entry:=bunch_note_private.structured_note(entry);
   perform bunch_note_private.store_structure(new.id,null,entry,new.revision);
  end loop;
  delete from bunch_note_private.bunch_notes n where n.batch_id=new.id and not exists(
   select 1 from jsonb_array_elements(coalesce(new.body->'locations','[]')) l where l->>'location'=n.location_code);
 else
  if tg_table_name='jobs' then j:=new; else select * into j from bunch_note_private.jobs where id=new.job_id; end if;
  entry:=bunch_note_private.structured_note(j.body||jsonb_build_object('location',j.location,'actions',bunch_note_private.actions(j),'source',bunch_note_private.work_source(j)));
  perform bunch_note_private.store_structure(null,j.id,entry,j.revision);
 end if;
 return new;
end $$;
create trigger bunch_note_batch_structure after insert or update of body,revision on bunch_note_private.batches for each row execute function bunch_note_private.sync_structure();
create trigger bunch_note_job_structure after insert or update of body,revision on bunch_note_private.jobs for each row execute function bunch_note_private.sync_structure();
create trigger bunch_note_worker_structure after insert on bunch_note_private.worker_actions for each row execute function bunch_note_private.sync_structure();

-- Preserve all existing data and frozen previews; only materialize current data.
do $$ declare b bunch_note_private.batches; j bunch_note_private.jobs; entry jsonb; begin
 for b in select * from bunch_note_private.batches loop
  for entry in select value from jsonb_array_elements(coalesce(b.body->'locations','[]')) loop
   perform bunch_note_private.store_structure(b.id,null,bunch_note_private.structured_note(entry),b.revision);
  end loop;
 end loop;
 for j in select * from bunch_note_private.jobs loop
  perform bunch_note_private.store_structure(null,j.id,bunch_note_private.structured_note(j.body||jsonb_build_object('location',j.location,'actions',bunch_note_private.actions(j),'source',bunch_note_private.work_source(j))),j.revision);
 end loop;
end $$;

CREATE OR REPLACE FUNCTION public.bunch_note_command_v1(p_actor_id uuid, p_operation text, p_payload jsonb DEFAULT '{}'::jsonb, p_command_id uuid DEFAULT NULL::uuid, p_expected_revision bigint DEFAULT NULL::bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
 actor public.profiles; author boolean; batch bunch_note_private.batches; job bunch_note_private.jobs;
 preview bunch_note_private.previews; prior bunch_note_private.commands;
 body jsonb; entry jsonb; act jsonb; row_value jsonb; source jsonb; reports jsonb:='[]';
 result jsonb; request jsonb; ids text[]:='{}'; action_ids text[]; location_value text;
 job_id uuid; batch_id uuid; owner uuid; snapshot jsonb; report jsonb; progress_value jsonb; state text; previous_owner uuid;
 option_value bunch_note_private.options; new_actions jsonb; prior_actions jsonb; flags jsonb;
 event_id_value uuid; event public.ph_request_delivery_outbox; number_value text; revision_value integer;
begin
 actor:=bunch_note_private.actor(p_actor_id); author:=actor.username='dylan_collyge';
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2000000 then raise exception 'BUNCH_NOTE_PAYLOAD_INVALID'; end if;
 if p_operation in ('blocks','inventory','directory','drafts','save','preview','publish','revise','assign','cancel','retry','reconcile','option_edit','work_preview','work_publish') and not author
 then raise exception 'BUNCH_NOTE_AUTHOR_ONLY' using errcode='42501'; end if;
 if p_operation='destination_lookup' then
  return bunch_note_private.destination_lookup(actor,p_payload);
 elsif p_operation='destinations' then
  return bunch_note_private.destination_view(actor);
 elsif p_operation='destination_detail' then
  return bunch_note_private.destination_view(actor,p_payload->>'location');
 elsif p_operation='catalog' then
  return jsonb_build_object('options',(select coalesce(jsonb_agg(to_jsonb(o) order by o.category,o.label),'[]') from bunch_note_private.options o where author or o.active),
   'locations',(select coalesce(jsonb_agg(x order by x),'[]') from (select distinct upper(btrim(locationcode)) x from public.ph_master_inventory where nullif(btrim(locationcode),'') is not null) q));
 elsif p_operation='work_pdf' then
  select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid;
  if not found or not bunch_note_private.can_read(actor,job) then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  select p.* into preview from bunch_note_private.previews p where p.id=(p_payload->>'preview_id')::uuid and p.job_id=job.id and report_kind='completed_work' and published;
  if not found then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  return jsonb_build_object('pdf',preview.pdfs->0);
 elsif p_operation='blocks' then
  return jsonb_build_object('blocks',(select coalesce(jsonb_agg(b order by b),'[]') from
   (select distinct upper(btrim(blockalpha)) b from public.ph_master_inventory where nullif(btrim(blockalpha),'') is not null) q));
 elsif p_operation='inventory' then
  return jsonb_build_object('rows',bunch_note_private.inventory(upper(btrim(p_payload->>'block'))));
 elsif p_operation='directory' then
  return jsonb_build_object('users',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,
   'display',p.display_name,'email',u.email) order by p.display_name),'[]') from public.profiles p
   left join auth.users u on u.id=p.id where p.disabled_at is null and p.must_change_password is false
   and (p.locked_until is null or p.locked_until<=now())));
 elsif p_operation='drafts' then
  return jsonb_build_object('drafts',(select coalesce(jsonb_agg(to_jsonb(b) order by b.updated_at desc),'[]')
    from bunch_note_private.batches b where b.created_by=actor.id));
 elsif p_operation='list' then
  return jsonb_build_object('jobs',(select coalesce(jsonb_agg(bunch_note_private.job_json(j)||jsonb_build_object('delivery_status',
   coalesce((select p.delivery_status from bunch_note_private.versions v join bunch_note_private.previews p on p.id=v.preview_id
   where v.job_id=j.id order by v.instruction_revision desc limit 1),'not_sent')) order by j.updated_at desc),'[]')
   from bunch_note_private.jobs j where bunch_note_private.can_read(actor,j)));
 elsif p_operation in ('get','pdf') then
  select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid;
  if not found or not bunch_note_private.can_read(actor,job) then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  if p_operation='pdf' then
   select p.* into preview from bunch_note_private.versions v join bunch_note_private.previews p on p.id=v.preview_id
    where v.job_id=job.id and v.instruction_revision=coalesce((p_payload->>'instruction_revision')::integer,job.instruction_revision);
   return jsonb_build_object('pdf',(select f from jsonb_array_elements(preview.pdfs) f where f->>'job_id'=job.id::text));
  end if;
  return jsonb_build_object('job',bunch_note_private.job_json(job),'versions',(select coalesce(jsonb_agg(jsonb_build_object(
   'instruction_revision',v.instruction_revision,'delivery_status',p.delivery_status,'preview_id',p.id)
   order by v.instruction_revision desc),'[]') from bunch_note_private.versions v join bunch_note_private.previews p on p.id=v.preview_id where v.job_id=job.id),
   'work_reports',(select coalesce(jsonb_agg(jsonb_build_object('preview_id',p.id,'job_revision',p.job_revision,'delivery_status',p.delivery_status) order by p.created_at desc),'[]') from bunch_note_private.previews p where p.job_id=job.id and p.report_kind='completed_work' and p.published),
   'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from bunch_note_private.audit a where a.job_id=job.id));
 elsif p_operation='preview_read' then
  if not author then raise exception 'BUNCH_NOTE_AUTHOR_ONLY' using errcode='42501'; end if;
  select * into preview from bunch_note_private.previews where id=(p_payload->>'preview_id')::uuid and created_by=actor.id;
  if not found then raise exception 'BUNCH_NOTE_PREVIEW_NOT_FOUND'; end if;
  return to_jsonb(preview);
 end if;
 if p_command_id is null then raise exception 'BUNCH_NOTE_COMMAND_REQUIRED'; end if;
 request:=jsonb_build_object('operation',p_operation,'payload',p_payload,'revision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
 select * into prior from bunch_note_private.commands where id=p_command_id;
 if found then
  if prior.actor_id<>actor.id or prior.request<>request then raise exception 'BUNCH_NOTE_COMMAND_CONFLICT'; end if;
  if not author and prior.response ? 'job' then
   select * into job from bunch_note_private.jobs where id=(prior.response->'job'->>'id')::uuid;
   if not found or not bunch_note_private.can_read(actor,job) then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  end if;
  return prior.response;
 end if;
 if p_operation in ('option_add','option_edit') then
  if p_operation='option_add' and not author then
   select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid for update;
   if not found or job.owner_id is distinct from actor.id then raise exception 'BUNCH_NOTE_OWNER_ONLY' using errcode='42501'; end if;
   if job.status<>'open' or job.revision is distinct from p_expected_revision then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
  end if;
  if p_operation='option_edit' then
   select * into option_value from bunch_note_private.options where id=(p_payload->>'option_id')::uuid for update;
   if not found or option_value.revision is distinct from p_expected_revision then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
   update bunch_note_private.options set label=btrim(p_payload->>'label'),active=coalesce((p_payload->>'active')::boolean,true),revision=revision+1,updated_at=now()
    where id=option_value.id returning * into option_value;
  else
   insert into bunch_note_private.options(category,label,kind,created_by) values(p_payload->>'category',btrim(p_payload->>'label'),p_payload->>'kind',actor.id) returning * into option_value;
  end if;
  result:=jsonb_build_object('option',to_jsonb(option_value));
  if job.id is not null then result:=result||jsonb_build_object('job',bunch_note_private.job_json(job)); end if;
  insert into bunch_note_private.audit(job_id,actor_id,operation,detail) values(job.id,actor.id,p_operation,to_jsonb(option_value));
 elsif p_operation in ('add_action','actual') then
  select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid for update;
  if not found or not bunch_note_private.can_read(actor,job) then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  if job.revision is distinct from p_expected_revision then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
  if not (job.status='open' and job.owner_id is not distinct from actor.id) and not (author and job.status='complete' and p_operation='actual' and nullif(p_payload->>'replaces_id','') is not null)
   then raise exception 'BUNCH_NOTE_OWNER_ONLY' using errcode='42501'; end if;
  if p_operation='add_action' then
   if jsonb_array_length(bunch_note_private.actions(job))>=200 then raise exception 'BUNCH_NOTE_ACTION_LIMIT'; end if;
   act:=(bunch_note_private.structured_note(job.body||jsonb_build_object('source',bunch_note_private.work_source(job),'actions',jsonb_build_array(p_payload->'action')))->'actions')->0;
   if nullif(act->>'option_id','') is null then raise exception 'BUNCH_NOTE_OPTION_REQUIRED'; end if;
   if exists(select 1 from jsonb_array_elements(bunch_note_private.actions(job)) a where a->>'id'=act->>'id')
    or exists(select 1 from bunch_note_private.actuals a where a.job_id=job.id and a.action_id=act->>'id') then raise exception 'BUNCH_NOTE_ACTION_ID_REUSED'; end if;
   act:=bunch_note_private.validate_action(act,bunch_note_private.work_source(job));
   perform bunch_note_private.validate_destination(act,bunch_note_private.work_source(job));
   -- Worker-added instructions carry their origin; planned quantities stay Dylan's.
   act:=(act-'quantity'-'percentage')||jsonb_build_object('id',act->>'id','option_id',act->>'option_id','group',act->>'group','kind',bunch_note_private.action_kind(act),
    'label',act->>'label','instructions',act->>'instructions','scope',act->>'scope','row_ids',act->'row_ids','worker_added',true,'actor_id',actor.id,'created_at',now(),
    'destination',upper(btrim(coalesce(act->>'destination',''))),'destination_mode',act->>'destination_mode',
    'source_snapshot',(select jsonb_agg(r) from jsonb_array_elements(bunch_note_private.work_source(job)) r where act->>'scope'='location' or act->'row_ids' ? (r->>'unique_id')));
   insert into bunch_note_private.worker_actions(job_id,action,actor_id) values(job.id,act,actor.id);
  else
   select r into row_value from jsonb_array_elements(bunch_note_private.work_source(job)) r where r->>'unique_id'=p_payload->>'source_id';
   perform bunch_note_private.validate_destination(p_payload||jsonb_build_object('scope','location'),jsonb_build_array(row_value));
   perform bunch_note_private.record_actual(job,p_payload,actor.id);
  end if;
  update bunch_note_private.jobs set revision=revision+1,updated_at=now() where id=job.id returning * into job;
  result:=jsonb_build_object('job',bunch_note_private.job_json(job));
  insert into bunch_note_private.audit(job_id,actor_id,operation,detail) values(job.id,actor.id,p_operation,p_payload||jsonb_build_object('revision',job.revision));
 elsif p_operation='work_preview' then
  select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid for update;
  if not found or job.status<>'complete' or job.revision is distinct from p_expected_revision then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
  report:=job.body||jsonb_build_object('job_id',job.id,'report_kind','completed_work','work_revision',job.revision,'actions',bunch_note_private.actions(job),
   'source',bunch_note_private.work_source(job),'actuals',bunch_note_private.actual_history(job.id),'progress',job.progress,'owner_id',job.owner_id,
   'owner_name',(select display_name from public.profiles where id=job.owner_id),'recorded_at',now());
  report:=bunch_note_private.structured_note(report);
  insert into bunch_note_private.previews(id,batch_id,created_by,batch_revision,reports,recipients,report_kind,job_id,job_revision)
   values(gen_random_uuid(),job.batch_id,actor.id,1,jsonb_build_array(report),bunch_note_private.recipients(coalesce(p_payload->'recipient_ids','[]')),'completed_work',job.id,job.revision) returning * into preview;
  result:=jsonb_build_object('preview',to_jsonb(preview)-'pdfs');
 elsif p_operation='work_publish' then
  select * into preview from bunch_note_private.previews where id=(p_payload->>'preview_id')::uuid for update;
  if not found or preview.report_kind<>'completed_work' or preview.created_by<>actor.id or preview.published or preview.pdfs is null or preview.expires_at<=now() then raise exception 'BUNCH_NOTE_PREVIEW_REQUIRED'; end if;
  select * into job from bunch_note_private.jobs where id=preview.job_id for update;
  if job.status<>'complete' or job.revision is distinct from p_expected_revision or job.revision<>preview.job_revision then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
  if preview.recipients is distinct from bunch_note_private.recipients((select jsonb_agg(r->'profile_id') from jsonb_array_elements(preview.recipients) r)) then raise exception 'BUNCH_NOTE_RECIPIENT_CHANGED'; end if;
  if coalesce((p_payload->>'send_email')::boolean,false) then
   insert into public.ph_request_delivery_outbox(event_key,event_type,payload,delivery_mode) values('bunch-note:'||preview.id,'bunch_note_submission',jsonb_build_object('preview_id',preview.id,'report_kind','completed_work'),'email') returning event_id into event_id_value;
  end if;
  update bunch_note_private.previews set published=true,event_id=event_id_value,delivery_status=case when event_id_value is null then 'not_sent' else 'queued' end where id=preview.id;
  insert into bunch_note_private.audit(job_id,actor_id,operation,detail) values(job.id,actor.id,p_operation,jsonb_build_object('preview_id',preview.id,'revision',job.revision));
  result:=jsonb_build_object('published',true,'preview_id',preview.id,'event_id',event_id_value);
 elsif p_operation='save' then
  batch_id:=coalesce((p_payload->>'batch_id')::uuid,gen_random_uuid());
  select * into batch from bunch_note_private.batches where id=batch_id for update;
  if found and (batch.created_by<>actor.id or batch.revision is distinct from p_expected_revision) then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
  body:=p_payload->'body';
  if jsonb_typeof(body->'locations') is distinct from 'array' or jsonb_array_length(body->'locations') not between 1 and 20
   or nullif(btrim(body->>'block'),'') is null then raise exception 'BUNCH_NOTE_DRAFT_INVALID'; end if;
  for entry in select value from jsonb_array_elements(body->'locations') loop
   location_value:=upper(btrim(entry->>'location'));
   if location_value is null or location_value=any(ids) then raise exception 'BUNCH_NOTE_LOCATION_INVALID'; end if;
   ids:=array_append(ids,location_value);
   source:=bunch_note_private.inventory(upper(btrim(body->>'block')),location_value);
   if jsonb_array_length(source)=0 then raise exception 'BUNCH_NOTE_SOURCE_MISSING'; end if;
   if jsonb_typeof(entry->'actions') is distinct from 'array' or jsonb_array_length(entry->'actions') not between 0 and 200
    or length(coalesce(entry->>'instructions',''))>8000 or length(coalesce(entry->>'prerequisites',''))>8000
    or length(coalesce(entry->>'purposes',''))>500 then raise exception 'BUNCH_NOTE_INSTRUCTIONS_REQUIRED'; end if;
   if jsonb_typeof(entry->'row_ids') is distinct from 'array' then raise exception 'BUNCH_NOTE_ROWS_REQUIRED'; end if;
   for row_value in select value from jsonb_array_elements(entry->'row_ids') loop
    if not exists(select 1 from jsonb_array_elements(source) r where r->'unique_id'=row_value) then raise exception 'BUNCH_NOTE_SOURCE_CHANGED'; end if;
   end loop;
   if entry ? 'source_all' and entry->'source_all' is distinct from source then raise exception 'BUNCH_NOTE_SOURCE_CHANGED'; end if;
   entry:=bunch_note_private.structured_note(entry||jsonb_build_object('source_all',source),coalesce((select l from jsonb_array_elements(batch.body->'locations') l where l->>'location'=location_value),'{}'));
   prior_actions:=coalesce((select l->'actions' from jsonb_array_elements(batch.body->'locations') l where upper(btrim(l->>'location'))=location_value),'[]');
   if nullif(entry->>'job_id','') is not null then
    prior_actions:=prior_actions||coalesce((select j.body->'actions' from bunch_note_private.jobs j where j.id=(entry->>'job_id')::uuid),'[]');
   end if;
   action_ids:='{}'; new_actions:='[]';
   for act in select value from jsonb_array_elements(entry->'actions') loop
    if nullif(act->>'id','') is null or act->>'id'=any(action_ids) or length(coalesce(act->>'instructions','')) not between 1 and 4000
     or coalesce(act->>'group','') not in ('sequence','grading','hauling','placement','identification','inventory')
     or coalesce(act->>'scope','') not in ('location','rows') then raise exception 'BUNCH_NOTE_ACTION_INVALID'; end if;
    act:=bunch_note_private.validate_action(act,source,prior_actions);
    perform bunch_note_private.validate_destination(act,source);
    new_actions:=new_actions||jsonb_build_array(act);
    action_ids:=array_append(action_ids,act->>'id');
    if nullif(act->>'quantity','') is not null and ((act->>'quantity') !~ '^[0-9]+$' or (act->>'quantity')::numeric<=0) then raise exception 'BUNCH_NOTE_QUANTITY_INVALID'; end if;
    if nullif(act->>'percentage','') is not null and ((act->>'percentage') !~ '^[0-9]+([.][0-9]+)?$'
      or (act->>'percentage')::numeric<=0 or (act->>'percentage')::numeric>100) then raise exception 'BUNCH_NOTE_PERCENTAGE_INVALID'; end if;
    if nullif(act->>'quantity','') is not null and nullif(act->>'percentage','') is not null then raise exception 'BUNCH_NOTE_QUANTITY_OR_PERCENTAGE'; end if;
    if act->>'scope'='rows' and (jsonb_typeof(act->'row_ids') is distinct from 'array' or jsonb_array_length(act->'row_ids')=0
      or not ((entry->'row_ids') @> (act->'row_ids'))) then raise exception 'BUNCH_NOTE_ACTION_ROWS_INVALID'; end if;
   end loop;
   entry:=jsonb_set(entry,'{actions}',new_actions);
   owner:=nullif(entry->>'owner_id','')::uuid;
   if owner is not null then perform bunch_note_private.actor(owner); end if;
   snapshot:=(select coalesce(jsonb_agg(r order by r->>'unique_id'),'[]') from jsonb_array_elements(source) r where exists(select 1 from jsonb_array_elements(source) chosen where entry->'row_ids' ? (chosen->>'unique_id') and
    (chosen->>'unique_id'=r->>'unique_id' or (nullif(btrim(r->>'itemcode'),'') is not null and upper(btrim(r->>'itemcode'))=upper(btrim(chosen->>'itemcode'))))));
   reports:=reports||jsonb_build_array(entry||jsonb_build_object('location',location_value,'source',snapshot,'source_all',source));
  end loop;
  body:=jsonb_build_object('snapshot_version',3,'block',upper(btrim(body->>'block')),'locations',reports,'recipient_ids',coalesce(body->'recipient_ids','[]'));
  insert into bunch_note_private.batches(id,created_by,block,body) values(batch_id,actor.id,body->>'block',body)
   on conflict(id) do update set revision=bunch_note_private.batches.revision+1,body=excluded.body,block=excluded.block,updated_at=now()
   returning * into batch;
  result:=jsonb_build_object('draft',to_jsonb(batch));
 elsif p_operation='preview' then
  if exists(select 1 from public.app_dataset_revisions r where r.key='ph_master_inventory' and r.state<>'ready') then raise exception 'BUNCH_NOTE_SOURCE_REFRESH_REQUIRED'; end if;
  select * into batch from bunch_note_private.batches where id=(p_payload->>'batch_id')::uuid for update;
  if not found or batch.created_by<>actor.id or batch.revision is distinct from p_expected_revision then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
  for entry in select value from jsonb_array_elements(batch.body->'locations') loop
   perform bunch_note_private.require_ready(entry);
   if entry->'source_all' is distinct from bunch_note_private.inventory(batch.block,entry->>'location') then raise exception 'BUNCH_NOTE_SOURCE_CHANGED'; end if;
   for act in select value from jsonb_array_elements(entry->'actions') loop
    perform bunch_note_private.validate_destination(act,entry->'source_all');
    if act->>'label'='Grade and Save / Move To' and (nullif(btrim(act->>'destination'),'') is null or nullif(act->>'quantity','') is null) then raise exception 'BUNCH_NOTE_GRADE_MOVE_REQUIRED'; end if;
   end loop;
   job_id:=nullif(entry->>'job_id','')::uuid;
   if job_id is not null then
    select * into job from bunch_note_private.jobs where id=job_id for update;
    if not found or job.status<>'open' or job.revision is distinct from (entry->>'expected_revision')::bigint
      or job.location<>entry->>'location' or job.block<>batch.block then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
    number_value:=job.note_number; revision_value:=job.instruction_revision+1;
   else
    job_id:=gen_random_uuid(); number_value:='BN-'||lpad(nextval('bunch_note_private.note_number')::text,7,'0'); revision_value:=1;
   end if;
   reports:=reports||jsonb_build_array((entry-'source_all')||jsonb_build_object('job_id',job_id,'note_number',number_value,
    'block',batch.block,'instruction_revision',revision_value));
  end loop;
  insert into bunch_note_private.previews(id,batch_id,created_by,batch_revision,reports,recipients)
   values(gen_random_uuid(),batch.id,actor.id,batch.revision,reports,bunch_note_private.recipients(batch.body->'recipient_ids')) returning * into preview;
  result:=jsonb_build_object('preview',to_jsonb(preview)-'pdfs');
 elsif p_operation='publish' then
  lock table public.ph_master_inventory in share mode;
  if exists(select 1 from public.app_dataset_revisions r where r.key='ph_master_inventory' and r.state<>'ready') then raise exception 'BUNCH_NOTE_SOURCE_REFRESH_REQUIRED'; end if;
  select * into preview from bunch_note_private.previews where id=(p_payload->>'preview_id')::uuid for update;
  if not found or preview.created_by<>actor.id or preview.expires_at<=now() or preview.published or preview.pdfs is null or preview.report_kind<>'instructions' then raise exception 'BUNCH_NOTE_PREVIEW_REQUIRED'; end if;
  select * into batch from bunch_note_private.batches where id=preview.batch_id for update;
  if batch.revision is distinct from p_expected_revision or batch.revision<>preview.batch_revision then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
  if preview.recipients is distinct from bunch_note_private.recipients(batch.body->'recipient_ids') then raise exception 'BUNCH_NOTE_RECIPIENT_CHANGED'; end if;
  for entry in select value from jsonb_array_elements(batch.body->'locations') loop
   perform bunch_note_private.require_ready(entry);
   if entry->'source_all' is distinct from bunch_note_private.inventory(batch.block,entry->>'location') then raise exception 'BUNCH_NOTE_SOURCE_CHANGED'; end if;
   for act in select value from jsonb_array_elements(entry->'actions') loop
    perform bunch_note_private.validate_destination(act,entry->'source_all');
    if act->>'label'='Grade and Save / Move To' and (nullif(btrim(act->>'destination'),'') is null or nullif(act->>'quantity','') is null) then raise exception 'BUNCH_NOTE_GRADE_MOVE_REQUIRED'; end if;
   end loop;
  end loop;
  for report in select value from jsonb_array_elements(preview.reports) order by value->>'location' loop
   job_id:=(report->>'job_id')::uuid;
   select * into job from bunch_note_private.jobs where id=job_id for update;
   if found then
    if job.status<>'open' or job.revision is distinct from (report->>'expected_revision')::bigint then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
    progress_value:='{}';
    for act in select value from jsonb_array_elements(report->'actions') loop
     if exists(select 1 from jsonb_array_elements(bunch_note_private.structured_note(job.body)->'actions') old
       where (old-'sequence_order')=(act-'sequence_order')) and job.progress ? (act->>'id') then
      progress_value:=progress_value||jsonb_build_object(act->>'id',job.progress->(act->>'id'));
     end if;
    end loop;
    for act in select w.action from bunch_note_private.worker_actions w where w.job_id=job.id loop
     if job.progress ? (act->>'id') then progress_value:=progress_value||jsonb_build_object(act->>'id',job.progress->(act->>'id')); end if;
    end loop;
    update bunch_note_private.jobs set body=report,progress=progress_value,revision=revision+1,
     instruction_revision=(report->>'instruction_revision')::integer,updated_at=now() where id=job_id;
   else
    owner:=nullif(report->>'owner_id','')::uuid;
    if owner is not null then perform bunch_note_private.actor(owner); end if;
    insert into bunch_note_private.jobs(id,batch_id,note_number,block,location,body,owner_id,created_by)
     values(job_id,batch.id,report->>'note_number',batch.block,report->>'location',report,owner,actor.id);
   end if;
   insert into bunch_note_private.versions(job_id,instruction_revision,preview_id,report)
    values(job_id,(report->>'instruction_revision')::integer,preview.id,report);
   insert into bunch_note_private.audit(job_id,actor_id,operation,detail) values(job_id,actor.id,'publish',report);
  end loop;
  if coalesce((p_payload->>'send_email')::boolean,false) then
   insert into public.ph_request_delivery_outbox(event_key,event_type,payload,delivery_mode)
    values('bunch-note:'||preview.id,'bunch_note_submission',jsonb_build_object('preview_id',preview.id,'report_kind',preview.report_kind),'email') returning event_id into event_id_value;
  end if;
  update bunch_note_private.previews set published=true,event_id=event_id_value,
   delivery_status=case when event_id_value is null then 'not_sent' else 'queued' end where id=preview.id;
  -- Save resulting identities so reopening a published batch produces revisions, not duplicate jobs.
  select jsonb_agg(e||jsonb_build_object('job_id',r->'job_id','expected_revision',j.revision)) into reports
   from jsonb_array_elements(batch.body->'locations') e join jsonb_array_elements(preview.reports) r on e->>'location'=r->>'location'
   join bunch_note_private.jobs j on j.id=(r->>'job_id')::uuid;
  update bunch_note_private.batches set revision=revision+1,body=jsonb_set(bunch_note_private.batches.body,'{locations}',reports) where id=batch.id;
  result:=jsonb_build_object('published',true,'preview_id',preview.id,'event_id',event_id_value);
 elsif p_operation in ('claim','release','assign','progress','complete','cancel','revise') then
  select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid for update;
  if not found or not bunch_note_private.can_read(actor,job) then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
  if job.revision is distinct from p_expected_revision or job.status<>'open' then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
  previous_owner:=job.owner_id;
  if p_operation='claim' then
   if job.owner_id is not null then raise exception 'BUNCH_NOTE_ALREADY_CLAIMED'; end if;
   update bunch_note_private.jobs set owner_id=actor.id where id=job.id;
  elsif p_operation='release' then
   if job.owner_id is distinct from actor.id and not author then raise exception 'BUNCH_NOTE_OWNER_ONLY' using errcode='42501'; end if;
   update bunch_note_private.jobs set owner_id=null where id=job.id;
  elsif p_operation='assign' then
   owner:=nullif(p_payload->>'owner_id','')::uuid;
   if owner is not null then perform bunch_note_private.actor(owner); end if;
   update bunch_note_private.jobs set owner_id=owner where id=job.id;
  elsif p_operation='cancel' then
   if nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'BUNCH_NOTE_REASON_REQUIRED'; end if;
   update bunch_note_private.jobs set status='cancelled' where id=job.id;
  elsif p_operation='revise' then
   batch_id:=gen_random_uuid();
   body:=jsonb_build_object('block',job.block,'recipient_ids','[]'::jsonb,'locations',jsonb_build_array(job.body||jsonb_build_object(
    'job_id',job.id,'expected_revision',job.revision,'source_all',bunch_note_private.inventory(job.block,job.location))));
   insert into bunch_note_private.batches(id,created_by,block,body) values(batch_id,actor.id,job.block,body) returning * into batch;
   result:=jsonb_build_object('draft',to_jsonb(batch));
  elsif p_operation in ('progress','complete') then
   if job.owner_id is distinct from actor.id then raise exception 'BUNCH_NOTE_OWNER_ONLY' using errcode='42501'; end if;
   if p_operation='progress' then
    state:=p_payload->>'status';
    if state not in ('done','not_needed') or state is null or not exists(select 1 from jsonb_array_elements(bunch_note_private.actions(job)) a where a->>'id'=p_payload->>'action_id') then raise exception 'BUNCH_NOTE_PROGRESS_INVALID'; end if;
    if state='not_needed' and nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'BUNCH_NOTE_REASON_REQUIRED'; end if;
    select a into act from jsonb_array_elements(bunch_note_private.actions(job)) a where a->>'id'=p_payload->>'action_id';
    flags:='[]';
    if state='done' then flags:=bunch_note_private.check_done(job,act,p_payload->>'reason'); end if;
    update bunch_note_private.jobs set progress=progress||jsonb_build_object(p_payload->>'action_id',jsonb_build_object(
     'status',state,'reason',p_payload->>'reason','review_flags',flags,'actor_id',actor.id,'at',now())) where id=job.id;
   else
    if exists(select 1 from jsonb_array_elements(bunch_note_private.actions(job)) a where not(job.progress ? (a->>'id'))) then raise exception 'BUNCH_NOTE_UNRESOLVED_ACTIONS'; end if;
    update bunch_note_private.jobs set status='complete' where id=job.id;
   end if;
  end if;
  if p_operation<>'revise' then
   update bunch_note_private.jobs set revision=revision+1,updated_at=now() where id=job.id returning * into job;
   result:=jsonb_build_object('job',bunch_note_private.job_json(job));
  end if;
  insert into bunch_note_private.audit(job_id,actor_id,operation,detail) values(job.id,actor.id,p_operation,
   p_payload||jsonb_build_object('prior_owner',previous_owner,'owner',job.owner_id,'revision',job.revision));
 elsif p_operation in ('send','retry','reconcile') then
  if not author then raise exception 'BUNCH_NOTE_AUTHOR_ONLY' using errcode='42501'; end if;
  select * into preview from bunch_note_private.previews where id=(p_payload->>'preview_id')::uuid;
  if not found or not preview.published then raise exception 'BUNCH_NOTE_PREVIEW_REQUIRED'; end if;
  if p_operation='send' and preview.event_id is null then
   if preview.recipients is distinct from bunch_note_private.recipients((select coalesce(jsonb_agg(r->'profile_id'),'[]') from jsonb_array_elements(preview.recipients) r)) then raise exception 'BUNCH_NOTE_RECIPIENT_CHANGED'; end if;
   insert into public.ph_request_delivery_outbox(event_key,event_type,payload,delivery_mode)
    values('bunch-note:'||preview.id,'bunch_note_submission',jsonb_build_object('preview_id',preview.id,'report_kind',preview.report_kind),'email') returning event_id into event_id_value;
   update bunch_note_private.previews set event_id=event_id_value,delivery_status='queued' where id=preview.id;
  else
   select * into event from public.ph_request_delivery_outbox where event_id=preview.event_id for update skip locked;
   if not found or event.status not in ('failed','unknown') then raise exception 'BUNCH_NOTE_DELIVERY_NOT_RETRYABLE'; end if;
   if p_operation='retry' and coalesce(event.channel_results->'email'->>'status','') in ('sending','sent','unknown') then raise exception 'BUNCH_NOTE_RECONCILIATION_REQUIRED'; end if;
   if p_operation='send' then raise exception 'BUNCH_NOTE_ALREADY_SENT'; end if;
   update public.ph_request_delivery_outbox set status='pending',next_attempt_at=now(),lease_token=null,lease_owner=null,lease_expires_at=null where event_id=event.event_id;
  end if;
  result:=jsonb_build_object('queued',true);
 else raise exception 'BUNCH_NOTE_OPERATION_INVALID';
 end if;
 insert into bunch_note_private.commands(id,actor_id,request,response) values(p_command_id,actor.id,request,result);
 return result;
end $_$;

revoke all on function bunch_note_private.structured_note(jsonb,jsonb), bunch_note_private.store_structure(uuid,uuid,jsonb,bigint), bunch_note_private.sync_structure() from public,anon,authenticated,service_role;
commit;
