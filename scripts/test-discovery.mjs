// @test-runtime: discovery-tool
import { closeSync, openSync, readSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

const RUNTIME_GROUPS = Object.freeze({
  'postgres-runtime': 'postgres',
  'postgres-concurrency': 'postgres-concurrency',
  'bloomscapes-pgtap': 'bloomscapes-postgres',
  'suspend-tag-pgtap': 'suspend-tag-postgres',
  'sql-isolated-supabase': 'isolated-supabase',
  'sql-isolated-acceptance': 'isolated-acceptance',
  'live-dataset-revision-sql': 'live-dataset-revision-sql',
  'sql-canonical': 'canonical',
  'canonical-http': 'canonical-http',
  'sandbox-pgtap': 'sandbox-pgtap',
  'local-auth-smoke': 'local-auth-smoke',
  'bloomscapes-concurrency': 'bloomscapes-concurrency',
  'suspend-tag-concurrency': 'suspend-tag-concurrency',
});
const GROUPS = Object.freeze({
  ...Object.fromEntries(Object.keys(RUNTIME_GROUPS).map(group => [group, () => false])),
  'node-unit': file => (file.startsWith('tests/') || file.startsWith('v2/tests/'))
    && /\.test\.(?:mjs|cjs|js)$/.test(file)
    && !file.endsWith('.browser.test.mjs'),
  'node-browser': file => (file.startsWith('tests/') || file.startsWith('v2/tests/'))
    && file.endsWith('.browser.test.mjs'),
  'node-ci-integration': file => file.startsWith('supabase/ci/')
    && /\.test\.(?:mjs|cjs|js)$/.test(file),
  'foundation': () => false,
  'vitest-mount': file => (file.startsWith('v2/src/') && /\.(?:test|spec)\.(?:ts|tsx)$/.test(file))
    || (file.startsWith('tests/') && /\.test\.(?:ts|tsx)$/.test(file)),
  'playwright': file => (file.startsWith('tests/') || file.startsWith('v2/tests/'))
    && /\.spec\.(?:ts|js|tsx)$/.test(file),
  'deno-tests': file => file.startsWith('supabase/functions/')
    && /(?:_test|\.test)\.ts$/.test(file),
  'deno-entrypoints': file => /^supabase\/functions\/[^/]+\/index\.ts$/.test(file),
  'pglite': file => file.startsWith('supabase/ci/') && /_pglite\.mjs$/.test(file),
  'concurrency': file => ((file.startsWith('scripts/') && /test-[\w-]*concurrency\.mjs$/.test(file))
      || (file.startsWith('supabase/ci/') && /_concurrency\.mjs$/.test(file))),
  'python': file => file.startsWith('tests/') && /(?:^|\/)test_[\w-]+\.py$/.test(file),
  'sql-secondary-harness': () => false,
  'sql-pgtap': file => file.startsWith('supabase/tests/') && /_test\.sql$/.test(file)
    && !/(?:rollback|canary)_test\.sql$/.test(file),
  'sql-rollback': file => file.startsWith('supabase/tests/')
    && /(?:rollback|canary)(?:_test)?\.sql$/.test(file),
});

function walk(rootDir, relativeDirectory = '') {
  const absoluteDirectory = path.join(rootDir, relativeDirectory);
  let entries;
  try { entries = readdirSync(absoluteDirectory, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (['node_modules', '.git', '.gnc-local', '_site', 'dist', 'artifacts', 'test-results', 'playwright-report', 'coverage', '.cache'].includes(entry.name)) continue;
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walk(rootDir, relativePath));
    else if (entry.isFile()) files.push(relativePath.replaceAll('\\', '/'));
  }
  return files;
}

/** Enumerate source/test files once when a caller needs both test groups and import relationships. */
export function discoverRepositoryFiles({ root = repositoryRoot } = {}) {
  return walk(path.resolve(root)).sort();
}

/** Discover repository test files by runner/environment convention, never by filename allowlist. */
export function discoverTests({ root = repositoryRoot, group, harness } = {}) {
  if (!group || !Object.hasOwn(GROUPS, group)) {
    throw new Error(`TEST_DISCOVERY_UNKNOWN_GROUP: ${String(group || '')}`);
  }
  const absoluteRoot = path.resolve(root);
  const files = walk(absoluteRoot);
  if (group === 'foundation') {
    return files.filter(GROUPS['node-unit']).filter(file => readTestAnnotations({ root: absoluteRoot, file })
      .some(annotation => annotation.type === 'group' && annotation.value.split(',').map(value => value.trim()).includes('foundation'))).sort();
  }
  if (group === 'sql-secondary-harness') {
    if (harness !== undefined && !/^[a-z][a-z0-9-]*$/.test(harness)) throw new Error('SQL_SECONDARY_HARNESS_NAME_INVALID');
    const selected = files.filter(file => file.startsWith('supabase/tests/') && /_test\.sql$/.test(file)
      && readTestAnnotations({ root: absoluteRoot, file }).some(annotation => annotation.type === 'harness'
        && (harness === undefined || annotation.value.split(',').includes(harness))));
    if (harness !== undefined && !selected.length) throw new Error(`SQL_SECONDARY_HARNESS_TESTS_REQUIRED:${harness}`);
    return selected.sort();
  }
  if (RUNTIME_GROUPS[group]) {
    const candidates = group === 'sandbox-pgtap'
      ? files.filter(file => file.startsWith('supabase/sandbox/tests/') && /_test\.sql$/.test(file))
      : files;
    const tests = candidates.filter(file => readTestAnnotations({ root: absoluteRoot, file })
      .some(annotation => annotation.type === 'runtime' && annotation.value.split(',').includes(RUNTIME_GROUPS[group]))).sort();
    if (group === 'sql-canonical' && !tests.length) throw new Error('SQL_CANONICAL_TESTS_REQUIRED');
    if (group === 'sandbox-pgtap' && !tests.length) throw new Error('SANDBOX_PGTAP_TESTS_REQUIRED');
    return tests;
  }
  return files.filter(GROUPS[group]).sort();
}

/** List every discovered group so CI can assert the taxonomy stays complete. */
export function discoverAllTests({ root = repositoryRoot, files: discoveredFiles } = {}) {
  const absoluteRoot = path.resolve(root);
  const files = discoveredFiles || walk(absoluteRoot);
  const output = {};
  const annotations = new Map();
  const annotationsFor = file => {
    if (!annotations.has(file)) annotations.set(file, readTestAnnotations({ root: absoluteRoot, file }));
    return annotations.get(file);
  };
  for (const group of Object.keys(GROUPS)) {
    output[group] = group === 'foundation'
      ? files.filter(GROUPS['node-unit']).filter(file => annotationsFor(file)
        .some(annotation => annotation.type === 'group' && annotation.value.split(',').map(value => value.trim()).includes('foundation'))).sort()
      : group === 'sql-secondary-harness'
        ? files.filter(file => file.startsWith('supabase/tests/') && /_test\.sql$/.test(file)
          && annotationsFor(file).some(annotation => annotation.type === 'harness')).sort()
      : RUNTIME_GROUPS[group]
        ? files.filter(file => (group !== 'sandbox-pgtap' || (file.startsWith('supabase/sandbox/tests/') && /_test\.sql$/.test(file)))
          && annotationsFor(file)
          .some(annotation => annotation.type === 'runtime' && annotation.value.split(',').includes(RUNTIME_GROUPS[group]))).sort()
        : files.filter(GROUPS[group]).sort();
  }
  return output;
}

/** Read an optional leading annotation block used for execution-specific exceptions. */
export function readTestAnnotations({ root = repositoryRoot, file } = {}) {
  if (!file) throw new Error('TEST_DISCOVERY_FILE_REQUIRED');
  if (!/\.(?:[cm]?[jt]sx?|sql|py)$/.test(file)) return [];
  const absolutePath = path.resolve(root, file);
  const handle = openSync(absolutePath, 'r');
  const buffer = Buffer.alloc(1400);
  let source;
  try { source = buffer.subarray(0, readSync(handle, buffer, 0, buffer.length, 0)).toString('utf8'); }
  finally { closeSync(handle); }
  const block = source.split(/\r?\n/).slice(0, 20).join('\n');
  const annotations = [];
  for (const match of block.matchAll(/^\s*(\/\/|--|#)\s*@test-(group|runtime|harness|exclude|db-env):\s*([\w@./,-]+)\s*$/gmi)) {
    if (file.endsWith('.sql') && match[1] !== '--') {
      throw new Error(`TEST_DISCOVERY_SQL_ANNOTATION_COMMENT_INVALID:${file}`);
    }
    annotations.push({ type: match[2].toLowerCase(), value: match[3].trim() });
  }
  return annotations;
}

export const testDiscoveryGroups = Object.freeze(Object.keys(GROUPS));

// Parent catalogs (sql-pgtap/concurrency), focused Node tags and browser matrices
// may intentionally overlap. Each executable test still has one primary runtime.
const PRIMARY_GROUPS = Object.freeze([
  'node-unit', 'node-browser', 'node-ci-integration', 'vitest-mount', 'playwright',
  'deno-tests', 'pglite', 'python', 'sql-rollback', ...Object.keys(RUNTIME_GROUPS),
]);
export function auditTestDiscovery({ root = repositoryRoot, requiredGroups = PRIMARY_GROUPS } = {}) {
  const files = discoverRepositoryFiles({ root });
  const groups = discoverAllTests({ root, files });
  const failures = [];
  for (const group of requiredGroups) if (!groups[group]?.length) failures.push(`empty required group: ${group}`);
  const owners = new Map();
  for (const group of PRIMARY_GROUPS) for (const file of groups[group]) {
    if (!owners.has(file)) owners.set(file, []);
    owners.get(file).push(group);
  }
  for (const [file, executions] of owners) if (executions.length !== 1)
    failures.push(`duplicate execution: ${file}: ${executions.join(', ')}`);
  for (const file of files) {
    if (file.startsWith('supabase/archive_migrations/')) continue; // Migration contracts are independent.
    const candidate = /(?:\.(?:test|spec)\.[a-z]+|_test\.(?:sql|ts)|(?:^|\/)test[_-][^/]+\.(?:mjs|py))$/.test(file);
    if (candidate && !owners.has(file) && !readTestAnnotations({ root, file })
      .some(annotation => annotation.type === 'runtime' && annotation.value === 'discovery-tool')) {
      failures.push(`unclassified test: ${file}`);
    }
  }
  for (const file of [...groups['sql-pgtap'], ...groups.concurrency]) {
    if (!owners.has(file)) failures.push(`unclassified execution environment: ${file}`);
  }
  for (const file of groups['sql-secondary-harness']) {
    if (!owners.has(file)) failures.push(`secondary SQL harness has no primary runtime: ${file}`);
  }
  for (const file of groups.playwright) {
    const tags = readTestAnnotations({ root, file }).filter(annotation => annotation.type === 'group')
      .flatMap(annotation => annotation.value.split(',')).filter(tag => tag.startsWith('@'));
    if (!tags.length) failures.push(`Playwright suite tags required: ${file}`);
    const body = readFileSync(path.join(root, file), 'utf8').replace(/^.*@test-group:.*$/gm, '');
    for (const tag of tags) if (!body.includes(`"${tag}"`) && !body.includes(`'${tag}'`))
      failures.push(`Playwright annotation has no executable tag ${tag}: ${file}`);
  }
  if (failures.length) throw new Error(`TEST_DISCOVERY_AUDIT_FAILED:\n${failures.join('\n')}`);
  return { groups, total: owners.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--audit') {
    const result = auditTestDiscovery();
    console.log(`Test discovery audit passed: ${result.total} tests have one primary runtime.`);
    process.exit(0);
  }
  const json = args.includes('--json');
  const group = args.find(argument => !argument.startsWith('--'));
  if (args.some(argument => argument !== '--json' && argument !== group)) {
    throw new Error('Usage: node scripts/test-discovery.mjs <group> [--json]');
  }
  const files = group ? discoverTests({ group }) : discoverAllTests();
  if (json) process.stdout.write(`${JSON.stringify(files, null, 2)}\n`);
  else if (Array.isArray(files)) for (const file of files) console.log(file);
  else for (const [name, entries] of Object.entries(files)) console.log(`${name}: ${entries.length}`);
}
