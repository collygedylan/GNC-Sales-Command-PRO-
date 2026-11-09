// @test-runtime: canonical-http
// Full-size canonical PH snapshot through the disposable local PostgREST API.
import { pathToFileURL } from 'node:url';
import { ROW_COUNT } from '../../src/services/bulk-master-http-source.mjs';
import { attachBulkMasterOperations, connectBulkMasterFixture } from '../../src/services/bulk-master-http-transport.mjs';
import { prepareBulkHandoverIdentity, readBulkMasterSchema, scheduleBulkHandover, seedBulkMasterFixture } from '../../src/services/bulk-master-http-contract.mjs';
import { assertAtomicBulkRollback, assertChangedBulkPublication, assertInitialBulkPublication,
  assertLegacyBulkBootstrap, assertUnchangedBulkPublication } from '../../src/services/bulk-master-http-cases.mjs';
import { closeBulkMasterFences, removeBulkMasterFixtures, verifyBulkMasterCleanup } from '../../src/services/bulk-master-http-cleanup.mjs';

export { syntheticBulkMasterSnapshot } from '../../src/services/bulk-master-http-source.mjs';

async function runBulkMasterCases(ctx) {
  await prepareBulkHandoverIdentity(ctx);
  await scheduleBulkHandover(ctx);
  await seedBulkMasterFixture(ctx);
  const initial = await assertInitialBulkPublication(ctx);
  const changed = await assertChangedBulkPublication(ctx);
  const unchanged = await assertUnchangedBulkPublication(ctx);
  await assertAtomicBulkRollback(ctx, changed);
  const legacy = await assertLegacyBulkBootstrap(ctx, changed);
  const { tableColumns, masterImportFieldCount, masterProductionTriggerCount, sourceByteCount } = ctx.state;
  process.stdout.write(`[bulk-master-http] ${ROW_COUNT} rows, ${tableColumns.length} columns, ${masterImportFieldCount} physical fields, ${masterProductionTriggerCount} enabled triggers, ${(sourceByteCount / 1024 / 1024).toFixed(2)} MiB` + '\n');
  process.stdout.write(`[bulk-master-http] local Docker/Postgres ms: insert ${Math.round(initial.insert)}, changed ${Math.round(changed.milliseconds)}, unchanged ${Math.round(unchanged)}, exact replay ${Math.round(initial.replay)}, legacy bootstrap ${Math.round(legacy)}` + '\n');
}

async function cleanBulkMasterFixture(ctx) {
  try {
    await closeBulkMasterFences(ctx);
    await removeBulkMasterFixtures(ctx);
    await verifyBulkMasterCleanup(ctx);
  } catch (error) {
    await ctx.db.query('rollback').catch(() => {});
    throw error;
  }
}

function throwBulkMasterFailure(failures) {
  if (failures.length > 1) throw new AggregateError(failures, 'BULK_MASTER_HTTP_AND_CLEANUP_FAILED');
  if (failures.length) throw failures[0];
}

export async function runBulkMasterImportHttpRegression(workspaceRoot) {
  const ctx = await connectBulkMasterFixture(workspaceRoot);
  attachBulkMasterOperations(ctx);
  const failures = [];
  try {
    await readBulkMasterSchema(ctx);
    await runBulkMasterCases(ctx).catch(error => failures.push(error));
    await cleanBulkMasterFixture(ctx);
  } catch (error) {
    failures.push(error);
  } finally {
    await ctx.db.end().catch(error => failures.push(error));
  }
  throwBulkMasterFailure(failures);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node supabase/ci/bulk_master_import_http.mjs <verified-workspace>');
  await runBulkMasterImportHttpRegression(process.argv[2]);
}
