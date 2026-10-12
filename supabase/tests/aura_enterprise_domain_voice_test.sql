-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select plan(29);
select has_table('public','aura_domain_glossary','Dynamic glossary is installed');
select has_table('public','user_preferences','Private per-user voice preferences are installed');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.user_preferences'::regclass),'Voice preferences enforce RLS');
select is((select count(*)::integer from public.aura_domain_glossary where term in ('3dp','1g','2g','3g','5g','7g','10g','15g','b&b','open stock','on hand','allocated','held')),13,'Baseline nursery aliases are seeded');
select throws_ok($$insert into public.aura_domain_glossary(term,canonical_entity,target_filter) values('broken','container_size','{}')$$,'23514',null,'Missing catalog size fails closed');
select throws_ok($$insert into public.aura_domain_glossary(term,canonical_entity,target_filter) values('Upper Case','container_size','{"size":"#7"}')$$,'23514',null,'Glossary terms must be normalized');
select ok(private.aura_form_matches_v1('Baby Gem Boxwood','[]'),'Base shrubs match without specialty forms');
select ok(not private.aura_form_matches_v1('Baby Gem Cone','[]'),'Unrequested cones are excluded');
select ok(not private.aura_form_matches_v1('Baby Gem Spiral','[]'),'Unrequested spirals are excluded');
select ok(not private.aura_form_matches_v1('Baby Gem Pom Pom','[]'),'Unrequested pom poms are excluded');
select ok(not private.aura_form_matches_v1('Baby Gem Topiary','[]'),'Unrequested topiary is excluded');
select ok(not private.aura_form_matches_v1('Baby Gem Tree Form','[]'),'Unrequested tree forms are excluded');
select ok(not private.aura_form_matches_v1('Baby Gem Espalier','[]'),'Unrequested espalier is excluded');
select ok(private.aura_form_matches_v1('Baby Gem Cone','["cone"]'),'Explicit cone requests match cones');
select ok(not private.aura_form_matches_v1('Baby Gem Boxwood','["cone"]'),'Explicit cone requests exclude the base shrub');
select ok(not private.aura_form_matches_v1('Baby Gem Spiral','["cone"]'),'Explicit cone requests exclude spirals');
select ok(not has_function_privilege('authenticated','private.aura_form_matches_v1(text,jsonb)','execute'),'Private form helper is not a browser API');
select ok(not has_column_privilege('authenticated','public.user_preferences','user_id','update'),'Preference owners cannot change account IDs');
select ok(not has_function_privilege('anon','public.aura_voice_preferences_v1(text)','execute'),'Anonymous users cannot read or change preferences');
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('f7120000-0000-4000-8000-000000000001','aura-master-a@example.invalid','{}','{}'),
 ('f7120000-0000-4000-8000-000000000002','aura-master-b@example.invalid','{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password) values
 ('f7120000-0000-4000-8000-000000000001','aura_master_a','Aura Master A',E'\n REP \t',false),
 ('f7120000-0000-4000-8000-000000000002','aura_master_b','Aura Master B','REP',false);
insert into private.navigation_view_catalog(view_key,label,selectable) values('drive','Drive',true) on conflict(view_key) do nothing;
insert into private.navigation_view_overrides(profile_id,view_key,allowed) values
 ('f7120000-0000-4000-8000-000000000001','drive',true),
 ('f7120000-0000-4000-8000-000000000002','drive',true);
insert into public.user_preferences(user_id,aura_voice_preference) values('f7120000-0000-4000-8000-000000000002','Charon');
select set_config('request.jwt.claims','{"sub":"f7120000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.aura_voice_access_v1()->>'ok','true','Whitespace in a verified Rep role does not break the handshake');
select is(public.aura_voice_preferences_v1()->>'voiceName','Kore','New users default to Kore');
select is(public.aura_voice_preferences_v1('Aoede')->>'voiceName','Aoede','Caller can save an official Gemini voice');
select is((select count(*)::integer from public.user_preferences),1,'Caller sees only their own preference');
select throws_ok($$insert into public.user_preferences(user_id,aura_voice_preference) values('f7120000-0000-4000-8000-000000000002','Puck') on conflict(user_id) do update set aura_voice_preference=excluded.aura_voice_preference$$,'42501',null,'Caller cannot write a peer preference');
select throws_ok($$select public.aura_voice_preferences_v1('Unknown')$$,'22023','AURA_VOICE_INVALID','Unsupported voices are rejected');
select ok(jsonb_array_length(public.aura_domain_context_v1()->'glossary')>=13,'Authorized caller can read dynamic glossary');
select ok((public.aura_domain_context_v1()->>'revision') ~ '^[a-f0-9]{32}$','Glossary has a deterministic revision');
reset role;
select is((select aura_voice_preference from public.user_preferences where user_id='f7120000-0000-4000-8000-000000000002'),'Charon','Peer preference remains unchanged');
update public.profiles set disabled_at=clock_timestamp() where id='f7120000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.aura_voice_preferences_v1('Kore')$$,'42501','AURA_ACTOR_FORBIDDEN','Disabled accounts cannot use the preference RPC');
select * from finish();
rollback;
