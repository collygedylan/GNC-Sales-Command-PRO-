import assert from 'node:assert/strict';
import vm from 'node:vm';
import { transform } from 'esbuild';

export async function verifyCloudErpChaining(source, { releaseFailures = 0 } = {}) {
  const pick = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const code = [pick('function dispatchCloudErpSync(', 'async function handleErpSyncContinuation('),
    pick('async function releaseCloudErpSyncStep(', 'async function mintCloudDriveAccessToken('),
    pick('async function withCloudErpSyncLeaseHeartbeat<', 'async function processCloudErpSyncStep(')].join('\n');
  const pending = [], events = [];
  let pendingLeaseRecovery = false;
  let active = true, leased = false, step = 0, processed = 0, cloudCalls = 0, waits = 0, releaseErrors = releaseFailures;
  const context = vm.createContext({
    ERP_SYNC_CLOUD_WORKER_KEY: 'fixture-private-key', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', SUPABASE_URL: 'https://fixture.invalid',
    EdgeRuntime: { waitUntil: task => pending.push(task) }, AbortSignal, jsonObject: value => value,
    recordHandledError: (...args) => { if (args[1] !== 'ERP_SYNC_LEASE_RELEASE_FAILED') throw new Error(JSON.stringify(args)); },
    setTimeout: callback => { waits += 1; if (pendingLeaseRecovery) { leased = false; pendingLeaseRecovery = false; } setImmediate(callback); },
    setInterval: () => ({ inert: true }), clearInterval: () => {},
    supabase: { rpc: async (name) => {
      if (name === 'get_erp_sync_status_v1') return { data: { runId: 'run', active, requestedBy: 'authorized_actor' } };
      if (name === 'claim_erp_sync_request_step_v1') {
        if (leased || !active) { events.push('duplicate-denied'); return { data: { claimed: false } }; }
        leased = true; step += 1; events.push('claim');
        return { data: { claimed: true, workerId: 'owner', continuationStep: step } };
      }
      if (name === 'release_erp_sync_request_step_v1') { if (releaseErrors-- > 0) { if (releaseErrors === 0 && releaseFailures >= 2) pendingLeaseRecovery = true; return { error: { message: 'temporary connection error' } }; } leased = false; events.push('release'); return { data: true }; }
      throw Error(name);
    } },
    processCloudErpSyncStep: async () => {
      await Promise.resolve();
      assert.equal(leased, true); processed += 1; events.push('process');
      active = processed < 5;
      return { result: { done: !active } };
    },
    fetch: async (_url, options) => {
      cloudCalls += 1;
      // A successor is scheduled while the current owner holds the lease.
      assert.equal(options.headers.authorization, 'Bearer fixture-private-key');
      const request = JSON.parse(options.body);
      assert.deepEqual(request, { action: 'erp_sync', operation: 'continue', runId: 'run', relayHop: request.relayHop });
      assert.ok(Number.isSafeInteger(request.relayHop) && request.relayHop >= 1 && request.relayHop <= 40);
      assert.equal(options.headers['x-agdata-internal-relay'], '1');
      const claimed = await context.claimAndDispatchCloudStep('run', request.relayHop);
      return { ok: true, json: async () => ({ claimed, active }) };
    },
  });
  vm.runInContext((await transform(code + '\nglobalThis.claimAndDispatchCloudStep = claimAndDispatchCloudStep; globalThis.dispatchCloudErpSync = dispatchCloudErpSync;', { loader: 'ts', format: 'iife' })).code, context);
  // A browser/cloud overlap cannot claim a second concurrent chunk.
  const first = context.claimAndDispatchCloudStep('run');
  const overlap = context.claimAndDispatchCloudStep('run');
  assert.deepEqual(await Promise.all([first, overlap]), [true, false]);
  for (let index = 0; index < pending.length; index += 1) await pending[index];
  assert.equal(processed, 5, 'all stages finish with no browser continuation');
  assert.ok(cloudCalls >= 5);
  assert.equal(leased, false);
  assert.equal(events.filter(value => value === 'release').length, releaseFailures >= 2 ? 4 : 5);
  assert.ok(events.includes('duplicate-denied'));
  return { processed, cloudCalls, waits };
}
