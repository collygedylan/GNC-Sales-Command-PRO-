import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packageBin, repoRoot, run, runNode } from './tooling-process.mjs';

function comparablePath(value) {
  const normalized = path.resolve(value).replace(/[\\/]+/g, path.sep);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

const verifiedWorkspaceContainers = new Map();
const verifiedWorkspaceKey = (absolute, projectId, port) => `${comparablePath(absolute)}\0${projectId}\0${port}`;

/** Forget the process-local proof when the disposable runner finishes its stack. */
export function forgetDisposableSupabaseWorkspace(workspaceRoot, projectId) {
  const absolute = path.resolve(workspaceRoot || '');
  const prefix = `${comparablePath(absolute)}\0`;
  let removed = false;
  for (const key of verifiedWorkspaceContainers.keys()) {
    if (key.startsWith(prefix) && (projectId === undefined || key.split('\0')[1] === projectId)) {
      verifiedWorkspaceContainers.delete(key);
      removed = true;
    }
  }
  return removed;
}

function checkedNode(executeNode, args, options, label) {
  const result = executeNode(args, options);
  if (result?.status !== undefined && result.status !== 0) throw new Error(`DISPOSABLE_SUPABASE_${label}_FAILED:${result.status}`);
  return typeof result === 'string' ? result : result?.stdout || '';
}

function checkedCommand(execute, command, args, options, label) {
  const result = execute(command, args, options);
  if (result?.status !== undefined && result.status !== 0) throw new Error(`DISPOSABLE_SUPABASE_${label}_FAILED:${result.status}`);
  return typeof result === 'string' ? result : result?.stdout || '';
}

/**
 * Verify that a workspace belongs to the repository's disposable Supabase CLI project
 * and resolve its database container. Never use a loopback URL alone as ownership proof.
 */
export function inspectDisposableSupabaseWorkspace({ root = repoRoot, workspaceRoot, cli = packageBin('supabase', 'supabase', root),
  execute = run, executeNode = runNode, status, env = process.env } = {}) {
  const absolute = path.resolve(workspaceRoot || '');
  const localTemporaryRoot = comparablePath(path.dirname(absolute)) === comparablePath(os.tmpdir());
  const canonical = localTemporaryRoot && path.basename(absolute).startsWith('gnc-db-workspace-');
  const historical = (localTemporaryRoot && path.basename(absolute).startsWith('gnc-historical-db-workspace-'))
    || (env.GITHUB_ACTIONS === 'true' && env.RUNNER_TEMP
      && comparablePath(absolute) === comparablePath(path.join(env.RUNNER_TEMP, 'gnc-supabase-ci')));
  if (!workspaceRoot || (!canonical && !historical)) {
    throw new Error('DISPOSABLE_SUPABASE_WORKSPACE_REQUIRED');
  }
  const configPath = path.join(absolute, 'supabase', 'config.toml');
  const config = readFileSync(configPath, 'utf8');
  const projectId = config.match(/^project_id\s*=\s*"([\w-]+)"\s*$/m)?.[1];
  const dbSection = config.match(/^\[db\]([^[]+)/m)?.[1] || '';
  const configuredPort = Number(dbSection.match(/^port\s*=\s*(\d+)\s*$/m)?.[1]);
  if (!projectId?.startsWith(historical ? 'gnchist' : 'gncdb') || !Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
    throw new Error('DISPOSABLE_SUPABASE_WORKSPACE_CONFIG_INVALID');
  }

  const statusOutput = status || checkedNode(executeNode,
    [cli, '--workdir', absolute, 'status', '--output', 'env'], { root, capture: true }, 'STATUS');
  const dbLine = String(statusOutput).split(/\r?\n/).find(line => /^DB_URL=/.test(line));
  const rawDbUrl = dbLine?.slice('DB_URL='.length).replace(/^"|"$/g, '');
  let dbUrl;
  try { dbUrl = new URL(rawDbUrl); } catch { throw new Error('DISPOSABLE_SUPABASE_DATABASE_URL_INVALID'); }
  const dbHost = dbUrl.hostname.replace(/^\[|\]$/g, '');
  if (!['postgres:', 'postgresql:'].includes(dbUrl.protocol) || dbUrl.username !== 'postgres'
      || !['127.0.0.1', 'localhost', '::1'].includes(dbHost) || Number(dbUrl.port) !== configuredPort
      || dbUrl.pathname !== '/postgres' || !dbUrl.password) {
    throw new Error('DISPOSABLE_SUPABASE_DATABASE_URL_MISMATCH');
  }

  const lookup = checkedCommand(execute, 'docker', ['ps', '--all', '--quiet', '--no-trunc', '--filter', `name=^/supabase_db_${projectId}$`],
    { root, capture: true }, 'CONTAINER_LOOKUP');
  const containers = String(lookup).trim().split(/\r?\n/).filter(Boolean);
  if (containers.length !== 1 || !/^[a-f0-9]{64}$/i.test(containers[0])) {
    throw new Error('DISPOSABLE_SUPABASE_DB_CONTAINER_NOT_UNIQUE');
  }
  const inspection = checkedCommand(execute, 'docker', ['inspect', containers[0]], { root, capture: true }, 'CONTAINER_INSPECT');
  let inspected;
  try { inspected = JSON.parse(inspection)[0]; } catch { throw new Error('DISPOSABLE_SUPABASE_DB_CONTAINER_INSPECT_INVALID'); }
  const labels = inspected?.Config?.Labels || {};
  const portBinding = inspected?.HostConfig?.PortBindings?.['5432/tcp']?.[0];
  const imageId = inspected?.Image;
  if (inspected?.Name !== `/supabase_db_${projectId}`
      || inspected?.Id !== containers[0]
      || labels['com.supabase.cli.project'] !== projectId
      || labels['com.docker.compose.project'] !== projectId
      || !/supabase\/postgres(?::|$)/.test(inspected?.Config?.Image || '')
      || !/^sha256:[a-f0-9]{64}$/i.test(imageId || '')
      || Number(portBinding?.HostPort) !== configuredPort) {
    throw new Error('DISPOSABLE_SUPABASE_DB_CONTAINER_IDENTITY_MISMATCH');
  }
  const key = verifiedWorkspaceKey(absolute, projectId, configuredPort);
  const priorProof = verifiedWorkspaceContainers.get(key);
  const workdirLabel = labels['com.supabase.cli.workdir'];
  if (workdirLabel !== undefined && workdirLabel !== '') {
    if (comparablePath(workdirLabel) !== comparablePath(absolute)) {
      throw new Error('DISPOSABLE_SUPABASE_DB_CONTAINER_IDENTITY_MISMATCH');
    }
  } else if (!priorProof || priorProof.configuredPort !== configuredPort
      || priorProof.image !== inspected.Config.Image || priorProof.imageId !== imageId
      || priorProof.projectId !== projectId || priorProof.containerName !== inspected.Name
      || (priorProof.containerId === containers[0] && !priorProof.missingWorkdirVerified)) {
    throw new Error('DISPOSABLE_SUPABASE_DB_CONTAINER_IDENTITY_MISMATCH');
  }
  verifiedWorkspaceContainers.set(key, {
    projectId,
    configuredPort,
    containerId: containers[0],
    containerName: inspected.Name,
    image: inspected.Config.Image,
    imageId,
    missingWorkdirVerified: !workdirLabel || workdirLabel === '',
  });
  return { absolute, configPath, projectId, containerId: containers[0], dbUrl, configuredPort };
}
