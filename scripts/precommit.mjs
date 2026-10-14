import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import yaml from 'js-yaml';
import { repoRoot, run } from './tooling-process.mjs';

export function stagedPaths(root = repoRoot, execute = run) {
  return execute('git', ['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=ACMD', '-z'], { root, capture: true })
    .split('\0').filter(Boolean).map(file => file.replaceAll('\\', '/'));
}

const sourceExtensions = /\.(?:[cm]?[jt]sx?)$/i;
const jsonExtensions = /\.json$/i;
const yamlExtensions = /\.ya?ml$/i;
const htmlExtensions = /\.html?$/i;

function assertJavaScriptSyntax(source, fileName, scriptKind = ts.ScriptKind.JS) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);
  if (sourceFile.parseDiagnostics.length) {
    const errors = sourceFile.parseDiagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    throw new Error(errors.join('\n'));
  }
}

function checkInlineJavaScript(html, fileName) {
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = scriptPattern.exec(html))) {
    const attributes = match[1] || '';
    const source = match[2] || '';
    if (/\bsrc\s*=/i.test(attributes) || !source.trim()) continue;
    const id = attributes.match(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const type = attributes.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const scriptId = (id?.[1] ?? id?.[2] ?? id?.[3] ?? '').toLowerCase();
    const mime = (type?.[1] ?? type?.[2] ?? type?.[3] ?? '').split(';', 1)[0].trim().toLowerCase();
    const executable = !mime || mime === 'module' || /^(?:text|application)\/(?:java|ecma)script$/.test(mime);
    if (!executable && scriptId !== 'app-script-source') continue;
    try {
      assertJavaScriptSyntax(source, `${fileName} inline script`);
    } catch (error) {
      const line = html.slice(0, match.index).split(/\r?\n/).length;
      throw new Error(`${fileName}:${line} inline script did not parse: ${error.message}`, { cause: error });
    }
  }
}

export function syntaxCheck(files, root = repoRoot) {
  for (const file of files) {
    const absolute = path.join(root, file);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
    const source = readFileSync(absolute, 'utf8');
    if (sourceExtensions.test(file)) {
      const extension = path.extname(file).toLowerCase();
      const scriptKind = extension === '.tsx' ? ts.ScriptKind.TSX
        : /\.[cm]?ts$/.test(extension) ? ts.ScriptKind.TS
        : extension === '.jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
      assertJavaScriptSyntax(source, file, scriptKind);
    } else if (jsonExtensions.test(file)) {
      JSON.parse(source);
    } else if (yamlExtensions.test(file)) {
      yaml.loadAll(source);
    } else if (htmlExtensions.test(file)) {
      checkInlineJavaScript(source, file);
    }
  }
}

export function precommit({ root = repoRoot, files = stagedPaths(root) } = {}) {
  if (!files.length) return;
  syntaxCheck(files, root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--staged') throw new Error('Usage: node scripts/precommit.mjs --staged');
    precommit();
  } catch (error) { console.error(`[pre-commit] ${error.message}`); process.exitCode = 1; }
}
