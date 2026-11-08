import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

export function syntaxFailures(root, files) {
  const issues = [];
  for (const file of files) {
    try { new vm.SourceTextModule(readFileSync(path.join(root, file), 'utf8'), {identifier:file}); }
    catch (error) { issues.push(`${file}: syntax invalid\n${error.message}`); }
  }
  return issues;
}
