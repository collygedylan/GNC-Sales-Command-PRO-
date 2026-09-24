import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.env.npm_execpath;
const stages = [];
let site;
let baseCommit;
function run(name, args, env = {}) {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: root, stdio: 'inherit', windowsHide: true, shell: false,
    env: { ...process.env, ...env },
  });
  stages.push({ name, durationMs: Date.now() - started, ok: !result.error && result.status === 0 });
  if (result.error || result.status !== 0) throw new Error(`FOUNDATION_CHECK_FAILED_${name}`);
}
try {
  if (!npm) throw new Error('RUN_WITH_NPM_RUN_CHECK_FOUNDATION');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', shell: false, windowsHide: true });
  baseCommit = String(head.stdout || '').trim();
  if (head.status !== 0 || !/^[a-f0-9]{40}$/.test(baseCommit)) throw new Error('FOUNDATION_BASE_COMMIT_UNAVAILABLE');
  run('syntax', ['scripts/check-inline-scripts.mjs']);
  run('contracts', ['--test', 'tests/release-app-lifecycle.test.mjs', 'tests/release-shell-lifecycle.test.mjs',
    'tests/live-sync-read-boundary.test.mjs', 'tests/live-sync-coordinator.test.mjs', 'tests/release-foundation-workflow.test.mjs']);
  run('assets', [npm, 'run', 'build:live:assets']);
  run('v2', [npm, 'run', 'build:v2']);
  fs.mkdirSync(path.join(root, '.gnc-local'), { recursive: true });
  site = fs.mkdtempSync(path.join(root, '.gnc-local', 'foundation-site-'));
  run('complete-site', ['scripts/prepare-release-site.mjs'], { LIVE_SITE_DIR: site, GITHUB_SHA: baseCommit });
  run('browser', ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.app-lifecycle.config.ts',
    '--workers=1', '--retries=0'], { APP_LIFECYCLE_SITE_DIR: site, APP_LIFECYCLE_BASE_URL: '', CI: '1' });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  const report = { mode: 'local-feedback-not-release-proof', source: 'unsealed-working-tree',
    baseCommit: baseCommit || null, ok: !process.exitCode, site: site || null, stages };
  fs.mkdirSync(path.join(root, '.gnc-local'), { recursive: true });
  fs.writeFileSync(path.join(root, '.gnc-local', 'foundation-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
