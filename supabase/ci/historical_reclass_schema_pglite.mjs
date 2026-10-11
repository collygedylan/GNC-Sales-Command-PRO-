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
const { PGlite } = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'))('@electric-sql/pglite');
const db = new PGlite();
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
  console.log(`Historical V6 schema dependencies passed: ${dependencies.size} referenced master fields.`);
} finally { await db.close(); }
