import { pathToFileURL } from 'node:url';
import { createDatabaseWorkspace } from './database-workspace.mjs';
import { createSandboxDatabaseWorkspace, sandboxDatabaseTypesPath } from './sandbox-database-workspace.mjs';
import { generateContracts } from './generate-database-contracts.mjs';
import { doctor } from './tooling-doctor.mjs';
import { packageBin, repoRoot, runNode } from './tooling-process.mjs';
import { withDisposableSupabase } from './database-workspace-runner.mjs';
import { generatedDatabaseTypesPath, verifyGeneratedDatabaseTypes, writeGeneratedDatabaseTypes } from './database-type-parts.mjs';

export { generatedDatabaseTypesPath };

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

function generateTypesFromWorkspace({ root, workspace, cli, execute, schemas = ['public'] }) {
  return withDisposableSupabase({ root, workspace, cli, execute, action: runCli => {
    // Both type workspaces are fresh and have empty seed files. Start has
    // already applied the full migration chain and platform privileges.
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

export function runDatabaseTypes({ mode, root = repoRoot, execute = runNode, preflight = doctor } = {}) {
  if (mode !== 'generate' && mode !== 'check') throw new Error('Usage: node scripts/database-types.mjs --generate|--check');
  preflight({ root, database: true });
  const generated = generateTypes({ root, execute });
  const generatedSandbox = generateSandboxTypes({ root, execute });
  if (mode === 'generate') {
    writeGeneratedDatabaseTypes(root, generated);
    writeGeneratedDatabaseTypes(root, generatedSandbox, sandboxDatabaseTypesPath);
    console.log(`Generated ${generatedDatabaseTypesPath} and ${sandboxDatabaseTypesPath} from disposable Supabase local databases.`);
    generateContracts({ root, check: false });
    return true;
  }
  verifyGeneratedDatabaseTypes(root, generated);
  verifyGeneratedDatabaseTypes(root, generatedSandbox, sandboxDatabaseTypesPath);
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
