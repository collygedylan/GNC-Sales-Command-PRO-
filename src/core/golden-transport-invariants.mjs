import assert from 'node:assert/strict';
import { dispatchRpcWithRecovery } from '../services/rpc-recovery-domain.js';
import { migrationBody, buildScopedMigrationApplySql, releaseDatabaseMigrations } from '../../scripts/apply-item-low-stock-migration.mjs';

export async function rpcRecoveryInvariant(databaseBridge) {
  let calls = 0;
  const body = { p_idempotency_key: 'golden-receipt', p_baseline: null, p_complete: null, p_evidence: null,
    p_expected_itemcode: null, p_expected_locationcode: null, p_expected_lotcode: null,
    p_expected_signature: null, p_master_uid: 'row', p_workflow: 'notes' };
  const bridge = databaseBridge(async () => ++calls === 1 ? new Response('', { status: 503 }) : Response.json({ ok: true }));
  const options = { bridge, baseUrl: 'https://fixture.invalid', rpcName: 'save_drive_evidence_v3', body,
    request: { method: 'POST', headers: { Authorization: 'Bearer fixture' }, body: JSON.stringify(body) },
    requestOptions: {}, timeoutMs: 1000, inScope: () => true, hedgeInScope: () => true };
  assert.equal((await dispatchRpcWithRecovery(options)).status, 200);
  assert.equal(calls, 2);
  calls = 0;
  options.inScope = () => false;
  await assert.rejects(dispatchRpcWithRecovery(options));
  assert.equal(calls, 1);
}

export function migrationAtomicityInvariant() {
  const source = "set local lock_timeout='1s';\nselect 'commit;';";
  assert.equal(migrationBody(source), source);
  const sql = buildScopedMigrationApplySql({ source, targetMigrationName: releaseDatabaseMigrations[0] });
  assert.match(sql, /^begin;/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /commit;\s*$/);
  assert.throws(() => migrationBody('select 1; commit; select 2;'), /TRANSACTION_REQUIRED/);
  assert.equal(migrationBody('begin;\nselect 1;\ncommit;'), 'select 1;');
}
