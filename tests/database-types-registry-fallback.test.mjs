import assert from 'node:assert/strict';
import test from 'node:test';
import { runLocalTypesCommand } from '../scripts/database-types.mjs';

const args = ['gen', 'types', '--local', '--schema', 'public', '--lang', 'typescript'];
const ecrThrottle = new Error('supabase failed (1).\nUnable to find image public.ecr.aws/supabase/postgres-meta:v0.96.6\ndocker: toomanyrequests: Rate exceeded');

test('local type generation retries one recognized postgres-meta ECR throttle via GHCR', () => {
  const calls = [];
  const output = runLocalTypesCommand((command, options) => {
    calls.push({ command, options });
    if (calls.length === 1) throw ecrThrottle;
    return 'export type Database = {};';
  }, args);
  assert.equal(output, 'export type Database = {};');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.command), [args, args]);
  assert.deepEqual(calls[0].options, { capture: true });
  assert.deepEqual(calls[1].options, { capture: true, env: { SUPABASE_INTERNAL_IMAGE_REGISTRY: 'ghcr.io' } });
});

test('local type generation does not retry non-throttle failures or other images', () => {
  for (const failure of [
    new Error('public.ecr.aws/supabase/postgres-meta:v0.96.6: manifest unknown'),
    new Error('public.ecr.aws/supabase/postgres-meta:v0.96.6: connection refused'),
    new Error('public.ecr.aws/supabase/postgres:v17: toomanyrequests: Rate exceeded'),
  ]) {
    let calls = 0;
    assert.throws(() => runLocalTypesCommand(() => { calls += 1; throw failure; }, args), error => error === failure);
    assert.equal(calls, 1);
  }
});

test('GHCR retry failure is surfaced without a third registry attempt', () => {
  const calls = [];
  const ghcrFailure = new Error('ghcr.io/supabase/postgres-meta:v0.96.6: access denied');
  assert.throws(() => runLocalTypesCommand((command, options) => {
    calls.push(options);
    if (calls.length === 1) throw ecrThrottle;
    throw ghcrFailure;
  }, args), error => error === ghcrFailure);
  assert.equal(calls.length, 2);
});
