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

  // Reproduce the old unbounded sweep bug, then verify the bounded shared helper.
  const cleanupMigration = fs.readFileSync('supabase/migrations/20261014140147_master_lineage_cleanup_bounded.sql','utf8');
  const cleanupHelper = cleanupMigration.match(/create or replace function private\.prune_expired_master_lineage_v1\(p_run_id uuid\)[\s\S]*?\$function\$;/i)?.[0];
  assert.ok(cleanupHelper, 'bounded lineage cleanup helper must be present in the migration');
  const aliasTable = sqlStatements(fs.readFileSync('supabase/migrations/20261009202507_prompt25_editable_field_shield_and_hold_clear.sql','utf8'))
    .find(statement => /^create table if not exists app_sync_private\.ph_master_inventory_item6_alias_seen_v7\s*\(/i.test(statement.trimStart()));
  assert.ok(aliasTable, 'v7 alias lineage table definition must be present');
  const v7Migration = fs.readFileSync('supabase/migrations/20261009202507_prompt25_editable_field_shield_and_hold_clear.sql','utf8');
  const v7SourceTable = sqlStatements(v7Migration).find(statement => /^create table if not exists app_sync_private\.ph_master_inventory_item6_source_v7\s*\(/i.test(statement.trimStart()));
  const v7EditsTable = sqlStatements(v7Migration).find(statement => /^create table if not exists app_sync_private\.ph_master_inventory_item6_edits_v7\s*\(/i.test(statement.trimStart()));
  const v6AckGuard = sqlStatements(fs.readFileSync('supabase/migrations/20261009053030_smart_shield_raw_import_acknowledgment.sql','utf8'))
    .find(statement => /^create or replace function private\.guard_ph_master_inventory_priority_hold_v1\s*\(/i.test(statement.trimStart()));
  const v7AliasResolver = sqlStatements(v7Migration)
    .find(statement => /^create or replace function private\.resolve_ph_master_inventory_item6_alias_v7\s*\(/i.test(statement.trimStart()));
  assert.ok(v7SourceTable && v7EditsTable && v6AckGuard && v7AliasResolver, 'deployed guard fixtures must be extractable');
  await db.exec(`do $$ begin
      create role anon; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role; exception when duplicate_object then null; end $$;
    ${v7SourceTable}
    ${v7EditsTable}
    ${aliasTable}
    ${v6AckGuard}
    ${v7AliasResolver}`);
  const migrationStatements = sqlStatements(cleanupMigration);
  const guardMismatchBlock = migrationStatements.find(statement => statement.includes('MASTER_LINEAGE_CLEANUP_GUARD_MISMATCH'));
  assert.ok(guardMismatchBlock, 'migration must retain its fail-closed guard verification');
  const readGuardDefinitions = async () => (await db.query(`select
    pg_get_functiondef('private.guard_ph_master_inventory_priority_hold_v1()'::regprocedure) as v6,
    pg_get_functiondef('private.resolve_ph_master_inventory_item6_alias_v7()'::regprocedure) as v7`)).rows[0];
  for (const statement of migrationStatements) await db.exec(statement);
  const patchedGuards = await readGuardDefinitions();
  assert.match(patchedGuards.v6, /perform private\.prune_expired_master_lineage_v1\(import_run_id\);/);
  assert.match(patchedGuards.v7, /perform private\.prune_expired_master_lineage_v1\(v_run_id\);/);
  assert.doesNotMatch(patchedGuards.v6, /delete from app_sync_private\.ph_master_inventory_import_lineage_seen s\s+where s\.seen_at < clock_timestamp\(\) - interval '3 days';/);
  assert.doesNotMatch(patchedGuards.v7, /delete from app_sync_private\.ph_master_inventory_item6_alias_seen_v7 s\s+where s\.seen_at < clock_timestamp\(\)-interval '3 days';/);
  for (const statement of migrationStatements) await db.exec(statement);
  assert.deepEqual(await readGuardDefinitions(), patchedGuards, 'full migration must be idempotent against both deployed guards');

  const unchangedV6 = patchedGuards.v6;
  await db.exec(`create or replace function private.resolve_ph_master_inventory_item6_alias_v7()
    returns trigger language plpgsql security definer set search_path = '' as $function$ begin return new; end $function$`);
  await assert.rejects(db.exec(guardMismatchBlock), /MASTER_LINEAGE_CLEANUP_GUARD_MISMATCH/,
    'migration must fail closed when the deployed guard body is unexpected');
  await db.exec(patchedGuards.v7);
  assert.equal((await readGuardDefinitions()).v6, unchangedV6, 'failed mismatch check must not alter the other deployed guard');
  await db.exec(`${aliasTable}
    create table if not exists app_sync_private.import_leases(run_id uuid primary key);
    truncate app_sync_private.ph_master_inventory_import_lineage_seen;
    truncate app_sync_private.ph_master_inventory_item6_alias_seen_v7;
    insert into app_sync_private.import_leases(run_id) values('9b000000-0000-4000-8000-000000000003');
    insert into app_sync_private.ph_master_inventory_import_lineage_seen(run_id,canonical_unique_id,imported_unique_id,lineage_key,seen_at)
      values('9b000000-0000-4000-8000-000000000001','current-run','current-run','lineage',now()-interval '4 days');
    delete from app_sync_private.ph_master_inventory_import_lineage_seen where seen_at < clock_timestamp()-interval '3 days';`);
  const oldSweepRows = (await db.query("select count(*)::integer as count from app_sync_private.ph_master_inventory_import_lineage_seen where run_id='9b000000-0000-4000-8000-000000000001'")).rows[0].count;
  assert.notEqual(oldSweepRows, 1, 'old unbounded sweep must reproduce loss of an expired current-run marker');

  await db.exec(`truncate app_sync_private.ph_master_inventory_import_lineage_seen;
    truncate app_sync_private.ph_master_inventory_item6_alias_seen_v7;
    insert into app_sync_private.ph_master_inventory_import_lineage_seen(run_id,canonical_unique_id,imported_unique_id,lineage_key,seen_at)
      select md5('v6-old-'||g)::uuid,'v6-old-'||g,'v6-old-'||g,'lineage',now()-interval '4 days' from generate_series(1,501) g;
    insert into app_sync_private.ph_master_inventory_import_lineage_seen(run_id,canonical_unique_id,imported_unique_id,lineage_key,seen_at)
      values('9b000000-0000-4000-8000-000000000001','current-run','current-run','lineage',now()-interval '4 days'),
        ('9b000000-0000-4000-8000-000000000003','leased-run','leased-run','lineage',now()-interval '4 days');
    insert into app_sync_private.ph_master_inventory_item6_alias_seen_v7(run_id,canonical_unique_id,imported_unique_id,stable_identity_key,seen_at)
      select md5('v7-old-'||g)::uuid,'v7-old-'||g,'v7-old-'||g,'identity',now()-interval '4 days' from generate_series(1,501) g;
    insert into app_sync_private.ph_master_inventory_item6_alias_seen_v7(run_id,canonical_unique_id,imported_unique_id,stable_identity_key,seen_at)
      values('9b000000-0000-4000-8000-000000000001','current-run','current-run','identity',now()-interval '4 days'),
        ('9b000000-0000-4000-8000-000000000003','leased-run','leased-run','identity',now()-interval '4 days');
    begin;
    select private.prune_expired_master_lineage_v1('9b000000-0000-4000-8000-000000000001');`);
  for (const table of ['ph_master_inventory_import_lineage_seen','ph_master_inventory_item6_alias_seen_v7']) {
    const protectedCount = (await db.query(`select count(*)::integer as count from app_sync_private.${table} where run_id in ('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000003')`)).rows[0].count;
    const remainingOld = (await db.query(`select count(*)::integer as count from app_sync_private.${table} where seen_at < now()-interval '3 days' and run_id not in ('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000003')`)).rows[0].count;
    assert.equal(protectedCount,2,`${table} must retain current-run and leased lineage`);
    assert.equal(remainingOld,1,`${table} cleanup must be bounded to 500 rows per call`);
    await db.exec(`insert into app_sync_private.${table}(run_id,canonical_unique_id,imported_unique_id,${table.includes('alias')?'stable_identity_key':'lineage_key'},seen_at)
      values('9b000000-0000-4000-8000-000000000004','inserted-after-first-sweep','inserted-after-first-sweep','identity',now()-interval '4 days');
      select private.prune_expired_master_lineage_v1('9b000000-0000-4000-8000-000000000001');`);
    const laterMarker = (await db.query(`select count(*)::integer as count from app_sync_private.${table} where run_id='9b000000-0000-4000-8000-000000000004'`)).rows[0].count;
    assert.equal(laterMarker,1,`${table} must sweep at most once per run per transaction`);
  }
  await db.exec('commit; begin; select private.prune_expired_master_lineage_v1(\'9b000000-0000-4000-8000-000000000001\'); commit;');
  for (const table of ['ph_master_inventory_import_lineage_seen','ph_master_inventory_item6_alias_seen_v7']) {
    assert.equal((await db.query(`select count(*)::integer as count from app_sync_private.${table} where seen_at < now()-interval '3 days' and run_id not in ('9b000000-0000-4000-8000-000000000001','9b000000-0000-4000-8000-000000000003')`)).rows[0].count,0,
      `${table} must resume bounded cleanup in the next transaction`);
  }
  console.log(`Historical V6 schema dependencies passed: ${dependencies.size} referenced master fields.`);
  console.log('Historical V6 fixtures passed: immutable IDs, replaced rows, retained evidence, strict V4 wrapper paths, and all V3/V4 registry entries.');
  console.log('Master lineage cleanup fixtures passed: old-sweep regression reproduced; current/leased markers retained; cleanup bounded per table and run-scoped per transaction.');
} finally { await db.close(); }
