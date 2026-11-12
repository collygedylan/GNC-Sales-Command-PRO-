import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { erpFinalInputCertificateMigration } from '../../src/services/erp-final-input-certificate-contract.mjs';
import { assertLaterMigrationSafety } from './erp-cron-release-contract.mjs';

export async function assertCertifiedDriveRelease() {
  const name = erpFinalInputCertificateMigration;
  const sql = await readFile(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8');
  const verify = text => assertLaterMigrationSafety([[name,text]]);
  assert.doesNotThrow(() => verify(sql));
  assert.doesNotThrow(() => verify(sql.replace(/\r?\n/g, '\r\n')));
  for (const [required, replacement] of [
    ['select stage_id from old_input union select stage_id from new_input', 'select stage_id from new_input'],
    ['order by stage_id for update nowait', 'order by stage_id'],
    ['perform private.assert_drive_typed_checkpoint_v3077(new.stage_id)', 'perform 1'],
    ['count(*),min(row_number),max(row_number)', '0,1,0'],
    ['c.input_epoch=p_stage.drive_input_epoch_v3078', 'true'],
    ['enable always trigger drive_input_truncate_v3078', 'disable trigger drive_input_truncate_v3078']
  ]) {
    assert.ok(sql.includes(required));
    assert.throws(() => verify(sql.replace(required, replacement)), /reviewed migration changed/);
  }
}
