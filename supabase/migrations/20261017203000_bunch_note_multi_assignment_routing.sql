begin;

alter table bunch_note_private.bunch_note_work_cards
 add column workflow_action text not null default ''
  check (workflow_action in ('','move','bunch','ta')),
 add column destination_location text not null default '',
 add column destination_house text not null default '',
 add column notes text not null default ''
  check (length(notes)<=4000);

alter table bunch_note_private.bunch_note_work_cards
 add constraint bunch_note_work_cards_routing_check check (
  (workflow_action='' and destination_location='' and destination_house='') or
  (workflow_action='move' and length(btrim(destination_location)) between 1 and 100 and destination_house='') or
  (workflow_action='bunch' and destination_location='' and destination_house in
   ('South House','North House','Center House','South & Center House','North & Center House',
    'East House','West House','East & Center House','West & Center House')) or
  (workflow_action='ta' and destination_location='' and destination_house='')
 );

create table bunch_note_private.bunch_note_card_assignees (
 bunch_note_id uuid not null,
 card_id uuid not null,
 user_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 created_by uuid not null references public.profiles(id),
 primary key (bunch_note_id,card_id,user_id),
 foreign key (bunch_note_id,card_id) references bunch_note_private.bunch_note_work_cards(bunch_note_id,card_id) on delete cascade
);
create index bunch_note_card_assignees_user on bunch_note_private.bunch_note_card_assignees(user_id,bunch_note_id,card_id);
alter table bunch_note_private.bunch_note_card_assignees enable row level security;
revoke all on bunch_note_private.bunch_note_card_assignees from public,anon,authenticated,service_role;

insert into bunch_note_private.bunch_note_card_assignees(bunch_note_id,card_id,user_id,created_by)
 select bunch_note_id,card_id,owner_id,owner_id
 from bunch_note_private.bunch_note_work_cards where owner_id is not null
 on conflict do nothing;

create or replace function bunch_note_private.card_allowed(p_actor uuid,p_job bunch_note_private.jobs,p_card uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from bunch_note_private.bunch_notes n
  join bunch_note_private.bunch_note_work_cards wc on wc.bunch_note_id=n.id
  where n.job_id=(p_job).id and wc.card_id=p_card and wc.active and (
   (select p.username from public.profiles p where p.id=p_actor)='dylan_collyge'
   or exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=wc.bunch_note_id and ca.card_id=wc.card_id and ca.user_id=p_actor)
   or wc.owner_id=p_actor
   or (wc.owner_id is null and not exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=wc.bunch_note_id and ca.card_id=wc.card_id)
       and wc.status='open' and (p_job).status='open')))
$$;

create or replace function bunch_note_private.normalize_work_cards(p_entry jsonb,p_prior jsonb default null) returns jsonb
language plpgsql stable set search_path='' as $$
declare c jsonb; a jsonb; normalized jsonb:='[]'; ids uuid[]:='{}'; keys text[]:='{}'; rows text[]; expected_rows text[]; used text[]:='{}';
 source jsonb; source_all jsonb; group_source jsonb; selected_source jsonb:='[]'; r jsonb; old_card jsonb; original_card jsonb; normalized_card jsonb;
 source_id_index jsonb; source_group_index jsonb; prior_id_index jsonb; prior_key_index jsonb; group_key text;
 v_card_id uuid; stable_id uuid; owner uuid; db_owner uuid; key_value text; kind_value text; linked_job uuid; v_batch_id uuid; batch_note_id uuid; batch_card_key_index jsonb:='{}'; note_id uuid; owner_found boolean;
 owner_ids uuid[]; raw_owner text; route text; destination_location text; destination_house text; card_notes text; owner_value uuid;
begin
 if jsonb_typeof(p_entry->'cards') is distinct from 'array' or jsonb_array_length(p_entry->'cards')>100 then raise exception 'BUNCH_NOTE_CARDS_REQUIRED'; end if;
 source:=coalesce(p_entry->'source','[]'::jsonb); if jsonb_typeof(source) is distinct from 'array' then raise exception 'BUNCH_NOTE_SOURCE_INVALID'; end if;
 source_all:=coalesce(p_entry->'source_all',source); if jsonb_typeof(source_all) is distinct from 'array' then raise exception 'BUNCH_NOTE_SOURCE_INVALID'; end if;
 select coalesce(jsonb_object_agg(x->>'unique_id',true),'{}'::jsonb) into source_id_index
  from jsonb_array_elements(source_all) x where jsonb_typeof(x->'unique_id')='string';
 source_group_index:='{}'::jsonb;
 if exists(select 1 from jsonb_array_elements(p_entry->'cards') x where x->>'kind'='inventory') then
  group_source:=source_all;
  if nullif(p_entry->>'block','') is not null then group_source:=bunch_note_private.inventory(upper(btrim(p_entry->>'block')),upper(btrim(p_entry->>'location'))); end if;
  select coalesce(jsonb_object_agg(g.group_key,to_jsonb(g.row_ids)),'{}'::jsonb) into source_group_index from (
   select jsonb_build_array(
     upper(regexp_replace(btrim(coalesce(x->>'locationcode','')),'\s+',' ','g')),
     upper(regexp_replace(btrim(coalesce(x->>'itemcode','')),'\s+',' ','g')),
     lower(regexp_replace(btrim(coalesce(x->>'commonname','')),'\s+',' ','g')),
     lower(regexp_replace(btrim(coalesce(x->>'contsize','')),'\s+',' ','g'))
    )::text as group_key,array_agg(x->>'unique_id' order by x->>'unique_id') as row_ids
   from jsonb_array_elements(group_source) x group by 1
  ) g;
 end if;
 if p_prior is not null then
  select coalesce(jsonb_object_agg(prior.id_key,prior.card_value),'{}'::jsonb) into prior_id_index from (
   select distinct on (x.value->>'id') x.value->>'id' id_key,x.value card_value
   from jsonb_array_elements(coalesce(p_prior->'cards','[]'::jsonb)) with ordinality x(value,ordinality)
   where nullif(x.value->>'id','') is not null order by x.value->>'id',x.ordinality
  ) prior;
  select coalesce(jsonb_object_agg(prior.card_key,prior.card_value),'{}'::jsonb) into prior_key_index from (
   select distinct on (bunch_note_private.card_key(x.value)) bunch_note_private.card_key(x.value) card_key,x.value card_value
   from jsonb_array_elements(coalesce(p_prior->'cards','[]'::jsonb)) with ordinality x(value,ordinality)
   where bunch_note_private.card_key(x.value) is not null order by bunch_note_private.card_key(x.value),x.ordinality
  ) prior;
 end if;
 v_batch_id:=nullif(p_entry->>'batch_id','')::uuid;
 if v_batch_id is not null then
  select n.id into batch_note_id from bunch_note_private.bunch_notes n
   where n.batch_id=v_batch_id and n.location_code=upper(btrim(p_entry->>'location'));
  if batch_note_id is not null then
   select coalesce(jsonb_object_agg(wc.card_key,wc.card_id),'{}'::jsonb) into batch_card_key_index
    from bunch_note_private.bunch_note_work_cards wc where wc.bunch_note_id=batch_note_id;
  end if;
 end if;
 for c in select value from jsonb_array_elements(p_entry->'cards') loop
  if jsonb_typeof(c) is distinct from 'object' then raise exception 'BUNCH_NOTE_CARD_INVALID'; end if;
  begin v_card_id:=(c->>'id')::uuid; exception when others then raise exception 'BUNCH_NOTE_CARD_INVALID'; end;
  kind_value:=c->>'kind'; key_value:=bunch_note_private.card_key(c);
  if v_card_id is null or kind_value not in ('inventory','shared') or v_card_id=any(ids) or key_value=any(keys)
   or upper(btrim(coalesce(c->>'location_code',p_entry->>'location','')))<>upper(btrim(p_entry->>'location'))
   or length(coalesce(c->>'house',''))>200 or length(coalesce(c->>'direction',''))>200 or jsonb_typeof(c->'row_ids') is distinct from 'array'
   or length(coalesce(c->>'notes',''))>4000 then raise exception 'BUNCH_NOTE_CARD_INVALID'; end if;
  if kind_value='inventory' and (jsonb_array_length(c->'row_ids')=0 or length(coalesce(c->>'itemcode',''))>200 or length(coalesce(c->>'commonname',''))>500 or length(coalesce(c->>'contsize',''))>200) then raise exception 'BUNCH_NOTE_CARD_INVALID'; end if;
  route:=case when c ? 'workflow_action' then coalesce(c->>'workflow_action','') else '' end; destination_location:=upper(btrim(coalesce(c->>'destination_location',''))); destination_house:=coalesce(c->>'destination_house',''); card_notes:=coalesce(c->>'notes','');
  if (route not in ('move','bunch','ta','') or (route='' and (destination_location<>'' or destination_house<>'')) or (route='move' and length(destination_location) not between 1 and 100) or
   (route='move' and destination_house<>'') or (route='bunch' and (destination_location<>'' or destination_house not in
    ('South House','North House','Center House','South & Center House','North & Center House','East House','West House','East & Center House','West & Center House'))) or
   (route='ta' and (destination_location<>'' or destination_house<>''))) then raise exception 'BUNCH_NOTE_ROUTING_INVALID'; end if;
  select array_agg(value order by value) into rows from jsonb_array_elements_text(c->'row_ids'); if rows is null then rows:='{}'; end if;
  if exists(select 1 from jsonb_array_elements(c->'row_ids') selected(value) where jsonb_typeof(selected.value) is distinct from 'string') then raise exception 'BUNCH_NOTE_CARD_SOURCE_INVALID'; end if;
  if cardinality(rows)<>cardinality(array(select distinct u from unnest(rows) as u)) then raise exception 'BUNCH_NOTE_CARD_ROWS_INVALID'; end if;
  foreach key_value in array rows loop
   if key_value is null or not (source_id_index ? key_value) then raise exception 'BUNCH_NOTE_CARD_SOURCE_INVALID'; end if;
   if kind_value='inventory' and key_value=any(used) then raise exception 'BUNCH_NOTE_CARD_OVERLAP'; end if;
  end loop;
  if kind_value='inventory' then
   if c->>'location_code' is null or c->>'itemcode' is null or c->>'commonname' is null or c->>'contsize' is null then expected_rows:=null;
   else
    group_key:=jsonb_build_array(
     upper(regexp_replace(btrim(c->>'location_code'),'\s+',' ','g')),
     upper(regexp_replace(btrim(c->>'itemcode'),'\s+',' ','g')),
     lower(regexp_replace(btrim(c->>'commonname'),'\s+',' ','g')),
     lower(regexp_replace(btrim(c->>'contsize'),'\s+',' ','g'))
    )::text;
    select array_agg(x.value order by x.ordinality) into expected_rows from jsonb_array_elements_text(source_group_index->group_key) with ordinality x(value,ordinality);
   end if;
   if coalesce(expected_rows,'{}'::text[])<>coalesce(rows,'{}'::text[]) then raise exception 'BUNCH_NOTE_CARD_GROUP_CHANGED'; end if;
  end if;
  if kind_value='inventory' then used:=used||rows; end if;
  owner_ids:='{}';
  if c ? 'owner_ids' and jsonb_typeof(c->'owner_ids') is distinct from 'array' then raise exception 'BUNCH_NOTE_CARD_OWNER_INVALID'; end if;
  if jsonb_typeof(c->'owner_ids')='array' then
   if jsonb_array_length(c->'owner_ids')>20 then raise exception 'BUNCH_NOTE_CARD_OWNER_INVALID'; end if;
   for raw_owner in select jsonb_array_elements_text(c->'owner_ids') loop
    begin owner_value:=raw_owner::uuid; exception when others then raise exception 'BUNCH_NOTE_CARD_OWNER_INVALID'; end;
    if owner_value=any(owner_ids) or not bunch_note_private.active_card_owner(owner_value) or owner_value is null then raise exception 'BUNCH_NOTE_CARD_OWNER_INVALID'; end if;
    owner_ids:=array_append(owner_ids,owner_value);
   end loop;
  elsif nullif(c->>'owner_id','') is not null then
   owner:=nullif(c->>'owner_id','')::uuid; if not bunch_note_private.active_card_owner(owner) then raise exception 'BUNCH_NOTE_CARD_OWNER_INVALID'; end if;
   if owner is not null then owner_ids:=array_append(owner_ids,owner); end if;
  end if;
  owner:=owner_ids[1];
  if batch_note_id is not null then stable_id:=nullif(batch_card_key_index->>bunch_note_private.card_key(c),'')::uuid; if stable_id is not null then v_card_id:=stable_id; end if; end if;
  linked_job:=nullif(p_entry->>'job_id','')::uuid;
  if linked_job is not null then
   select n.id into note_id from bunch_note_private.bunch_notes n where n.job_id=linked_job;
   if note_id is not null then stable_id:=null; owner_found:=false; db_owner:=null;
    select true,wc.owner_id,wc.card_id into owner_found,db_owner,stable_id from bunch_note_private.bunch_note_work_cards wc where wc.bunch_note_id=note_id and (wc.card_id=v_card_id or wc.card_key=bunch_note_private.card_key(c)) limit 1;
    if owner_found and jsonb_typeof(c->'owner_ids') is distinct from 'array' and nullif(c->>'owner_id','') is null then owner:=db_owner; select array_agg(ca.user_id order by ca.created_at,ca.user_id) into owner_ids from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=note_id and ca.card_id=stable_id; if owner_ids is null then owner_ids:=case when owner is null then '{}'::uuid[] else array[owner] end; end if; end if;
    if stable_id is not null then v_card_id:=stable_id; end if;
   end if;
  end if;
  foreach owner_value in array owner_ids loop if not bunch_note_private.active_card_owner(owner_value) or owner_value is null then raise exception 'BUNCH_NOTE_CARD_OWNER_INVALID'; end if; end loop;
  if p_prior is not null then
   old_card:=prior_id_index->v_card_id::text;
   if old_card is null then old_card:=prior_key_index->bunch_note_private.card_key(c); end if;
   if old_card is not null and (old_card->>'id')::uuid<>v_card_id then raise exception 'BUNCH_NOTE_CARD_ID_CHANGED'; end if;
   if owner_found and old_card is not null
      and old_card->'owner_ids' is not distinct from c->'owner_ids'
      and old_card->>'owner_id' is not distinct from c->>'owner_id' then
    select array_agg(ca.user_id order by (ca.user_id=db_owner) desc,ca.created_at,ca.user_id) into owner_ids
     from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=note_id and ca.card_id=stable_id;
    if owner_ids is null then owner_ids:=case when db_owner is null then '{}'::uuid[] else array[db_owner] end; end if;
    owner:=owner_ids[1];
   end if;
  end if;
  ids:=array_append(ids,v_card_id); keys:=array_append(keys,bunch_note_private.card_key(c));
  normalized:=normalized||jsonb_build_array(jsonb_build_object('id',v_card_id,'kind',kind_value,'location_code',upper(btrim(coalesce(c->>'location_code',p_entry->>'location'))),
   'itemcode',coalesce(c->>'itemcode',''),'commonname',coalesce(c->>'commonname',''),'contsize',coalesce(c->>'contsize',''),'row_ids',to_jsonb(coalesce(rows,'{}'::text[])),
   'owner_id',owner,'owner_name',(select p.display_name from public.profiles p where p.id=owner),'owner_ids',to_jsonb(owner_ids),
   'owner_names',coalesce((select jsonb_agg(p.display_name order by u.ord) from unnest(owner_ids) with ordinality u(id,ord) join public.profiles p on p.id=u.id),'[]'::jsonb),
   'house',coalesce(c->>'house',''),'direction',coalesce(c->>'direction',''),'workflow_action',route,'destination_location',destination_location,
   'destination_house',destination_house,'notes',card_notes));
 end loop;
 for r in select value from jsonb_array_elements(source_all) loop
  if (r->>'unique_id')=any(used) or exists(select 1 from jsonb_array_elements(normalized) x where x->>'kind'='shared' and x->'row_ids' ? (r->>'unique_id')) then selected_source:=selected_source||jsonb_build_array(r); end if;
 end loop;
 for r in select value from jsonb_array_elements(selected_source) loop
  if not((r->>'unique_id')=any(used)) and not exists(select 1 from jsonb_array_elements(normalized) x where x->>'kind'='shared' and x->'row_ids' ? (r->>'unique_id')) then raise exception 'BUNCH_NOTE_CARD_SOURCE_UNASSIGNED'; end if;
 end loop;
 for a in select value from jsonb_array_elements(coalesce(p_entry->'actions','[]'::jsonb)) loop
  if nullif(a->>'card_id','') is null then raise exception 'BUNCH_NOTE_ACTION_CARD_REQUIRED'; end if;
  if not exists(select 1 from jsonb_array_elements(normalized) x where x->>'id'=a->>'card_id') then
   select value into original_card from jsonb_array_elements(coalesce(p_entry->'cards','[]'::jsonb)) x where x->>'id'=a->>'card_id';
   if original_card is null then raise exception 'BUNCH_NOTE_ACTION_CARD_REQUIRED'; end if;
   select value into normalized_card from jsonb_array_elements(normalized) x where bunch_note_private.card_key(x)=bunch_note_private.card_key(original_card);
   if normalized_card is null then raise exception 'BUNCH_NOTE_ACTION_CARD_REQUIRED'; end if; a:=a||jsonb_build_object('card_id',normalized_card->'id');
  end if;
  if a->>'scope'='rows' and not exists(select 1 from jsonb_array_elements(normalized) x where x->>'id'=a->>'card_id' and x->'row_ids' @> coalesce(a->'row_ids','[]'::jsonb)) then raise exception 'BUNCH_NOTE_ACTION_CARD_ROWS_INVALID'; end if;
  if a->>'scope'='location' and coalesce((a->>'freeform')::boolean,false)=false and not exists(select 1 from jsonb_array_elements(normalized) x where x->>'id'=a->>'card_id'
   and x->'row_ids' @> (select coalesce(jsonb_agg(to_jsonb(uid)),'[]'::jsonb) from (select distinct jsonb_array_elements_text(card->'row_ids') uid from jsonb_array_elements(normalized) card where card->>'kind'='inventory') rowset)) then raise exception 'BUNCH_NOTE_ACTION_CARD_ROWS_INVALID'; end if;
 end loop;
 return normalized;
end $$;

create or replace function bunch_note_private.mirror_work_cards() returns trigger
language plpgsql security definer set search_path='' as $$
declare e jsonb; c jsonb; prior_card jsonb; prior_card_index jsonb; assignment_index jsonb; assignment_value jsonb;
 j bunch_note_private.jobs; note_id uuid; owner uuid; changed boolean; owners jsonb; owner_id uuid; prior_index_key text;
 instruction_index jsonb; prior_instruction_index jsonb;
begin
 if tg_table_name='batches' then
  for e in select value from jsonb_array_elements(coalesce(new.body->'locations','[]'::jsonb)) loop
   if coalesce((e->>'format_version')::integer,0)<5 then continue; end if;
   select id into note_id from bunch_note_private.bunch_notes where batch_id=new.id and location_code=e->>'location'; if note_id is null then continue; end if;
   prior_card_index:='{}'::jsonb;
   if tg_op='UPDATE' then
    select coalesce(jsonb_object_agg(q.index_key,q.card_value),'{}'::jsonb) into prior_card_index from (
     select distinct on (jsonb_build_array(le.value->>'location',card.value->>'id')::text)
      jsonb_build_array(le.value->>'location',card.value->>'id')::text index_key,card.value card_value
     from jsonb_array_elements(coalesce(old.body->'locations','[]'::jsonb)) with ordinality le(value,location_ord)
     cross join lateral jsonb_array_elements(coalesce(le.value->'cards','[]'::jsonb)) with ordinality card(value,card_ord)
     order by jsonb_build_array(le.value->>'location',card.value->>'id')::text,le.location_ord,card.card_ord
    ) q;
   end if;
   select coalesce(jsonb_object_agg(q.card_id,jsonb_build_object('owner_id',q.owner_id,'owner_ids',
     coalesce(q.owner_ids,case when q.owner_id is null then '[]'::jsonb else jsonb_build_array(q.owner_id) end))),'{}'::jsonb)
    into assignment_index from (
     select wc.card_id::text card_id,wc.owner_id,
      jsonb_agg(ca.user_id order by (ca.user_id=wc.owner_id) desc,ca.created_at,ca.user_id) filter(where ca.user_id is not null) owner_ids
     from bunch_note_private.bunch_note_work_cards wc left join bunch_note_private.bunch_note_card_assignees ca
      on ca.bunch_note_id=wc.bunch_note_id and ca.card_id=wc.card_id
     where wc.bunch_note_id=note_id group by wc.card_id,wc.owner_id
    ) q;
   for c in select value from jsonb_array_elements(e->'cards') loop
    owner:=nullif(c->>'owner_id','')::uuid; owners:=coalesce(c->'owner_ids','[]'::jsonb);
    if tg_op='UPDATE' then
     prior_index_key:=jsonb_build_array(e->>'location',c->>'id')::text; prior_card:=prior_card_index->prior_index_key;
     if prior_card is not null and prior_card->'owner_ids' is not distinct from c->'owner_ids' and prior_card->>'owner_id' is not distinct from c->>'owner_id' then
      assignment_value:=assignment_index->(c->>'id');
      owner:=nullif(assignment_value->>'owner_id','')::uuid;
      owners:=coalesce(assignment_value->'owner_ids',case when owner is null then '[]'::jsonb else jsonb_build_array(owner) end);
     end if;
    end if;
    insert into bunch_note_private.bunch_note_work_cards(bunch_note_id,card_id,card_key,kind,location_code,itemcode,commonname,contsize,row_ids,owner_id,house,direction,workflow_action,destination_location,destination_house,notes)
    values(note_id,(c->>'id')::uuid,bunch_note_private.card_key(c),c->>'kind',e->>'location',c->>'itemcode',c->>'commonname',c->>'contsize',c->'row_ids',owner,coalesce(c->>'house',''),coalesce(c->>'direction',''),coalesce(c->>'workflow_action',''),coalesce(c->>'destination_location',''),coalesce(c->>'destination_house',''),coalesce(c->>'notes',''))
    on conflict(bunch_note_id,card_id) do update set card_key=excluded.card_key,kind=excluded.kind,location_code=excluded.location_code,itemcode=excluded.itemcode,commonname=excluded.commonname,contsize=excluded.contsize,row_ids=excluded.row_ids,owner_id=excluded.owner_id,house=excluded.house,direction=excluded.direction,workflow_action=excluded.workflow_action,destination_location=excluded.destination_location,destination_house=excluded.destination_house,notes=excluded.notes,updated_at=now(),active=true,status=case when bunch_note_work_cards.status='retired' then 'open' else bunch_note_work_cards.status end,revision=bunch_note_work_cards.revision+1;
    delete from bunch_note_private.bunch_note_card_assignees where bunch_note_id=note_id and card_id=(c->>'id')::uuid;
    for owner_id in select jsonb_array_elements_text(owners)::uuid loop
     insert into bunch_note_private.bunch_note_card_assignees(bunch_note_id,card_id,user_id,created_by) values(note_id,(c->>'id')::uuid,owner_id,new.created_by) on conflict do nothing;
    end loop;
   end loop;
   update bunch_note_private.bunch_note_work_cards wc set active=false,status='retired',revision=revision+1,updated_at=now() where wc.bunch_note_id=note_id and wc.active and not exists(select 1 from jsonb_array_elements(e->'cards') x where x->>'id'=wc.card_id::text);
  end loop;
 else
  j:=new; if coalesce((j.body->>'format_version')::integer,0)<5 then return new; end if;
  select id into note_id from bunch_note_private.bunch_notes where job_id=j.id; if note_id is null then return new; end if;
  prior_card_index:='{}'::jsonb;
  if tg_op='UPDATE' then
   select coalesce(jsonb_object_agg(q.card_id,q.card_value),'{}'::jsonb) into prior_card_index from (
    select distinct on (x.value->>'id') x.value->>'id' card_id,x.value card_value
    from jsonb_array_elements(coalesce(old.body->'cards','[]'::jsonb)) with ordinality x(value,ordinality)
    where nullif(x.value->>'id','') is not null order by x.value->>'id',x.ordinality
   ) q;
  end if;
  instruction_index:=bunch_note_private.card_instruction_snapshot_map(j.body);
  if tg_op='UPDATE' then prior_instruction_index:=bunch_note_private.card_instruction_snapshot_map(old.body); else prior_instruction_index:='{}'::jsonb; end if;
  select coalesce(jsonb_object_agg(q.card_id,jsonb_build_object('owner_id',q.owner_id,'owner_ids',
    coalesce(q.owner_ids,case when q.owner_id is null then '[]'::jsonb else jsonb_build_array(q.owner_id) end))),'{}'::jsonb)
   into assignment_index from (
    select wc.card_id::text card_id,wc.owner_id,
     jsonb_agg(ca.user_id order by (ca.user_id=wc.owner_id) desc,ca.created_at,ca.user_id) filter(where ca.user_id is not null) owner_ids
    from bunch_note_private.bunch_note_work_cards wc left join bunch_note_private.bunch_note_card_assignees ca
     on ca.bunch_note_id=wc.bunch_note_id and ca.card_id=wc.card_id
    where wc.bunch_note_id=note_id group by wc.card_id,wc.owner_id
   ) q;
  for c in select value from jsonb_array_elements(j.body->'cards') loop
   if tg_op='INSERT' then changed:=true; else changed:=prior_instruction_index->(c->>'id') is distinct from instruction_index->(c->>'id'); end if;
   owner:=nullif(c->>'owner_id','')::uuid; owners:=coalesce(c->'owner_ids','[]'::jsonb);
   if tg_op='UPDATE' then
    prior_card:=prior_card_index->(c->>'id');
    if prior_card is not null and prior_card->'owner_ids' is not distinct from c->'owner_ids' and prior_card->>'owner_id' is not distinct from c->>'owner_id' then
     assignment_value:=assignment_index->(c->>'id');
     owner:=nullif(assignment_value->>'owner_id','')::uuid;
     owners:=coalesce(assignment_value->'owner_ids',case when owner is null then '[]'::jsonb else jsonb_build_array(owner) end);
    end if;
   end if;
   insert into bunch_note_private.bunch_note_work_cards(bunch_note_id,card_id,card_key,kind,location_code,itemcode,commonname,contsize,row_ids,owner_id,house,direction,workflow_action,destination_location,destination_house,notes)
    values(note_id,(c->>'id')::uuid,bunch_note_private.card_key(c),c->>'kind',j.location,c->>'itemcode',c->>'commonname',c->>'contsize',c->'row_ids',owner,coalesce(c->>'house',''),coalesce(c->>'direction',''),coalesce(c->>'workflow_action',''),coalesce(c->>'destination_location',''),coalesce(c->>'destination_house',''),coalesce(c->>'notes',''))
   on conflict(bunch_note_id,card_id) do update set card_key=excluded.card_key,kind=excluded.kind,location_code=excluded.location_code,itemcode=excluded.itemcode,commonname=excluded.commonname,contsize=excluded.contsize,row_ids=excluded.row_ids,owner_id=excluded.owner_id,house=excluded.house,direction=excluded.direction,workflow_action=excluded.workflow_action,destination_location=excluded.destination_location,destination_house=excluded.destination_house,notes=excluded.notes,active=true,status=case when bunch_note_work_cards.status='retired' or (bunch_note_work_cards.status='complete' and changed) then 'open' else bunch_note_work_cards.status end,updated_at=now(),revision=bunch_note_work_cards.revision+1;
   delete from bunch_note_private.bunch_note_card_assignees where bunch_note_id=note_id and card_id=(c->>'id')::uuid;
   for owner_id in select jsonb_array_elements_text(owners)::uuid loop insert into bunch_note_private.bunch_note_card_assignees(bunch_note_id,card_id,user_id,created_by) values(note_id,(c->>'id')::uuid,owner_id,new.created_by) on conflict do nothing; end loop;
  end loop;
  update bunch_note_private.bunch_note_work_cards wc set active=false,status='retired',revision=revision+1,updated_at=now() where wc.bunch_note_id=note_id and wc.active and not exists(select 1 from jsonb_array_elements(j.body->'cards') x where x->>'id'=wc.card_id::text);
 end if;
 return new;
end $$;

create or replace function bunch_note_private.card_safe_job(p_job bunch_note_private.jobs,p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare author boolean; note_id uuid; cards jsonb:='[]'; definitions jsonb:='[]'; actions jsonb:='[]'; all_actions jsonb:='[]'; source jsonb:='[]'; progress_json jsonb:='{}';
 worker_actions_json jsonb:='[]'; actuals_json jsonb:='[]'; audit_json jsonb:='[]'; card_ids uuid[]:='{}'; action_ids text[]:='{}'; row_ids text[]:='{}';
 c record; entry_row record; base jsonb; body_json jsonb; card_value jsonb;
begin
 author:=exists(select 1 from public.profiles p where p.id=p_actor and p.username='dylan_collyge');
 select n.id into note_id from bunch_note_private.bunch_notes n where n.job_id=(p_job).id;
 if note_id is null then
  if coalesce(((p_job).body->>'format_version')::integer,0)>=5 then raise exception 'BUNCH_NOTE_CARD_STATE_INVALID' using errcode='42501'; end if;
  return bunch_note_private.job_json(p_job);
 end if;
 for c in select wc.*,p.display_name owner_name from bunch_note_private.bunch_note_work_cards wc
  left join public.profiles p on p.id=wc.owner_id
  where wc.bunch_note_id=note_id and (wc.active or (author and (p_job).status='cancelled'))
   and (author or exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=wc.bunch_note_id and ca.card_id=wc.card_id and ca.user_id=p_actor) or wc.owner_id=p_actor or (wc.owner_id is null and not exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=wc.bunch_note_id and ca.card_id=wc.card_id) and wc.status='open' and (p_job).status='open'))
  order by wc.kind,wc.location_code,wc.commonname,wc.itemcode,wc.contsize,wc.card_id loop
  card_ids:=array_append(card_ids,c.card_id);
  row_ids:=row_ids||array(select jsonb_array_elements_text(c.row_ids));
  select value into card_value from jsonb_array_elements(coalesce((p_job).body->'cards','[]')) where value->>'id'=c.card_id::text;
  cards:=cards||jsonb_build_array(coalesce(card_value,'{}'::jsonb)||jsonb_build_object(
   'id',c.card_id,'kind',c.kind,'location_code',c.location_code,'itemcode',c.itemcode,'commonname',c.commonname,
   'contsize',c.contsize,'row_ids',c.row_ids,'owner_id',c.owner_id,'owner_name',c.owner_name,
   'owner_ids',coalesce((select jsonb_agg(ca.user_id order by (ca.user_id=c.owner_id) desc,ca.created_at,ca.user_id) from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=note_id and ca.card_id=c.card_id),case when c.owner_id is null then '[]'::jsonb else jsonb_build_array(c.owner_id) end),
   'owner_names',coalesce((select jsonb_agg(p.display_name order by (ca.user_id=c.owner_id) desc,ca.created_at,ca.user_id) from bunch_note_private.bunch_note_card_assignees ca join public.profiles p on p.id=ca.user_id where ca.bunch_note_id=note_id and ca.card_id=c.card_id),case when c.owner_name is null then '[]'::jsonb else jsonb_build_array(c.owner_name) end),
   'house',c.house,'direction',c.direction,'workflow_action',coalesce(c.workflow_action,''),'destination_location',coalesce(c.destination_location,''),'destination_house',coalesce(c.destination_house,''),'notes',coalesce(c.notes,''),
   'status',c.status,'revision',c.revision));
 end loop;
 if not author and cardinality(card_ids)=0 then raise exception 'BUNCH_NOTE_NOT_FOUND' using errcode='42501'; end if;
 select coalesce(jsonb_agg(q.a order by q.ord),'[]') into all_actions from (
  select value a,ordinality ord from jsonb_array_elements(bunch_note_private.card_actions(p_job)) with ordinality
 ) q where author or q.a->>'card_id'=any(array(select unnest(card_ids)::text));
  select coalesce(jsonb_agg(q.a order by q.ord),'[]') into actions from (
   select value a,ordinality ord from jsonb_array_elements(all_actions) with ordinality
  ) q where not coalesce((q.a->>'worker_added')::boolean,false);
 select coalesce(array_agg(action_items.value->>'id'),'{}') into action_ids from jsonb_array_elements(all_actions) as action_items(value);
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
   or (h.action_snapshot->>'scope'='rows' and case when jsonb_typeof(h.action_snapshot->'row_ids')='array'
     then jsonb_array_length(h.action_snapshot->'row_ids')>0 else false end
    and exists(select 1 from unnest(card_ids) ac join bunch_note_private.bunch_note_work_cards wc on wc.bunch_note_id=note_id and wc.card_id=ac
     where wc.row_ids @> (h.action_snapshot->'row_ids'))));
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

create or replace function bunch_note_private.card_destination_view(p_actor public.profiles,p_location text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare j bunch_note_private.jobs; item jsonb; act jsonb; actual jsonb; safe jsonb; locs text[]; dest text:=nullif(upper(btrim(p_location)),'');
 jobs_json jsonb:='[]'; incoming jsonb:='[]'; matching_actuals jsonb; targets jsonb; planned text;
begin
 select array_agg(distinct upper(btrim(locationcode))) into locs from public.ph_master_inventory where nullif(btrim(locationcode),'') is not null;
 for j in select job.* from bunch_note_private.jobs job
  where (coalesce((job.body->>'format_version')::integer,0)>=5 and exists(
    select 1 from bunch_note_private.bunch_notes n join bunch_note_private.bunch_note_work_cards wc on wc.bunch_note_id=n.id
    where n.job_id=job.id and (p_actor.username='dylan_collyge' or (wc.active and (exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=wc.bunch_note_id and ca.card_id=wc.card_id and ca.user_id=p_actor.id) or wc.owner_id=p_actor.id or (wc.owner_id is null and not exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=wc.bunch_note_id and ca.card_id=wc.card_id) and wc.status='open' and job.status='open'))))))
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

revoke all on function bunch_note_private.card_allowed(uuid,bunch_note_private.jobs,uuid),bunch_note_private.normalize_work_cards(jsonb,jsonb),
 bunch_note_private.mirror_work_cards(),bunch_note_private.card_safe_job(bunch_note_private.jobs,uuid) from public,anon,authenticated,service_role;

create or replace function bunch_note_private.card_command(p_actor uuid,p_operation text,p_payload jsonb default '{}'::jsonb,
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
    where n.job_id=j.id and (author or (wc.active and (exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=wc.bunch_note_id and ca.card_id=wc.card_id and ca.user_id=actor.id) or wc.owner_id=actor.id or (wc.owner_id is null and not exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=wc.bunch_note_id and ca.card_id=wc.card_id) and wc.status='open' and j.status='open'))))))
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
  if not author and nullif(p_payload->>'job_id','') is not null then
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
  update bunch_note_private.bunch_note_work_cards wc set status='retired',active=false,revision=wc.revision+1,updated_at=now()
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
   if p_payload ? 'owner_ids' and jsonb_typeof(p_payload->'owner_ids') is distinct from 'array' then raise exception 'BUNCH_NOTE_CARD_OWNER_INVALID'; end if;
   if jsonb_typeof(p_payload->'owner_ids')='array' then
    if jsonb_array_length(p_payload->'owner_ids')>20 or jsonb_array_length(p_payload->'owner_ids')<>(select count(distinct value) from jsonb_array_elements_text(p_payload->'owner_ids')) then raise exception 'BUNCH_NOTE_CARD_OWNER_INVALID'; end if;
    delete from bunch_note_private.bunch_note_card_assignees where bunch_note_id=note_id and card_id=v_card_id;
    for owner in select jsonb_array_elements_text(p_payload->'owner_ids')::uuid loop
     if owner is null or not bunch_note_private.active_card_owner(owner) then raise exception 'BUNCH_NOTE_CARD_OWNER_INVALID'; end if;
     insert into bunch_note_private.bunch_note_card_assignees(bunch_note_id,card_id,user_id,created_by) values(note_id,v_card_id,owner,actor.id) on conflict do nothing;
    end loop;
    owner:=nullif(p_payload->'owner_ids'->>0,'')::uuid;
   else
    if owner is not null and not bunch_note_private.active_card_owner(owner) then raise exception 'BUNCH_NOTE_CARD_OWNER_INVALID'; end if;
    delete from bunch_note_private.bunch_note_card_assignees where bunch_note_id=note_id and card_id=v_card_id;
    if owner is not null then insert into bunch_note_private.bunch_note_card_assignees(bunch_note_id,card_id,user_id,created_by) values(note_id,v_card_id,owner,actor.id); end if;
   end if;
   update bunch_note_private.bunch_note_work_cards set owner_id=owner,revision=revision+1,updated_at=now() where bunch_note_id=note_id and card_id=v_card_id returning * into card;
  elsif p_operation='claim_card' then
   if job.status<>'open' or card.status<>'open' or card.owner_id is not null or exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=note_id and ca.card_id=v_card_id) then raise exception 'BUNCH_NOTE_ALREADY_CLAIMED'; end if;
   insert into bunch_note_private.bunch_note_card_assignees(bunch_note_id,card_id,user_id,created_by) values(note_id,v_card_id,actor.id,actor.id);
   update bunch_note_private.bunch_note_work_cards set owner_id=actor.id,revision=revision+1,updated_at=now() where bunch_note_id=note_id and card_id=v_card_id returning * into card;
  elsif p_operation='release_card' then
   if job.status<>'open' or card.status<>'open' or (not exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=note_id and ca.card_id=v_card_id and ca.user_id=actor.id) and card.owner_id is distinct from actor.id and not author) then raise exception 'BUNCH_NOTE_OWNER_ONLY' using errcode='42501'; end if;
   if author then
    delete from bunch_note_private.bunch_note_card_assignees where bunch_note_id=note_id and card_id=v_card_id; owner:=null;
   else
    delete from bunch_note_private.bunch_note_card_assignees where bunch_note_id=note_id and card_id=v_card_id and user_id=actor.id;
    select ca.user_id into owner from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=note_id and ca.card_id=v_card_id order by (ca.user_id=card.owner_id) desc,ca.created_at,ca.user_id limit 1;
   end if;
   update bunch_note_private.bunch_note_work_cards set owner_id=owner,revision=revision+1,updated_at=now() where bunch_note_id=note_id and card_id=v_card_id returning * into card;
  else
   if not exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=note_id and ca.card_id=v_card_id and ca.user_id=actor.id) and card.owner_id is distinct from actor.id and not (author and p_operation='actual' and nullif(p_payload->>'replaces_id','') is not null) then raise exception 'BUNCH_NOTE_OWNER_ONLY' using errcode='42501'; end if;
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
    if (action->>'scope')='rows' and not(card.row_ids @> (action->'row_ids')) then raise exception 'BUNCH_NOTE_ACTION_CARD_ROWS_INVALID'; end if;
    action:=bunch_note_private.validate_action(action,(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(bunch_note_private.work_source(job)) r where card.row_ids ? (r->>'unique_id')));
    perform bunch_note_private.validate_destination(action,bunch_note_private.work_source(job));
    action:=(action-'quantity'-'percentage')||jsonb_build_object('card_id',v_card_id,'worker_added',true,'actor_id',actor.id,'created_at',now(),
     'destination',upper(btrim(coalesce(action->>'destination',''))),'source_snapshot',(select coalesce(jsonb_agg(r),'[]') from jsonb_array_elements(bunch_note_private.work_source(job)) r where card.row_ids ? (r->>'unique_id')));
    insert into bunch_note_private.worker_actions(job_id,action,actor_id) values(job.id,action,actor.id);
   elsif p_operation='option_add' then
    insert into bunch_note_private.options(category,label,kind,created_by) values(p_payload->>'category',btrim(p_payload->>'label'),p_payload->>'kind',actor.id) returning * into option_value;
   end if;
   if p_operation='complete_card' then
    if (not exists(select 1 from bunch_note_private.bunch_note_card_assignees ca where ca.bunch_note_id=note_id and ca.card_id=v_card_id and ca.user_id=actor.id) and card.owner_id is distinct from actor.id) or job.status<>'open' or card.status<>'open' then raise exception 'BUNCH_NOTE_OWNER_ONLY' using errcode='42501'; end if;
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
  if p_operation='release_card' and not author and not exists(select 1 from bunch_note_private.bunch_note_work_cards wc where wc.bunch_note_id=note_id and wc.active and bunch_note_private.card_allowed(actor.id,job,wc.card_id)) then
   result:=jsonb_build_object('released',true,'job_id',job.id,'card_id',v_card_id);
  else
   result:=jsonb_build_object('job',bunch_note_private.card_safe_job(job,actor.id));
  end if;
  if p_operation='option_add' then result:=result||jsonb_build_object('option',to_jsonb(option_value)); end if;
 end if;
 insert into bunch_note_private.commands(id,actor_id,request,response) values(p_command_id,actor.id,request,result);
 return result;
end $$;
REVOKE ALL ON FUNCTION bunch_note_private.card_command(uuid,text,jsonb,uuid,bigint) FROM public,anon,authenticated,service_role;



create or replace function bunch_note_private.card_instruction_snapshot(p_body jsonb,p_card_id uuid) returns jsonb
language plpgsql immutable set search_path='' as $$
declare card jsonb; card_actions jsonb;
begin
 select value into card from jsonb_array_elements(coalesce(p_body->'cards','[]'::jsonb))
  where value->>'id'=p_card_id::text;
 if card is null then return null; end if;
 select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into card_actions
  from jsonb_array_elements(coalesce(p_body->'actions','[]'::jsonb)) with ordinality
  where value->>'card_id'=p_card_id::text;
 return jsonb_build_object('global',jsonb_build_object('purposes',p_body->'purposes','instructions',p_body->'instructions',
   'prerequisites',p_body->'prerequisites','priority',p_body->'priority','target_houses',p_body->'target_houses',
   'direction',p_body->'direction'),
  'card',card-'owner_id'-'owner_name'-'owner_ids'-'owner_names','actions',card_actions);
end $$;

create or replace function bunch_note_private.card_instruction_snapshot_map(p_body jsonb) returns jsonb
language sql immutable set search_path='' as $$
 with global_values as (
  select jsonb_build_object('purposes',p_body->'purposes','instructions',p_body->'instructions','prerequisites',p_body->'prerequisites',
   'priority',p_body->'priority','target_houses',p_body->'target_houses','direction',p_body->'direction') value
 ), cards as (
  select distinct on (c.value->>'id') c.value->>'id' card_id,c.value card_value
  from jsonb_array_elements(coalesce(p_body->'cards','[]'::jsonb)) with ordinality c(value,ordinality)
  where nullif(c.value->>'id','') is not null order by c.value->>'id',c.ordinality
 ), actions as (
  select a.value->>'card_id' card_id,jsonb_agg(a.value order by a.ordinality) card_actions
  from jsonb_array_elements(coalesce(p_body->'actions','[]'::jsonb)) with ordinality a(value,ordinality)
  where nullif(a.value->>'card_id','') is not null group by a.value->>'card_id'
 )
 select coalesce(jsonb_object_agg(c.card_id,jsonb_build_object('global',g.value,
  'card',c.card_value-'owner_id'-'owner_name'-'owner_ids'-'owner_names','actions',coalesce(a.card_actions,'[]'::jsonb))),'{}'::jsonb)
 from cards c cross join global_values g left join actions a on a.card_id=c.card_id
$$;
revoke all on function bunch_note_private.card_instruction_snapshot_map(jsonb) from public,anon,authenticated,service_role;


-- Preserve established saves while indexing source membership and itemcode siblings once per location.
CREATE OR REPLACE FUNCTION bunch_note_private.bunch_note_command_legacy(p_actor_id uuid, p_operation text, p_payload jsonb DEFAULT '{}'::jsonb, p_command_id uuid DEFAULT NULL::uuid, p_expected_revision bigint DEFAULT NULL::bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
 actor public.profiles; author boolean; batch bunch_note_private.batches; job bunch_note_private.jobs;
 preview bunch_note_private.previews; prior bunch_note_private.commands;
 body jsonb; entry jsonb; act jsonb; row_value jsonb; source jsonb; source_id_index jsonb; selected_row_index jsonb; selected_itemcodes text[]; reports jsonb:='[]';
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
   select coalesce(jsonb_object_agg(r->>'unique_id',true),'{}'::jsonb) into source_id_index
    from jsonb_array_elements(source) r where nullif(r->>'unique_id','') is not null;
   if exists(select 1 from jsonb_array_elements(entry->'row_ids') selected(value)
     where jsonb_typeof(selected.value) is distinct from 'string' or not(source_id_index ? (selected.value #>> '{}')))
    then raise exception 'BUNCH_NOTE_SOURCE_CHANGED'; end if;
   select coalesce(jsonb_object_agg(selected.value #>> '{}',true),'{}'::jsonb) into selected_row_index
    from jsonb_array_elements(entry->'row_ids') selected(value);
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
   select coalesce(array_agg(distinct upper(btrim(r->>'itemcode')))
     filter(where nullif(btrim(r->>'itemcode'),'') is not null),'{}'::text[]) into selected_itemcodes
    from jsonb_array_elements(source) r where selected_row_index ? (r->>'unique_id');
   snapshot:=(select coalesce(jsonb_agg(r order by r->>'unique_id'),'[]'::jsonb) from jsonb_array_elements(source) r
    where selected_row_index ? (r->>'unique_id')
       or (nullif(btrim(r->>'itemcode'),'') is not null and upper(btrim(r->>'itemcode'))=any(selected_itemcodes)));
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
revoke all on function bunch_note_private.bunch_note_command_legacy(uuid,text,jsonb,uuid,bigint) from public,anon,authenticated,service_role;

commit;
