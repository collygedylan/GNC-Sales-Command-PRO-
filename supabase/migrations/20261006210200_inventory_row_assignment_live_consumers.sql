begin;

-- Replace the legacy broad assignment predicate in the existing protected
-- Reclass enqueue function. The source row and every edited overlay must be
-- owned by the evaluator's exact physical-row authority. Managers retain the
-- existing global permission path.
do $migration$
declare
  definition text;
  old_query text := $old$
    select exists (
      select 1
      from public.ph_warehouse_assigned_items a
      where a.present_in_drive
        and upper(btrim(coalesce(a.itemcode_normalized, a.itemcode, ''))) = upper(btrim(coalesce(source_row.itemcode, '')))
        and lower(regexp_replace(btrim(coalesce(a.genusname_normalized, a.genusname, '')), '[[:space:]]+', ' ', 'g'))
          = lower(regexp_replace(btrim(coalesce(source_json->>'genusname', '')), '[[:space:]]+', ' ', 'g'))
        and lower(regexp_replace(btrim(coalesce(a.assignedto, '')), '[^a-z0-9]+', '_', 'g')) = actor_username
    ) into assigned_to_actor;
$old$;
  new_query text := $new$
    select private.inventory_effective_owner_v1(source_uid) is not null
      and lower(regexp_replace(btrim(private.inventory_effective_owner_v1(source_uid)), '[^a-z0-9]+', '_', 'g')) = actor_username
      and not exists (
        select 1 from jsonb_array_elements(coalesce(p_payload->'rowOverlays', '[]'::jsonb)) overlay
        where nullif(btrim(coalesce(overlay->>'unique_id', '')), '') is null
          or lower(regexp_replace(btrim(coalesce(private.inventory_effective_owner_v1(overlay->>'unique_id'), '')), '[^a-z0-9]+', '_', 'g')) is distinct from actor_username
      )
    into assigned_to_actor;
$new$;
begin
  select pg_get_functiondef('public.enqueue_drive_reclass_inquiry_v1(jsonb)'::regprocedure) into definition;
  if position(old_query in definition) = 0 then
    raise exception using errcode = '55000', message = 'ROW_ASSIGNMENT_RECLASS_GUARD_SOURCE_MISMATCH';
  end if;
  execute replace(definition, old_query, new_query);
end
$migration$;

-- Manager Season Priority's list remains one source row per itemcode winner,
-- but its assignee filter/options now use that winner's exact row owner.
do $migration$
declare
  definition text;
  old_roster text := 'roster_available boolean := (select exists(select 1 from public.ph_warehouse_assigned_items));';
  old_lookup text := $old$
      select array_agg(distinct btrim(a.assignedto) order by btrim(a.assignedto))
        filter (where nullif(btrim(coalesce(a.assignedto, '')), '') is not null) values
      from public.ph_warehouse_assigned_items a
      where upper(btrim(coalesce(a.itemcode_normalized, a.itemcode, ''))) = upper(btrim(e.itemcode))
$old$;
  new_lookup text := $new$
      select array_agg(distinct btrim(a.assignedto) order by btrim(a.assignedto))
        filter (where nullif(btrim(coalesce(a.assignedto, '')), '') is not null) values
      from public.ph_inventory_row_assignments a
      where a.master_unique_id = e.unique_id and a.present_in_drive
$new$;
begin
  select pg_get_functiondef('public.manager_season_priority_list_v1(uuid,text)'::regprocedure) into definition;
  if position(old_roster in definition) = 0 or position(old_lookup in definition) = 0 then
    raise exception using errcode = '55000', message = 'ROW_ASSIGNMENT_SEASON_PRIORITY_SOURCE_MISMATCH';
  end if;
  definition := replace(definition, old_roster, 'roster_available boolean := true;');
  definition := replace(definition, old_lookup, new_lookup);
  execute definition;
end
$migration$;

-- Eval Reports #2 must label each physical row from that row's authority.
-- A missing or explicitly unassigned exact row remains unassigned; legacy
-- ItemCode + Genus matches must never bleed ownership across sibling lots.
do $migration$
declare
  definition text;
  crlf_projection text;
  lf_matches integer;
  crlf_matches integer;
  old_projection text := $old$
        'assignedToUsers', coalesce((
          select jsonb_agg(distinct coalesce(nullif(private.eval_normalize_user_v2(a.assignedto), ''), 'unassigned'))
          from public.ph_warehouse_assigned_items a
          where coalesce(a.present_in_drive, true)
            and upper(btrim(coalesce(a.itemcode_normalized, a.itemcode, ''))) = upper(btrim(m.itemcode))
            and lower(regexp_replace(btrim(coalesce(a.genusname, '')), '[[:space:]]+', ' ', 'g'))
              = lower(regexp_replace(btrim(coalesce(m.genusname, '')), '[[:space:]]+', ' ', 'g'))
        ), jsonb_build_array('unassigned'))
$old$;
  new_projection text := $new$
        'assignedToUsers', jsonb_build_array(coalesce(
          nullif(private.eval_normalize_user_v2(private.inventory_effective_owner_v1(m.unique_id)), ''),
          'unassigned'))
$new$;
begin
  select pg_get_functiondef('public.list_eval_report2_itemcodes_v1(jsonb)'::regprocedure) into definition;
  -- Stored function bodies may retain CRLF while pg_get_functiondef's header
  -- uses LF. Match only this exact fragment; leave all other source bytes alone.
  old_projection := replace(old_projection, chr(13) || chr(10), chr(10));
  new_projection := replace(new_projection, chr(13) || chr(10), chr(10));
  crlf_projection := replace(old_projection, chr(10), chr(13) || chr(10));
  lf_matches := (length(definition) - length(replace(definition, old_projection, ''))) / length(old_projection);
  crlf_matches := (length(definition) - length(replace(definition, crlf_projection, ''))) / length(crlf_projection);
  if lf_matches + crlf_matches <> 1 then
    raise exception using errcode = '55000', message = 'ROW_ASSIGNMENT_EVAL_REPORT_PROJECTION_SOURCE_MISMATCH';
  end if;
  if crlf_matches = 1 then
    old_projection := crlf_projection;
    new_projection := replace(new_projection, chr(10), chr(13) || chr(10));
  end if;
  execute replace(definition, old_projection, new_projection);
end
$migration$;

-- Review setup owns one concrete inventory source row. Resolve its evaluator
-- by the same UID (and revision) rather than finding a sibling row by a
-- legacy ItemCode + Genus group.
create or replace function private.eval_work_review_setup_v1(p_payload jsonb, p_lock boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  actor public.profiles;
  origin public.ph_master_inventory;
  assignment public.ph_inventory_row_assignments;
  assigned_username text;
  assigned_profile public.profiles;
  assigned_email text;
  source_json jsonb;
  evaluator_json jsonb;
  revision_value text;
begin
  actor := private.eval_work_assert_actor_v1(p_payload->>'actorUsername');
  if lower(actor.username) not in ('dylan_collyge', 'megan_kelly', 'jd_jones') or actor.must_change_password then
    raise exception using errcode = '42501', message = 'eval_work_create_forbidden';
  end if;
  if coalesce(p_payload#>>'{source,source_table}', '') <> 'ph_master_inventory' then
    raise exception using errcode = '22023', message = 'REVIEW_SOURCE_STALE';
  end if;
  if p_lock then
    select m.* into origin from public.ph_master_inventory m
    where m.unique_id = btrim(coalesce(p_payload#>>'{source,unique_id}', '')) for share;
  else
    select m.* into origin from public.ph_master_inventory m
    where m.unique_id = btrim(coalesce(p_payload#>>'{source,unique_id}', ''));
  end if;
  if origin.unique_id is null then
    raise exception using errcode = '22023', message = 'REVIEW_SOURCE_MISSING';
  end if;
  if upper(btrim(coalesce(origin.itemcode, ''))) <> upper(btrim(coalesce(p_payload#>>'{source,itemcode}', '')))
     or btrim(coalesce(origin.locationcode, '')) <> btrim(coalesce(p_payload#>>'{source,locationcode}', ''))
     or btrim(coalesce(origin.lotcode, '')) <> btrim(coalesce(p_payload#>>'{source,lotcode}', '')) then
    raise exception using errcode = '22023', message = 'REVIEW_SOURCE_STALE';
  end if;
  if p_lock then
    select a.* into assignment from public.ph_inventory_row_assignments a
    where a.master_unique_id = origin.unique_id and a.present_in_drive for share;
  else
    select a.* into assignment from public.ph_inventory_row_assignments a
    where a.master_unique_id = origin.unique_id and a.present_in_drive;
  end if;
  if assignment.master_unique_id is null or btrim(coalesce(assignment.assignedto, '')) = '' then
    raise exception using errcode = '22023', message = 'REVIEW_ASSIGNMENT_MISSING';
  end if;
  assigned_username := private.eval_normalize_user_v2(assignment.assignedto);
  if assigned_username <> all(array['josh_vann','jorge_colunga','abigail_vazquez','bobby_adair',
      'charley_robertson','ellen_ward','zoe_green','mitch_kaiser','dylan_collyge','megan_kelly',
      'kayla_knepp','jd_jones']) then
    raise exception using errcode = '22023', message = 'REVIEW_ASSIGNEE_INELIGIBLE';
  end if;
  if p_lock then
    select p.* into assigned_profile from public.profiles p
    where lower(p.username) = assigned_username for share;
  else
    select p.* into assigned_profile from public.profiles p where lower(p.username) = assigned_username;
  end if;
  if assigned_profile.id is null or assigned_profile.disabled_at is not null
     or assigned_profile.locked_until > now() then
    raise exception using errcode = '22023', message = 'REVIEW_ASSIGNEE_INACTIVE';
  end if;
  if p_lock then
    select lower(btrim(u.email)) into assigned_email from auth.users u where u.id = assigned_profile.id for share;
  else
    select lower(btrim(u.email)) into assigned_email from auth.users u where u.id = assigned_profile.id;
  end if;
  if coalesce(assigned_email, '') !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'REVIEW_ASSIGNEE_EMAIL_MISSING';
  end if;
  source_json := jsonb_build_object('unique_id', origin.unique_id, 'source_table', 'ph_master_inventory',
    'itemcode', origin.itemcode, 'genusname', origin.genusname, 'locationcode', origin.locationcode,
    'lotcode', origin.lotcode, 'source', origin.source, 'commonname', origin.commonname, 'contsize', origin.contsize);
  evaluator_json := jsonb_build_object('username', assigned_username,
    'displayName', coalesce(nullif(btrim(assigned_profile.display_name), ''), assigned_profile.username),
    'email', assigned_email);
  revision_value := md5(jsonb_build_array(source_json, assignment.master_unique_id, assignment.revision,
    assignment.assigned_at, assigned_profile.id, assigned_username, assigned_email)::text);
  return jsonb_build_object('source', source_json, 'evaluator', evaluator_json,
    'assignmentRevision', revision_value, 'completionRecipients', jsonb_build_array(assigned_email),
    'completionRecipientNames', jsonb_build_array(evaluator_json->>'displayName'));
end
$function$;
revoke all on function private.eval_work_review_setup_v1(jsonb,boolean) from public, anon, authenticated, service_role;

-- New Eval Work requests may target every exact lot in an ItemCode group, so
-- their recipient choices are the distinct effective owners of those source
-- rows. Existing Work keeps its frozen recipient list and source membership.
create or replace function private.eval_work_assignment_users_v1(p_itemcode text)
returns text[] language sql stable security definer set search_path = '' as $function$
  with matched as (
    select distinct coalesce(
      nullif(private.eval_normalize_user_v2(a.assignedto), ''),
      'unassigned'
    ) as username
    from public.ph_master_inventory m
    left join public.ph_inventory_row_assignments a
      on a.master_unique_id = m.unique_id and a.present_in_drive
    where upper(btrim(coalesce(m.itemcode, ''))) = upper(btrim(coalesce(p_itemcode, '')))
  )
  select case
    when exists (select 1 from matched)
      then coalesce((select array_agg(username order by username) from matched), '{}'::text[])
    else array['unassigned']::text[]
  end
$function$;
revoke all on function private.eval_work_assignment_users_v1(text) from public, anon, authenticated, service_role;

-- Eval Work creation uses the row-authoritative assignment helper above.
-- These issued-work records keep their stored assignees; membership checks
-- remain strict for every source UID and the full source signature.
do $migration$
declare
  definition text;
  old_owner_gate text := $old$
  select coalesce(array_agg(value), '{}'::text[]) into selected_filters
  from jsonb_array_elements_text(coalesce(work.source_context#>'{report,selectedUserFilters}', '[]'::jsonb)) value;
  matched_users := private.eval_work_match_assignment_users_v1(work.itemcode, selected_filters);
  if matched_users is distinct from work.assigned_to_users then
    raise exception using errcode = '40001', message = 'eval_work_assignment_scope_conflict';
  end if;
$old$;
begin
  select pg_get_functiondef('private.eval_work_assert_itemcode_membership_v1(uuid)'::regprocedure) into definition;
  if position(old_owner_gate in definition) = 0 then
    raise exception using errcode = '55000', message = 'ROW_ASSIGNMENT_EVAL_WORK_MEMBERSHIP_SOURCE_MISMATCH';
  end if;
  execute replace(definition, old_owner_gate, '');
end
$migration$;

notify pgrst, 'reload schema';
commit;
