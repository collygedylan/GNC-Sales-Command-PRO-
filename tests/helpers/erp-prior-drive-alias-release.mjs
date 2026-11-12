import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { erpPriorDriveAliasMigration } from '../../src/services/erp-prior-drive-alias-contract.mjs';
import { assertLaterMigrationSafety } from './erp-cron-release-contract.mjs';

export async function assertPriorDriveAliasRelease() {
  const name = erpPriorDriveAliasMigration;
  const source = await readFile(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8');
  const review = sql => assertLaterMigrationSafety([[name,sql]]);
  assert.doesNotThrow(() => review(source));
  assert.doesNotThrow(() => review(source.replace(/\r?\n/g, '\r\n')));
  for (const [required, broken] of [
    ['if sampled=0 then return;', 'if sampled>=0 then return;'],
    ["set_config('enable_nestloop','off',true)", "set_config('enable_nestloop','off',false)"],
    ['b.lineage_key=s.lineage_key', 'true'],
    ['not exists(select 1 from stage_keys own', 'exists(select 1 from stage_keys own'],
    ['where matches=1', 'where matches>0']
  ]) {
    assert.ok(source.includes(required));
    assert.throws(() => review(source.replace(required,broken)), /reviewed migration changed/);
  }
}
