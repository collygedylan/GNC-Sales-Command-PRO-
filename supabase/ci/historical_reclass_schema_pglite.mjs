// Check V6's complete master-row dependency against the historical replay schema.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { sqlStatements } from '../../scripts/database-catalog.mjs';
import { readHistoricalMigrationManifest } from '../../scripts/historical-database-fixture.mjs';

const args = process.argv.slice(2);
const dependencyRoot = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !dependencyRoot) throw new Error('Pass --pglite-root');
const require = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const db = new PGlite({ extensions: { pgcrypto } });
try {
  const source = fs.readFileSync('supabase/ci/request_workflow_baseline.sql', 'utf8');
  await db.exec(source.match(/create table if not exists public\.ph_master_inventory\s*\([\s\S]*?\n\);/i)[0]);
  for (const entry of readHistoricalMigrationManifest()) {
    if (entry.destination >= '20261009053029_reclass_smart_priority_hold_shield_v6.sql') break;
    for (const statement of sqlStatements(fs.readFileSync(entry.source, 'utf8'))) {
      const clean = statement.replace(/--[^\r\n]*/g, '').trim();
      if (/^alter table public\.ph_master_inventory\b/i.test(clean) && /\badd\s+column\b/i.test(clean)) await db.exec(clean);
    }
  }
  const fields = new Map((await db.query("select column_name,data_type from information_schema.columns where table_schema='public' and table_name='ph_master_inventory'")).rows.map(row => [row.column_name,row.data_type]));
  const v6 = fs.readFileSync('supabase/migrations/20261009053029_reclass_smart_priority_hold_shield_v6.sql', 'utf8');
  const dependencies = new Set([...v6.matchAll(/\b(?:new|old|row_value|m)\.(\w+)/g)].map(match => match[1]));
  dependencies.add('concat'); // UPDATE target has no row alias qualifier.
  assert.deepEqual([...dependencies].filter(name => !fields.has(name)), [], 'V6 master fields must exist before replay');
  assert.equal(fields.get('hold_release_approved_at'), 'timestamp with time zone');
  assert.equal(fields.get('concat'), 'text');
  await db.exec(`create schema private; create schema app_sync_private; create schema auth; create schema extensions;
    create extension pgcrypto with schema extensions;
    create function auth.role() returns text language sql as $$select coalesce(current_setting('request.jwt.claim.role',true),'')$$;
    create table app_sync_private.import_runs(id uuid primary key,canonical_keys text[],state text,expires_at timestamptz);
    create table public.profiles(id uuid primary key);
    create table public.ph_eval_work(id uuid primary key);
    create table public.ph_request_delivery_outbox(event_id uuid primary key);
    create function public.ok(boolean,text) returns boolean language sql as $$select $1$$;
    create function public.is(integer,integer,text) returns boolean language sql as $$select $1=$2$$;
    create table private.app_access_legacy_checks(check_key text primary key,permission_key text,enforcement_surface text,notes text);`);
  const v6Statements = sqlStatements(v6);
  for (const statement of v6Statements) {
    if (/create table if not exists app_sync_private\.ph_master_inventory_(?:app_edits|import_lineage_seen|source_baselines)\s*\(/i.test(statement)
      || /create or replace function private\.(?:ph_master_inventory_lineage_key_v1|ph_master_inventory_import_run_v1|guard_ph_master_inventory_priority_hold_v1)\s*\(/i.test(statement)) await db.exec(statement);
  }
  await db.exec(`create trigger v6_identity_guard before insert or update or delete on public.ph_master_inventory
    for each row execute function private.guard_ph_master_inventory_priority_hold_v1();
    insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,contsize,priority,spec)
      values('SP-X-3','SP-ITEM-X','C.01.001','27.F1','#3','3','retained evidence');`);
  await assert.rejects(db.query("update public.ph_master_inventory set unique_id='SP-X-3-NEW' where unique_id='SP-X-3'"), /MASTER_PRIORITY_HOLD_IDENTITY_IMMUTABLE/);
  const managerFixture = fs.readFileSync('supabase/tests/manager_season_priority_test.sql','utf8');
  const replacement = managerFixture.match(/delete from public\.ph_master_inventory where unique_id='SP-X-3' returning \* into replacement_row;[\s\S]*?insert into public\.ph_master_inventory select \(replacement_row\)\.\*;/)[0];
  await db.exec(`do $$declare replacement_row public.ph_master_inventory; begin ${replacement} end $$;`);
  assert.deepEqual((await db.query('select unique_id,priority,spec from public.ph_master_inventory')).rows,
    [{unique_id:'SP-X-3-NEW',priority:'1',spec:'retained evidence'}]);

  const v5 = fs.readFileSync('supabase/migrations/20261008190038_reclass_sheared_action_v5.sql','utf8');
  for (const statement of sqlStatements(v5)) if (/create or replace function public\.submit_eval_work_v[12]\s*\(/i.test(statement)) await db.exec(statement);
  for (const statement of v6Statements) if (/alter function (?:public|private)\.submit_eval_work_v[12]\(/i.test(statement)
    || /create or replace function public\.submit_eval_work_v[12]\s*\(/i.test(statement)) await db.exec(statement);
  for (const statement of sqlStatements(fs.readFileSync('supabase/tests/reclass_split_move_v4_test.sql','utf8'))) {
    if (!statement.includes("'EvalWork finalization enforces strict V4 validation'") && !statement.includes("'multi-origin EvalWork finalization enforces strict V4 validation'")) continue;
    assert.equal((await db.query(statement)).rows[0].ok,true);
  }
  for (const file of ['supabase/archive_migrations/20260903032040_protected_drive_reclass_inquiry_v1.sql',
    'supabase/migrations/20261006145333_reclass_split_move_inquiries_v4.sql',
    'supabase/migrations/20261008190038_reclass_sheared_action_v5.sql',
    'supabase/migrations/20261009053029_reclass_smart_priority_hold_shield_v6.sql']) {
    for (const statement of sqlStatements(fs.readFileSync(file,'utf8'))) if (/insert into private\.app_access_legacy_checks\s*\(/i.test(statement)) await db.exec(statement);
  }
  const registryCheck = sqlStatements(fs.readFileSync('supabase/tests/drive_reclass_protected_test.sql','utf8')).find(statement => statement.includes('client and V3/V4 edge and RPC enforcement surfaces are registered'));
  assert.equal((await db.query(registryCheck)).rows[0].is,true);
  assert.equal((await db.query("select count(*)::integer as count from private.app_access_legacy_checks where permission_key='drive.reclass.submit'")).rows[0].count,9);
  console.log(`Historical V6 schema dependencies passed: ${dependencies.size} referenced master fields.`);
  console.log('Historical V6 fixtures passed: immutable IDs, replaced rows, retained evidence, strict V4 wrapper paths, and all V3/V4 registry entries.');
} finally { await db.close(); }
