import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generatedBuildOutput } from './local-validation-evidence.mjs';
import { discoverAllTests, discoverRepositoryFiles, readTestAnnotations } from './test-discovery.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = root;

function matches(pattern, file) {
  if (pattern.endsWith('/**')) return file === pattern.slice(0, -3) || file.startsWith(pattern.slice(0, -2));
  return file === pattern;
}

function normalizedAbsolute(file) { return path.resolve(file).replaceAll('\\', '/').toLowerCase(); }

function importTargets(importer, specifier, root) {
  if (!specifier.startsWith('.')) return [];
  const base = path.resolve(root, path.dirname(importer), specifier);
  const extensions = ['', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.json'];
  const targets = new Set(extensions.map(extension => normalizedAbsolute(`${base}${extension}`)));
  for (const extension of ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']) {
    targets.add(normalizedAbsolute(path.join(base, `index${extension}`)));
  }
  return [...targets];
}

function importedByTests(changedFiles, repositoryFiles, testFiles, root) {
  const importersByTarget = new Map();
  const sourceFiles = repositoryFiles.filter(file => /\.[cm]?[jt]sx?$/.test(file));
  for (const importer of sourceFiles) {
    const absolute = path.join(root, importer);
    let source;
    try { source = readFileSync(absolute, 'utf8'); } catch { continue; }
    const specifiers = new Set();
    const expression = /\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(expression)) specifiers.add(match[1]);
    for (const specifier of specifiers) {
      for (const target of importTargets(importer, specifier, root)) {
        if (!importersByTarget.has(target)) importersByTarget.set(target, new Set());
        importersByTarget.get(target).add(importer);
      }
    }
  }
  const visited = new Set();
  const queue = changedFiles.map(file => normalizedAbsolute(path.join(root, file)));
  while (queue.length) {
    const target = queue.shift();
    if (visited.has(target)) continue;
    visited.add(target);
    for (const importer of importersByTarget.get(target) || []) {
      const importerPath = normalizedAbsolute(path.join(root, importer));
      if (!visited.has(importerPath)) queue.push(importerPath);
    }
  }
  return testFiles.filter(file => visited.has(normalizedAbsolute(path.join(root, file))));
}

/**
 * Resolve staged/changed paths to discovered tests. Module path entries may point
 * at representative regression tests, but test execution itself is discovered
 * from runner conventions so newly-added tests cannot disappear from CI.
 */
export function selectAffectedTests(changedFiles, { root, map } = {}) {
  const files = [...new Set(changedFiles.map(file => String(file).replaceAll('\\', '/')).filter(Boolean))].sort();
  const impact = map || JSON.parse(readFileSync(path.join(root || repositoryRoot, 'live-src/change-impact.json'), 'utf8'));
  if (impact.schemaVersion !== 'gnc-change-impact-v1') throw new Error('Unsupported change-impact schema.');
  const absoluteRoot = root || repositoryRoot;
  const repositoryFiles = discoverRepositoryFiles({ root: absoluteRoot });
  const groups = discoverAllTests({ root: absoluteRoot, files: repositoryFiles });
  const discovered = new Set(Object.values(groups).flat());
  const modules = impact.modules.filter(module => files.some(file => module.paths.some(pattern => matches(pattern, file))));
  const mappedTests = new Set();
  for (const module of modules) {
    for (const pattern of module.paths) {
      if (pattern.endsWith('/**')) {
        const prefix = pattern.slice(0, -2);
        for (const testFile of discovered) if (testFile.startsWith(prefix)) mappedTests.add(testFile);
      }
    }
    for (const testFile of discovered) {
      if (readTestAnnotations({ root: absoluteRoot, file: testFile }).some(annotation => annotation.type === 'group'
        && annotation.value.split(',').map(value => value.trim()).includes(module.id))) mappedTests.add(testFile);
    }
  }
  for (const file of files) if (discovered.has(file)) mappedTests.add(file);
  for (const testFile of importedByTests(files, repositoryFiles,
    [...groups['node-unit'], ...groups['vitest-mount']], absoluteRoot)) mappedTests.add(testFile);

  const deleted = files.filter(file => !existsSync(path.join(absoluteRoot, file)));
  const unknown = files.filter(file => !impact.modules.some(module => module.paths.some(pattern => matches(pattern, file)))
    && !discovered.has(file) && !/^(?:docs\/|README\.md$|\.gitignore$)/.test(file));
  const shared = files.some(file => /^(?:index\.html$|package(?:-lock)?\.json$|(?:tsconfig|vite\.|eslint\.|lint-staged\.)|\.github\/|\.husky\/|services\/database)/.test(file));
  const broadFallback = shared || unknown.some(file => /\.(?:[cm]?[jt]sx?|html|css|json|ya?ml|toml|gs)$/.test(file))
    || (modules.length > 0 && mappedTests.size === 0 && files.some(file => /\.(?:[cm]?[jt]sx?|html|css|json|ya?ml|toml|gs)$/.test(file)));
  const docsOnly = files.length > 0 && files.every(file => /^(?:docs\/|README\.md$|\.gitignore$)/.test(file));
  const selected = docsOnly ? new Set() : broadFallback ? new Set([...groups['node-unit'], ...groups['vitest-mount']]) : mappedTests;
  const nodeUnit = [...selected].filter(file => groups['node-unit'].includes(file)).sort();
  const vitest = [...selected].filter(file => groups['vitest-mount'].includes(file)).sort();
  const deno = new Set();
  if (files.some(file => file.startsWith('supabase/functions/'))) {
    groups['deno-tests'].forEach(file => deno.add(file));
  }
  const sql = files.some(file => file.startsWith('supabase/migrations/') || file.startsWith('supabase/tests/'))
    ? groups['sql-pgtap'] : [];
  const playwright = [...selected].filter(file => groups.playwright.includes(file)).sort();
  const playwrightTags = [...new Set(playwright.flatMap(file => readTestAnnotations({ root: absoluteRoot, file })
    .filter(annotation => annotation.type === 'group').flatMap(annotation => annotation.value.split(',').map(value => value.trim()))
    .filter(value => value.startsWith('@'))))].sort();
  const requiresLocalDb = files.some(file => /\.sql$/.test(file)
    || file.startsWith('supabase/migrations/')
    || file.startsWith('supabase/tests/')
    || file.startsWith('supabase/ci/') && /(?:pglite|concurrency)/.test(file))
    || files.some(file => groups['canonical-http'].includes(file))
    || playwrightTags.includes('@database');
  return {
    files, modules: modules.map(module => module.id), unknown, deleted,
    nodeUnit, vitest, playwright, playwrightTags, deno: [...deno].sort(), sql,
    pglite: files.some(file => file.startsWith('supabase/ci/')) ? groups.pglite : [],
    postgresRuntime: files.some(file => file.startsWith('supabase/ci/')) ? groups['postgres-runtime'] : [],
    concurrency: files.some(file => file.startsWith('supabase/ci/') || file.startsWith('scripts/test-')) ? groups.concurrency : [],
    postgresConcurrency: files.some(file => file.startsWith('supabase/ci/') || file.startsWith('scripts/test-')) ? groups['postgres-concurrency'] : [],
    sqlIsolatedSupabase: files.some(file => file.startsWith('supabase/migrations/') || file.startsWith('supabase/tests/')) ? groups['sql-isolated-supabase'] : [],
    sqlIsolatedAcceptance: files.some(file => file.startsWith('supabase/migrations/') || file.startsWith('supabase/tests/')) ? groups['sql-isolated-acceptance'] : [],
    python: files.some(file => file.endsWith('.py')) ? groups.python : [],
    requiresLocalDb,
  };
}

export function changedFilesFromGit(cwd = root, base = 'origin/main') {
  const read = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean);
  let mergeBase;
  try { mergeBase = execFileSync('git', ['merge-base', base, 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch {
    const remotes = execFileSync('git', ['remote'], { cwd, encoding: 'utf8' }).trim().split(/\r?\n/);
    if (base !== 'origin/main' || remotes.includes('origin')) throw new Error('FOCUSED_BASE_UNAVAILABLE: fetch origin/main before selecting committed changes.');
    mergeBase = 'HEAD';
  }
  const files = [...new Set([
    ...read(['diff', '--name-only', '-z', '--no-renames', '--relative', mergeBase]),
    ...read(['ls-files', '-z', '--others', '--exclude-standard']),
  ])];
  return files.filter(file => {
    if (generatedBuildOutput(file)) return false;
    if (!releaseMarkerFiles.has(file)) return true;
    try {
      const before = execFileSync('git', ['show', `${mergeBase}:${file}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 });
      return !releaseMarkerOnly(file, before, readFileSync(path.join(cwd, file), 'utf8'));
    } catch { return true; }
  });
}

const releaseMarkerFiles = new Set(['package.json', 'package-lock.json', 'index.html', 'manifest.json', 'sw.js', 'scripts/build-live-shell.mjs']);
export function releaseMarkerOnly(file, before, after) {
  if (!releaseMarkerFiles.has(file)) return false;
  if (file === 'package.json' || file === 'package-lock.json') {
    const old = JSON.parse(before), next = JSON.parse(after);
    if (!/^\d{4}\.\d{2}\.\d{2}\.\d{2,3}$/.test(old.version) || !/^\d{4}\.\d{2}\.\d{2}\.\d{2,3}$/.test(next.version)) return false;
    old.version = next.version;
    if (file === 'package-lock.json') old.packages[''].version = next.packages[''].version;
    return JSON.stringify(old) === JSON.stringify(next);
  }
  const markers = {
    'index.html': /window\.__APP_SHELL_VERSION__\s*=\s*['"]([^'"]+)['"]/,
    'manifest.json': /"version"\s*:\s*"([^"]+)"/,
    'sw.js': /const APP_SHELL_BUILD\s*=\s*['"]([^'"]+)['"]/,
    'scripts/build-live-shell.mjs': /const RELEASE\s*=\s*['"]([^'"]+)['"]/,
  };
  const previous = before.match(markers[file])?.[1], next = after.match(markers[file])?.[1];
  return /^V\d{4}\.\d{2}\.\d{2}\.\d{2,3}$/.test(previous || '') && /^V\d{4}\.\d{2}\.\d{2}\.\d{2,3}$/.test(next || '')
    && before.replaceAll(previous, next).replaceAll('\r\n', '\n') === after.replaceAll('\r\n', '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const json = process.argv.includes('--json');
  const explicit = process.argv.slice(2).filter(argument => argument !== '--json');
  const map = JSON.parse(readFileSync(path.join(root, 'live-src', 'change-impact.json'), 'utf8'));
  if (map.schemaVersion !== 'gnc-change-impact-v1') throw new Error('Unsupported change-impact schema.');
  const result = selectAffectedTests(explicit.length ? explicit : changedFilesFromGit(), { map });
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    console.log(`Affected modules: ${result.modules.join(', ') || 'none mapped'}`);
    if (result.unknown.length) console.log(`Unknown paths: ${result.unknown.join(', ')}`);
    for (const [group, files] of Object.entries({ nodeUnit: result.nodeUnit, vitest: result.vitest, playwright: result.playwright, deno: result.deno, sql: result.sql })) {
      if (files.length) console.log(`${group}: ${files.join(', ')}`);
    }
  }
}
