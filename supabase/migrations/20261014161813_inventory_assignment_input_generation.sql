begin;
-- Track changes only to assignment resolver inputs. A transaction-held shared
-- lock on this version row prevents those inputs changing during a batch.
create table private.inventory_row_assignment_input_generation (
  singleton boolean primary key default true check (singleton),
  generation bigint not null default 0 check (generation >= 0),
  updated_at timestamptz not null default clock_timestamp()
);
insert into private.inventory_row_assignment_input_generation(singleton, generation)
values (true, 0);
alter table private.inventory_row_assignment_input_generation enable row level security;
revoke all on private.inventory_row_assignment_input_generation
  from public, anon, authenticated, service_role;

create or replace function private.bump_inventory_row_assignment_input_generation_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update private.inventory_row_assignment_input_generation
  set generation = generation + 1, updated_at = clock_timestamp()
  where singleton;
  if not found then
    raise exception using errcode = '55000', message = 'INVENTORY_ROW_ASSIGNMENT_INPUT_GENERATION_MISSING';
  end if;
  return null;
end;
$$;
revoke all on function private.bump_inventory_row_assignment_input_generation_v1()
  from public, anon, authenticated, service_role;

create or replace function private.inventory_row_assignment_reconcile_source_witness_v1()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare generation_value bigint; roster_fingerprint text; profile_fingerprint text;
  policy_fingerprint text;
begin
  select g.generation into generation_value
  from private.inventory_row_assignment_input_generation g
  where g.singleton for share;
  if not found then
    raise exception using errcode = '55000', message = 'INVENTORY_ROW_ASSIGNMENT_INPUT_GENERATION_MISSING';
  end if;
  select coalesce(string_agg(md5(jsonb_build_array(u.username, u.active)::text), '' order by u.username), '')
    into roster_fingerprint from public.ph_eval_assignment_users u;
  select coalesce(string_agg(md5(jsonb_build_array(
      p.username, p.disabled_at, p.locked_until,
      p.disabled_at is null and (p.locked_until is null or p.locked_until <= clock_timestamp())
    )::text), '' order by p.username), '')
    into profile_fingerprint from public.profiles p;
  select coalesce(string_agg(md5(jsonb_build_array(s.singleton, s.active)::text), '' order by s.singleton), '')
    into policy_fingerprint from private.ph_inventory_row_assignment_policy_state s;
  return md5(jsonb_build_array(generation_value, roster_fingerprint,
    profile_fingerprint, policy_fingerprint)::text);
end;
$$;
revoke all on function private.inventory_row_assignment_reconcile_source_witness_v1()
  from public, anon, authenticated, service_role;

create trigger inventory_assignment_witness_master_rows
after insert or delete or truncate on public.ph_master_inventory
for each statement execute function private.bump_inventory_row_assignment_input_generation_v1();
create trigger inventory_assignment_witness_master_inputs
after update of unique_id, itemcode, genusname, commonname, contsize, locationcode,
  lotcode, source, warehousei, plantgroupcode on public.ph_master_inventory
for each statement execute function private.bump_inventory_row_assignment_input_generation_v1();

create trigger inventory_assignment_witness_default_owner_rows
after insert or delete or truncate on public.ph_itemcode_default_owners
for each statement execute function private.bump_inventory_row_assignment_input_generation_v1();
create trigger inventory_assignment_witness_default_owner_inputs
after update of itemcode_normalized, assignedto, review_required, revision, assigned_at
  on public.ph_itemcode_default_owners
for each statement execute function private.bump_inventory_row_assignment_input_generation_v1();

create trigger inventory_assignment_witness_legacy_rows
after insert or delete or truncate on public.ph_warehouse_assigned_items
for each statement execute function private.bump_inventory_row_assignment_input_generation_v1();
create trigger inventory_assignment_witness_legacy_inputs
after update of assignment_key, present_in_drive, zone_override_active,
  zone_override_prior_assignedto, zone_override_prior_assigned_at, assignedto, assigned_at
  on public.ph_warehouse_assigned_items
for each statement execute function private.bump_inventory_row_assignment_input_generation_v1();

create trigger inventory_assignment_witness_roster_rows
after insert or delete or truncate on public.ph_eval_assignment_users
for each statement execute function private.bump_inventory_row_assignment_input_generation_v1();
create trigger inventory_assignment_witness_roster_inputs
after update of username, active on public.ph_eval_assignment_users
for each statement execute function private.bump_inventory_row_assignment_input_generation_v1();

create trigger inventory_assignment_witness_profile_rows
after insert or delete or truncate on public.profiles
for each statement execute function private.bump_inventory_row_assignment_input_generation_v1();
create trigger inventory_assignment_witness_profile_inputs
after update of username, disabled_at, locked_until on public.profiles
for each statement execute function private.bump_inventory_row_assignment_input_generation_v1();

create trigger inventory_assignment_witness_policy_rows
after insert or delete or truncate on private.ph_inventory_row_assignment_policy_state
for each statement execute function private.bump_inventory_row_assignment_input_generation_v1();
create trigger inventory_assignment_witness_policy_inputs
after update of singleton, active on private.ph_inventory_row_assignment_policy_state
for each statement execute function private.bump_inventory_row_assignment_input_generation_v1();

notify pgrst, 'reload schema';
commit;
