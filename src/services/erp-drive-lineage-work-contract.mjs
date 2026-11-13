export const erpDriveLineageWorkMigration = '20261113190000_drive_publication_lineage_work.sql';

export function erpDriveLineageWorkContract() {
  return `select (select count(*)=7 and bool_and(not prosecdef
      and not has_function_privilege('anon',oid,'EXECUTE')
      and not has_function_privilege('authenticated',oid,'EXECUTE')
      and not has_function_privilege('service_role',oid,'EXECUTE')) from pg_proc where oid in (
        to_regprocedure('private.prepare_drive_lineage_work_v3082()'),
        to_regprocedure('private.compiled_drive_prior_aliases_v3082()'),
        to_regprocedure('private.build_drive_ordinal_edges_v3082(boolean)'),
        to_regprocedure('private.prepare_drive_pending_ack_v3084()'),
        to_regprocedure('private.filter_drive_update_candidates_v3084(text)'),
        to_regprocedure('private.filter_drive_upsert_candidates_v3084(text)'),
        to_regprocedure('private.reconcile_drive_item6_location_notes_v3084(uuid)')))
    and (select strpos(prosrc,'create unique index on pending_ack_uids_v3084')>0
      and strpos(prosrc,'analyze pg_temp.pending_ack_uids_v3084')>0
      from pg_proc where oid=to_regprocedure('private.prepare_drive_pending_ack_v3084()'))
    and (select count(*)=2 and bool_and(strpos(prosrc,'changed_rows as materialized')>0
      and strpos(prosrc,'join changed_rows changed using (row_number)')>0) from pg_proc where oid in (
        to_regprocedure('private.filter_drive_update_candidates_v3084(text)'),
        to_regprocedure('private.filter_drive_upsert_candidates_v3084(text)')))
    and (select strpos(prosrc,'private.has_drive_work_binding_v3078()')>0
      and strpos(prosrc,'private.filter_drive_upsert_candidates_v3084(private.filter_drive_update_candidates_v3084(p_sql))')>0
      from pg_proc where oid=to_regprocedure('private.drive_compiled_cohort_sql_v3078(text,text,jsonb)'))
    and (select strpos(prosrc,'create unique index on pg_temp.drive_item6_note_delta_v3084')>0
      and strpos(prosrc,'analyze pg_temp.drive_item6_note_delta_v3084')>0
      and 'enable_nestloop=off'=any(proconfig)
      from pg_proc where oid=to_regprocedure('private.reconcile_drive_item6_location_notes_v3084(uuid)'))
    and (select strpos(prosrc,'p.master_unique_id as decision_uid')>0
      and strpos(prosrc,'set policy_revision=p.policy_revision')>0
      and strpos(prosrc,'a.source_revision is distinct from p.source_revision')>0
      and strpos(prosrc,'where not d.stamp_only order by p.master_unique_id on conflict')>0
      and strpos(prosrc,'v3.0.63 DRIVE owner mirror')>0
      from pg_proc where oid=to_regprocedure('private.apply_drive_row_assignment_plan_v3047(bigint)'))
    and (select strpos(prosrc,'private.prepare_drive_pending_ack_v3084()')>0
      and strpos(prosrc,'private.reconcile_drive_item6_location_notes_v3084(p_run_id)')>0
      and strpos(prosrc,'private.assert_prior_run_day_prune_safe_v3078(')>0
      and 'statement_timeout=180s'=any(proconfig) and 'lock_timeout=15s'=any(proconfig)
      from pg_proc where oid=to_regprocedure('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'))
    and (select count(*)=2 and bool_and(strpos(prosrc,'current_setting(''app.skip_catchup_outbox'',true)')>0
      and strpos(prosrc,'session_user = ''postgres''')>0
      and strpos(prosrc,'coalesce(auth.role(),'''') = ''service_role''')>0
      and md5(pg_get_functiondef(oid)) in ('4af1640ab0296ccd29f216a4eb79e158','4c574b15e1c7aa80e747c3dc12596a2a'))
      from pg_proc where oid in (
        to_regprocedure('private.sync_new_unassigned_warehouse_itemcodes_v1(uuid)'),
        to_regprocedure('private.wake_request_delivery_worker_now(text)'))) as installed`;
}
