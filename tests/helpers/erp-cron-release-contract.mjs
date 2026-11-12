import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { ERP_SYNC_STAGES, isOperationalErpSyncComplete } from '../../supabase/functions/_shared/erp-sync.mjs';
import { runSecondaryErpSyncStep } from '../../supabase/functions/_shared/erp-secondary-sync.mjs';
import { erpPublicationSingleFlightMigration, requestDeliveryCronSingleFlightMigration,
  erpPublicationIdleCleanupMigration } from '../../src/services/erp-publication-single-flight-contract.mjs';
import { assertErpPublicationRecovery } from './erp-publication-recovery-contract.mjs';
import { erpPriorDayPruneMigration } from '../../src/services/erp-prior-day-prune-contract.mjs';
import { erpIncrementalDrivePreparationMigration } from '../../src/services/erp-incremental-drive-preparation-contract.mjs';
import { erpCompiledDriveWorkMigration, erpDriveReadinessWithoutAnalyzeMigration } from '../../src/services/erp-compiled-drive-work-contract.mjs';
import { erpFinalInputCertificateMigration } from '../../src/services/erp-final-input-certificate-contract.mjs';
import { erpPriorDriveAliasMigration } from '../../src/services/erp-prior-drive-alias-contract.mjs';
import { erpCompiledDriveOrderDeltaMigration } from '../../src/services/erp-compiled-drive-order-delta-contract.mjs';
import { assertCompiledDriveWorkSql } from './erp-compiled-drive-work.mjs';

const expected = ['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed'];
const compactInputMigration = '20261112022500_agdata3078_compact_drive_publication_input.sql';
const deadlineMigration = '20261112023500_agdata3078_drive_publication_deadline.sql';
const protectedOwner = /(?:run_erp_stage_publication_v3042|dispatch_request_delivery_worker_cron)/i;
const sealedMigrations = new Map([
  [erpPriorDayPruneMigration, 'd43333b060579703876d8c6218e58cf420999e9901deebb934624cd644f47deb'],
  [erpPublicationSingleFlightMigration, '60c248492434dafe8bd5bd9f1d515cb99fc30412f020a81d53d2fbb623b95b97'],
  [requestDeliveryCronSingleFlightMigration, '86759431381922ffd48f4bc8dbd39ede6fc2e27f849279e75b5f0622576945bb'],
  [erpPublicationIdleCleanupMigration, 'fb4b2ead9afc5bc47e3771e9d9707cd42e78b2956393ef979d789e31f9191c8c'],
  [erpDriveReadinessWithoutAnalyzeMigration, '928a71b0ce1877456ebeeabb98edb3b0658f6fc9287f0dad6fce7f50e9092136'],
  [erpFinalInputCertificateMigration, '5a768dfd9e6ae4e15281094f945482c619985c751272730ef41b97f8d066f42f'],
  [erpPriorDriveAliasMigration, 'cacd49e0b8019b3c81cce8732eb8ac2cb686e6bce99074d9d3be053cd4ecb612'],
  [erpCompiledDriveOrderDeltaMigration, '21a0563a0407ee6eb4edb1cad8e24704177a1c52c4c72a2a6b5a0a64ebd55be7'],
]);

function quotedSqlEnd(sql,start) {
  const quote = sql[start];
  const escaped = quote === "'" && /e/i.test(sql[start - 1] || '');
  let i = start + 1;
  while (i < sql.length) {
    if (escaped && sql[i] === '\\') { i += 2; continue; }
    if (sql[i] !== quote) { i += 1; continue; }
    if (sql[i + 1] === quote) { i += 2; continue; }
    return i + 1;
  }
  return i;
}

function blockCommentEnd(sql,start) {
  let i = start + 2, depth = 1;
  while (i < sql.length && depth > 0) {
    const pair = sql.slice(i,i + 2);
    if (pair === '/*') { depth += 1; i += 2; continue; }
    if (pair === '*/') { depth -= 1; i += 2; continue; }
    i += 1;
  }
  return i;
}

function sqlCode(sql) {
  let code = '';
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i], next = sql[i + 1];
    if (char === "'" || char === '"') {
      const end = quotedSqlEnd(sql,i);
      code += sql.slice(i,end);
      i = end - 1;
      continue;
    }
    if (char === '/' && next === '*') {
      i = blockCommentEnd(sql,i) - 1;
      code += ' ';
      continue;
    }
    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n',i + 2);
      if (end < 0) return code;
      code += '\n';
      i = end;
      continue;
    }
    code += char;
  }
  return code;
}

function assertSealedMigration(name, sql) {
  const digest = createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
  assert.equal(digest, sealedMigrations.get(name), `${name}: reviewed migration changed`);
}

export function assertErpWorkerGuard(sql) {
  const code = sqlCode(sql);
  const guard = code.match(/\bguard text := E'((?:''|[^'])*)';/i)?.[1];
  assert.match(guard ?? '', /^begin\\n\s*if not pg_catalog\.pg_try_advisory_xact_lock\(pg_catalog\.hashtextextended\(''agdata:erp-publication-worker:v3078'',0\)\) then return; end if;\\n\s*select \* into job [^;]+ for update skip locked;$/i);
  assert.match(code, /pg_get_functiondef\('private\.run_erp_stage_publication_v3042\(uuid\)'::regprocedure\)/i);
  assert.match(code, /execute replace\(definition,entry,guard\);/i);
}

export function assertDeliveryCronGuard(sql) {
  const code = sqlCode(sql);
  assert.match(code, /create or replace function private\.dispatch_request_delivery_worker_cron\(\)[\s\S]*?as \$dispatch\$\s*begin\s*if not pg_catalog\.pg_try_advisory_xact_lock\(pg_catalog\.hashtextextended\('agdata:delivery-cron-wake:v3078',0\)\) then return null; end if;\s*return private\.wake_request_delivery_worker_now\('cron'\);\s*end\s*\$dispatch\$/i);
  assert.match(code, /revoke all on function private\.dispatch_request_delivery_worker_cron\(\) from public,anon,authenticated,service_role/i);
  for (const anchor of ["jobid=45", "'gnc-request-delivery-worker'", "'* * * * *'", "job.database is distinct from 'postgres'", "job.username is distinct from 'postgres'", "job.active is distinct from true", "job.command not in (old_command,new_command)", 'cron.alter_job(job.jobid,command:=new_command)']) {
    assert.ok(code.includes(anchor), `delivery cron identity contract missing ${anchor}`);
  }
  assert.match(code, /old_command constant text := 'select private\.wake_request_delivery_worker_now\(''cron''\)'/i);
  assert.match(code, /new_command constant text := 'select private\.dispatch_request_delivery_worker_cron\(\)'/i);
}

function assertIdleCleanupPatch(code) {
  assert.match(code, /pg_get_functiondef\('private\.run_erp_stage_publication_v3042\(uuid\)'::regprocedure\)/i);
  assert.match(code, /guarded text := 'if not exists\(select 1 from private\.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id\) and exists\(select 1 from cron\.job where jobname=job_name\) then';/i);
  assert.match(code, /execute replace\(definition,previous,guarded\);/i);
  assert.match(code, /cardinality\(string_to_array\(definition,previous\)\)<>2/i);
}

function assertCompactInputPatch(code) {
  const block = code.match(/do \$wire\$([\s\S]*?)\$wire\$;/i)?.[1] ?? '';
  assert.match(block, /pg_get_functiondef\('private\.prepare_erp_publication_v3077\(uuid\)'::regprocedure\)/i);
  assert.match(block, /anchor text:='  return private\.prepare_drive_typed_part_v3077\(p_stage_id\);'/i);
  assert.match(block, /execute replace\(definition,anchor,'  if private\.drive_parts_fit_one_attempt_v3078\(p_stage_id\) then return true; end if;'\s*\|\|chr\(10\)\|\|anchor\);/i);
}

function assertDeadlineSchedulerPatch(code, expectedBudget) {
  const definition = code.match(/create or replace function private\.schedule_erp_stage_publication_v3057\(p_stage_id uuid\)[\s\S]*?\$schedule\$;/i)?.[0] ?? '';
  const original = definition.match(/as \$schedule\$([\s\S]*?)\$schedule\$/i)?.[1]?.trim() ?? '';
  const datasetBudget = "when stage.dataset_key='drive_around' then '" + expectedBudget + "' else '120s'";
  assert.ok(original.includes(datasetBudget), 'DRIVE statement timeout must match the reviewed migration');
  const body = original.replace(datasetBudget, "when stage.dataset_key='drive_around' then '8s' else '120s'");
  assert.match(body, /^select cron\.schedule\('agdata-erp-publication-'\|\|p_stage_id,'2 seconds',format\(\s*'begin; set local statement_timeout = %L; set local lock_timeout = %L; select private\.run_erp_stage_publication_v3042\(%L::uuid\); commit',\s*case when stage\.dataset_key='drive_around' then '8s' else '120s' end,\s*case when stage\.dataset_key='drive_around' then '750ms' else '15s' end, p_stage_id\)\)\s*from private\.fast_erp_stage_runs_v1 stage where stage\.stage_id=p_stage_id;$/i);
  return code.replace(definition,'');
}

export function assertLaterMigrationSafety(files) {
  for (const [name,sql] of files) {
    const code = sqlCode(sql);
    if (name === erpPriorDayPruneMigration) assertSealedMigration(name,sql);
    if (name === requestDeliveryCronSingleFlightMigration) {
      assertSealedMigration(name,sql);
      assertDeliveryCronGuard(code);
      continue;
    }
    if (name === erpPublicationIdleCleanupMigration) {
      assertSealedMigration(name,sql);
      assertIdleCleanupPatch(code);
      continue;
    }
    if (name === compactInputMigration) assertCompactInputPatch(code);
    if (name === erpCompiledDriveWorkMigration) assertCompiledDriveWorkSql(code);
    if (name === erpDriveReadinessWithoutAnalyzeMigration) assertSealedMigration(name,sql);
    if (name === erpFinalInputCertificateMigration) assertSealedMigration(name,sql);
    if (name === erpPriorDriveAliasMigration) assertSealedMigration(name,sql);
    if (name === erpCompiledDriveOrderDeltaMigration) assertSealedMigration(name,sql);
    const budgets = new Map([[deadlineMigration,'8s'],[erpIncrementalDrivePreparationMigration,'240s']]);
    const remaining = budgets.has(name) ? assertDeadlineSchedulerPatch(code,budgets.get(name)) : code;
    assertNoProtectedMutation(name,remaining);
    assert.doesNotMatch(code, /\b(?:alter|drop)\s+schema\s+private\b/i, `${name}: private schema mutation requires guard review`);
    assert.doesNotMatch(code, /(?:cron\.(?:alter_job|unschedule|schedule)\s*\([^;]*(?:\b45\b|gnc-request-delivery-worker)|(?:update|delete\s+from)\s+cron\.job\b)/i,
      `${name}: delivery cron mutation requires guard review`);
  }
}

function assertNoProtectedMutation(name,code) {
  const normalized = text => text.replace(/['"\s|]/g, '');
  for (const statement of code.split(';')) {
    if (!protectedOwner.test(normalized(statement))) continue;
    assert.doesNotMatch(statement, /\b(?:create\s+(?:or\s+replace\s+)?function|alter\s+function|drop\s+function|grant\s+execute|revoke\s+(?:all|execute))\b/i,
      `${name}: protected cron owner mutation requires review`);
  }
  for (const block of code.matchAll(/\bdo\s+\$([a-z_0-9]*)\$([\s\S]*?)\$\1\$/gi)) {
    if (protectedOwner.test(normalized(block[2])) && /\bexecute\b/i.test(block[2])) {
      assert.fail(`${name}: dynamic protected cron owner mutation requires review`);
    }
  }
}

async function assertLaterMigrations(read) {
  const names = (await readdir(new URL('../../supabase/migrations/', import.meta.url)))
    .filter(name => /^\d{14}.*\.sql$/.test(name) && name !== erpPublicationSingleFlightMigration
      && name.slice(0,14) >= erpPublicationSingleFlightMigration.slice(0,14)).sort();
  assert.ok(names.includes(requestDeliveryCronSingleFlightMigration));
  assert.ok(names.includes(erpPriorDayPruneMigration));
  assert.ok(names.includes(erpPublicationIdleCleanupMigration));
  assert.ok(names.includes(compactInputMigration));
  assert.ok(names.includes(deadlineMigration));
  assert.ok(names.includes(erpIncrementalDrivePreparationMigration));
  assert.ok(names.includes(erpCompiledDriveWorkMigration));
  assert.ok(names.includes(erpDriveReadinessWithoutAnalyzeMigration));
  assert.ok(names.includes(erpFinalInputCertificateMigration));
  assert.ok(names.includes(erpPriorDriveAliasMigration));
  assert.ok(names.includes(erpCompiledDriveOrderDeltaMigration));
  const files = await Promise.all(names.map(async name => [name,await read('supabase/migrations/' + name)]));
  assertLaterMigrationSafety(files);
}

export async function assertErpStageSequence() {
  const stages = ERP_SYNC_STAGES.map(stage => ({ key: stage.key, outcome: 'UP_TO_DATE' }));
  const cursor = { stageResults: stages, secondaryFolders: { hl_po_parsed: { files: [] } } };
  const status = await runSecondaryErpSyncStep({ cursor, operationalOnly: true, status: async () => {} });
  assert.equal(status.done, true);
  assert.deepEqual(status.cursor.stageResults.map(stage => stage.key), expected);
  assert.equal(isOperationalErpSyncComplete(status.cursor), true);
  for (const key of expected) {
    const stageResults = status.cursor.stageResults.filter(stage => stage.key !== key);
    assert.equal(isOperationalErpSyncComplete({ stageResults }), false);
  }
}

export async function verifyErpCronRelease(read) {
  const started = performance.now();
  const guard = await read('supabase/migrations/' + erpPublicationSingleFlightMigration);
  assertSealedMigration(erpPublicationSingleFlightMigration,guard);
  assertErpWorkerGuard(guard);
  await assertLaterMigrations(read);
  await assertErpStageSequence();
  await assertErpPublicationRecovery();
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 150, `ERP cron release check exceeded 150 ms (${elapsed.toFixed(1)} ms)`);
  return elapsed;
}
