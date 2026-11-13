import path from 'node:path';
import ts from 'typescript';

export function importedFixtureFunction(file, name, { syntax, lookup }, seen = new Set()) {
  const key = `${file}:${name}`;
  if (seen.has(key)) return null;
  seen.add(key);
  for (const statement of syntax(file).statements) {
    if (!ts.isImportDeclaration(statement) || !statement.moduleSpecifier.text.startsWith('.')) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const binding = bindings.elements.find(item => item.name.text === name);
    if (!binding) continue;
    const imported = binding.propertyName?.text || name;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), statement.moduleSpecifier.text));
    const source = lookup(target, imported) || importedFixtureFunction(target, imported, { syntax, lookup }, seen);
    if (!source) return null;
    return imported === name ? source : `${source}\nconst ${name} = ${imported};`;
  }
  return null;
}
