begin;

-- Danny Fountain manages the 330_TREES production inventory. Keep the scope
-- authoritative in Postgres so native Auth, views that use security_invoker,
-- and direct Data API reads cannot reveal another plant group.
create or replace function private.current_inventory_plantgroup_scope_v1()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when lower(btrim(coalesce(p.username, ''))) = 'danny_fountain'
      then array['330_TREES']::text[]
    else array[]::text[]
  end
  from public.profiles p
  where p.id = auth.uid()
    and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now())
    and coalesce(p.must_change_password, false) = false
  limit 1
$$;

revoke all on function private.current_inventory_plantgroup_scope_v1()
  from public, anon, authenticated, service_role;
grant execute on function private.current_inventory_plantgroup_scope_v1()
  to authenticated, service_role;

-- Add the plant group to Production workflow rows so both current and
-- historical open-list reads use the same row scope as Drive Mode.
do $$
begin
  if to_regclass('public.ph_production_workflow_rows') is not null then
    alter table public.ph_production_workflow_rows
      add column if not exists plantgroupcode text;

    update public.ph_production_workflow_rows workflow
    set plantgroupcode = nullif(btrim(coalesce(
      to_jsonb(workflow) -> 'snapshot' ->> 'plantgroupcode',
      to_jsonb(workflow) -> 'snapshot' ->> 'PLANTGROUPCODE'
    )), '')
    where nullif(btrim(coalesce(workflow.plantgroupcode, '')), '') is null
      and nullif(btrim(coalesce(
        to_jsonb(workflow) -> 'snapshot' ->> 'plantgroupcode',
        to_jsonb(workflow) -> 'snapshot' ->> 'PLANTGROUPCODE'
      )), '') is not null;

    update public.ph_production_workflow_rows workflow
    set plantgroupcode = master.plantgroupcode
    from public.ph_master_inventory master
    where master.unique_id = workflow.source_unique_id
      and nullif(btrim(coalesce(workflow.plantgroupcode, '')), '') is null
      and nullif(btrim(coalesce(master.plantgroupcode, '')), '') is not null;

    create index if not exists ph_production_workflow_rows_plantgroupcode_idx
      on public.ph_production_workflow_rows (upper(btrim(plantgroupcode)));
  end if;
end
$$;

create index if not exists ph_master_inventory_plantgroupcode_scope_idx
  on public.ph_master_inventory (upper(btrim(plantgroupcode)));

-- Restrictive policies are ANDed with the existing permissive policies. An
-- active profile with no configured scope keeps its existing access; Danny is
-- limited to 330_TREES. Applying the policy conditionally keeps the migration
-- compatible with production-only workflow tables and isolated CI schemas.
do $$
declare
  target_table text;
  target_tables text[] := array[
    'ph_master_inventory',
    'ph_active_request',
    'ph_request_history',
    'ph_soc_master',
    'ph_sales_office',
    'ph_reserves',
    'ph_crop_roll_drive_rows',
    'ph_shear_list',
    'ph_inventory_edit_requests',
    'ph_flyer_folder_rows',
    'ph_flyer_folder_history',
    'ph_production_workflow_rows'
  ];
begin
  foreach target_table in array target_tables loop
    if to_regclass(format('public.%I', target_table)) is null then
      continue;
    end if;
    if not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = target_table
        and c.column_name = 'plantgroupcode'
    ) then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', target_table);
    execute format('drop policy if exists danny_tree_plantgroup_scope on public.%I', target_table);
    execute format(
      $policy$
        create policy danny_tree_plantgroup_scope
        on public.%I
        as restrictive
        for all
        to authenticated
        using (
          (select private.current_inventory_plantgroup_scope_v1()) is not null
          and (
            cardinality((select private.current_inventory_plantgroup_scope_v1())) = 0
            or upper(btrim(coalesce(plantgroupcode, ''))) = any(
              coalesce((select private.current_inventory_plantgroup_scope_v1()), array[]::text[])
            )
          )
        )
        with check (
          (select private.current_inventory_plantgroup_scope_v1()) is not null
          and (
            cardinality((select private.current_inventory_plantgroup_scope_v1())) = 0
            or upper(btrim(coalesce(plantgroupcode, ''))) = any(
              coalesce((select private.current_inventory_plantgroup_scope_v1()), array[]::text[])
            )
          )
        )
      $policy$,
      target_table
    );
  end loop;
end
$$;

comment on function private.current_inventory_plantgroup_scope_v1() is
  'Returns the active native profile inventory plant-group scope. Empty array means unrestricted; NULL means no active profile.';

commit;
