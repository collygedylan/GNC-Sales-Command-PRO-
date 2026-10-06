begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(16);

select ok(to_regprocedure('private.inventory_effective_owner_v1(text)') is not null,
  'exact-row effective owner resolver is installed');
select ok(position('inventory_effective_owner_v1' in pg_get_functiondef('public.enqueue_drive_reclass_inquiry_v1(jsonb)'::regprocedure)) > 0,
  'Reclass checks exact source and overlay ownership');
select ok(position('ph_inventory_row_assignments' in pg_get_functiondef('public.manager_season_priority_list_v1(uuid,text)'::regprocedure)) > 0,
  'Manager Season Priority resolves the selected physical row owner');
select ok(position('from public.ph_warehouse_assigned_items a' in pg_get_functiondef('public.manager_season_priority_list_v1(uuid,text)'::regprocedure)) = 0,
  'Manager Season Priority does not broaden filters by ItemCode');
select ok(position('inventory_effective_owner_v1(m.unique_id)' in pg_get_functiondef('public.list_eval_report2_itemcodes_v1(jsonb)'::regprocedure)) > 0,
  'Eval Reports #2 projects ownership from each exact physical row');
select ok(position('from public.ph_warehouse_assigned_items a' in pg_get_functiondef('public.list_eval_report2_itemcodes_v1(jsonb)'::regprocedure)) = 0,
  'Eval Reports #2 cannot leak a sibling lot owner through ItemCode and Genus');
select ok(position('a.master_unique_id = m.unique_id' in pg_get_functiondef('private.eval_work_assignment_users_v1(text)'::regprocedure)) > 0
  and position('from public.ph_warehouse_assigned_items' in pg_get_functiondef('private.eval_work_assignment_users_v1(text)'::regprocedure)) = 0,
  'new Eval Work recipients aggregate exact physical-row assignments');
select ok(position('eval_work_match_assignment_users_v1' in pg_get_functiondef('private.eval_work_assert_itemcode_membership_v1(uuid)'::regprocedure)) = 0
  and position('current_signature' in pg_get_functiondef('private.eval_work_assert_itemcode_membership_v1(uuid)'::regprocedure)) > 0,
  'issued Eval Work keeps its saved recipients while still validating source identity');
select ok(position('a.master_unique_id = m.unique_id' in pg_get_functiondef('public.finalize_pikes_order_import(text,text,text,integer,integer)'::regprocedure)) > 0,
  'new Pikes snapshots join the exact source row');
select ok(position('a.assigned_at <= target.imported_at' in pg_get_functiondef('public.finalize_pikes_order_import(text,text,text,integer,integer)'::regprocedure)) > 0,
  'new Pikes snapshots respect the assignment cutoff');
select ok(position('ph_itemcode_default_owners' in pg_get_functiondef('private.handover_assignment_targets_v1()'::regprocedure)) > 0,
  'scheduled handover transfers ItemCode defaults');
select ok(to_regprocedure('private.handover_recompute_default_owner_rows_v1()') is not null
  and exists(select 1 from pg_trigger where tgname='trg_handover_recompute_default_owner_rows' and not tgisinternal),
  'scheduled default transfers recompute row owners via the resolver');
select ok(position('ITEMCODE_DEFAULT_OWNER_REPLACED_REFRESH_REQUIRED' in
  pg_get_functiondef('public.set_itemcode_default_owners_v1(jsonb,uuid)'::regprocedure)) > 0,
  'manager RPC rejects an owner rewritten by the handover instead of acknowledging the wrong owner');
update private.scheduled_account_handover_v1
set effective_at=now()-interval '1 second'
where transition_key='kayla_knepp_to_nelly_aguilar_20261002';
insert into public.ph_itemcode_default_owners(itemcode_normalized,assignedto,assigned_at,revision)
values('ROW-HANDOVER-AUDIT','kayla_knepp',now(),1);
select is((select assignedto from public.ph_itemcode_default_owners where itemcode_normalized='ROW-HANDOVER-AUDIT'),
  'nelly_aguilar','future default-owner inserts normalize departing owners');
select ok(exists(select 1 from private.scheduled_account_handover_audit_v1
  where event_key like 'future:ph_itemcode_default_owners:ROW-HANDOVER-AUDIT:%'
    and metadata->>'id'='ROW-HANDOVER-AUDIT'),
  'natural-key default-owner handover is recorded with a non-null audit identity');
select ok((select relrowsecurity from pg_class where oid='public.ph_inventory_row_assignments'::regclass)
  and not has_table_privilege('authenticated','public.ph_inventory_row_assignments','update'),
  'row authority stays protected from direct authenticated writes');

select * from finish();
rollback;
