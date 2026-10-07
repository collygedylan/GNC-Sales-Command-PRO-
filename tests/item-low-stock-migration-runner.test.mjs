import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { X509Certificate } from 'node:crypto';
import pg from 'pg';
import yaml from 'js-yaml';
import {
  validateDatabaseTarget, migrationBody, applyItemLowStockMigration, migrationName,
  perennialAssignmentMigrationName, passwordReconciliationMigrationName, productionScheduleMigrationName, auraHrCommandCenterMigrationName, scheduledHandoverMigrationName, requestArchiveMigrationName, handoverAssignmentMigrationName, readOptimizationMigrationName, auraInventoryV2MigrationName, nellyAccessAuditMigrationName, evalDeliveryArchiveHealthMigrationName, auraInventoryMatchMigrationName, auraLlmFreeTierMigrationName, suspendTagApprovalMigrationName, structuredBunchNotesMigrationName, bunchNoteCardsMigrationName, bunchNoteCardCommandsMigrationName, reclassSplitMoveMigrationName, reclassEvalSubmitGuardsMigrationName, inventoryRowAssignmentAuthorityMigrationName, itemcodeDefaultOwnersMigrationName, inventoryRowAssignmentFenceIntegrationMigrationName, inventoryRowAssignmentFutureSnapshotsMigrationName, inventoryRowAssignmentLiveConsumersMigrationName, auraInternalQueryMigrationName, releaseDatabaseMigrations, migrationContractQuery, upsertVaultSecret,
  productionBaselineVersion,
  classifyDatabaseError, formatSafeFailure, runReadOnlySchemaDiagnostic, validateDiagnosticContext,
  createDatabaseClientOptions
} from '../scripts/apply-item-low-stock-migration.mjs';
import { perennialPreviewSql, runPerennialAssignmentPreview, getPerennialPreviewFailure } from '../scripts/preview-perennial-assignment.mjs';

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

test('handover release requires an armed minute job or an already completed Auth ban', () => {
  const query = migrationContractQuery(scheduledHandoverMigrationName);
  assert.match(query, /completed_at is not null and auth_banned_at is not null/);
  assert.match(query, /jobname='scheduled_handover_kayla_nelly_20261002' and active and schedule='\* \* \* \* \*'/);
  assert.match(query, /command='select private\.scheduled_handover_dispatch_v1\(\);'/);
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

test('consolidated production baseline satisfies archived migrations without replay or ledger writes', async () => {
  assert.equal(productionBaselineVersion, '20260929200000');
  for (const targetMigrationName of [migrationName, perennialAssignmentMigrationName, passwordReconciliationMigrationName]) {
    const queries = [];
    const client = { query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith('select name, statements')) return { rows: [] };
      if (sql === 'select name from supabase_migrations.schema_migrations where version = $1') {
        assert.deepEqual(params, [productionBaselineVersion]);
        return { rows: [{ name: 'production_baseline' }] };
      }
      if (sql === migrationContractQuery(targetMigrationName)) return { rows: [{ installed: true }] };
      return { rows: [] };
    } };
    const result = await applyItemLowStockMigration({ client, source: 'begin; select should_not_run; commit;', targetMigrationName });
    assert.equal(result.status, 'included_in_baseline');
    assert.equal(queries.at(-1).sql, 'commit');
    assert.ok(!queries.some(({ sql }) => sql.includes('should_not_run') || sql.startsWith('insert into')));
  }
});

test('Production Schedule migration applies additively after an older consolidated baseline', async () => {
  const queries = [];
  const client = { query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.startsWith('select name, statements')) return { rows: [] };
    if (sql === 'select name from supabase_migrations.schema_migrations where version = $1') {
      return { rows: [{ name: 'production_baseline' }] };
    }
    if (sql === migrationContractQuery(productionScheduleMigrationName)) return { rows: [{ installed: true }] };
    return { rows: [] };
  } };
  const result = await applyItemLowStockMigration({
    client, source: 'begin; select schedule_schema; commit;', targetMigrationName: productionScheduleMigrationName,
  });
  assert.equal(result.status, 'applied');
  assert.ok(queries.some(({ sql }) => sql === 'select schedule_schema;'));
  assert.ok(queries.some(({ sql, params }) => sql.startsWith('insert into supabase_migrations.schema_migrations') && params[0] === '20261001012038'));
});

test('release migration sources satisfy the atomic production runner contract', () => {
  for (const name of [productionScheduleMigrationName, auraHrCommandCenterMigrationName, scheduledHandoverMigrationName, requestArchiveMigrationName, handoverAssignmentMigrationName]) {
    const source = fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
    const body = migrationBody(source);
    assert.ok(body.trim().length > 0, `${name} contains a migration body`);
    assert.doesNotMatch(body, /^\s*(?:begin|commit)\s*;/i, `${name} has one outer transaction`);
  }
});

test('baseline path fails closed when its identity or required contract is missing', async () => {
  for (const [baselineName, installed, expected] of [
    ['unexpected_baseline', true, /MIGRATION_HISTORY_MISMATCH/],
    ['production_baseline', false, /DATABASE_CONTRACT_MISSING/]
  ]) {
    const queries = [];
    const client = { query: async (sql) => {
      queries.push(sql);
      if (sql.startsWith('select name, statements')) return { rows: [] };
      if (sql === 'select name from supabase_migrations.schema_migrations where version = $1') return { rows: [{ name: baselineName }] };
      if (sql === migrationContractQuery(migrationName)) return { rows: [{ installed }] };
      return { rows: [] };
    } };
    await assert.rejects(applyItemLowStockMigration({ client, source: 'begin; select should_not_run; commit;' }), expected);
    assert.equal(queries.at(-1), 'rollback');
    assert.ok(!queries.some(sql => sql.includes('should_not_run') || sql.startsWith('insert into')));
  }
});
test('release schema handoff applies the perennial override after low-stock and verifies its exact database contract',async()=>{
  assert.deepEqual(releaseDatabaseMigrations,[migrationName,perennialAssignmentMigrationName,passwordReconciliationMigrationName,productionScheduleMigrationName,auraHrCommandCenterMigrationName,scheduledHandoverMigrationName,requestArchiveMigrationName, handoverAssignmentMigrationName, readOptimizationMigrationName, auraInventoryV2MigrationName, nellyAccessAuditMigrationName, evalDeliveryArchiveHealthMigrationName, auraInventoryMatchMigrationName, auraLlmFreeTierMigrationName, suspendTagApprovalMigrationName, structuredBunchNotesMigrationName, bunchNoteCardsMigrationName, bunchNoteCardCommandsMigrationName,reclassSplitMoveMigrationName,reclassEvalSubmitGuardsMigrationName,inventoryRowAssignmentAuthorityMigrationName,itemcodeDefaultOwnersMigrationName,inventoryRowAssignmentFenceIntegrationMigrationName,inventoryRowAssignmentFutureSnapshotsMigrationName,inventoryRowAssignmentLiveConsumersMigrationName,auraInternalQueryMigrationName]);
  assert.match(migrationContractQuery(perennialAssignmentMigrationName),/reconcile_eval_itemcodes\(uuid\)/);
  assert.match(migrationContractQuery(productionScheduleMigrationName),/production_schedule_start_import_v1/);
  const queries=[];const client={query:async(sql,params)=>{
    queries.push({sql,params});
    if(sql.startsWith('select name'))return{rows:[]};
    if(sql.includes('zone_override_active'))return{rows:[{installed:true}]};
    return{rows:[]};
  }};
  assert.equal((await applyItemLowStockMigration({client,source:'begin; select 9; commit;',targetMigrationName:perennialAssignmentMigrationName})).status,'applied');
  const history=queries.find(entry=>entry.sql.startsWith('insert into supabase_migrations'));
  assert.equal(history.params[0],perennialAssignmentMigrationName.split('_')[0]);
  assert.equal(history.params[1],'perennial_zone_assignment_override');
  assert.ok(queries.some(entry=>entry.sql===migrationContractQuery(perennialAssignmentMigrationName)));
  assert.throws(()=>migrationContractQuery('unlisted.sql'),/MIGRATION_HISTORY_MISMATCH/);
});
test('HR migration contract verifies partitioned labor tables and the scheduled reminder action', async () => {
  const contract = migrationContractQuery(auraHrCommandCenterMigrationName);
  assert.match(contract, /hr_calendar_reminder_sweep/);
  assert.match(contract, /hr_claim_calendar_reminders_v1/);
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: sql === contract ? [{ installed: true }] : [] };
  } };
  const result = await applyItemLowStockMigration({ client, source: 'begin; select hr_schema; commit;', targetMigrationName: auraHrCommandCenterMigrationName });
  assert.equal(result.status, 'applied');
  assert.ok(calls.some(({ sql }) => sql === 'select hr_schema;'));
  assert.equal(calls.find(({ sql }) => sql.startsWith('insert into supabase_migrations')).params[1], 'aura_hr_command_center_v1');
});

test('Bunch card release contracts require private RLS storage and a service-only command', async () => {
  const storage=migrationContractQuery(bunchNoteCardsMigrationName), command=migrationContractQuery(bunchNoteCardCommandsMigrationName);
  assert.match(storage,/relrowsecurity/);assert.match(storage,/not has_table_privilege\('authenticated'/);
  assert.match(storage,/bunch_note_batch_v5_cards/);assert.match(command,/bunch_note_card_command_v1/);
  assert.match(command,/not has_function_privilege\('authenticated'/);assert.match(command,/not has_function_privilege\('anon'/);
  for(const name of [bunchNoteCardsMigrationName,bunchNoteCardCommandsMigrationName]) {
    const contract=migrationContractQuery(name),calls=[];
    const client={query:async(sql,params)=>{calls.push({sql,params});return {rows:sql===contract?[{installed:true}]:[]};}};
    assert.equal((await applyItemLowStockMigration({client,source:'begin; select 1; commit;',targetMigrationName:name})).status,'applied');
    assert.ok(calls.some(c=>c.sql===contract));
  }
});

test('Reclass split-move V4 release contract is service-only and preserves legacy validation', async () => {
  const contract = migrationContractQuery(reclassSplitMoveMigrationName);
  assert.match(contract, /enqueue_drive_reclass_inquiry_v4/);
  assert.match(contract, /not has_function_privilege\('authenticated'/);
  assert.match(contract, /validate_eval_work_inquiry_legacy_v1/);
  const calls = [];
  const client = { query: async (sql) => { calls.push(sql); return { rows: sql === contract ? [{ installed: true }] : [] }; } };
  assert.equal((await applyItemLowStockMigration({ client, source: 'begin; select v4; commit;', targetMigrationName: reclassSplitMoveMigrationName })).status, 'applied');
  assert.ok(calls.includes(contract));
});

test('Reclass EvalWork submit guards retain service-only entry points and V4 content binding', async () => {
  const contract = migrationContractQuery(reclassEvalSubmitGuardsMigrationName);
  assert.match(contract,/submission_request_fingerprint/);
  assert.match(contract,/submit_eval_work_legacy_v1/);
  assert.match(contract,/not has_function_privilege\('service_role'/);
  const calls=[];
  const client={query:async(sql)=>{calls.push(sql);return {rows:sql===contract?[{installed:true}]:[]};}};
  assert.equal((await applyItemLowStockMigration({client,source:'begin; select eval_submit_guard; commit;',targetMigrationName:reclassEvalSubmitGuardsMigrationName})).status,'applied');
  assert.ok(calls.includes(contract));
});

test('archive-only health repair remains private and fails closed before publication', async () => {
  assert.ok(releaseDatabaseMigrations.indexOf(evalDeliveryArchiveHealthMigrationName) < releaseDatabaseMigrations.indexOf(auraInventoryMatchMigrationName));
  const contract = migrationContractQuery(evalDeliveryArchiveHealthMigrationName);
  assert.match(contract, /request_folder_archive_only_completed_v1/);
  assert.match(contract, /not prosecdef and provolatile='s'/);
  assert.match(contract, /archive_only_completed_folder_count/);
  assert.match(contract, /not has_function_privilege\('anon'/);
  assert.match(contract, /not has_function_privilege\('authenticated'/);
  for (const installed of [true, false]) {
    const calls = [];
    const client = { query: async (sql) => {
      calls.push(sql);
      return { rows: sql === contract ? [{ installed }] : [] };
    } };
    const operation = applyItemLowStockMigration({ client, source: 'begin; select health_repair; commit;',
      targetMigrationName: evalDeliveryArchiveHealthMigrationName });
    if (installed) {
      assert.equal((await operation).status, 'applied');
      assert.equal(calls.at(-1), 'commit');
    } else {
      await assert.rejects(operation, /LOW_STOCK_DATABASE_CONTRACT_MISSING/);
      assert.equal(calls.at(-1), 'rollback');
    }
  }
});

test('AURA name-match migration requires the private bounded RPC, four-second limit, and indexes', () => {
  const contract = migrationContractQuery(auraInventoryMatchMigrationName);
  assert.match(contract, /aura_inventory_v2_match_v1/);
  assert.match(contract, /statement_timeout=4s/);
  assert.match(contract, /idx_ph_master_inventory_aura_name_trgm/);
  assert.match(contract, /idx_ph_master_inventory_aura_season_size/);
  assert.ok(releaseDatabaseMigrations.indexOf(auraInventoryMatchMigrationName) > releaseDatabaseMigrations.indexOf(auraInventoryV2MigrationName));
});

test('audit repair is registered after the AURA migration and verifies identity and baseline completeness', async () => {
  assert.ok(releaseDatabaseMigrations.indexOf(nellyAccessAuditMigrationName) > releaseDatabaseMigrations.indexOf(auraInventoryV2MigrationName));
  const contract = migrationContractQuery(nellyAccessAuditMigrationName);
  assert.match(contract, /961b0a0f-11a6-4db5-b066-582f772ab8e7/);
  assert.match(contract, /nelly_aguilar/);
  assert.match(contract, /get_effective_app_permissions_v1/);
  assert.match(contract, /b\.permission_key is null/);
  for (const installed of [true, false]) {
    const calls = [];
    const client = { query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: sql === contract ? [{ installed }] : [] };
    } };
    const operation = applyItemLowStockMigration({ client, source: 'begin; select audit_repair; commit;',
      targetMigrationName: nellyAccessAuditMigrationName });
    if (installed) {
      assert.equal((await operation).status, 'applied');
      assert.equal(calls.at(-1).sql, 'commit');
    } else {
      await assert.rejects(operation, /LOW_STOCK_DATABASE_CONTRACT_MISSING/);
      assert.equal(calls.at(-1).sql, 'rollback');
    }
  }
});

test('HR migration lets pg_cron and pg_net create their own schemas', () => {
  const source = fs.readFileSync(new URL('../supabase/migrations/20261001025638_aura_hr_command_center_v1.sql', import.meta.url), 'utf8');
  assert.match(source, /create extension if not exists pg_cron\s*;/i);
  assert.match(source, /create extension if not exists pg_net with schema extensions\s*;/i);
  assert.doesNotMatch(source, /create schema if not exists (?:cron|net)\s*;/i);
  assert.match(source, /do \$\$\s*declare month_start date := date '2025-01-01';\s*month_end date;\s*partition_name text;\s*begin/i);
  assert.doesNotMatch(source, /alter table realtime\.messages enable row level security/i);
  assert.match(source, /create policy alpha_dylan_chat_realtime_select on realtime\.messages/i);
  assert.match(source, /create policy alpha_dylan_chat_realtime_insert on realtime\.messages/i);
});

test('reminder credentials are written through Vault create/update APIs without logging their values', async () => {
  const calls = [];
  const createClient = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [] };
  } };
  assert.equal(await upsertVaultSecret({ client: createClient, name: 'hr_calendar_project_url', value: 'https://example.supabase.co', description: 'test' }), 'created');
  assert.match(calls.at(-1).sql, /vault\.create_secret/);
  assert.ok(calls.at(-1).params.includes('https://example.supabase.co'));
  const updateClient = { query: async (sql, params) => {
    calls.push({ sql, params });
    return sql.startsWith('select id') ? { rows: [{ id: 'secret-id' }] } : { rows: [] };
  } };
  assert.equal(await upsertVaultSecret({ client: updateClient, name: 'hr_calendar_project_url', value: 'https://new.example.supabase.co' }), 'updated');
  assert.match(calls.at(-1).sql, /vault\.update_secret/);
  await assert.rejects(upsertVaultSecret({ client: createClient, name: 'bad-name', value: 'secret' }), /VAULT_SECRET_INPUT_INVALID/);
});
test('perennial production preview is aggregate only and rolls back its read-only transaction',async()=>{
  const calls=[];
  const client={query:async sql=>{
    calls.push(sql);
    if(sql==='begin read only'||sql==='rollback')return{rows:[]};
    assert.equal(sql,perennialPreviewSql);
    return{rows:[{inventory_revision:'22',inventory_state:'ready',preview_ready:true,itemcode_genus_groups:12,rose_exempt_groups:2,in_zone_policy_groups:3,
      unresolved_groups:1,outside_groups:6,rose_override_rows:1,mitch_active_roster_rows:1,conflicting_defaults:0,zoe_active_roster_rows:1,current_owner_changes_estimate:3,
      affected_assignments:[{itemcode:'A1',genus:'perennial',previousOwner:'owner1',proposedOwner:'zoe_green',ownerChange:true,
        automaticAssignment:true,reason:'enforce_perennial_zone_owner'}]}]};
  }};
  const preview=await runPerennialAssignmentPreview({client,repositorySha:'a'.repeat(40),generatedAt:'2026-09-28T12:00:00.000Z'});
  assert.deepEqual(calls,['begin read only',perennialPreviewSql,'rollback']);
  assert.equal(preview.counts.in_zone_policy_groups,3);
  assert.equal(preview.previewMode,'read_only_aggregate');
  assert.equal(preview.policyActivation,'requires_complete_snapshot_and_verified_backfill');
  assert.equal(preview.previewReady,true);
  assert.equal(getPerennialPreviewFailure(preview),'');
  assert.deepEqual(preview.affectedAssignments,[{itemcode:'A1',genus:'perennial',previousOwner:'owner1',proposedOwner:'zoe_green',ownerChange:true,
    automaticAssignment:true,reason:'enforce_perennial_zone_owner'}]);
  assert.doesNotMatch(JSON.stringify(preview),/Customer Name/i);
  assert.match(perennialPreviewSql,/135_ROSES/);
  assert.match(perennialPreviewSql,/private\.eval_location_zone/);
  assert.match(perennialPreviewSql,/preview_ready/);
});

test('password reconciliation is additive and verified before the existing backend publication', async () => {
  const query = migrationContractQuery(passwordReconciliationMigrationName);
  assert.match(query, /prepare_password_change_profile\(text,uuid,text\)/);
  assert.match(query, /complete_password_change_profile\(uuid,uuid,text,text\)/);
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: sql === query ? [{ installed: true }] : [] };
  } };
  await applyItemLowStockMigration({ client, source: 'begin; select 11; commit;', targetMigrationName: passwordReconciliationMigrationName });
  assert.equal(calls.at(-1).sql, 'commit');
  assert.equal(calls.find(call => call.sql.startsWith('insert into supabase_migrations')).params[1], 'password_change_profile_reconciliation');
  const workflow = fs.readFileSync('.github/workflows/release-database.yml', 'utf8');
  assert.ok(workflow.includes(passwordReconciliationMigrationName));
  assert.ok(workflow.includes('password_change_profile_reconciliation_test.sql'));
});
test('perennial preview withholds proposed owner details while a master import is partial',async()=>{
  const client={query:async sql=>({rows:sql==='begin read only'||sql==='rollback'?[]:[{inventory_revision:'23',inventory_state:'importing',preview_ready:false,
    itemcode_genus_groups:7,rose_exempt_groups:0,in_zone_policy_groups:1,unresolved_groups:2,outside_groups:4,
    rose_override_rows:1,mitch_active_roster_rows:1,conflicting_defaults:0,zoe_active_roster_rows:1,current_owner_changes_estimate:1,affected_assignments:[{itemcode:'SHOULD_NOT_ESCAPE'}]}]})};
  const preview=await runPerennialAssignmentPreview({client,repositorySha:'b'.repeat(40)});
  assert.equal(preview.previewReady,false);
  assert.deepEqual(preview.affectedAssignments,[]);
  assert.equal(getPerennialPreviewFailure(preview),'PERENNIAL_PREVIEW_MASTER_NOT_READY');
});
test('perennial preview blocks activation when Zoe is inactive for qualifying keys',async()=>{
  const client={query:async sql=>({rows:sql==='begin read only'||sql==='rollback'?[]:[{inventory_revision:'24',inventory_state:'ready',preview_ready:true,
    itemcode_genus_groups:7,rose_exempt_groups:1,in_zone_policy_groups:2,unresolved_groups:1,outside_groups:3,
    rose_override_rows:1,mitch_active_roster_rows:1,conflicting_defaults:0,zoe_active_roster_rows:0,current_owner_changes_estimate:2,
    affected_assignments:[{itemcode:'SECRET-FREE-SYNTHETIC',genus:'perennial',previousOwner:'fixture',proposedOwner:'zoe_green',ownerChange:true,
      automaticAssignment:true,reason:'enforce_perennial_zone_owner'}]}]})};
  const preview=await runPerennialAssignmentPreview({client,repositorySha:'c'.repeat(40)});
  assert.equal(preview.previewReady,true);
  assert.equal(getPerennialPreviewFailure(preview),'PERENNIAL_PREVIEW_ZOE_INACTIVE');
  assert.equal(preview.affectedAssignments.length,1,'the failure artifact retains the preview impact for diagnosis');
});
test('pre-activation gate requires a valid ready preview and an active Zoe only when policy keys exist',()=>{
  assert.equal(getPerennialPreviewFailure({previewReady:true,inventoryState:'ready',counts:{in_zone_policy_groups:0,rose_override_rows:1,mitch_active_roster_rows:1,conflicting_defaults:0,zoe_active_roster_rows:0}}),'');
  assert.equal(getPerennialPreviewFailure({previewReady:true,inventoryState:'ready',counts:{in_zone_policy_groups:1,rose_override_rows:1,mitch_active_roster_rows:1,conflicting_defaults:0,zoe_active_roster_rows:1}}),'');
  assert.equal(getPerennialPreviewFailure({previewReady:true,inventoryState:'ready',counts:{in_zone_policy_groups:'bad',rose_override_rows:1,mitch_active_roster_rows:1,conflicting_defaults:0,zoe_active_roster_rows:1}}),'PERENNIAL_PREVIEW_RESULT_INVALID');
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
  assert.ok(workflow.indexOf('Recheck current main and release proof')<workflow.indexOf('Preview perennial policy impact (read only)'));
  assert.ok(workflow.indexOf('apply-item-low-stock-migration.mjs\n')<workflow.indexOf('Sync Code.gs into Apps Script'));
  assert.ok(workflow.indexOf('Preview perennial policy impact (read only)')<workflow.indexOf('Apply backend release migrations and synchronize reminder Vault credentials'));
  assert.ok(workflow.indexOf('Apply backend release migrations and synchronize reminder Vault credentials')<workflow.indexOf('Sync Code.gs into Apps Script'));
  assert.ok(workflow.indexOf('Apply backend release migrations and synchronize reminder Vault credentials')<workflow.indexOf('Configure Production Schedule dispatch and deploy backend functions'));
  assert.ok(workflow.indexOf('Configure Production Schedule dispatch and deploy backend functions')<workflow.indexOf('Sync Code.gs into Apps Script'));
  assert.doesNotMatch(workflow, /seed-production-schedule-release|Queue the initial signed workbook import/);
  assert.ok(workflow.indexOf('Install dependencies and build the complete site')<workflow.indexOf('Push the verified static site to gh-pages without force'));
  const steps = yaml.load(workflow).jobs['sync-codegs'].steps;
  const previewStep = steps.find(step => step.name === 'Preview perennial policy impact (read only)');
  const artifactStep = steps.find(step => step.name === 'Retain sanitized perennial impact preview');
  const migrationStep = steps.find(step => step.name === 'Apply backend release migrations and synchronize reminder Vault credentials');
  assert.equal(previewStep.run,'node scripts/preview-perennial-assignment.mjs');
  assert.equal(artifactStep.if,'always()','retain the written preview artifact after a fail-closed preflight');
  assert.equal(migrationStep.if,undefined,'failed preview must prevent schema and importer deployment');
  for (const name of releaseDatabaseMigrations) {
    const directory = [migrationName,perennialAssignmentMigrationName,passwordReconciliationMigrationName].includes(name) ? 'archive_migrations' : 'migrations';
    assert.ok(fs.existsSync(new URL(`../supabase/${directory}/${name}`, import.meta.url)), `${name} is tracked in its canonical migration directory`);
  }
  assert.match(workflow,/SUPABASE_DB_URL: \$\{\{ secrets\.SUPABASE_DB_URL \}\}/);
  assert.match(workflow,/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
});


test('hybrid activation blocks conflicting saved owners and inactive rose owner', () => {
  const counts = {in_zone_policy_groups:1,zoe_active_roster_rows:1,rose_override_rows:1,mitch_active_roster_rows:1,conflicting_defaults:0};
  const preview = {previewReady:true,inventoryState:'ready',counts};
  assert.equal(getPerennialPreviewFailure(preview),'');
  assert.equal(getPerennialPreviewFailure({...preview,counts:{...counts,conflicting_defaults:1}}),'PERENNIAL_PREVIEW_DEFAULT_CONFLICT');
  assert.equal(getPerennialPreviewFailure({...preview,counts:{...counts,mitch_active_roster_rows:0}}),'PERENNIAL_PREVIEW_MITCH_INACTIVE');
  assert.match(perennialPreviewSql,/zone_override_prior_assignedto/);
  assert.match(perennialPreviewSql,/where a\.present_in_drive/);
});
