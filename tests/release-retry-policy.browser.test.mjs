// @test-group: release-tooling-nightly
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

test('real Playwright retries recover twice, exhaust after three attempts, and then fail fast without a browser', { timeout: 60_000 }, () => {
  const parent = path.resolve(tmpdir());
  const fixture = mkdtempSync(path.join(parent, 'gnc-ci-retry-probe-'));
  const playwright = JSON.stringify(require.resolve('@playwright/test'));
  const base = JSON.stringify(path.join(root, 'playwright.config.ts'));
  try {
    writeFileSync(path.join(fixture, 'playwright.config.cjs'), `
      const { defineConfig } = require(${playwright});
      const base = require(${base}).default;
      module.exports = defineConfig({ ...base, testDir: __dirname, testMatch: '*.spec.cjs',
        grep: undefined, grepInvert: undefined,
        projects: [{ name: 'retry-probe' }], fullyParallel: false, workers: 1, maxFailures: 1,
        use: {}, webServer: undefined, reporter: 'json', outputDir: __dirname + '/results' });
    `);
    writeFileSync(path.join(fixture, 'retry.spec.cjs'), `
      const { test, expect } = require(${playwright});
      test('retry target', async ({}, info) => {
        expect(process.env.GNC_RETRY_PROBE_MODE === 'recover' && info.retry === 2).toBe(true);
      });
      test('following test', async () => { expect(true).toBe(true); });
    `);
    for (const scenario of [
      { ci: true, mode: 'recover', exit: 0, attempts: ['failed', 'failed', 'passed'], outcome: 'flaky' },
      { ci: true, mode: 'fail', exit: 1, attempts: ['failed', 'failed', 'failed'], outcome: 'unexpected' },
      { ci: false, mode: 'fail', exit: 1, attempts: ['failed'], outcome: 'unexpected' },
    ]) {
      const env = { ...process.env, GNC_RETRY_PROBE_MODE: scenario.mode };
      if (scenario.ci) env.CI = 'true'; else delete env.CI;
      delete env.PLAYWRIGHT_JSON_OUTPUT_NAME;
      delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
      delete env.PLAYWRIGHT_JSON_OUTPUT_DIR;
      const run = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test',
        '--config', path.join(fixture, 'playwright.config.cjs')], {
        cwd: root, env, encoding: 'utf8', timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
      });
      assert.equal(run.error, undefined, run.error?.message);
      assert.equal(run.status, scenario.exit, run.stderr + run.stdout);
      const report = JSON.parse(run.stdout);
      const specs = report.suites.flatMap(suite => suite.specs);
      const target = specs.find(spec => spec.title === 'retry target').tests[0];
      assert.deepEqual(target.results.map(result => result.status), scenario.attempts);
      assert.equal(target.status, scenario.outcome);
      const following = specs.find(spec => spec.title === 'following test').tests[0];
      assert.equal(following.status, scenario.exit ? 'skipped' : 'expected');
    }
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), parent, 'Cleanup is limited to this generated fixture');
    rmSync(fixture, { recursive: true, force: true });
  }
});
