import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

test('full-repository lint excludes generated browser reports and still covers authored tests and adapters', async () => {
  const lint = new ESLint({ cwd: fileURLToPath(new URL('../', import.meta.url)) });
  for (const file of ['test-results/.playwright-artifacts/traces/resources/runtime.js', 'playwright-report/data/trace.js']) {
    assert.equal(await lint.isPathIgnored(file), true, file);
  }
  for (const file of ['tests/request-queue-removal.test.mjs', 'services/liveDatabase.ts', 'supabase/functions/app-api/index.ts']) {
    assert.equal(await lint.isPathIgnored(file), false, file);
  }
});
