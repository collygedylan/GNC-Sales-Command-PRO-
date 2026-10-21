import { parse } from 'acorn';

export const INDEX_HTML_BUDGET = Object.freeze({ maxLines: 3000, maxBytes: 360000 });

export function inspectSourceBudget(source, limits = INDEX_HTML_BUDGET) {
  const lines = String(source).split(/\r?\n/).length;
  const bytes = Buffer.byteLength(String(source), 'utf8');
  return Object.freeze({
    lines,
    bytes,
    maxLines: limits.maxLines,
    maxBytes: limits.maxBytes,
    withinBudget: lines <= limits.maxLines && bytes <= limits.maxBytes,
  });
}

export function findDuplicateGlobalFunctionDeclarations(sources) {
  const declarations = new Map();
  for (const { name: file, source } of sources) {
    const ast = parse(String(source), { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
    for (const statement of ast.body) {
      if (statement.type !== 'FunctionDeclaration' || !statement.id?.name) continue;
      const name = statement.id.name;
      const entries = declarations.get(name) || [];
      entries.push(file);
      declarations.set(name, entries);
    }
  }
  return [...declarations.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([name, files]) => Object.freeze({ name, files: Object.freeze(files.slice()) }));
}
