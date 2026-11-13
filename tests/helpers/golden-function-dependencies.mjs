import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import * as scope from 'eslint-scope';
import ts from 'typescript';

const dependencyCache = new Map();

function freeNames(source, typescript) {
  if (dependencyCache.has(source)) return dependencyCache.get(source);
  const declaration = source.replace(/^export (?=(?:async )?function )/gm, '');
  const javascript = typescript ? ts.transpileModule(declaration, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText : declaration;
  const ast = parse(javascript, { ecmaVersion: 'latest', sourceType: 'script', ranges: true });
  const analyzed = scope.analyze(ast, { ecmaVersion: 2024, sourceType: 'script', optimistic: true, ignoreEval: true });
  const optional = new Set();
  simple(ast, { UnaryExpression(node) {
    if (node.operator === 'typeof' && node.argument.type === 'Identifier') optional.add(node.argument.name);
  } });
  const names = [...new Set(analyzed.globalScope.through.map(reference => reference.identifier.name))]
    .filter(name => !optional.has(name));
  const dependencies={names,optional:[...optional]};
  dependencyCache.set(source, dependencies);
  return dependencies;
}

export function includeFixtureFunctionDependencies({ file, names, context, functionSource, typescript }) {
  const selected = new Map(names.map(name => [name, functionSource(file, name)]));
  const optionalBoundary = new Set([...selected.values()].flatMap(source => freeNames(source,typescript).optional));
  for (const source of selected.values()) {
    for (const dependency of freeNames(source, typescript).names) {
      if (selected.has(dependency) || dependency in context || optionalBoundary.has(dependency)) continue;
      const definition = functionSource(file, dependency, false);
      if (definition) selected.set(dependency, definition);
    }
  }
  return [...selected.values()];
}
