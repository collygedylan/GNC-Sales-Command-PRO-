import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { readGitBlobs } from '../../scripts/git-batch-blobs.mjs';

export function runtimeSyntaxCounts(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  let declarations = 0;
  let emptyCatches = 0;
  const visit = node => {
    if (ts.isFunctionDeclaration(node)) declarations++;
    if (ts.isCatchClause(node) && node.block.statements.length === 0) emptyCatches++;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return { declarations, emptyCatches };
}

function validEventBase(eventPath) {
  const event = eventPath ? JSON.parse(readFileSync(eventPath, 'utf8')) : null;
  const base = event?.pull_request?.base?.sha || event?.before;
  return /^[a-f0-9]{40}$/.test(base || '') && !/^0+$/.test(base) ? base : '';
}

export async function previousRuntimeSources(root, files, eventPath = process.env.GITHUB_EVENT_PATH) {
  const base = validEventBase(eventPath);
  const changed = base ? new Set() : new Set(execFileSync('git', ['diff', '--name-only', '-z', 'HEAD', '--', ...files],
    {cwd:root, encoding:'utf8', windowsHide:true}).split('\0'));
  const specs = files.map(file => `${base || (changed.has(file) ? 'HEAD' : 'HEAD^')}:${file}`);
  const blobs = await readGitBlobs(root, specs);
  return new Map(files.map((file, index) => [file, blobs.get(specs[index]).toString('utf8')]));
}
