begin;

-- Operational ownership and completion are independent from immutable note
-- instructions. The rows are private and only SECURITY DEFINER commands write.
create table bunch_note_private.bunch_note_work_cards (
 bunch_note_id uuid not null references bunch_note_private.bunch_notes(id) on delete cascade,
 card_id uuid not null,
 card_key text not null,
 kind text not null check(kind in ('inventory','shared')),
 location_code text not null,
 itemcode text not null default '',
 commonname text not null default '',
 contsize text not null default '',
 row_ids jsonb not null default '[]'::jsonb check(jsonb_typeof(row_ids)='array'),
 owner_id uuid references public.profiles(id),
 house text not null default '',
 direction text not null default '',
 status text not null default 'open' check(status in ('open','complete','retired')),
 active boolean not null default true,
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(bunch_note_id,card_id),
 unique(bunch_note_id,card_key),
 check(length(card_key) between 1 and 200),
 check(length(location_code) between 1 and 100),
 check(length(house)<=200 and length(direction)<=200)
);
create index bunch_note_work_cards_owner on bunch_note_private.bunch_note_work_cards(owner_id,active,status);
create index bunch_note_work_cards_location on bunch_note_private.bunch_note_work_cards(location_code,active);
alter table bunch_note_private.bunch_note_work_cards enable row level security;
revoke all on bunch_note_private.bunch_note_work_cards from public,anon,authenticated,service_role;

create function bunch_note_private.active_card_owner(p_owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_owner is null or exists(select 1 from public.profiles p where p.id=p_owner and p.disabled_at is null
  and p.must_change_password is false and (p.locked_until is null or p.locked_until<=now()))
$$;

create function bunch_note_private.card_key(p_card jsonb) returns text
language sql immutable set search_path='' as $$
 select case when p_card->>'kind'='shared' then 'shared'
  else 'inventory:'||md5(upper(regexp_replace(btrim(coalesce(p_card->>'location_code','')),'\s+',' ','g'))||E'\x1f'||
   upper(regexp_replace(btrim(coalesce(p_card->>'itemcode','')),'\s+',' ','g'))||E'\x1f'||
   upper(regexp_replace(btrim(coalesce(p_card->>'commonname','')),'\s+',' ','g'))||E'\x1f'||
   upper(regexp_replace(btrim(coalesce(p_card->>'contsize','')),'\s+',' ','g'))) end
$$;

create function bunch_note_private.normalize_work_cards(p_entry jsonb,p_prior jsonb default null) returns jsonb
language plpgsql stable set search_path='' as $$
declare c jsonb; a jsonb; normalized jsonb:='[]'; ids uuid[]:='{}'; keys text[]:='{}';
 rows text[]; expected_rows text[]; used text[]:='{}'; source jsonb; source_all jsonb; group_source jsonb; selected_source jsonb:='[]'; r jsonb;
 old_card jsonb; original_card jsonb; normalized_card jsonb; v_card_id uuid; stable_id uuid; owner uuid; db_owner uuid; key_value text; kind_value text; linked_job uuid; v_batch_id uuid; note_id uuid; owner_found boolean;
begin
 if jsonb_typeof(p_entry->'cards') is distinct from 'array' or jsonb_array_length(p_entry->'cards')>100 then
  raise exception 'BUNCH_NOTE_CARDS_REQUIRED';
 end if;
 source:=coalesce(p_entry->'source','[]'::jsonb);
 if jsonb_typeof(source) is distinct from 'array' then raise exception 'BUNCH_NOTE_SOURCE_INVALID'; end if;
 source_all:=coalesce(p_entry->'source_all',source);
 if jsonb_typeof(source_all) is distinct from 'array' then raise exception 'BUNCH_NOTE_SOURCE_INVALID'; end if;
 for c in select value from jsonb_array_elements(p_entry->'cards') loop
  if jsonb_typeof(c) is distinct from 'object' then raise exception 'BUNCH_NOTE_CARD_INVALID'; end if;
  begin v_card_id:=(c->>'id')::uuid; exception when others then raise exception 'BUNCH_NOTE_CARD_INVALID'; end;
  kind_value:=c->>'kind'; key_value:=bunch_note_private.card_key(c);
  if v_card_id is null or kind_value is null or v_card_id=any(ids) or key_value=any(keys) or kind_value not in ('inventory','shared')
   or upper(btrim(coalesce(c->>'location_code',p_entry->>'location','')))<>upper(btrim(p_entry->>'location'))
   or length(coalesce(c->>'house',''))>200 or length(coalesce(c->>'direction',''))>200
   or jsonb_typeof(c->'row_ids') is distinct from 'array' then raise exception 'BUNCH_NOTE_CARD_INVALID'; end if;
  if kind_value='inventory' and (jsonb_array_length(c->'row_ids')=0 or length(coalesce(c->>'itemcode',''))>200
    or length(coalesce(c->>'commonname',''))>500 or length(coalesce(c->>'contsize',''))>200) then
   raise exception 'BUNCH_NOTE_CARD_INVALID';
  end if;
  select array_agg(value order by value) into rows from jsonb_array_elements_text(c->'row_ids');
  if rows is null then rows:='{}'; end if;
  if cardinality(rows)<>cardinality(array(select distinct u from unnest(rows) as u)) then raise exception 'BUNCH_NOTE_CARD_ROWS_INVALID'; end if;
  foreach key_value in array rows loop
   if not exists(select 1 from jsonb_array_elements(source_all) x where x->>'unique_id'=key_value) then raise exception 'BUNCH_NOTE_CARD_SOURCE_INVALID'; end if;
   if kind_value='inventory' and key_value=any(used) then raise exception 'BUNCH_NOTE_CARD_OVERLAP'; end if;
  end loop;
  if kind_value='inventory' then
   group_source:=source_all;
   if nullif(p_entry->>'block','') is not null then
    group_source:=bunch_note_private.inventory(upper(btrim(p_entry->>'block')),upper(btrim(p_entry->>'location')));
   end if;
   select array_agg(x->>'unique_id' order by x->>'unique_id') into expected_rows
    from jsonb_array_elements(group_source) x
    where upper(regexp_replace(btrim(coalesce(x->>'locationcode','')),'\s+',' ','g'))=upper(regexp_replace(btrim(c->>'location_code'),'\s+',' ','g'))
     and upper(regexp_replace(btrim(coalesce(x->>'itemcode','')),'\s+',' ','g'))=upper(regexp_replace(btrim(c->>'itemcode'),'\s+',' ','g'))
     and lower(regexp_replace(btrim(coalesce(x->>'commonname','')),'\s+',' ','g'))=lower(regexp_replace(btrim(c->>'commonname'),'\s+',' ','g'))
     and lower(regexp_replace(btrim(coalesce(x->>'contsize','')),'\s+',' ','g'))=lower(regexp_replace(btrim(c->>'contsize'),'\s+',' ','g'));
   if coalesce(expected_rows,'{}'::text[])<>coalesce(rows,'{}'::text[]) then raise exception 'BUNCH_NOTE_CARD_GROUP_CHANGED'; end if;
  end if;
  if kind_value='inventory' then used:=used||rows; end if;
  owner:=nullif(c->>'owner_id','')::uuid;
  v_batch_id:=nullif(p_entry->>'batch_id','')::uuid;
  if v_batch_id is not null then
   select n.id into note_id from bunch_note_private.bunch_notes n where n.batch_id=v_batch_id and n.location_code=upper(btrim(p_entry->>'location'));
   stable_id:=null;
   if note_id is not null then select wc.card_id into stable_id from bunch_note_private.bunch_note_work_cards wc
     where wc.bunch_note_id=note_id and wc.card_key=bunch_note_private.card_key(c) limit 1; end if;
   if stable_id is not null then v_card_id:=stable_id; end if;
  end if;
  linked_job:=nullif(p_entry->>'job_id','')::uuid;
  if linked_job is not null then
   select n.id into note_id from bunch_note_private.bunch_notes n where n.job_id=linked_job;
   if note_id is not null then
    stable_id:=null; owner_found:=false; db_owner:=null;
    select true,wc.owner_id,wc.card_id into owner_found,db_owner,stable_id from bunch_note_private.bunch_note_work_cards wc
     where wc.bunch_note_id=note_id and (wc.card_id=v_card_id or wc.card_key=bunch_note_private.card_key(c)) limit 1;
    if owner_found then owner:=db_owner; end if;
    if stable_id is not null then v_card_id:=stable_id; end if;
   end if;
  end if;
  if not bunch_note_private.active_card_owner(owner) then raise exception 'BUNCH_NOTE_CARD_OWNER_INVALID'; end if;
  if p_prior is not null then
   select value into old_card from jsonb_array_elements(coalesce(p_prior->'cards','[]'::jsonb)) where value->>'id'=v_card_id::text;
   if old_card is null then
    select value into old_card from jsonb_array_elements(coalesce(p_prior->'cards','[]'::jsonb)) where bunch_note_private.card_key(value)=bunch_note_private.card_key(c);
   end if;
   if old_card is not null and (old_card->>'id')::uuid<>v_card_id then raise exception 'BUNCH_NOTE_CARD_ID_CHANGED'; end if;
  end if;
  ids:=array_append(ids,v_card_id); keys:=array_append(keys,bunch_note_private.card_key(c));
  normalized:=normalized||jsonb_build_array(jsonb_build_object('id',v_card_id,'kind',kind_value,
   'location_code',upper(btrim(coalesce(c->>'location_code',p_entry->>'location'))),
   'itemcode',coalesce(c->>'itemcode',''),'commonname',coalesce(c->>'commonname',''),
   'contsize',coalesce(c->>'contsize',''),'row_ids',to_jsonb(coalesce(rows,'{}'::text[])),
   'owner_id',owner,'owner_name',(select p.display_name from public.profiles p where p.id=owner),
   'house',coalesce(c->>'house',''),'direction',coalesce(c->>'direction','')));
 end loop;
 -- The exact selected row snapshot is derived from the validated card set, never
 -- from a client-selected broad itemcode expansion.
 for r in select value from jsonb_array_elements(source_all) loop
  if (r->>'unique_id')=any(used) or exists(select 1 from jsonb_array_elements(normalized) x
    where x->>'kind'='shared' and x->'row_ids' ? (r->>'unique_id')) then selected_source:=selected_source||jsonb_build_array(r); end if;
 end loop;
 -- Every selected source row belongs to exactly one inventory card or to the shared card.
 for r in select value from jsonb_array_elements(selected_source) loop
  if not((r->>'unique_id')=any(used)) and not exists(
   select 1 from jsonb_array_elements(normalized) x where x->>'kind'='shared' and x->'row_ids' ? (r->>'unique_id')) then
   raise exception 'BUNCH_NOTE_CARD_SOURCE_UNASSIGNED';
  end if;
 end loop;
 for a in select value from jsonb_array_elements(coalesce(p_entry->'actions','[]'::jsonb)) loop
  if nullif(a->>'card_id','') is null then raise exception 'BUNCH_NOTE_ACTION_CARD_REQUIRED'; end if;
  if not exists(select 1 from jsonb_array_elements(normalized) x where x->>'id'=a->>'card_id') then
   select value into original_card from jsonb_array_elements(coalesce(p_entry->'cards','[]'::jsonb)) x where x->>'id'=a->>'card_id';
   if original_card is null then raise exception 'BUNCH_NOTE_ACTION_CARD_REQUIRED'; end if;
   select value into normalized_card from jsonb_array_elements(normalized) x
    where bunch_note_private.card_key(x)=bunch_note_private.card_key(original_card);
   if normalized_card is null then raise exception 'BUNCH_NOTE_ACTION_CARD_REQUIRED'; end if;
   a:=a||jsonb_build_object('card_id',normalized_card->'id');
  end if;
  if a->>'scope'='rows' and not exists(select 1 from jsonb_array_elements(normalized) x where x->>'id'=a->>'card_id'
   and x->'row_ids' @> coalesce(a->'row_ids','[]'::jsonb)) then raise exception 'BUNCH_NOTE_ACTION_CARD_ROWS_INVALID'; end if;
  if a->>'scope'='location' and coalesce((a->>'freeform')::boolean,false)=false
   and not exists(select 1 from jsonb_array_elements(normalized) x where x->>'id'=a->>'card_id'
    and x->'row_ids' @> (select coalesce(jsonb_agg(to_jsonb(uid)),'[]'::jsonb) from (select distinct jsonb_array_elements_text(card->'row_ids') uid
      from jsonb_array_elements(normalized) card where card->>'kind'='inventory') rowset)) then
   raise exception 'BUNCH_NOTE_ACTION_CARD_ROWS_INVALID';
  end if;
 end loop;
 return normalized;
end $$;

create function bunch_note_private.normalize_card_actions(p_actions jsonb,p_original jsonb,p_normalized jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare a jsonb; original_card jsonb; normalized_card jsonb; result jsonb:='[]';
begin
 for a in select value from jsonb_array_elements(coalesce(p_actions,'[]'::jsonb)) loop
  if exists(select 1 from jsonb_array_elements(p_normalized) c where c->>'id'=a->>'card_id') then
   result:=result||jsonb_build_array(a); continue;
  end if;
  select value into original_card from jsonb_array_elements(coalesce(p_original,'[]'::jsonb)) c where c->>'id'=a->>'card_id';
  if original_card is null then raise exception 'BUNCH_NOTE_ACTION_CARD_REQUIRED'; end if;
  select value into normalized_card from jsonb_array_elements(p_normalized) c
   where bunch_note_private.card_key(c)=bunch_note_private.card_key(original_card);
  if normalized_card is null then raise exception 'BUNCH_NOTE_ACTION_CARD_REQUIRED'; end if;
  result:=result||jsonb_build_array(a||jsonb_build_object('card_id',normalized_card->'id'));
 end loop;
 return result;
end $$;

create function bunch_note_private.card_instruction_snapshot(p_body jsonb,p_card_id uuid) returns jsonb
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
  'card',card-'owner_id'-'owner_name','actions',card_actions);
end $$;

create function bunch_note_private.sync_work_cards() returns trigger
language plpgsql security definer set search_path='' as $$
declare entry jsonb; entries jsonb; entry_row record; prior jsonb; normalized jsonb; j bunch_note_private.jobs;
 c jsonb; note_id uuid; ix integer;
begin
 if tg_table_name='batches' then
  entries:=coalesce(new.body->'locations','[]'::jsonb);
  for entry_row in select value,ordinality from jsonb_array_elements(entries) with ordinality loop
   entry:=entry_row.value;
   select value into prior from jsonb_array_elements(coalesce(case when tg_op='UPDATE' then old.body->'locations' else '[]'::jsonb end,'[]'::jsonb))
    where upper(btrim(value->>'location'))=upper(btrim(entry->>'location'));
   if prior ? 'cards' and not(entry ? 'cards') then raise exception 'BUNCH_NOTE_STALE_CARD_CLIENT'; end if;
   if coalesce((entry->>'format_version')::integer,0)>=5 or entry ? 'cards' then
     normalized:=bunch_note_private.normalize_work_cards(entry||jsonb_build_object('batch_id',new.id),prior);
    entry:=entry||jsonb_build_object('cards',normalized,'format_version',5,
      'actions',bunch_note_private.normalize_card_actions(entry->'actions',entry->'cards',normalized),
      'source',(select coalesce(jsonb_agg(r order by r->>'unique_id'),'[]'::jsonb) from jsonb_array_elements(coalesce(entry->'source_all',entry->'source','[]'::jsonb)) r
       where exists(select 1 from jsonb_array_elements(normalized) x where x->'row_ids' ? (r->>'unique_id'))),
      'row_ids',(select coalesce(jsonb_agg(to_jsonb(uid) order by uid),'[]'::jsonb) from (select distinct jsonb_array_elements_text(x->'row_ids') uid from jsonb_array_elements(normalized) x) ids));
    entries:=jsonb_set(entries,array[(entry_row.ordinality-1)::text],entry,false);
   end if;
  end loop;
  new.body:=jsonb_set(new.body,'{locations}',entries,false);
 else
  j:=new;
  if tg_op='UPDATE' and coalesce((old.body->>'format_version')::integer,0)>=5 and not(j.body ? 'cards') then
   raise exception 'BUNCH_NOTE_STALE_CARD_CLIENT';
  end if;
  if coalesce((j.body->>'format_version')::integer,0)>=5 or j.body ? 'cards' then
   entry:=j.body||jsonb_build_object('location',j.location);
   normalized:=bunch_note_private.normalize_work_cards(entry,case when tg_op='UPDATE' then old.body else null end);
   entry:=entry||jsonb_build_object('cards',normalized,'format_version',5,'owner_id',null,
      'actions',bunch_note_private.normalize_card_actions(entry->'actions',entry->'cards',normalized),
      'source',(select coalesce(jsonb_agg(r order by r->>'unique_id'),'[]'::jsonb) from jsonb_array_elements(coalesce(entry->'source_all',entry->'source','[]'::jsonb)) r
       where exists(select 1 from jsonb_array_elements(normalized) x where x->'row_ids' ? (r->>'unique_id'))),
      'row_ids',(select coalesce(jsonb_agg(to_jsonb(uid) order by uid),'[]'::jsonb) from (select distinct jsonb_array_elements_text(x->'row_ids') uid from jsonb_array_elements(normalized) x) ids));
   new.owner_id:=null;
   new.body:=entry;
  end if;
 end if;
 return new;
end $$;

create trigger bunch_note_batch_v5_cards before insert or update of body on bunch_note_private.batches
 for each row execute function bunch_note_private.sync_work_cards();
create trigger bunch_note_job_v5_cards before insert or update of body on bunch_note_private.jobs
 for each row execute function bunch_note_private.sync_work_cards();

create function bunch_note_private.mirror_work_cards() returns trigger
language plpgsql security definer set search_path='' as $$
declare e jsonb; c jsonb; b bunch_note_private.batches; j bunch_note_private.jobs; note_id uuid; owner uuid; changed boolean;
begin
 if tg_table_name='batches' then
  for e in select value from jsonb_array_elements(coalesce(new.body->'locations','[]'::jsonb)) loop
   if coalesce((e->>'format_version')::integer,0)<5 then continue; end if;
   select id into note_id from bunch_note_private.bunch_notes where batch_id=new.id and location_code=e->>'location';
   if note_id is null then continue; end if;
   for c in select value from jsonb_array_elements(e->'cards') loop
    insert into bunch_note_private.bunch_note_work_cards(bunch_note_id,card_id,card_key,kind,location_code,itemcode,commonname,contsize,row_ids,owner_id,house,direction)
    values(note_id,(c->>'id')::uuid,bunch_note_private.card_key(c),c->>'kind',e->>'location',c->>'itemcode',c->>'commonname',c->>'contsize',c->'row_ids',nullif(c->>'owner_id','')::uuid,c->>'house',c->>'direction')
    on conflict(bunch_note_id,card_id) do update set card_key=excluded.card_key,kind=excluded.kind,location_code=excluded.location_code,
     itemcode=excluded.itemcode,commonname=excluded.commonname,contsize=excluded.contsize,row_ids=excluded.row_ids,
     house=excluded.house,direction=excluded.direction,updated_at=now(),active=true,status=case when bunch_note_work_cards.status='retired' then 'open' else bunch_note_work_cards.status end,
     owner_id=excluded.owner_id,
     revision=bunch_note_work_cards.revision+1;
   end loop;
   update bunch_note_private.bunch_note_work_cards wc set active=false,status='retired',revision=revision+1,updated_at=now()
    where wc.bunch_note_id=note_id and wc.active and not exists(select 1 from jsonb_array_elements(e->'cards') x where x->>'id'=wc.card_id::text);
  end loop;
 else
  j:=new;
  if coalesce((j.body->>'format_version')::integer,0)<5 then return new; end if;
  select id into note_id from bunch_note_private.bunch_notes where job_id=j.id;
  if note_id is null then return new; end if;
  for c in select value from jsonb_array_elements(j.body->'cards') loop
   if tg_op='INSERT' then changed:=true;
   else changed:=bunch_note_private.card_instruction_snapshot(old.body,(c->>'id')::uuid)
     is distinct from bunch_note_private.card_instruction_snapshot(j.body,(c->>'id')::uuid);
   end if;
   insert into bunch_note_private.bunch_note_work_cards(bunch_note_id,card_id,card_key,kind,location_code,itemcode,commonname,contsize,row_ids,owner_id,house,direction)
    values(note_id,(c->>'id')::uuid,bunch_note_private.card_key(c),c->>'kind',j.location,c->>'itemcode',c->>'commonname',c->>'contsize',c->'row_ids',nullif(c->>'owner_id','')::uuid,c->>'house',c->>'direction')
   on conflict(bunch_note_id,card_id) do update set card_key=excluded.card_key,kind=excluded.kind,location_code=excluded.location_code,
    itemcode=excluded.itemcode,commonname=excluded.commonname,contsize=excluded.contsize,row_ids=excluded.row_ids,house=excluded.house,direction=excluded.direction,
    active=true,status=case when bunch_note_work_cards.status='retired' or (bunch_note_work_cards.status='complete' and changed) then 'open' else bunch_note_work_cards.status end,
    updated_at=now(),revision=bunch_note_work_cards.revision+1;
  end loop;
  update bunch_note_private.bunch_note_work_cards wc set active=false,status='retired',revision=revision+1,updated_at=now()
   where wc.bunch_note_id=note_id and wc.active and not exists(select 1 from jsonb_array_elements(j.body->'cards') x where x->>'id'=wc.card_id::text);
 end if;
 return new;
end $$;
create trigger bunch_note_batch_work_cards after insert or update of body on bunch_note_private.batches
 for each row execute function bunch_note_private.mirror_work_cards();
create trigger bunch_note_job_work_cards after insert or update of body on bunch_note_private.jobs
 for each row execute function bunch_note_private.mirror_work_cards();

commit;
