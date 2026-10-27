begin;
set local lock_timeout='2s';
set local statement_timeout='20s';

create table if not exists public.ph_location_sales_notes(
  itemcode text not null,
  locationcode text not null,
  lotcode text not null,
  photo_link text,
  photo_name text,
  spec text,
  caliper text,
  loc_match_pct numeric,
  av_note text,
  pick_note text,
  sales_note text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(itemcode,locationcode,lotcode)
);
alter table public.ph_location_sales_notes enable row level security;
drop policy if exists ph_location_sales_notes_read on public.ph_location_sales_notes;
create policy ph_location_sales_notes_read on public.ph_location_sales_notes for select to anon,authenticated using(true);
grant select on public.ph_location_sales_notes to anon,authenticated;
revoke insert,update,delete on public.ph_location_sales_notes from anon,authenticated;

-- Extend the existing candidate command; do not introduce a parallel evidence editor.
do $migration$
declare
  target regprocedure:='suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure;
  definition text:=pg_get_functiondef(target);
  old_text text;
  new_text text;
begin
  if position('suspend-fill-tag-v2390' in definition)>0 then return; end if;
  old_text:=' chosen text; decision text; remaining integer; event_id uuid; ids text[]; stamp timestamptz:=clock_timestamp();';
  new_text:=' chosen text; decision text; remaining integer; event_id uuid; ids text[]; custom jsonb; custom_location text; custom_lot text; custom_uid text; stamp timestamptz:=clock_timestamp();';
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
    raise exception 'AGDATA_V2390_SUSPEND_DECLARATION_ANCHOR_MISMATCH';
  end if;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$if jsonb_typeof(p_payload->'inventoryIds')<>'array' or jsonb_array_length(p_payload->'inventoryIds') not between 1 and 30 then
     raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
   select array_agg(distinct value) into ids from jsonb_array_elements_text(p_payload->'inventoryIds');
   if exists(select 1 from unnest(ids) x left join public.ph_master_inventory m on m.unique_id=x
      where m.unique_id is null or m.itemcode<>s.itemcode or nullif(btrim(m.locationcode),'') is null or suspend_tag_private.is_false_block_v2378(m.locationcode)) then
     raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;$old$;
  new_text:=$new$-- suspend-fill-tag-v2390: existing or user-entered real nursery rows share one candidate path.
   if jsonb_typeof(coalesce(p_payload->'inventoryIds','[]'::jsonb))<>'array'
      or jsonb_typeof(coalesce(p_payload->'customRows','[]'::jsonb))<>'array'
      or jsonb_array_length(coalesce(p_payload->'inventoryIds','[]'::jsonb))
        + jsonb_array_length(coalesce(p_payload->'customRows','[]'::jsonb)) not between 1 and 30 then
     raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
   select coalesce(array_agg(distinct value),'{}'::text[]) into ids
     from jsonb_array_elements_text(coalesce(p_payload->'inventoryIds','[]'::jsonb));
   for custom in select value from jsonb_array_elements(coalesce(p_payload->'customRows','[]'::jsonb)) loop
     if jsonb_typeof(custom)<>'object' or custom-jsonb_build_object('locationcode',custom->'locationcode','lotcode',custom->'lotcode')<>'{}'::jsonb then
       raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
     custom_location:=upper(btrim(coalesce(custom->>'locationcode','')));
     custom_lot:=upper(btrim(coalesce(custom->>'lotcode','')));
     if custom_location!~'^[A-Z0-9]+([.][A-Z0-9]+){1,2}$' or custom_location~'^0+[.]0+[.]111$'
        or custom_lot!~'^[0-9]{2}[.](F1|S1|U1|U2|U3|X|Y|Z)$' then
       raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
     m:=null;
     select candidate.* into m from public.ph_master_inventory candidate
       where upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(coalesce(s.itemcode,'')))
         and upper(btrim(coalesce(candidate.locationcode,'')))=custom_location
         and upper(btrim(coalesce(candidate.lotcode,'')))=custom_lot
       order by candidate.unique_id limit 1;
     if m.unique_id is null then
       select candidate.* into m from public.ph_master_inventory candidate
         where upper(btrim(coalesce(candidate.itemcode,'')))=upper(btrim(coalesce(s.itemcode,'')))
         order by (upper(btrim(coalesce(candidate.contsize,'')))=upper(btrim(coalesce(s.contsize,'')))) desc,candidate.unique_id limit 1;
       if m.unique_id is null then raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
       custom_uid:='suspend-fill-'||md5(upper(s.itemcode)||':'||custom_location||':'||custom_lot);
       m:=jsonb_populate_record(null::public.ph_master_inventory,to_jsonb(m)||jsonb_build_object(
         'unique_id',custom_uid,'locationcode',custom_location,'lotcode',custom_lot,'season',split_part(custom_lot,'.',2),
         'saleyear',split_part(custom_lot,'.',1),'source','Suspend Fill Tag','last_updated',stamp,
         'ptronhand','0','ptrreviewed','0','ptravailable','0','s_lts','0','season_supply','0','season_oh','0',
         'season_demand','0','season_available','0','loc_match_qty',null,'initial_ptr','0','photos','[]'::jsonb,
         'photo_link',null,'photo_name',null,'photo_url',null,'photo_date',null,'spec',null,'caliper',null,
         'match',null,'loc_match_pct',null,'loc_photo_match',null,'av_note',null,'pick_note',null,'sales_note',null,
         'concat','suspend-fill-tag-v2390:'||custom_uid));
       insert into public.ph_master_inventory select (m).* on conflict(unique_id) do nothing;
     end if;
     ids:=array_append(ids,m.unique_id);
   end loop;
   select array_agg(distinct value order by value) into ids from unnest(ids) value;
   if cardinality(ids) not between 1 and 30 or exists(select 1 from unnest(ids) x left join public.ph_master_inventory m on m.unique_id=x
      where m.unique_id is null or m.itemcode<>s.itemcode or nullif(btrim(m.locationcode),'') is null or m.locationcode~'^0+[.]0+[.]111$') then
     raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
    raise exception 'AGDATA_V2390_SUSPEND_CANDIDATE_ANCHOR_MISMATCH';
  end if;
  definition:=replace(definition,old_text,new_text);
  definition:=replace(definition,$old$where r.suspend_candidate_group=group_key and r.locationcode='0.00.111';$old$,
    $new$where r.suspend_candidate_group=group_key and r.locationcode~'^0+[.]0+[.]111$';$new$);
  execute definition;
end
$migration$;

-- Mirror saved Suspend evidence to the exact location-note contract as well as master inventory.
do $migration$
declare definition text:=pg_get_functiondef('suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure);
  old_text text; new_text text;
begin
  if position('location-sales-notes-v2390' in definition)>0 then return; end if;
  old_text:=$old$where m.itemcode=s.itemcode and m.locationcode=s.locationcode and coalesce(m.lotcode,'')=coalesce(s.lotcode,'');
      if p_operation='complete' then$old$;
  new_text:=$new$where m.itemcode=s.itemcode and m.locationcode=s.locationcode and coalesce(m.lotcode,'')=coalesce(s.lotcode,'');
      -- location-sales-notes-v2390: exact item/location/lot evidence, never a fallback location.
      insert into public.ph_location_sales_notes(itemcode,locationcode,lotcode,photo_link,photo_name,spec,caliper,
        loc_match_pct,av_note,pick_note,sales_note,updated_by,updated_at)
      select m.itemcode,m.locationcode,coalesce(m.lotcode,''),m.photo_link,m.photo_name,m.spec,m.caliper,
        private.reclass_numeric_v1(m.match),m.av_note,m.pick_note,m.sales_note,p_actor_id,clock_timestamp()
      from public.ph_master_inventory m
      where m.itemcode=s.itemcode and m.locationcode=s.locationcode and coalesce(m.lotcode,'')=coalesce(s.lotcode,'')
      order by m.unique_id limit 1
      on conflict(itemcode,locationcode,lotcode) do update set photo_link=excluded.photo_link,photo_name=excluded.photo_name,
        spec=excluded.spec,caliper=excluded.caliper,loc_match_pct=excluded.loc_match_pct,av_note=excluded.av_note,
        pick_note=excluded.pick_note,sales_note=excluded.sales_note,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
      if p_operation='complete' then$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
    raise exception 'AGDATA_V2390_SUSPEND_NOTE_ANCHOR_MISMATCH';
  end if;
  execute replace(definition,old_text,new_text);
end
$migration$;

-- Bunch Note previews and completed-work reports resolve exactly one recipient.
create or replace function bunch_note_private.recipients_for_reports(p_ids jsonb,p_reports jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare dylan_id uuid;
begin
  if jsonb_typeof(coalesce(p_ids,'[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_reports,'[]'::jsonb))<>'array' then
    raise exception 'BUNCH_NOTE_RECIPIENT_INVALID';
  end if;
  select id into dylan_id from public.profiles where username='dylan_collyge' and disabled_at is null
    and (locked_until is null or locked_until<=now()) and not must_change_password order by id limit 1;
  if dylan_id is null then raise exception 'BUNCH_NOTE_DYLAN_RECIPIENT_REQUIRED'; end if;
  return bunch_note_private.recipients(jsonb_build_array(dylan_id));
end $$;
revoke all on function bunch_note_private.recipients_for_reports(jsonb,jsonb) from public,anon,authenticated,service_role;

update bunch_note_private.previews p set recipients=bunch_note_private.recipients_for_reports('[]'::jsonb,p.reports)
where p.delivery_status in ('not_sent','failed') and p.recipients is distinct from bunch_note_private.recipients_for_reports('[]'::jsonb,p.reports);
update public.ph_request_delivery_outbox set payload=(payload-'to'-'cc'-'bcc'-'recipients')
where event_type='bunch_note_submission' and status in ('pending','failed');

-- SQL is the final authority for a batch spanning multiple physical rows in one lot.
do $migration$
declare definition text:=pg_get_functiondef('private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure);
  old_text text; new_text text;
begin
  if position('reclass-move-up-open-stock-v2390' in definition)>0 then return; end if;
  old_text:=$old$update pg_temp.reclass_batch_sources_v1 s set total_quantity=q.quantity
  from (select l.source_index,sum(l.quantity) quantity from pg_temp.reclass_batch_lines_v1 l group by l.source_index) q$old$;
  new_text:=$new$-- reclass-move-up-open-stock-v2390: cap aggregate Move Up by the source lot's pre-move S_LTS.
  if exists(
    select 1 from pg_temp.reclass_batch_lines_v1 l
      join pg_temp.reclass_batch_source_before_v1 b using(source_index)
    group by upper(btrim(coalesce(b.itemcode::text,''))),upper(btrim(coalesce(b.lotcode::text,'')))
    having sum(case when l.direction='move_up' then l.quantity else 0 end)
      > greatest(0,min(coalesce(private.reclass_numeric_v1(b.s_lts::text),0)))
  ) then raise exception using errcode='22023',message='INVENTORY_RECLASS_MOVE_UP_OPEN_STOCK_EXCEEDED'; end if;
  update pg_temp.reclass_batch_sources_v1 s set total_quantity=q.quantity
  from (select l.source_index,sum(l.quantity) quantity from pg_temp.reclass_batch_lines_v1 l group by l.source_index) q$new$;
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
    raise exception 'AGDATA_V2390_RECLASS_CAP_ANCHOR_MISMATCH';
  end if;
  execute replace(definition,old_text,new_text);
end
$migration$;

insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('app_version',jsonb_build_object('release','AgData v2.3.90','app_version','2.3.90'),
  'release-v2.3.90',clock_timestamp())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

do $installed$
begin
  if position('suspend-fill-tag-v2390' in pg_get_functiondef('suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure))=0
    or position('location-sales-notes-v2390' in pg_get_functiondef('suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure))=0
    or position('reclass-move-up-open-stock-v2390' in pg_get_functiondef('private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure))=0
    or not exists(select 1 from public.ph_app_settings where key='app_version' and value->>'app_version'='2.3.90') then
    raise exception 'AGDATA_V2390_CONTRACT_NOT_INSTALLED';
  end if;
end
$installed$;

notify pgrst,'reload schema';
commit;
