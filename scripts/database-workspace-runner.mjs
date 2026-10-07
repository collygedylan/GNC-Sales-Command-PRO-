import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot, run } from './tooling-process.mjs';
import { forgetDisposableSupabaseWorkspace, inspectDisposableSupabaseWorkspace } from './disposable-supabase-container.mjs';
import { sqlStatements } from './database-catalog.mjs';

export const localSupabaseExcludeServices = 'gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor';
const errorText = error => error instanceof Error ? error.message : String(error);

/** Run and clean up one isolated Supabase stack, failing closed on cleanup errors. */
export function withDisposableSupabase({ root = repoRoot, workspace, cli, execute, executeDocker = run,
  inspectWorkspace = inspectDisposableSupabaseWorkspace, action }) {
  let startAttempted = false;
  let result;
  let failure;
  const applyPlatformPrivileges = () => {
    if (!workspace.platformPrivilegeSqlPath) return;
    const expectedPath = path.resolve(workspace.root, 'platform-admin-default-privileges.sql');
    if (path.resolve(workspace.platformPrivilegeSqlPath) !== expectedPath) {
      throw new Error('DATABASE_PLATFORM_PRIVILEGE_SIDECAR_PATH_INVALID');
    }
    const sql = readFileSync(expectedPath, 'utf8');
    const statements = sqlStatements(sql).map(statement => statement.replace(/--[^\r\n]*/g, '').trim()).filter(Boolean);
    if (statements.length === 0 || statements.some(statement =>
      !/^ALTER\s+DEFAULT\s+PRIVILEGES\s+FOR\s+ROLE\s+supabase_admin\b/i.test(statement))) {
      throw new Error('DATABASE_PLATFORM_PRIVILEGE_SIDECAR_CONTENT_INVALID');
    }
    const verified = inspectWorkspace({ root, workspaceRoot: workspace.root, cli, execute: executeDocker, executeNode: execute });
    executeDocker('docker', ['exec', '-i', verified.containerId, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
      { root, capture: true, input: `BEGIN;\n${sql}\nCOMMIT;\n` });
  };
  const runCli = (args, options = {}) => {
    const output = execute([cli, '--workdir', workspace.root, ...args], { root, ...options });
    if (args[0] === 'start' && workspace.verifyContainer) {
      inspectWorkspace({ root, workspaceRoot: workspace.root, cli, execute: executeDocker, executeNode: execute });
    }
    if (args[0] === 'start' || (args[0] === 'db' && args[1] === 'reset')) applyPlatformPrivileges();
    return output;
  };
  try {
    startAttempted = true;
    runCli(['start', '--exclude', localSupabaseExcludeServices]);
    result = action(runCli);
  } catch (error) {
    failure = error;
  }

  const cleanupErrors = [];
  let stackStopped = !startAttempted;
  if (startAttempted) {
    try { runCli(['stop', '--no-backup']); stackStopped = true; }
    catch (error) { cleanupErrors.push(`stop: ${errorText(error)}`); }
  }
  forgetDisposableSupabaseWorkspace(workspace.root, workspace.projectId);
  if (stackStopped) {
    try { workspace.dispose(); }
    catch (error) { cleanupErrors.push(`dispose: ${errorText(error)}`); }
  } else cleanupErrors.push(`workspace retained at ${workspace.root} because the stack did not stop`);

  if (failure) {
    if (cleanupErrors.length) {
      const message = errorText(failure);
      throw new Error(`${message}; disposable DB cleanup failed (${cleanupErrors.join('; ')})`, { cause: failure });
    }
    throw failure;
  }
  if (cleanupErrors.length) throw new Error(`DATABASE_STACK_CLEANUP_FAILED:${cleanupErrors.join('; ')}`);
  return result;
}
