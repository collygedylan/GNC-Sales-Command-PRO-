import test from 'node:test';
import { assertHistoricalMigration, assertIsolatedSqlTest } from './helpers/ci-discovery.mjs';
import { readHistoricalMigrationManifest } from '../scripts/historical-database-fixture.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const history = read('supabase/archive_migrations/20260924115226_sales_history_customer_docks_ownership.sql');
const guard = read('supabase/archive_migrations/20260924155225_request_metadata_notification_guard.sql');
const functionPattern = /create or replace function private\.reconcile_request_folder_from_request_v2\(\)[\s\S]*?\$function\$;/;
test('fresh installs guard the original backfill with the exact incremental production fix', () => {
  assert.equal(history.match(functionPattern)?.[0], guard.match(functionPattern)?.[0]);
  const legacyPattern = /create or replace function private\.capture_legacy_request_completion\(\)[\s\S]*?end;\s*\$\$;/;
  assert.equal(history.match(legacyPattern)?.[0], guard.match(legacyPattern)?.[0]);
  assert.ok(history.indexOf('request-metadata-notification-guard-v1') < history.indexOf('update public.ph_active_request a set'));
  assert.doesNotMatch(guard.replace(legacyPattern, ''), /(?:update|delete from|insert into) public\.ph_(?:active_request|request_delivery_outbox)/i);
});
test('native and auxiliary SQL tests seed historical completion before migrating', () => {
  assertHistoricalMigration('20260924115225_ci_request_notification_history_baseline.sql');
  const manifest = readHistoricalMigrationManifest();
  assert.ok(manifest.findIndex(entry => entry.destination === '20260924115225_ci_request_notification_history_baseline.sql')
    < manifest.findIndex(entry => entry.destination === '20260924115226_sales_history_customer_docks_ownership.sql'));
  assertIsolatedSqlTest('request_metadata_notifications_test.sql');
  assert.match(read('supabase/tests/request_metadata_notifications_test.sql'), /begin;[\s\S]*rollback;/i);
  const local = read('supabase/ci/sales_mobile_pglite.mjs');
  assert.ok(local.indexOf("'supabase/ci/request_notification_history_baseline.sql'") < local.indexOf("'supabase/archive_migrations/20260924115226_sales_history_customer_docks_ownership.sql'"));
  assert.match(local, /revoke all on function private\.eval_normalize_user_v2/);
});
test('restoration requires the guard and does not replay any outbox event', () => {
  const restore = read('supabase/archive_migrations/20260924155542_restore_request_delivery_after_metadata_guard.sql');
  assert.match(restore, /DELIVERY_RESTORE_REQUIRES_METADATA_GUARD/);
  assert.match(restore, /DELIVERY_RESTORE_REQUIRES_NO_IN_FLIGHT_EVENTS/);
  assert.doesNotMatch(restore, /(?:update|delete from|insert into) public\.ph_request_delivery_outbox/i);
});
