import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabaseWorkspace } from './database-workspace.mjs';
import { createSandboxDatabaseWorkspace, sandboxDatabaseTypesPath } from './sandbox-database-workspace.mjs';
import { generateContracts } from './generate-database-contracts.mjs';
import { doctor } from './tooling-doctor.mjs';
import { packageBin, repoRoot, runNode } from './tooling-process.mjs';
import { withDisposableSupabase } from './database-workspace-runner.mjs';

export const generatedDatabaseTypesPath = 'supabase/functions/_shared/database.types.ts';

const isPgMetaEcrRateLimit = error => {
  const message = error instanceof Error ? error.message : String(error);
  return /public\.ecr\.aws\/supabase\/postgres-meta(?::|\s)/i.test(message)
    && /(?:toomanyrequests|rate exceeded|too many requests)/i.test(message);
};

/** Retry only the CLI's known ECR throttling failure, using its supported GHCR override. */
export function runLocalTypesCommand(runCli, args) {
  const options = { capture: true };
  try {
    return runCli(args, options);
  } catch (error) {
    if (!isPgMetaEcrRateLimit(error)) throw error;
    console.warn('[database-types] ECR rate limited postgres-meta; retrying type generation once through GHCR.');
    return runCli(args, { ...options, env: { SUPABASE_INTERNAL_IMAGE_REGISTRY: 'ghcr.io' } });
  }
}

export { sandboxDatabaseTypesPath };

function firstDifference(left, right) {
  let index = 0;
  const limit = Math.min(left.length, right.length);
  while (index < limit && left[index] === right[index]) index += 1;
  const line = left.slice(0, index).split('\n').length;
  return { line, index, expectedLength: left.length, actualLength: right.length };
}

function generateTypesFromWorkspace({ root, workspace, cli, execute, schemas = ['public'] }) {
  return withDisposableSupabase({ root, workspace, cli, execute, action: runCli => {
    runCli(['db', 'reset', '--local', '--no-seed']);
    const output = runLocalTypesCommand(runCli, ['gen', 'types', '--local', '--schema', schemas.join(','), '--lang', 'typescript']);
    if (!output.includes('export type Database =')) throw new Error('DATABASE_TYPES_GENERATION_EMPTY');
    return output;
  }});
}

function generateTypes({ root = repoRoot, cli = packageBin('supabase', 'supabase', root), execute = runNode } = {}) {
  return generateTypesFromWorkspace({ root, workspace: createDatabaseWorkspace({ root }), cli, execute });
}

export function generateSandboxTypes({ root = repoRoot, cli = packageBin('supabase', 'supabase', root), execute = runNode } = {}) {
  const workspace = createSandboxDatabaseWorkspace({ root });
  return generateTypesFromWorkspace({ root, workspace, cli, execute, schemas: ['public'] });
}

function assertArtifactMatches({ root, relativePath, expected, label }) {
  const target = path.join(root, relativePath);
  const committed = readFileSync(target, 'utf8');
  if (committed !== expected && committed !== `${expected}\n`) {
    const difference = firstDifference(committed, expected);
    throw new Error(`${label}_OUT_OF_DATE at line ${difference.line} (checked-in ${difference.expectedLength} chars; local generated ${difference.actualLength} chars). Run npm run types:db:generate and review the schema diff.`);
  }
}

export function runDatabaseTypes({ mode, root = repoRoot, execute = runNode, preflight = doctor } = {}) {
  if (mode !== 'generate' && mode !== 'check') throw new Error('Usage: node scripts/database-types.mjs --generate|--check');
  preflight({ root, database: true });
  const generated = generateTypes({ root, execute });
  const generatedSandbox = generateSandboxTypes({ root, execute });
  if (mode === 'generate') {
    for (const [relativePath, output] of [[generatedDatabaseTypesPath, generated], [sandboxDatabaseTypesPath, generatedSandbox]]) {
      const target = path.join(root, relativePath);
      writeFileSync(target, output.endsWith('\n') ? output : `${output}\n`);
    }
    console.log(`Generated ${generatedDatabaseTypesPath} and ${sandboxDatabaseTypesPath} from disposable Supabase local databases.`);
    generateContracts({ root, check: false });
    return true;
  }
  assertArtifactMatches({ root, relativePath: generatedDatabaseTypesPath, expected: generated, label: 'DATABASE_TYPES' });
  assertArtifactMatches({ root, relativePath: sandboxDatabaseTypesPath, expected: generatedSandbox, label: 'SANDBOX_DATABASE_TYPES' });
  generateContracts({ root, check: true });
  console.log(`Verified ${generatedDatabaseTypesPath} and ${sandboxDatabaseTypesPath} against disposable Supabase local databases.`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3 || !['--generate', '--check'].includes(process.argv[2])) {
      throw new Error('Usage: node scripts/database-types.mjs --generate|--check');
    }
    runDatabaseTypes({ mode: process.argv[2] === '--generate' ? 'generate' : 'check' });
  } catch (error) {
    console.error(`[database-types] ${error.message}`);
    process.exitCode = 1;
  }
}
