import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverTests } from './test-discovery.mjs';
import { inspectDisposableSupabaseWorkspace } from './disposable-supabase-container.mjs';
import { packageBin, repoRoot, run, runNode } from './tooling-process.mjs';

function sourceFile(root, file) {
  const rootPath = path.resolve(root);
  const absoluteFile = path.resolve(rootPath, file);
  const relative = path.relative(rootPath, absoluteFile);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('SQL_ROLLBACK_TEST_PATH_INVALID');
  const realFile = realpathSync(absoluteFile);
  const realRelative = path.relative(realpathSync(rootPath), realFile);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative) || !statSync(realFile).isFile()) {
    throw new Error('SQL_ROLLBACK_TEST_PATH_INVALID');
  }
  return { absoluteFile, sql: readFileSync(realFile, 'utf8') };
}

function stripLeadingSqlComments(source) {
  let index = 0;
  while (index < source.length) {
    while (/\s/.test(source[index] || '')) index++;
    if (source.startsWith('--', index)) {
      const newline = source.indexOf('\n', index + 2);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith('/*', index)) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth) {
        if (source.startsWith('/*', index)) { depth++; index += 2; }
        else if (source.startsWith('*/', index)) { depth--; index += 2; }
        else index++;
      }
      if (depth) throw new Error('SQL_ROLLBACK_TEST_COMMENT_UNTERMINATED');
      continue;
    }
    break;
  }
  return source.slice(index);
}

export function validateRollbackTransaction(sql, file = '') {
  const executable = stripLeadingSqlComments(String(sql));
  if (!/^begin\s*;/i.test(executable) || !/\brollback\s*;\s*$/i.test(String(sql).trimEnd())) {
    throw new Error(`SQL_ROLLBACK_TEST_NOT_TRANSACTION_CONTAINED:${file}`);
  }
  return String(sql);
}

/** Execute discovered transaction-contained canaries only in the verified local Supabase DB container. */
export function runSqlRollbackTests({ root = repoRoot, workspaceRoot, cli = packageBin('supabase', 'supabase', root),
  executeNode = runNode, execute = run, inspectWorkspace = inspectDisposableSupabaseWorkspace,
  discover = discoverTests, files } = {}) {
  const workspace = inspectWorkspace({ root, workspaceRoot, cli, execute, executeNode });
  const discoveredFiles = discover({ root, group: 'sql-rollback' });
  const discovered = new Set(discoveredFiles);
  if (files !== undefined && (!Array.isArray(files) || files.some(file => typeof file !== 'string' || !discovered.has(file)))
      || !discoveredFiles.length) {
    throw new Error(files === undefined ? 'SQL_ROLLBACK_TESTS_REQUIRED' : 'SQL_ROLLBACK_TEST_FILE_NOT_DISCOVERED');
  }
  const filesToRun = files === undefined ? discoveredFiles : [...new Set(files)].sort();
  if (!filesToRun.length) throw new Error('SQL_ROLLBACK_TESTS_REQUIRED');
  for (const file of filesToRun) {
    const source = sourceFile(root, file);
    validateRollbackTransaction(source.sql, file);
    try {
      const result = execute('docker', ['exec', '-i', workspace.containerId, 'psql', '-X', '-q', '-v',
        'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'],
      { root, capture: true, input: source.sql });
      if (result?.status !== undefined && result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `psql exited with status ${result.status}`);
      }
    } catch (error) {
      throw new Error(`SQL_ROLLBACK_TEST_FAILED:${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  return { files: filesToRun, projectId: workspace.projectId };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [flag, workspaceRoot] = process.argv.slice(2);
    if (flag !== '--workdir' || !workspaceRoot) throw new Error('Usage: node scripts/run-sql-rollback-tests.mjs --workdir <disposable-database-workspace>');
    const result = runSqlRollbackTests({ workspaceRoot });
    console.log(`Ran ${result.files.length} transaction-contained SQL canaries in disposable project ${result.projectId}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
