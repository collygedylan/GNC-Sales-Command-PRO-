begin;

-- Keep relational cards as inventory work items; divider rows remain in the
-- frozen ordered JSON document and never acquire inventory permissions.
alter table bunch_note_private.bunch_note_work_cards
  add column destination_qualifier text not null default '' check (length(destination_qualifier) <= 120),
  add column workflow_instructions text not null default '' check (length(workflow_instructions) <= 4000),
  add column left_margin text not null default '' check (length(left_margin) <= 100);

alter table bunch_note_private.bunch_note_work_cards
  drop constraint bunch_note_work_cards_workflow_action_check,
  drop constraint bunch_note_work_cards_routing_check;

alter table bunch_note_private.bunch_note_work_cards
  add constraint bunch_note_work_cards_workflow_action_check
    check (workflow_action in ('','move','bunch','ta','haul','set_out','custom','compound')),
  add constraint bunch_note_work_cards_routing_check check ((
    (workflow_action='' and destination_location='' and destination_house='' and destination_qualifier='') or
    (workflow_action='move' and length(btrim(destination_location)) between 1 and 100 and destination_house='') or
    (workflow_action='bunch' and destination_location='' and destination_house in
      ('South House','North House','Center House','South & Center House','North & Center House',
       'East House','West House','East & Center House','West & Center House')) or
    (workflow_action='ta' and destination_location='' and destination_house='' and destination_qualifier='') or
    (workflow_action in ('haul','set_out','custom','compound') and length(btrim(workflow_instructions)) between 1 and 4000)
  ) and (destination_qualifier='' or destination_location<>''));

-- Header fields belong to the saved blueprint. Merge callers that omit them
-- (older clients) cannot erase a newer header when editing a saved note.
do $migration$
declare
  source text;
  changed text;
  old_fragment text;
  new_fragment text;
begin
  select pg_get_functiondef('bunch_note_private.structured_note(jsonb,jsonb)'::regprocedure) into source;
  old_fragment := $q$foreach text_key in array array['direction','target_houses','house_sections'] loop$q$;
  new_fragment := $q$foreach text_key in array array['direction','target_houses','house_sections','work_type','title','purpose_thread','default_house_plan','schedule_banner','rule_chips'] loop$q$;
  changed := replace(source, old_fragment, new_fragment);
  if changed = source then raise exception 'V221_STRUCTURED_NOTE_HEADER_PATCH_MISSING'; end if;
  execute changed;
end
$migration$;

-- Extend the existing source-aware normalizer without weakening its exact
-- identity, current-source, ownership, assignment, or revision checks.
do $migration$
declare
  source text;
  changed text;
  old_fragment text;
  new_fragment text;
begin
  select pg_get_functiondef('bunch_note_private.normalize_work_cards(jsonb,jsonb)'::regprocedure) into source;

  old_fragment := $q$  begin v_card_id:=(c->>'id')::uuid; exception when others then raise exception 'BUNCH_NOTE_CARD_INVALID'; end;$q$;
  new_fragment := $replace$
  if c->>'kind'='divider' then
   if nullif(btrim(c->>'id'),'') is null or length(c->>'id')>100
    or nullif(btrim(c->>'text'),'') is null or length(c->>'text')>2000
    or length(coalesce(c->>'left_margin',''))>100
    or exists(select 1 from jsonb_array_elements(normalized) prior where prior->>'id'=c->>'id') then
    raise exception 'BUNCH_NOTE_DIVIDER_INVALID';
   end if;
   normalized:=normalized||jsonb_build_array(jsonb_build_object('id',c->>'id','kind','divider',
    'text',c->>'text','left_margin',coalesce(c->>'left_margin','')));
   continue;
  end if;
  begin v_card_id:=(c->>'id')::uuid; exception when others then raise exception 'BUNCH_NOTE_CARD_INVALID'; end;
$replace$;
  changed := replace(source, old_fragment, new_fragment);
  if changed = source then raise exception 'V221_CARD_DIVIDER_PATCH_MISSING'; end if;
  source := changed;

  old_fragment := $q$route:=case when c ? 'workflow_action' then coalesce(c->>'workflow_action','') else '' end; destination_location:=upper(btrim(coalesce(c->>'destination_location',''))); destination_house:=coalesce(c->>'destination_house',''); card_notes:=coalesce(c->>'notes','');$q$;
  new_fragment := $replace$
  route:=case when c ? 'workflow_action' then coalesce(c->>'workflow_action','') else '' end;
  destination_location:=upper(btrim(coalesce(c->>'destination_location','')));
  destination_house:=coalesce(c->>'destination_house',''); card_notes:=coalesce(c->>'notes','');
  if length(coalesce(c->>'workflow_instructions',''))>4000 or length(coalesce(c->>'destination_qualifier',''))>120
   or length(coalesce(c->>'left_margin',''))>100 then raise exception 'BUNCH_NOTE_CARD_INVALID'; end if;
$replace$;
  changed := replace(changed, old_fragment, new_fragment);
  if changed = source then raise exception 'V221_CARD_EXTENDED_FIELDS_PATCH_MISSING'; end if;
  source := changed;

  old_fragment := $q$if (route not in ('move','bunch','ta','') or (route='' and (destination_location<>'' or destination_house<>'')) or (route='move' and length(destination_location) not between 1 and 100) or$q$;
  new_fragment := $q$if (route not in ('move','bunch','ta','haul','set_out','custom','compound','') or (route='' and (destination_location<>'' or destination_house<>'')) or (route='move' and length(destination_location) not between 1 and 100) or$q$;
  changed := replace(changed, old_fragment, new_fragment);
  if changed = source then raise exception 'V221_CARD_ROUTE_ENUM_PATCH_MISSING'; end if;
  source := changed;

  old_fragment := $q$   (route='ta' and (destination_location<>'' or destination_house<>''))) then raise exception 'BUNCH_NOTE_ROUTING_INVALID'; end if;$q$;
  new_fragment := $q$   (route='ta' and (destination_location<>'' or destination_house<>'')) or (route in ('haul','set_out','custom','compound') and nullif(btrim(c->>'workflow_instructions'),'') is null)) then raise exception 'BUNCH_NOTE_ROUTING_INVALID'; end if;$q$;
  changed := replace(changed, old_fragment, new_fragment);
  if changed = source then raise exception 'V221_CARD_ROUTE_VALIDATION_PATCH_MISSING'; end if;
  source := changed;

  old_fragment := $q$if not exists(select 1 from jsonb_array_elements(normalized) x where x->>'id'=a->>'card_id') then$q$;
  new_fragment := $q$if not exists(select 1 from jsonb_array_elements(normalized) x where x->>'id'=a->>'card_id' and x->>'kind' in ('inventory','shared')) then$q$;
  changed := replace(source, old_fragment, new_fragment);
  if changed = source then raise exception 'V221_ACTION_DIVIDER_REFERENCE_PATCH_MISSING'; end if;
  source := changed;

  old_fragment := $q$if original_card is null then raise exception 'BUNCH_NOTE_ACTION_CARD_REQUIRED'; end if;$q$;
  new_fragment := $q$if original_card is null or original_card->>'kind' not in ('inventory','shared') then raise exception 'BUNCH_NOTE_ACTION_CARD_REQUIRED'; end if;$q$;
  changed := replace(source, old_fragment, new_fragment);
  if changed = source then raise exception 'V221_ACTION_DIVIDER_ORIGINAL_PATCH_MISSING'; end if;
  source := changed;

  old_fragment := $q$'destination_house',destination_house,'notes',card_notes));$q$;
  new_fragment := $q$'destination_house',destination_house,'destination_qualifier',coalesce(c->>'destination_qualifier',''),'workflow_instructions',coalesce(c->>'workflow_instructions',''),'left_margin',coalesce(c->>'left_margin',''),'notes',card_notes));$q$;
  changed := replace(changed, old_fragment, new_fragment);
  if changed = source then raise exception 'V221_CARD_FROZEN_FIELDS_PATCH_MISSING'; end if;
  source := changed;

  old_fragment := $q$  if v_card_id is null or kind_value not in ('inventory','shared') or v_card_id=any(ids) or key_value=any(keys)$q$;
  new_fragment := $q$  if exists(select 1 from jsonb_array_elements(normalized) prior where prior->>'id'=v_card_id::text) then raise exception 'BUNCH_NOTE_CARD_ID_CHANGED'; end if;
  if v_card_id is null or kind_value not in ('inventory','shared') or v_card_id=any(ids) or key_value=any(keys)$q$;
  changed := replace(source, old_fragment, new_fragment);
  if changed=source then raise exception 'V221_DIVIDER_ID_COLLISION_PATCH_MISSING'; end if;
  execute changed;
end
$migration$;

-- The generic mirror retains UUID-backed inventory cards and assignments.
-- Divider content remains in the ordered body, not the work-card ACL table.
do $migration$
declare source text; changed text;
begin
  select pg_get_functiondef('bunch_note_private.mirror_work_cards()'::regprocedure) into source;
  if position($q$for c in select value from jsonb_array_elements(e->'cards') loop$q$ in source)=0
   or position($q$for c in select value from jsonb_array_elements(j.body->'cards') loop$q$ in source)=0
   or position($q$destination_house,notes)$q$ in source)=0
   or position($q$coalesce(c->>'destination_house',''),coalesce(c->>'notes','')$q$ in source)=0
   or position($q$destination_house=excluded.destination_house,notes=excluded.notes,$q$ in source)=0 then
    raise exception 'V221_CARD_MIRROR_PATCH_SOURCE_CHANGED';
  end if;
  changed := replace(source,
    $q$for c in select value from jsonb_array_elements(e->'cards') loop$q$,
    $q$for c in select value from jsonb_array_elements(e->'cards') loop
    if c->>'kind'='divider' then continue; end if;$q$);
  changed := replace(changed,
    $q$for c in select value from jsonb_array_elements(j.body->'cards') loop$q$,
    $q$for c in select value from jsonb_array_elements(j.body->'cards') loop
   if c->>'kind'='divider' then continue; end if;$q$);
  changed := replace(changed,
    $q$destination_house,notes)$q$,
    $q$destination_house,notes,destination_qualifier,workflow_instructions,left_margin)$q$);
  changed := replace(changed,
    $q$coalesce(c->>'destination_house',''),coalesce(c->>'notes',''))$q$,
    $q$coalesce(c->>'destination_house',''),coalesce(c->>'notes',''),coalesce(c->>'destination_qualifier',''),coalesce(c->>'workflow_instructions',''),coalesce(c->>'left_margin',''))$q$);
  changed := replace(changed,
    $q$destination_house=excluded.destination_house,notes=excluded.notes,$q$,
    $q$destination_house=excluded.destination_house,notes=excluded.notes,destination_qualifier=excluded.destination_qualifier,workflow_instructions=excluded.workflow_instructions,left_margin=excluded.left_margin,$q$);
  if position($q$if c->>'kind'='divider' then continue; end if;$q$ in changed)=0
   or position($q$destination_qualifier,workflow_instructions,left_margin$q$ in changed)=0
   or position($q$coalesce(c->>'workflow_instructions',''),coalesce(c->>'left_margin','')$q$ in changed)=0 then
    raise exception 'V221_CARD_MIRROR_PATCH_INCOMPLETE';
  end if;
  if changed=source then raise exception 'V221_CARD_MIRROR_PATCH_MISSING'; end if;
  execute changed;
end
$migration$;

-- Divider rows live in the frozen ordered document, not the UUID-backed
-- inventory-card permission table. Preserve them during preview enrichment.
do $migration$
declare source text; changed text; import_guard text; import_guard_count integer;
begin
  select pg_get_functiondef('bunch_note_private.enrich_preview_cards()'::regprocedure) into source;
  changed:=replace(source,
    $q$  for card in select value from jsonb_array_elements(report->'cards') loop$q$,
    $q$  for card in select value from jsonb_array_elements(report->'cards') loop
   if card->>'kind'='divider' then cards:=cards||jsonb_build_array(card); continue; end if;$q$);
  if changed=source then raise exception 'V221_PREVIEW_DIVIDER_PATCH_MISSING'; end if;
  execute changed;
end
$migration$;

-- Preserve divider context for assigned readers while keeping unrelated card
-- definitions and source identities private.
do $migration$
declare source text; changed text;
begin
  select pg_get_functiondef('bunch_note_private.card_instruction_snapshot_map(jsonb)'::regprocedure) into source;
  changed:=replace(source,
    $q$where nullif(c.value->>'id','') is not null order by c.value->>'id',c.ordinality$q$,
    $q$where nullif(c.value->>'id','') is not null and c.value->>'kind'<>'divider' order by c.value->>'id',c.ordinality$q$);
  if changed=source then raise exception 'V221_INSTRUCTION_MAP_PATCH_MISSING'; end if;
  execute changed;

  select pg_get_functiondef('bunch_note_private.card_safe_job(bunch_note_private.jobs,uuid)'::regprocedure) into source;
  changed:=replace(source,
    $q$where author or d.value->>'id'=any(array(select unnest(card_ids)::text));$q$,
    $q$where author or d.value->>'id'=any(array(select unnest(card_ids)::text)) or d.value->>'kind'='divider';$q$);
  if changed=source then raise exception 'V221_SAFE_JOB_DIVIDER_PATCH_MISSING'; end if;
  execute changed;

  select pg_get_functiondef('bunch_note_private.card_command(uuid,text,jsonb,uuid,bigint)'::regprocedure) into source;
  changed:=replace(source,
    $q$or (coalesce((j.body->>'format_version')::integer,0)<5 and bunch_note_private.can_read(actor,j))));$q$,
    $q$or (coalesce((j.body->>'format_version')::integer,0)<5 and bunch_note_private.can_read(actor,j))
    or (author and coalesce((j.body->>'format_version')::integer,0)>=5)));$q$);
  if changed=source then raise exception 'V221_HEADER_ONLY_LIST_PATCH_MISSING'; end if;
  execute changed;
end
$migration$;

create or replace function bunch_note_private.validate_action(a jsonb,source jsonb,prior_actions jsonb default '[]'::jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare opt bunch_note_private.options; old jsonb; targets jsonb; kind text; option_id uuid;
begin
 if coalesce(a->>'group','') not in ('sequence','grading','placement','identification','inventory','hauling')
  or nullif(a->>'id','') is null or length(coalesce(a->>'instructions','')) not between 1 and 4000
  or coalesce(a->>'scope','') not in ('rows','location') then raise exception 'BUNCH_NOTE_ACTION_INVALID'; end if;
 select x into old from jsonb_array_elements(coalesce(prior_actions,'[]'::jsonb)) x where x->>'id'=a->>'id';
 if old is not null then
  if (a->>'kind') is distinct from (old->>'kind') or (a->>'group') is distinct from (old->>'group')
   or (a->>'label') is distinct from (old->>'label')
   or (nullif(a->>'option_id','') is not null and (a->>'option_id') is distinct from (old->>'option_id')) then
   raise exception 'BUNCH_NOTE_ACTION_ID_REUSED';
  end if;
  if nullif(a->>'option_id','') is null and nullif(old->>'option_id','') is not null then
   a:=a||jsonb_build_object('option_id',old->'option_id');
  end if;
 elsif nullif(a->>'option_id','') is not null then
  begin option_id:=(a->>'option_id')::uuid; exception when others then raise exception 'BUNCH_NOTE_OPTION_CHANGED'; end;
  select * into opt from bunch_note_private.options where id=option_id;
  -- A selected catalogue item is frozen into the draft. If the option was
  -- retired after selection, keep the copied metadata; active IDs still must
  -- match the server catalogue exactly.
  if found and not opt.active then
   -- A newly submitted stale selection keeps the copied action data, but no
   -- longer claims a live catalogue identity. Previously saved action IDs
   -- take the immutable prior_actions branch above and remain frozen as-is.
   a:=a-'option_id';
  elsif found and (a->>'group' is distinct from opt.category or a->>'kind' is distinct from opt.kind or a->>'label' is distinct from opt.label) then
   raise exception 'BUNCH_NOTE_OPTION_CHANGED';
  end if;
 elsif nullif(a->>'kind','') is null then
  -- Legacy, non-catalogued text remains an instruction; typed action kinds
  -- must carry their immutable copied metadata from a previously selected option.
  select * into opt from bunch_note_private.options where label=coalesce(a->>'label',a->>'instructions') and active;
  if found then a:=a||jsonb_build_object('kind',opt.kind); end if;
 end if;
 kind:=bunch_note_private.action_kind(a);
 if kind not in ('instruction','ta','move','hauling') then raise exception 'BUNCH_NOTE_ACTION_INVALID'; end if;
 if a->>'scope'='rows' and (jsonb_typeof(a->'row_ids') is distinct from 'array' or jsonb_array_length(a->'row_ids')=0) then
  raise exception 'BUNCH_NOTE_ACTION_ROWS_INVALID'; end if;
 select coalesce(jsonb_agg(r),'[]'::jsonb) into targets from jsonb_array_elements(coalesce(source,'[]'::jsonb)) r
  where a->>'scope'='location' or a->'row_ids' ? (r->>'unique_id');
 if jsonb_array_length(targets)=0 or (a->>'scope'='rows' and exists(select 1 from jsonb_array_elements_text(a->'row_ids') id
   where not exists(select 1 from jsonb_array_elements(targets) r where r->>'unique_id'=id))) then
  raise exception 'BUNCH_NOTE_ACTION_ROWS_INVALID'; end if;
 if (a->>'group'='hauling' or kind='hauling') and exists(select 1 from jsonb_array_elements(targets) r where not bunch_note_private.shift_eligible(r)) then
  raise exception 'BUNCH_NOTE_SHIFT_ROWS_INVALID'; end if;
 return a;
end $$;

create or replace function bunch_note_private.validate_blueprint_header() returns trigger
language plpgsql set search_path='' as $$
declare entry jsonb; entries jsonb;
begin
 if tg_table_name='batches' then
  entries:=coalesce(new.body->'locations','[]'::jsonb);
 else
  entries:=jsonb_build_array(new.body||jsonb_build_object('location',new.location));
 end if;
 for entry in select value from jsonb_array_elements(entries) loop
  if coalesce((entry->>'format_version')::integer,0)>=5 then
   if nullif(btrim(coalesce(nullif(btrim(entry->>'work_type'),''),nullif(btrim(entry->>'title'),''),nullif(btrim(entry->>'purpose_thread'),''),nullif(btrim(entry->>'purposes'),''),nullif(btrim(entry->>'instructions'),''),nullif(btrim(entry->>'schedule_banner'),''))), '') is null
    or length(coalesce(entry->>'work_type',''))>500 or length(coalesce(entry->>'title',''))>500
    or length(coalesce(entry->>'purpose_thread',''))>500 or length(coalesce(entry->>'default_house_plan',''))>800
    or length(coalesce(entry->>'schedule_banner',''))>2000 or length(coalesce(entry->>'direction',''))>200
    or jsonb_typeof(coalesce(entry->'rule_chips','[]'::jsonb)) is distinct from 'array'
    or jsonb_array_length(coalesce(entry->'rule_chips','[]'::jsonb))>20
    or exists(select 1 from jsonb_array_elements_text(coalesce(entry->'rule_chips','[]'::jsonb)) chip where length(chip)>500) then
    raise exception 'BUNCH_NOTE_HEADER_INVALID';
   end if;
  end if;
 end loop;
 return new;
end $$;
revoke all on function bunch_note_private.validate_blueprint_header() from public,anon,authenticated,service_role;
create trigger zzz_bunch_note_v221_header_guard before insert or update of body on bunch_note_private.batches
 for each row execute function bunch_note_private.validate_blueprint_header();
create trigger zzz_bunch_note_v221_job_header_guard before insert or update of body on bunch_note_private.jobs
 for each row execute function bunch_note_private.validate_blueprint_header();

create or replace function bunch_note_private.require_ready(entry jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare a jsonb; card_aware boolean; has_header boolean;
begin
 card_aware:=coalesce((entry->>'format_version')::integer,0)>=5;
 has_header:=nullif(btrim(coalesce(nullif(btrim(entry->>'work_type'),''),nullif(btrim(entry->>'title'),''),nullif(btrim(entry->>'purpose_thread'),''),nullif(btrim(entry->>'purposes'),''),
   nullif(btrim(entry->>'instructions'),''),nullif(btrim(entry->>'prerequisites'),''),nullif(btrim(entry->>'schedule_banner'),''),nullif(btrim(entry->>'default_house_plan'),''))), '') is not null;
 if jsonb_typeof(entry->'actions') is distinct from 'array' or jsonb_array_length(entry->'actions')>200
  or (not card_aware and jsonb_array_length(entry->'actions')=0)
  or (card_aware and not has_header) then raise exception 'BUNCH_NOTE_INSTRUCTIONS_REQUIRED'; end if;
 if card_aware and jsonb_typeof(entry->'cards') is distinct from 'array' then raise exception 'BUNCH_NOTE_CARDS_REQUIRED'; end if;
 if not card_aware and nullif(btrim(entry->>'purposes'),'') is null then raise exception 'BUNCH_NOTE_INSTRUCTIONS_REQUIRED'; end if;
 for a in select value from jsonb_array_elements(entry->'actions') loop
  if nullif(btrim(a->>'instructions'),'') is null then raise exception 'BUNCH_NOTE_INSTRUCTIONS_REQUIRED'; end if;
  if bunch_note_private.action_kind(a) in ('move','hauling') and nullif(btrim(a->>'destination'),'') is null then
   raise exception 'BUNCH_NOTE_DESTINATION_REQUIRED';
  end if;
 end loop;
end $$;

create or replace function bunch_note_private.recipients_for_reports(p_ids jsonb,p_reports jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ids jsonb;
begin
 if jsonb_typeof(coalesce(p_ids,'[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(p_ids,'[]'::jsonb))>50
  or jsonb_typeof(coalesce(p_reports,'[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(p_reports,'[]'::jsonb))>20 then
  raise exception 'BUNCH_NOTE_RECIPIENT_INVALID';
 end if;
 select coalesce(jsonb_agg(to_jsonb(profile_id) order by profile_id),'[]'::jsonb) into ids from (
  select distinct requested.profile_id from (
   select value::text::uuid profile_id from jsonb_array_elements_text(coalesce(p_ids,'[]'::jsonb)) value
   union
   select p.id from public.profiles p where p.username in ('megan_kelly','sharon_combs')
   union
   select (report->>'owner_id')::uuid from jsonb_array_elements(coalesce(p_reports,'[]'::jsonb)) report
    where nullif(report->>'owner_id','') is not null
   union
   select (card->>'owner_id')::uuid from jsonb_array_elements(coalesce(p_reports,'[]'::jsonb)) report
    cross join lateral jsonb_array_elements(coalesce(report->'cards','[]'::jsonb)) card
    where coalesce(card->>'kind','')<>'divider' and nullif(card->>'owner_id','') is not null
   union
   select owner.value::text::uuid from jsonb_array_elements(coalesce(p_reports,'[]'::jsonb)) report
    cross join lateral jsonb_array_elements(coalesce(report->'cards','[]'::jsonb)) card
    cross join lateral jsonb_array_elements_text(coalesce(card->'owner_ids','[]'::jsonb)) owner(value)
    where coalesce(card->>'kind','')<>'divider'
  ) requested
 ) recipients;
 if jsonb_array_length(ids)>50 then raise exception 'BUNCH_NOTE_RECIPIENT_INVALID'; end if;
 return bunch_note_private.recipients(ids);
end $$;
revoke all on function bunch_note_private.recipients_for_reports(jsonb,jsonb) from public,anon,authenticated,service_role;

-- Recipient snapshots are resolved from saved profile assignments plus the
-- server-owned Bunch Note group. Delivery continues to use the existing outbox
-- and frozen PDF receipt path. Background import state alone is not a lockout:
-- exact canonical source snapshots and the publish table lock still protect data.
do $migration$
declare source text; changed text; import_guard text; import_guard_count integer;
begin
  -- The public v1 entry point is now a compatibility wrapper. Patch the
  -- retained implementation that owns save/preview/publish validation.
  select pg_get_functiondef('bunch_note_private.bunch_note_command_legacy(uuid,text,jsonb,uuid,bigint)'::regprocedure) into source;

  changed:=replace(source,
    $q$bunch_note_private.recipients(coalesce(p_payload->'recipient_ids','[]'))$q$,
    $q$bunch_note_private.recipients_for_reports(coalesce(p_payload->'recipient_ids','[]'),jsonb_build_array(report))$q$);
  if changed=source then raise exception 'V221_COMPLETED_WORK_RECIPIENT_PATCH_MISSING'; end if;

  source:=changed;
  changed:=replace(source,
    $q$bunch_note_private.recipients(batch.body->'recipient_ids')$q$,
    $q$bunch_note_private.recipients_for_reports(batch.body->'recipient_ids',reports)$q$);
  if changed=source then raise exception 'V221_PREVIEW_RECIPIENT_PATCH_MISSING'; end if;

  source:=changed;
  changed:=replace(source,
    $q$preview.recipients is distinct from bunch_note_private.recipients_for_reports(batch.body->'recipient_ids',reports)$q$,
    $q$preview.recipients is distinct from bunch_note_private.recipients_for_reports(batch.body->'recipient_ids',preview.reports)$q$);
  if changed=source then raise exception 'V221_PUBLISH_RECIPIENT_PATCH_MISSING'; end if;

  source:=changed;
  changed:=replace(source,
    $q$if jsonb_array_length(source)=0 then raise exception 'BUNCH_NOTE_SOURCE_MISSING'; end if;$q$,
    $q$if jsonb_array_length(source)=0 and not (
     coalesce((entry->>'format_version')::integer,0)>=5
     and jsonb_typeof(entry->'cards')='array'
     and not coalesce((select bool_or(coalesce(card->>'kind','')<>'divider')
      from jsonb_array_elements(case when jsonb_typeof(entry->'cards')='array' then entry->'cards' else '[]'::jsonb end) card),false)
     and jsonb_array_length(case when jsonb_typeof(coalesce(entry->'row_ids','[]'::jsonb))='array'
      then coalesce(entry->'row_ids','[]'::jsonb) else '[null]'::jsonb end)=0
     and not coalesce((select bool_or(action->>'scope'='rows')
      from jsonb_array_elements(case when jsonb_typeof(entry->'actions')='array' then entry->'actions' else '[]'::jsonb end) action),false)
     and nullif(btrim(coalesce(nullif(btrim(entry->>'work_type'),''),nullif(btrim(entry->>'title'),''),
      nullif(btrim(entry->>'purpose_thread'),''),nullif(btrim(entry->>'purposes'),''),nullif(btrim(entry->>'instructions'),''),
      nullif(btrim(entry->>'prerequisites'),''),nullif(btrim(entry->>'schedule_banner'),''),nullif(btrim(entry->>'default_house_plan'),''))), '') is not null
    ) then raise exception 'BUNCH_NOTE_SOURCE_MISSING'; end if;$q$);
  if changed=source then raise exception 'V221_HEADER_ONLY_SOURCE_PATCH_MISSING'; end if;

  source:=changed;
  import_guard := $q$  if exists(select 1 from public.app_dataset_revisions r where r.key='ph_master_inventory' and r.state<>'ready') then raise exception 'BUNCH_NOTE_SOURCE_REFRESH_REQUIRED'; end if;
$q$;
  import_guard_count := (length(source)-length(replace(source,import_guard,''))) / length(import_guard);
  if import_guard_count < 2 then raise exception 'V221_IMPORT_STATE_PATCH_SOURCE_CHANGED'; end if;
  changed:=replace(source,import_guard,'');
  execute changed;
end
$migration$;

commit;
