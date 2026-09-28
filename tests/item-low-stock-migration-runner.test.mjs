import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateDatabaseTarget, migrationBody, applyItemLowStockMigration } from '../scripts/apply-item-low-stock-migration.mjs';

test('migration target is the configured Supabase project and never a browser key', () => {
  const api='https://testproject.supabase.co';
  assert.ok(validateDatabaseTarget('postgresql://postgres:example@db.testproject.supabase.co:5432/postgres',api));
  assert.ok(validateDatabaseTarget('postgresql://postgres.testproject:example@aws-0-us-east-1.pooler.supabase.com:5432/postgres',api));
  assert.throws(()=>validateDatabaseTarget('',api),/DB_URL_MISSING/);
  assert.throws(()=>validateDatabaseTarget('postgresql://postgres:example@db.other.supabase.co/postgres',api),/TARGET_MISMATCH/);
  assert.throws(()=>validateDatabaseTarget('postgresql://postgres.other:example@aws-0-us-east-1.pooler.supabase.com/postgres',api),/TARGET_MISMATCH/);
  assert.match(validateDatabaseTarget('postgresql://postgres:example@db.testproject.supabase.co/postgres',api),/sslmode=require/);
  assert.throws(()=>validateDatabaseTarget('postgresql://postgres:example@db.testproject.supabase.co/postgres?host=other.example',api),/TARGET_INVALID/);
  assert.throws(()=>validateDatabaseTarget('postgresql://postgres:example@db.testproject.supabase.co/postgres?sslmode=disable',api),/TLS_REQUIRED/);
});
test('migration and history entry are atomic and a retry verifies the same contents', async () => {
  const source='begin;\nselect 42;\ncommit;';
  const queries=[];
  const client={query:async(sql,params)=>{queries.push({sql,params});return{rows:sql.startsWith('select name')?[]:sql.startsWith('select to_regprocedure')?[{installed:true}]:[]};}};
  assert.equal((await applyItemLowStockMigration({client,source})).status,'applied');
  assert.equal(queries[0].sql,'begin');assert.equal(queries.at(-1).sql,'commit');
  assert.equal(queries.find(q=>q.sql.startsWith('insert into')).params[2][0],migrationBody(source));
  const retry={query:async(sql)=>({rows:sql.startsWith('select name')?[{name:'item_low_stock_targets',statements:[migrationBody(source)]}]:sql.startsWith('select to_regprocedure')?[{installed:true}]:[]})};
  assert.equal((await applyItemLowStockMigration({client:retry,source})).status,'already_applied');
  assert.throws(()=>migrationBody('select 1'),/TRANSACTION_REQUIRED/);
});
test('SQL errors roll back without committing the migration history', async()=>{
  const calls=[]; const client={query:async(sql)=>{calls.push(sql);if(sql==='select broken;')throw Error('failure');return{rows:[]};}};
  await assert.rejects(applyItemLowStockMigration({client,source:'begin;\nselect broken;\ncommit;'}));
  assert.equal(calls.at(-1),'rollback');assert.ok(!calls.includes('commit'));
});
test('cloud rollout verifies the existing release proof before schema and importer publication',()=>{
  const workflow=fs.readFileSync('.github/workflows/apps-script-sync.yml','utf8');
  assert.ok(workflow.indexOf('Recheck current main and release proof')<workflow.indexOf('Apply the item low-stock schema'));
  assert.ok(workflow.indexOf('apply-item-low-stock-migration.mjs\n')<workflow.indexOf('Sync Code.gs into Apps Script'));
  assert.match(workflow,/SUPABASE_DB_URL: \$\{\{ secrets\.SUPABASE_DB_URL \}\}/);
});
