import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const runtime = read('assets/app-runtime.js');
const codeGs = read('Code.gs');
const migration = read('supabase/migrations/20261026170000_agdata_v2371_request_suspend_email_and_lock_cleanup.sql');
const reclassMigration = read('supabase/migrations/20261015230000_inventory_reclass_moves_v1.sql');
const reclassDeliveryMigration = read('supabase/migrations/20261020150827_v2315_reclass_email_report_policy.sql');

test('v2.3.105 keeps all 12 release version surfaces synchronized', () => {
  const manifest = JSON.parse(read('package.json'));
  const version = manifest.version;
  assert.equal(version, '2.3.105');
  const release = `AgData v${version}`;
  const surfaces = [
    'assets/app-runtime.js', 'index.html', 'manifest.json', 'sw.js',
    'scripts/build-live-shell.mjs', 'v2/public/manifest.webmanifest', 'v2/src/services/api.ts',
    'tests/code-health-governance.test.mjs', 'tests/release-app-lifecycle.test.mjs',
    'tests/agdata-governance.test.mjs',
  ];
  for (const file of surfaces) {
    const source = read(file);
    assert.ok(source.includes(release) || source.includes(version), `${file}: ${version}`);
    assert.doesNotMatch(source, /2\.3\.71/, file);
  }
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);
});

test('Apps Script imports and email workers require private service-role credentials', () => {
  assert.match(codeGs, /function resolveSupabaseServiceRoleKey_\(sourceFallbackKey\)/);
  assert.match(codeGs, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(codeGs.match(/function resolveSupabaseServiceRoleKey_\(sourceFallbackKey\)[\s\S]*?\n\}/)?.[0] || '', /SUPABASE_KEY|SUPABASE_API_KEY/);
  assert.match(codeGs, /setProperty\('SUPABASE_SERVICE_ROLE_KEY', candidateKey\)/);
  assert.match(migration, /grant all privileges on table public\.ph_request_delivery_outbox to service_role/i);
  assert.match(migration, /revoke all privileges on table public\.ph_request_delivery_outbox from public, anon, authenticated/i);
  assert.match(migration, /revoke all privileges on table public\.ph_app_users from public, anon, authenticated/i);
  assert.match(migration, /revoke all privileges on table public\.user_access_control from public, anon, authenticated/i);
});

test('Que Request remains pending-only without approval or conflict banners', () => {
  assert.match(runtime, /function isRequestPendingVisible[\s\S]*?\['', 'pending', 'open'\]/);
  assert.match(runtime, /const actionBadge = '';/);
  assert.match(runtime, /function updateRequestWorkConflictReview[\s\S]*?panel\.replaceChildren\(\);[\s\S]*?panel\.classList\.add\('hidden'\);[\s\S]*?return;/);
  assert.match(migration, /lower\(btrim\(coalesce\(pending\.req_status, 'Pending'\)\)\) in \('', 'pending', 'open'\)/);
});

test('Suspend decisions remain assigned-rep or Admin only', () => {
  const suspendSql = read('supabase/migrations/20261021170000_suspend_candidates_request_preload_v1.sql');
  assert.match(runtime, /const canDecide = result\.canDecide && canonicalFeaturePermission\('can_approve_deny_suspend'\) !== false/);
  assert.match(suspendSql, /a\.rep_id=actor\.id or private\.is_full_app_administrator_v1\(actor\.username\)/);
  assert.match(runtime, /Approve this location/);
  assert.match(runtime, /Deny all locations/);
});

test('published Drive and AV data locks only non-Admin users', () => {
  assert.match(runtime, /if \(prefix === 'req-'\) return false/);
  assert.match(runtime, /if \(isDriveModePhotoDataEditContext\(prefix, item\)\) \{[\s\S]*?if \(getRoleAccessState\(\)\?\.isAdmin\) return false;[\s\S]*?return sectionHasProtectedData/);
  assert.match(runtime, /Published Data/);
});

test('Reclass auto-creates destination lots and ignores mutable draft quantities', () => {
  assert.match(reclassMigration, /insert into public\.ph_master_inventory/);
  assert.match(reclassMigration, /destination_uid/);
  assert.match(migration, /RECLASS_STALE_QUANTITY_GUARD_NOT_FOUND/);
  assert.match(migration, /source_identity->>''ptronhand'' is distinct from/);
  assert.match(reclassDeliveryMigration, /apply_inventory_reclass_moves_with_delivery_v1/);
});

test('AV Note load, save, and stored values remove SPEC and CALIPER fragments', () => {
  assert.match(runtime, /function sanitizeAvNoteWithoutSpecCaliper/);
  assert.match(runtime, /globalAvNote\.value = sanitizeAvNoteWithoutSpecCaliper\(getItemDisplayValue/);
  assert.match(runtime, /itemToSave\.AV_NOTE = sanitizeAvNoteWithoutSpecCaliper\(avEl\.value\)/);
  assert.match(migration, /sanitize_av_note_without_spec_caliper\(av_note\)/);
  assert.match(migration, /sanitize_av_note_without_spec_caliper\(salesnote\)/);
});

test('Table Management skill registers ten catalog entries and strict archive write rejection', () => {
  const catalog = read('assets/manager-table-management.js');
  const manifest = read('.codex/skills/agdata-table-management-and-directory/SKILL.md');
  assert.equal((catalog.match(/section: 'editable'/g) || []).length, 5);
  assert.equal((catalog.match(/section: 'archive'/g) || []).length, 5);
  assert.match(manifest, /Forbidden Anti-Patterns/);
  assert.match(read('scripts/run-tooling-release-checks.mjs'), /agdata-table-management-and-directory/);
  assert.match(read('supabase/functions/_shared/table-management.ts'), /READ_ONLY_TABLES\.has\(table\)[^\n]*MANAGER_TABLE_READ_ONLY/);
});
