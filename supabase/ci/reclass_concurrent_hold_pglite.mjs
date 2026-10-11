// Execute the production hold-date write against disposable PostgreSQL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const args = process.argv.slice(2);
const dependencyRoot = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !dependencyRoot) throw new Error('Pass --pglite-root');
const { PGlite } = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'))('@electric-sql/pglite');
const db = new PGlite();
try {
  const sql = fs.readFileSync('supabase/migrations/20261011223000_reclass_concurrent_hold_rows.sql', 'utf8');
  const columns = [...new Set([...sql.matchAll(/row_value\.(\w+)/g)].map(match => match[1]).concat('holdstopbegindate'))];
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private;
    create function auth.role() returns text language sql as $$select current_setting('test.role',true)$$;
    create table public.ph_master_inventory (${columns.map(name => name + (name === 'last_updated' ? ' timestamptz' : ' text')).join(',')});
    create table public.app_dataset_revisions(key text primary key,revision bigint,state text);
    insert into public.app_dataset_revisions values('ph_master_inventory',1,'ready');
    insert into public.ph_master_inventory(unique_id,priority) values('hold-origin','3');`);
  await db.exec(sql);
  const edit = (code, reason, priorCode = null, priorReason = null) => [{ unique_id: 'hold-origin',
    expected: { priority: '3', holdstopcode: priorCode, holdstopreason: priorReason },
    target: { priority: '3', holdstopcode: code, holdstopreason: reason } }];
  const apply = value => db.query('select private.apply_ph_master_inventory_live_edits_v6($1::jsonb)', [JSON.stringify(value)]);
  await db.exec("select set_config('test.role','authenticated',false)");
  await assert.rejects(apply(edit('H','Inspect')), /LIVE_EDIT_FORBIDDEN/);
  await db.exec("select set_config('test.role','service_role',false)");
  await apply(edit('H','Inspect'));
  const row = async () => (await db.query("select holdstopcode,holdstopreason,holdstopbegindate,to_char(clock_timestamp() at time zone 'America/Chicago','YYYY-MM-DD') as today from public.ph_master_inventory")).rows[0];
  assert.equal((await row()).holdstopbegindate, (await row()).today);
  await assert.rejects(apply(edit('S','Incorrect stale read')), /LIVE_EDIT_CONFLICT/);
  assert.equal((await row()).holdstopcode, 'H');
  await apply(edit('S','Stop shipping','H','Inspect'));
  assert.equal((await row()).holdstopbegindate, (await row()).today);
  await apply(edit(null,null,'S','Stop shipping'));
  assert.equal((await row()).holdstopbegindate, null);
  assert.ok(!sql.includes('MOVE_UP_HOLD_CONFLICT'));
  await db.exec(sql);
  console.log('Concurrent hold migration passed: authorization, stamped dates, stale reads, stop, clear, repeat execution.');
} finally { await db.close(); }
