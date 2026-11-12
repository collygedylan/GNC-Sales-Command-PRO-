import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { erpPriorDayPruneMigration } from '../../src/services/erp-prior-day-prune-contract.mjs';
import { assertLaterMigrationSafety } from './erp-cron-release-contract.mjs';

export async function assertDelayedDrivePruneRelease() {
  const name = erpPriorDayPruneMigration;
  const sql = await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
  const review = source => assertLaterMigrationSafety([[name, source]]);
  assert.doesNotThrow(() => review(sql));
  assert.doesNotThrow(() => review(sql.replace(/\r?\n/g, '\r\n')));
  for (const [guard, bypass] of [
    ['where guard.ok and live.unique_id', 'where live.unique_id'],
    ['from eligible_missing_source c)', 'from eligible_missing_source c where false)'],
    ["at time zone 'America/Chicago'", "at time zone 'UTC'"],
    ['e.updated_at>=p_prior_day', 'e.updated_at>=current_day']
  ]) {
    assert.ok(sql.includes(guard), `expected delayed DRIVE safeguard: ${guard}`);
    assert.throws(() => review(sql.replaceAll(guard, bypass)), /reviewed migration changed/);
  }
}
