import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const migration = read('../supabase/migrations/20260904015607_emergency_drive_evidence_retry_storm_v2.sql');
const hostedProbe = read('../scripts/probe-production-auth-health.mjs');
const performanceWorkflow = read('../.github/workflows/performance-monitor.yml');
const serviceWorker = read('../sw.js');

test('compatibility and V2 saves use non-blocking locks and structured conflicts', () => {
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
  const core = migration.slice(
    migration.indexOf('create or replace function private.save_drive_evidence_core_v2'),
    migration.indexOf('-- Compatibility endpoint')
  );
  assert.match(core, /pg_try_advisory_xact_lock/);
  assert.doesNotMatch(core, /\bfor\s+update\b/i);
  assert.match(core, /DRIVE_SAVE_BUSY/);
  assert.match(core, /DRIVE_ROW_STALE/);
  assert.match(core, /DRIVE_COMPLETION_STALE/);
  assert.match(core, /DRIVE_FIELD_CONFLICT/);
  assert.match(core, /last_updated is not distinct from v_row\.last_updated/);
  assert.match(core, /case when v_payload \? 'spec'/);
  assert.match(core, /return private\.store_drive_evidence_terminal_v2/);
  assert.doesNotMatch(core.slice(core.indexOf("'code', 'DRIVE_SAVE_BUSY'"), core.indexOf('select \* into v_row')), /store_drive_evidence_terminal_v2/);
});

test('RPC grants and service health are least privilege', () => {
  assert.match(migration, /revoke all on function public\.save_drive_evidence_v1[\s\S]*from public, anon/);
  assert.match(migration, /revoke all on function public\.save_drive_evidence_v2[\s\S]*from public, anon/);
  assert.match(migration, /grant execute on function public\.save_drive_evidence_v2[\s\S]*to authenticated/);
  assert.match(migration, /revoke all on function public\.get_drive_evidence_save_health_v2\(\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.get_drive_evidence_save_health_v2\(\)[\s\S]*to service_role/);
});

test('client coalesces physical-row saves and performs only bounded retries', () => {
  const save = html.slice(
    html.indexOf('async function saveSecureDriveEvidence'),
    html.indexOf('const HEALTH_METADATA_KEYS')
  );
  assert.match(save, /supabaseRpc\('save_drive_evidence_v2'/);
  assert.match(save, /p_baseline: baseline/);
  assert.match(save, /p_evidence: evidencePatch/);
  assert.match(save, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.match(save, /if \(code === 'DRIVE_SAVE_BUSY' && attempt === 0\)/);
  assert.doesNotMatch(save, /fetchSupabasePage\(/);
  assert.match(html, /return `drive::\$\{uniqueId\}`/);
  assert.match(html, /navigator\.locks\.request/);
  assert.match(html, /new BroadcastChannel\('gnc-drive-evidence-save-v2'/);
  assert.match(html, /DRIVE_EVIDENCE_LEASE_PREFIX/);
  assert.match(html, /localStorage\.setItem\(storageKey/);
});

test('same-field conflicts persist drafts and disable background retries', () => {
  assert.match(html, /autoRetryBlocked = true/);
  assert.match(html, /conflictType = 'drive-evidence'/);
  assert.match(html, /Review Changed Row/);
  assert.match(html, /__driveEvidenceRetryParentToken/);
  assert.match(html, /parentToken\.slice\(0, 165\).*?-r1/s);
  assert.match(html, /if \(SECURE_DRIVE_EVIDENCE_PREFIXES\.has\(safePrefix\) && getDriveEvidenceConflictState\(activeItem\)\) return/);
  assert.match(html, /blockedEntry\.conflictType !== 'drive-evidence'/);
  assert.match(html, /Object\.defineProperty\(item, '__driveEvidenceBaselineOverride'/);
  for (const prefix of ['ssn', 'lsn', 'na']) {
    assert.match(html, new RegExp(`id="${prefix}-save-conflict"`));
  }
});

test('one consolidated input pipeline replaces duplicate inline submissions', () => {
  assert.match(html, /handleConsolidatedDetailEvidenceInput/);
  assert.match(html, /window\.addEventListener\('input', handleConsolidatedDetailEvidenceInput/);
  assert.doesNotMatch(html.slice(html.indexOf('function handleConsolidatedDetailEvidenceInput'), html.indexOf('function invalidateAvNotesCommonNameIndex')), /addEventListener\('change'/);
  assert.doesNotMatch(html, /onchange="saveData\(false, '(?:ssn|lsn|na)-', true\)/);
  assert.doesNotMatch(html, /onblur="saveData\(false, '(?:ssn|lsn|na)-', true\)/);
  const invalidationPersist = html.slice(
    html.indexOf('function persistMasterAvRuleClearOps'),
    html.indexOf('function processAndLoadData')
  );
  assert.doesNotMatch(invalidationPersist, /supabaseFetch\('ph_master_inventory', 'PATCH'/);
  assert.match(invalidationPersist, /Canonical AV invalidation is owned by the scheduled/);
});

test('hosted health fails on retry-storm thresholds and the isolated CI includes the repair', () => {
  assert.match(hostedProbe, /get_drive_evidence_save_health_v2/);
  assert.match(hostedProbe, /activeSaveSessions\) <= 10/);
  assert.match(hostedProbe, /recentUniqueConflicts <= 25/);
  assert.match(hostedProbe, /production_drive_evidence_retry_storm_detected/);
  assert.ok(
    hostedProbe.indexOf("throw new Error('production_drive_evidence_retry_storm_detected')")
      < hostedProbe.indexOf("throw new Error('production_request_drive_evidence_contract_unhealthy')"),
    'retry-storm health must be evaluated before unrelated Request evidence health can fail the probe'
  );
  assert.match(performanceWorkflow, /20260904015607_emergency_drive_evidence_retry_storm_v2\.sql/);
  assert.match(performanceWorkflow, /drive_evidence_retry_storm_test\.sql/);
});

test('all shell references release V2026.09.04.08', () => {
  assert.match(html, /window\.__APP_SHELL_VERSION__ = 'V2026\.09\.04\.08'/);
  assert.doesNotMatch(html, /V2026\.09\.04\.02/);
});

test('shell activation resumes when editing is idle and upgrades inactive legacy clients', () => {
  assert.match(html, /if \(!isShellReloadBlocked\(\)\) return false;/);
  assert.match(html, /shell-deferred-reload-applying/);
  assert.doesNotMatch(html, /shell-deferred-reload-held/);
  assert.match(html, /scheduleDeferredShellReloadAfterTyping\(1600\)/);
  assert.match(html, /cancelAllDriveEvidenceSaves\('shell-activation'\)/);
  assert.match(serviceWorker, /navigateInactiveClientsToCurrentShell\('sw-activated'\)/);
  assert.match(serviceWorker, /navigateInactiveClientToCurrentShell\(event\.clientId, 'inactive-network-activity'\)/);
  assert.match(serviceWorker, /client\.visibilityState !== 'hidden' && client\.focused !== false/);
  assert.match(serviceWorker, /clientUrl\.searchParams\.get\('shellr'\) === APP_SHELL_RUNTIME_REVISION/);
  assert.match(serviceWorker, /shellUrl\.searchParams\.set\('shellr', APP_SHELL_RUNTIME_REVISION\)/);
});
