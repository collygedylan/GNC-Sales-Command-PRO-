BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';

CREATE OR REPLACE FUNCTION private.role_matrix_flag_v3074(p_matrix jsonb,p_key text,p_alias text DEFAULT NULL)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN upper(btrim(coalesce(p_matrix->>p_key,p_matrix->>p_alias,'N')))='Y' THEN 'Y' ELSE 'N' END
$$;
REVOKE ALL ON FUNCTION private.role_matrix_flag_v3074(jsonb,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.seed_user_access_v23119(p public.profiles)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE name text:=private.access_username_v23119(p.username); baseline jsonb; reps jsonb;
  edit_all text; assigned text; flyers text;
BEGIN
  IF p.disabled_at IS NOT NULL THEN RETURN; END IF;
  SELECT matrix_permissions INTO baseline FROM public.role_access_baselines
    WHERE role=private.canonical_user_access_role_v1(p.role);
  baseline:=coalesce(baseline,'{}'::jsonb);
  edit_all:=private.role_matrix_flag_v3074(baseline,'edit_any_row','can_edit_all_rows');
  assigned:=private.role_matrix_flag_v3074(baseline,'edit_assigned_rows_only','can_edit_assigned_items');
  flyers:=private.role_matrix_flag_v3074(baseline,'flyer_folder_access','can_manage_flyers');
  reps:=CASE WHEN private.role_matrix_flag_v3074(baseline,'request_all_reps')='Y'
    THEN private.access_rep_roster_v23119() ELSE coalesce(baseline->'sales_rep_access',jsonb_build_object(name,'Y')) END;
  reps:=reps||coalesce((SELECT jsonb_object_agg(private.access_username_v23119(rep),'Y')
    FROM public.user_access_control control CROSS JOIN LATERAL unnest(control.salesrep_match_names) rep
    WHERE control.profile_id=p.id AND nullif(btrim(rep),'') IS NOT NULL),'{}'::jsonb);
  INSERT INTO public.user_access(profile_id,username,display_name,role,make_request,can_make_request,
    request_all_reps,edit_any_row,can_edit_all_rows,edit_assigned_rows_only,can_edit_assigned_items,
    flyer_folder_access,can_manage_flyers,sales_rep_access,allowed_request_reps,view_permissions,manage_tables,
    create_project,approve_suspend_tags,view_all_requests,view_all_suspend,submit_reclass,complete_suspend_tag,
    manage_user_access,use_weather_hold_risk_tools,use_aura_assistant,view_nursery_command_tables)
  VALUES(p.id,name,coalesce(nullif(btrim(p.display_name),''),name),btrim(coalesce(p.role,'')),
    private.role_matrix_flag_v3074(baseline,'make_request','can_make_request'),
    private.role_matrix_flag_v3074(baseline,'make_request','can_make_request'),
    private.role_matrix_flag_v3074(baseline,'request_all_reps'),edit_all,edit_all,assigned,assigned,flyers,flyers,
    reps,reps,coalesce(baseline->'view_permissions','{}'::jsonb),private.role_matrix_flag_v3074(baseline,'manage_tables'),
    private.role_matrix_flag_v3074(baseline,'create_project'),private.role_matrix_flag_v3074(baseline,'approve_suspend_tags'),
    private.role_matrix_flag_v3074(baseline,'view_all_requests'),private.role_matrix_flag_v3074(baseline,'view_all_suspend'),
    private.role_matrix_flag_v3074(baseline,'submit_reclass'),private.role_matrix_flag_v3074(baseline,'complete_suspend_tag'),
    private.role_matrix_flag_v3074(baseline,'manage_user_access'),private.role_matrix_flag_v3074(baseline,'use_weather_hold_risk_tools'),
    private.role_matrix_flag_v3074(baseline,'use_aura_assistant'),private.role_matrix_flag_v3074(baseline,'view_nursery_command_tables'))
  ON CONFLICT(username) DO UPDATE SET profile_id=excluded.profile_id,display_name=excluded.display_name,role=excluded.role;
END $$;

CREATE TABLE IF NOT EXISTS private.runtime_watchdog_reviewers_v3074(
  profile_id uuid PRIMARY KEY,username text NOT NULL UNIQUE
);
ALTER TABLE private.runtime_watchdog_reviewers_v3074 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.runtime_watchdog_reviewers_v3074 FROM PUBLIC,anon,authenticated,service_role;
DO $roster$
DECLARE source text; predicate text; eligible integer;
BEGIN
  source:=pg_get_functiondef('public.resolve_runtime_watchdog_events_v23158(bigint[])'::regprocedure);
  predicate:=substring(source FROM $re$coalesce\(lower\(actor.username\),''\) NOT IN \([^)]+\)$re$);
  IF predicate IS NULL THEN RAISE EXCEPTION 'WATCHDOG_REVIEWER_AUTHORITY_CHANGED'; END IF;
  predicate:=replace(predicate,'actor.username','profile.username');
  EXECUTE 'SELECT count(*) FROM public.profiles profile JOIN public.user_access matrix ON matrix.profile_id=profile.id
    WHERE NOT ('||predicate||') AND matrix.manage_user_access=''Y''
      AND profile.disabled_at IS NULL AND profile.must_change_password IS FALSE
      AND public.app_account_active_v1(profile.id,profile.username)' INTO eligible;
  IF eligible<>3 THEN RAISE EXCEPTION 'WATCHDOG_REVIEWER_ROSTER_CHANGED'; END IF;
  EXECUTE 'INSERT INTO private.runtime_watchdog_reviewers_v3074(profile_id,username)
    SELECT profile.id,lower(profile.username) FROM public.profiles profile JOIN public.user_access matrix ON matrix.profile_id=profile.id
    WHERE NOT ('||predicate||') AND matrix.manage_user_access=''Y''
      AND profile.disabled_at IS NULL AND profile.must_change_password IS FALSE
      AND public.app_account_active_v1(profile.id,profile.username)
    ON CONFLICT DO NOTHING';
  IF (SELECT count(*) FROM private.runtime_watchdog_reviewers_v3074)<>eligible THEN
    RAISE EXCEPTION 'WATCHDOG_FROZEN_REVIEWER_ROSTER_CHANGED';
  END IF;
END $roster$;

CREATE OR REPLACE FUNCTION public.read_reviewed_watchdog_events_v3074(
  p_include_resolved boolean DEFAULT false,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET statement_timeout='2s' AS $$
DECLARE actor public.profiles; result jsonb;
BEGIN
  actor:=private.current_active_profile();
  IF actor.id IS NULL OR NOT EXISTS (SELECT 1 FROM private.runtime_watchdog_reviewers_v3074 roster
    JOIN public.user_access matrix ON matrix.profile_id=roster.profile_id
    WHERE roster.profile_id=actor.id AND roster.username=lower(actor.username)
      AND matrix.manage_user_access='Y') THEN
    RAISE EXCEPTION 'WATCHDOG_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF coalesce(p_offset,0) NOT BETWEEN 0 AND 5000 THEN RAISE EXCEPTION 'WATCHDOG_PAGE_INVALID' USING ERRCODE='22023'; END IF;
  WITH candidates AS MATERIALIZED (
    SELECT event.* FROM public.app_runtime_watchdog_events event
    WHERE coalesce(p_include_resolved,false) OR event.status='open'
    ORDER BY (event.status='open') DESC,event.last_seen_at DESC,event.id DESC
    LIMIT 251 OFFSET coalesce(p_offset,0)
  ), page AS (
    SELECT * FROM candidates ORDER BY (status='open') DESC,last_seen_at DESC,id DESC LIMIT 250
  )
  SELECT jsonb_build_object('ok',true,'data',coalesce(jsonb_agg(to_jsonb(page)
    ORDER BY (page.status='open') DESC,page.last_seen_at DESC,page.id DESC),'[]'::jsonb),
    'hasMore',(SELECT count(*)>250 FROM candidates)) INTO result FROM page;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_reviewed_watchdog_events_v3074(boolean,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_reviewed_watchdog_events_v3074(boolean,integer) TO authenticated;
COMMIT;
