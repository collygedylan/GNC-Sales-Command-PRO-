import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const api = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260901131941_dock_trip_status_global_v1.sql', import.meta.url), 'utf8');

test('shared Dock teams are stored by TRIPNUMBER with protected tables and an append-only audit', () => {
  assert.match(migration, /create table if not exists public\.ph_dock_trip_status\s*\([\s\S]*tripnumber text primary key/i);
  assert.match(migration, /create table if not exists public\.ph_dock_trip_status_audit/i);
  assert.match(migration, /alter table public\.ph_dock_trip_status enable row level security/i);
  assert.match(migration, /revoke all on table public\.ph_dock_trip_status from public, anon, authenticated/i);
  assert.match(migration, /grant select, insert, update, delete on table public\.ph_dock_trip_status to service_role/i);
});

test('Dock trip saves are transactional, revision checked, serialized, and audited', () => {
  assert.match(migration, /create or replace function public\.save_dock_trip_status_v1/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('dock-trip-status:' \|\| upper\(trip_value\), 0\)\)/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /dock_trip_revision_conflict/i);
  assert.match(migration, /insert into public\.ph_dock_trip_status_audit/i);
  assert.match(migration, /revoke all on function public\.save_dock_trip_status_v1[\s\S]*from public, anon, authenticated/i);
});

test('the protected API allows all Docks roles to read but only Admin or QC Supervisor to edit', () => {
  assert.match(api, /async function handleDockTripStatusAction/);
  assert.match(api, /normalizedRole\.includes\("ADMIN"\)[\s\S]*normalizedRole\.includes\("MANAGER"\)[\s\S]*normalizedRole\.includes\("SALESREP"\)[\s\S]*normalizedRole\.startsWith\("QC"\)[\s\S]*normalizedRole\.includes\("EVAL"\)/);
  assert.match(api, /const canEdit = FULL_ACCESS_USER_KEYS\.has\(actor\)[\s\S]*QCSUPERVISOR/);
  assert.match(api, /supabase\.rpc\("save_dock_trip_status_v1"/);
  assert.match(api, /if \(action === "dock_trip_status"\) return await handleDockTripStatusAction/);
  assert.match(api, /table === "ph_dock_team_status"[\s\S]*return false/);
});

test('the browser never reports a local-only Dock team save', () => {
  assert.doesNotMatch(html, /Dock team saved on this device/);
  assert.doesNotMatch(html, /gnc_dock_team_/);
  assert.match(html, /Reconnect before saving\. Dock teams are shared and are never stored only on this device/);
  assert.match(html, /Saved for Everyone/);
  assert.match(html, /queueAppLiveEventForWrite\('ph_dock_trip_status'/);
});

test('Dock rows require PLANSTARTDATE on or after 01\/01\/2026 and display MM\/DD\/YYYY', () => {
  const start = html.indexOf('const DOCK_CARD_PLANSTART_ALIASES');
  const end = html.indexOf('function renderDocks()', start);
  assert.ok(start > 0 && end > start, 'Dock PLANSTART helper block should be present');
  const context = vm.createContext({
    Date,
    Math,
    String,
    Number,
    Object,
    firstNonEmptyValue: (...values) => values.find((value) => value !== null && value !== undefined && String(value).trim() !== '') ?? ''
  });
  vm.runInContext(`${html.slice(start, end)};this.api={isDockRowWithinPlanStartWindow,formatDockCardPlanStartValue};`, context);
  assert.equal(context.api.isDockRowWithinPlanStartWindow({ PLANSTARTDATE: '12/31/2025' }), false);
  assert.equal(context.api.isDockRowWithinPlanStartWindow({ PLANSTARTDATE: '01/01/2026' }), true);
  assert.equal(context.api.isDockRowWithinPlanStartWindow({ PLANSTARTDATE: '2027-02-03T00:00:00Z' }), true);
  assert.equal(context.api.isDockRowWithinPlanStartWindow({ PLANSTARTDATE: '' }), false);
  assert.equal(context.api.formatDockCardPlanStartValue('2026-9-1'), '09/01/2026');
});

test('Dock cards render a separate shared team block for every TRIPNUMBER', () => {
  assert.match(html, /tripCounts: new Map\(\)/);
  assert.match(html, /entry\.tripCounts\.set\(tripNumber/);
  assert.match(html, /savedInfo: getDockTeamInfo\(tripNumber\)/);
  assert.match(html, /Edit Trip Team & Status/);
  assert.match(html, /openDockInfoModal', \[dockCard\.dockNum, trip\.tripNumber\]/);
  assert.match(html, /getDockTeamInfo\(item\.TRIPNUMBER\)/);
});

test('every Docks user sees the 2026+ rows while work actions remain assignment checked', () => {
  const start = html.indexOf('function getScopedDocksItems(');
  const end = html.indexOf('function applyRolePermissions()', start);
  const block = html.slice(start, end);
  assert.match(block, /filter\(isDockRowWithinPlanStartWindow\)/);
  assert.match(block, /if \(isRep\)/);
  assert.doesNotMatch(block, /else if \(isQc/);
  assert.match(html, /function canCurrentUserMarkDockStage[\s\S]*isDockRowQueuedForCurrentUser/);
});
