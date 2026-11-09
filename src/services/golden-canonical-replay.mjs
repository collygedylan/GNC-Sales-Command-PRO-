import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export function assertCanonicalReplayContracts({ root, workspace, migrations, workspaceNames, prerequisiteIndex }) {
  const baseline = readFileSync(path.join(migrations, '20260929200000_production_baseline.sql'), 'utf8');
  const postlude = readFileSync(path.join(migrations, workspaceNames[2]), 'utf8');
  assert.match(baseline, /CREATE SCHEMA IF NOT EXISTS public;/);
  assert.match(baseline, /CREATE TABLE "private"\."ph_eval_item_low_stock_order_rows"[\s\S]*"itemcode_normalized" text GENERATED ALWAYS AS \(upper\(btrim\(itemcode\)\)\) STORED/);
  assert.match(baseline, /ALTER TABLE "app_sync_private"\."sources" ADD CONSTRAINT "sources_pkey" PRIMARY KEY \(key\)/);
  assert.match(postlude, /CREATE TRIGGER app_dataset_revision_inserted/);
  assert.match(baseline, /CREATE OR REPLACE FUNCTION private\./);
  assert.match(postlude, /RESET check_function_bodies;/);
  const platformSql = readFileSync(workspace.platformPrivilegeSqlPath, 'utf8');
  assert.equal((platformSql.match(/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin\b/gm) || []).length, 6);
  assert.match(platformSql, /GRANT ALL ON TABLES TO service_role;/);
  assert.doesNotMatch(baseline, /^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin\b/gm);
  assert.match(readFileSync(path.join(root, 'supabase/migrations/20260929200000_production_baseline.sql'), 'utf8'),
    /^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;/m);
  assert.match(readFileSync(path.join(migrations, workspaceNames[0]), 'utf8'), /create schema if not exists aura_private;/);
  const prerequisites = readFileSync(path.join(migrations, workspaceNames[prerequisiteIndex]), 'utf8');
  assert.match(prerequisites, /CANONICAL_FIXTURE_REQUIRES_DISPOSABLE_SCHEMA_WORKSPACE/);
  assert.match(prerequisites, /nelly\.baseline\.fixture@local\.invalid/);
  assert.match(prerequisites, /select source_key, 1, 'ready' from tracked_sources/);
  assert.match(prerequisites, /source_key, '\{\}'::text\[\], false, true/);
  assert.match(prerequisites, /trigger_function\.proname = 'touch_source'/);
  assert.match(prerequisites, /\('drive\.reclass\.submit', 'action', 'drive', 'Submit Reclass inquiry',[\s\S]*?array\['assigned','global'\]::text\[\], 614, true\)/);
  assert.match(prerequisites, /'ADMIN', 'drive\.reclass\.submit', true, 'global'/);
  const accessSeed = readFileSync(path.join(root, 'supabase/archive_migrations/20260828024750_centralized_access_control_audit_v1.sql'), 'utf8');
  assert.ok(accessSeed.includes("('module.managers.view', 'module', 'managers', 'Managers', 'Open Managers.', '{}', 190)"));
  assert.ok(prerequisites.includes("('module.managers.view', 'module', 'managers', 'Managers', 'Open Managers.', '{}'::text[], 190, true)"));
  const permissionSeed = readFileSync(path.join(root, 'supabase/archive_migrations/20260903032040_protected_drive_reclass_inquiry_v1.sql'), 'utf8');
  assert.match(permissionSeed, /\('drive\.reclass\.submit', 'action', 'drive', 'Submit Reclass inquiry',[\s\S]*?array\['assigned', 'global'\]::text\[\], 614, true\)/);
  const managerPermission = /\('managers\.season_priority\.submit', 'action', 'managers', 'Request Season Priority change',[\s\S]*?array\['global'\]::text\[\], 616, true\)/;
  const managerSeed = readFileSync(path.join(root, 'supabase/archive_migrations/20260922233000_manager_season_priority_inquiry_v1.sql'), 'utf8');
  assert.ok(managerPermission.test(prerequisites));
  assert.equal(prerequisites.match(managerPermission)[0].replace(/\s+/g, ' '), managerSeed.match(managerPermission)[0].replace(/\s+/g, ' '),
    'canonical replay restores the historical Manager permission without changing its contract');
  assert.match(prerequisites, /select v_policy_id, role\.role_key, 'managers\.season_priority\.submit', true, 'global'\s+from \(values \('ADMIN'\), \('ADMINISTRATOR'\), \('MANAGER'\)\) role\(role_key\)/);
  const activePermissionReferences = readdirSync(path.join(root, 'supabase/migrations'))
    .filter((name) => /^\d{14}_.+\.sql$/i.test(name))
    .map((name) => ({ name, sql: readFileSync(path.join(root, 'supabase/migrations', name), 'utf8') }))
    .filter(({ sql }) => /insert\s+into\s+private\.app_access_legacy_checks/i.test(sql));
  assert.deepEqual(activePermissionReferences.map(({ name }) => name), [
    '20261006145333_reclass_split_move_inquiries_v4.sql',
    '20261008190038_reclass_sheared_action_v5.sql',
    '20261009053029_reclass_smart_priority_hold_shield_v6.sql',
    '20261009202507_prompt25_editable_field_shield_and_hold_clear.sql',
    '20261015230000_inventory_reclass_moves_v1.sql',
  ]);
  for (const migration of activePermissionReferences) assert.match(migration.sql, /'drive\.reclass\.submit'/);
  assert.equal(readdirSync(path.join(root, 'supabase', 'migrations')).includes(workspaceNames[prerequisiteIndex]), false,
    'synthetic fixture is injected only into the disposable workspace');
  for (const [migrationName, jobName] of [
    ['20261001025638_aura_hr_command_center_v1.sql', 'hr_calendar_reminder_sweep'],
    ['20261001215508_scheduled_handover_005.sql', 'scheduled_handover_kayla_nelly_20261002'],
  ]) {
    const sourceText = readFileSync(path.join(root, 'supabase/migrations', migrationName), 'utf8');
    const replayText = readFileSync(path.join(migrations, migrationName), 'utf8');
    assert.match(replayText, new RegExp(`cron\\.alter_job\\(jobid, active := false\\)[\\s\\S]*?jobname='${jobName}'[\\s\\S]*?commit;\\s*$`, 'i'));
    assert.doesNotMatch(sourceText, /Disposable canonical replay only: prevent wall-clock job side effects/);
  }
}

export function assertCanonicalReplayOrder({ workspace, workspaceNames, activeNames }) {
  const fixtures = [
    '20261002134137_ci_canonical_migration_data_prerequisites.sql',
    '20261019113413_ci_v2311_suspend_recipients.sql',
    '20261021035501_ci_v2311_suspend_recipients_cleanup.sql',
    '20261101050001_ci_v2311_suspend_recipients_cleanup.sql',
    '20261021215959_ci_canonical_flame_grass_prerequisites.sql',
    '20261021220001_ci_canonical_flame_grass_cleanup.sql',
    '20261021220002_ci_inventory_projects_v1.sql',
    '20261023232959_ci_canonical_request_replay_prerequisites.sql',
    '20261024061501_ci_canonical_request_replay_verify.sql',
    '20261025002959_ci_canonical_request_history_prerequisites.sql',
    '20261026155959_ci_canonical_request_identity_prerequisites.sql',
    '20261026182959_ci_canonical_request_receipt_prerequisites.sql',
    '20261026184501_ci_canonical_request_replay_cleanup.sql',
    '20261027012959_ci_canonical_reclass_prerequisites.sql',
    '20261027223715_ci_canonical_reclass_reviewed_state.sql',
    '20261027223717_ci_canonical_reclass_cleanup.sql',
    '20261028172851_ci_canonical_reclass_committed_prerequisites.sql',
    '20261028172853_ci_canonical_reclass_committed_cleanup.sql',
    '20261101005959_ci_canonical_suspend_reopen_prerequisites.sql',
    '20261101005958_ci_v23129_administrator_prerequisites.sql',
    '20261101010001_ci_canonical_suspend_reopen_cleanup.sql',
    '20261102005959_ci_canonical_delivery_receipt_prerequisites.sql',
    '20261102010001_ci_canonical_delivery_receipt_cleanup.sql',
    '20261105185959_ci_canonical_soc_generated_columns.sql',
    '20261106163046_ci_canonical_watchdog_trigger_prerequisites.sql',
    '20261106185959_ci_canonical_request_writer_prerequisites.sql',
    '20261106205959_ci_canonical_inventory_project_prerequisites.sql',
    '20261106225959_ci_canonical_photo_recovery_prerequisites.sql',
    '20261106230002_ci_canonical_photo_recovery_cleanup.sql',
    '20261107001557_ci_canonical_explicit_note_drive_request_prerequisites.sql',
    '20261107001558_ci_canonical_explicit_note_suspend_prerequisites.sql',
    '20261107001559_ci_canonical_explicit_note_row_prerequisites.sql',
    '20261107001603_ci_canonical_explicit_note_row_cleanup.sql',
  ];
  assert.equal(workspace.migrationCount, workspaceNames.length);
  assert.deepEqual(workspaceNames.filter(name => fixtures.includes(name)).sort(), [...fixtures].sort());
  assert.deepEqual(workspaceNames.slice(3).filter(name => !fixtures.includes(name)),
    activeNames.filter(name => name !== '20260929200000_production_baseline.sql'));
}
