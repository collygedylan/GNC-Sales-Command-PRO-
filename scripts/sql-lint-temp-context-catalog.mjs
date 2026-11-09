const masterTables = ['ph_master_bulk_stage_v1', 'ph_master_bulk_map_v1'];
const deltaTables = ['history_delta_work_v3039'];
const snapshotDelta = { probeGroup: 'snapshot-delta', contextTables: deltaTables, declarations: [] };

export const activeTempContexts = Object.freeze({
  'private.apply_inventory_live_overrides_bulk_v1': {
    args: ['uuid'], declarations: [], contextTables: masterTables, probeOrder: 1,
  },
  'public.bulk_import_master_snapshot_v1': {
    args: ['uuid', 'uuid', 'jsonb', 'text'], declarations: [],
    contextTables: [...masterTables, 'erp_order_delta_v23196'], legacyDeclaration: 'v_rows jsonb;',
  },
  'public.bulk_import_master_snapshot_v2374_base': {
    args: ['uuid', 'uuid', 'jsonb', 'text'], declarations: ['v_rows jsonb;'],
    probeOrder: -1,
  },
  'public.finalize_master_snapshot_stage_v2374_base': {
    args: ['uuid', 'uuid', 'text'], declarations: ['p_request_id uuid;'], stagedView: true,
    alternateEpoch: 'public.finalize_master_snapshot_stage_v1',
    probeGroup: 'master-snapshot-stage', contextTables: ['ph_master_bulk_stage_v1'],
  },
  'private.capture_snapshot_insert_v3039': {
    args: [], declarations: [], probeGroup: 'snapshot-capture',
    contextSetup: 'CREATE TEMP TABLE history_delta_new_rows_v3039 (LIKE public.ph_drive_around_report_rows) ON COMMIT DROP;',
  },
  'private.stage_snapshot_delta_item_v3039': {
    ...snapshotDelta, args: ['regclass', 'text'],
    dynamicTable: /create temporary table history_delta_work_v3039 on commit drop as\s+with plan as materialized/i,
    contextSetup: `CREATE TEMP TABLE history_delta_work_v3039 ON COMMIT DROP AS
      SELECT * FROM private.snapshot_delta_plan_v3039(NULL::regclass, NULL::text) WITH NO DATA;`,
  },
  'private.stage_completed_snapshot_file_v3039': {
    ...snapshotDelta, args: ['regclass', 'text', 'text', 'integer'],
    dynamicTable: /create temporary table history_delta_work_v3039 on commit drop as\s+with observations as materialized/i,
  },
  'private.write_snapshot_delta_coverage_v3039': {
    ...snapshotDelta, args: ['regclass'],
  },
  'private.delete_verified_snapshot_duplicates_v3039': {
    ...snapshotDelta, args: ['regclass'],
  },
  'private.fast_ingest_snapshot_v2369': {
    args: ['regclass', 'jsonb', 'text[]', 'boolean'], declarations: [],
    dynamicTable: /create temp table %I on commit drop as select source_row\.ordinality::bigint fast_row_number,typed\.\*/i,
  },
  'private.compact_history_states_v2366': { args: [], declarations: [] },
  'private.refresh_inventory_consolidation_cache_v2366': {
    args: [], declarations: ['refreshed_at_value timestamptz;'],
  },
  'private.resolve_nursery_schedule_locations_v23127': { args: [], declarations: [] },
  'public.deduplicate_drive_around_report_rows_batch_v1': { args: ['integer'], declarations: [] },
});
