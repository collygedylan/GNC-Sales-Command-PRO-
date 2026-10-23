import { tokenizer } from 'acorn';

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
    const tokens = tokenizer(String(source), { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
    let depth = 0;
    let previous = { label: 'eof', value: '' };
    let beforePrevious = previous;
    for (;;) {
      const token = tokens.getToken();
      const label = token.type.label;
      if (label === 'eof') break;
      const boundary = ['eof', ';', '}'].includes(previous.label);
      const asyncBoundary = previous.label === 'name' && previous.value === 'async'
        && ['eof', ';', '}'].includes(beforePrevious.label);
      if (depth !== 0 || label !== 'function' || !(boundary || asyncBoundary)) {
        if (label === '{' || label === '${') depth++;
        else if (label === '}') depth--;
        beforePrevious = previous;
        previous = { label, value: String(token.value || '') };
        continue;
      }
      let nameToken = tokens.getToken();
      if (nameToken.type.label === '*') nameToken = tokens.getToken();
      if (nameToken.type.label !== 'name') continue;
      const name = String(nameToken.value);
      const entries = declarations.get(name) || [];
      entries.push(file);
      declarations.set(name, entries);
      beforePrevious = { label, value: String(token.value || '') };
      previous = { label: nameToken.type.label, value: name };
    }
  }
  return [...declarations.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([name, files]) => Object.freeze({ name, files: Object.freeze(files.slice()) }));
}
