// @test-runtime: canonical-http
// Full-size canonical PH snapshot through the disposable local PostgREST API.
import { pathToFileURL } from 'node:url';
import { attachBulkMasterOperations, connectBulkMasterFixture, throwBulkMasterFailure } from '../../src/services/bulk-master-http-transport.mjs';
import { readBulkMasterSchema } from '../../src/services/bulk-master-http-contract.mjs';
import { closeBulkMasterFences, removeBulkMasterFixtures, verifyBulkMasterCleanup } from '../../src/services/bulk-master-http-cleanup.mjs';
import {runBulkMasterCases} from '../../src/services/bulk-master-http-run.mjs';

export { syntheticBulkMasterSnapshot } from '../../src/services/bulk-master-http-source.mjs';

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
