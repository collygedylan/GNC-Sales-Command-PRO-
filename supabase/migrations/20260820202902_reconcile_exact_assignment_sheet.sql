begin;

-- Reconcile the three normalized ItemCode + GenusName assignments where the
-- supplied ASSSIGNMENTS 08-20-2026 / Sheet3 differs from the earlier cutover.
-- Dylan/Megan manager changes remain authoritative and are never overwritten.
do $migration$
declare
  updated_count integer;
begin
  with source_rows(itemcode, genusname, assignedto, source_row) as (
    values
      ('008267.070.1', 'Rosa', 'mitch_kaiser', 9027),
      ('002050.020.1', 'Rosa', 'mitch_kaiser', 9114),
      ('002050.050.1', 'Rosa', 'mitch_kaiser', 9116)
  )
  update public.ph_warehouse_assigned_items as assignment
  set
    assignedto = source.assignedto,
    assigned_by = 'sheet_exact_reconciliation_20260820',
    assigned_at = now(),
    source = 'google_sheet_exact_reconciliation_20260820',
    import_batch = 'ASSSIGNMENTS 08-20-2026 / Sheet3 (9857 rows)',
    raw_row = jsonb_build_object(
      'authority', 'supplied_google_sheet',
      'spreadsheet_id', '1IdRSz10-RBPROgxE4mvL-4wCwusdWHSibOd825mjuno',
      'sheet', 'Sheet3',
      'source_row', source.source_row,
      'scope', 'itemcode_genus'
    ),
    last_seen_at = now(),
    updated_at = now(),
    unassigned_notified_at = now()
  from source_rows as source
  where assignment.assignment_key = private.normalize_eval_assignment_key(source.itemcode, source.genusname)
    and assignment.source = 'google_sheet_cutover_20260820';

  get diagnostics updated_count = row_count;
  if updated_count <> 3 then
    raise exception 'Expected to reconcile exactly 3 Sheet3 assignments, updated %', updated_count;
  end if;
end;
$migration$;

comment on table public.ph_warehouse_assigned_items is
  'Supabase-authoritative Eval assignments keyed by normalized ItemCode + GenusName; ASSSIGNMENTS 08-20-2026 / Sheet3 reconciled 2026-08-20.';

notify pgrst, 'reload schema';

commit;
