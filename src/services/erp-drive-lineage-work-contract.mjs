export const erpDriveLineageWorkMigration = '20261113190000_drive_publication_lineage_work.sql';

export function erpDriveLineageWorkContract() {
  return `select (select count(*)=6 and bool_and(not prosecdef
      and not has_function_privilege('anon',oid,'EXECUTE')
      and not has_function_privilege('authenticated',oid,'EXECUTE')
      and not has_function_privilege('service_role',oid,'EXECUTE')) from pg_proc where oid in (
        to_regprocedure('private.prepare_drive_lineage_work_v3082()'),
        to_regprocedure('private.compiled_drive_prior_aliases_v3082()'),
        to_regprocedure('private.build_drive_ordinal_edges_v3082(boolean)'),
        to_regprocedure('private.prepare_drive_pending_ack_v3084()'),
        to_regprocedure('private.filter_drive_update_candidates_v3084(text)'),
        to_regprocedure('private.filter_drive_upsert_candidates_v3084(text)')))
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
    and (select strpos(prosrc,'private.prepare_drive_pending_ack_v3084()')>0
      and strpos(prosrc,'private.assert_prior_run_day_prune_safe_v3078(')>0
      and 'statement_timeout=180s'=any(proconfig) and 'lock_timeout=15s'=any(proconfig)
      from pg_proc where oid=to_regprocedure('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)')) as installed`;
}
