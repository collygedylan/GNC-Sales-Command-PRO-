import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import {
  collectReleaseUnitTestFiles,
  explicitReleaseUnitTests,
  releaseUnitScriptNames,
  runReleaseUnitChecks,
  testFilesFromPackageScript,
} from '../scripts/run-release-unit-checks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));

// Evaluate the real checked-in config objects, without launching Playwright or
// starting any server. Isolated env values cannot inherit a production target.
function configLoader() {
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
      } },
    }, { filename: fullPath });
    return module.exports;
  }
  return name => load(name).default;
}

function specFiles(directory = path.join(root, 'tests')) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return specFiles(fullPath);
    return /\.spec\.(?:js|ts)$/.test(entry.name)
      ? [path.relative(root, fullPath).replaceAll(path.sep, '/')] : [];
  }).sort();
}

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

const allSpecs = specFiles();
const selected = config => allSpecs.filter(file => matches(config.testMatch, file) && !matches(config.testIgnore, file));
const originalBrowserFiles = [
  'tests/block-clearing.e2e.spec.ts',
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

test('release unit union preserves every existing script and explicit gate exactly once', () => {
  assert.deepEqual(releaseUnitScriptNames, ['test:photo', 'test:pilot', 'test:live-sync']);
  assert.deepEqual(explicitReleaseUnitTests, [
    'tests/hl-order.test.mjs',
    'tests/hl-order-ship-date.test.mjs',
    'tests/hl-order-rollback.test.mjs',
    'tests/hl-order-delivery.test.mjs',
    'tests/hl-order-delivery-worker.test.mjs',
    'tests/hl-tags-email.test.mjs',
    'tests/eval-review-assignedto-api.test.mjs',
    'tests/production-probe-read-only.test.mjs',
    'tests/prepare-ci-playwright-apt.test.mjs',
  ]);
  const priorFiles = releaseUnitScriptNames.flatMap(name =>
    [...manifest.scripts[name].matchAll(/tests\/[\w./-]+\.test\.(?:mjs|cjs|js)/g)].map(match => match[0]));
  const pipelineFiles = readdirSync(path.join(root, 'tests'))
    .filter(name => /^release-.+\.test\.mjs$/.test(name)).map(name => `tests/${name}`);
  assert.ok(pipelineFiles.includes('tests/release-test-coverage.test.mjs'));
  const expected = [...new Set([...priorFiles, ...explicitReleaseUnitTests, ...pipelineFiles])].sort();
  const actual = collectReleaseUnitTestFiles(root);
  assert.deepEqual(actual, expected);
  assert.ok(priorFiles.length > new Set(priorFiles).size, 'Fixture must exercise shared tests between scripts');
  assert.equal(actual.length, new Set(actual).size);
});

test('package script parsing fails closed instead of silently dropping unsupported commands', () => {
  for (const name of releaseUnitScriptNames) assert.ok(testFilesFromPackageScript(name, manifest.scripts[name]).length);
  for (const command of [
    undefined, '', 'echo tests/example.test.mjs', 'node --test',
    'node --test tests/*.test.mjs', 'node --test --experimental-option tests/example.test.mjs',
    'node --test tests/example.test.mjs && node other.mjs',
    'node --test tests/../example.test.mjs',
  ]) assert.throws(() => testFilesFromPackageScript('fixture', command), /Release unit script fixture/);
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

test('functional, timing and database lanes cover the original browser files without overlap', () => {
  const load = configLoader();
  const base = load('playwright.config.ts');
  const functional = load('playwright.release-functional.config.ts');
  const timing = load('playwright.release-timing.config.ts');
  const database = load('playwright.database.config.ts');
  assert.deepEqual(selected(base), originalBrowserFiles);
  const functionalFiles = selected(functional);
  const timingFiles = selected(timing);
  assert.deepEqual(timingFiles, ['tests/login-photo-repair.e2e.spec.ts', 'tests/scroll-performance.e2e.spec.ts']);
  assert.deepEqual(selected(database), ['tests/native-auth-provisioning-local.spec.js', 'tests/request-integrity-local.spec.js']);
  const databaseOriginalFiles = selected(database).filter(file => originalBrowserFiles.includes(file));
  const union = [...functionalFiles, ...timingFiles, ...databaseOriginalFiles];
  assert.equal(union.length, new Set(union).size, 'Every original file belongs to exactly one lane');
  assert.deepEqual([...union].sort(), selected(base));
  assert.equal(functionalFiles.length, 7);
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
  ['footer', 'footer-navigation', ['footer-android-chromium', 'footer-iphone-webkit', 'footer-desktop-firefox']],
  ['home-role', 'home-role-visibility', ['home-android-chromium', 'home-iphone-webkit', 'home-tablet-coarse-webkit', 'home-desktop-chromium']],
  ['season-sales-office', 'season-sales-office-completion', ['season-sales-office-android-chromium', 'season-sales-office-iphone-webkit']],
  ['suspend-tag', 'suspend-tag-completion', ['suspend-tag-android-chromium', 'suspend-tag-iphone-webkit']],
  ['docks-filter', 'docks-filter', ['docks-android', 'docks-iphone', 'docks-desktop']],
  ['task-av-blanks', 'task-av-blanks', ['task-av-chromium', 'task-av-iphone']],
  ['session-recovery', 'session-recovery', ['session-chromium', 'session-iphone']],
  ['review-assignedto', 'review-assignedto', ['chromium', 'firefox', 'webkit']],
  ['verified-data-cache', 'verified-data-cache', ['cache-chromium', 'cache-firefox', 'cache-webkit', 'cache-android', 'cache-iphone']],
  ['request-photo', 'request-photo-completion', ['cache-chromium', 'cache-firefox', 'cache-webkit', 'cache-android', 'cache-iphone']],
];

for (const [name, spec, projects] of compiledSuites) {
  test(`compiled ${name} suite keeps its exact file and browser coverage outside source lanes`, () => {
    const load = configLoader();
    const config = load(`playwright.${name}.config.ts`);
    const files = selected(config);
    assert.deepEqual(files, [`tests/${spec}.e2e.spec.ts`]);
    assert.deepEqual(plain(config.projects.map(project => project.name)), projects);
    assert.ok(!files.some(file => selected(load('playwright.release-functional.config.ts')).includes(file)));
    assert.ok(!files.some(file => selected(load('playwright.release-timing.config.ts')).includes(file)));
    if (['verified-data-cache', 'request-photo'].includes(name)) assert.match(config.webServer.command, /startReleaseTestServer/);
    else if (name !== 'review-assignedto') assert.match(config.webServer.command, /--directory _site(?:\s|$)/);
    else assert.match(config.webServer.command, /startReleaseTestServer/);
  });
}

test('Request regressions run against the compiled shell across desktop and mobile browsers', () => {
  const load = configLoader();
  const config = load('playwright.request-reliability.config.ts');
  assert.deepEqual(selected(config), ['tests/request-entry-source.e2e.spec.ts', 'tests/request-on-hand-calculation.e2e.spec.ts']);
  assert.deepEqual(plain(config.projects.map(project => project.name)), ['cache-chromium', 'cache-firefox', 'cache-webkit', 'cache-android', 'cache-iphone']);
  assert.match(config.webServer.command, /startReleaseTestServer/);
  assert.equal(config.workers, 1);
  assert.equal(config.retries, 0);
});

test('compiled Android login coverage stays separate while three desktop projects move to timing', () => {
  const load = configLoader();
  const login = load('playwright.login-photo.config.ts');
  assert.deepEqual(selected(login), ['tests/login-photo-repair.e2e.spec.ts']);
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

// Explicit rollback coverage contract: every original product test stays in the
// release union, and browser substitutions preserve complete executable bodies.
const september9ProductScripts = {
  "test:photo": "node --test tests/photo-egress.test.mjs tests/photo-history.test.mjs tests/service-worker-isolation.test.mjs",
  "test:pilot": "node --test --test-concurrency=1 tests/docks-filter-sync.test.mjs tests/live-sync-read-boundary.test.mjs tests/live-sync-registry-coverage.test.mjs tests/live-sync-coordinator.test.mjs tests/live-sync-adapters.test.mjs tests/suspend-tag-completion.test.mjs tests/suspend-tag-import.test.mjs tests/bloomscapes-pending-view.test.mjs tests/drive-evidence-storm.test.mjs tests/live-pilot.test.mjs tests/scroll-performance.test.mjs tests/eval-reports-engine.test.mjs tests/reclass-inquiry.test.mjs tests/drive-reclass-protected.test.mjs tests/item-inquiry-coverage.test.mjs tests/eval-work.test.mjs tests/eval-work-folder-v2.test.mjs tests/eval-report2-completion-routing.test.mjs tests/request-eval-drive-reliability.test.mjs tests/request-option-append.test.mjs tests/request-completion-resilience.test.mjs tests/shear-location-inquiry.test.mjs tests/location-work.test.mjs tests/dock-trip-status.test.mjs tests/block-clearing-pdf-backend.test.mjs tests/apps-script-sync.test.mjs tests/apps-script-lifecycle.test.mjs tests/request-ios-swipe.test.mjs tests/transactions-keyed.test.mjs tests/pikes-orders.test.mjs tests/stine-lumber-orders.test.mjs tests/season-sales-office-staging.test.mjs tests/season-sales-office-completion.test.mjs tests/season-sales-office-av-note.test.mjs tests/request-season-sales-office-refresh.test.mjs tests/post-deployment-canary.test.mjs tests/po-management-native-auth.test.mjs tests/access-control-audit.test.mjs tests/kayla-admin-drive-flyer.test.mjs tests/sales-marketing-access.test.mjs tests/codex-operations.test.mjs",
  "test:live-sync": "node --test tests/live-sync-coordinator.test.mjs tests/live-sync-read-boundary.test.mjs tests/live-sync-registry-coverage.test.mjs tests/live-sync-adapters.test.mjs tests/docks-filter-sync.test.mjs"
};
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
    "Eval Reports #2 verifies a named user against current assignments before showing cards"
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
    "Eval assignment dropdown exposes the full managed roster and composite key"
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

test('September 9 product scripts preserve their complete baseline safety file sets', () => {
  for (const [name, command] of Object.entries(september9ProductScripts)) {
    assert.deepEqual(testFilesFromPackageScript(name, manifest.scripts[name]), testFilesFromPackageScript(name, command), name);
  }
});

test('rollback browser lanes preserve baseline assertions and fixture implementations without new skips', () => {
  const read = file => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
  for (const [destination, source, title] of september9BrowserBodies) {
    const original = read(source);
    const ast = ts.createSourceFile(source, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const statement = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
      && node.expression.expression.getText(ast) === 'test' && node.expression.arguments[0]?.text === title);
    assert.ok(statement, title);
    assert.ok(read(destination).includes(statement.getText(ast)), destination + ': entire baseline body for ' + title);
  }
  for (const [destination, source] of september9BrowserFixtures) {
    assert.ok(read(destination).includes(read(source).trim()), destination + ': complete baseline fixture');
  }
  for (const destination of ['tests/login-photo-repair.e2e.spec.ts', 'tests/request-photo-completion.e2e.spec.ts']) {
    assert.ok(read(destination).includes(read('tests/photo-egress.e2e.spec.ts').replace(/^import[^\n]*\n/, '').trim()), destination + ': photo assertions and original setup');
  }
  const replacements = new Set([...september9BrowserBodies, ...september9BrowserFixtures].map(([destination]) => destination));
  for (const file of replacements) assert.doesNotMatch(read(file), /\btest\.(?:skip|fixme|only)\s*\(/, file);
});
