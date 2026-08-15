import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const html = read('index.html');
const css = read('assets/ops-precision-pilot.css');
const client = read('assets/ops-precision-pilot.js');
const edge = read('supabase/functions/app-api/index.ts');
const migration = read('supabase/migrations/20260815043342_dylan_live_pilot_preferences.sql');
const darkDefaultMigration = read('supabase/migrations/20260815121724_dylan_ops_precision_dark_default.sql');
const manifest = JSON.parse(read('manifest.json'));
const serviceWorker = read('sw.js');
const workflow = read('.github/workflows/pages-static.yml');
const packageJson = JSON.parse(read('package.json'));

test('release identifiers are synchronized', () => {
  const release = 'V2026.08.15.01';
  assert.match(html, new RegExp(release.replaceAll('.', '\\.')));
  assert.equal(manifest.version, release);
  assert.match(manifest.start_url, new RegExp(release.replaceAll('.', '\\.')));
  assert.match(serviceWorker, /APP_SHELL_BUILD = 'V2026\.08\.15\.01'/);
  assert.equal(packageJson.version, '2026.08.15.01');
});

test('pilot UI is drawer-only and inactive by default', () => {
  assert.match(html, /id="side-drawer"[\s\S]*id="ops-pilot-settings"[\s\S]*id="drawer-logout-btn"/);
  assert.match(html, /id="ops-pilot-settings" class="ops-pilot-settings hidden"/);
  assert.match(client, /body\.classList\.toggle\('ops-pilot-active', state\.eligible\)/);
  assert.match(client, /body\.classList\.toggle\('ops-precision-pilot', state\.eligible && state\.flags\.skin\)/);
  assert.doesNotMatch(html, /<body[^>]*ops-precision-pilot/);
});

test('server derives exact pilot eligibility from the authenticated app session', () => {
  const pilotBlock = edge.slice(edge.indexOf('type LivePilotFeatureKey'), edge.indexOf('function getSessionDisplayName'));
  assert.match(edge, /const LIVE_PILOT_USERNAME = "dylan_collyge"/);
  assert.match(pilotBlock, /getSessionUserKey\(session\)/);
  assert.match(pilotBlock, /username !== LIVE_PILOT_USERNAME/);
  assert.match(pilotBlock, /if \(!session\) return errorResponse\("Authentication required\.", 401\)/);
  assert.doesNotMatch(pilotBlock, /payload\.(?:username|user_key)/);
  assert.match(edge, /action === "get_user_preferences"/);
  assert.match(edge, /action === "set_user_preferences"/);
});

test('preference table is canonical, RLS protected, and direct browser access is revoked', () => {
  assert.match(migration, /create table if not exists public\.ph_app_user_preferences/);
  assert.match(migration, /user_key text primary key/);
  assert.match(migration, /theme_mode text not null default 'system'/);
  assert.match(migration, /display_mode text not null default 'cards'/);
  assert.match(migration, /cohort_id uuid not null default gen_random_uuid\(\) unique/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on table public\.ph_app_user_preferences from public, anon, authenticated/);
  assert.match(migration, /create policy "Deny direct preference access"[\s\S]*using \(false\)[\s\S]*with check \(false\)/);
  assert.doesNotMatch(migration, /grant (?:all|select|insert|update|delete)[^;]* to anon|grant (?:all|select|insert|update|delete)[^;]* to authenticated/i);
});

test('remote controls are independent and seeded only for the explicit pilot', () => {
  for (const key of ['skin', 'preferences', 'card_grid', 'monitoring']) {
    assert.match(migration, new RegExp(`\\('${key}', true\\)`));
  }
  assert.match(migration, /values \('dylan_collyge', 'system', 'cards'\)/);
  assert.doesNotMatch(migration, /kayla_knepp|megan_kelly|mitch_kaiser|jd_jones/);
  assert.match(client, /panel\.classList\.toggle\('hidden', !state\.eligible \|\| \(!state\.flags\.preferences && !state\.flags\.card_grid\)\)/);
  assert.match(client, /themeGroup\.classList\.toggle\('hidden', !state\.flags\.preferences\)/);
  assert.match(client, /displayGroup\.classList\.toggle\('hidden', !state\.flags\.card_grid\)/);
  assert.match(edge, /flags\.preferences \|\| flags\.card_grid \|\| flags\.monitoring/);
});

test('Dylan receives the full dark Ops Precision composition by default', () => {
  assert.match(client, /DEFAULT_PREFERENCES = Object\.freeze\(\{ themeMode: 'dark'/);
  assert.match(client, /\? mode : 'dark'/);
  assert.match(edge, /theme_mode: "dark"/);
  assert.match(darkDefaultMigration, /theme_mode = 'dark'/);
  assert.match(darkDefaultMigration, /where user_key = 'dylan_collyge'/);
  assert.match(css, /--ops-canvas: #07120e/);
  assert.match(css, /--ops-surface: #111c18/);
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /--ops-desktop-nav: 1400px/);
  assert.match(css, /--ops-wide-content: 1880px/);
});

test('preferences use timestamp last-write-wins and retain offline changes', () => {
  assert.match(edge, /\.lt\("updated_at", preferences\.updatedAt\)/);
  assert.match(edge, /Date\.parse\(latestBeforeUpdate\.updated_at\) >= Date\.parse\(preferences\.updatedAt\)/);
  assert.match(client, /dirty: parsed\.dirty === true/);
  assert.match(client, /window\.addEventListener\('online', \(\) => requestPreferenceSave\(\)/);
  assert.match(client, /timestampIsNewer\(cached\.updatedAt, serverPreferences\.updatedAt\)/);
  assert.match(client, /Math\.max\(Date\.now\(\), previous \+ 1\)/);
});

test('grid reuses mounted record nodes and enforces cards on narrow coarse pointers', () => {
  assert.match(client, /coarsePointer && Math\.min\([\s\S]*< 768/);
  assert.match(client, /classList\.toggle\('ops-record-collection'/);
  assert.match(client, /classList\.toggle\('ops-record-node'/);
  assert.match(client, /container\.closest\('\.ops-record-node'\)/);
  assert.match(css, /body\.ops-precision-pilot\.ops-grid-effective \.ops-record-collection/);
  assert.doesNotMatch(client, /innerHTML\s*=|insertAdjacentHTML/);
});

test('monitoring is exact-pinned, pilot gated, and replay/PII capture is disabled', () => {
  assert.equal(packageJson.dependencies['@sentry/browser'], '10.70.0');
  assert.match(client, /sentry-browser-10\.70\.0\.min\.js/);
  assert.match(client, /!state\.eligible \|\| !state\.flags\.monitoring/);
  assert.match(client, /sendDefaultPii: false/);
  assert.match(client, /sampleRate: 1/);
  assert.match(client, /replaysSessionSampleRate: 0/);
  assert.match(client, /replaysOnErrorSampleRate: 0/);
  assert.match(client, /delete event\.user/);
  assert.match(client, /delete event\.request/);
  assert.match(client, /delete event\.breadcrumbs/);
  assert.match(client, /const scrubbedEvent = scrubValue\(event, 0, ''\)/);
  assert.match(client, /tracePropagationTargets: \[\]/);
  assert.match(client, /SENSITIVE_KEY_PATTERN/);
  assert.doesNotMatch(client, /https:\/\/[^'"\s]+@[^'"\s]+\.ingest\.sentry\.io/);
});

test('performance bridge covers routes, renders, chunks, long tasks, and stale work', () => {
  assert.match(html, /__gncOpsPilot\.recordPerformance\(safeKind, payload\)/);
  assert.match(html, /__gncOpsPilot\.recordPerformance\('staleSkips'/);
  for (const kind of ['viewSwitches', 'renders', 'chunks', 'longTasks', 'staleSkips']) {
    assert.match(client, new RegExp(kind));
  }
  assert.match(client, /ui\.stale-work/);
});

test('static deployment includes the pilot assets and builds the pinned bundle', () => {
  assert.match(workflow, /npm run build:pilot-monitoring/);
  assert.match(workflow, /cp -r assets _site\/assets/);
  assert.match(serviceWorker, /\.\/assets\/ops-precision-pilot\.css/);
  assert.match(serviceWorker, /\.\/assets\/ops-precision-pilot\.js/);
});
