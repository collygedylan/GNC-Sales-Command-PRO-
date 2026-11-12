export const erpTypedPrepareMigration = '20261112020000_agdata3077_typed_prepare_checkpoints.sql';

export function erpCanonicalPreparationRoutePredicate() {
  return `coalesce((position('perform private.prepare_master_bulk_stage_v3046(' in pg_get_functiondef(to_regprocedure(
    'private.load_drive_erp_publication_input_v3042(uuid)')))>0
    or (position('perform private.load_drive_typed_checkpoint_v3077(p_stage_id)' in pg_get_functiondef(to_regprocedure(
      'private.load_drive_erp_publication_input_v3042(uuid)')))>0
      and position('perform private.prepare_master_bulk_stage_v3046(payload)' in pg_get_functiondef(to_regprocedure(
        'private.prepare_drive_typed_part_v3077(uuid)')))>0
      and position('perform private.assert_drive_typed_checkpoint_v3077(p_stage_id)' in pg_get_functiondef(to_regprocedure(
        'private.load_drive_typed_checkpoint_v3077(uuid)')))>0
      and position('perform private.compile_master_bulk_stage_v3077()' in pg_get_functiondef(to_regprocedure(
        'private.load_drive_typed_checkpoint_v3077(uuid)')))>0
      and not has_function_privilege('service_role',to_regprocedure('private.prepare_drive_typed_part_v3077(uuid)'),'EXECUTE')
      and not has_function_privilege('service_role',to_regprocedure('private.load_drive_typed_checkpoint_v3077(uuid)'),'EXECUTE'))),false)`;
}

export function erpTypedPrepareContract() {
  return `select
    position('prepare_drive_typed_part_v3077' in pg_get_functiondef(
      'private.prepare_erp_publication_v3077(uuid)'::regprocedure))>0
    and position('private.load_drive_typed_checkpoint_v3077(p_stage_id)' in pg_get_functiondef(
      'private.load_drive_erp_publication_input_v3042(uuid)'::regprocedure))>0
    and (position('least(1000' in pg_get_functiondef('private.prepare_drive_typed_part_v3077(uuid)'::regprocedure))>0
      or (position('least(250,part.row_count-offset_rows,stage.expected_rows-job.typed_prepared_rows)' in pg_get_functiondef(
        'private.prepare_drive_typed_part_v3077(uuid)'::regprocedure))>0
        and to_regprocedure('private.drive_typed_slice_v3078(text,integer,integer,integer)') is not null))
    and position('source_part_hash' in pg_get_functiondef('private.assert_drive_typed_checkpoint_v3077(uuid)'::regprocedure))>0
    and position('decoded_rows_hash' in pg_get_functiondef('private.assert_drive_typed_checkpoint_v3077(uuid)'::regprocedure))>0
    and exists(select 1 from pg_constraint where conrelid='private.erp_drive_typed_rows_v3077'::regclass
      and conname='erp_typed_row_seal_v3077' and convalidated
      and position('drive_typed_metadata_hash_v3077' in pg_get_constraintdef(oid))>0)
    and exists(select 1 from pg_constraint where conrelid='private.erp_drive_typed_rows_v3077'::regclass
      and position('jsonb_populate_record' in pg_get_constraintdef(oid))>0)
    and position('compile_master_bulk_stage_v3077' in pg_get_functiondef(
      'private.prepare_master_bulk_stage_v3046(jsonb)'::regprocedure))>0
    and position('ph_master_bulk_stage_v1_ordinal_uidx' in pg_get_functiondef(
      'private.compile_master_bulk_stage_v3077()'::regprocedure))>0
    and (select bool_and(relrowsecurity) from pg_class where oid in (
      'private.erp_drive_typed_rows_v3077'::regclass,'private.erp_drive_typed_parts_v3077'::regclass))
    and not has_table_privilege('service_role','private.erp_drive_typed_rows_v3077','SELECT')
    and not has_table_privilege('authenticated','private.erp_drive_typed_parts_v3077','SELECT')
    and not has_function_privilege('service_role','private.prepare_drive_typed_part_v3077(uuid)','EXECUTE')
    and not has_function_privilege('authenticated','private.load_drive_typed_checkpoint_v3077(uuid)','EXECUTE') as installed`;
}

export const erpTypedPrepareContracts = [[erpTypedPrepareMigration, erpTypedPrepareContract]];
