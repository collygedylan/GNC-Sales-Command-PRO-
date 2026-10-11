// Execute the production Eval Reports rewrite block against real PGlite
// functions whose stored source uses each supported line-ending combination.
// node supabase/ci/inventory_row_assignment_line_endings_pglite.mjs --pglite-root .gnc-local/hybrid-pglite
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--pglite-root');
if (rootIndex < 0 || !args[rootIndex + 1]) throw new Error('Pass --pglite-root with the installed PGlite package.');
const dependencyRoot = path.resolve(args[rootIndex + 1]);
const { PGlite } = createRequire(path.join(dependencyRoot, 'package.json'))('@electric-sql/pglite');
const migrationPath = new URL('../migrations/20261006210200_inventory_row_assignment_live_consumers.sql', import.meta.url);
const migrationSource = await readFile(migrationPath, 'utf8');
const marker = migrationSource.indexOf('-- Eval Reports #2 must label each physical row');
assert.notEqual(marker, -1, 'migration retains the exact Eval Reports migration section');

function migrationBlock(source) {
  const section = source.slice(source.indexOf('-- Eval Reports #2 must label each physical row'));
  const match = section.match(/do \$migration\$[\s\S]*?\$migration\$;/i);
  assert.ok(match, 'Eval Reports DO block is present');
  return match[0];
}

const lfBlock = migrationBlock(migrationSource.replace(/\r\n/g, '\n'));
const crlfBlock = migrationBlock(migrationSource.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
const oldMatch = lfBlock.match(/old_projection\s+text\s*:=\s*\$old\$([\s\S]*?)\$old\$;/i);
assert.ok(oldMatch, 'migration exposes the original projection used for an exact source rewrite');
const oldLf = oldMatch[1];
const oldCrlf = oldLf.replace(/\n/g, '\r\n');
const newMatch = lfBlock.match(/new_projection\s+text\s*:=\s*\$new\$([\s\S]*?)\$new\$;/i);
assert.ok(newMatch, 'migration exposes the row-specific replacement');

const schemaSql = `
create schema private;
create role service_role;
create table public.ph_master_inventory(unique_id text primary key, itemcode text, genusname text);
create table public.ph_warehouse_assigned_items(present_in_drive boolean, itemcode_normalized text, itemcode text, genusname text, assignedto text);
create table public.ph_inventory_row_assignments(master_unique_id text primary key, present_in_drive boolean, assignedto text);
insert into public.ph_master_inventory values
  ('row-zoe', 'ROSE-1', 'Rosa'), ('row-unassigned', 'ROSE-1', 'Rosa');
insert into public.ph_warehouse_assigned_items values
  (true, 'ROSE-1', 'ROSE-1', 'Rosa', 'zoe_green'),
  (true, 'ROSE-1', 'ROSE-1', 'Rosa', 'mitch_kaiser');
insert into public.ph_inventory_row_assignments values
  ('row-zoe', true, 'zoe_green'), ('row-unassigned', true, null);
create function private.eval_normalize_user_v2(value text) returns text
language sql immutable as $helper$ select nullif(lower(btrim(value)), '') $helper$;
create function private.inventory_effective_owner_v1(value text) returns text
language sql stable as $helper$
  select a.assignedto from public.ph_inventory_row_assignments a
  where a.master_unique_id = value and a.present_in_drive
$helper$;
`;

function functionDefinition(projection, bodyEol = '\n') {
  // The marker deliberately contains a literal CRLF. Replacing the target
  // projection must leave that unrelated body text untouched.
  const crlfMarker = `before\r\nafter`;
  const expressions = Array.isArray(projection) ? projection.join(',') : projection;
  const body = [
    'declare m record;',
    'begin',
    "  select * into m from public.ph_master_inventory where unique_id = p_payload->>'uid';",
    `  return jsonb_build_object('marker', '${crlfMarker}',${expressions}, 'uid', m.unique_id);`,
    'end;',
  ].join(bodyEol);
  return `create or replace function public.list_eval_report2_itemcodes_v1(p_payload jsonb)\nreturns jsonb language plpgsql security definer set search_path = '' as $fixture$${body}$fixture$;\nrevoke all on function public.list_eval_report2_itemcodes_v1(jsonb) from public;\ngrant execute on function public.list_eval_report2_itemcodes_v1(jsonb) to service_role;`;
}

const metadataSql = `select p.prosecdef as security_definer, p.proconfig, p.proacl::text as acl
  from pg_catalog.pg_proc p where p.oid = 'public.list_eval_report2_itemcodes_v1(jsonb)'::regprocedure`;

async function newDatabase() {
  const db = await PGlite.create();
  await db.exec(schemaSql);
  return db;
}

async function runCombination(label, doSql, projection, functionEol) {
  const db = await newDatabase();
  try {
    await db.exec(functionDefinition(projection, functionEol));
    const before = (await db.query("select pg_get_functiondef('public.list_eval_report2_itemcodes_v1(jsonb)'::regprocedure) as d")).rows[0].d;
    const metadataBefore = (await db.query(metadataSql)).rows[0];
    assert.equal((before.match(/'assignedToUsers'/g) || []).length, 1, `${label}: fixture contains one target fragment`);
    assert.ok(before.includes(projection), `${label}: PostgreSQL preserves the fixture line endings`);
    assert.match(before, /SECURITY DEFINER[\s\S]*SET search_path TO ''/i, `${label}: fixture is security definer with a pinned search path`);
    await db.exec(doSql);
    const after = (await db.query("select pg_get_functiondef('public.list_eval_report2_itemcodes_v1(jsonb)'::regprocedure) as d")).rows[0].d;
    const metadataAfter = (await db.query(metadataSql)).rows[0];
    assert.equal((after.match(/inventory_effective_owner_v1\(m.unique_id\)/g) || []).length, 1, `${label}: exact-row projection installed`);
    assert.equal((after.match(/from public\.ph_warehouse_assigned_items a/g) || []).length, 0, `${label}: broad sibling lookup removed`);
    const replacement = newMatch[1].replace(/\n/g, projection.includes('\r\n') ? '\r\n' : '\n');
    assert.equal(after, before.replace(projection, replacement), `${label}: every byte outside the target projection is unchanged`);
    assert.deepEqual(metadataAfter, metadataBefore, `${label}: security-definer, search-path, and ACL metadata are unchanged`);
    const zoe = (await db.query("select public.list_eval_report2_itemcodes_v1('{\"uid\":\"row-zoe\"}'::jsonb) as result")).rows[0].result;
    const unassigned = (await db.query("select public.list_eval_report2_itemcodes_v1('{\"uid\":\"row-unassigned\"}'::jsonb) as result")).rows[0].result;
    assert.deepEqual(zoe.assignedToUsers, ['zoe_green'], `${label}: sibling owner does not bleed into exact row`);
    assert.deepEqual(unassigned.assignedToUsers, ['unassigned'], `${label}: explicit null remains unassigned`);
    assert.equal(zoe.marker, 'before\r\nafter', `${label}: unrelated literal CRLF survives rewriting`);
    console.log(`PASS ${label}`);
  } finally {
    await db.close();
  }
}

async function assertRejected(label, doSql, projection, functionEol) {
  const db = await newDatabase();
  try {
    await db.exec(functionDefinition(projection, functionEol));
    const before = (await db.query("select pg_get_functiondef('public.list_eval_report2_itemcodes_v1(jsonb)'::regprocedure) as d")).rows[0].d;
    const metadataBefore = (await db.query(metadataSql)).rows[0];
    await assert.rejects(db.exec(doSql), error => error.code === '55000' && /ROW_ASSIGNMENT_EVAL_REPORT_PROJECTION_SOURCE_MISMATCH/.test(error.message), `${label}: mismatch is rejected with SQLSTATE 55000`);
    const after = (await db.query("select pg_get_functiondef('public.list_eval_report2_itemcodes_v1(jsonb)'::regprocedure) as d")).rows[0].d;
    assert.equal(after, before, `${label}: rejected rewrite leaves the full function definition unchanged`);
    assert.deepEqual((await db.query(metadataSql)).rows[0], metadataBefore, `${label}: rejected rewrite leaves security metadata unchanged`);
    console.log(`PASS ${label}`);
  } finally {
    await db.close();
  }
}

for (const [migrationName, sql] of [['LF migration', lfBlock], ['CRLF migration', crlfBlock]]) {
  await runCombination(`${migrationName} × LF function`, sql, oldLf, '\n');
  await runCombination(`${migrationName} × CRLF function`, sql, oldCrlf, '\r\n');
}

const semanticDrift = oldLf.replace('where coalesce(a.present_in_drive, true)', 'where a.present_in_drive is true');
await assertRejected('semantic predicate drift', lfBlock, semanticDrift, '\n');
await assertRejected('duplicate LF target', lfBlock, [oldLf, oldLf], '\n');
await assertRejected('duplicate CRLF target', lfBlock, [oldCrlf, oldCrlf], '\r\n');
await assertRejected('mixed LF and CRLF targets', lfBlock, [oldLf, oldCrlf], '\n');
