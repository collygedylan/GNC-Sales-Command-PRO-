const migration = '20261112022500_agdata3078_compact_drive_publication_input.sql';

function compactDrivePublicationContract() {
  return `select (select count(*)=4 and bool_and(not prosecdef
        and not has_function_privilege('anon',oid,'EXECUTE')
        and not has_function_privilege('authenticated',oid,'EXECUTE')
        and not has_function_privilege('service_role',oid,'EXECUTE'))
      from pg_proc where oid in (
        to_regprocedure('private.drive_parts_fit_one_attempt_v3078(uuid)'),
        to_regprocedure('private.drive_part_array_body_v3078(text,integer)'),
        to_regprocedure('private.load_drive_fast_parts_v3078(uuid,integer)'),
        to_regprocedure('private.build_drive_publication_input_v3078(uuid,integer,text)')))
    and (select strpos(prosrc,'octet_length(canonical)>67108864')>0
        and strpos(prosrc,'extensions.digest(convert_to(canonical,')>0 and strpos(prosrc,'$erpDigest')>0
      from pg_proc where oid=to_regprocedure('private.build_drive_publication_input_v3078(uuid,integer,text)'))
    and (select strpos(prosrc,'private.load_drive_fast_parts_v3078(p_stage_id,expected)')>0
        and strpos(prosrc,'private.load_drive_typed_checkpoint_v3077(p_stage_id)')>0
        and strpos(prosrc,'private.build_drive_publication_input_v3078(p_stage_id,expected,canonical)')>0
      from pg_proc where oid=to_regprocedure('private.load_drive_erp_publication_input_v3042(uuid)'))
    and (select strpos(prosrc,'private.prepare_master_bulk_stage_v3046(null)')>0
        and strpos(prosrc,'ERP_DRIVE_PART_RANGE_CHANGED')>0 and strpos(prosrc,'create unique index')>0
      from pg_proc where oid=to_regprocedure('private.load_drive_fast_parts_v3078(uuid,integer)'))
    and (select strpos(prosrc,'input.payload=p_rows')>0 and strpos(prosrc,'input.source_digest=p_source_digest')>0
        and strpos(prosrc,'pg_get_userbyid(c.relowner)<>current_user')>0
      from pg_proc where oid=to_regprocedure('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'))
    and (select strpos(prosrc,'public.fast_commit_erp_stage_swap_v1(p_stage_id)')>0
      from pg_proc where oid=to_regprocedure('private.run_erp_stage_publication_v3042(uuid)')) as installed`;
}

export const erpCompactDrivePublicationContracts = [[migration, compactDrivePublicationContract]];
