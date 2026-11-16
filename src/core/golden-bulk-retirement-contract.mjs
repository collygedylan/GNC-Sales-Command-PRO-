import assert from 'node:assert/strict';
import {assertBulkMasterTriggerState} from '../services/bulk-master-http-contract.mjs';

export function assertRequestQuantityRecovery(read) {
  const migration = read('supabase/migrations/20261023234500_request_quantity_recovery_v3.sql');
  const runner = read('scripts/apply-item-low-stock-migration.mjs');
  for (const uniqueId of ['REQ-mvlgbfl7p8r8zxrj97j', 'REQ-mvlg4t85vlzf7053pv', 'REQ-mvlfib5eqwa3typzcqq',
    'REQ-mvlfib5evawvlvvx09', 'REQ-mvlex5bay7ngnehzi7', 'REQ-mvlbp5hkkk58akaubms', 'REQ-mvk1xgv2ty9fttuqj2']) assert.match(migration, new RegExp(uniqueId));
  assert.equal((migration.match(/,'1'::text\)/g) || []).length >= 10, true);
  assert.match(migration, /'REQ-mvlbp5hkkk58akaubms','003139\.250\.1','A\.08\.000','10'::text/);
  assert.match(migration, /'REQ-mvk1xgv2ty9fttuqj2','008280\.150\.1','C\.05\.000','4'::text/);
  assert.match(migration, /app_dataset_revision_updated/);
  assert.doesNotMatch(migration, /update\s+public\.ph_request_delivery_outbox/i);
  assert.match(runner, /requestQuantityRecoveryMigrationName[^]*20261023234500_request_quantity_recovery_v3\.sql/);
}

export function assertExactRetiredTriggerContract() {
  const retired=['trg_v2_master_inventory_crop_roll_drive_rows','trg_v2_master_inventory_crop_roll_drive_rows_delete',
    'trg_v2_master_inventory_crop_roll_drive_rows_insert'];
  const safe={total:53,enabled:50,handover:1,handover_enabled:1,evidence_delta:2,evidence_delta_enabled:2,
    disabled_names:retired,retired_projection_disabled:3};
  assert.doesNotThrow(()=>assertBulkMasterTriggerState(safe));
  for(const changed of [{enabled:49},{enabled:51},{enabled:53},{disabled_names:retired.slice(0,2)},
    {disabled_names:[...retired.slice(0,2),'zzzzzzzz_protect_eval_data_from_blank_overwrite_trg']},
    {disabled_names:[...retired,retired[0]]},{retired_projection_disabled:2},{disabled_names:'retired'}]) {
    assert.throws(()=>assertBulkMasterTriggerState({...safe,...changed}),assert.AssertionError);
  }
  assert.doesNotThrow(()=>assertBulkMasterTriggerState({...safe,enabled:53,disabled_names:[],retired_projection_disabled:0}));
}
