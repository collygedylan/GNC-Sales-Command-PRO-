BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '45s';

-- Active profiles and exact row authorization remain authoritative for every caller.
CREATE OR REPLACE FUNCTION private.require_drive_live_change_profile_v2392(p_master_uid text, p_itemcode text, p_locationcode text, p_lotcode text)
 RETURNS profiles
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor public.profiles%rowtype;actor_key text;actor_role text;row_value public.ph_master_inventory%rowtype;
begin
  select p.* into actor from public.profiles p where p.id=auth.uid() and p.disabled_at is null
    and not p.must_change_password and (p.locked_until is null or p.locked_until<=statement_timestamp());
  if actor.id is null then raise exception using errcode='42501',message='DRIVE_LIVE_CHANGE_PROFILE_INACTIVE'; end if;
  actor_key:=private.normalize_inventory_live_change_username_v2392(actor.username);
  actor_role:=private.normalized_profile_role(actor.role);
  if actor_key=any(array['dylan_collyge','megan_kelly','jd_jones','mitch_kaiser'])
     or actor_role in ('ADMIN','ADMINISTRATOR','MANAGER') then return actor; end if;
  if actor_key<>'jorge_colunga' and actor_role not in ('EVAL','EVALUATOR') then
    raise exception using errcode='42501',message='DRIVE_LIVE_CHANGE_ADMIN_REQUIRED';
  end if;
  select m.* into row_value from public.ph_master_inventory m
  where m.unique_id=btrim(coalesce(p_master_uid,''))
    and upper(btrim(coalesce(m.itemcode,'')))=upper(btrim(coalesce(p_itemcode,'')))
    and upper(btrim(coalesce(m.locationcode,'')))=upper(btrim(coalesce(p_locationcode,'')))
    and upper(btrim(coalesce(m.lotcode,'')))=upper(btrim(coalesce(p_lotcode,''))) limit 1;
  if row_value.unique_id is null or not private.inventory_row_assigned_to_actor_v2392(
    actor_key,row_value.unique_id,row_value.itemcode) then
    raise exception using errcode='42501',message=case when actor_key='jorge_colunga'
      then 'INVENTORY_LIVE_CHANGE_JORGE_ROW_NOT_ASSIGNED' else 'INVENTORY_LIVE_CHANGE_ROW_NOT_ASSIGNED' end;
  end if;
  return actor;
end $function$
;

CREATE OR REPLACE FUNCTION public.can_upload_drive_evidence_v23115(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE row_value public.ph_master_inventory%ROWTYPE; uid text;
BEGIN
  IF auth.uid() IS NULL OR p_name !~ '^drive-evidence/[a-f0-9]+/(_thumbs/)?v2/[a-f0-9]{64}(-w(144|320))?\.(jpg|webp)$' THEN RETURN false; END IF;
  uid := convert_from(decode(split_part(p_name,'/',2),'hex'),'UTF8');
  SELECT * INTO row_value FROM public.ph_master_inventory WHERE unique_id=uid;
  IF row_value.unique_id IS NULL THEN RETURN false; END IF;
  PERFORM private.require_drive_live_change_profile_v2392(uid,row_value.itemcode,row_value.locationcode,row_value.lotcode);
  RETURN true;
EXCEPTION WHEN insufficient_privilege OR invalid_parameter_value OR character_not_in_repertoire THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.can_upload_drive_evidence_v23115(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_upload_drive_evidence_v23115(text) TO authenticated;
DROP POLICY IF EXISTS drive_evidence_native_insert_v23115 ON storage.objects;
CREATE POLICY drive_evidence_native_insert_v23115 ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id IN ('season_sales_notes_photos','location_sales_notes_photos','flyer_photos')
  AND public.can_upload_drive_evidence_v23115(name));

-- Preserve the existing roster and add currently active identities for all owner menus.
INSERT INTO public.ph_eval_assignment_users(username,display_name,active,source)
SELECT p.username,coalesce(nullif(p.display_name,''),p.username),true,'managed_roster'
FROM public.profiles p WHERE p.disabled_at IS NULL AND (p.locked_until IS NULL OR p.locked_until<=statement_timestamp())
  AND lower(p.username)<>'ellen_ward'
ON CONFLICT(username) DO UPDATE SET active=true,updated_at=statement_timestamp();

UPDATE public.ph_itemcode_default_owners SET assignedto='dylan_collyge',revision=revision+1,
 updated_by='dylan_collyge',updated_at=statement_timestamp()
WHERE private.normalize_inventory_live_change_username_v2392(assignedto)='ellen_ward';
UPDATE public.ph_warehouse_assigned_items SET assignedto='dylan_collyge',assigned_by='dylan_collyge',updated_at=statement_timestamp()
WHERE private.normalize_inventory_live_change_username_v2392(assignedto)='ellen_ward';
UPDATE public.ph_warehouse_assigned_items SET zone_override_prior_assignedto='dylan_collyge',updated_at=statement_timestamp()
WHERE private.normalize_inventory_live_change_username_v2392(zone_override_prior_assignedto)='ellen_ward';
UPDATE public.ph_inventory_row_assignments SET
 assignedto=CASE WHEN private.normalize_inventory_live_change_username_v2392(assignedto)='ellen_ward' THEN 'dylan_collyge' ELSE assignedto END,
 default_assignedto=CASE WHEN private.normalize_inventory_live_change_username_v2392(default_assignedto)='ellen_ward' THEN 'dylan_collyge' ELSE default_assignedto END,
 revision=revision+1,updated_at=statement_timestamp()
WHERE private.normalize_inventory_live_change_username_v2392(assignedto)='ellen_ward'
 OR private.normalize_inventory_live_change_username_v2392(default_assignedto)='ellen_ward';
UPDATE public.ph_eval_assignment_rules SET assignedto='dylan_collyge'
WHERE private.normalize_inventory_live_change_username_v2392(assignedto)='ellen_ward';
UPDATE public.ph_inquiry_coverage SET
 primary_user=CASE WHEN private.normalize_inventory_live_change_username_v2392(primary_user)='ellen_ward' THEN 'dylan_collyge' ELSE primary_user END,
 backup_user=CASE WHEN private.normalize_inventory_live_change_username_v2392(backup_user)='ellen_ward' THEN 'dylan_collyge' ELSE backup_user END,
 revision=revision+1,updated_by='dylan_collyge',updated_at=statement_timestamp()
WHERE private.normalize_inventory_live_change_username_v2392(primary_user)='ellen_ward'
 OR private.normalize_inventory_live_change_username_v2392(backup_user)='ellen_ward';
UPDATE public.ph_eval_assignment_users SET active=false,updated_at=statement_timestamp() WHERE lower(username)='ellen_ward';

-- Canonical targets are private overrides, not nonexistent public columns or a second statistics table.
INSERT INTO private.ph_eval_item_low_stock_overrides(itemcode_normalized,manual_override_qty,revision,updated_by,updated_at)
SELECT DISTINCT upper(btrim(itemcode)),150,1,'dylan_collyge',statement_timestamp()
FROM public.ph_master_inventory WHERE nullif(btrim(itemcode),'') IS NOT NULL
ON CONFLICT(itemcode_normalized) DO UPDATE SET manual_override_qty=150,
 revision=ph_eval_item_low_stock_overrides.revision+1,updated_by='dylan_collyge',updated_at=statement_timestamp()
WHERE ph_eval_item_low_stock_overrides.manual_override_qty IS DISTINCT FROM 150;
UPDATE private.ph_eval_item_low_stock_overrides SET manual_override_qty=150,revision=revision+1,
 updated_by='dylan_collyge',updated_at=statement_timestamp() WHERE manual_override_qty IS DISTINCT FROM 150;

CREATE OR REPLACE FUNCTION public.get_eval_item_low_stock_targets_v1(p_itemcodes text[] DEFAULT NULL::text[], p_after_itemcode text DEFAULT NULL::text, p_limit integer DEFAULT 500)
 RETURNS TABLE(itemcode_normalized text, qualifying_line_count integer, qualifying_day_count integer, source_file_count integer, mean_quantity numeric, p75_quantity numeric, suggested_qty integer, manual_override_qty integer, effective_qty integer, override_revision bigint, history_ready boolean, history_pending_files integer, history_total_files integer, history_from_date date, history_through_date date, calculated_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor public.profiles;
  requested_count integer;
  fallback_qty integer;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    actor := private.current_active_profile();
    if actor.id is null or not private.can_view_eval_item_low_stock_targets_v1() then
      raise exception using errcode = '42501', message = 'LOW_STOCK_TARGETS_FORBIDDEN';
    end if;
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'LOW_STOCK_TARGETS_LIMIT_INVALID';
  end if;
  if p_itemcodes is not null then
    select count(*) into requested_count from unnest(p_itemcodes);
    if requested_count > 500 then
      raise exception using errcode = '22023', message = 'LOW_STOCK_TARGETS_LIMIT_INVALID';
    end if;
  end if;
  select coalesce((select s.low_stock_max_slts from public.ph_eval_report_settings s where s.singleton limit 1), 150)
  into fallback_qty;

  return query
  with requested as (
    select distinct upper(btrim(code)) as itemcode_normalized
  from unnest(coalesce(p_itemcodes, '{}'::text[])) as requested_codes(code)
    where nullif(btrim(code), '') is not null
    union
    select stats.itemcode_normalized
    from private.eval_item_low_stock_target_stats_v1 stats
    where p_itemcodes is null
    union
    select o.itemcode_normalized
    from private.ph_eval_item_low_stock_overrides o
    where p_itemcodes is null
  ), page as (
    select r.itemcode_normalized
    from requested r
    where p_itemcodes is not null
       or p_after_itemcode is null
       or r.itemcode_normalized > upper(btrim(p_after_itemcode))
    order by r.itemcode_normalized
    limit p_limit
  ), history_state as (
    select
      s.active_run_id is not null and s.pending_run_id is null as history_ready,
      coalesce(jsonb_array_length(scan.expected_manifest), 0)::integer as history_total_files,
      coalesce((
        select count(*)::integer
        from private.ph_eval_item_low_stock_run_files rf
        left join private.ph_eval_item_low_stock_file_versions fv on fv.file_version_id = rf.file_version_id
        where rf.run_id = scan.run_id
          and (rf.file_version_id is null or fv.status <> 'finalized')
      ), 0) as history_pending_files
    from private.ph_eval_item_low_stock_import_state s
    left join private.ph_eval_item_low_stock_import_runs scan
      on scan.run_id = coalesce(s.pending_run_id, s.active_run_id)
    where s.singleton
  )
  select
    p.itemcode_normalized,
    coalesce(s.qualifying_line_count, 0),
    coalesce(s.qualifying_day_count, 0),
    coalesce(s.source_file_count, 0),
    s.mean_quantity,
    s.p75_quantity,
    s.suggested_qty,
    o.manual_override_qty,
    coalesce(o.manual_override_qty, 150),
    coalesce(o.revision, 0),
    coalesce(h.history_ready, false),
    coalesce(h.history_pending_files, 0),
    coalesce(h.history_total_files, 0),
    s.history_from_date,
    s.history_through_date,
    s.updated_at,
    greatest(s.updated_at, o.updated_at)
  from page p
  left join private.eval_item_low_stock_target_stats_v1 s
    on s.itemcode_normalized = p.itemcode_normalized
  left join private.ph_eval_item_low_stock_overrides o
    on o.itemcode_normalized = p.itemcode_normalized
  cross join history_state h
  order by p.itemcode_normalized;
end
$function$
;

-- Completed history versions stay immutable. Unfinished files are never relabeled as processed.
-- Existing cloud finalization recalculates affected item statistics atomically on new orders.
COMMENT ON FUNCTION public.can_upload_drive_evidence_v23115(text) IS 'AgData v2.3.115: authenticated exact-row photo storage recovery';
COMMIT;
