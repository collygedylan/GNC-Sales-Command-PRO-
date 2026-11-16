import {ROW_COUNT} from './bulk-master-http-source.mjs';
import {prepareBulkHandoverIdentity,scheduleBulkHandover,seedBulkMasterFixture} from './bulk-master-http-contract.mjs';
import {assertAtomicBulkRollback,assertChangedBulkPublication,assertInitialBulkPublication,
  assertLegacyBulkBootstrap,assertUnchangedBulkPublication} from './bulk-master-http-cases.mjs';
import {verifyBulkActionSqlContract} from './bulk-master-http-protected-row.mjs';

const phases=Object.freeze({prepareBulkHandoverIdentity,verifyBulkActionSqlContract,scheduleBulkHandover,
  seedBulkMasterFixture,assertInitialBulkPublication,assertUnchangedBulkPublication,
  assertChangedBulkPublication,assertAtomicBulkRollback,assertLegacyBulkBootstrap});

export async function runBulkMasterCases(ctx,operations=phases,write=text=>process.stdout.write(text)) {
  await operations.prepareBulkHandoverIdentity(ctx);
  await operations.verifyBulkActionSqlContract(ctx);
  await operations.scheduleBulkHandover(ctx);
  await operations.seedBulkMasterFixture(ctx);
  const initial=await operations.assertInitialBulkPublication(ctx);
  const unchanged=await operations.assertUnchangedBulkPublication(ctx);
  const changed=await operations.assertChangedBulkPublication(ctx);
  await operations.assertAtomicBulkRollback(ctx,changed);
  const legacy=await operations.assertLegacyBulkBootstrap(ctx,changed);
  const {tableColumns,masterImportFieldCount,masterProductionTriggerCount,sourceByteCount}=ctx.state;
  write(`[bulk-master-http] ${ROW_COUNT} rows, ${tableColumns.length} columns, ${masterImportFieldCount} physical fields, ${masterProductionTriggerCount} installed triggers, ${(sourceByteCount/1024/1024).toFixed(2)} MiB\n`);
  write(`[bulk-master-http] local Docker/Postgres ms: insert ${Math.round(initial.insert)}, changed ${Math.round(changed.milliseconds)}, unchanged ${Math.round(unchanged)}, exact replay ${Math.round(initial.replay)}, legacy bootstrap ${Math.round(legacy)}\n`);
}
