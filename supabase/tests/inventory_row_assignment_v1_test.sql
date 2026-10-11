-- @test-runtime: isolated-supabase
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select has_column('private','ph_inventory_row_assignment_policy_state','source_revision',
  'the pre-activation row backfill records its locked source revision');
select ok(private.inventory_row_assignment_policy_active_v1() and exists(
    select 1 from private.ph_inventory_row_assignment_policy_state s where s.singleton and s.source_revision is not null),
  'row authority activates only after the revision-verified migration backfill');
select is((select count(*) from public.ph_master_inventory m
  left join public.ph_inventory_row_assignments a on a.master_unique_id=m.unique_id and a.present_in_drive
  where a.master_unique_id is null),0::bigint,'every current physical inventory row has an authority record');
select is((select count(*) from public.ph_inventory_row_assignments a
  where a.present_in_drive and not exists(select 1 from public.ph_master_inventory m where m.unique_id=a.master_unique_id)),
  0::bigint,'no absent source identity is advertised as current');
select ok((select relrowsecurity from pg_class where oid='public.ph_inventory_row_assignments'::regclass),
  'row assignment data is protected by RLS');
select ok((select relrowsecurity from pg_class where oid='public.ph_itemcode_default_owners'::regclass),
  'default owner data is protected by RLS');
select ok(not has_table_privilege('authenticated','public.ph_inventory_row_assignments','update'),
  'row assignment updates are available only through protected operations');
select ok(not has_table_privilege('authenticated','public.ph_itemcode_default_owners','update'),
  'default owner updates are available only through the authorized RPC');
select ok(has_function_privilege('authenticated','public.set_itemcode_default_owners_v1(jsonb,uuid)','execute'),
  'manager frontend can submit default ownership through the authenticated RPC');
select ok(position('ph_itemcode_default_owners' in pg_get_functiondef(
  'app_sync_private.begin_import(text[],uuid,text[])'::regprocedure))>0
  and position('ph_inventory_row_assignments' in pg_get_functiondef(
  'app_sync_private.begin_import(text[],uuid,text[])'::regprocedure))>0,
  'master imports fence both derived assignment datasets');
select ok(position('reconcile_inventory_row_assignments_v1' in pg_get_functiondef(
  'app_sync_private.advance_import(uuid,text)'::regprocedure))>0,
  'the import finalizer reconciles assignments before marking the snapshot ready');
select ok(exists(select 1 from pg_trigger t where t.tgrelid='public.ph_master_inventory'::regclass
  and t.tgname='trg_ph_master_inventory_row_assignment_update' and not t.tgisinternal),
  'master changes resolve through statement-level transition-table processing');

select * from finish();
rollback;
