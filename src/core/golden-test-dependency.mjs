import { parse } from 'acorn';
import { simple } from 'acorn-walk';

export function hasTestRegistrationDependency(source) {
  const ast = parse(source, { ecmaVersion:'latest', sourceType:'module' });
  let found = false;
  const check = node => {
    const name = node?.value;
    if (typeof name === 'string' && (name === 'node:test' || /\.test\.[cm]?js$/.test(name))) found = true;
  };
  simple(ast, {
    ImportDeclaration(node) { check(node.source); },
    ImportExpression(node) { check(node.source); },
    CallExpression(node) { if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node.arguments[0]); }
  });
  return found;
}
