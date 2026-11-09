import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generatedDatabaseTypesPath, packGeneratedDatabaseTypes, readGeneratedDatabaseTypes,
  verifyGeneratedDatabaseTypes, writeGeneratedDatabaseTypes } from '../scripts/database-type-parts.mjs';
import { repoRoot } from '../scripts/tooling-process.mjs';

test('generated type parts keep wide records and overloaded RPCs lossless and reject drift', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gnc-database-types-'));
  try {
    const fields = Array.from({ length: 420 }, (_, index) => `      field_${index}?: Json | null\n`).join('');
    const native = 'export type Json = string\nexport type Database = { public: { Functions: {\n'
      + '  f: { Args: { id: string }; Returns: {\n' + fields + '  }[] } | { Args: never; Returns: Json }\n} } }\n';
    mkdirSync(path.dirname(path.join(root, generatedDatabaseTypesPath)), { recursive: true });
    writeGeneratedDatabaseTypes(root, native);
    assert.equal(readGeneratedDatabaseTypes(root), native);
    const generated = packGeneratedDatabaseTypes(native);
    const fragments = [...generated.keys()].filter(file => file !== generatedDatabaseTypesPath);
    assert.ok(fragments.length > 1);
    assert.ok([...generated.values()].every(source => source.split('\n').length <= 400));
    const shard = path.join(root, fragments[0]);
    writeFileSync(shard, readFileSync(shard, 'utf8').replace('?: Json', ': Json'));
    assert.throws(() => verifyGeneratedDatabaseTypes(root, native), /DATABASE_TYPES_OUT_OF_DATE/);
    writeGeneratedDatabaseTypes(root, native);
    const unowned = path.join(path.dirname(shard), 'unowned.ts');
    writeFileSync(unowned, 'export type Retained = string;\n');
    assert.throws(() => writeGeneratedDatabaseTypes(root, native), /DATABASE_TYPES_UNOWNED_PART/);
    assert.equal(readFileSync(unowned, 'utf8'), 'export type Retained = string;\n');
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.match(path.basename(root), /^gnc-database-types-/);
    rmSync(root, { recursive: true });
  }
});

test('bounded report RPC types follow the generated public function order', () => {
  const types = readGeneratedDatabaseTypes(repoRoot);
  const outbox = types.indexOf('      manager_ncr_outbox_metadata_v1: {');
  const reports = types.indexOf('      manager_report_read_v2: { Args: { p_payload: Json }; Returns: Json }');
  const season = types.indexOf('      manager_season_priority_list_v1: {');
  assert.ok(outbox >= 0 && reports > outbox && season > reports);
});

test('inventory location aggregate RPC type follows generated function and argument order', () => {
  const types = readGeneratedDatabaseTypes(repoRoot);
  const aggregate = types.indexOf('      inventory_location_on_hand_read_v1: {');
  const transaction = types.indexOf('      inventory_transaction_history_v1: {');
  assert.ok(aggregate >= 0 && aggregate < transaction, 'inventory functions remain alphabetically ordered');
  const block = types.slice(aggregate, transaction);
  assert.match(block, /Args: \{\s+p_actor_id: string\s+p_expected_revision\?: string\s+p_pairs: Json\s+\}/,
    'generated args use alphabetical order and keep the optional revision optional');
});
