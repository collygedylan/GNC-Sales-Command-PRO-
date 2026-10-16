begin;

-- Reclass-created target rows need the same priority/hold and Item6 lineage
-- baselines as any ordinary insert. Their identity helpers only consume these
-- fields, so avoid serializing all 213 master columns just to extract them.
create or replace function private.ph_master_inventory_lineage_key_v1(p_row public.ph_master_inventory)
returns text
language sql immutable security definer set search_path = ''
as $function$
  select encode(extensions.digest(convert_to(jsonb_build_array(
    coalesce(p_row.warehouseid,p_row.warehousei,''),coalesce(p_row.itemcode,''),coalesce(p_row.contsize,''),
    coalesce(p_row.locationcode,''),coalesce(p_row.lotcode,''),coalesce(p_row.source,''),
    coalesce(p_row.desigitem,''),coalesce(p_row.desigcust,''),coalesce(p_row.desigloc,''))::text,'UTF8'),'sha256'),'hex')
$function$;
revoke all on function private.ph_master_inventory_lineage_key_v1(public.ph_master_inventory)
  from public,anon,authenticated,service_role;

create or replace function private.ph_master_inventory_stable_identity_v7(p_row public.ph_master_inventory)
returns text
language sql immutable security definer set search_path = ''
as $function$
  select encode(extensions.digest(convert_to(jsonb_build_array(
    coalesce(p_row.warehouseid,p_row.warehousei,''),coalesce(p_row.itemcode,''),coalesce(p_row.contsize,''),
    coalesce(p_row.locationcode,''),coalesce(p_row.lotcode,''),coalesce(p_row.source,''))::text,'UTF8'),'sha256'),'hex')
$function$;
revoke all on function private.ph_master_inventory_stable_identity_v7(public.ph_master_inventory)
  from public,anon,authenticated,service_role;

-- Preserve the deployed trigger function bodies and ACLs. Replace only the
-- identity-helper arguments, failing closed if deployed definitions differ.
do $migration$
declare
  definition text;
  old_call text;
  new_call text;
  signature text;
begin
  for signature, old_call, new_call in values
    ('private.guard_ph_master_inventory_priority_hold_v1()',
     'private.ph_master_inventory_lineage_key_v1(to_jsonb(new))',
     'private.ph_master_inventory_lineage_key_v1(new)'),
    ('private.guard_ph_master_inventory_priority_hold_v1()',
     'private.ph_master_inventory_lineage_key_v1(to_jsonb(old))',
     'private.ph_master_inventory_lineage_key_v1(old)'),
    ('private.refresh_ph_master_inventory_item6_lineage_v7()',
     'private.ph_master_inventory_stable_identity_v7(to_jsonb(new))',
     'private.ph_master_inventory_stable_identity_v7(new)'),
    ('private.refresh_ph_master_inventory_item6_lineage_v7()',
     'private.ph_master_inventory_lineage_key_v1(to_jsonb(new))',
     'private.ph_master_inventory_lineage_key_v1(new)')
  loop
    definition := replace(pg_get_functiondef(signature::regprocedure), E'\r\n', E'\n');
    if position(new_call in definition)>0 and position(old_call in definition)=0 then
      continue;
    end if;
    if (length(definition)-length(replace(definition,old_call,'')))/length(old_call)<>1 then
      raise exception 'RECLASS_COMPACT_TRIGGER_IDENTITY_SOURCE_MISMATCH: %',signature;
    end if;
    execute replace(definition,old_call,new_call);
  end loop;
end
$migration$;

commit;
