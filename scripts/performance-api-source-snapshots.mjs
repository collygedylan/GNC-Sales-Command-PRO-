import { cpSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

export const PERFORMANCE_API_SOURCE_DIRECTORIES = Object.freeze(['supabase/functions', 'services', 'utils']);

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function overlaps(left, right) {
  return left === right || inside(left, right) || inside(right, left);
}

function assertNoReparseAncestors(target, allowMissing = false) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const segment of ['', ...segments]) {
    if (segment) current = path.join(current, segment);
    const info = lstatIfPresent(current);
    if (!info) {
      if (allowMissing) return;
      throw new Error('PERFORMANCE_SOURCE_PATH_MISSING');
    }
    if (info.isSymbolicLink()) throw new Error('PERFORMANCE_SOURCE_PATH_UNSAFE');
  }
}

/** Validate the three independent roots before any copy, rename, or recursive removal. */
export function validatePerformanceApiRoots({ workspaceRoot, repositoryRoot, candidateRoot }) {
  const workspace = path.resolve(workspaceRoot);
  const repository = path.resolve(repositoryRoot);
  const candidate = path.resolve(candidateRoot);
  if (overlaps(workspace, repository) || overlaps(workspace, candidate) || overlaps(repository, candidate)) {
    throw new Error('PERFORMANCE_SOURCE_ROOT_INVALID');
  }
  assertNoReparseAncestors(workspace);
  assertNoReparseAncestors(repository);
  assertNoReparseAncestors(path.dirname(candidate));
  if (lstatIfPresent(candidate)) assertNoReparseAncestors(candidate);
  return { workspace, repository, candidate };
}

function assertPlainTree(root) {
  const info = lstatSync(root);
  if (info.isSymbolicLink()) throw new Error('PERFORMANCE_SOURCE_PATH_UNSAFE');
  if (info.isDirectory()) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('PERFORMANCE_SOURCE_PATH_UNSAFE');
      assertPlainTree(path.join(root, entry.name));
    }
    return;
  }
  if (!info.isFile()) throw new Error('PERFORMANCE_SOURCE_PATH_UNSAFE');
}

export function assertPerformanceApiTree(root) {
  assertPlainTree(path.resolve(root));
}

export function assertPerformanceApiPath(target) {
  assertNoReparseAncestors(path.resolve(target), true);
}

function lstatIfPresent(target) {
  try { return lstatSync(target); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function checkedDirectory(root, relative, code) {
  const target = path.resolve(root, relative);
  if (!inside(path.resolve(root), target)) throw new Error(code);
  assertPerformanceApiPath(target);
  return target;
}

/** Preserve existing disposable source trees, or stage current sources when canonical workspaces omit them. */
export function stagePerformanceApiSources({ workspaceRoot, repositoryRoot, candidateRoot }) {
  const { workspace, repository, candidate } = validatePerformanceApiRoots({ workspaceRoot, repositoryRoot, candidateRoot });
  if (lstatIfPresent(candidate)) throw new Error('PERFORMANCE_CANDIDATE_SOURCE_DESTINATION_NOT_EMPTY');
  mkdirSync(candidate, { recursive: true });
  const originallyPresent = [];
  const changed = [];
  try {
    for (const relative of PERFORMANCE_API_SOURCE_DIRECTORIES) {
      const target = checkedDirectory(workspace, relative, 'PERFORMANCE_SOURCE_PATH_UNSAFE');
      const saved = checkedDirectory(candidate, relative, 'PERFORMANCE_SOURCE_PATH_UNSAFE');
      const targetParent = path.dirname(target);
      const parentInfo = lstatSync(targetParent);
      if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error('PERFORMANCE_SOURCE_PATH_UNSAFE');
      mkdirSync(path.dirname(saved), { recursive: true });
      if (lstatIfPresent(target)) {
        assertPlainTree(target);
        renameSync(target, saved);
        originallyPresent.push(relative);
        changed.push(relative);
      } else {
        const current = checkedDirectory(repository, relative, 'PERFORMANCE_SOURCE_PATH_UNSAFE');
        assertPlainTree(current);
        cpSync(current, saved, { recursive: true, errorOnExist: true, force: false });
        changed.push(relative);
      }
    }
    return { workspace, repository, candidateRoot: candidate, originallyPresent };
  } catch (error) {
    for (const relative of changed.reverse()) {
      const target = checkedDirectory(workspace, relative, 'PERFORMANCE_SOURCE_PATH_UNSAFE');
      const saved = checkedDirectory(candidate, relative, 'PERFORMANCE_SOURCE_PATH_UNSAFE');
      if (originallyPresent.includes(relative) && lstatIfPresent(saved)) renameSync(saved, target);
      else if (lstatIfPresent(saved)) rmSync(saved, { recursive: true, force: false });
    }
    assertPerformanceApiPath(candidate);
    if (lstatIfPresent(candidate)) {
      assertPlainTree(candidate);
      rmSync(candidate, { recursive: true, force: false });
    }
    throw error;
  }
}

/** Remove only known source roots from a verified benchmark workspace. */
export function clearPerformanceApiSources({ workspaceRoot, repositoryRoot, candidateRoot }) {
  const { workspace } = validatePerformanceApiRoots({ workspaceRoot, repositoryRoot, candidateRoot });
  for (const relative of PERFORMANCE_API_SOURCE_DIRECTORIES) {
    const target = checkedDirectory(workspace, relative, 'PERFORMANCE_SOURCE_PATH_UNSAFE');
    if (!lstatIfPresent(target)) continue;
    assertPlainTree(target);
    rmSync(target, { recursive: true, force: false });
  }
}

/** Remove staged benchmark sources and put back any directories that existed before staging. */
export function restorePerformanceApiSources(snapshot) {
  if (!snapshot || typeof snapshot.workspace !== 'string' || typeof snapshot.repository !== 'string' || typeof snapshot.candidateRoot !== 'string'
      || !Array.isArray(snapshot.originallyPresent)) throw new Error('PERFORMANCE_SOURCE_SNAPSHOT_INVALID');
  const { workspace, candidate } = validatePerformanceApiRoots({
    workspaceRoot: snapshot.workspace,
    repositoryRoot: snapshot.repository,
    candidateRoot: snapshot.candidateRoot,
  });
  if (snapshot.originallyPresent.some(relative => !PERFORMANCE_API_SOURCE_DIRECTORIES.includes(relative))) {
    throw new Error('PERFORMANCE_SOURCE_SNAPSHOT_INVALID');
  }
  for (const relative of PERFORMANCE_API_SOURCE_DIRECTORIES) {
    const target = checkedDirectory(workspace, relative, 'PERFORMANCE_SOURCE_PATH_UNSAFE');
    const saved = checkedDirectory(candidate, relative, 'PERFORMANCE_SOURCE_PATH_UNSAFE');
    if (lstatIfPresent(target)) {
      assertPlainTree(target);
      rmSync(target, { recursive: true, force: false });
    }
    if (snapshot.originallyPresent.includes(relative)) {
      assertPlainTree(saved);
      mkdirSync(path.dirname(target), { recursive: true });
      renameSync(saved, target);
    } else if (lstatIfPresent(saved)) {
      assertPlainTree(saved);
      rmSync(saved, { recursive: true, force: false });
    }
  }
  if (lstatIfPresent(candidate)) {
    assertPlainTree(candidate);
    rmSync(candidate, { recursive: true, force: false });
  }
}
