import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';

const html = readComposedAppSource();
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1])
  .find(source => source.includes('function confirmedArgosLiveEditRevisionAdvancesSnapshot('));
assert.ok(script, 'confirmed live-edit helpers are present in the runtime');
const ast = parse(script, { ecmaVersion: 'latest', sourceType: 'script' });
const wanted = new Set([
  'getCanonicalMasterInventoryRowByUniqueId',
  'confirmedArgosLiveEditRevisionAdvancesSnapshot',
  'canApplyConfirmedArgosLiveEdit',
]);
const declarations = ast.body.filter(node => node.type === 'FunctionDeclaration' && wanted.has(node.id.name));
for (const name of wanted) assert.ok(declarations.some(node => node.id.name === name), `runtime helper ${name} is present`);
const code = declarations.map(node => script.slice(node.start, node.end)).join('\n');
const fullInventory = [
  { UNIQUE_ID: 'master-1', SOURCE_TABLE: 'ph_master_inventory' },
  { UNIQUE_ID: 'request-1', SOURCE_TABLE: 'ph_active_request' },
];
const context = vm.createContext({
  String,
  BigInt,
  Map,
  Array,
  firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && value !== '') ?? '',
  fullInventory,
  masterInventoryById: new Map(fullInventory.map(row => [row.UNIQUE_ID, row])),
});
vm.runInContext(code, context);

test('confirmed row lookup resolves only exact canonical master rows', () => {
  assert.equal(context.getCanonicalMasterInventoryRowByUniqueId('master-1'), fullInventory[0]);
  assert.equal(context.getCanonicalMasterInventoryRowByUniqueId('request-1'), null);
  assert.equal(context.getCanonicalMasterInventoryRowByUniqueId('linked-master-id'), null);
  assert.equal(context.getCanonicalMasterInventoryRowByUniqueId(''), null);
});

test('a newer authoritative inventory revision permits confirmed edits when LAST_UPDATED is blank or equal', () => {
  assert.equal(context.confirmedArgosLiveEditRevisionAdvancesSnapshot('501', '500'), true);
  assert.equal(context.canApplyConfirmedArgosLiveEdit(0, 0, true), true);
  assert.equal(context.canApplyConfirmedArgosLiveEdit(0, 1791547260000, true), true);
  assert.equal(context.canApplyConfirmedArgosLiveEdit(1791547260000, 1791547260000, true), true);
  assert.equal(context.canApplyConfirmedArgosLiveEdit(1791547320000, 1791547260000, true), false);
});

test('without a newer server revision, stale or missing timestamps remain fail-closed', () => {
  assert.equal(context.confirmedArgosLiveEditRevisionAdvancesSnapshot('500', '500'), false);
  assert.equal(context.confirmedArgosLiveEditRevisionAdvancesSnapshot('499', '500'), false);
  assert.equal(context.canApplyConfirmedArgosLiveEdit(0, 1791547260000, false), false);
  assert.equal(context.canApplyConfirmedArgosLiveEdit(1791547260000, 1791547260000, false), false);
  assert.equal(context.canApplyConfirmedArgosLiveEdit(1791547260000, 1791547320000, false), true);
});
