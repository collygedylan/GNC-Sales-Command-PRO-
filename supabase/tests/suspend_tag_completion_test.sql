\set ON_ERROR_STOP on
-- Synthetic disposable database only; all business fixtures roll back.
begin;
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$begin
  if value is distinct from true then raise exception 'FAILED: %',label; end if;
end$$;
insert into public.profiles values
 ('11111111-1111-4111-8111-111111111111','dylan_collyge','Admin',null,null,false),
 ('22222222-2222-4222-8222-222222222222','jd_jones','Admin',null,null,false),
 ('33333333-3333-4333-8333-333333333333','megan_kelly','Admin',null,null,false),
 ('44444444-4444-4444-8444-444444444444','other_user','Admin',null,null,false);
insert into auth.sessions select id,id,now()+interval '1 day' from public.profiles;
insert into public.ph_soc_master(unique_id,last_updated,suspend,suspend_to,itemcode,locationcode,lotcode,ptronhand,ptravailable,s_lts,quantityordered,quantityshipped,dock_note) values
 ('synthetic-a','2026-09-08T12:00:00Z','SUSPEND','DC','TEST-A','TEST.LOC','27.F1','0','0','0','10','0','retain'),
 ('synthetic-b','2026-09-08T12:00:00Z',' suspend ',' D.C. ','TEST-B','TEST.LOC2','27.F1','23','19','100','10','0','retain'),
 ('synthetic-ineligible','2026-09-08T12:00:00Z','SUSPEND','OTHER','TEST-C','TEST.LOC3','27.F1','23','19','100','10','0','retain');
select set_config('request.jwt.claims',jsonb_build_object('sub','11111111-1111-4111-8111-111111111111','session_id','11111111-1111-4111-8111-111111111111','role','authenticated','iss','https://kzrnyjsosryejjejliii.supabase.co/auth/v1','exp',extract(epoch from now())+3600)::text,true);

-- Exercise the real authenticated wrapper privileges, not just owner bypass.
set local role authenticated;
select public.complete_suspend_tag_v1('synthetic-a','2026-09-08T12:00:00Z','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
reset role;
do $$
declare ack jsonb; retry jsonb; stock jsonb; first_time timestamptz; token uuid:=gen_random_uuid();
  claims text:=current_setting('request.jwt.claims'); actor text;
begin
  select date_completed into first_time from public.ph_soc_master where unique_id='synthetic-a';
  perform pg_temp.assert_true(first_time is not null and first_time>=transaction_timestamp(),'server timestamp saved');
  perform pg_temp.assert_true((select count(*) from public.ph_soc_master)=3,'all source rows retained');
  perform pg_temp.assert_true((select ptronhand='0' and ptravailable='0' and s_lts='0' and quantityordered='10' and quantityshipped='0' and dock_note='retain' from public.ph_soc_master where unique_id='synthetic-a'),'zero stock row completes without stock or note edits');
  ack:=public.complete_suspend_tag_v1('synthetic-a','2026-09-08T12:00:00Z','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  perform pg_temp.assert_true((ack->>'ok')::boolean and not (ack->>'alreadyCompleted')::boolean,'receipt preserves original success');
  perform pg_temp.assert_true((ack->>'sourceLastUpdated')::timestamptz='2026-09-08T12:00:00Z'::timestamptz,'canonical source revision');
  retry:=public.complete_suspend_tag_v1('synthetic-a','2026-09-08T12:00:00Z',gen_random_uuid());
  perform pg_temp.assert_true((retry->>'alreadyCompleted')::boolean and (retry->>'completedAt')::timestamptz=first_time,'new token already-completed acknowledgment does not restamp');
  perform pg_temp.assert_true((select count(*) from public.fixture_live_events)=1,'duplicate Done emits no duplicate update event');
  begin perform public.complete_suspend_tag_v1('synthetic-b','2026-09-08T12:00:00Z','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');raise exception 'FAILED: changed token payload accepted';exception when invalid_parameter_value then perform pg_temp.assert_true(sqlerrm='SUSPEND_TAG_TOKEN_CONFLICT','token conflict code');end;
  begin perform public.complete_suspend_tag_v1('synthetic-b','2026-09-07T12:00:00Z',gen_random_uuid());raise exception 'FAILED: stale source accepted';exception when serialization_failure then perform pg_temp.assert_true(sqlerrm='SUSPEND_TAG_SOURCE_CHANGED','stale revision code');end;
  begin perform public.complete_suspend_tag_v1('missing-source',null,gen_random_uuid());raise exception 'FAILED: missing source accepted';exception when no_data_found then null;end;
  begin perform public.complete_suspend_tag_v1('synthetic-ineligible','2026-09-08T12:00:00Z',gen_random_uuid());raise exception 'FAILED: wrong suspend target accepted';exception when invalid_parameter_value then null;end;
  begin perform public.complete_suspend_tag_v1('synthetic-b','2026-09-08T12:00:00Z',null);raise exception 'FAILED: tokenless completion';exception when invalid_parameter_value then null;end;
  select to_jsonb(s)-'date_completed' into stock from public.ph_soc_master s where unique_id='synthetic-b';
  retry:=public.complete_suspend_tag_v1('synthetic-b','2026-09-08T12:00:00Z',token);
  perform pg_temp.assert_true((select to_jsonb(s)-'date_completed'=stock from public.ph_soc_master s where unique_id='synthetic-b'),'only completion field changed');
  -- A changed import is not silently completed by replay of an older request.
  update public.ph_soc_master set last_updated='2026-09-09T12:00:00Z',date_completed=null where unique_id='synthetic-b';
  perform pg_temp.assert_true(public.complete_suspend_tag_v1('synthetic-b','2026-09-08T12:00:00Z',token)=retry,'lost response replay returns original receipt');
  perform pg_temp.assert_true((select date_completed is null from public.ph_soc_master where unique_id='synthetic-b'),'old receipt never re-completes changed source');
  delete from public.ph_soc_master where unique_id='synthetic-b';
  perform pg_temp.assert_true(public.complete_suspend_tag_v1('synthetic-b','2026-09-08T12:00:00Z',token)=retry,'receipt survives later source deletion without recreating source');

  -- Current session and account are rechecked even for durable receipt replay.
  update public.profiles set disabled_at=now() where username='dylan_collyge';
  begin perform public.complete_suspend_tag_v1('synthetic-a','2026-09-08T12:00:00Z','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');raise exception 'FAILED: disabled replay';exception when insufficient_privilege then null;end;
  update public.profiles set disabled_at=null,locked_until=now()+interval '1 day' where username='dylan_collyge';
  begin perform public.complete_suspend_tag_v1('synthetic-a','2026-09-08T12:00:00Z',gen_random_uuid());raise exception 'FAILED: locked completion';exception when insufficient_privilege then null;end;
  update public.profiles set locked_until=null,must_change_password=true where username='dylan_collyge';
  begin perform public.complete_suspend_tag_v1('synthetic-a','2026-09-08T12:00:00Z',gen_random_uuid());raise exception 'FAILED: password gate bypass';exception when insufficient_privilege then null;end;
  update public.profiles set must_change_password=false where username='dylan_collyge';
  update auth.sessions set not_after=now()-interval '1 second' where id='11111111-1111-4111-8111-111111111111';
  begin perform public.complete_suspend_tag_v1('synthetic-a','2026-09-08T12:00:00Z',gen_random_uuid());raise exception 'FAILED: expired session';exception when insufficient_privilege then null;end;
  update auth.sessions set not_after=now()+interval '1 day' where id='11111111-1111-4111-8111-111111111111';
  perform set_config('request.jwt.claims',(claims::jsonb||jsonb_build_object('exp',extract(epoch from now())-1))::text,true);
  begin perform public.complete_suspend_tag_v1('synthetic-a','2026-09-08T12:00:00Z',gen_random_uuid());raise exception 'FAILED: expired JWT';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claims',(claims::jsonb||jsonb_build_object('iss','legacy-app'))::text,true);
  begin perform public.complete_suspend_tag_v1('synthetic-a','2026-09-08T12:00:00Z',gen_random_uuid());raise exception 'FAILED: legacy issuer';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claims',(claims::jsonb||jsonb_build_object('session_id',gen_random_uuid()))::text,true);
  begin perform public.complete_suspend_tag_v1('synthetic-a','2026-09-08T12:00:00Z',gen_random_uuid());raise exception 'FAILED: revoked session';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claims',(claims::jsonb||'{"sub":"44444444-4444-4444-8444-444444444444","session_id":"44444444-4444-4444-8444-444444444444","user_metadata":{"username":"dylan_collyge"}}'::jsonb)::text,true);
  begin perform public.complete_suspend_tag_v1('synthetic-a','2026-09-08T12:00:00Z',gen_random_uuid());raise exception 'FAILED: unauthorized admin metadata';exception when insufficient_privilege then null;end;
  foreach actor in array array['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'] loop
    perform set_config('request.jwt.claims',(claims::jsonb||jsonb_build_object('sub',actor,'session_id',actor))::text,true);
    perform pg_temp.assert_true((public.complete_suspend_tag_v1('synthetic-a','2026-09-08T12:00:00Z',gen_random_uuid())->>'alreadyCompleted')::boolean,'existing JD/Megan Suspend membership preserved');
  end loop;
  perform set_config('request.jwt.claims',claims,true);
  perform pg_temp.assert_true(not has_table_privilege('authenticated','public.ph_soc_master','UPDATE'),'SOC update grants remain revoked');
  perform pg_temp.assert_true(not has_table_privilege('authenticated','suspend_tag_private.completion_commands','INSERT'),'no receipt forgery grant');
  perform pg_temp.assert_true(not has_function_privilege('anon','public.complete_suspend_tag_v1(text,timestamptz,uuid)','EXECUTE'),'anonymous wrapper denied');
  perform pg_temp.assert_true(not has_function_privilege('anon','suspend_tag_private.complete(text,timestamptz,uuid)','EXECUTE'),'anonymous helper denied');
end$$;
rollback;
select 'Suspend Tag transaction tests passed; synthetic fixtures rolled back.' as result;
