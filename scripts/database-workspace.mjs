import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from './tooling-process.mjs';
import { augmentPublicBaseline, sqlStatements } from './database-catalog.mjs';
import { splitCanonicalNurseryReplaySeed } from '../src/services/canonical-nursery-replay.mjs';

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
  {
    before: '20261019113414_suspend_tag_sender_identity.sql',
    source: 'supabase/ci/v2311_suspend_recipient_prerequisites.sql',
    destination: '20261019113413_ci_v2311_suspend_recipients.sql',
  },
  {
    before: '20261021035641_protect_na_request_mappings_v1.sql',
    source: 'supabase/ci/v2311_suspend_recipient_cleanup.sql',
    destination: '20261021035501_ci_v2311_suspend_recipients_cleanup.sql',
  },
  {
    before: '20261021220000_reclass_season_stock_and_recipients.sql',
    source: 'supabase/ci/canonical_flame_grass_prerequisites.sql',
    destination: '20261021215959_ci_canonical_flame_grass_prerequisites.sql',
  },
  {
    before: '20261021220000_reclass_season_stock_and_recipients.sql',
    source: 'supabase/ci/canonical_flame_grass_cleanup.sql',
    destination: '20261021220001_ci_canonical_flame_grass_cleanup.sql',
  },
  {
    before: '20261021220000_reclass_season_stock_and_recipients.sql',
    source: 'supabase/migrations/20261022_inventory_projects_v1.sql',
    destination: '20261021220002_ci_inventory_projects_v1.sql',
  },
  {
    before: '20261023233000_bounded_request_queue_reconciliation_v2.sql',
    source: 'supabase/ci/canonical_request_replay_prerequisites.sql',
    destination: '20261023232959_ci_canonical_request_replay_prerequisites.sql',
  },
  {
    before: '20261024061500_request_queue_legacy_outbox_reconciliation_v4.sql',
    source: 'supabase/ci/canonical_request_replay_verify.sql',
    destination: '20261024061501_ci_canonical_request_replay_verify.sql',
  },
  {
    before: '20261025003000_agdata_v2361_surgical_restore.sql',
    source: 'supabase/ci/canonical_request_history_prerequisites.sql',
    destination: '20261025002959_ci_canonical_request_history_prerequisites.sql',
  },
  {
    before: '20261026160000_agdata_v2370_watchdog_and_request_recovery.sql',
    source: 'supabase/ci/canonical_request_identity_prerequisites.sql',
    destination: '20261026155959_ci_canonical_request_identity_prerequisites.sql',
  },
  {
    before: '20261026183000_agdata_v2372_request_completion_acknowledgment.sql',
    source: 'supabase/ci/canonical_request_receipt_prerequisites.sql',
    destination: '20261026182959_ci_canonical_request_receipt_prerequisites.sql',
  },
  {
    before: '20261026190000_agdata_v2373_drive_timeout_recovery.sql',
    source: 'supabase/ci/canonical_request_replay_cleanup.sql',
    destination: '20261026184501_ci_canonical_request_replay_cleanup.sql',
  },
  {
    before: '20261027013000_agdata_v2379_complete_reclass_destination_row_loop.sql',
    source: 'supabase/ci/canonical_reclass_prerequisites.sql',
    destination: '20261027012959_ci_canonical_reclass_prerequisites.sql',
  },
  {
    before: '20261027223716_agdata_v2390_reclass_receipt_and_live_stock_durability.sql',
    source: 'supabase/ci/canonical_reclass_reviewed_state.sql',
    destination: '20261027223715_ci_canonical_reclass_reviewed_state.sql',
  },
  {
    before: '20261028014500_agdata_v2390_postgres_manual_sync.sql',
    source: 'supabase/ci/canonical_reclass_cleanup.sql',
    destination: '20261027223717_ci_canonical_reclass_cleanup.sql',
  },
  {
    before: '20261028172852_agdata_v2395_instant_reclass_and_navigation.sql',
    source: 'supabase/ci/canonical_reclass_committed_prerequisites.sql',
    destination: '20261028172851_ci_canonical_reclass_committed_prerequisites.sql',
  },
  {
    before: '20261028172852_agdata_v2395_instant_reclass_and_navigation.sql',
    source: 'supabase/ci/canonical_reclass_committed_cleanup.sql',
    destination: '20261028172853_ci_canonical_reclass_committed_cleanup.sql',
  },
  {
    before: '20261101010000_agdata_v23127_permissions_and_hold_history.sql',
    source: 'supabase/ci/v2311_suspend_recipient_prerequisites.sql',
    destination: '20261101005958_ci_v23129_administrator_prerequisites.sql',
  },
  {
    before: '20261101010000_agdata_v23127_permissions_and_hold_history.sql',
    source: 'supabase/ci/canonical_suspend_reopen_prerequisites.sql',
    destination: '20261101005959_ci_canonical_suspend_reopen_prerequisites.sql',
  },
  {
    before: '20261101010000_agdata_v23127_permissions_and_hold_history.sql',
    source: 'supabase/ci/canonical_suspend_reopen_cleanup.sql',
    destination: '20261101010001_ci_canonical_suspend_reopen_cleanup.sql',
  },
  {
    before: '20261101060000_v23130_supabase_quota_and_rls_security.sql',
    source: 'supabase/ci/v2311_suspend_recipient_cleanup.sql',
    destination: '20261101050001_ci_v2311_suspend_recipients_cleanup.sql',
  },
  {
    before: '20261102010000_v23133_resolve_delivery_order_violations.sql',
    source: 'supabase/ci/canonical_delivery_receipt_prerequisites.sql',
    destination: '20261102005959_ci_canonical_delivery_receipt_prerequisites.sql',
  },
  {
    before: '20261102010000_v23133_resolve_delivery_order_violations.sql',
    source: 'supabase/ci/canonical_delivery_receipt_cleanup.sql',
    destination: '20261102010001_ci_canonical_delivery_receipt_cleanup.sql',
  },
  {
    before: '20261105190000_suspend_all_routes_and_saved_work.sql',
    source: 'supabase/ci/canonical_soc_generated_columns.sql',
    destination: '20261105185959_ci_canonical_soc_generated_columns.sql',
  },
  {
    before: '20261106163047_agdata306_watchdog_boot_ready.sql',
    source: 'supabase/ci/canonical_watchdog_trigger_prerequisites.sql',
    destination: '20261106163046_ci_canonical_watchdog_trigger_prerequisites.sql',
  },
  {
    before: '20261106163047_agdata306_watchdog_boot_ready.sql',
    source: 'supabase/ci/canonical_master_text_trigger.sql',
    destination: '20261106163045_ci_canonical_master_text_trigger.sql',
  },
  {
    before: '20261106190000_agdata308_item_detail_photos_lww.sql',
    source: 'supabase/ci/canonical_request_writer_prerequisites.sql',
    destination: '20261106185959_ci_canonical_request_writer_prerequisites.sql',
  },
  {
    before: '20261106210000_agdata310_optional_evaluation.sql',
    source: 'supabase/ci/canonical_inventory_project_prerequisites.sql',
    destination: '20261106205959_ci_canonical_inventory_project_prerequisites.sql',
  },
  {
    before: '20261106230001_agdata312_recovered_photo_calendar_lock.sql',
    source: 'supabase/ci/canonical_photo_recovery_prerequisites.sql',
    destination: '20261106225959_ci_canonical_photo_recovery_prerequisites.sql',
  },
  {
    before: '20261106230001_agdata312_recovered_photo_calendar_lock.sql',
    source: 'supabase/ci/canonical_photo_recovery_cleanup.sql',
    destination: '20261106230002_ci_canonical_photo_recovery_cleanup.sql',
  },
  {
    before: '20261107001600_agdata316_explicit_av_note.sql',
    source: 'supabase/ci/canonical_explicit_note_drive_request_prerequisites.sql',
    destination: '20261107001557_ci_canonical_explicit_note_drive_request_prerequisites.sql',
  },
  {
    before: '20261107001600_agdata316_explicit_av_note.sql',
    source: 'supabase/ci/canonical_explicit_note_suspend_prerequisites.sql',
    destination: '20261107001558_ci_canonical_explicit_note_suspend_prerequisites.sql',
  },
  {
    before: '20261107001600_agdata316_explicit_av_note.sql',
    source: 'supabase/ci/canonical_explicit_note_row_prerequisites.sql',
    destination: '20261107001559_ci_canonical_explicit_note_row_prerequisites.sql',
  },
  {
    before: '20261107001602_agdata316_eval_work_explicit_note.sql',
    source: 'supabase/ci/canonical_explicit_note_row_cleanup.sql',
    destination: '20261107001603_ci_canonical_explicit_note_row_cleanup.sql',
  },
];
const CANONICAL_CRON_ISOLATIONS = new Map([
  ['20261001025638_aura_hr_command_center_v1.sql', 'hr_calendar_reminder_sweep'],
  ['20261001215508_scheduled_handover_005.sql', 'scheduled_handover_kayla_nelly_20261002'],
]);

/** Restore the missing statement terminator in this disposable replay copy. */
export function repairCanonicalReplayTerminator(source, migrationName) {
  if (migrationName !== '20261021160000_suspend_existing_review_v1.sql') return source;
  if (/\nend \$function\$;\n\ncommit;\n?$/.test(source)) return source;
  const anchor = /(\nend \$function\$)(\n\ncommit;\n?)$/;
  if (!anchor.test(source)) throw new Error('DATABASE_SUSPEND_REVIEW_TERMINATOR_ANCHOR_MISSING');
  return source.replace(anchor, '$1;$2');
}

/** The older disposable view already excludes completed lines but lacks this projection. */
export function replaySuspendMembership(source, migrationName) {
  if (migrationName !== '20261105180000_soc_suspend_source_membership.sql') return source;
  const predicate = 'AND NOT workbook_suspend.suspend_completed';
  if (source.split(predicate).length !== 2) throw new Error('DATABASE_SUSPEND_MEMBERSHIP_PREDICATE_MISSING');
  return source.replace(predicate, "AND NOT coalesce((to_jsonb(workbook_suspend)->>''suspend_completed'')::boolean, false)");
}

/** The local CLI owns ledger receipts for these previously applied operator migrations. */
export function removeReplaySelfRegistration(source, migrationName) {
  if (!/^2026110700160[0-2]_agdata316_/.test(migrationName)) return source;
  const version = migrationName.slice(0, 14);
  const receipt = new RegExp(`^INSERT INTO supabase_migrations\\.schema_migrations\\(version,name,statements\\) VALUES\\('${version}',[^\\n]+ ON CONFLICT\\(version\\) DO NOTHING;\\n(?=COMMIT;)`, 'm');
  if (!receipt.test(source)) throw new Error('DATABASE_REPLAY_RECEIPT_ANCHOR_MISSING');
  return source.replace(receipt, '');
}

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

function writeCanonicalPrerequisites(root, migrationsDir, names) {
  const inserted = new Set();
  for (const prerequisite of CANONICAL_MIGRATION_PREREQUISITES) {
    if (!names.includes(prerequisite.before)) throw new Error(`DATABASE_PREREQUISITE_MIGRATION_TARGET_MISSING:${prerequisite.before}`);
    if (inserted.has(prerequisite.destination)) throw new Error(`DATABASE_PREREQUISITE_DUPLICATE:${prerequisite.destination}`);
    const fixturePath = path.resolve(root, prerequisite.source);
    if (!fixturePath.startsWith(`${path.resolve(root)}${path.sep}`) || !existsSync(fixturePath)) {
      throw new Error(`DATABASE_PREREQUISITE_SOURCE_INVALID:${prerequisite.source}`);
    }
    writeFileSync(path.join(migrationsDir, prerequisite.destination), readFileSync(fixturePath, 'utf8').replaceAll('\r\n', '\n'));
    inserted.add(prerequisite.destination);
  }
  return inserted.size;
}

function writeCanonicalBaseline({ root, workspace, migrationsDir, baselineName, source }) {
  const declaration = /CREATE SCHEMA public;/g;
  const matches = source.match(declaration) || [];
  if (matches.length !== 1) throw new Error(`DATABASE_BASELINE_PUBLIC_SCHEMA_EXPECTED_ONCE:${matches.length}`);
  const augmented = augmentPublicBaseline(source.replace(declaration, 'CREATE SCHEMA IF NOT EXISTS public;'), { root });
  writeFileSync(path.join(migrationsDir, '20260929200001_baseline_private_catalog_postlude.sql'), augmented.postlude.replaceAll('\r\n', '\n'));
  const split = splitPlatformDefaultPrivileges(augmented.baseline);
  const platformPrivilegeSqlPath = path.join(workspace, 'platform-admin-default-privileges.sql');
  writeFileSync(platformPrivilegeSqlPath, split.platformSql.replaceAll('\r\n', '\n'));
  writeFileSync(path.join(migrationsDir, baselineName), split.baseline.replaceAll('\r\n', '\n'));
  return platformPrivilegeSqlPath;
}

function writeCanonicalMigrations({ root, workspace, migrationsDir, migrationSource, baselineName }) {
  const names = readdirSync(migrationSource).filter(name => /^\d{14}_.+\.sql$/i.test(name)).sort();
  const prerequisites = writeCanonicalPrerequisites(root, migrationsDir, names);
  let platformPrivilegeSqlPath = null;
  for (const name of names) {
    // Later migrations match exact LF function bodies through pg_get_functiondef.
    const original = readFileSync(path.join(migrationSource, name), 'utf8').replaceAll('\r\n', '\n');
    const replay = repairCanonicalReplayTerminator(isolateCanonicalCronJob(original, name), name);
    const compatible = replaySuspendMembership(replay, name);
    const source = removeReplaySelfRegistration(splitCanonicalNurseryReplaySeed(compatible, name), name);
    if (name === baselineName) {
      platformPrivilegeSqlPath = writeCanonicalBaseline({ root, workspace, migrationsDir, baselineName, source });
    } else {
      writeFileSync(path.join(migrationsDir, name), source);
    }
  }
  return { platformPrivilegeSqlPath, migrationCount: names.length + prerequisites + 2 };
}

function writeCanonicalTests({ root, supabaseDir, testGroup, discoverTests }) {
  if (typeof discoverTests !== 'function') throw new Error('DATABASE_TEST_DISCOVERY_REQUIRED');
  const testsDir = path.join(supabaseDir, 'tests');
  mkdirSync(testsDir, { recursive: true });
  for (const relativePath of discoverTests({ root, group: testGroup })) {
    const resolved = path.resolve(root, relativePath);
    if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('DATABASE_TEST_PATH_OUTSIDE_REPOSITORY');
    writeFileSync(path.join(testsDir, path.basename(relativePath)), readFileSync(resolved, 'utf8').replaceAll('\r\n', '\n'));
  }
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

    const migrationState = writeCanonicalMigrations({ root, workspace, migrationsDir, migrationSource, baselineName });

    writeFileSync(path.join(supabaseDir, 'seed.sql'), '');
    if (includeTests) writeCanonicalTests({ root, supabaseDir, testGroup, discoverTests });

    return {
      root: workspace,
      projectId,
      ...migrationState,
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
