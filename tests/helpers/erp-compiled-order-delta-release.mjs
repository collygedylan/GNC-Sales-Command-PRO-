import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { erpCompiledDriveOrderDeltaMigration } from '../../src/services/erp-compiled-drive-order-delta-contract.mjs';
import { assertLaterMigrationSafety } from './erp-cron-release-contract.mjs';

export async function assertCompiledOrderDeltaRelease() {
  const name = erpCompiledDriveOrderDeltaMigration;
  const source = await readFile(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8');
  const review = sql => assertLaterMigrationSafety([[name,sql]]);
  assert.doesNotThrow(() => review(source));
  assert.doesNotThrow(() => review(source.replace(/\r?\n/g, '\r\n')));
  for (const [required, broken] of [
    ['where map.candidate_count=1', 'where map.candidate_count>0'],
    ['raw as materialized', 'raw as'],
    ['coalesce(s.frozen_erp_on_hand_v3048,0)', 'coalesce(s.ptronhand::numeric,0)'],
    ['from raw;', 'from raw where old_oh<>new_oh;'],
    ['pending_out) end order_delta', '0) end order_delta'],
    ['private.has_drive_work_binding_v3078()', 'true'],
    ['set enable_nestloop=off', ''],
    ['from public,anon,authenticated,service_role;', 'from public,anon,authenticated;']
  ]) {
    assert.ok(source.includes(required));
    assert.throws(() => review(source.replace(required,broken)), /reviewed migration changed/);
  }
}
