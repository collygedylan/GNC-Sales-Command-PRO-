import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource();
const evalSecurityStart = html.indexOf('        function isEvalSensitiveDataRestricted(');
const evalSecurityEnd = html.indexOf('        function runDedupeSupabaseRead(', evalSecurityStart);
assert.ok(evalSecurityStart >= 0 && evalSecurityEnd > evalSecurityStart, 'Eval security helpers should exist');
const evalSecurityHelpers = html.slice(evalSecurityStart, evalSecurityEnd);
function source(name) {
  const marker = new RegExp(`        (?:async )?function ${name}\\(`);
  const start = html.search(marker);
  assert.ok(start >= 0);
  const tail = html.slice(start + 1);
  const end = tail.search(/\r?\n        (?:async )?function \w+\(/);
  return html.slice(start, start + end + 1);
}

test('SOC PATCH denial uses the canonical command owner without a raw write or retry', async () => {
  const calls = [], rawWrites = [], state = { scope: 'actor', pending: {} };
  const denied = Object.assign(new Error('permission denied: private row and token'), { status: 403, code: '42501' });
  const ctx = vm.createContext({ URLSearchParams, Date, JSON, Error, Set, Map,
    normalizeAppTableName: value => value, socInventory: [{ unique_id: 'source-a' }],
    isDockSuspendDcRequestSource: () => false, getDockSuspendCompletionState: () => state,
    getSuspendTagWriteVersion: () => 3, getDockSuspendCompletionRevision: () => 'revision-1',
    dockSuspendCompletionInFlight: new Set(), persistDockSuspendCompletionState() {},
    crypto: { randomUUID: () => 'command-id' },
    suspendTagApi: async (...args) => { calls.push(args); throw denied; },
    window: { GncDatabase: { fetchTable: (...args) => { rawWrites.push(args); } } } });
  vm.runInContext([evalSecurityHelpers, ...['writeSocReviewThroughAppApi', 'supabaseFetch'].map(source)].join('\n'), ctx);
  const patch = { suspend: 'SUSPEND', suspend_to: 'DC' };
  await assert.rejects(ctx.supabaseFetch('ph_soc_master', 'PATCH', patch, 'unique_id=eq.source-a'), error => error === denied);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'dock_review');
  assert.equal(calls[0][1].sourceUid, 'source-a');
  assert.equal(calls[0][1].expectedLastUpdated, 'revision-1');
  assert.deepEqual({ ...calls[0][1].patch }, patch);
  assert.equal(calls[0][2].expectedVersion, 3);
  assert.equal(rawWrites.length, 0, 'SOC writes never bypass the authenticated command');
  assert.equal(ctx.dockSuspendCompletionInFlight.size, 0);
});

test('diagnostic metadata excludes arbitrary codes and invalid response request IDs', () => {
  const ctx = vm.createContext({ Date });
  vm.runInContext(['getSupabaseReadErrorCode', 'buildSocWriteFailureDiagnostic'].map(source).join('\n'), ctx);
  const result = ctx.buildSocWriteFailureDiagnostic({ code: 'SECRET_PAYLOAD' }, {
    method: 'bad', stage: 'unsafe stage', requestId: 'Bearer secret', startedAt: Date.now(),
  });
  assert.equal(result.requestId, null);
  assert.equal(result.sqlState, null);
  assert.equal(result.method, 'OTHER');
  assert.equal(result.stage, 'rest');
});
