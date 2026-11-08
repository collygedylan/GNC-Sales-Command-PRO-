import test from 'node:test';
import { assertErpFilenameAndWatchdogContract } from '../src/core/golden-erp-filename-watchdog.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('ERP SQL freshness guard is registered without changing grants', async () => {
 const migration=read('supabase/migrations/20261105170000_erp_filename_date_order.sql');
 const {releaseDatabaseMigrations,migrationContractQuery}=await import('../scripts/apply-item-low-stock-migration.mjs');
 assert.ok(releaseDatabaseMigrations.includes('20261105170000_erp_filename_date_order.sql'));
 assert.ok(migrationContractQuery('20261105170000_erp_filename_date_order.sql').includes('as installed'));
 assert.ok(migration.includes('incoming_parts[2]||incoming_parts[1]'));
 assert.ok(migration.includes('incoming_order < active_order'));
 assert.ok(!/GRANT|REVOKE|ALTER TABLE/.test(migration));
});
test('ERP filename date and leading clock order; bounded watchdog recovery',assertErpFilenameAndWatchdogContract);

