// @test-group: av-blanks
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import {
  collectReleaseUnitTestFiles,
  runReleaseUnitChecks,
} from '../scripts/run-release-unit-checks.mjs';
import { discoverTests, readTestAnnotations } from '../scripts/test-discovery.mjs';
import { runDiscoveredNodeTests } from '../scripts/run-discovered-tests.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));

// Evaluate the real checked-in config objects, without launching Playwright or
// starting any server. Isolated env values cannot inherit a production target.
function configLoader(extraEnv = {}) {
  const cache = new Map();
  function load(filename) {
    const fullPath = path.resolve(root, filename);
    if (cache.has(fullPath)) return cache.get(fullPath).exports;
    const module = { exports: {} };
    cache.set(fullPath, module);
    const { outputText } = ts.transpileModule(readFileSync(fullPath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: fullPath,
    });
    const localRequire = specifier => specifier.startsWith('.')
      ? load(path.resolve(path.dirname(fullPath), `${specifier}.ts`))
      : require(specifier);
    vm.runInNewContext(outputText, {
      require: localRequire, module, exports: module.exports, URL,
      process: { env: {
        CI: '1', SUPABASE_LOCAL_URL: 'http://127.0.0.1:54321',
        SUPABASE_LOCAL_ANON_KEY: 'fixture-only', SUPABASE_LOCAL_SERVICE_ROLE_KEY: 'fixture-only',
        ...extraEnv,
      } },
    }, { filename: fullPath });
    return module.exports;
  }
  return name => load(name).default;
}

test('every CI Playwright config permits two retries while local runs remain immediate', () => {
  const configs = readdirSync(root).filter(name => /^playwright(?:\.[\w-]+)?\.config\.ts$/.test(name)
    && name !== 'playwright.local.config.ts');
  configs.push('v2/tests/playwright.partner.config.ts');
  for (const CI of ['true', undefined]) {
    const load = configLoader({ CI, CANARY_BASE_URL: 'http://127.0.0.1:43144' });
    for (const name of configs) {
      const config = load(name);
      assert.equal(config.retries, CI ? 2 : 0, name);
      assert.notEqual(config.failOnFlakyTests, true, name);
      for (const project of config.projects || []) {
        assert.equal(project.retries ?? config.retries, CI ? 2 : 0, `${name}: ${project.name}`);
      }
    }
  }
  assert.match(readFileSync(path.join(root, 'playwright.local.config.ts'), 'utf8'), /retries: 0/);
  for (const file of ['scripts/check-local.mjs', 'scripts/check-foundation.mjs']) {
    assert.match(readFileSync(path.join(root, file), 'utf8'), /'--retries=0'/, file);
  }
});

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

function matches(rule, file) {
  if (!rule) return false;
  if (Array.isArray(rule)) return rule.some(item => matches(item, file));
  if (typeof rule === 'string') {
    assert.ok(!/[?*{}]/.test(rule), `Extend the coverage matcher for new glob: ${rule}`);
    return file === rule || file.endsWith(`/${rule}`);
  }
  assert.equal(typeof rule.test, 'function', 'Unsupported Playwright test matcher');
  rule.lastIndex = 0;
  return rule.test(file);
}

const allSpecs = discoverTests({ root, group: 'playwright' });
const selected = config => allSpecs.filter(file => {
  if (!matches(config.testMatch, file) || matches(config.testIgnore, file)) return false;
  const tags = readTestAnnotations({ root, file }).filter(annotation => annotation.type === 'group')
    .flatMap(annotation => annotation.value.split(',').map(tag => tag.trim()));
  if (config.grep && !config.grep.test(tags.join(' '))) return false;
  if (config.grepInvert && config.grepInvert.test(tags.join(' '))) return false;
  return true;
});

test('every discovered browser spec belongs to an active workflow suite', () => {
  const directory = path.join(root, '.github/workflows');
  const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  let commands = readdirSync(directory).filter(file => /\.ya?ml$/.test(file))
    .map(file => readFileSync(path.join(directory, file), 'utf8')).join('\n');
  const usedScripts = new Set([...commands.matchAll(/npm run ([\w:-]+)/g)].map(match => match[1]));
  commands += '\n' + [...usedScripts].map(name => scripts[name] || '').join('\n');
  const configs = new Set([...commands.matchAll(/(?:v2\/tests\/)?playwright(?:\.[\w-]+)?\.config\.ts/g)].map(match => match[0]));
  const load = configLoader({ CANARY_BASE_URL: 'http://127.0.0.1:43144' });
  const executed = new Set([...configs].flatMap(file => selected(load(file))));
  assert.deepEqual(allSpecs.filter(file => !executed.has(file)), [], 'New browser specs need an existing suite tag or an explicit workflow environment');
});
const originalBrowserFiles = [
  'tests/block-clearing.e2e.spec.ts',
  'tests/eval-report2-async-index.e2e.spec.ts',
  'tests/eval-report2-header-filters.e2e.spec.ts',
  'tests/eval-work.e2e.spec.ts',
  'tests/login-photo-repair.e2e.spec.ts',
  'tests/photo-egress.e2e.spec.ts',
  'tests/photo-history.e2e.spec.ts',
  'tests/request-integrity-local.spec.js',
  'tests/responsive-workflows.e2e.spec.ts',
  'tests/sales-marketing-tasks.e2e.spec.ts',
  'tests/scroll-performance.e2e.spec.ts',
];

test('release unit runner is fully backed by dynamic test discovery', () => {
  const actual = collectReleaseUnitTestFiles(root);
  assert.deepEqual(actual, discoverTests({ root, group: 'node-unit' }));
  assert.equal(actual.length, new Set(actual).size);
  assert.ok(actual.includes('tests/release-test-coverage.test.mjs'));
  assert.ok(actual.includes('v2/tests/cache-migration.test.mjs'));
  assert.ok(!actual.some(file => file.endsWith('.browser.test.mjs')));
});

test('release unit runner spawns one serial process with deduplicated files and propagates failures', () => {
  const calls = [];
  const status = runReleaseUnitChecks({ rootDir: root, print() {}, spawn(...args) {
    calls.push(args);
    return { status: 7 };
  } });
  assert.equal(status, 7);
  assert.equal(calls.length, 1);
  const [executable, args, options] = calls[0];
  assert.equal(executable, process.execPath);
  assert.deepEqual(args, ['--test', '--test-concurrency=1', ...collectReleaseUnitTestFiles(root)]);
  assert.equal(options.cwd, root);
  assert.equal(options.stdio, 'inherit');
  assert.equal(options.env, process.env);
  assert.equal(runReleaseUnitChecks({ print() {}, spawn: () => ({ status: null, signal: 'SIGTERM' }) }), 1);
  assert.throws(() => runReleaseUnitChecks({ print() {}, spawn: () => ({ error: new Error('spawn failed') }) }), /spawn failed/);
});

test('unit discovery is deterministic and does not spawn tests', () => {
  const output = [];
  assert.equal(runReleaseUnitChecks({ rootDir: root, argv: ['--list'], print: value => output.push(value),
    spawn: () => assert.fail('list mode must not run tests') }), 0);
  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]), collectReleaseUnitTestFiles(root));
  assert.throws(() => runReleaseUnitChecks({ argv: ['--unknown'] }), /Usage:/);
});

test('compiled browser Node lane executes every discovered browser-test file', () => {
  const calls = [];
  const status = runDiscoveredNodeTests({ root, group: 'node-browser', print() {}, spawn(...args) {
    calls.push(args);
    return { status: 0 };
  } });
  assert.equal(status, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], ['--test', '--test-concurrency=1', ...discoverTests({ root, group: 'node-browser' })]);
  assert.throws(() => runDiscoveredNodeTests({ root, group: 'unknown', print() {} }), /DISCOVERED_NODE_GROUP_UNSUPPORTED/);
});

test('functional, timing and database lanes cover the original browser files without overlap', () => {
  const load = configLoader();
  const base = load('playwright.config.ts');
  const functional = load('playwright.release-functional.config.ts');
  const timing = load('playwright.release-timing.config.ts');
  const database = load('playwright.database.config.ts');
  for (const file of originalBrowserFiles) assert.ok(selected(base).includes(file), `${file}: original coverage retained`);
  const functionalFiles = selected(functional);
  const timingFiles = selected(timing);
  assert.ok(timingFiles.length > 0);
  assert.ok(selected(database).length > 0);
  const databaseOriginalFiles = selected(database).filter(file => selected(base).includes(file));
  const union = [...functionalFiles, ...timingFiles, ...databaseOriginalFiles];
  assert.equal(union.length, new Set(union).size, 'Every original file belongs to exactly one lane');
  assert.deepEqual([...union].sort(), selected(base));
  assert.ok(functionalFiles.length > 0);
  assert.equal(String(functional.testMatch), String(base.testMatch));
});

test('functional and timing lanes retain all original browser projects and assertion policies', () => {
  const load = configLoader();
  const base = load('playwright.config.ts');
  for (const name of ['playwright.release-functional.config.ts', 'playwright.release-timing.config.ts']) {
    const config = load(name);
    assert.deepEqual(plain(config.projects), plain(base.projects), name);
    assert.deepEqual(plain(config.projects.map(project => project.name)), ['chromium', 'firefox', 'webkit']);
    assert.equal(config.timeout, base.timeout);
    assert.equal(config.retries, base.retries);
    assert.equal(config.forbidOnly, true);
    assert.deepEqual(plain(config.use), plain(base.use));
    assert.equal(config.workers, 1);
    assert.equal(config.webServer.command, 'node scripts/serve-release-tests.mjs');
    assert.equal(config.webServer.reuseExistingServer, false, 'Never reuse a checkout server');
    assert.equal(config.webServer.url, base.use.baseURL);
  }
  const timing = load('playwright.release-timing.config.ts');
  assert.equal(timing.fullyParallel, false);
  assert.equal(timing.webServer.stdout, 'ignore');
  assert.equal(timing.webServer.stderr, 'ignore');
  assert.equal(load('playwright.release-functional.config.ts').fullyParallel, base.fullyParallel);
});

const compiledSuites = [
  ['reclass-splits', 'reclass-splits', ['cache-chromium', 'cache-android', 'cache-iphone']],
  ['bunch-note', 'bunch-note', ['cache-chromium', 'cache-android', 'cache-iphone']],
  ['sales-mobile', 'sales-mobile', ['sales-desktop', 'sales-android', 'sales-iphone', 'sales-narrow']],
  ['module-mobile', 'module-mobile-smoke', ['module-320', 'module-iphone']],
  ['footer', 'footer-navigation', ['footer-android-chromium', 'footer-iphone-webkit', 'footer-desktop-firefox']],
  ['home-role', 'home-role-visibility', ['home-android-chromium', 'home-iphone-webkit', 'home-tablet-coarse-webkit', 'home-desktop-chromium']],
  ['season-sales-office', 'season-sales-office-completion', ['season-sales-office-android-chromium', 'season-sales-office-iphone-webkit']],
  ['suspend-tag', 'suspend-tag-completion', ['suspend-tag-android-chromium', 'suspend-tag-iphone-webkit']],
  ['docks-filter', 'docks-filter', ['docks-android', 'docks-iphone', 'docks-desktop']],
  ['task-av-blanks', 'task-av-blanks', ['task-av-chromium', 'task-av-webkit', 'task-av-iphone']],
  ['session-recovery', 'session-recovery', ['session-chromium', 'session-iphone']],
  ['review-assignedto', 'review-assignedto', ['chromium', 'firefox', 'webkit']],
  ['verified-data-cache', 'verified-data-cache', ['cache-chromium', 'cache-firefox', 'cache-webkit', 'cache-android', 'cache-iphone']],
  ['request-photo', 'request-photo-completion', ['cache-chromium', 'cache-firefox', 'cache-webkit', 'cache-android', 'cache-iphone']],
  ['hl-restock', 'hl-restock', ['cache-chromium', 'cache-firefox', 'cache-webkit', 'cache-android', 'cache-iphone']],
];

test('hosted request and access canaries also gate the sealed candidate with unchanged browsers and assertions', () => {
  const load = configLoader({ CANARY_BASE_URL: 'http://127.0.0.1:43144' });
  const hosted = load('playwright.production.config.ts');
  const candidate = load('playwright.release-canary.config.ts');
  assert.ok(selected(candidate).includes('tests/production-request-canary.spec.ts'));
  assert.deepEqual(selected(candidate), selected(hosted));
  for (const key of ['projects', 'use', 'expect', 'timeout', 'retries', 'workers', 'fullyParallel', 'forbidOnly']) {
    assert.deepEqual(plain(candidate[key]), plain(hosted[key]), key);
  }
  assert.match(candidate.webServer.command, /--directory _site(?:\s|$)/);
  assert.equal(candidate.webServer.url, candidate.use.baseURL);
  assert.equal(candidate.webServer.reuseExistingServer, false);
  const workflow = readFileSync(path.join(root, '.github/workflows/release-validation.yml'), 'utf8');
  assert.match(workflow, /suite: production-requests\s+config: playwright\.release-canary\.config\.ts/);
});

for (const [name, spec, projects] of compiledSuites) {
  test(`compiled ${name} suite keeps its required file and browser coverage outside source lanes`, () => {
    const load = configLoader();
    const config = load(`playwright.${name}.config.ts`);
    const files = selected(config);
    const baseline = name === 'home-role' ? ['tests/assigned-items-filters.e2e.spec.ts', 'tests/home-native-startup.e2e.spec.ts', `tests/${spec}.e2e.spec.ts`, 'tests/verified-loading.e2e.spec.ts'] : [`tests/${spec}.e2e.spec.ts`];
    for (const file of baseline) assert.ok(files.includes(file), `${file}: original coverage retained`);
    assert.deepEqual(plain(config.projects.map(project => project.name)), projects);
    assert.ok(!files.some(file => selected(load('playwright.release-functional.config.ts')).includes(file)));
    assert.ok(!files.some(file => selected(load('playwright.release-timing.config.ts')).includes(file)));
    if (['verified-data-cache', 'request-photo', 'hl-restock', 'bunch-note', 'reclass-splits', 'sales-mobile', 'module-mobile', 'task-av-blanks'].includes(name)) assert.match(config.webServer.command, /startReleaseTestServer/);
    else if (name !== 'review-assignedto') assert.match(config.webServer.command, /--directory _site(?:\s|$)/);
    else assert.match(config.webServer.command, /startReleaseTestServer/);
  });
}

test('Request regressions run against the compiled shell across desktop and mobile browsers', () => {
  const load = configLoader();
  const config = load('playwright.request-reliability.config.ts');
  for (const file of ['tests/request-editing.e2e.spec.ts', 'tests/request-entry-source.e2e.spec.ts', 'tests/request-on-hand-calculation.e2e.spec.ts']) assert.ok(selected(config).includes(file));
  assert.deepEqual(plain(config.projects.map(project => project.name)), ['cache-chromium', 'cache-firefox', 'cache-webkit', 'cache-android', 'cache-iphone']);
  assert.match(config.webServer.command, /startReleaseTestServer/);
  assert.equal(config.workers, 1);
  assert.equal(config.retries, 2);
});

test('compiled Android login coverage stays separate while three desktop projects move to timing', () => {
  const load = configLoader();
  const login = load('playwright.login-photo.config.ts');
  assert.ok(selected(login).includes('tests/login-photo-repair.e2e.spec.ts'));
  assert.deepEqual(plain(login.projects.map(project => project.name)), ['chromium', 'firefox', 'webkit', 'android']);
  const base = load('playwright.config.ts');
  assert.deepEqual(plain(login.projects.slice(0, 3)), plain(base.projects));
  assert.equal(login.projects[3].use.isMobile, true);
  const android = load('playwright.release-android.config.ts');
  assert.deepEqual(selected(android), selected(login));
  assert.deepEqual(plain(android.projects), plain(login.projects.filter(project => project.name === 'android')));
  assert.equal(android.timeout, login.timeout);
  assert.equal(android.retries, login.retries);
  assert.equal(android.workers, 1);
  assert.equal(android.fullyParallel, false);
  assert.deepEqual(plain(android.webServer), plain(load('playwright.release-timing.config.ts').webServer));
  assert.equal(android.use.baseURL, base.use.baseURL);
});

test('Block Clearing retains its lexical fixture bridge for source and compiled runtime responses', () => {
  const source = readFileSync(path.join(root, 'tests/block-clearing.e2e.spec.ts'), 'utf8');
  assert.match(source, /const lexicalTestBridge =/);
  assert.match(source, /__blockClearingTestEval = \(source\) => eval\(source\)/);
  assert.match(source, /live-app-runtime-v/);
  assert.match(source, /body: \(await response\.text\(\)\) \+ lexicalTestBridge/);
  assert.match(source, /app-script-source/);
  assert.match(source, /\$\{start\}\$\{source\}\$\{lexicalTestBridge\}\$\{end\}/);
  assert.doesNotMatch(source, /writeFile|copyFile/);
});

// Explicit rollback coverage contract: browser substitutions preserve complete
// executable bodies; unit test file lists come from dynamic discovery above.
const september9BrowserBodies = [
  [
    "tests/login-photo-repair.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "phone login keeps both fields and the submit action visible"
  ],
  [
    "tests/login-photo-repair.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "Kayla receives standard Admin Request, Drive, and photo access"
  ],
  [
    "tests/login-photo-repair.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "Request AV sheet preserves swipe intent before selecting a later option"
  ],
  [
    "tests/eval-report2-header-filters.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "Eval Reports #2 uses real checkbox clicks and preserves whole-ITEMCODE selection in the flat view"
  ],
  [
    "tests/eval-report2-header-filters.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "Eval Reports #2 filters the coherent assignment index locally and adopts a later verified revision"
  ],
  [
    "tests/eval-report2-header-filters.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "Eval Reports #2 manager search refreshes while the search field remains active"
  ],
  [
    "tests/request-entry-source.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "Request rep selection always renders customer choices or a recoverable error state"
  ],
  [
    "tests/request-entry-source.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "Queue tab changes load only the canonical datasets needed by that tab"
  ],
  [
    "tests/request-entry-source.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "iPhone Request Queue renders all 19 rows instead of only the first adaptive chunk"
  ],
  [
    "tests/request-on-hand-calculation.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "Request quantity and spec fields stay high-contrast and responsive on phones"
  ],
  [
    "tests/request-on-hand-calculation.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "Request reusable evidence prompt accepts partial exact-row data without auto-completing"
  ],
  [
    "tests/request-photo-completion.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "Kayla receives standard Admin Request, Drive, and photo access"
  ],
  [
    "tests/request-photo-completion.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "phone Request detail uses natural scrolling, a photo rail, a scrollable AV sheet, and a persistent Mark Done tray"
  ],
  [
    "tests/request-photo-completion.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "Request AV sheet preserves swipe intent before selecting a later option"
  ],
  [
    "tests/request-photo-completion.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "Request reusable evidence prompt accepts partial exact-row data without auto-completing"
  ],
  [
    "tests/review-assignedto.e2e.spec.ts",
    "tests/eval-work.e2e.spec.ts",
    "Reclass Send as Review uses the searchable multi-evaluator Eval roster on phones"
  ],
  [
    "tests/review-assignedto.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "Eval assignment dropdown exposes the full managed roster and Itemcode default key"
  ],
  [
    "tests/review-assignedto.e2e.spec.ts",
    "tests/responsive-workflows.e2e.spec.ts",
    "Phone Drive Reclass skips the recipient picker and strips browser recipient fields"
  ]
];
const september9BrowserFixtures = [
  [
    "tests/task-av-blanks.e2e.spec.ts",
    "tests/sales-marketing-tasks.e2e.spec.ts"
  ],
  [
    "tests/session-recovery.e2e.spec.ts",
    "tests/home-role-visibility.e2e.spec.ts"
  ],
  [
    "tests/verified-data-cache.e2e.spec.ts",
    "tests/docks-filter.e2e.spec.ts"
  ]
];

test('rollback browser lanes preserve baseline assertions and fixture implementations without new skips', () => {
  const read = file => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')
    .replace(/^\/\/ @test-group:.*\n/gm, '')
    .replace(/,\s*\{"tag":\[[^\]]*\]\},\s*/g, ', ');
  for (const [destination, source, title] of september9BrowserBodies) {
    const original = read(source);
    const ast = ts.createSourceFile(source, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const statement = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
      && node.expression.expression.getText(ast) === 'test' && node.expression.arguments[0]?.text === title);
    assert.ok(statement, title);
    const destinationAst = ts.createSourceFile(destination, read(destination), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const currentStatement = destinationAst.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
      && node.expression.expression.getText(destinationAst) === 'test' && node.expression.arguments[0]?.text === title);
    assert.ok(currentStatement, destination + ': baseline test body for ' + title);
    let currentBody = currentStatement.getText(destinationAst);
    let baselineBody = statement.getText(ast);
    const stripSuiteTags = body => body.replace(/,\s*\{"tag":\[[^\]]*\]\},\s*/g, ', ');
    currentBody = stripSuiteTags(currentBody);
    baselineBody = stripSuiteTags(baselineBody);
    if (destination === 'tests/eval-report2-header-filters.e2e.spec.ts'
      && ['Eval Reports #2 uses real checkbox clicks and preserves whole-ITEMCODE selection in the flat view',
        'Eval Reports #2 filters the coherent assignment index locally and adopts a later verified revision'].includes(title)) {
      // The full-projection gate now requires fixture metadata for the
      // synthetic complete master snapshot. Permit only this exact additive
      // metadata statement; all original test code and assertions stay exact.
      const metadata = /\n[\t ]*masterState\.fieldCoverage = 'full';(?:\n[\t ]*|[\t ]*)masterState\.rowCompleteness = 'complete';/g;
      const matches = currentBody.match(metadata) || [];
      const baselineMatches = baselineBody.match(metadata) || [];
      assert.equal(matches.length, 1, destination + ': one full-snapshot fixture marker in ' + title);
      assert.equal(baselineMatches.length, 1, source + ': one full-snapshot fixture marker in ' + title);
      currentBody = currentBody.replace(metadata, '\n');
      baselineBody = baselineBody.replace(metadata, '\n');
    }
    assert.ok(currentBody.includes(baselineBody), destination + ': entire baseline body for ' + title);
  }
  for (const [destination, source] of september9BrowserFixtures) {
    const destinationText = read(destination);
    const sourceText = read(source);
    if (['tests/session-recovery.e2e.spec.ts', 'tests/verified-data-cache.e2e.spec.ts'].includes(destination)) {
      // These paired suites share baseline behavior, but their request guards
      // and compact-filter setup legitimately differ. Keep every baseline
      // test title and assertion while allowing those fixture-specific edits.
      const sourceAst = ts.createSourceFile(source, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const destinationAst = ts.createSourceFile(destination, destinationText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const baselineTests = sourceAst.statements.filter(node => ts.isExpressionStatement(node)
        && ts.isCallExpression(node.expression) && node.expression.expression.getText(sourceAst) === 'test');
      for (const statement of baselineTests) {
        const title = statement.expression.arguments[0]?.text;
        const matchingTest = destinationAst.statements.find(node => ts.isExpressionStatement(node)
          && ts.isCallExpression(node.expression) && node.expression.expression.getText(destinationAst) === 'test'
          && node.expression.arguments[0]?.text === title);
        assert.ok(matchingTest, destination + ': baseline test title ' + title);
        const baselineAssertions = [];
        const collectAssertions = node => {
          if (ts.isCallExpression(node) && node.expression.getText(sourceAst) === 'expect') baselineAssertions.push(node);
          ts.forEachChild(node, collectAssertions);
        };
        collectAssertions(statement);
        const currentTestBody = matchingTest.getText(destinationAst);
        for (const assertion of baselineAssertions) {
          assert.ok(currentTestBody.includes(assertion.getText(sourceAst)), destination + ': baseline assertion in ' + title);
        }
      }
    } else {
      assert.ok(destinationText.includes(sourceText.trim()), destination + ': complete baseline fixture');
    }
  }
  for (const destination of ['tests/login-photo-repair.e2e.spec.ts', 'tests/request-photo-completion.e2e.spec.ts']) {
    assert.ok(read(destination).includes(read('tests/photo-egress.e2e.spec.ts').replace(/^import[^\n]*\n/, '').trim()), destination + ': photo assertions and original setup');
  }
  const replacements = new Set([...september9BrowserBodies, ...september9BrowserFixtures].map(([destination]) => destination));
  for (const file of replacements) assert.doesNotMatch(read(file), /\btest\.(?:skip|fixme|only)\s*\(/, file);
});

test('compiled matrix partitions preserve every declared browser project and suite', () => {
  const workflow = require('js-yaml').load(readFileSync(path.join(root, '.github/workflows/release-validation.yml'), 'utf8'));
  const entries = workflow.jobs.compiled.strategy.matrix.include.filter(row => row.suite !== 'command-center');
  const expected = ["playwright.sw-isolation.config.ts","v2/tests/playwright.partner.config.ts","playwright.release-canary.config.ts","playwright.footer.config.ts","playwright.home-role.config.ts","playwright.season-sales-office.config.ts","playwright.season-priority.config.ts","playwright.suspend-tag.config.ts","playwright.docks-filter.config.ts","playwright.task-av-blanks.config.ts","playwright.session-recovery.config.ts","playwright.review-assignedto.config.ts","playwright.verified-data-cache.config.ts","playwright.request-reliability.config.ts","playwright.request-photo.config.ts","playwright.bunch-note.config.ts","playwright.reclass-splits.config.ts","playwright.sales-mobile.config.ts","playwright.module-mobile.config.ts","playwright.production-schedule.config.ts","playwright.hl-order.config.ts","playwright.hl-restock.config.ts","playwright.stable-background-refresh.config.ts"];
  assert.deepEqual([...new Set(entries.map(row => row.config))].sort(), expected.sort());
  const load = configLoader();
  for (const file of expected) {
    const projects = load(file).projects;
    const rows = entries.filter(row => row.config === file);
    assert.deepEqual([...new Set(rows.map(row => row.project))].sort(), plain(projects.map(project => project.name)).sort(), file);
    for (const project of projects) {
      const group = rows.filter(row => row.project === project.name);
      const total = file === 'playwright.home-role.config.ts' ? 2 : 1;
      assert.equal(group.length, total, file + ': ' + project.name);
      assert.deepEqual(group.map(row => row.shard).sort(), Array.from({length:total}, (_,i)=>i+1));
      assert.ok(group.every(row => row.total === total && row.browsers === (project.use.browserName || project.use.defaultBrowserType || 'chromium')));
    }
  }
});
