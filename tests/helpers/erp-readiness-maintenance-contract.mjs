import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertLaterMigrationSafety } from './erp-cron-release-contract.mjs';
import { erpDriveReadinessWithoutAnalyzeMigration } from '../../src/services/erp-compiled-drive-work-contract.mjs';

export async function assertIndependentDriveReadiness() {
  const name = erpDriveReadinessWithoutAnalyzeMigration;
  const sql = await readFile(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8');
  const review = text => assertLaterMigrationSafety([[name, text]]);
  assert.doesNotThrow(() => review(sql));
  assert.doesNotThrow(() => review(sql.replace(/\r?\n/g, '\r\n')));
  for (const edited of [
    sql.replace('maintenance||chr(10)', "'perform private.assert_drive_typed_checkpoint_v3077(p_stage);'"),
    sql.replace("maintenance||chr(10),''", 'maintenance||chr(10),maintenance'),
    sql.replace('count(*),min(row_number),max(row_number)', 'count(*)'),
    sql.replace('set ready=true where stage_id=p_stage', 'set ready=true')
  ]) {
    assert.notEqual(edited, sql);
    assert.throws(() => review(edited), /reviewed migration changed/);
  }
}
