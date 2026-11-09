import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './tooling-process.mjs';
import { generatedDatabaseTypesPath, readGeneratedDatabaseTypes } from './database-type-parts.mjs';

// Runtime validators and TypeScript use the same introspected schema. Unsupported
// generator syntax fails closed rather than silently creating an unknown schema.
export function databaseContracts(source) {
  const file = ts.createSourceFile('database.types.ts', source, ts.ScriptTarget.Latest, true);
  const database = file.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === 'Database');
  const members = node => {
    if (node && ts.isMappedTypeNode(node) && node.typeParameter.constraint?.kind === ts.SyntaxKind.NeverKeyword) return {};
    if (!node || !ts.isTypeLiteralNode(node)) throw new Error('Expected generated Database type literal');
    return Object.fromEntries(node.members.map(member => [member.name.getText(file).replace(/^["']|["']$/g, ''), member]));
  };
  const publicSchema = members(members(database?.type).public.type);
  const enums = members(publicSchema.Enums.type);
  function describe(node) {
    if (ts.isParenthesizedTypeNode(node)) return describe(node.type);
    if (ts.isUnionTypeNode(node)) return { oneOf: node.types.map(describe) };
    if (ts.isArrayTypeNode(node)) return { array: describe(node.elementType) };
    if (ts.isLiteralTypeNode(node)) {
      if (node.literal.kind === ts.SyntaxKind.NullKeyword) return 'null';
      if (ts.isStringLiteral(node.literal)) return { literal: node.literal.text };
      if (node.literal.kind === ts.SyntaxKind.TrueKeyword) return { literal: true };
      if (node.literal.kind === ts.SyntaxKind.FalseKeyword) return { literal: false };
      throw new Error(`Unsupported literal: ${node.getText(file)}`);
    }
    if (ts.isTypeLiteralNode(node)) return { object: Object.fromEntries(Object.entries(members(node)).map(([key, value]) =>
      [key, { schema: describe(value.type), ...(value.questionToken ? { optional: true } : {}) }])) };
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText(file);
      if (name === 'Json') return 'json';
      if (name === 'Record' && node.typeArguments?.[1]?.kind === ts.SyntaxKind.NeverKeyword) return { object: {} };
    }
    if (ts.isIndexedAccessTypeNode(node)) {
      const text = node.getText(file);
      const match = text.match(/^Database\["public"\]\["Enums"\]\["([^"]+)"\]$/);
      if (match && enums[match[1]]) return describe(enums[match[1]].type);
    }
    const kind = new Map([[ts.SyntaxKind.StringKeyword, 'string'], [ts.SyntaxKind.NumberKeyword, 'number'],
      [ts.SyntaxKind.BooleanKeyword, 'boolean'], [ts.SyntaxKind.NeverKeyword, 'never'], [ts.SyntaxKind.UnknownKeyword, 'json'],
      [ts.SyntaxKind.UndefinedKeyword, 'null']]).get(node.kind);
    if (kind) return kind;
    throw new Error(`Unsupported generated schema type: ${node.getText(file)}`);
  }
  const tables = {};
  for (const [name, table] of Object.entries(members(publicSchema.Tables.type))) {
    const properties = members(table.type);
    tables[name] = { row: describe(properties.Row.type), insert: describe(properties.Insert.type), update: describe(properties.Update.type) };
  }
  for (const [name, view] of Object.entries(members(publicSchema.Views.type))) {
    const properties = members(view.type);
    tables[name] = { row: describe(properties.Row.type), insert: 'never', update: 'never' };
  }
  const functions = {};
  const functionReturns = {};
  function sqlReturnSchema(schema) {
    // SQL composite attributes and array elements can be NULL. The CLI does
    // not encode OUT-field nullability, even when a table's row type is used:
    // table constraints do not apply to composite values outside that table.
    // Keep every field required and validate each non-null value's exact type.
    // https://www.postgresql.org/docs/current/rowtypes.html
    if (schema === 'json' || schema === 'null') return schema;
    if (typeof schema === 'object') {
      if ('oneOf' in schema) return { oneOf: schema.oneOf.map(sqlReturnSchema) };
      if ('array' in schema) schema = { array: sqlReturnSchema(schema.array) };
      else if ('object' in schema) schema = { object: Object.fromEntries(Object.entries(schema.object)
        .map(([key, field]) => [key, { ...field, schema: sqlReturnSchema(field.schema) }])) };
    }
    return { oneOf: [schema, 'null'] };
  }
  for (const [name, fn] of Object.entries(members(publicSchema.Functions.type))) {
    const variants = ts.isUnionTypeNode(fn.type) ? fn.type.types : [fn.type];
    const argsByVariant = [];
    const returnsByVariant = [];
    for (const variant of variants) {
      const properties = members(variant);
      const node = properties.Args.type;
      const args = node.kind === ts.SyntaxKind.NeverKeyword ? { object: {} } : describe(node);
      // PostgreSQL arguments accept SQL NULL; unlike table columns, arguments
      // have no NOT NULL constraint. Required names remain required. The CLI's
      // TS surface omits this distinction, so preserve valid legacy null args.
      if (typeof args === 'object' && 'object' in args) {
        for (const field of Object.values(args.object)) field.schema = { oneOf: [field.schema, 'null'] };
      }
      argsByVariant.push(args);
      const returned = describe(properties.Returns?.type || ts.factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword));
      returnsByVariant.push(sqlReturnSchema(returned));
    }
    functions[name] = { oneOf: argsByVariant };
    functionReturns[name] = { oneOf: returnsByVariant };
  }
  return { tables, functions, functionReturns };
}
// Keep short generated descriptors on one line and larger records indented.
function formatContract(value, indent = '') {
  const compact = JSON.stringify(value);
  if (indent.length + compact.length <= 112 || typeof value !== 'object' || value === null) return compact;
  const childIndent = indent + '  ';
  if (Array.isArray(value)) {
    const items = value.map(item => childIndent + formatContract(item, childIndent));
    return '[\n' + items.join(',\n') + '\n' + indent + ']';
  }
  const items = Object.entries(value).map(([key, child]) =>
    childIndent + JSON.stringify(key) + ': ' + formatContract(child, childIndent));
  return '{\n' + items.join(',\n') + '\n' + indent + '}';
}

const generatedHeader = '// Generated from Supabase types. Run npm run types:contracts:generate; do not edit.\n';
const productionPart = {
  output: 'services/inventory-project-contracts.generated.ts', name: 'inventoryProjectContracts',
  keys: ['inventory_project_rows', 'inventory_projects'],
};
const sandboxPart = {
  output: 'v2/src/services/sandbox-request-contracts.generated.ts', name: 'sandboxRequestContracts',
  keys: ['ph_active_request', 'ph_requests_pending'],
};

function writeOrCheck(root, output, content, check) {
  if (!check) {
    writeFileSync(path.join(root, output), content);
    return;
  }
  if (readFileSync(path.join(root, output), 'utf8').replaceAll('\r\n', '\n') !== content) {
    throw new Error(`${output} is stale. Run npm run types:contracts:generate and stage it.`);
  }
}

function writeTableContractPart(root, contracts, imports, check, part) {
  const tables = Object.fromEntries(part.keys.map(key => [key, contracts.tables[key]]));
  if (Object.values(tables).some(value => !value)) throw new Error(`DATABASE_RUNTIME_CONTRACT_MISSING: ${part.output}`);
  for (const key of part.keys) delete contracts.tables[key];
  const keys = part.keys.map(key => JSON.stringify(key)).join(' | ');
  const body = `export const ${part.name}: Pick<RuntimeContracts<Database>['tables'], ${keys}> = ${formatContract(tables)};\n`;
  writeOrCheck(root, part.output, generatedHeader + imports + body, check);
}

function writeSocContractParts(root, contracts, imports, check) {
  const table = 'ph_soc_master';
  const relation = contracts.tables[table];
  if (!relation) throw new Error('DATABASE_RUNTIME_CONTRACT_MISSING: ' + table);
  const parts = ['row', 'insert', 'update'].map(operation => {
    const name = 'socMaster' + operation[0].toUpperCase() + operation.slice(1) + 'Contract';
    const file = 'soc-master-' + operation + '-contract.generated.ts';
    const type = `RuntimeContracts<Database>['tables']['${table}']['${operation}']`;
    const body = `export const ${name}: ${type} = ${formatContract(relation[operation])};\n`;
    writeOrCheck(root, 'services/' + file, generatedHeader + imports + body, check);
    return { operation, name, file };
  });
  delete contracts.tables[table];
  return {
    imports: parts.map(({ name, file }) => `import { ${name} } from './${file}';\n`).join(''),
    fields: '    "ph_soc_master": { ' + parts.map(({ operation, name }) => operation + ': ' + name).join(', ') + ' },\n'
  };
}

function writeErpStageContractPart(root, contracts, imports, check) {
  const names = ['fast_abort_erp_stage_v1', 'fast_append_erp_stage_batch_v1', 'fast_begin_erp_stage_v1',
    'fast_commit_erp_stage_swap_v1', 'fast_erp_import_columns_v1', 'fast_seal_erp_stage_v1'];
  const keys = names.map(name => JSON.stringify(name)).join(' | ');
  const declarations = [
    ['functions', 'erpStageArgs'],
    ['functionReturns', 'erpStageReturns'],
  ].map(([kind, name]) => {
    const values = Object.fromEntries(names.map(key => [key, contracts[kind][key]]));
    if (Object.values(values).some(value => !value)) throw Error('DATABASE_ERP_STAGE_CONTRACT_MISSING');
    for (const key of names) delete contracts[kind][key];
    return `export const ${name}: Pick<RuntimeContracts<Database>['${kind}'], ${keys}> = ${formatContract(values)};\n`;
  });
  const file = 'erp-stage-contracts.generated.ts';
  writeOrCheck(root, 'services/' + file, generatedHeader + imports + declarations.join(''), check);
  return `import { erpStageArgs, erpStageReturns } from './${file}';\n`;
}

export function generateContracts({ root = repoRoot, check = false } = {}) {
  for (const [input, output, typeImport] of [
    [generatedDatabaseTypesPath, 'services/database-contracts.generated.ts', '../supabase/functions/_shared/database.types'],
    ['v2/src/services/sandbox.database.types.ts', 'v2/src/services/sandbox-contracts.generated.ts', './sandbox.database.types'],
  ]) {
    const contracts = databaseContracts(readGeneratedDatabaseTypes(root, input));
    const sandbox = input.startsWith('v2/');
    const runtime = sandbox ? '../../../services/database-contract-runtime.ts' : './database-contract-runtime.ts';
    const imports = `import type { Database } from '${typeImport}.ts';\nimport type { RuntimeContracts } from '${runtime}';\n`;
    const part = sandbox ? sandboxPart : productionPart;
    writeTableContractPart(root, contracts, imports, check, part);
    const partImport = `import { ${part.name} } from './${path.posix.basename(part.output)}';\n`;
    const soc = sandbox ? { imports: '', fields: '' } : writeSocContractParts(root, contracts, imports, check);
    const erp = sandbox ? '' : writeErpStageContractPart(root, contracts, imports, check);
    const serialized = formatContract(contracts);
    let merged = serialized.replace('"tables": {\n', `"tables": {\n    ...${part.name},\n${soc.fields}`);
    if (erp) merged = merged.replace('"functions": {\n', '"functions": {\n    ...erpStageArgs,\n')
      .replace('"functionReturns": {\n', '"functionReturns": {\n    ...erpStageReturns,\n');
    writeOrCheck(root, output, generatedHeader + imports + partImport + soc.imports + erp
      + `export const contracts: RuntimeContracts<Database> = ${merged};\n`, check);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { generateContracts({ check: process.argv.includes('--check') }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
