import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Inspect only the graph reached by the entry workflow, not every YAML file in
// the repository. This keeps moved assertions meaningful: unlinking a required
// reusable workflow/action removes its source from the inspected release.
export function readReleaseWorkflowSources(entry, { root = repositoryRoot } = {}) {
  const base = fs.realpathSync(root);
  const files = [];
  const visited = new Set();
  function read(relative) {
    let filename = path.resolve(base, relative);
    const info = fs.statSync(filename); // Missing referenced sources must fail.
    if (info.isDirectory()) {
      filename = ['action.yml', 'action.yaml'].map(name => path.join(filename, name))
        .find(candidate => fs.existsSync(candidate));
      if (!filename) throw new Error(`RELEASE_ACTION_SOURCE_MISSING: ${relative}`);
    }
    const resolved = fs.realpathSync(filename);
    const relativePath = path.relative(base, resolved);
    if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      throw new Error(`RELEASE_WORKFLOW_SOURCE_OUTSIDE_REPOSITORY: ${relative}`);
    }
    if (visited.has(resolved)) return;
    visited.add(resolved);
    const source = fs.readFileSync(resolved, 'utf8');
    files.push({ path: relativePath.split(path.sep).join('/'), source });
    if (/\.ya?ml$/i.test(resolved)) {
      for (const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*(['"]?)(\.\/\.github\/[^\s'"#]+)\1\s*(?:#.*)?$/gm)) {
        read(match[2]);
      }
      // The build now delegates static packaging/fingerprinting to this script.
      // Follow it only when an actual reachable run command invokes it.
      if (/(?:^\s*(?:-\s*)?run:\s*|^\s+)node\s+scripts\/prepare-release-site\.mjs(?:\s|$)/m.test(source)) {
        read('scripts/prepare-release-site.mjs');
      }
    }
  }
  read(entry instanceof URL ? path.relative(base, fileURLToPath(entry)) : entry);
  return { files, text: files.map(file => `\n# source: ${file.path}\n${file.source}`).join('\n') };
}
