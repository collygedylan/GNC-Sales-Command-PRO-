import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './tooling-process.mjs';

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
      // PostgREST serializes SQL NULL as JSON null even when generated TS scalar
      // metadata describes only the non-null value type.
      returnsByVariant.push({ oneOf: [returned, 'null'] });
    }
    functions[name] = { oneOf: argsByVariant };
    functionReturns[name] = { oneOf: returnsByVariant };
  }
  return { tables, functions, functionReturns };
}
export function generateContracts({ root = repoRoot, check = false } = {}) {
  for (const [input, output, typeImport] of [
    ['supabase/functions/_shared/database.types.ts', 'services/database-contracts.generated.ts', '../supabase/functions/_shared/database.types'],
    ['v2/src/services/sandbox.database.types.ts', 'v2/src/services/sandbox-contracts.generated.ts', './sandbox.database.types'],
  ]) {
    const contracts = databaseContracts(readFileSync(path.join(root, input), 'utf8'));
    const content = '// Generated from Supabase types. Run npm run types:contracts:generate; do not edit.\n'
      + `import type { Database } from '${typeImport}.ts';\n`
      + (input.startsWith('v2/') ? "import type { RuntimeContracts } from '../../../services/database-contract-runtime.ts';\n" : "import type { RuntimeContracts } from './database-contract-runtime.ts';\n")
      + `export const contracts: RuntimeContracts<Database> = ${JSON.stringify(contracts, null, 2)};\n`;
    if (check) {
      if (readFileSync(path.join(root, output), 'utf8').replaceAll('\r\n', '\n') !== content) throw new Error(`${output} is stale. Run npm run types:contracts:generate and stage it.`);
    } else writeFileSync(path.join(root, output), content);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { generateContracts({ check: process.argv.includes('--check') }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
