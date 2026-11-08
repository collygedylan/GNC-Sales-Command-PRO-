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

export function verifyGoldenTestDependencies(read, assert) {
  for (const name of ['row-evaluation-contract','docks-suspend-integrity','current-soc-docks','completion-cards-preview',
    'erp-filename-watchdog','soc-suspend-membership','soc-suspend-routing']) {
    assert.equal(hasTestRegistrationDependency(read(`src/core/golden-${name}.mjs`)), false, name);
  }
  assert.equal(hasTestRegistrationDependency("import test from 'node:test';"), true);
  assert.equal(hasTestRegistrationDependency("import('./nested.test.mjs');"), true);
  assert.equal(hasTestRegistrationDependency("import './contract.mjs';"), false);
}
