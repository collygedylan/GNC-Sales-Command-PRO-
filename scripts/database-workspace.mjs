import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from './tooling-process.mjs';
import { augmentPublicBaseline, sqlStatements } from './database-catalog.mjs';

export const DATABASE_LINT_SCHEMAS = [
  'public', 'app_sync_private', 'aura_private', 'bloomscapes_private', 'bunch_note_private', 'extensions',
  'hl_order_private', 'maintenance', 'private', 'sales_private', 'suspend_tag_private', 'workflow_private',
];
const PRIVATE_SCHEMAS = DATABASE_LINT_SCHEMAS.filter((schema) => schema !== 'public' && schema !== 'extensions');
const CANONICAL_MIGRATION_PREREQUISITES = [
  {
    before: '20261002134138_nelly_access_audit_baseline_repair_007.sql',
    source: 'supabase/ci/canonical_migration_data_prerequisites.sql',
    destination: '20261002134137_ci_canonical_migration_data_prerequisites.sql',
  },
];
const CANONICAL_CRON_ISOLATIONS = new Map([
  ['20261001025638_aura_hr_command_center_v1.sql', 'hr_calendar_reminder_sweep'],
  ['20261001215508_scheduled_handover_005.sql', 'scheduled_handover_kayla_nelly_20261002'],
]);

/** Disable selected jobs only in disposable canonical replay copies, transactionally. */
export function isolateCanonicalCronJob(source, migrationName) {
  const jobName = CANONICAL_CRON_ISOLATIONS.get(migrationName);
  if (!jobName) return source;
  const schedulePattern = new RegExp(`cron\\.schedule\\s*\\(\\s*['\"]${jobName}['\"]`, 'i');
  if (!schedulePattern.test(source)) throw new Error(`DATABASE_CRON_SCHEDULE_MISSING:${jobName}`);
  const commitPattern = /\bCOMMIT\s*;\s*$/i;
  const matches = source.match(/\bCOMMIT\s*;/gi) || [];
  if (matches.length !== 1 || !commitPattern.test(source)) {
    throw new Error(`DATABASE_CRON_ISOLATION_TRANSACTION_INVALID:${migrationName}`);
  }
  const isolation = `\n-- Disposable canonical replay only: prevent wall-clock job side effects.\nselect cron.alter_job(jobid, active := false)\nfrom cron.job where jobname='${jobName}';\n`;
  return source.replace(commitPattern, `${isolation}commit;`);
}

/** Move only the captured platform-owned default ACL statements to local admin replay. */
export function splitPlatformDefaultPrivileges(source) {
  const retained = [];
  const platformSql = [];
  for (const statement of sqlStatements(source)) {
    const executable = statement.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (/^ALTER\s+DEFAULT\s+PRIVILEGES\s+FOR\s+ROLE\s+supabase_admin\b/i.test(executable)) {
      if (!/;\s*$/.test(executable)) throw new Error('DATABASE_PLATFORM_PRIVILEGE_STATEMENT_INVALID');
      platformSql.push(`${executable}\n`);
    } else retained.push(statement);
  }
  if (platformSql.length === 0) throw new Error('DATABASE_PLATFORM_PRIVILEGES_MISSING');
  return { baseline: retained.join(''), platformSql: platformSql.join('') };
}

/** Build an isolated, disposable Supabase project from the production baseline and active migrations. */
export function createDatabaseWorkspace({ root = repoRoot, includeTests = false, testGroup = 'sql-pgtap', discoverTests } = {}) {
  const migrationSource = path.join(root, 'supabase', 'migrations');
  const baselineName = '20260929200000_production_baseline.sql';
  if (!existsSync(path.join(migrationSource, baselineName))) throw new Error('DATABASE_BASELINE_MISSING');

  const workspace = mkdtempSync(path.join(os.tmpdir(), 'gnc-db-workspace-'));
  try {
  const supabaseDir = path.join(workspace, 'supabase');
  const migrationsDir = path.join(supabaseDir, 'migrations');
  let platformPrivilegeSqlPath = null;
  mkdirSync(migrationsDir, { recursive: true });

  let config = readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8');
  if (!/^project_id\s*=\s*"[^"]+"\s*$/m.test(config)) throw new Error('DATABASE_PROJECT_ID_CONFIG_INVALID');
  const projectId = `gncdb${process.pid}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
  config = config.replace(/^project_id\s*=\s*"[^"]+"\s*$/m, `project_id = "${projectId}"`);
  writeFileSync(path.join(supabaseDir, 'config.toml'), config);

  const bootstrap = [
    '-- Required schemas for definer paths in the production baseline. This file creates no public objects.',
    ...PRIVATE_SCHEMAS.map((schema) => `create schema if not exists ${schema};`),
    'create table private.ci_schema_workspace_guard (marker text primary key check (marker = \'canonical-baseline-replay\'));',
    "insert into private.ci_schema_workspace_guard(marker) values ('canonical-baseline-replay');",
    '',
  ].join('\n');
  writeFileSync(path.join(migrationsDir, '20260929195959_typegen_schema_bootstrap.sql'), bootstrap);

  const migrations = readdirSync(migrationSource)
    .filter((name) => /^\d{14}_.+\.sql$/i.test(name))
    .sort();
  const insertedPrerequisites = new Set();
  for (const name of migrations) {
    for (const prerequisite of CANONICAL_MIGRATION_PREREQUISITES.filter(item => item.before === name)) {
      if (insertedPrerequisites.has(prerequisite.destination)) throw new Error(`DATABASE_PREREQUISITE_DUPLICATE:${prerequisite.destination}`);
      const fixturePath = path.resolve(root, prerequisite.source);
      if (!fixturePath.startsWith(`${path.resolve(root)}${path.sep}`) || !existsSync(fixturePath)) {
        throw new Error(`DATABASE_PREREQUISITE_SOURCE_INVALID:${prerequisite.source}`);
      }
      copyFileSync(fixturePath, path.join(migrationsDir, prerequisite.destination));
      insertedPrerequisites.add(prerequisite.destination);
    }
    const originalSource = readFileSync(path.join(migrationSource, name), 'utf8');
    let source = isolateCanonicalCronJob(originalSource, name);
    if (name === baselineName) {
      const publicSchemaDeclaration = /CREATE SCHEMA public;/g;
      const matches = source.match(publicSchemaDeclaration) || [];
      if (matches.length !== 1) throw new Error(`DATABASE_BASELINE_PUBLIC_SCHEMA_EXPECTED_ONCE:${matches.length}`);
      // Supabase initializes public in a fresh local stack. Preserve the dump body while making this one declaration idempotent.
      source = source.replace(publicSchemaDeclaration, 'CREATE SCHEMA IF NOT EXISTS public;');
      const augmented = augmentPublicBaseline(source, { root });
      source = augmented.baseline;
      writeFileSync(path.join(migrationsDir, '20260929200001_baseline_private_catalog_postlude.sql'), augmented.postlude);
      const split = splitPlatformDefaultPrivileges(source);
      source = split.baseline;
      platformPrivilegeSqlPath = path.join(workspace, 'platform-admin-default-privileges.sql');
      writeFileSync(platformPrivilegeSqlPath, split.platformSql);
    }
    writeFileSync(path.join(migrationsDir, name), source);
  }
  if (insertedPrerequisites.size !== CANONICAL_MIGRATION_PREREQUISITES.length) {
    throw new Error(`DATABASE_PREREQUISITE_MIGRATION_TARGET_MISSING:${CANONICAL_MIGRATION_PREREQUISITES.filter(item => !insertedPrerequisites.has(item.destination)).map(item => item.before).join(',')}`);
  }

  writeFileSync(path.join(supabaseDir, 'seed.sql'), '');
  if (includeTests) {
    if (typeof discoverTests !== 'function') throw new Error('DATABASE_TEST_DISCOVERY_REQUIRED');
    const testsDir = path.join(supabaseDir, 'tests');
    mkdirSync(testsDir, { recursive: true });
    for (const relativePath of discoverTests({ root, group: testGroup })) {
      const resolved = path.resolve(root, relativePath);
      if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('DATABASE_TEST_PATH_OUTSIDE_REPOSITORY');
      copyFileSync(resolved, path.join(testsDir, path.basename(relativePath)));
    }
  }

  return {
    root: workspace,
    projectId,
    platformPrivilegeSqlPath,
    migrationCount: migrations.length + 3,
    dispose() {
      const resolved = path.resolve(workspace);
      const parent = path.resolve(os.tmpdir());
      if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('gnc-db-workspace-')) {
        throw new Error('DATABASE_WORKSPACE_CLEANUP_PATH_INVALID');
      }
      rmSync(resolved, { recursive: true, force: true });
    },
  };
  } catch (error) {
    const resolved = path.resolve(workspace);
    const parent = path.resolve(os.tmpdir());
    if (path.dirname(resolved) === parent && path.basename(resolved).startsWith('gnc-db-workspace-')) {
      rmSync(resolved, { recursive: true, force: true });
    }
    throw error;
  }
}
