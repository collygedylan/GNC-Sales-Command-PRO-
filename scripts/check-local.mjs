import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { changedFilesFromGit, selectFocusedTests } from './select-focused-tests.mjs';
import { sourceDigest, siteDigest } from './local-validation-evidence.mjs';
import { recordValidationRun } from './repair-ledger.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const foundationTests = [
  'tests/release-app-lifecycle.test.mjs', 'tests/release-shell-lifecycle.test.mjs',
  'tests/live-sync-read-boundary.test.mjs', 'tests/live-sync-coordinator.test.mjs', 'tests/release-foundation-workflow.test.mjs',
];

// Commands are data, never shell input. Reject unsupported forms instead of
// guessing how to execute a new map entry or inheriting another build command.
export function focusedPlan(commands) {
  const unit = new Set(), browsers = new Map();
  for (const command of commands) {
    if (command === 'npm run check:foundation') continue;
    const parts = command.split(/\s+/);
    if (parts[0] === 'node' && parts[1] === '--test' && parts.length > 2
        && parts.slice(2).every(file => /^tests\/[\w.-]+\.test\.mjs$/.test(file))) {
      for (const file of parts.slice(2)) if (!foundationTests.includes(file)) unit.add(file);
    } else if (parts.slice(0, 4).join(' ') === 'npx playwright test --config'
        && /^playwright\.[\w-]+\.config\.ts$/.test(parts[4]) && parts.slice(5).every(arg =>
          /^(?:tests\/[\w.-]+\.spec\.(?:ts|js)|--project=[\w-]+|--grep=[\w|.-]+)$/.test(arg))) {
      browsers.set(command, { config: parts[4], args: parts.slice(5) });
    } else if (command === 'npm run test:v2') {
      browsers.set('v2-unit', { v2: true });
    } else throw new Error('LOCAL_COMMAND_UNSUPPORTED: ' + command);
  }
  const suites = [...browsers.values()];
  return { unit: [...unit].sort(), browsers: suites.filter(suite => !suite.args?.length
    || !suites.some(other => other !== suite && other.config === suite.config && !other.args.length)) };
}

export function runLocalChecks({ cwd = root, npm = process.env.npm_execpath, spawn = spawnSync, print = console.log, now = Date.now } = {}) {
  const directory = path.join(cwd, '.gnc-local');
  fs.mkdirSync(directory, { recursive: true });
  const output = fs.mkdtempSync(path.join(directory, 'local-check-'));
  const report = { schemaVersion: 'gnc-local-check-v1', mode: 'local-feedback-not-release-proof',
    startedAt: new Date().toISOString(), ok: false, output, stages: [] };
  const env = { ...process.env, CI: '1' };
  for (const key of Object.keys(env)) if (key.endsWith('_BASE_URL')) env[key] = '';
  let activeStage = 'selection';
  function run(name, args, extraEnv = {}) {
    activeStage = name;
    const started = now();
    const log = path.join(output, name + '.log');
    const fd = fs.openSync(log, 'w');
    let result;
    print(`Local check: ${name}`);
    try { result = spawn(process.execPath, args, { cwd, stdio: ['ignore', fd, fd], shell: false, windowsHide: true, env: { ...env, ...extraEnv } }); }
    finally { fs.closeSync(fd); }
    const stage = { name, durationMs: now() - started, ok: !result.error && result.status === 0, log };
    report.stages.push(stage);
    if (!stage.ok) {
      print(fs.readFileSync(log, 'utf8').split(/\r?\n/).slice(-35).join('\n'));
      throw new Error(`LOCAL_STAGE_FAILED: ${name}${result.error ? ': ' + result.error.message : ''}`);
    }
  }
  // Invalidate old success before any work, including selection and build setup.
  fs.writeFileSync(path.join(directory, 'local-check.json'), JSON.stringify(report, null, 2));
  try {
    if (!npm) throw new Error('RUN_WITH_NPM_RUN_CHECK_LOCAL');
    const map = JSON.parse(fs.readFileSync(path.join(cwd, 'live-src/change-impact.json'), 'utf8'));
    if (map.schemaVersion !== 'gnc-change-impact-v1') throw new Error('LOCAL_MAP_SCHEMA_INVALID');
    report.selection = selectFocusedTests(changedFilesFromGit(cwd), map);
    const plan = focusedPlan(report.selection.commands);
    report.plan = plan;
    print(`Affected modules: ${report.selection.modules.join(', ') || 'none mapped'}`);
    if (report.selection.unknown.length) print(`Coverage needs review; unmapped paths: ${report.selection.unknown.join(', ')}. Running shared fallback checks.`);
    run('foundation', [npm, 'run', 'check:foundation']);
    const foundation = JSON.parse(fs.readFileSync(path.join(directory, 'foundation-check.json'), 'utf8'));
    if (!foundation.ok || foundation.sourceDigest !== sourceDigest(cwd) || foundation.siteDigest !== siteDigest(foundation.site)) throw new Error('LOCAL_BUILD_IDENTITY_MISMATCH');
    Object.assign(report, { sourceDigest: foundation.sourceDigest, siteDigest: foundation.siteDigest, site: foundation.site,
      baseCommit: foundation.baseCommit, foundationStages: foundation.stages, foundationBrowserEvidence: foundation.browserEvidence });
    print(`Fresh build: ${report.site}; source ${report.sourceDigest.slice(0, 12)}; artifact ${report.siteDigest.slice(0, 12)}`);
    if (plan.unit.length) run('focused-unit', ['--test', '--test-concurrency=1', ...plan.unit]);
    for (const [index, suite] of plan.browsers.entries()) {
      if (suite.v2) run('v2-unit', [npm, 'run', 'test:v2']);
      else run(`browser-${index}`, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.local.config.ts',
        '--workers=1', '--retries=0', ...suite.args], { GNC_LOCAL_SITE_DIR: report.site, GNC_LOCAL_CONFIG: suite.config,
        GNC_LOCAL_OUTPUT_DIR: path.join(output, `browser-${index}`) });
    }
    activeStage = 'identity';
    if (report.sourceDigest !== sourceDigest(cwd) || report.siteDigest !== siteDigest(report.site)) throw new Error('LOCAL_BUILD_IDENTITY_MISMATCH');
    report.ok = true;
  } catch (error) {
    if (activeStage === 'foundation') {
      const foundationFile = path.join(directory, 'foundation-check.json');
      if (fs.existsSync(foundationFile)) {
        const failed = JSON.parse(fs.readFileSync(foundationFile, 'utf8'));
        report.foundationStages = failed.stages;
        report.foundationBrowserEvidence = failed.browserEvidence;
        if (!failed.ok) activeStage = 'foundation/' + (failed.stages.find(stage => !stage.ok)?.name || 'identity');
      }
    }
    report.failure = { stage: activeStage, message: error.message,
      category: /IDENTITY|SOURCE_CHANGED|BUILD_CHANGED/.test(error.message) ? 'build/artifact-mismatch'
        : /UNSUPPORTED|SCHEMA|NPM_RUN/.test(error.message) ? 'runner/configuration'
        : 'unclassified: inspect stage log and browser trace before assigning app, fixture/test, or infrastructure cause' };
    print(error.message);
  } finally {
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(directory, 'local-check.json'), JSON.stringify(report, null, 2) + '\n');
    recordValidationRun(cwd, report);
    print(`Local checks ${report.ok ? 'passed' : 'failed'}. Evidence: ${path.join(output, 'report.json')}`);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 2) throw new Error('Usage: npm run check:local');
    process.exitCode = runLocalChecks().ok ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
