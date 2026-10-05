import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function source(name) {
  const marker = new RegExp(`        (?:async )?function ${name}\\(`);
  const start = html.search(marker);
  assert.ok(start >= 0);
  const tail = html.slice(start + 1);
  const end = tail.search(/\r?\n        (?:async )?function \w+\(/);
  return html.slice(start, start + end + 1);
}

test('SOC PATCH denial preserves the write contract, reports safe diagnostics, and never retries', async () => {
  const calls = [], warnings = [], health = [];
  const denied = Object.assign(new Error('permission denied: private row and token'), { status: 403, code: '42501' });
  const ctx = vm.createContext({
    console: { warn: (...args) => warnings.push(args) }, Date,
    normalizeAppTableName: value => value,
    isRetiredSupabaseRuntimeTable: () => false,
    getNativeAuthRequestHeaders: async () => ({ Authorization: 'Bearer private-token' }),
    startGlobalProgress() {}, stopGlobalProgress() {},
    normalizeSupabaseWriteBodyForTable: (_table, _method, body) => body,
    SUPABASE_WRITE_TIMEOUT_MS: 10000, SUPABASE_KEY: 'configured', SUPABASE_URL: 'https://example.invalid',
    fetchWithTimeout: async (...args) => {
      calls.push(args);
      return { ok: false, headers: { get: key => key === 'sb-request-id' ? 'request-1234' : null } };
    },
    createSupabaseReadResponseError: async () => denied,
    reportSemanticHealthEvent: (...args) => { health.push(args); return Promise.resolve(true); },
  });
  vm.runInContext(['getSupabaseReadErrorCode', 'buildSocWriteFailureDiagnostic', 'supabaseFetch'].map(source).join('\n'), ctx);
  const patch = { suspend: 'SUSPEND', suspend_to: 'DC' };
  await assert.rejects(ctx.supabaseFetch('ph_soc_master', 'PATCH', patch, 'unique_id=eq.private-row'), error => error === denied);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].method, 'PATCH');
  assert.equal(calls[0][1].body, JSON.stringify(patch));
  assert.equal(calls[0][1].headers.Authorization, 'Bearer private-token');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1].status, 403);
  assert.equal(warnings[0][1].sqlState, '42501');
  assert.equal(warnings[0][1].requestId, 'request-1234');
  assert.equal(health.length, 1);
  assert.doesNotMatch(JSON.stringify({ warnings, health }), /private|token|suspend_to|unique_id|permission denied/);
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
