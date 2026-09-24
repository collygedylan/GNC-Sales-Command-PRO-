import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('publication barriers retain client-to-PID identity when connection setup finishes in reverse order', async () => {
  const source = readFileSync(new URL('../scripts/test-sales-credit-concurrency.mjs', import.meta.url), 'utf8');
  const setup = source.match(/await Promise\.all\(clients\.map\(async[\s\S]*?\n  \}\)\);/)?.[0];
  assert.ok(setup, 'Exercise the actual concurrent connection setup');
  let secondFinished;
  const barrier = new Promise(resolve => { secondFinished = resolve; });
  const workerPids = [];
  const clients = [101,202].map((pid,index) => ({
    async connect() { if (index === 0) await barrier; },
    async query(sql) {
      if (sql === 'select pg_backend_pid() pid') return { rows: [{ pid }] };
      assert.equal(sql, 'set role service_role');
      if (index === 1) secondFinished();
      return { rows: [] };
    },
  }));
  await vm.runInNewContext('(async () => { ' + setup + ' })()', {
    clients, workerPids, serviceSession: async () => {},
  });
  assert.deepEqual(workerPids, [101,202],
    'Every indexed publication barrier must inspect the client actually executing its statement');
});
