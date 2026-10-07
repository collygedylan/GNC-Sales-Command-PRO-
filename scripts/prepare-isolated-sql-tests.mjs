import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverTests } from './test-discovery.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export function prepareIsolatedSqlTests({ root = repositoryRoot, destination, testFiles, discover = discoverTests } = {}) {
  if (!destination) throw new Error('SQL_TEST_DESTINATION_REQUIRED');
  const absoluteRoot = path.resolve(root);
  const absoluteDestination = path.resolve(destination);
  const discoveredDirect = discover({ root: absoluteRoot, group: 'sql-isolated-supabase' });
  const discoveredAcceptance = discover({ root: absoluteRoot, group: 'sql-isolated-acceptance' });
  if (!discoveredDirect.length) throw new Error('SQL_ISOLATED_SUPABASE_TESTS_REQUIRED');
  if (!discoveredAcceptance.length) throw new Error('SQL_ISOLATED_ACCEPTANCE_TESTS_REQUIRED');
  const all = new Set([...discoveredDirect, ...discoveredAcceptance]);
  if (testFiles !== undefined && (!Array.isArray(testFiles) || testFiles.some(file => typeof file !== 'string' || !all.has(file)))) {
    throw new Error('SQL_TEST_SELECTION_INVALID');
  }
  const selected = testFiles === undefined ? all : new Set(testFiles);
  const direct = [...selected].filter(file => discoveredDirect.includes(file)).sort();
  const acceptance = [...selected].filter(file => discoveredAcceptance.includes(file)).sort();
  if (testFiles !== undefined && selected.size === 0) throw new Error('SQL_TEST_SELECTION_EMPTY');
  if (direct.length) copyFiles({ root: absoluteRoot, destination: absoluteDestination, files: direct });
  if (acceptance.length) copyFiles({ root: absoluteRoot, destination: absoluteDestination, files: acceptance });
  return { direct, acceptance };
}

function copyFiles({ root, destination, files }) {
  mkdirSync(destination, { recursive: true });
  for (const file of files) {
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('SQL_TEST_PATH_OUTSIDE_REPOSITORY');
    cpSync(absolute, path.join(destination, path.basename(file)));
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const destination = process.argv[2];
    const result = prepareIsolatedSqlTests({ destination });
    console.log(`Prepared ${result.direct.length} direct and ${result.acceptance.length} acceptance SQL tests.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
