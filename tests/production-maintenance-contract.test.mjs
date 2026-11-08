import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { productionMaintenanceContractSql, requireProductionMaintenanceContract }
  from '../src/services/production-maintenance-contract.mjs';

test('installed contract requires both exact operational changes', () => {
  const installed = { customer_index_installed: true, archive_autovacuum_installed: true };
  assert.deepEqual(requireProductionMaintenanceContract([installed]), installed);
  for (const rows of [[], [installed, installed], [{}],
    [{ ...installed, customer_index_installed: false }],
    [{ ...installed, archive_autovacuum_installed: false }]]) {
    assert.throws(() => requireProductionMaintenanceContract(rows), /NOT_INSTALLED/);
  }
});

test('index and autovacuum operations retain independent transaction ownership', () => {
  const index = fs.readFileSync(new URL('../docs/architecture/customer-directory-index-maintenance.sql', import.meta.url), 'utf8');
  const maintenance = fs.readFileSync(new URL('../docs/architecture/supabase-transient-maintenance.sql', import.meta.url), 'utf8');
  assert.match(index, /CREATE INDEX CONCURRENTLY IF NOT EXISTS ph_ccsr_active_customer_consignee_names_idx/);
  assert.doesNotMatch(index, /^\s*(?:BEGIN|START TRANSACTION)\b/m);
  assert.match(maintenance, /BEGIN;[\s\S]*SET LOCAL lock_timeout = '500ms';[\s\S]*COMMIT;/);
  assert.doesNotMatch(maintenance, /CONCURRENTLY/);
  assert.match(productionMaintenanceContractSql, /indisvalid AND i\.indisready AND i\.indislive/);
  assert.match(productionMaintenanceContractSql, /customername','consigneename/);
});
