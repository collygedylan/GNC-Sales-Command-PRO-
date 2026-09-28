import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { X509Certificate } from 'node:crypto';
import pg from 'pg';
import {
  validateDatabaseTarget, migrationBody, applyItemLowStockMigration,
  classifyDatabaseError, formatSafeFailure, runReadOnlySchemaDiagnostic, validateDiagnosticContext,
  createDatabaseClientOptions
} from '../scripts/apply-item-low-stock-migration.mjs';

test('migration target is the configured Supabase project and never a browser key', () => {
  const api='https://testproject.supabase.co';
  assert.ok(validateDatabaseTarget('postgresql://postgres:example@db.testproject.supabase.co:5432/postgres',api));
  assert.ok(validateDatabaseTarget('postgresql://postgres.testproject:example@aws-0-us-east-1.pooler.supabase.com:5432/postgres',api));
  assert.throws(()=>validateDatabaseTarget('',api),/DB_URL_MISSING/);
  assert.throws(()=>validateDatabaseTarget('postgresql://postgres:example@db.other.supabase.co/postgres',api),/TARGET_MISMATCH/);
  assert.throws(()=>validateDatabaseTarget('postgresql://postgres.other:example@aws-0-us-east-1.pooler.supabase.com/postgres',api),/TARGET_MISMATCH/);
  assert.match(validateDatabaseTarget('postgresql://postgres:example@db.testproject.supabase.co/postgres',api),/sslmode=verify-full/);
  assert.throws(()=>validateDatabaseTarget('postgresql://postgres:example@db.testproject.supabase.co/postgres?host=other.example',api),/TARGET_INVALID/);
  assert.throws(()=>validateDatabaseTarget('postgresql://postgres:example@db.testproject.supabase.co/postgres?sslmode=disable',api),/TLS_REQUIRED/);
});
test('Postgres client pins the Supabase CA and ignores URI TLS overrides while preserving connection identity', () => {
  const api='https://testproject.supabase.co';
  const raw='postgresql://postgres.testproject:p%40ss%2Fword@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require&sslrootcert=system&sslcert=%2Ftmp%2Fattacker.crt&sslkey=%2Ftmp%2Fattacker.key&uselibpqcompat=true&application_name=low-stock-test';
  const validated=validateDatabaseTarget(raw,api);
  assert.equal(new URL(validated).searchParams.get('sslmode'),'verify-full');
  const options=createDatabaseClientOptions(validated);
  const client=new pg.Client(options);
  const params=client.connectionParameters;
  assert.equal(params.host,'aws-0-us-east-1.pooler.supabase.com');
  assert.equal(params.port,5432);
  assert.equal(params.user,'postgres.testproject');
  assert.equal(params.password,'p@ss/word');
  assert.equal(params.database,'postgres');
  assert.equal(params.ssl.servername,'aws-0-us-east-1.pooler.supabase.com');
  assert.equal(params.ssl.rejectUnauthorized,true);
  assert.equal(params.ssl.checkServerIdentity,undefined,'retain the TLS library hostname verifier');
  assert.match(params.ssl.ca,/BEGIN CERTIFICATE/);
  assert.equal(params.application_name,'low-stock-test');
  assert.doesNotMatch(options.connectionString,/sslmode|sslrootcert|sslcert|sslkey|uselibpqcompat/i);

  const cert = new X509Certificate(params.ssl.ca);
  assert.equal(cert.fingerprint256,'80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
  assert.equal(cert.subject,cert.issuer);
  assert.match(cert.subject,/Supabase Root 2021 CA/);
  assert.equal(cert.ca,true);
  assert.equal(cert.verify(cert.publicKey),true);
  assert.ok(Date.parse(cert.validTo)>Date.now());
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
test('migration failure reports a useful phase and safe code without leaking database error text',async()=>{
  const calls=[];let phase='database_connect';
  const secret='postgresql://postgres:secret-password@db.testproject.supabase.co:5432/postgres?sslmode=require';
  const hostile=new Error(`password=secret-password ${secret} internal stack detail`);
  hostile.code='28P01';
  const client={query:async(sql)=>{calls.push(sql);if(sql==='select broken;')throw hostile;return{rows:[]};}};
  await assert.rejects(applyItemLowStockMigration({client,source:'begin;\nselect broken;\ncommit;',onPhase:value=>{phase=value;}}));
  assert.equal(phase,'migration_sql');
  const line=formatSafeFailure({phase,error:hostile,connectionString:secret});
  assert.equal(line,'LOW_STOCK_SCHEMA_APPLY_FAILED phase=migration_sql error_class=postgres error_code=28P01 route=direct port=5432 sslmode=require');
  assert.ok(!line.includes('secret-password'));assert.ok(!line.includes('testproject'));assert.ok(!line.includes('internal stack'));
  assert.equal(calls.at(-1),'rollback');
});
test('sanitizer classifies only allowlisted transport/TLS codes and does not serialize malicious fields',()=>{
  assert.deepEqual(classifyDatabaseError(Object.assign(new Error('private message'),{code:'ENOTFOUND'})),{errorClass:'network',errorCode:'ENOTFOUND'});
  assert.deepEqual(classifyDatabaseError(Object.assign(new Error('private message'),{code:'ERR_TLS_CERT_ALTNAME_INVALID'})),{errorClass:'tls',errorCode:'ERR_TLS_CERT_ALTNAME_INVALID'});
  assert.deepEqual(classifyDatabaseError(Object.assign(new Error('private message'),{code:'ECONNRESET; token=secret'})),{errorClass:'other',errorCode:''});
  assert.deepEqual(classifyDatabaseError(Object.assign(new Error('private message'),{code:'EPIPE'})),{errorClass:'network',errorCode:'EPIPE'});
  const output=formatSafeFailure({phase:'schema_probe',error:new Error('postgres://user:password@secret.internal/stack')});
  assert.equal(output,'LOW_STOCK_SCHEMA_APPLY_FAILED phase=schema_probe error_class=other');
  assert.ok(!output.includes('secret'));
  const crafted=formatSafeFailure({phase:'schema_probe',error:new Error('LOW_STOCK_SECRET'),connectionString:'postgresql://u:p@attacker.invalid/postgres?sslmode=token'});
  assert.equal(crafted,'LOW_STOCK_SCHEMA_APPLY_FAILED phase=schema_probe error_class=other route=unknown port=5432 sslmode=other');
});
test('read-only diagnostic uses only a read-only transaction and preserves the probe error if rollback fails',async()=>{
  // Session-wide settings can persist on pooled backend connections. The
  // diagnostic must scope read-only behavior to its own transaction.
  const runner=fs.readFileSync('scripts/apply-item-low-stock-migration.mjs','utf8');
  assert.doesNotMatch(runner,/default_transaction_read_only|set session characteristics/i);
  const statements=[];
  const client={query:async(sql)=>{statements.push(sql);if(sql==='begin read only')return{rows:[]};if(sql.startsWith('select to_regprocedure'))return{rows:[{installed:true}]};if(sql==='rollback')return{rows:[]};throw new Error('unexpected write');}};
  const phases=[];
  assert.deepEqual(await runReadOnlySchemaDiagnostic({client,onPhase:phase=>phases.push(phase)}),{installed:true});
  assert.deepEqual(statements,['begin read only',"select to_regprocedure('public.get_eval_item_low_stock_targets_v1(text[],text,integer)') is not null as installed",'rollback']);
  assert.deepEqual(phases,['transaction_begin','schema_probe','transaction_rollback']);

  const original=Object.assign(new Error('sensitive probe details'),{code:'42501'});const failedPhases=[];
  const failing={query:async(sql)=>{if(sql==='begin read only')return{rows:[]};if(sql.startsWith('select to_regprocedure'))throw original;if(sql==='rollback')throw new Error('rollback secret');throw new Error('unexpected write');}};
  await assert.rejects(runReadOnlySchemaDiagnostic({client:failing,onPhase:phase=>failedPhases.push(phase)}),error=>error===original);
  assert.equal(failedPhases.at(-1),'schema_probe');
});
test('diagnostic guard accepts only cloud workflow_dispatch on main and binds diagnostic workflow identity',()=>{
  const env={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:'owner/repo',GITHUB_SHA:'a'.repeat(40),GITHUB_REF:'refs/heads/main',GITHUB_WORKFLOW_REF:'owner/repo/.github/workflows/apps-script-database-diagnostic.yml@refs/heads/main'};
  assert.equal(validateDiagnosticContext(env).sha,'a'.repeat(40));
  assert.throws(()=>validateDiagnosticContext({...env,GITHUB_EVENT_NAME:'push'}),/DIAGNOSTIC_CONTEXT_INVALID/);
  assert.throws(()=>validateDiagnosticContext({...env,GITHUB_REF:'refs/heads/feature/diagnose'}),/DIAGNOSTIC_CONTEXT_INVALID/);
  assert.throws(()=>validateDiagnosticContext({...env,GITHUB_REF:'refs/heads/codex/diagnose'}),/DIAGNOSTIC_CONTEXT_INVALID/);
  assert.throws(()=>validateDiagnosticContext({...env,GITHUB_SHA:'short'}),/DIAGNOSTIC_CONTEXT_INVALID/);
  assert.throws(()=>validateDiagnosticContext({...env,GITHUB_WORKFLOW_REF:'owner/repo/.github/workflows/apps-script-sync.yml@refs/heads/main'}),/DIAGNOSTIC_WORKFLOW_INVALID/);
});

test('failed migration rollback preserves the original SQL error', async()=>{
  const original=Object.assign(new Error('private SQL details'),{code:'42501'});
  const client={query:async(sql)=>{
    if(sql==='select broken;')throw original;
    if(sql==='rollback')throw new Error('private rollback details');
    return{rows:[]};
  }};
  await assert.rejects(applyItemLowStockMigration({client,source:'begin;\nselect broken;\ncommit;'}),error=>error===original);
});
test('cloud rollout verifies the existing release proof before schema and importer publication',()=>{
  const workflow=fs.readFileSync('.github/workflows/apps-script-sync.yml','utf8');
  assert.ok(workflow.indexOf('Recheck current main and release proof')<workflow.indexOf('Apply the item low-stock schema'));
  assert.ok(workflow.indexOf('apply-item-low-stock-migration.mjs\n')<workflow.indexOf('Sync Code.gs into Apps Script'));
  assert.match(workflow,/SUPABASE_DB_URL: \$\{\{ secrets\.SUPABASE_DB_URL \}\}/);
});
