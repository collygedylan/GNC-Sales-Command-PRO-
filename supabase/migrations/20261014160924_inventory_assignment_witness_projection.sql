begin;
-- Narrow the bounded assignment checkpoint witness to the fields that its
-- resolver actually consumes, hashing each compact row before aggregation.
create or replace function private.inventory_row_assignment_reconcile_source_witness_v1()
returns text language sql stable security definer set search_path = '' as $$
  select md5(jsonb_build_array(
    coalesce((select string_agg(md5(jsonb_build_array(
      m.unique_id, m.itemcode, m.genusname, m.commonname, m.contsize,
      m.locationcode, m.lotcode, m.source, m.warehousei, m.plantgroupcode
    )::text), '' order by m.unique_id)
      from public.ph_master_inventory m), ''),
    coalesce((select string_agg(md5(jsonb_build_array(
      d.itemcode_normalized, d.assignedto, d.review_required, d.revision, d.assigned_at
    )::text), '' order by d.itemcode_normalized)
      from public.ph_itemcode_default_owners d), ''),
    coalesce((select string_agg(md5(jsonb_build_array(
      a.assignment_key, a.present_in_drive, a.zone_override_active,
      a.zone_override_prior_assignedto, a.zone_override_prior_assigned_at,
      a.assignedto, a.assigned_at
    )::text), '' order by a.assignment_key)
      from public.ph_warehouse_assigned_items a), ''),
    coalesce((select string_agg(md5(jsonb_build_array(u.username, u.active)::text), '' order by u.username)
      from public.ph_eval_assignment_users u), ''),
    coalesce((select string_agg(md5(jsonb_build_array(
      p.username, p.disabled_at, p.locked_until,
      p.disabled_at is null and (p.locked_until is null or p.locked_until <= now())
    )::text), '' order by p.username)
      from public.profiles p), ''),
    coalesce((select string_agg(md5(jsonb_build_array(s.singleton, s.active)::text), '' order by s.singleton)
      from private.ph_inventory_row_assignment_policy_state s), '')
  )::text)
$$;
revoke all on function private.inventory_row_assignment_reconcile_source_witness_v1()
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
