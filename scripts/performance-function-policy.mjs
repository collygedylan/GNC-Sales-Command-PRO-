import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const POLICY_VALUES = new Set(['oneshot', 'per_worker']);
const CONTAINER_ID = /^[a-f0-9]{64}$/i;
export const PERFORMANCE_API_FUNCTION_POLICY = 'oneshot';

function fail(code) { throw new Error(code); }

function present(pathname) {
  try { return lstatSync(pathname); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function assertPlainPath(pathname, { allowMissing = false } = {}) {
  const absolute = path.resolve(pathname);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    const info = present(current);
    if (!info) {
      if (allowMissing) return;
      fail('PERFORMANCE_FUNCTION_POLICY_PATH_MISSING');
    }
    if (info.isSymbolicLink()) fail('PERFORMANCE_FUNCTION_POLICY_PATH_UNSAFE');
  }
  return absolute;
}

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertStandaloneConfigFile(configPath) {
  assertPlainPath(configPath);
  const info = lstatSync(configPath);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail('PERFORMANCE_FUNCTION_POLICY_CONFIG_UNSAFE');
}

function isDisposableWorkspace(absolute, projectId) {
  const canonical = path.dirname(absolute) === path.resolve(os.tmpdir())
    && path.basename(absolute).startsWith('gnc-db-workspace-')
    && projectId.startsWith('gncdb');
  const runnerTemp = process.env.RUNNER_TEMP;
  const historical = Boolean(runnerTemp)
    && absolute === path.resolve(runnerTemp, 'gnc-supabase-ci')
    && projectId.startsWith('gnchist');
  return canonical || historical;
}

function verifiedConfigPath(verifiedWorkspace, repositoryRoot) {
  if (!verifiedWorkspace || typeof verifiedWorkspace.absolute !== 'string'
      || typeof verifiedWorkspace.configPath !== 'string'
      || typeof verifiedWorkspace.projectId !== 'string'
      || !CONTAINER_ID.test(verifiedWorkspace.containerId || '')) {
    fail('PERFORMANCE_FUNCTION_POLICY_WORKSPACE_UNVERIFIED');
  }
  const absolute = path.resolve(verifiedWorkspace.absolute);
  const configPath = path.resolve(verifiedWorkspace.configPath);
  const expectedConfig = path.join(absolute, 'supabase', 'config.toml');
  if (configPath !== expectedConfig || !isDisposableWorkspace(absolute, verifiedWorkspace.projectId)) {
    fail('PERFORMANCE_FUNCTION_POLICY_WORKSPACE_UNVERIFIED');
  }
  const repository = path.resolve(repositoryRoot || '');
  if (!repositoryRoot || absolute === repository || inside(repository, absolute) || inside(absolute, repository)) {
    fail('PERFORMANCE_FUNCTION_POLICY_WORKSPACE_UNSAFE');
  }
  assertPlainPath(repository);
  assertPlainPath(absolute);
  assertStandaloneConfigFile(configPath);
  const configBytes = readFileSync(configPath);
  let configText;
  try { configText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(configBytes); }
  catch { fail('PERFORMANCE_FUNCTION_POLICY_CONFIG_ENCODING_INVALID'); }
  const projectMatch = [...configText.matchAll(/^(?:\uFEFF)?[ \t]*project_id[ \t]*=[ \t]*"([\w-]+)"[ \t]*(?:#.*)?\r?$/gm)];
  if (projectMatch.length !== 1 || projectMatch[0][1] !== verifiedWorkspace.projectId) {
    fail('PERFORMANCE_FUNCTION_POLICY_CONFIG_IDENTITY_MISMATCH');
  }
  return { configPath, configText, configBytes };
}

function parsePolicyLine(line) {
  const match = /^([ \t]*policy[ \t]*=[ \t]*)(["'])(oneshot|per_worker)\2([ \t]*(?:#.*)?)(\r?\n?)$/.exec(line);
  return match ? { prefix: match[1], quote: match[2], value: match[3], suffix: match[4], newline: match[5] } : null;
}

function findPolicy(text) {
  const lines = text.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) || [];
  const sections = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^[ \t]*\[([^\]\r\n]+)\][ \t]*(?:#.*)?\r?\n?$/.exec(lines[index]);
    if (match) sections.push({ name: match[1].trim(), index });
  }
  const edgeSections = sections.filter(section => section.name === 'edge_runtime');
  if (edgeSections.length !== 1) fail('PERFORMANCE_FUNCTION_POLICY_SECTION_INVALID');
  const edge = edgeSections[0];
  const nextSection = sections.find(section => section.index > edge.index);
  const end = nextSection?.index ?? lines.length;
  const policyAssignments = [];
  for (let index = edge.index + 1; index < end; index += 1) {
    if (/^[ \t]*policy[ \t]*=/.test(lines[index])) policyAssignments.push({ index, parsed: parsePolicyLine(lines[index]) });
  }
  if (policyAssignments.length !== 1 || !policyAssignments[0].parsed
      || !POLICY_VALUES.has(policyAssignments[0].parsed.value)) {
    fail('PERFORMANCE_FUNCTION_POLICY_VALUE_INVALID');
  }
  return { lines, lineIndex: policyAssignments[0].index, policy: policyAssignments[0].parsed.value,
    parsed: policyAssignments[0].parsed };
}

function readVerifiedPolicy(verifiedWorkspace, repositoryRoot) {
  const { configPath, configText, configBytes } = verifiedConfigPath(verifiedWorkspace, repositoryRoot);
  const parsed = findPolicy(configText);
  return { configPath, configText, configBytes, ...parsed };
}

/** Confirm a verified disposable workspace still has the required server policy before spawn. */
export function assertPerformanceFunctionPolicy(verifiedWorkspace, repositoryRoot, expectedPolicy = 'oneshot') {
  if (!POLICY_VALUES.has(expectedPolicy)) fail('PERFORMANCE_FUNCTION_POLICY_VALUE_INVALID');
  const current = readVerifiedPolicy(verifiedWorkspace, repositoryRoot);
  if (current.policy !== expectedPolicy) fail('PERFORMANCE_FUNCTION_POLICY_MISMATCH');
  return current.policy;
}

/** Temporarily set a policy in a verified disposable workspace and return exact-byte restoration. */
export function setPerformanceFunctionPolicy(verifiedWorkspace, repositoryRoot, policy = 'oneshot') {
  if (!POLICY_VALUES.has(policy)) fail('PERFORMANCE_FUNCTION_POLICY_VALUE_INVALID');
  const original = readVerifiedPolicy(verifiedWorkspace, repositoryRoot);
  const replacement = `${original.parsed.prefix}${original.parsed.quote}${policy}${original.parsed.quote}${original.parsed.suffix}${original.parsed.newline}`;
  const nextLines = original.lines.slice();
  nextLines[original.lineIndex] = replacement;
  const nextText = nextLines.join('');
  const nextBytes = Buffer.from(nextText, 'utf8');
  try {
    assertStandaloneConfigFile(original.configPath);
    writeFileSync(original.configPath, nextBytes);
    const configured = readVerifiedPolicy(verifiedWorkspace, repositoryRoot);
    if (configured.policy !== policy || configured.configText !== nextText) fail('PERFORMANCE_FUNCTION_POLICY_SET_FAILED');
  } catch (error) {
    assertStandaloneConfigFile(original.configPath);
    writeFileSync(original.configPath, original.configBytes);
    if (!readFileSync(original.configPath).equals(original.configBytes)) fail('PERFORMANCE_FUNCTION_POLICY_RESTORE_FAILED');
    throw error;
  }
  let restored = false;
  return function restorePerformanceFunctionPolicy() {
    if (restored) return false;
    assertStandaloneConfigFile(original.configPath);
    writeFileSync(original.configPath, original.configBytes);
    const restoredBytes = readFileSync(original.configPath);
    if (!restoredBytes.equals(original.configBytes)) fail('PERFORMANCE_FUNCTION_POLICY_RESTORE_FAILED');
    restored = true;
    return true;
  };
}

