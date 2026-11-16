-- Disposable replay of the installed resolver and three synthetic reviewers.
begin;
do $fixture$
begin
 if to_regclass('private.ci_schema_workspace_guard') is null then
 raise exception 'CANONICAL_WATCHDOG_REVIEWER_FIXTURE_ONLY'; end if;
 if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
 or exists(select 1 from public.profiles where username in ('dylan_collyge','megan_kelly','jd_jones'))
 or to_regprocedure('public.resolve_runtime_watchdog_events_v23158(bigint[])') is not null then
 raise exception 'CANONICAL_WATCHDOG_REVIEWER_PRECONDITION_CHANGED'; end if;
end $fixture$;
CREATE OR REPLACE FUNCTION public.resolve_runtime_watchdog_events_v23158(p_ids bigint[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE actor public.profiles; resolved_count integer; confirmed_ids bigint[];
BEGIN
 actor:=private.current_active_profile();
 IF actor.id IS NULL OR coalesce(lower(actor.username),'') NOT IN ('dylan_collyge','megan_kelly','jd_jones') THEN RAISE EXCEPTION 'WATCHDOG_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF coalesce(cardinality(p_ids),0) NOT BETWEEN 1 AND 250 OR EXISTS(SELECT FROM unnest(p_ids) id WHERE id IS NULL OR id<=0) THEN RAISE EXCEPTION 'WATCHDOG_EVENT_IDS_REQUIRED' USING ERRCODE='22023'; END IF;
 PERFORM set_config('agdata.watchdog_review_version',coalesce(substring((coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-client-info') from '^agdata/(?:AgData v|v)?([0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,6})$'),''),true);
 PERFORM id FROM public.app_runtime_watchdog_events WHERE id=ANY(p_ids) ORDER BY id FOR UPDATE;
 UPDATE public.app_runtime_watchdog_events SET status='resolved' WHERE id=ANY(p_ids) AND status='open';
 GET DIAGNOSTICS resolved_count=ROW_COUNT;
 SELECT array_agg(id ORDER BY id) INTO confirmed_ids FROM public.app_runtime_watchdog_events WHERE id=ANY(p_ids) AND status='resolved';
 IF NOT p_ids <@ coalesce(confirmed_ids,ARRAY[]::bigint[]) THEN RAISE EXCEPTION 'WATCHDOG_REVIEW_UNCONFIRMED'; END IF;
 RETURN jsonb_build_object('ok',true,'resolved',resolved_count,'confirmed_ids',confirmed_ids);
END $function$;
revoke all on function public.resolve_runtime_watchdog_events_v23158(bigint[]) from public,anon,service_role;
grant execute on function public.resolve_runtime_watchdog_events_v23158(bigint[]) to authenticated;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('ad740000-0000-4000-8000-000000000001','authenticated','authenticated','dylan_collyge@fixture.invalid','',now(),'{}','{}',now(),now()),
 ('ad740000-0000-4000-8000-000000000002','authenticated','authenticated','megan_kelly@fixture.invalid','',now(),'{}','{}',now(),now()),
 ('ad740000-0000-4000-8000-000000000003','authenticated','authenticated','jd_jones@fixture.invalid','',now(),'{}','{}',now(),now());
insert into public.profiles(id,username,display_name,role,must_change_password) values
 ('ad740000-0000-4000-8000-000000000001','dylan_collyge','Synthetic Dylan','Admin',false),
 ('ad740000-0000-4000-8000-000000000002','megan_kelly','Synthetic Megan','Admin',false),
 ('ad740000-0000-4000-8000-000000000003','jd_jones','Synthetic JD','Admin',false);
update public.user_access set manage_user_access='Y' where profile_id in (
 'ad740000-0000-4000-8000-000000000001','ad740000-0000-4000-8000-000000000002','ad740000-0000-4000-8000-000000000003');
commit;
