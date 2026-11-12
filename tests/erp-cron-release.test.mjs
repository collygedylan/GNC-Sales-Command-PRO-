import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { erpPublicationSingleFlightMigration, requestDeliveryCronSingleFlightMigration,
  erpPublicationIdleCleanupMigration } from '../src/services/erp-publication-single-flight-contract.mjs';
import { assertErpWorkerGuard, assertLaterMigrationSafety, verifyErpCronRelease } from './helpers/erp-cron-release-contract.mjs';

const source = file => readFile(new URL('../' + file, import.meta.url), 'utf8');

test('ERP release lock runs the stage and recovery contracts within its time budget', async () => {
  await verifyErpCronRelease(source);
});

test('blocking, late, commented and disconnected publication locks fail the gate', async () => {
  const sql = await source('supabase/migrations/' + erpPublicationSingleFlightMigration);
  assertErpWorkerGuard('-- previous release description\n' + sql);
  for (const mutation of [
    sql.replace('pg_try_advisory_xact_lock', 'pg_advisory_xact_lock'),
    sql.replace('if not pg_catalog', 'perform 1; if not pg_catalog'),
    sql.replace('guard text :=', '-- guard text :='),
    sql.replace('execute replace(definition,entry,guard);', 'perform definition;')
  ]) assert.throws(() => assertErpWorkerGuard(mutation));
});

test('later migrations cannot replace or dynamically patch either protected cron owner', () => {
  const name = '20261112030000_future.sql';
  const unsafe = [
    'create or replace function private.run_erp_stage_publication_v3042(uuid) returns void language sql as $$ select 1 $$;',
    'drop function private.dispatch_request_delivery_worker_cron();',
    "do $$ declare d text:=pg_get_functiondef('private.run_erp_stage_publication_v3042(uuid)'::regprocedure); begin execute replace(d,'try_',''); end $$;",
    "do $$ begin execute 'drop function private.dispatch_request_' || 'delivery_worker_cron()'; end $$;",
    "do $$ begin execute '-- not a SQL comment private.run_erp_stage_publication_v3042'; end $$;",
    'select cron.alter_job(45,command := $$select 1$$);',
    'drop schema private cascade;'
  ];
  for (const sql of unsafe) assert.throws(() => assertLaterMigrationSafety([[name,sql]]),sql);
  for (const sql of [
    "select pg_get_functiondef('private.run_erp_stage_publication_v3042(uuid)'::regprocedure);",
    "select pg_get_functiondef('private.dispatch_request_delivery_worker_cron()'::regprocedure);",
    '-- drop function private.dispatch_request_delivery_worker_cron();\nselect 1;',
    'create function private.unrelated_example() returns integer language sql as $$select 1$$;'
  ]) assert.doesNotThrow(() => assertLaterMigrationSafety([[name,sql]]),sql);
});

test('reviewed delivery and idle migrations cannot be changed or shadowed', async () => {
  for (const name of [requestDeliveryCronSingleFlightMigration,erpPublicationIdleCleanupMigration]) {
    const sql = await source('supabase/migrations/' + name);
    assert.doesNotThrow(() => assertLaterMigrationSafety([[name,sql]]));
    assert.throws(() => assertLaterMigrationSafety([[name,sql + '\nselect 1;']]));
    const altered = name === requestDeliveryCronSingleFlightMigration
      ? sql.replace('pg_try_advisory_xact_lock','pg_advisory_xact_lock')
      : sql.replace('exists(select 1 from cron.job','exists(select 1 from cron.broken');
    assert.throws(() => assertLaterMigrationSafety([[name,altered]]));
  }
});

test('compact input wiring retains its reviewed preparation owner and branch', async () => {
  const name = '20261112022500_agdata3078_compact_drive_publication_input.sql';
  const sql = await source('supabase/migrations/' + name);
  assert.doesNotThrow(() => assertLaterMigrationSafety([[name,sql]]));
  for (const altered of [
    sql.replace('private.prepare_erp_publication_v3077(uuid)', 'private.run_erp_stage_publication_v3042(uuid)'),
    sql.replace('then return true; end if;', 'then return false; end if;'),
    sql + '\ndrop function private.dispatch_request_delivery_worker_cron();'
  ]) assert.throws(() => assertLaterMigrationSafety([[name,altered]]));
});

test('publication scheduler retains the drive deadline and guarded runner', async () => {
  const name = '20261112023500_agdata3078_drive_publication_deadline.sql';
  const sql = await source('supabase/migrations/' + name);
  assert.doesNotThrow(() => assertLaterMigrationSafety([[name,sql]]));
  for (const altered of [
    sql.replace("then '8s' else '120s'", "then '120s' else '120s'"),
    sql.replace('private.run_erp_stage_publication_v3042(%L::uuid)', 'private.unguarded_publisher(%L::uuid)'),
    sql.replace('commit\',', 'commit; select private.unguarded_publisher()\','),
    sql + '\ndrop function private.run_erp_stage_publication_v3042(uuid);'
  ]) assert.throws(() => assertLaterMigrationSafety([[name,altered]]));
});

test('incremental DRIVE uses its operation-specific deadline before the guarded statement', async () => {
  const name = '20261112031000_agdata3078_incremental_drive_preparation.sql';
  const sql = await source('supabase/migrations/' + name);
  assert.doesNotThrow(() => assertLaterMigrationSafety([[name,sql]]));
  for (const altered of [
    sql.replace("then '240s' else '120s'", "then '8s' else '120s'"),
    sql.replace("then '240s' else '120s'", "then '240s' else '240s'"),
    sql.replace("then '750ms' else '15s'", "then '15s' else '15s'"),
    sql.replace('private.run_erp_stage_publication_v3042(%L::uuid)', 'private.unguarded_publisher(%L::uuid)')
  ]) assert.throws(() => assertLaterMigrationSafety([[name,altered]]));
});

test('prepared DRIVE work enforces the bounded range and a verified stage-scoped final read', async () => {
  const name = '20261112034500_agdata3078_compiled_drive_work.sql';
  const sql = await source('supabase/migrations/' + name);
  assert.doesNotThrow(() => assertLaterMigrationSafety([[name,sql]]));
  for (const altered of [
    sql.replace('w.compiled_rows+250', 'w.compiled_rows+50000'),
    sql.replace('where r.stage_id=p_stage and r.row_number>p_before and r.row_number<=p_after', 'where r.stage_id=p_stage'),
    sql.replace('h.ready and not h.dirty and h.compiled_rows=h.expected_rows', 'h.ready'),
    sql.replace('with(security_invoker=true)', 'with(security_invoker=false)')
  ]) assert.throws(() => assertLaterMigrationSafety([[name,altered]]));
});
