import assert from 'node:assert/strict';
import path from 'node:path';
import { parse } from 'acorn';

const registrationOwners = new Map([
  ['tests/golden-invariants.test.mjs', ['../src/core/golden-final-polish.mjs','./helpers/golden-release-fixture-ratchet.mjs']],
  ['src/core/golden-final-polish.mjs', ['../../tests/erp-drive-post-upsert.test.mjs']],
]);

function registeredInvariant(call, file) {
  if (call?.type !== 'CallExpression') return null;
  const {callee,arguments:args} = call;
  const testName = callee.name || callee.object?.name;
  if (testName !== 'test') return null;
  const title = args[0]?.value ?? (args[0]?.expressions?.length === 0 ? args[0].quasis[0].value.cooked : '');
  const invariant = /^Invariant (\d+)\b/.exec(title || '');
  if (!invariant) return null;
  assert.equal(callee.type,'Identifier',`${file}: inactive or exclusive invariant ${invariant[1]}`);
  const options = args[1];
  if (options?.type === 'ObjectExpression') {
    for (const property of options.properties) {
      const key = property.key?.name ?? property.key?.value;
      assert.ok(property.type === 'Property' && (!property.computed || property.key.type === 'Literal')
        && (!['skip','todo','only'].includes(key) || property.value?.value === false), `${file}: inactive invariant options ${invariant[1]}`);
    }
  }
  assert.ok(args.length === 2 && options?.type !== 'ObjectExpression' || args.length === 3 && options?.type === 'ObjectExpression',
    `${file}: unsupported invariant registration ${invariant[1]}`);
  return Number(invariant[1]);
}

export function goldenRegistrationOrder(read, file = 'tests/golden-invariants.test.mjs') {
  const source = parse(read(file), {ecmaVersion:'latest',sourceType:'module'});
  const ids = [];
  const owners = registrationOwners.get(file) || [];
  let registrations = 0;
  for (const statement of source.body) {
    const expression = statement.expression;
    const imported = expression?.type === 'AwaitExpression' && expression.argument.type === 'ImportExpression'
      ? expression.argument.source.value : null;
    if (owners.includes(imported)) {
      assert.equal(imported,owners[registrations],`${file}: duplicate or out-of-order invariant registration import`);
      registrations++;
      ids.push(...goldenRegistrationOrder(read,path.posix.normalize(path.posix.join(path.posix.dirname(file),imported))));
      continue;
    }
    const invariant = registeredInvariant(expression,file);
    if (invariant !== null) ids.push(invariant);
  }
  assert.equal(registrations,owners.length,`${file}: missing invariant registration import`);
  return ids;
}
