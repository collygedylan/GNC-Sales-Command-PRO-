import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';

export async function verifyBulkActionSqlContract(ctx) {
  await ctx.db.query('begin');
  try {
    await ctx.db.query(readFileSync(new URL('../../tests/sql/bulk-master-action-reconciliation-fixture.sql',import.meta.url),'utf8'));
  } finally {
    await ctx.db.query('rollback');
  }
}

export async function seedBulkProtectedRow(ctx, protectedId) {
  const {withDisposableDbClaims,db,queryValue}=ctx;
  await withDisposableDbClaims(()=>db.query(`update public.ph_master_inventory
    set holdstopcode='APP_HOLD',holdstopreason='Synthetic app hold',
      locationnote='Synthetic app location note' where unique_id=$1`,[protectedId]));
  const original=await queryValue(`select holdstopcode,holdstopreason,locationnote
    from public.ph_master_inventory where unique_id=$1`,[protectedId]);
  assert.deepEqual(original,{holdstopcode:'APP_HOLD',holdstopreason:'Synthetic app hold',
    locationnote:'Synthetic app location note'});
  const action=await queryValue(`select id::text as action_id,baseline_erp_row
    from public.app_row_actions where canonical_unique_id=$1 and reconciliation_status='pending'
      and changed_fields @> array['holdstopcode','holdstopreason'] order by id desc limit 1`,[protectedId]);
  assert.ok(action?.baseline_erp_row,'the real app edit has its canonical pending action and ERP baseline');
  const baseline=await withDisposableDbClaims(()=>db.query(`select private.reconcile_action_row_v3070(
    $1,$2::jsonb,'synthetic-baseline.csv',$3::uuid) as patch`,
  [protectedId,JSON.stringify(action.baseline_erp_row),randomUUID()]));
  assert.equal(baseline.rows[0].patch.holdstopcode,original.holdstopcode,'an unchanged ERP baseline retains the pending app hold');
  assert.equal(baseline.rows[0].patch.holdstopreason,original.holdstopreason);
  const pending=await queryValue('select reconciliation_status from public.app_row_actions where id=$1',[action.action_id]);
  assert.equal(pending.reconciliation_status,'pending','baseline readback cannot absorb the app edit');
  return {original,actionId:action.action_id};
}

export function assertBulkProtectedRowResult({actual,original,report,receipt,runId,actionId,protectedId}) {
  assert.deepEqual(actual,{holdstopcode:report.holdstopcode,holdstopreason:report.holdstopreason,
    locationnote:original.locationnote},'changed ERP values are adopted while the app-owned location note remains intact');
  assert.ok(receipt,'ERP adoption requires the exact durable discrepancy receipt');
  assert.equal(receipt.action_id,actionId);
  assert.equal(receipt.canonical_unique_id,protectedId);
  assert.equal(receipt.reconciliation_status,'discrepant');
  assert.equal(receipt.absorbed_by_erp,true);
  assert.equal(receipt.sync_run_id,runId);
  assert.equal(receipt.import_run_id,runId);
  for(const field of ['holdstopcode','holdstopreason']) {
    assert.equal(receipt.app_update_row[field],original[field],'the receipt preserves the supervisor input');
    assert.equal(receipt.report_update_row[field],report[field]);
    assert.ok(receipt.discrepancy_diff.some(diff=>diff.field===field
      && diff.app_expected_value===original[field] && diff.report_actual_value===report[field]));
  }
}

export async function verifyBulkProtectedRow(ctx, protection) {
  const {queryValue}=ctx;
  const actual=await queryValue(`select holdstopcode,holdstopreason,locationnote
    from public.ph_master_inventory where unique_id=$1`,[protection.protectedId]);
  const receipt=await queryValue(`select a.id::text as action_id,a.canonical_unique_id,
      a.reconciliation_status,a.absorbed_by_erp,a.sync_run_id::text,d.import_run_id::text,
      d.app_update_row,d.report_update_row,d.discrepancy_diff
    from public.app_row_actions a join public.ph_action_discrepancies d on d.action_id=a.id
    where a.id=$1 and a.canonical_unique_id=$2`,[protection.actionId,protection.protectedId]);
  assertBulkProtectedRowResult({...protection,actual,receipt});
  return actual;
}
