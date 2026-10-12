begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Align SQL with the client's whitespace normalization without changing roles,
-- account state, navigation grants, owner scope, or mutation permissions.
do $$
declare signature text; definition text; before_text text:='upper(btrim(coalesce(actor.role,'''')))';
begin
  foreach signature in array array[
    'public.aura_voice_access_v1()', 'public.aura_voice_context_v1()',
    'public.aura_voice_inventory_read_v1(text,jsonb,jsonb,integer)',
    'private.aura_voice_inventory_read_core_v1(uuid,text,jsonb,jsonb,integer)',
    'public.aura_voice_conversation_v1(uuid,text,uuid,uuid,integer,jsonb)',
    'public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position(before_text in definition)=0 then raise exception 'AURA_ROLE_NORMALIZATION_CONTRACT_MISMATCH'; end if;
    definition:=replace(definition,before_text,$replacement$upper(regexp_replace(coalesce(actor.role,''),'^[[:space:]]+|[[:space:]]+$','','g'))$replacement$);
    execute definition;
  end loop;
end $$;

create table public.aura_domain_glossary(
  id uuid primary key default gen_random_uuid(),
  term text not null unique check(term=lower(btrim(term)) and length(term) between 1 and 80),
  canonical_entity text not null check(canonical_entity in ('container_size','growth_stage','metric_type')),
  target_filter jsonb not null check(jsonb_typeof(target_filter)='object'),
  notes text check(length(notes)<=1000),
  constraint aura_glossary_filter_check check(coalesce(
    (canonical_entity='container_size' and jsonb_typeof(target_filter->'size')='string' and target_filter->>'size' ~ '^[A-Za-z0-9#& .-]{1,40}$')
    or (canonical_entity='metric_type' and target_filter->>'metric' in ('open_stock','loc_on_hand','allocated','held'))
    or canonical_entity='growth_stage'
  ,false))
);
alter table public.aura_domain_glossary enable row level security;
revoke all on public.aura_domain_glossary from public,anon,authenticated;
grant select on public.aura_domain_glossary to authenticated;
grant all on public.aura_domain_glossary to service_role;
create policy aura_glossary_active_read on public.aura_domain_glossary for select to authenticated
  using ((select public.aura_voice_access_v1()->>'ok')='true');
insert into public.aura_domain_glossary(term,canonical_entity,target_filter,notes) values
  ('3dp','container_size','{"size":"3DP"}','#3 deep container'),
  ('#3 deep','container_size','{"size":"3DP"}','#3 deep container'),
  ('3 deep','container_size','{"size":"3DP"}','Spoken deep container'),
  ('1g','container_size','{"size":"#1"}',null), ('2g','container_size','{"size":"#2"}',null),
  ('3g','container_size','{"size":"#3"}',null), ('5g','container_size','{"size":"#5"}',null),
  ('7g','container_size','{"size":"#7"}',null), ('10g','container_size','{"size":"#10"}',null),
  ('15g','container_size','{"size":"#15"}',null), ('b&b','container_size','{"size":"B&B"}',null),
  ('open stock','metric_type','{"metric":"open_stock"}','Verified imported S_LTS; never substitute availability.'),
  ('on hand','metric_type','{"metric":"loc_on_hand"}',null),
  ('on-hand','metric_type','{"metric":"loc_on_hand"}',null),
  ('allocated','metric_type','{"metric":"allocated"}','Unknown when no verified allocation source exists.'),
  ('held','metric_type','{"metric":"held"}',null), ('on hold','metric_type','{"metric":"held"}',null);
alter table public.aura_domain_glossary force row level security;

-- Separate preferences avoid granting browser writes to profiles or to the
-- server-managed appearance/navigation preference table.
create table public.user_preferences(
  user_id uuid primary key references public.profiles(id) on delete cascade,
  aura_voice_preference text not null default 'Kore' check(aura_voice_preference in ('Aoede','Charon','Fenrir','Kore','Puck'))
);
alter table public.user_preferences enable row level security;
alter table public.user_preferences force row level security;
revoke all on public.user_preferences from public,anon,authenticated;
grant select,insert on public.user_preferences to authenticated;
grant update(aura_voice_preference) on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;
create policy aura_preference_own_read on public.user_preferences for select to authenticated using(user_id=(select auth.uid()));
create policy aura_preference_own_insert on public.user_preferences for insert to authenticated with check(user_id=(select auth.uid()));
create policy aura_preference_own_update on public.user_preferences for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

create function public.aura_voice_preferences_v1(p_voice text default null) returns jsonb
language plpgsql volatile security invoker set search_path=pg_catalog,public set statement_timeout='5s'
as $$
declare voice_name text;
begin
  perform public.aura_voice_access_v1();
  if p_voice is not null then
    if p_voice not in ('Aoede','Charon','Fenrir','Kore','Puck') then raise exception using errcode='22023',message='AURA_VOICE_INVALID'; end if;
    insert into public.user_preferences(user_id,aura_voice_preference) values(auth.uid(),p_voice)
      on conflict(user_id) do update set aura_voice_preference=excluded.aura_voice_preference;
  end if;
  select aura_voice_preference into voice_name from public.user_preferences where user_id=auth.uid();
  return jsonb_build_object('voiceName',coalesce(voice_name,'Kore'));
end $$;
revoke all on function public.aura_voice_preferences_v1(text) from public,anon,service_role;
grant execute on function public.aura_voice_preferences_v1(text) to authenticated;

create function public.aura_domain_context_v1() returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public set statement_timeout='5s'
as $$
declare glossary jsonb;
begin
  perform public.aura_voice_access_v1();
  select coalesce(jsonb_agg(jsonb_build_object('term',term,'canonical_entity',canonical_entity,'target_filter',target_filter) order by term),'[]'::jsonb)
    into glossary from public.aura_domain_glossary;
  return jsonb_build_object('glossary',glossary,'revision',md5(glossary::text));
end $$;
revoke all on function public.aura_domain_context_v1() from public,anon,service_role;
grant execute on function public.aura_domain_context_v1() to authenticated;

create function private.aura_form_matches_v1(description text,requested jsonb) returns boolean
language sql immutable parallel safe set search_path=pg_catalog
as $$
  with forms(form,pattern) as (values
    ('cone','cones?'),('spiral','spirals?'),('pompom','pom[ -]?poms?'),
    ('topiary','topiar(y|ies)'),('tree','trees?([ -]forms?)?'),('espalier','espaliers?')),
  detected as (select form from forms where coalesce(description,'') ~* ('(^|[^[:alnum:]])'||pattern||'([^[:alnum:]]|$)'))
  select case when jsonb_array_length(coalesce(requested,'[]'::jsonb))=0 then not exists(select 1 from detected)
    else exists(select 1 from detected d join jsonb_array_elements_text(requested) r(value) on d.form=r.value) end
$$;
revoke all on function private.aura_form_matches_v1(text,jsonb) from public,anon,authenticated,service_role;

-- Modify only the bounded filters and verified projection in the existing
-- reader. Its role, navigation, revision, season/year and ownership gates stay.
do $$
declare definition text; old_text text; new_text text;
begin
  definition:=replace(pg_get_functiondef('private.aura_voice_inventory_read_core_v1(uuid,text,jsonb,jsonb,integer)'::regprocedure),E'\r\n',E'\n');
  definition:=replace(definition,$old$('ptravailable','ptronhand','s_lts')$old$,$new$('ptravailable','ptronhand','s_lts','loc_on_hand','allocated','held')$new$);
  definition:=replace(definition,$old$>3 or exists($old$,$new$>6 or exists($new$);
  definition:=replace(definition,$old$('cone','tree','espalier')$old$,$new$('cone','tree','espalier','spiral','pompom','topiary')$new$);
  old_text:=$old$public.aura_query_number_v1(case when metric='ptronhand' then m.ptronhand when metric='s_lts' then m.s_lts else m.ptravailable end) qty,$old$;
  new_text:=$new$public.aura_query_number_v1(case when metric in ('ptronhand','loc_on_hand') then m.ptronhand
        when metric='s_lts' then m.s_lts
        when metric='allocated' then null
        when metric='held' then case when upper(btrim(coalesce(m.holdstopcode,''))) in ('H','S') then m.ptronhand else '0' end
        else m.ptravailable end) qty,$new$;
  if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then raise exception 'AURA_ENTERPRISE_METRIC_CONTRACT_MISMATCH'; end if;
  definition:=replace(definition,old_text,new_text);
  old_text:=$old$where not exists(select 1 from unnest(array['cone','tree','espalier']::text[]) variant
      where (coalesce(m.commonname,'')||' '||coalesce(m.desigitem,'')) ~* ('(^|[^[:alnum:]])'||variant||'s?([^[:alnum:]]|$)')
        and not exists(select 1 from jsonb_array_elements_text(coalesce(f->'requestedVariants','[]'::jsonb)) spoken(value) where lower(value)=variant))$old$;
  new_text:=$new$where private.aura_form_matches_v1(coalesce(m.commonname,'')||' '||coalesce(m.desigitem,''),f->'requestedVariants')$new$;
  if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then raise exception 'AURA_ENTERPRISE_FORM_CONTRACT_MISMATCH'; end if;
  execute replace(definition,old_text,new_text);

  definition:=replace(pg_get_functiondef('public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)'::regprocedure),E'\r\n',E'\n');
  definition:=replace(definition,$old$>3$old$,$new$>6$new$);
  definition:=replace(definition,$old$('cone','tree','espalier')$old$,$new$('cone','tree','espalier','spiral','pompom','topiary')$new$);
  old_text:=$old$where not exists (select 1 from unnest(array['cone','tree','espalier']::text[]) variant
      where (coalesce(s.commonname,'')||' '||coalesce(s.desigitem,'')) ~* ('(^|[^[:alnum:]])'||variant||'s?([^[:alnum:]]|$)')
        and not variant=any(variants))$old$;
  new_text:=$new$where private.aura_form_matches_v1(coalesce(s.commonname,'')||' '||coalesce(s.desigitem,''),to_jsonb(variants))$new$;
  if length(definition)-length(replace(definition,old_text,''))<>length(old_text) then raise exception 'AURA_ENTERPRISE_SOC_FORM_CONTRACT_MISMATCH'; end if;
  execute replace(definition,old_text,new_text);
end $$;
commit;
