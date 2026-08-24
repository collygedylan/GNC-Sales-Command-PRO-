import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const html = read('index.html');
const css = read('assets/ops-precision-pilot.css');
const client = read('assets/ops-precision-pilot.js');
const edge = read('supabase/functions/app-api/index.ts');
const migration = read('supabase/migrations/20260815043342_dylan_live_pilot_preferences.sql');
const darkDefaultMigration = read('supabase/migrations/20260815121724_dylan_ops_precision_dark_default.sql');
const requestWorkflowMigration = read('supabase/migrations/20260817154154_restore_native_request_workflow.sql');
const manifest = JSON.parse(read('manifest.json'));
const serviceWorker = read('sw.js');
const workflow = read('.github/workflows/pages-static.yml');
const playwrightConfig = read('playwright.config.ts');
const packageJson = JSON.parse(read('package.json'));
const liveShellBuild = read('scripts/build-live-shell.mjs');
const liveVendorBuild = read('scripts/vendor-live-assets.mjs');
const performanceWorkflow = read('.github/workflows/performance-monitor.yml');
const appAuth = read('supabase/functions/_shared/app-auth.ts');
const observability = read('supabase/functions/_shared/observability.ts');
const authMigration = read('supabase/migrations/20260816172822_native_auth_profiles.sql');
const compactionMigration = read('supabase/migrations/20260816172825_database_compaction_shadow.sql');
const authMigrationTool = read('scripts/migrate-custom-users-to-supabase-auth.mjs');
const authAdmin = read('supabase/functions/auth-admin/index.ts');
const passkeyRolloutMigration = read('supabase/migrations/20260817020000_enable_passkeys_for_active_profiles.sql');
const appearanceRolloutMigration = read('supabase/migrations/20260817021230_enable_appearance_preferences_for_all_users.sql');
const appsScriptBackend = read('Code.gs');
const requestRetryGuardMigration = read('supabase/migrations/20260820190857_acknowledge_stale_completed_request_work.sql');
const completeAssignmentSheetMigration = read('supabase/migrations/20260820195456_complete_eval_assignment_sheet_import.sql');
const exactAssignmentSheetMigration = read('supabase/migrations/20260820202902_reconcile_exact_assignment_sheet.sql');
const reliableDeliveryMigration = read('supabase/migrations/20260820230245_reliable_request_delivery_worker.sql');
const deliveryWorker = read('supabase/functions/request-delivery-worker/index.ts');
const productionAuthHealthWorkflow = read('.github/workflows/production-auth-health.yml');
const productionAuthHealthProbe = read('scripts/probe-production-auth-health.mjs');
const historicalReportMigration = read('supabase/migrations/20260821202202_manager_historical_report.sql');
const historicalReportBrowseMigration = read('supabase/migrations/20260821223421_historical_report_default_browse.sql');
const historicalCoverageMigration = read('supabase/migrations/20260822234500_restore_drivearound_history_and_all_report_columns.sql');
const holdLearningRefreshMigration = read('supabase/migrations/20260823002500_optimize_hold_learning_refreshes.sql');
const historicalSourceColumnsMigration = read('supabase/migrations/20260823013134_expand_historical_report_source_columns.sql');
const requiredHistoricalSourceColumns = Object.freeze([
  'warehousei', 'plantgroupcode', 'itemcode', 'qualitycode', 'contsize', 'commonname',
  'lotcode', 'locationcode', 'source', 'desigitem', 'desigcust', 'desigloc', 'priority',
  'ptronhand', 'ptrreviewed', 'ptravailable', 'holdstopcode', 'holdstopbegindate',
  'holdstopreason', 'hsreasonbegin', 'season_supply', 'season_oh', 'season_demand',
  's_lts', 'oversellpercentage', 'itemspec', 'locationnote', 'locationnotedate',
  'suspend', 'suspendto', 'specialpuller', 'pulltagnote1', 'pulltagnote2', 'fieldtagcolor',
  'salesnote', 'inventorynote', 'locationptn1', 'locationptn2', 'prisetby', 'priupdated',
  'bypassloc', 'largeptrqty', 'maxorderquantity', 'lochold', 'listprice', 'ext_ptronhand',
  'varietycode', 'genusname', 'botanicalname', 'reversecommon', 'sortnamevariety',
  'containersort', 'saleyear', 'season', 'blockalpha', 'blocknumber', 'bay',
  'pullerresponsibility', 'grower', 'si_lts', 'a_lts', 'ai_lts', 'season_available',
  'holdstopenddate', 'salesnote_1', 'fnsalesnote', 'warehousename', 'mcstatus', 'hz',
  'intercopo', 'insurancegroup', 'brand', 'printedcontainercode', 'salesnotebegindate',
  'equiv_unit', 'ext_equiv_unit'
]);

test('release identifiers are synchronized', () => {
  const release = 'V2026.08.24.07';
  assert.match(html, new RegExp(release.replaceAll('.', '\\.')));
  assert.equal(manifest.version, release);
  assert.match(manifest.start_url, new RegExp(release.replaceAll('.', '\\.')));
  assert.match(serviceWorker, new RegExp(`APP_SHELL_BUILD = '${release.replaceAll('.', '\\.')}'`));
  assert.equal(packageJson.version, '2026.08.24.07');
});

test('Queue and Drive render from the smallest canonical dataset needed for the active view', () => {
  assert.match(html, /requests: \{ table: REQUEST_QUEUE_LIVE_ROWS_TABLE,[^\n]*initialQuery: \(\) => buildActiveRequestLiveRowsQuery\('\*'\), fullQuery: \(\) => buildActiveRequestLiveRowsQuery\('\*'\)/);
  assert.match(html, /function buildActiveRequestLiveRowsQuery\(selectFields = '\*'\)[\s\S]*order=unique_id\.desc/);
  const requestLoading = html.slice(html.indexOf('function getRequestViewLoadingConfig'), html.indexOf('function getViewLoadingConfig'));
  assert.match(requestLoading, /safeTab === 'reps'[\s\S]*requestHistory[\s\S]*salesCredits/);
  assert.match(requestLoading, /safeTab === 'suspend-tag'[\s\S]*\{ key: 'soc', mode: 'full' \}/);
  assert.match(requestLoading, /return \{ required: \[requests\], background: \[\], label: 'Loading verified Que\.\.\.' \}/);
  assert.doesNotMatch(requestLoading, /required: \[requests, \{ key: 'requestHistory'[\s\S]*inventoryEditRequests[\s\S]*soc/);
  const requestTabs = html.slice(html.indexOf('function setReqTab'), html.indexOf('function resolveRequestRecipientEmail'));
  assert.match(requestTabs, /forceRefreshRequestsForView\('request-tab',[\s\S]*force: false[\s\S]*REQUEST_VIEW_VISIBLE_FORCE_REFRESH_MIN_INTERVAL_MS/);
  assert.match(requestTabs, /refreshActiveRequestQueueSideData\('request-tab-side-data',[\s\S]*force: false[\s\S]*REQUEST_QUEUE_SIDE_REFRESH_MIN_INTERVAL_MS/);
  assert.match(html, /safeKey === 'master' && visibleView === 'drive'/);
  assert.match(html, /canRenderMasterPreview[\s\S]*state\.firstPagePreviewLoaded/);
});

test('hosted performance monitoring covers real data readiness and row saves always release their coordinator', () => {
  assert.match(html, /reportPerformanceHealthEvent\('dataset_load', 'data_sync'/);
  assert.match(html, /reportPerformanceHealthEvent\('view_data_ready', 'rendering'/);
  assert.match(html, /reportPerformanceHealthEvent\('view_render', 'rendering'/);
  const saveBlock = html.slice(html.indexOf('async function saveData'), html.indexOf('function getPendingEditsCache'));
  assert.match(saveBlock, /let rowSaveKey = '';[\s\S]*rowSaveKey = getRowSaveCoordinatorKey/);
  assert.match(saveBlock, /finally \{[\s\S]*if \(rowSaveKey\) endFieldSaveActivity\(rowSaveKey\)/);
});

test('every verified session restores its user-scoped theme before the app shell paints', () => {
  assert.match(html, /const DEVICE_THEME_STORAGE_KEY = 'gnc_last_theme_v1'/);
  assert.ok(html.indexOf('function applyRememberedThemeBeforePaint') < html.indexOf('live-tailwind-v2026082010.min.css'));
  assert.match(html, /window\.__GNC_PREPAINT_THEME__ = prepaintTheme/);
  assert.match(html, /localStorage\.setItem\(DEVICE_THEME_STORAGE_KEY, prepaintTheme\)/);
  assert.match(html, /localStorage\.getItem\('gnc_verified_login_v1'\)/);
  assert.match(html, /localStorage\.getItem\('gnc_last_appearance_user_v1'\)/);
  assert.match(html, /\(verifiedLogin && verifiedLogin\.username\) \|\| rememberedAppearanceUser/);
  assert.doesNotMatch(html, /verifiedUsername && localStorage\.getItem\('gnc_explicit_logout_v1'\) !== '1'/);
  assert.match(html, /const scopedPreferenceKey = 'gnc_ops_precision_preferences_v2:' \+ verifiedUsername/);
  assert.match(html, /verifiedUsername === 'dylan_collyge' \? \(localStorage\.getItem\('gnc_ops_precision_preferences_v1'\)/);
  assert.match(html, /document\.documentElement\.dataset\.opsPrepaintTheme = prepaintTheme/);
  assert.match(html, /id="ops-theme-prepaint"[\s\S]*data-ops-prepaint-theme="dark"[\s\S]*background:#07120e !important/);
  assert.match(html, /data-ops-prepaint-theme="dark"[\s\S]*#home-dashboard-grid > div[\s\S]*background:#111c18 !important/);
  assert.match(html, /data-ops-prepaint-theme="dark"[\s\S]*#bottom-nav[\s\S]*background:#0b1c16 !important[\s\S]*color:#bfd3c9 !important/);
  assert.match(html, /data-ops-prepaint-theme="light"[\s\S]*background:#f3f7f5 !important/);
  assert.match(client, /function clearPrepaintTheme\(\)/);
  assert.match(client, /writeCachedPreferences\(state\.preferences, useDirtyCache\);[\s\S]*applyUiState\(\);[\s\S]*clearPrepaintTheme\(\)/);
  const logoutClear = html.slice(html.indexOf('function clearPersistedLoginSession'), html.indexOf('function primeOpsPilotAppearanceForVerifiedUser'));
  assert.doesNotMatch(logoutClear, /gnc_ops_precision_preferences_v[12]/);
  assert.doesNotMatch(logoutClear, /removeAttribute\('data-ops-prepaint-theme'\)/);
  assert.match(html, /apple-touch-startup-image" href="\.\/ag-data-solutions-splash-v2026081709\.png"/);
  assert.equal(manifest.background_color, '#07120e');
  assert.match(client, /DEVICE_THEME_STORAGE_KEY = 'gnc_last_theme_v1'/);
  assert.match(client, /function readRememberedDeviceTheme\(\)/);
  assert.match(client, /function writeRememberedDeviceTheme\(theme\)/);
  assert.match(client, /if \(!state\.eligible && !state\.provisional\) return readRememberedDeviceTheme\(\)/);
  assert.match(client, /preferences: getRememberedDevicePreferences\(\)/);
  assert.match(client, /const rememberedTheme = readRememberedDeviceTheme\(\)/);
  assert.match(client, /preferences: normalizePreferences\(\{ \.\.\.\(cached \|\| getRememberedDevicePreferences\(\)\), themeMode: rememberedTheme \}\)/);
});

test('V15 Queue cards and photo rails use semantic Light and Dark surfaces', () => {
  assert.match(html, /app-request-card-surface border-purple-200/);
  assert.doesNotMatch(html, /isSeasonSalesNoteCard \? 'bg-orange-100 border-orange-600' : 'bg-white border-purple-200'/);
  assert.match(html, /app-inline-thumb-box app-inline-thumb-box--empty/);
  assert.match(html, /app-inline-thumb-label app-inline-thumb-date/);
  const queueThemeCss = css.slice(css.lastIndexOf('V2026.08.17.04 — no-flash theme surfaces and Queue card photo rail'));
  assert.match(queueThemeCss, /--ops-request-card-surface: #111c18/);
  assert.match(queueThemeCss, /--ops-photo-placeholder: #16231f/);
  assert.match(queueThemeCss, /\.request-swipe-row\.app-request-card-surface > \.request-swipe-surface/);
  assert.match(queueThemeCss, /#view-request :is\(\.app-inline-thumb-box, \.app-inline-thumb\)/);
  assert.match(queueThemeCss, /#request-crumb:not\(:empty\)/);
});

test('verified login primes the saved appearance before Home is revealed', () => {
  assert.match(html, /function primeOpsPilotAppearanceForVerifiedUser\(username = ''\)/);
  assert.doesNotMatch(html.slice(html.indexOf('function primeOpsPilotAppearanceForVerifiedUser'), html.indexOf('function clearInMemorySessionIdentity')), /normalizedUsername !== 'dylan_collyge'/);
  assert.match(html, /pilot\.primeCachedAppearance\(\{[\s\S]*userKey: normalizedUsername,[\s\S]*activeView:/);
  assert.match(html, /persistVerifiedLoginRecord\(username[\s\S]*primeOpsPilotAppearanceForVerifiedUser\(normalizedUsername\)/);
  assert.match(client, /function primeCachedAppearance\(options = \{\}\)/);
  assert.match(client, /preferences: normalizePreferences\(\{ \.\.\.\(cached \|\| getRememberedDevicePreferences\(\)\), themeMode: rememberedTheme \}\)/);
  assert.match(client, /provisional: true/);
  assert.match(client, /const skinActive = true/);
  assert.match(client, /if \(!LIST_VIEWS\.has\(state\.activeView\)\) return/);
  assert.match(client, /panel\.classList\.toggle\('hidden', state\.provisional/);
  assert.match(client, /if \(serial === initializeSerial && !state\.provisional\) deactivate\(\)/);
});

test('login overlay stays up until role permissions and Home modules are ready', () => {
  const shellOpen = html.slice(html.indexOf('function openAppShellAfterLogin'), html.indexOf('function addLoginWarmupTarget'));
  assert.ok(shellOpen.indexOf('applyRolePermissions();') < shellOpen.indexOf("loginView.style.display = 'none'"));
  assert.ok(shellOpen.indexOf("ensureHomeDashboardReadyAfterLogin('login-shell-open')") < shellOpen.indexOf("loginView.style.display = 'none'"));
  const rolePermissions = html.slice(html.indexOf('function applyRolePermissions'), html.indexOf('function syncRoleAccessUi'));
  assert.doesNotMatch(rolePermissions, /view-login/);
});

test('restored sessions retry pilot bootstrap only after authenticated session refresh', () => {
  assert.match(html, /let opsPilotInitializationPromise = null/);
  assert.match(html, /function initializeOpsPilotForCurrentSession\(reason = ''\)/);
  assert.match(html, /if \(!currentUser \|\| navigator\.onLine === false\) return Promise\.resolve\(false\)/);
  assert.match(html, /const sessionToken = getCurrentAppSessionToken\(\);[\s\S]*if \(!sessionToken\) return Promise\.resolve\(false\)/);
  assert.match(html, /if \(opsPilotInitializationPromise\) return opsPilotInitializationPromise/);
  assert.match(html, /pilot\.initialize\(getOpsPilotBridge\(reason\)\)/);
  assert.match(client, /initialized: state\.initialized/);
  assert.match(html, /persistVerifiedLoginRecord\(normalizedUsername[\s\S]*initializeOpsPilotForCurrentSession\('session-refreshed'\)/);
  assert.match(html, /initializeOpsPilotForCurrentSession\(isRestoredSession \? 'restored-session' : 'login-ready'\)/);
  assert.match(html, /window\.addEventListener\('online'[\s\S]*initializeOpsPilotForCurrentSession\('online'\)/);
  assert.match(html, /document\.addEventListener\('visibilitychange'[\s\S]*initializeOpsPilotForCurrentSession\('foreground'\)/);
  assert.doesNotMatch(html, /currentUser\s*===\s*['"]dylan_collyge['"]/);
});

test('premium skin and Appearance controls are global and remain drawer-only and server gated', () => {
  assert.match(html, /id="side-drawer"[\s\S]*id="ops-pilot-settings"[\s\S]*id="drawer-logout-btn"/);
  assert.match(html, /id="ops-pilot-settings" class="ops-pilot-settings hidden"/);
  assert.match(html, /ops-pilot-settings__eyebrow"><i class="ph-duotone ph-palette"><\/i> Appearance/);
  assert.ok(html.indexOf('<div class="drawer-header">Menu</div>') < html.indexOf('id="ops-pilot-settings"'));
  assert.ok(html.indexOf('id="ops-pilot-settings"') < html.indexOf('id="drawer-home-btn"'));
  assert.ok(html.indexOf('id="ops-security-settings"') > html.indexOf('id="ops-pilot-settings"'));
  assert.ok(html.indexOf('id="ops-passkey-settings"') > html.indexOf('id="ops-security-settings"'));
  assert.match(html, /id="ops-security-settings" class="ops-security-settings hidden"/);
  assert.match(css, /\.ops-security-settings:not\(\.hidden\)\s*\{[\s\S]*?display: block/);
  assert.match(css, /body\.ops-pilot-active \.ops-pilot-segmented button[\s\S]*min-height: 44px !important/);
  assert.match(client, /body\.classList\.toggle\('ops-pilot-active', state\.eligible && !state\.provisional\)/);
  assert.match(client, /body\.classList\.add\('ops-precision-pilot', 'ag-premium-skin', 'premium-skin-v16'\)/);
  assert.match(html, /<body[^>]*ops-precision-pilot[^>]*ag-premium-skin[^>]*premium-skin-v16/);
  assert.match(client, /if \(!state\.eligible && !state\.provisional\) return readRememberedDeviceTheme\(\)/);
});

test('server derives global Appearance eligibility from the authenticated session identity', () => {
  const pilotBlock = edge.slice(edge.indexOf('type LivePilotFeatureKey'), edge.indexOf('function getSessionDisplayName'));
  assert.match(edge, /const LEGACY_DARK_DEFAULT_USERNAME = "dylan_collyge"/);
  assert.match(pilotBlock, /getSessionUserKey\(session\)/);
  assert.doesNotMatch(pilotBlock, /username !== (?:LIVE_PILOT_USERNAME|LEGACY_DARK_DEFAULT_USERNAME)/);
  assert.match(pilotBlock, /if \(!session\) return errorResponse\("Authentication required\.", 401\)/);
  assert.match(pilotBlock, /if \(!username\) return errorResponse\("Authenticated user identity is required\.", 403\)/);
  assert.match(pilotBlock, /readOrCreateLivePilotPreferenceRow\(username\)/);
  assert.match(pilotBlock, /\.eq\("user_key", username\)/);
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

test('remote controls are independent and preferences are seeded for every active profile', () => {
  for (const key of ['skin', 'preferences', 'card_grid', 'monitoring']) {
    assert.match(migration, new RegExp(`\\('${key}', true\\)`));
  }
  assert.match(migration, /values \('dylan_collyge', 'system', 'cards'\)/);
  assert.match(appearanceRolloutMigration, /from public\.profiles p/);
  assert.match(appearanceRolloutMigration, /where p\.disabled_at is null/);
  assert.match(appearanceRolloutMigration, /on conflict \(user_key\) do nothing/);
  assert.match(appearanceRolloutMigration, /'preferences', true/);
  assert.match(appearanceRolloutMigration, /'card_grid', true/);
  assert.match(client, /panel\.classList\.toggle\('hidden', state\.provisional \|\| !state\.eligible \|\| \(!state\.flags\.preferences && !state\.flags\.card_grid\)\)/);
  assert.match(client, /themeGroup\.classList\.toggle\('hidden', !state\.flags\.preferences\)/);
  assert.match(client, /displayGroup\.classList\.toggle\('hidden', !state\.flags\.card_grid\)/);
  assert.match(edge, /flags\.preferences \|\| flags\.card_grid/);
  assert.match(edge, /monitoringEligible/);
});

test('all users receive Light/Dark and Cards/Grid with a preserved Dylan dark default', () => {
  assert.match(client, /DEFAULT_PREFERENCES = Object\.freeze\(\{ themeMode: 'light'/);
  assert.match(client, /LEGACY_DARK_DEFAULT_USERNAME = 'dylan_collyge'/);
  assert.match(client, /PREFERENCE_STORAGE_KEY_PREFIX = 'gnc_ops_precision_preferences_v2:'/);
  assert.match(client, /getDefaultPreferencesForUser\(userKey\)/);
  assert.match(client, /getPreferenceStorageKey\(userKey = state\.userKey\)/);
  assert.match(html, /getUserKey: \(\) => normalizeSessionIdentity\(currentUser\)/);
  assert.match(client, /return mode === 'light' \? 'light' : 'dark'/);
  assert.match(edge, /theme_mode: userKey === LEGACY_DARK_DEFAULT_USERNAME \? "dark" : "light"/);
  assert.match(darkDefaultMigration, /theme_mode = 'dark'/);
  assert.match(darkDefaultMigration, /where user_key = 'dylan_collyge'/);
  assert.match(css, /--ops-canvas: #07120e/);
  assert.match(css, /--ops-surface: #111c18/);
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(css, /V2026\.08\.15\.12 final responsive and theme cascade[\s\S]*grid-template-rows: none !important/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /--ops-desktop-nav: 1400px/);
  assert.match(css, /--ops-wide-content: 1880px/);
});

test('all users receive one menu-only Light and Dark selector with legacy System mapped to Dark', () => {
  const themeButtons = html.match(/data-ops-theme-mode="[^"]+"/g) || [];
  assert.deepEqual(themeButtons, ['data-ops-theme-mode="light"', 'data-ops-theme-mode="dark"']);
  assert.doesNotMatch(html, /data-ops-theme-mode="system"/);
  assert.match(html, /class="ops-theme-choice" data-ops-theme-mode="light"[\s\S]*ph-duotone ph-sun[\s\S]*<span>Light<\/span>/);
  assert.match(html, /class="ops-theme-choice" data-ops-theme-mode="dark"[\s\S]*ph-duotone ph-moon[\s\S]*<span>Dark<\/span>/);
  assert.match(client, /return mode === 'light' \? 'light' : 'dark'/);
  assert.match(client, /querySelectorAll\('button\[data-ops-theme-mode\]'\)/);
  assert.match(client, /querySelectorAll\('button\[data-ops-display-mode\]'\)/);
  assert.match(client, /body\.dataset\.opsTheme = effectiveTheme/);
  assert.match(css, /\.ops-theme-selector[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.ops-theme-choice\[aria-pressed="true"\][\s\S]*content: "Active"/);
});

test('light and dark modes provide theme-aware command, pill, chat, form, and navigation tokens', () => {
  assert.match(css, /--ops-command: #f7fbf9/);
  assert.match(css, /--ops-chat-shell: #f8fbf9/);
  assert.match(css, /--ops-chat-theirs: #ffffff/);
  assert.match(css, /data-ops-theme="dark"[\s\S]*--ops-command: #0a1712/);
  assert.match(css, /data-ops-theme="dark"[\s\S]*--ops-chat-shell: #0a1511/);
  assert.match(css, /#global-header-inline-title,[\s\S]*background: var\(--ops-command\) !important/);
  assert.match(css, /\.app-card-qty-chip:nth-child\(4\)[\s\S]*background: var\(--ops-pill-violet-bg\) !important/);
  assert.match(css, /\.android-message-bubble\.theirs[\s\S]*background: var\(--ops-chat-theirs\) !important/);
  assert.match(css, /\.android-composer-pill[\s\S]*background: var\(--ops-chat-input\) !important/);
  assert.match(css, /#bottom-nav[\s\S]*var\(--ops-chat-shadow\)/);
});

test('precision shell keeps one persistent module back control and promotes queue search into the header', () => {
  assert.match(css, /#global-header-search-row\.hidden[\s\S]*display: flex !important/);
  assert.match(css, /#global-header-inline-back\.hidden[\s\S]*display: inline-flex !important/);
  assert.match(css, /#view-wrapper \.back-btn[\s\S]*display: none !important/);
  assert.match(html, /classList\.contains\('ops-precision-pilot'\) && activeReqTab === 'suspend-tag'/);
  assert.match(html, /mode === 'suspend-tag' \? 'Search common name\.\.\.'/);
  assert.match(html, /const commonSearchHtml = precisionSearch \? ''/);
  assert.match(html, /currentView === 'po-management'[\s\S]*goBackPoManagementDrilldown\(\)/);
});

test('Home alone shows identity metadata while modules use the compact command header', () => {
  assert.match(html, /body\.current-view-home #global-header-search-row,[\s\S]*display:none!important/);
  assert.match(html, /body:not\(\.current-view-home\) #app-top-chrome \.nav-header\{display:none!important\}/);
  assert.match(html, /body:not\(\.current-view-home\) #global-header-search-row,[\s\S]*display:flex!important/);
  assert.match(css, /ops-precision-pilot\.current-view-home #global-header-search-row,[\s\S]*display: none !important/);
  assert.match(css, /ops-precision-pilot:not\(\.current-view-home\) #app-top-chrome \.nav-header[\s\S]*display: none !important/);
  assert.match(html, /building: 'building-search-container'/);
  assert.match(html, /const homeIdentityOnly = chromeState\.currentView === 'home' && !chromeState\.showHomeBack/);
  assert.match(html, /const visibleBack = naturalBack/);
  assert.match(html, /if \(homeIdentityOnly\)[\s\S]*searchRow\.classList\.add\('hidden'\)/);
});

test('primary module icons use a restrained single-weight treatment', () => {
  const homeBlock = html.slice(html.indexOf('id="home-dashboard-grid"'), html.indexOf('id="home-dynamic-content-sales"'));
  const bottomNavBlock = html.slice(html.indexOf('id="bottom-nav"'), html.indexOf('id="app-script-source"'));
  const drawerBlock = html.slice(html.indexOf('id="side-drawer"'), html.indexOf('id="main-scroll-area"'));
  assert.match(homeBlock, /id="home-tile-drive"[\s\S]*class="ph ph-car/);
  assert.match(homeBlock, /id="home-tile-reports"[\s\S]*class="ph ph-chart-bar/);
  assert.doesNotMatch(homeBlock, /id="home-tile-[^\"]+"[\s\S]{0,420}class="ph-(?:bold|duotone)/);
  assert.match(bottomNavBlock, /class="ph-duotone ph-house"/);
  assert.match(bottomNavBlock, /class="ph-duotone ph-chat-circle-dots"/);
  assert.match(drawerBlock, /class="ph-duotone ph-palette"/);
  assert.match(drawerBlock, /class="ph-duotone ph-arrows-clockwise"/);
  assert.match(css, /--ops-icon-well:/);
  assert.match(css, /#view-home #home-dashboard-grid > div > i[\s\S]*border-radius: 10px !important/);
  assert.match(css, /\.drawer-item > i[\s\S]*width: 34px !important/);
  assert.match(css, /\.footer-nav-btn:is\(\.active, \.menu-open, \[aria-current="page"\]\) > i/);
  assert.match(css, /text-transform: none !important/);
});

test('dark cards and chat have explicit high-contrast presentation without replacing handlers', () => {
  assert.match(css, /\.app-card-qty-chip:nth-child\(4\)[\s\S]*color: #d5c8ff !important[\s\S]*background: rgba\(124, 58, 237, 0\.2\) !important/);
  assert.match(css, /\.text-violet-600[\s\S]*color: #d5c8ff !important/);
  assert.match(css, /\.android-chat-header > button:first-child[\s\S]*display: none !important/);
  assert.match(css, /\.android-message-bubble\.mine[\s\S]*linear-gradient\(135deg, #08794b, #0b9a60\)/);
  assert.match(css, /\.android-message-bubble\.theirs[\s\S]*background: #192822 !important/);
  assert.match(html, /class="chat-thread-composer" onsubmit="event\.preventDefault\(\); sendChatMessage\(\);"/);
  assert.match(html, /class="android-icon-btn mic chat-voice-hold-btn voice-talk-btn/);
});

test('preferences use timestamp last-write-wins and retain offline changes', () => {
  assert.match(edge, /\.lt\("updated_at", preferences\.updatedAt\)/);
  assert.match(edge, /Date\.parse\(latestBeforeUpdate\.updated_at\) >= Date\.parse\(preferences\.updatedAt\)/);
  assert.match(client, /dirty: parsed\.dirty === true/);
  assert.match(client, /window\.addEventListener\('online', \(\) => requestPreferenceSave\(\)/);
  assert.match(client, /timestampIsNewer\(cached\.updatedAt, serverPreferences\.updatedAt\)/);
  assert.match(client, /Math\.max\(Date\.now\(\), previous \+ 1\)/);
});

test('grid reuses mounted record nodes and is disabled on phone viewports', () => {
  assert.match(client, /function gridIsSupportedHere\(\)/);
  assert.match(client, /Math\.min\(viewportWidth, viewportHeight\) >= 640/);
  assert.match(client, /button\.toggleAttribute\('disabled', unavailable\)/);
  assert.match(client, /Cards are always used on phones/);
  assert.match(client, /classList\.toggle\('ops-record-collection'/);
  assert.match(client, /classList\.toggle\('ops-record-node'/);
  assert.match(client, /container\.closest\('\.ops-record-node'\)/);
  assert.match(css, /body\.ops-precision-pilot\.ops-grid-effective \.ops-record-collection/);
  assert.doesNotMatch(client, /innerHTML\s*=|insertAdjacentHTML/);
});

test('monitoring is exact-pinned, authenticated-session gated, and replay/PII capture is disabled', () => {
  assert.equal(packageJson.dependencies['@sentry/browser'], '10.70.0');
  assert.match(client, /sentry-browser-10\.70\.0\.min\.js/);
  assert.match(client, /!state\.monitoringEligible \|\| !state\.flags\.monitoring/);
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

test('modern login separates saved accounts from fresh credentials without a theme flash', () => {
  assert.match(html, /id="login-title">Welcome back</);
  assert.match(html, /id="saved-login-account"/);
  assert.match(html, /id="login-credential-fields"/);
  assert.match(html, /id="pin-code"[^>]*type="password"|type="password"[^>]*id="pin-code"/);
  assert.match(html, /id="login-password-toggle"[\s\S]*toggleLoginPasswordVisibility/);
  assert.match(html, /function useAnotherLoginAccount\(\)/);
  assert.match(html, /function setLoginButtonPresentation\(/);
  assert.match(css, /html\[data-ops-prepaint-theme="dark"\][\s\S]*--login-surface: #111c18/);
  assert.match(css, /#view-login \.login-card[\s\S]*border-radius: 18px !important/);
});

test('mobile and tablet keyboards keep login controls visible and login reads retry safely', () => {
  assert.match(html, /const LOGIN_READ_TIMEOUT_MS = 15000/);
  assert.match(html, /for \(let attempt = 0; attempt <= LOGIN_FETCH_RETRY_COUNT; attempt \+= 1\)/);
  assert.match(html, /attempt >= LOGIN_FETCH_RETRY_COUNT \|\| !isRetryableLoginReadError\(error\)/);
  assert.match(html, /\[408, 429, 500, 502, 503, 504\]\.includes\(status\)/);
  assert.match(html, /function revealLoginFieldAboveKeyboard\(inputEl\)[\s\S]*scrollIntoView\(\{ block: 'center'/);
  const loginInteractionBlock = html.slice(html.indexOf('function toggleLoginPasswordVisibility'), html.indexOf('function primeSavedLoginUiOnStartup'));
  assert.doesNotMatch(loginInteractionBlock, /preventScroll: true/);
  assert.match(loginInteractionBlock, /revealLoginFieldAboveKeyboard\(input\)/);
  assert.match(loginInteractionBlock, /revealLoginFieldAboveKeyboard\(usernameInput\)/);
  const keyboardCascadeIndex = css.lastIndexOf('V2026.08.15.14 — final keyboard-safe authentication lock');
  const finalPhoneCascadeIndex = css.lastIndexOf('mobile cascade lock');
  assert.ok(keyboardCascadeIndex > finalPhoneCascadeIndex, 'keyboard cascade must follow all phone and tablet breakpoints');
  const releaseCascadeIndex = css.indexOf('V2026.08.16.07 final cascade lock', keyboardCascadeIndex);
  const keyboardCascade = css.slice(keyboardCascadeIndex, releaseCascadeIndex);
  assert.match(keyboardCascade, /body\.keyboard-open #view-login[\s\S]*height: var\(--visual-height, 100dvh\) !important/);
  assert.match(keyboardCascade, /overflow-y: auto !important/);
  assert.match(keyboardCascade, /\.login-brand-lockup[\s\S]*display: none !important/);
  assert.doesNotMatch(keyboardCascade, /@media \(max-width: 639px\)/);
});

test('Drive universal search preserves drill state and renders only its results while typing', () => {
  assert.match(html, /drive_universal: \(item\) => \[item\.COMMONNAME, item\.LOCATIONCODE, item\.ITEMCODE, item\.CONTSIZE, item\.LOTCODE, item\.DESIGCUST, item\.DESIGITEM, item\.DESIGLOC\]/);
  assert.match(html, /function captureDriveStateBeforeUniversalSearch\(\)/);
  assert.match(html, /function restoreDriveStateAfterUniversalSearch\(\)/);
  assert.match(html, /function renderDriveUniversalSearchResultsOnly\(\)/);
  assert.match(html, /filterBySearch\(drivePlantFilterState\.filteredItems, safeTerm, 'drive_universal'\)/);
  assert.match(html, /const driveUniversalSearchResultCache=new Map\(\)/);
  assert.match(html, /while \(driveUniversalSearchResultCache\.size > 24\)/);
  assert.match(html, /renderDriveRecordResults\('drive-universal-search'/);
  assert.match(html, /if \(renderDriveUniversalSearchResultsOnly\(\)\) return;[\s\S]*renderViewContent\('drive'/);
  const searchHandler = html.slice(html.indexOf('function handleDriveSearch'), html.indexOf('function selectDriveName'));
  assert.doesNotMatch(searchHandler, /resetDriveDrillSelectionState\(\)/);
  assert.match(html, /oncompositionstart="beginDriveSearchComposition\(\)"/);
  assert.match(html, /oncompositionend="endDriveSearchComposition\(event\)"/);
  assert.match(searchHandler, /driveSearchCompositionActive \|\| \(event && event\.isComposing\)/);
  assert.match(html, /currentInput === input && input\.isConnected\) return/);
  assert.match(html, /String\(replacement\.value \|\| ''\) !== valueBeforeRender/);
  assert.match(html, /\? 100 : 60/);
});

test('Drive Common Name search keeps the grouped drill workflow instead of opening row cards', () => {
  assert.match(html, /function shouldRenderDriveUniversalDetailedSearch\(\)\s*\{\s*return activeDriveTab !== 'name';\s*\}/);
  const universalRenderer = html.slice(
    html.indexOf('function renderDriveUniversalSearchResultsOnly'),
    html.indexOf('function scheduleDriveSearchRequest')
  );
  assert.match(universalRenderer, /!shouldRenderDriveUniversalDetailedSearch\(\)/);
  assert.match(html, /if \(activeDriveTab === 'name'\) \{[\s\S]*renderDriveCommonNameDrill\(container, crumb, driveModeLabel, driveViewState\)/);
  assert.match(html, /function selectDriveName\(name\)[\s\S]*selectedDriveName = name;[\s\S]*driveViewLevel = 1/);
  assert.match(html, /function getDriveSearchProfile\(\)[\s\S]*activeDriveTab === 'name'\) return 'drive_name'/);
});

test('native Auth Request workflow preserves role-gated create, photo/spec update, completion, and history writes', () => {
  assert.match(requestWorkflowMigration, /create or replace function private\.can_write_requests\(\)/);
  assert.match(requestWorkflowMigration, /grant select, insert, update, delete on table public\.ph_active_request to authenticated/);
  assert.match(requestWorkflowMigration, /grant select, insert, update, delete on table public\.ph_request_history to authenticated/);
  assert.match(requestWorkflowMigration, /create policy ph_active_request_native_insert[\s\S]*with check \(\(select private\.can_write_requests\(\)\)\)/);
  assert.match(requestWorkflowMigration, /create policy ph_active_request_native_update[\s\S]*using \(\(select private\.can_write_requests\(\)\)\)[\s\S]*with check \(\(select private\.can_write_requests\(\)\)\)/);
  assert.match(requestWorkflowMigration, /drop policy if exists "Allow app write request history"/);
  assert.match(html, /REQ_DESIRED_SPEC/);
  assert.match(html, /REQ_PHOTO_LINK/);
  assert.match(html, /window\.__gncOpsPilot\.captureFailure\('commit', firstError \|\| new Error\('Request save failed'\)\)/);
});

test('Drive results rendering never rewinds a later mobile search keystroke', () => {
  const start = html.indexOf('function preserveDriveSearchCaret');
  const end = html.indexOf('function renderDriveUniversalSearchResultsOnly', start);
  assert.ok(start > 0 && end > start);
  const dom = new JSDOM('<input id="drive-search" value="a">', { pretendToBeVisual: true });
  const input = dom.window.document.getElementById('drive-search');
  input.focus();
  input.setSelectionRange(1, 1);
  let scheduledFrames = 0;
  const preserve = new Function(
    'document',
    'requestAnimationFrame',
    `${html.slice(start, end)}; return preserveDriveSearchCaret;`
  )(dom.window.document, () => { scheduledFrames += 1; });

  preserve(() => {
    input.value = 'ar';
    input.setSelectionRange(2, 2);
  });

  assert.equal(input.value, 'ar');
  assert.equal(input.selectionStart, 2);
  assert.equal(input.selectionEnd, 2);
  assert.equal(scheduledFrames, 0);
});

test('installed Android keyboard changes cannot replace or blur the active command search', () => {
  const runtimePause = html.slice(
    html.indexOf('function shouldPauseRuntimeSelfHealForActiveEntry'),
    html.indexOf('function isUserActivelyTyping')
  );
  assert.match(runtimePause, /isMobileTextEntryTarget\(activeEntry\)/);
  assert.match(runtimePause, /document\.activeElement === activeEntry/);

  const runtimeRepair = html.slice(
    html.indexOf('function repairIosRuntimeLayout'),
    html.indexOf('function deleteAppCacheDatabase')
  );
  assert.ok(
    runtimeRepair.indexOf('if (shouldPauseRuntimeSelfHealForActiveEntry()) return false;')
      < runtimeRepair.indexOf('standaloneShellBaseHeight = 0;'),
    'active text entry must stop runtime repair before viewport state or DOM ownership changes'
  );
  assert.match(runtimeRepair, /if \(window\.visualViewport && isIOSDevice\(\)\)/);
  assert.doesNotMatch(runtimeRepair, /if \(window\.visualViewport\) \{[\s\S]*scheduleIosRuntimeSelfHeal\('visual-resize'/);

  const globalHeaderSync = html.slice(
    html.indexOf('function syncGlobalHeaderChrome'),
    html.indexOf('function installAmazonHeaderChrome')
  );
  assert.match(globalHeaderSync, /focusedSearchIsAlreadyMounted/);
  assert.ok(
    globalHeaderSync.indexOf('if (focusedSearchIsAlreadyMounted)')
      < globalHeaderSync.indexOf('restoreGlobalHeaderSearchContainers();'),
    'focused command input must remain mounted before header ownership can be rebuilt'
  );
});

test('Reclass is an email-only Item Inquiry while legacy quantity and transfer labels remain available', () => {
  const actionBuilder = html.slice(html.indexOf('function buildArgosInventoryTransactionRailHtml'), html.indexOf('function normalizeArgosInventoryNumber'));
  const modalBuilder = html.slice(html.indexOf('function ensureArgosInventoryTransactionModal'), html.indexOf('function renderArgosInventoryTransactionSource'));
  const payloadBuilder = html.slice(html.indexOf('function buildArgosInventoryTransactionPayload'), html.indexOf('async function postArgosInventoryTransactionPayload'));
  assert.match(actionBuilder, /ARGOS_INVENTORY_TRANSACTION_ACTIONS = Object\.freeze\(\['reclass'\]\)/);
  assert.match(actionBuilder, /openArgosInventoryTransactionModal\('\$\{safeUid\}', 'reclass'/);
  assert.doesNotMatch(actionBuilder, /Open quantity transaction|Open transfer transaction|ALT\+Q|ALT\+T/);
  assert.doesNotMatch(modalBuilder, /data-argos-transaction-tab="(?:qty|transfer)"/);
  assert.match(payloadBuilder, /type: 'reclass_inquiry_email'/);
  assert.match(payloadBuilder, /idempotencyToken:/);
  assert.match(payloadBuilder, /const rowOverlays = collectArgosReclassInquiryOverlays\(\)/);
  assert.match(payloadBuilder, /movementRequested \? quantity : null/);
  assert.match(payloadBuilder, /Quantity to move must be greater than 0 when proposing a move/);
  assert.match(payloadBuilder, /requestAction === 'hold' \|\| requestAction === 'stop_ship'/);
  const serverHandler = appsScriptBackend.slice(appsScriptBackend.indexOf('function handleInventoryTransaction_'), appsScriptBackend.indexOf('function normalizeInventoryTransactionHistoryLimit_'));
  assert.ok(serverHandler.indexOf("=== 'reclass'") < serverHandler.indexOf('LockService.getScriptLock()'), 'cached Reclass clients must route away before the mutation lock');
  assert.match(appsScriptBackend, /payload\.type === 'reclass_inquiry_email'[\s\S]*handleReclassInquiryEmail_/);
  const inquiryHandler = appsScriptBackend.slice(appsScriptBackend.indexOf('function handleReclassInquiryEmail_'), appsScriptBackend.indexOf('function handleInventoryTransaction_'));
  assert.doesNotMatch(inquiryHandler, /patchEmailApprovalMasterRow_|insertInventoryTransactionAudit_|emitAppLiveEvent_|updateInventoryRecord|History/);
  assert.match(inquiryHandler, /HtmlService\.createHtmlOutput\(printHtml\)\.getBlob\(\)\.getAs\(MimeType\.PDF\)/);
  assert.match(inquiryHandler, /CacheService\.getScriptCache\(\)/);
  assert.match(html, /if \(safeAction === 'qty'\) return 'QTY'/);
  assert.match(html, /if \(safeAction === 'transfer'\) return 'TRANSFER'/);
});

test('design pills and Drive metrics use the professional responsive card system', () => {
  assert.match(html, /class="app-data-pill app-data-pill--location\$\{compactClass\}"/);
  assert.match(html, /<div class="app-drive-card-title-row">[\s\S]*<div class="app-drive-card-quantity-band">\$\{driveQuantityRowHtml\}<\/div>/);
  assert.match(css, /\.app-data-pill[\s\S]*overflow-wrap: anywhere/);
  assert.match(css, /\.app-drive-card-quantity-band \.app-card-qty-row[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(css, /@media \(max-width: 639px\)[\s\S]*\.app-drive-card-quantity-band \.app-card-qty-row[\s\S]*grid-template-columns: repeat\(2/);
});

test('REP users can add eligible Drive rows to Bloom Picker without reopening Drive request selection', () => {
  const selectionPolicy = html.slice(
    html.indexOf('function canCurrentUserSelectDriveWorkflowRow'),
    html.indexOf('function isCurrentDriveCardOptionsContext')
  );
  const mutationPolicy = html.slice(
    html.indexOf('function canCurrentUserUseDriveCardOptions'),
    html.indexOf('function canCurrentUserSelectDriveWorkflowRow')
  );
  const driveCardBuilder = html.slice(
    html.indexOf('const canUseDriveOptions = canCurrentUserUseDriveCardOptions(item, sourceView);'),
    html.indexOf("if(sourceView==='tasks')")
  );
  assert.match(selectionPolicy, /access && access\.isRepLike && canUseDriveQuickRequest\(\)/);
  assert.match(selectionPolicy, /return canCurrentUserUseDriveCardOptions\(/);
  assert.match(mutationPolicy, /return isWarehouseAssignedDriveCardForCurrentUser\(/);
  assert.match(driveCardBuilder, /const canSelectDriveWorkflow = canCurrentUserSelectDriveWorkflowRow\(item, sourceView\)/);
  assert.match(driveCardBuilder, /driveCheckboxHtml = canSelectDriveWorkflow \?/);
  assert.match(driveCardBuilder, /driveArgosRailHtml = canUseDriveOptions \?/);
  assert.doesNotMatch(driveCardBuilder, /driveArgosRailHtml = canSelectDriveWorkflow \?/);
  assert.match(selectionPolicy, /access && access\.isRep && !access\.isCsr\) return false/);
  assert.match(html, /canAddItemToBloomPicker[\s\S]*canRepAddBloomPickerRow[\s\S]*access && access\.isRep && !access\.isCsr && isBloomPickerEligibleItem\(item\)/);
  assert.match(html, /handleInventoryCardBottomCartAction[\s\S]*selectionSource = safeSourceView === 'drive' && access\.isRep && !access\.isCsr \? 'drive-bloom'/);
  assert.match(html, /toggleGlobalItem[\s\S]*canSelectDriveBloomPicker = isDriveBloomPickerSelection && canAddItemToBloomPicker\(item, 'drive-bloom'\)/);
  assert.match(html, /getBloomPickerActionVisibility[\s\S]*hasRepBloomOnlySelection[\s\S]*showRequest: hasRepBloomOnlySelection \? false : canUseInventoryActions/);
  assert.match(driveCardBuilder, /includeDriveBloomPickerBtn = canAddItemToBloomPicker\(item, sourceView\)[\s\S]*driveRoleAccess\.isRep && !driveRoleAccess\.isCsr/);
  assert.match(html, /renderDriveQuickRequestBar[\s\S]*activeDriveTab === 'card' && canUseDriveQuickRequest\(\)/);
});

test('phone Home tiles fill both columns and Drive cards retain the thumbnail with Reclass at top right', () => {
  const cascadeLockIndex = css.lastIndexOf('V2026.08.15.12 final responsive and theme cascade');
  const driveMobileCascadeIndex = css.lastIndexOf('V2026.08.15.11 mobile cascade lock');
  const legacyMobileGridIndex = css.lastIndexOf('grid-template-areas: "main main" "bottom reclass"');
  assert.ok(cascadeLockIndex > legacyMobileGridIndex, 'mobile repair must follow every legacy phone card rule');
  const mobileCascade = css.slice(cascadeLockIndex);
  const driveMobileCascade = css.slice(driveMobileCascadeIndex, cascadeLockIndex);
  assert.match(mobileCascade, /grid-auto-rows: max-content !important/);
  assert.match(mobileCascade, /#view-home #home-dashboard-grid > div[\s\S]*width: 100% !important[\s\S]*height: auto !important[\s\S]*justify-self: stretch !important/);
  assert.doesNotMatch(css, /\.app-drive-card-photo\s*\{\s*display:\s*none\s*!important/);
  assert.match(driveMobileCascade, /\.app-drive-card-photo\s*\{[\s\S]*display: block !important/);
  assert.match(driveMobileCascade, /\.app-drive-card-reclass\s*\{[\s\S]*position: absolute !important;[\s\S]*top: 0 !important;[\s\S]*right: 0 !important;/);
  assert.match(css, /grid-template-areas: "photo main reclass" "bottom bottom bottom"/);
});

test('final responsive shell measures every Home row against the fixed quick bar', () => {
  const finalCascadeIndex = css.lastIndexOf('V2026.08.16.07 — measured Home viewport fit with fixed quick navigation');
  assert.ok(finalCascadeIndex > 0, 'the measured Home fit must be the final Home cascade');
  const finalCascade = css.slice(finalCascadeIndex);
  assert.match(finalCascade, /current-view-home\.home-dashboard-mode[\s\S]*#main-scroll-area \{[\s\S]*overflow: hidden !important/);
  assert.match(finalCascade, /grid-template-columns: repeat\(var\(--home-fit-columns, 2\), minmax\(0, 1fr\)\)/);
  assert.match(finalCascade, /grid-auto-rows: var\(--home-fit-tile-height, 44px\)/);
  assert.match(finalCascade, /min-height: 44px !important;[\s\S]*max-height: none !important/);
  assert.match(finalCascade, /@media \(min-width: 1100px\)[\s\S]*repeat\(6, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(finalCascade, /max-height: 210px/);
});

test('top banners and sticky module controls use semantic surfaces in both themes', () => {
  const finalCascade = css.slice(css.lastIndexOf('V2026.08.15.14 — global Ag Data Solutions premium presentation system'));
  assert.match(finalCascade, /--ui-header: linear-gradient\(118deg, #05623c 0%, #07874f 56%, #056f42 100%\)/);
  assert.match(finalCascade, /data-ops-theme="dark"[\s\S]*--ui-header: linear-gradient\(118deg, rgba\(6, 27, 19, 0\.98\)/);
  assert.match(finalCascade, /#app-top-chrome[\s\S]*background: var\(--ui-header\) !important/);
  assert.match(finalCascade, /#app-top-chrome :is\(\.nav-header, #global-header-search-row\)[\s\S]*background: transparent !important/);
  assert.match(finalCascade, /\.ui-panel,[\s\S]*background: var\(--ui-surface\) !important;[\s\S]*background-image: none !important/);
  assert.match(html, /themeColorMeta\.setAttribute\('content', prepaintTheme === 'dark' \? '#07120e' : '#07874f'\)/);
  assert.match(client, /themeColorMeta\.setAttribute\('content', effectiveTheme === 'dark' \? '#07120e' : '#07874f'\)/);
});

test('active Chat is a full-height iPhone-style conversation with keyboard-safe composing', () => {
  const communicationCascade = css.slice(css.lastIndexOf('V2026.08.15.13 — full-height messaging and unified Communication surfaces'));
  assert.match(communicationCascade, /current-view-chat\.chat-conversation-open #main-scroll-area[\s\S]*overflow: hidden !important/);
  assert.match(communicationCascade, /current-view-chat\.chat-conversation-open #view-wrapper,[\s\S]*height: 100% !important;[\s\S]*min-height: 0 !important/);
  assert.match(communicationCascade, /current-view-chat\.chat-conversation-open \.chat-thread-shell,[\s\S]*height: 100% !important;[\s\S]*max-height: none !important/);
  assert.match(communicationCascade, /@media \(max-width: 767px\)[\s\S]*\.android-chat-shell[\s\S]*border-width: 0 !important;[\s\S]*border-radius: 0 !important/);
  assert.match(communicationCascade, /chat-conversation-open\.keyboard-open #main-scroll-area[\s\S]*inset: var\(--app-top-chrome-height, 0px\) 0 0 !important/);
  assert.match(html, /document\.body\.classList\.toggle\('chat-conversation-open', !!activeChatConversationId\)/);
  assert.match(html, /function handleChatMessageInput\(input = null\)/);
  assert.match(html, /function resizeChatMessageInput\(input = null\)/);
  assert.match(html, /id="chat-message-send"[\s\S]*ph-arrow-up/);
  assert.match(html, /chatMessageSendInFlight=true|chatMessageSendInFlight = true/);
});

test('Chat message groups and Communication calendar use the modern semantic system', () => {
  const communicationCascade = css.slice(css.lastIndexOf('V2026.08.15.13 — full-height messaging and unified Communication surfaces'));
  assert.match(html, /function formatChatDaySeparator\(value = ''\)/);
  assert.match(html, /function chatMessagesBelongToGroup\(first = null, second = null\)/);
  assert.match(html, /class="chat-day-separator" role="separator"/);
  assert.match(html, /class="chat-message-author"/);
  assert.match(html, /id="communication-hub-grid"/);
  assert.match(communicationCascade, /#view-communication #communication-hub-grid[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(communicationCascade, /#view-communication \.communication-hub-card[\s\S]*background: linear-gradient\(145deg, var\(--ops-surface\)/);
  assert.match(communicationCascade, /#view-department-calendar :is\([\s\S]*\.department-calendar-toolbar,[\s\S]*background: var\(--ops-surface\) !important/);
  assert.match(communicationCascade, /#view-department-calendar \.department-calendar-grid[\s\S]*background: var\(--ops-calendar-gridline\) !important/);
  assert.match(communicationCascade, /@media \(max-width: 767px\)[\s\S]*\.department-calendar-grid[\s\S]*repeat\(7, minmax\(0, 1fr\)\)/);
});

test('V14 exposes one global semantic component layer without changing workflow nodes', () => {
  const premiumCascade = css.slice(css.lastIndexOf('V2026.08.15.14 — global Ag Data Solutions premium presentation system'));
  assert.match(premiumCascade, /--ops-brand: #07874f/);
  assert.match(premiumCascade, /--ops-canvas: #f3f7f5/);
  assert.match(premiumCascade, /--ops-surface: #ffffff/);
  assert.match(premiumCascade, /--ops-text: #13221b/);
  assert.match(premiumCascade, /data-ops-theme="dark"[\s\S]*--ops-brand: #19b979/);
  assert.match(premiumCascade, /data-ops-theme="dark"[\s\S]*--ops-surface: #111c18/);
  assert.match(premiumCascade, /\.ui-surface,[\s\S]*\.ui-panel,[\s\S]*\.ui-card/);
  assert.match(premiumCascade, /\.ui-field,[\s\S]*input:not\(\[type="checkbox"\]\)/);
  assert.match(premiumCascade, /\.ui-tab:is\(\.active, \[aria-selected="true"\]\)/);
  assert.match(client, /function decoratePremiumComponents\(\)/);
  assert.match(client, /classList\.add\('ui-field'\)/);
  assert.match(client, /classList\.add\('ui-panel'\)/);
  assert.match(client, /classList\.add\('ui-card'\)/);
  assert.doesNotMatch(client, /replaceWith\([^)]*(?:button|form|article)/);
});

test('V14 uses self-contained single-weight line icons for primary navigation and launchers', () => {
  assert.match(client, /const PREMIUM_ICON_PATHS = Object\.freeze/);
  assert.match(client, /const PREMIUM_ICON_SELECTOR = \[/);
  assert.match(client, /#home-dashboard-grid > :is\(div, button\) > i/);
  assert.match(client, /#bottom-nav \.footer-nav-btn > i/);
  assert.match(client, /createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', 'svg'\)/);
  assert.match(client, /stroke-width', '2'/);
  assert.match(client, /focusable', 'false'/);
  assert.match(css, /\.premium-line-icon[\s\S]*pointer-events: none/);
  assert.match(css, /#view-home #home-dashboard-grid > div > \.premium-line-icon[\s\S]*background: transparent !important/);
});

test('V14 locks premium responsive grids, safe navigation clearance, motion, and loading states', () => {
  const premiumCascade = css.slice(css.lastIndexOf('V2026.08.15.14 — global Ag Data Solutions premium presentation system'));
  assert.match(premiumCascade, /#view-home #home-dashboard-grid > div,[\s\S]*aspect-ratio: 1 \/ 1 !important;[\s\S]*border: 2px solid/);
  assert.match(premiumCascade, /@media \(min-width: 640px\) and \(max-width: 839px\)[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(premiumCascade, /@media \(min-width: 840px\) and \(max-width: 1099px\)[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(premiumCascade, /@media \(min-width: 1100px\)[\s\S]*repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(premiumCascade, /@media \(max-width: 639px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(premiumCascade, /env\(safe-area-inset-bottom\)/);
  assert.match(premiumCascade, /\.ui-action[\s\S]*--ui-duration-fast/);
  assert.match(premiumCascade, /premium-skeleton-shimmer 1\.35s/);
  assert.match(premiumCascade, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(premiumCascade, /focus-visible[\s\S]*outline: 2px solid var\(--ops-focus\)/);
});

test('static deployment includes the pilot assets and builds the pinned bundle', () => {
  assert.match(workflow, /npm run build:pilot-monitoring/);
  assert.match(workflow, /npm run build:live:assets/);
  assert.match(workflow, /npm run build:live:shell/);
  assert.match(workflow, /cp -r assets _site\/assets/);
  assert.match(serviceWorker, /\.\/assets\/ops-precision-pilot\.css/);
  assert.match(serviceWorker, /\.\/assets\/ops-precision-pilot\.js/);
  assert.match(serviceWorker, /live-app-runtime-v2026082010\.min\.js/);
  assert.match(html, /assets\/vendor\/supabase-browser-2\.112\.3\.min\.js/);
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|unpkg\.com\/@phosphor-icons|cdn\.jsdelivr\.net\/npm\/@supabase/);
  assert.match(liveShellBuild, /deployedBytes > 1_500_000/);
  assert.match(liveVendorBuild, /@phosphor-icons/);
});

test('V16 Home uses one authorization-backed primary module registry and leaves nested workflows in their hubs', () => {
  assert.match(html, /const HOME_MODULE_REGISTRY = Object\.freeze\(\[/);
  for (const view of ['drive', 'docks', 'av', 'communication', 'sales', 'managers', 'building', 'qc', 'office', 'sales-inventory', 'production', 'reports']) {
    assert.match(html, new RegExp(`\\{ view: '${view}'`));
  }
  const registrySource = html.slice(html.indexOf('const HOME_MODULE_REGISTRY'), html.indexOf('function ensureHomeModuleRegistry'));
  for (const nestedView of ['tasks', 'request', 'crop-roll', 'take-back', 'reserves', 'disease-pest', 'sales-office', 'moves', 'hours', 'low-stock', 'review', 'move-up', 'advertisement', 'grower', 'pest-management']) {
    assert.doesNotMatch(registrySource, new RegExp(`\\{ view: '${nestedView}'`));
  }
  assert.equal((registrySource.match(/\{ view:/g) || []).length, 12);
  for (const nestedHubControl of ['sales-open-bloom-orders', 'production-open-take-back', 'production-open-disease-pest', 'office-open-sales']) {
    assert.match(html, new RegExp(`id="${nestedHubControl}"`));
  }
  assert.match(html, /function ensureHomeModuleRegistry\(\)/);
  assert.match(html, /data-home-module-view=/);
  assert.match(html, /const isAllowed = canAccessView\(module\.view\)/);
  assert.match(html, /authorizedModuleCount/);
  assert.match(html, /renderedModuleCount/);
});

test('V15 Queue, Tasks, and Docks use compact single-row workflow controls', () => {
  assert.match(html, /id="request-filter-toolbar"[^>]*workflow-control-rail/);
  assert.match(html, /class="request-category-options" role="group" aria-label="Queue category"/);
  assert.match(html, /class="request-category-chip/);
  assert.doesNotMatch(html, /id="request-category-select"/);
  assert.match(html, /request: 'request-filter-toolbar'/);
  assert.match(html, /function getAuthorizedRequestCategories/);
  assert.match(html, /const filteredRequestItems = baseRequestItems/);
  assert.match(html, /id="dock-mode-select"/);
  assert.match(html, /buildDockModeFilterControlHtml/);
  assert.match(html, /id="docks-mode-toggle" class="hidden" aria-hidden="true"/);
  assert.ok(html.indexOf('id="team-selector"') < html.indexOf('id="task-crumb"'), 'Task controls must precede the breadcrumb');
  const finalCascade = css.slice(css.lastIndexOf('V2026.08.16.07 final cascade lock'));
  assert.match(finalCascade, /workflow-control-rail,[\s\S]*flex-flow: row nowrap !important/);
  assert.match(finalCascade, /#view-tasks \.task-controls-sticky[\s\S]*overflow-x: auto !important/);
});

test('module filter bands share one responsive gap below the command search', () => {
  for (const view of ['av', 'reports', 'request', 'docks', 'drive', 'tasks', 'review', 'move-up']) {
    const viewSource = html.slice(html.indexOf(`id="view-${view}"`), html.indexOf(`id="view-${view}"`) + 2_400);
    assert.match(viewSource, /ops-module-filter-band/, `${view} must opt into the shared filter-band spacing contract`);
  }
  assert.match(css, /--ops-module-search-filter-gap: 18px/);
  assert.match(css, /ops-module-filter-band:not\(\.fixed-filter-rail\)[\s\S]*margin-top: var\(--ops-module-search-filter-gap\) !important/);
  assert.match(css, /@media \(min-width: 1100px\)[\s\S]*--ops-module-search-filter-gap: clamp\(56px, 7\.5vh, 84px\)/);
  assert.match(html, /function getModuleFilterGapPx\(railEl\)/);
  assert.match(html, /getFixedFilterRailTopPx\(globalSearchRow, rail\)/);
  assert.match(html, /getModuleFilterGapPx\(rail\) \+ height/);
});

test('V16 preserves mobile search state and renders Grid as a spreadsheet', () => {
  assert.match(html, /let docksSearchRestoreState=null/);
  assert.match(html, /debounceDelay: 100/);
  assert.match(html, /event && event\.isComposing/);
  assert.match(html, /allowWhileTyping: true/);
  assert.match(html, /container\.dataset\.driveDetailedRecords = 'true'/);
  assert.match(html, /delete inactiveContainer\.dataset\.driveDetailedRecords/);
  assert.match(html, /function buildDriveSpreadsheetTableHtml\(items = \[\]\)/);
  assert.match(html, /function applyDriveSpreadsheetHeaderFilters\(sheet = null\)/);
  assert.match(html, /class="drive-grid-filter-row"/);
  assert.match(html, /buildDriveSpreadsheetFilterControlHtml\('common', 'Common Name'\)/);
  assert.match(html, /buildDriveSpreadsheetFilterControlHtml\('open-stock', 'Open Stock', 'number'\)/);
  assert.match(html, /Clear column filters/);
  assert.match(html, /class="drive-grid-table"/);
  assert.match(html, /<th scope="col">Common Name<\/th>/);
  assert.match(html, /renderDriveRecordResults\('drive-universal-search'/);
  assert.match(css, /\.drive-grid-table[\s\S]*table-layout: fixed !important/);
  assert.match(css, /\.drive-grid-table :is\(th, td\)[\s\S]*white-space: nowrap !important/);
  assert.match(css, /\.drive-grid-filter-row > th[\s\S]*top: 42px !important/);
  assert.match(css, /\.drive-grid-filter-control[\s\S]*height: 32px !important/);
  assert.doesNotMatch(html, /id="tab-drive-season-sales-notes"/);
  assert.doesNotMatch(html, /bindFastInvokeById\('tab-drive-season-sales-notes'/);
});

test('V16 Drive controls share one horizontal rail and Home uses measured adaptive rows', () => {
  assert.match(html, /id="drive-toolbar-rail" class="drive-toolbar-rail"/);
  assert.match(html, /drive-top-controls-shell:v11-single-rail/);
  assert.match(css, /#drive-toolbar-rail[\s\S]*flex-flow: row nowrap !important/);
  assert.match(css, /#drive-toolbar-rail[\s\S]*overflow-x: auto !important/);
  assert.match(html, /--home-fit-columns/);
  assert.match(html, /--home-fit-tile-height/);
  assert.match(html, /--home-fit-card-width/);
  assert.match(html, /--home-fit-bottom-clearance/);
  assert.match(html, /const clearanceTargetPx = desktopLayout/);
  assert.match(html, /clamp\(Math\.round\(profile\.height \* 0\.036\), 24, 48\)/);
  assert.match(html, /homeDashboardFitResizeObserver = new ResizeObserver/);
  assert.match(html, /document\.fonts\.addEventListener\('loadingdone'/);
  assert.match(css, /grid-template-columns: repeat\(var\(--home-fit-columns, 2\)/);
  assert.match(css, /current-view-home\.home-dashboard-mode[\s\S]*#main-scroll-area \{[\s\S]*overflow: hidden !important/);
});

test('V15 Chat and navigation are measured against the visible viewport', () => {
  assert.match(client, /--ops-content-available-height/);
  assert.match(client, /--footer-nav-reserve/);
  assert.match(client, /window\.visualViewport\.addEventListener\('resize'/);
  assert.match(client, /new ResizeObserver\(scheduleLayoutHealthCheck\)/);
  assert.match(css, /current-view-chat[\s\S]*grid-template-rows: auto minmax\(0, 1fr\) auto !important/);
  assert.match(css, /current-view-chat \.chat-thread-composer[\s\S]*visibility: visible !important/);
  assert.match(css, /data-ops-theme="dark"\] #bottom-nav[\s\S]*rgba\(10, 28, 21, \.96\)/);
});

test('Item Inquiry keeps the full Reclass model while adding a phone-specific read-only view', () => {
  const renderer = html.slice(
    html.indexOf('const ITEM_INQUIRY_IDENTITY_FIELDS'),
    html.indexOf('function setDriveAltLocSeason')
  );
  for (const field of ['PLANTGROUPCODE', 'COMMONNAME', 'CONTSIZE', 'ITEMCODE', 'GENUSNAME', 'FIELDTAGCOLOR', 'ITEMSPEC', 'PULLERRESPONSIBILITY']) {
    assert.match(renderer, new RegExp(`label: '${field}'`));
  }
  for (const field of ['LOTCODE', 'LOCATIONCODE', 'SOURCE', 'PRIORITY', 'DesigItem', 'DesigCust', 'DesigLoc', 'PTRONHAND', 'PTRREVIEWED', 'PTRAVAILABLE', 'LOCATIONNOTEDATE', 'LOCATIONNOTE', 'PULLTAGNOTE1', 'PULLTAGNOTE2', 'LOCATIONPTN1', 'LOCATIONPTN2', 'HOLDSTOPCODE', 'HOLDSTOPREASON']) {
    assert.match(renderer, new RegExp(`label: '${field}'`));
  }
  for (const field of ['SALEYEAR', 'SEASON', 'S_LTS', 'SUPPLY', 'ON HAND', 'DEMAND']) {
    assert.match(renderer, new RegExp(`label: '${field}'`));
  }
  assert.match(renderer, /function buildItemInquiryViewModel/);
  assert.match(renderer, /normalizeItemInquirySaleYear/);
  assert.match(renderer, /seasonSeen\.has/);
  assert.match(renderer, /renderItemInquiryReadOnlyWorkspace/);
  assert.match(renderer, /renderItemInquiryMobileWorkspace/);
  assert.match(renderer, /ITEM_INQUIRY_DISPLAY_IDENTITY_FIELDS/);
  assert.match(renderer, /ITEM_INQUIRY_DISPLAY_ROW_FIELDS/);
  assert.match(renderer, /ITEM_INQUIRY_MOBILE_DETAIL_FIELDS/);
  assert.match(renderer, /ITEM_INQUIRY_MOBILE_LOT_FIELDS/);
  assert.match(renderer, /'pulltagnote2'/);
  assert.match(renderer, /'locationptn2'/);
  assert.match(renderer, /distinctDisplayValue\('holdstopcode'\)/);
  assert.match(renderer, /item-inquiry-mobile-season-card/);
  assert.match(renderer, /item-inquiry-mobile-location/);
  assert.match(renderer, /item-inquiry-mobile-lot--current/);
  assert.match(renderer, /Open in Drive Mode/);
  assert.match(html, /function syncMobileDetailTabSelector/);
  assert.match(html, /function handleMobileDetailTabChange/);
  assert.match(html, /id="det-mobile-tab-select"/);
  const inquiryCss = css.slice(css.lastIndexOf('V2026.08.17.04 — responsive Item Inquiry ledger'));
  assert.match(inquiryCss, /overflow-x: hidden !important/);
  assert.match(inquiryCss, /grid-template-columns: 78px 92px[\s\S]*130px 130px/);
  assert.match(inquiryCss, /item-inquiry-ledger-scroll[\s\S]*overflow-x: auto/);
  assert.match(inquiryCss, /item-inquiry-season-grid[\s\S]*repeat\(6, max-content\)/);
  assert.match(inquiryCss, /item-inquiry-summary-grid[\s\S]*grid-auto-columns: max-content/);
  assert.match(inquiryCss, /@media \(max-width: 1099px\)[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(inquiryCss, /@media \(max-width: 640px\)[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(inquiryCss, /#det-tabs-container \{[\s\S]*display: none !important/);
  assert.match(inquiryCss, /#det-mobile-tab-select-wrap:not\(\.hidden\)/);
  assert.match(inquiryCss, /item-inquiry-mobile-view[\s\S]*overflow-y: auto/);
  assert.match(inquiryCss, /item-inquiry-desktop-view[\s\S]*display: none !important/);
  assert.match(inquiryCss, /border-right: 1px solid var\(--ops-border\)/);
});

test('Historical Report preserves every requested worksheet column in source order', () => {
  const sourceSpecsExpression = appsScriptBackend.match(
    /DRIVE_AROUND_HISTORY_REPORT_COLUMN_SPECS = Object\.freeze\((\[[\s\S]*?\])\);/
  )?.[1];
  const uiColumnsExpression = html.match(
    /MANAGER_HISTORICAL_REPORT_COLUMNS = Object\.freeze\((\[[\s\S]*?\])\);/
  )?.[1];
  assert.ok(sourceSpecsExpression);
  assert.ok(uiColumnsExpression);
  const sourceColumns = Function(`return ${sourceSpecsExpression}`)().map((spec) => spec[0]);
  const uiColumns = Function(`return ${uiColumnsExpression}`)().map((column) => column.key);
  assert.deepEqual(sourceColumns, requiredHistoricalSourceColumns);
  assert.deepEqual(uiColumns.filter((column) => requiredHistoricalSourceColumns.includes(column)), requiredHistoricalSourceColumns);
  assert.equal(new Set(sourceColumns).size, 76);
  assert.match(html, /key: 'salesnote_1', label: 'SALESNOTE \(2\)'/);
  for (const column of requiredHistoricalSourceColumns) {
    assert.match(historicalSourceColumnsMigration, new RegExp(`'${column}'`));
  }
});

test('Item Inquiry uses the master ItemCode index and renders only the active responsive layout', () => {
  const indexBuilder = html.slice(
    html.indexOf('function rebuildMasterInventoryIndexes'),
    html.indexOf('function invalidateMasterDerivedInventories')
  );
  const inquiryRows = html.slice(
    html.indexOf('function getItemInquiryRows'),
    html.indexOf('const ITEM_INQUIRY_IDENTITY_FIELDS')
  );
  const inquiryRenderer = html.slice(
    html.indexOf('function isItemInquiryPhoneLayout'),
    html.indexOf('function renderItemInquiryDetailPanel')
  );
  assert.match(html, /let masterInventoryByItemCode=new Map\(\)/);
  assert.match(indexBuilder, /masterInventoryByItemCode\.get\(itemCode\)\.push\(item\)/);
  assert.match(inquiryRows, /masterInventoryByItemCode\.get\(itemCode\) \|\| \[\]/);
  assert.doesNotMatch(inquiryRows, /const rows = \(Array\.isArray\(fullInventory\)/);
  assert.match(inquiryRenderer, /if \(isItemInquiryPhoneLayout\(\)\) return renderItemInquiryMobileWorkspace/);
  assert.match(inquiryRenderer, /return desktopHtml;/);
  assert.doesNotMatch(inquiryRenderer, /desktopHtml \+ renderItemInquiryMobileWorkspace/);
  assert.match(inquiryRenderer, /itemInquiryPhoneMediaQuery\.addEventListener\('change'/);
});

test('V15 monitoring is authenticated for all users and remains anonymous', () => {
  assert.match(edge, /monitoringEligible/);
  assert.doesNotMatch(edge, /username !== (?:LIVE_PILOT_USERNAME|LEGACY_DARK_DEFAULT_USERNAME)[\s\S]*eligible: false/);
  assert.match(edge, /tracesSampleRate: 0\.1/);
  assert.match(client, /sessionId: createSessionId\(\)/);
  assert.match(client, /session_id: state\.sessionId/);
  assert.match(client, /const HEALTH_ASSERTIONS/);
  for (const assertion of ['chat_composer', 'home_modules', 'home_fit', 'nav_theme', 'toolbar_row', 'drive_card_width', 'task_search']) {
    assert.match(client, new RegExp(assertion));
  }
  for (const metric of ['clearance_px', 'tile_width_px', 'tile_height_px', 'overlap_px', 'overflow_x_px', 'overflow_y_px']) {
    assert.match(client, new RegExp(metric));
  }
  assert.doesNotMatch(client, /state\.cohortId|cohort_id:/);
  assert.match(client, /sendDefaultPii: false/);
  assert.match(client, /replaysSessionSampleRate: 0/);
  assert.match(html, /recordPerformance\('search',[\s\S]*cancelled: true/);
});

test('Task command search commits the latest term and keeps its filter rail pinned below the header', () => {
  const taskSearch = html.slice(
    html.indexOf('function beginTaskHeaderSearchComposition'),
    html.indexOf('function setTaskLocationDetailGenusFilter')
  );
  assert.match(taskSearch, /scheduleSearchRender\('task-header-search'/);
  assert.match(taskSearch, /debounceDelay: 100/);
  assert.match(taskSearch, /interactiveCritical: true/);
  assert.match(taskSearch, /revision !== taskHeaderSearchRevision/);
  assert.match(taskSearch, /renderViewContent\('tasks', false, true\)/);
  assert.match(taskSearch, /captureHealth\('task_search', committed/);
  assert.match(taskSearch, /term_length:/);
  assert.match(taskSearch, /search_applied: semanticSearchApplied/);
  assert.doesNotMatch(taskSearch, /query:/);
  assert.match(html, /oncompositionstart="beginTaskHeaderSearchComposition\(\)"/);
  assert.match(html, /oncompositionend="endTaskHeaderSearchComposition\(this\.value\)"/);
  const taskRailCss = css.slice(css.lastIndexOf('Task search is mounted in the global command bar'));
  assert.match(taskRailCss, /current-view-tasks #view-tasks \.task-controls-sticky\.ops-module-filter-band[\s\S]*position: sticky !important/);
  assert.match(taskRailCss, /top: 0 !important/);
  assert.match(taskRailCss, /margin: 10px 0 8px !important/);
});

test('Task command search filters every visible drill level, including All at location detail', () => {
  const resolvedState = html.slice(
    html.indexOf('function buildResolvedTaskState'),
    html.indexOf('function buildNcrApprovalColumnHeaderReviewHtml')
  );
  assert.match(resolvedState, /const taskSearchApplicationMode = getTaskHeaderSearchApplicationMode/);
  assert.match(resolvedState, /const shouldApplyTopTaskSearch = taskSearchApplicationMode === 'collection'/);
  assert.doesNotMatch(resolvedState, /taskSearchProfile === 'task_commonname'/);
  assert.match(resolvedState, /nextTabItems = filterBySearch\(nextTabItems, taskSearchTerm, taskSearchProfile\)/);
  const taskRenderer = html.slice(
    html.indexOf('function renderTasks('),
    html.indexOf('function renderReserves(')
  );
  assert.match(taskRenderer, /const taskLocationDetailSearchActive = !!selectedTaskLoc[\s\S]*getTaskHeaderSearchApplicationMode[\s\S]*=== 'detail'/);
  assert.match(taskRenderer, /filterBySearch\(taskLocationDetailBaseItems, taskLocationDetailSearchTerm, 'task_location_detail'\)/);
  assert.match(taskRenderer, /shouldRenderTaskLocationDetailFilters \|\| taskLocationDetailSearchActive[\s\S]*\? taskLocationDetailItems/);
  assert.match(taskRenderer, /reportTaskHeaderSearchHealth\(activeTaskSearchRevision, taskSearchVisibleCount, taskSearchAppliedForRender\)/);
});

test('Task search application mode executes the production level contract', () => {
  const match = html.match(/function getTaskHeaderSearchApplicationMode\([\s\S]*?\n        \}/);
  assert.ok(match, 'Task search application mode should exist');
  const createMode = new Function(
    'activeTaskView',
    'taskViewLevel',
    'taskLocationDetailSearchTerm',
    'shouldShowTaskHeaderSearch',
    'taskViewUsesBlockDrill',
    `return (${match[0]});`
  );
  const mode = createMode('av-blanks', 0, '', () => true, () => true);
  assert.equal(mode('av-blanks', 0, 'karl'), 'collection');
  assert.equal(mode('av-blanks', 1, 'karl'), 'collection');
  assert.equal(mode('av-blanks', 2, 'karl'), 'detail');
  assert.equal(mode('av-blanks', 2, ''), 'none');
  const hiddenMode = createMode('av-blanks', 0, '', () => false, () => true);
  assert.equal(hiddenMode('av-blanks', 0, 'karl'), 'none');
});

test('CI gates responsive release checks in Chromium, Firefox, and WebKit', () => {
  assert.match(workflow, /playwright install --with-deps chromium firefox webkit/);
  assert.match(playwrightConfig, /name: 'chromium'/);
  assert.match(playwrightConfig, /name: 'firefox'/);
  assert.match(playwrightConfig, /name: 'webkit'/);
});

test('V06 contains runaway requests and uses bounded retry and cache policies', () => {
  assert.match(html, /const APP_LIVE_EVENTS_ENABLED = false/);
  assert.match(html, /Views without an event source refresh on entry/);
  assert.match(html, /pollMs: hasRealtimeSource \? getLiveSyncPollIntervalMs\(policy\.pollMs\) : 0/);
  assert.match(html, /REALTIME_FALLBACK_BASE_MS = 5000/);
  assert.match(html, /REALTIME_FALLBACK_MAX_MS = 300000/);
  assert.match(html, /runWithFullJitter\(operation, maxRetries = 3, baseDelayMs = 500, capDelayMs = 8000\)/);
  assert.match(html, /retryAuthorized = !!\(String\(opts\.idempotencyKey/);
  assert.match(serviceWorker, /IMAGE_CACHE_MAX_ENTRIES = 500/);
  assert.match(serviceWorker, /IMAGE_CACHE_MAX_AGE_MS = 30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(serviceWorker, /IMAGE_CACHE_MAX_BYTES = 100 \* 1024 \* 1024/);
  assert.match(serviceWorker, /PRIVATE_NETWORK_PATH_REGEX/);
  assert.doesNotMatch(serviceWorker, /client\.navigate/);
  assert.doesNotMatch(serviceWorker.slice(serviceWorker.indexOf("self.addEventListener('activate'"), serviceWorker.indexOf("self.addEventListener('message'")), /client\.navigate/);
});

test('V06 request detail fits the viewport and never renders collapsed AV cards', () => {
  assert.match(html, /const visibleRows = isOpen \? rows\.slice\(0, 80\) : \[\]/);
  assert.match(html, /const rowsHtml = isOpen && visibleRows\.length/);
  assert.match(html, /collectRequestItemCodeOptionRowsFromLocalCache/);
  assert.match(html, /if \(end < fullInventory\.length\) await yieldToUiFrame\(\)/);
  assert.match(html, /const settleLayoutOnly = \(settleReason = ''\) =>/);
  assert.match(css, /request detail viewport fit and collapsed-panel performance shell/);
  assert.match(css, /#view-detail\.detail-request-mode:not\(\.hidden\)[\s\S]*overflow: hidden !important/);
  assert.match(css, /#det-request-content:not\(\.hidden\)[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important/);
  assert.match(css, /request-detail-av-options-open[\s\S]*overflow-y: auto !important/);
});

test('V09 avoids billable Storage transforms and unifies Columns and Excel controls', () => {
  const storageUrlHelper = html.slice(
    html.indexOf("function buildSupabaseStorageThumbnailUrl"),
    html.indexOf("function getSupabaseStorageOriginalUrl")
  );
  assert.match(storageUrlHelper, /nextUrl\.pathname = objectPrefix \+ publicPath/);
  assert.doesNotMatch(storageUrlHelper, /nextUrl\.pathname = renderPrefix/);
  assert.doesNotMatch(storageUrlHelper, /searchParams\.set\('(width|quality|resize)'/);
  assert.match(html, /ops-view-option-control[^\n]+data-drive-filter-shell="columns"/);
  assert.match(html, /ops-view-option-control[^\n]+data-av-filter-shell="columns"/);
  assert.match(html, /ops-view-option-control[^\n]+data-dock-filter-shell="columns"/);
  assert.match(html, /ops-view-option-action drive-mode-export-button/);
  assert.match(html, /id="av-export-btn" class="ops-view-option-action/);
  assert.match(html, /id="sales-office-export-btn" class="ops-view-option-action/);
  const sharedControlCss = css.slice(css.lastIndexOf('V2026.08.16.14 — shared View / Columns / Excel control contract'));
  assert.match(sharedControlCss, /\.ops-view-option-control, \.ops-view-option-action/);
  assert.match(sharedControlCss, /min-height: 44px !important/);
  assert.match(sharedControlCss, /background: var\(--ops-surface\) !important/);
  assert.match(sharedControlCss, /border: 1px solid var\(--ops-border\) !important/);
});

test('V07 native Auth rollout is additive, bridged, and RLS-first', () => {
  assert.match(html, /const NATIVE_AUTH_ENABLED = true/);
  assert.match(html, /const NATIVE_AUTH_ALIAS_DOMAIN = 'greenleafnursery\.com'/);
  assert.match(html, /const NATIVE_AUTH_PROFILE_CACHE_KEY = 'gnc_native_auth_profile_v1'/);
  assert.match(html, /navigator\.onLine === false[\s\S]*readCachedNativeAuthProfile\(session\.user\.id\)/);
  assert.match(html, /cacheNativeAuthProfile\(data\)/);
  assert.match(html, /auth\.signInWithPassword\(\{ email, password: String\(password\) \}\)/);
  assert.match(html, /auth\.signInWithPasskey\(\)/);
  assert.match(html, /auth\.registerPasskey\(\)/);
  assert.match(html, /auth\.passkey\.delete\(\{ passkeyId:/);
  assert.match(appAuth, /supabaseAdmin\.auth\.getUser\(bearer\)/);
  assert.match(appAuth, /authUserId: String\(user\.id\)/);
  assert.match(appAuth, /if \(error \|\| !user\?\.id\) throw new Error\("native_session_unavailable"\)/);
  assert.match(appAuth, /return await readAppSessionFromRequest\(req\)/);
  assert.match(edge, /action === "native_session_bridge"/);
  assert.match(edge, /session\.ver < 2/);
  assert.match(html, /async function ensureNativeAppSessionBridge\(force = false\)/);
  assert.match(html, /action: 'native_session_bridge'/);
  assert.match(edge, /DIRECT_RLS_REQUIRED/);
  assert.match(authMigration, /references auth\.users\(id\) on delete cascade/);
  assert.match(authMigration, /alter table public\.profiles enable row level security/);
  assert.match(authMigration, /function public\.get_app_user_directory\(requested_roles text\[\] default null\)/);
  assert.match(authMigration, /revoke all on function public\.get_app_user_directory\(text\[\]\) from public, anon/);
  assert.match(html, /table === 'ph_app_users'[\s\S]*fetchNativeAppUserDirectory\(nativeHeaders, query, readTimeoutMs\)/);
  assert.doesNotMatch(authMigration, /create policy profiles_update_safe_self/);
  assert.match(authMigrationTool, /const execute = process\.argv\.includes\('--execute'\)/);
  assert.match(authMigrationTool, /email_confirm: true/);
  assert.match(authMigrationTool, /@greenleafnursery\.com/);
  assert.match(authMigrationTool, /--sync-existing-passwords/);
  assert.match(authMigrationTool, /admin\.auth\.admin\.updateUserById\(authUser\.id/);
  assert.doesNotMatch(authMigrationTool, /password[^\n]*process\.stdout/);
  assert.match(authAdmin, /admin\.auth\.getUser\(token\)/);
  assert.match(authAdmin, /app_metadata\?\.auth_admin === true/);
  assert.match(authAdmin, /admin\.auth\.admin\.createUser/);
  assert.match(authAdmin, /@greenleafnursery\.com/);
  assert.match(authAdmin, /admin\.auth\.admin\.updateUserById/);
  assert.doesNotMatch(authAdmin, /readSupabaseOrAppSessionFromRequest/);
});

test('acknowledged Eval assignments replace stale local rows before the unassigned view rerenders', () => {
  assert.match(html, /function applyAcknowledgedEvalAssignmentResults\(assignments = \[\], rpcResults = \[\], assignedto = ''\)/);
  assert.match(html, /merged\.ASSIGNEDTO = acknowledged\.canonicalAssignee/);
  assert.match(html, /const appliedCount = applyAcknowledgedEvalAssignmentResults\(assignments, rpcResults, assignee\);[\s\S]*scheduleManagersRender\(true\);[\s\S]*showToast\('Assignments Saved'/);
  assert.match(html, /await reloadWarehouseAssignmentsAfterMutation\(\);[\s\S]*finally \{[\s\S]*applyAcknowledgedEvalAssignmentResults\(assignments, rpcResults, assignee\)/);
});

test('Kayla remains a sales rep while her global request-manager permission enables request photos and saves', () => {
  assert.match(html, /function canRepEditDetailPrefix\(prefix = ''\)[\s\S]*normalizedPrefix === 'req-' && canUseGlobalRequestAccess\(\)/);
  assert.match(html, /function canEditRowDetails\(prefix = '', itemOverride = null\)[\s\S]*isRepReadOnlyUser\(\) && !canRepEditDetailPrefix\(normalizedPrefix\)/);
  assert.match(html, /async function handlePhotoUpload\(input, prefix\)[\s\S]*isRepReadOnlyUser\(\) && !canRepEditDetailPrefix\(prefix\)/);
  assert.match(html, /const REQUEST_GLOBAL_ACCESS_TOKENS = new Set\(\['kayla_knepp'/);
  assert.match(html, /function getTaskDetailQuickPhotoLabel\(prefix = ''\)[\s\S]*if \(safePrefix === 'req-'\) return 'Take Request Photo'/);
});

test('V02 paged dataset reads preserve the authenticated RLS identity and Drive degrades safely', () => {
  const authenticatedRead = html.slice(
    html.indexOf('async function fetchAuthenticatedSupabaseReadPage'),
    html.indexOf('async function fetchSupabaseRowsPageBatch')
  );
  const pagedRead = html.slice(
    html.indexOf('async function fetchSupabasePage'),
    html.indexOf('function isOptionalTableMissingError')
  );
  assert.match(authenticatedRead, /getNativeAuthRequestHeaders\(\)/);
  assert.match(authenticatedRead, /Authorization: `Bearer \$\{nativeAuthAccessToken\}`|\.\.\.nativeHeaders/);
  assert.match(authenticatedRead, /runAppApiSupabaseWrite\(safeTable, 'GET'/);
  assert.doesNotMatch(authenticatedRead, /Authorization['"]?\s*:\s*['"]Bearer ['"]?\s*\+\s*SUPABASE_KEY/);
  assert.match(pagedRead, /fetchAuthenticatedSupabaseReadPage\(table, queryString/);
  assert.doesNotMatch(pagedRead, /Authorization['"]?\s*:\s*['"]Bearer ['"]?\s*\+\s*SUPABASE_KEY/);
  assert.match(html, /reportSemanticHealthEvent\('dataset_load_failed', 'data_sync', classifyDatasetLoadFailureCode\(error\)/);
  assert.match(html, /viewId === 'drive'[\s\S]*required: \[\{ key: 'master', mode: 'full' \}\][\s\S]*background: \[\{ key: 'warehouseAssignedItems', mode: 'full' \}\]/);
});

test('V03 request-manager Queue loads the canonical set but hides completed rows from Request', () => {
  const liveQuery = html.slice(
    html.indexOf('function buildActiveRequestLiveRowsQuery'),
    html.indexOf('async function fetchActiveRequestLiveRows')
  );
  assert.match(liveQuery, /order=unique_id\.desc/);
  assert.doesNotMatch(liveQuery, /date_completed=is\.null/);
  assert.match(reliableDeliveryMigration, /create or replace view public\.ph_request_queue_live_rows/);
  assert.match(reliableDeliveryMigration, /delivery_status in \('pending', 'processing', 'failed'\)/);

  const pendingVisibility = html.slice(
    html.indexOf('function isRequestPendingVisible'),
    html.indexOf('function applyRequestStatusHintsToLocalRows')
  );
  assert.match(pendingVisibility, /&& !isRequestComplete\(item\)/);
  assert.doesNotMatch(pendingVisibility, /isRequestDeliveryAwaiting\(item\)/);

  const folderCompletionReply = html.slice(
    html.indexOf('async function maybeSendRequestCompletionEmailForFolder'),
    html.indexOf('function getDockSuspendDcRequestEmailFieldRows')
  );
  assert.match(folderCompletionReply, /activeFolderItems\.every\(\(item\) => isRequestComplete\(item\)\)/);
  assert.match(folderCompletionReply, /if \(!allRequestFolderRowsComplete\) return \{ sent: false, reason: 'folder_not_complete'/);
  assert.match(folderCompletionReply, /sendEmailNotification\('request_complete'/);

  const completionConcurrency = html.slice(
    html.indexOf('const stopIfRemoteRequestAlreadyComplete'),
    html.indexOf('const restoreFromFailedSave')
  );
  assert.match(completionConcurrency, /remoteRow\.ROW_VERSION/);
  assert.match(completionConcurrency, /itemToSave\.ROW_VERSION = remoteVersion/);

  const localEditOverlay = html.slice(
    html.indexOf('function applyLocalEdits'),
    html.indexOf('let pendingRequestWorkFlushPromise')
  );
  assert.match(localEditOverlay, /const canonicalRequestVersion = isRequestLikeLocalEditRow\(item\)/);
  assert.match(localEditOverlay, /item\.ROW_VERSION = canonicalRequestVersion/);

  const globalAccess = html.slice(
    html.indexOf('function canUseGlobalRequestAccess'),
    html.indexOf('function doesCurrentUserMatchRepName')
  );
  assert.match(globalAccess, /access && access\.isAdmin/);
  assert.match(globalAccess, /REQUEST_GLOBAL_ACCESS_TOKENS\.has\(token\)/);

  const requestScope = html.slice(
    html.indexOf('function getScopedRequestItems'),
    html.indexOf('function canUseRequestDylanViewerFilter')
  );
  assert.match(requestScope, /!roleAccess\.isAdmin && !hasGlobalRequestAccess/);

  const requestChunks = html.slice(
    html.indexOf('function renderRequestQueueFallbackCard'),
    html.indexOf('function getApprovedMoveRequestRowsForCurrentUser')
  );
  assert.match(requestChunks, /iosSyncRowLimit: iosPhoneRequestFlow \? 80/);
  assert.match(requestChunks, /verifyRowSelector: iosPhoneRequestFlow \? '\[data-request-uid\]'/);
  assert.match(requestChunks, /renderFailureFallback: renderRequestQueueFallbackCard/);

  const chunkRenderer = html.slice(
    html.indexOf('function renderMarkupChunkedByKey'),
    html.indexOf('function shouldUseChunkedAVOpenRender')
  );
  assert.match(chunkRenderer, /const renderRowSafely/);
  assert.match(chunkRenderer, /request_queue_parity_mismatch/);
  assert.match(chunkRenderer, /completionDeadlineMs/);

  const catchup = html.slice(
    html.indexOf('function queueRequestVisibleRenderCatchup'),
    html.indexOf('function isLiveRequestQueueTab')
  );
  assert.match(catchup, /requestState\.initialLoaded && requestState\.fullLoaded && requestViewLiveSyncSignature/);
  assert.match(catchup, /force: false/);
  assert.match(html, /const REQUEST_VIEW_ACTIVE_SIGNATURE_SYNC_MS = 5000/);
  assert.match(html, /getSanitizedClientRuntimeCode\(event && event\.reason/);
});

test('request completion delivery is leased, idempotent, threaded, and independent of Drive sync', () => {
  assert.match(reliableDeliveryMigration, /for update skip locked/);
  assert.match(reliableDeliveryMigration, /lease_expires_at = now\(\) \+ interval '2 minutes'/);
  assert.match(reliableDeliveryMigration, /DELIVERY_WORKER_STALLED/);
  assert.match(reliableDeliveryMigration, /gnc-request-delivery-worker/);
  assert.match(deliveryWorker, /stableMessageId/);
  assert.match(deliveryWorker, /REQUEST_DELIVERY_SIGNING_SECRET/);
  assert.match(deliveryWorker, /record_request_delivery_channel_result/);
  assert.match(deliveryWorker, /request_completed" \? "ph_request_history"/);
  assert.match(appsScriptBackend, /handleSignedRequestDeliveryEvent_/);
  assert.match(appsScriptBackend, /gmail_api_idempotent_recovery/);
  assert.match(appsScriptBackend, /apps_script_receipt_recovery/);
  assert.match(appsScriptBackend, /thread_recovery_fallback/);
  assert.match(appsScriptBackend, /worker: 'supabase_edge_request_delivery'/);
  assert.match(html, /Completed &mdash; Sending/);
  assert.match(html, /Delivery Needs Attention/);
});

test('plant request submitted and completed emails always include the required trio and recorded submitter', () => {
  assert.match(appsScriptBackend, /const REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_EMAILS_ = Object\.freeze\(\[[\s\S]*EMAIL_APPROVAL_USER_EMAILS_\.dylan_collyge[\s\S]*EMAIL_APPROVAL_USER_EMAILS_\.kayla_knepp[\s\S]*EMAIL_APPROVAL_USER_EMAILS_\.jd_jones[\s\S]*\]\)/);
  assert.match(appsScriptBackend, /function collectRequestSubmitterEmails_\(payload\)[\s\S]*request_created_by_email[\s\S]*REQUEST_CREATED_BY_EMAIL/);
  assert.match(appsScriptBackend, /const isRequestLifecycleEmail = emailType === 'new_request' \|\| emailType === 'request_complete'/);
  assert.match(appsScriptBackend, /const recipients = dedupeEmailAddresses_\(\[[\s\S]*requestLifecycleRequiredRecipients,[\s\S]*requestSubmitterEmails,/);
  assert.match(appsScriptBackend, /function buildRequestDeliveryEmailPayload_[\s\S]*submittedByEmail: requestCreatedByEmail[\s\S]*internalRecipients: REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_EMAILS_\.slice\(\)/);
  assert.match(html, /const REQUEST_EMAIL_REQUIRED_RECIPIENTS = Object\.freeze\(\['dylan_collyge@greenleafnursery\.com', 'kayla_knepp@greenleafnursery\.com', 'jd_jones@greenleafnursery\.com'\]\)/);
  assert.match(html, /existingThreadRecord\.recipients, \.\.\.REQUEST_EMAIL_REQUIRED_RECIPIENTS, \.\.\.linkedRepEmails, \.\.\.submitterRecipientEmails/);
});

test('V12 synchronizes password changes and exposes user-initiated passkeys to every eligible account', () => {
  assert.match(edge, /newPassword\.length < 6/);
  assert.match(edge, /supabase\.auth\.admin\.updateUserById\(String\(profile\.id\)/);
  assert.match(edge, /\.from\("ph_app_users"\)[\s\S]*must_change_password: false/);
  assert.match(edge, /\.from\("profiles"\)[\s\S]*must_change_password: false/);
  assert.match(html, /includeSession: !nativeAuthSessionActive/);
  assert.doesNotMatch(html, /nativeClient\.auth\.updateUser\(\{ password: newPass \}\)/);
  const passkeyUi = html.slice(html.indexOf('function syncPasskeyPilotUi'), html.indexOf('async function signInWithAppPasskey'));
  assert.match(passkeyUi, /loginButton\.classList\.toggle\('hidden', !supported\)/);
  assert.match(passkeyUi, /securityPanel\.classList\.toggle\('hidden', !eligible\)/);
  assert.doesNotMatch(passkeyUi, /PASSKEY_ENROLLED_STORAGE_KEY/);
  assert.match(html, /getSupabaseBrowserClient\(\);\s*syncPasskeyPilotUi\(null\);/);
  assert.match(passkeyRolloutMigration, /where disabled_at is null/);
  assert.match(passkeyRolloutMigration, /'passkey_pilot',[\s\S]*true,[\s\S]*100/);
  assert.match(passkeyRolloutMigration, /"user_gesture_required":true/);
  assert.match(passkeyRolloutMigration, /"password_fallback":true/);
});

test('V08 compaction preparation never copies, swaps, truncates, or drops production data', () => {
  assert.match(compactionMigration, /ph_drive_around_report_rows_compact/);
  assert.match(compactionMigration, /Deliberately omits duplicated raw JSONB/);
  assert.match(compactionMigration, /copy_drive_around_compact_batch/);
  assert.match(compactionMigration, /grant execute on function private\.copy_drive_around_compact_batch[\s\S]*to service_role/);
  assert.match(compactionMigration, /ph_hold_learning_cursors/);
  assert.doesNotMatch(compactionMigration, /\b(?:drop|truncate)\s+table\b/i);
  assert.doesNotMatch(compactionMigration, /alter\s+table[^;]+rename/i);
});

test('hosted performance monitoring pins CLI and emits bounded anonymous function logs', () => {
  assert.match(performanceWorkflow, /version: 2\.111\.0/);
  assert.match(performanceWorkflow, /supabase(?:\s+--workdir[^\n]+)?\s+test db/);
  assert.match(performanceWorkflow, /deno test --allow-env --allow-net supabase\/functions/);
  assert.doesNotMatch(performanceWorkflow, /supabase test functions/);
  assert.match(performanceWorkflow, /Prepare static shell for Lighthouse/);
  assert.match(performanceWorkflow, /cp index\.html manifest\.json sw\.js OneSignalSDKWorker\.js _site\//);
  assert.match(observability, /MAX_LOG_BYTES = 2048/);
  assert.match(observability, /SUCCESS_SAMPLE_RATE = 0\.01/);
  assert.match(observability, /function recordHandledError/);
  assert.doesNotMatch(edge, /console\.(?:error|warn|log|info)/);
  for (const field of ['request_id', 'function', 'action', 'status', 'duration_ms', 'retry_count', 'release', 'error_code']) {
    assert.match(observability, new RegExp(field));
  }
});

test('Task View lists active assignment-sheet users and scopes Drive rows without broadening mutations', () => {
  const evalDirectory = html.slice(
    html.indexOf('async function ensureEvalAssignableUsers'),
    html.indexOf('function renderEvalTaskAssigneeOptions')
  );
  assert.match(evalDirectory, /getNativeAuthRequestHeaders\(\)/);
  assert.match(evalDirectory, /ensureDatasetLoaded\('warehouseAssignedItems', 'full'/);
  assert.match(evalDirectory, /fetchNativeAppUserDirectory\(nativeHeaders, '', SUPABASE_READ_TIMEOUT_MS\)/);
  assert.match(evalDirectory, /const assignedUserSet = new Set\(getWarehouseAssignmentSourceUsers\(\)\)/);
  assert.match(evalDirectory, /assignedUserSet\.size && !assignedUserSet\.has\(username\)/);
  assert.match(evalDirectory, /const authoritativeUsers = assignedUserSet\.size \? Array\.from\(assignedUserSet\) : fetchedUsers/);
  assert.match(evalDirectory, /fetchedLabels\.get\(username\) \|\| formatAppUserDisplayName\(username\)/);
  assert.match(evalDirectory, /evalAssignableUsersDirectoryResolved = true/);
  assert.doesNotMatch(evalDirectory, /fetchedUsers\.concat\(EVAL_TASK_FALLBACK_USERS/);
  assert.match(evalDirectory, /sourceUsers\.length \? sourceUsers : EVAL_TASK_FALLBACK_USERS\.slice\(\)/);
  assert.match(html, /ensureEvalAssignableUsers\(true\)[\s\S]*reconcileEvalTaskViewerUser\(\)/);

  const taskMode = html.slice(
    html.indexOf('function getTaskModeDropdownOptions'),
    html.indexOf('function getTaskFilterValues')
  );
  assert.match(taskMode, /group: 'Eval Users'/);
  assert.match(taskMode, /getEvalTaskViewOptionValue\(option\.value\)/);
  assert.doesNotMatch(taskMode, /All Eval Users/);

  const taskSelection = html.slice(
    html.indexOf('function setTaskTab'),
    html.indexOf('function setTaskFilter')
  );
  assert.match(taskSelection, /getEvalTaskUserFromViewOption\(tab\)/);
  assert.match(taskSelection, /activeUsers\.includes\(normalized\)/);
  assert.match(taskSelection, /taskViewTargetUser = normalized/);
  assert.match(taskSelection, /setTaskView\(EVAL_TASK_ASSIGNMENT\)/);

  const scopedQueue = html.slice(
    html.indexOf('function getScopedTaskQueueItems'),
    html.indexOf('function getTaskTabLabel')
  );
  assert.match(scopedQueue, /safeView === EVAL_TASK_ASSIGNMENT[\s\S]*doesEvalTaskItemMatchOwner\(item, evalOwner\)/);
  assert.match(scopedQueue, /safeView !== EVAL_TASK_ASSIGNMENT[\s\S]*canRestrictedEvalUserUpdateItem/);
  assert.match(scopedQueue, /mergeEvalTaskRequestMirrorItems\(baseTaskItems, getEvalTaskRequestMirrorItems\(owner\)\)/);
  assert.doesNotMatch(scopedQueue, /safeView === EVAL_TASK_ASSIGNMENT && canUseEvalTaskAssignment/);

  assert.match(html, /function shouldShowEvalTaskUserSelector[\s\S]*?return false;/);
  assert.match(html, /No Drive rows are assigned to \$\{getEvalTaskViewerUserLabel\(targetUser\)\}/);
  const assignmentResolver = html.slice(
    html.indexOf('function getEvalTaskAssignedUsersFromItem'),
    html.indexOf('function getEvalTaskAssignedUserFromItem')
  );
  assert.match(assignmentResolver, /getWarehouseAssignedUsersForItem/);
  assert.match(assignmentResolver, /hasWarehouseAssignmentSourceRows\(\)/);
  assert.match(assignmentResolver, /getEvalTaskRuleAssigneeForItem/);
  assert.match(html, /function getWarehouseAssignedRowsForItem/);
  const evalViewerUsers = html.slice(
    html.indexOf('function getEvalAssignableUserList'),
    html.indexOf('function getEvalAssignableUserLabel')
  );
  assert.match(evalViewerUsers, /const assignmentUsers = getWarehouseAssignmentSourceUsers\(\)/);
  assert.match(evalViewerUsers, /assignmentsAreAuthoritative\s*\? assignmentUsers/);
  assert.match(evalViewerUsers, /assignmentsAreAuthoritative \|\| !EVAL_TASK_INACTIVE_USERS\.has\(user\)/);
  assert.match(html, /pushKey\('wi', parts\.warehouse, parts\.itemcode\)/);
  assert.match(html, /pushKey\('ig', parts\.itemcode, parts\.genusname\)/);
  assert.match(html, /return item\.ITEMCODE \? item : null/);
  assert.doesNotMatch(html, /return item\.WAREHOUSE_ASSIGNED_USER && item\.ITEMCODE \? item : null/);
  assert.match(html, /function canRestrictedEvalUserUpdateItem/);
  assert.match(html, /function completeEvalTaskFromDetail/);
});

test('Warehouse assignments are Supabase-authoritative and the Sheet is export-only', () => {
  assert.match(appsScriptBackend, /WAREHOUSE_ASSIGNED_ITEMS_SHEET_ID = '16mK_5MWcIwVsbok0lGkBG65UeZt553nf5IEPiv0k34Q'/);
  assert.match(appsScriptBackend, /WAREHOUSE_ASSIGNED_ITEMS_FOLDER_ID = '1PLQJjNIM4dBTBlFOYiumLb-ICccPZbgn'/);
  const headerMatcher = appsScriptBackend.slice(
    appsScriptBackend.indexOf('function isWarehouseAssignedItemsHeaderRow_'),
    appsScriptBackend.indexOf('function getWarehouseAssignedItemsSelectColumns_')
  );
  assert.match(headerMatcher, /knownHeaderCount >= 4/);
  assert.match(headerMatcher, /headers\.indexOf\('assignedto'\)/);
  assert.match(headerMatcher, /headers\.indexOf\('warehousei'\)/);
  assert.match(headerMatcher, /headers\.indexOf\('itemcode'\)/);
  assert.match(headerMatcher, /headers\.indexOf\('genusname'\)/);
  const payloadBuilder = appsScriptBackend.slice(
    appsScriptBackend.indexOf('function buildWarehouseAssignedItemsPayload'),
    appsScriptBackend.indexOf('function syncWarehouseAssignedItemsSheet_')
  );
  assert.match(payloadBuilder, /if \(!assignedTo \|\| !itemCode\)/);
  assert.doesNotMatch(payloadBuilder, /if \(!itemCode \|\| !locationCode\)/);
  const assignmentSync = appsScriptBackend.slice(
    appsScriptBackend.indexOf('function syncWarehouseAssignedItemsSheet_'),
    appsScriptBackend.indexOf('function callSupabaseRpc_')
  );
  assert.match(assignmentSync, /return exportWarehouseAssignedItemsToSheet_\(sheetId, tableName\)/);
  assert.doesNotMatch(assignmentSync, /deleteFromSupabase|pushToSupabase|extractDataFromFile/);
  const assignmentExport = appsScriptBackend.slice(
    appsScriptBackend.indexOf('function exportWarehouseAssignedItemsToSheet_'),
    appsScriptBackend.indexOf('function getPayloadSelectColumns_')
  );
  assert.match(assignmentExport, /run_request_integrity_maintenance/);
  assert.match(assignmentExport, /direction: 'supabase_to_sheet'/);
});

test('Eval assignment management uses the requested roster and ItemCode + GenusName identity', () => {
  assert.match(html, /const EVAL_ASSIGNMENT_ROSTER_USERS = Object\.freeze\(\['josh_vann', 'jorge_colunga', 'abigail_vazquez', 'bobby_adair', 'charley_robertson', 'ellen_ward', 'zoe_green', 'mitch_kaiser', 'dylan_collyge', 'megan_kelly'\]\)/);
  assert.match(html, /charey_robertson: 'charley_robertson'/);
  assert.match(html, /boby: 'bobby_adair'/);
  assert.match(html, /function getEvalAssignableUserLabel\(value = ''\) \{[\s\S]*return normalized;/);
  assert.match(html, /function buildManagerEvalAssignmentKey\(itemcode = '', genusname = ''\)/);
  assert.match(html, /genusname: entry\.genusname/);
  assert.match(html, /ensureEvalAssignableUsers\(\)\.then\(\(\) => scheduleManagersRender\(true\)\)/);
  assert.doesNotMatch(html, /ensureEvalAssignableUsersReady/);
  assert.match(html, /Assignments use the ItemCode \+ GenusName key\./);
  assert.match(completeAssignmentSheetMigration, /'source_rows', 9857/);
  assert.match(completeAssignmentSheetMigration, /'distinct_itemcode_genus_keys', 3307/);
  assert.match(completeAssignmentSheetMigration, /public\.ph_warehouse_assigned_items\.source = 'supabase_assignment_manager'/);
  assert.match(completeAssignmentSheetMigration, /"assignedto": "bobby_adair"/);
  assert.match(exactAssignmentSheetMigration, /ASSSIGNMENTS 08-20-2026 \/ Sheet3 \(9857 rows\)/);
  assert.match(exactAssignmentSheetMigration, /'008267\.070\.1', 'Rosa', 'mitch_kaiser', 9027/);
  assert.match(exactAssignmentSheetMigration, /'002050\.020\.1', 'Rosa', 'mitch_kaiser', 9114/);
  assert.match(exactAssignmentSheetMigration, /'002050\.050\.1', 'Rosa', 'mitch_kaiser', 9116/);
  assert.match(exactAssignmentSheetMigration, /assignment\.source = 'google_sheet_cutover_20260820'/);
  assert.match(exactAssignmentSheetMigration, /updated_count <> 3/);
});

test('stale request work is quarantined client-side and completed rows are acknowledged server-side', () => {
  assert.match(html, /autoRetryBlocked === true/);
  assert.match(html, /entry\.autoRetryBlocked = true/);
  assert.match(html, /entry\.conflictedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(requestRetryGuardMigration, /rename to save_request_work_v1/);
  assert.match(requestRetryGuardMigration, /'delivery_state', 'already_completed'/);
  assert.match(requestRetryGuardMigration, /existing\.row_version <> expected_version/);
  assert.ok(
    requestRetryGuardMigration.indexOf('existing.row_version <> expected_version')
      < requestRetryGuardMigration.indexOf('return public.save_request_work_v1'),
    'stale pending versions must fail before the locking writer runs'
  );
});

test('hosted monitoring probes the real production login bridge every five minutes', () => {
  assert.match(productionAuthHealthWorkflow, /cron: '\*\/5 \* \* \* \*'/);
  assert.match(productionAuthHealthWorkflow, /node scripts\/probe-production-auth-health\.mjs/);
  assert.match(performanceWorkflow, /Probe production login bridge and Data API/);
  assert.match(productionAuthHealthProbe, /hosted_auth_health_probe_nonexistent/);
  assert.match(productionAuthHealthProbe, /probePayload\?\.reason === 'mismatch'/);
  assert.match(productionAuthHealthProbe, /production_login_bridge_unhealthy_/);
  assert.match(productionAuthHealthWorkflow, /PRODUCTION_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(productionAuthHealthWorkflow, /REQUEST_DELIVERY_CRON_SECRET/);
  assert.match(productionAuthHealthWorkflow, /Open or update the production health incident/);
  assert.match(productionAuthHealthWorkflow, /Close a recovered production health incident/);
  assert.match(productionAuthHealthProbe, /request-delivery-worker/);
  assert.match(productionAuthHealthProbe, /get_hosted_health_snapshot/);
  assert.match(productionAuthHealthProbe, /ph_app_health_events/);
  assert.match(productionAuthHealthProbe, /neq\.scheduled_request_health_audit/);
  assert.doesNotMatch(productionAuthHealthProbe, /console\.log\(probeText|process\.stdout\.write\([^\n]*probeText/);
});

test('Drive Around inventory writes avoid parallel lock contention and retry safely', () => {
  assert.match(appsScriptBackend, /const SUPABASE_MASTER_UPSERT_CHUNK_SIZE = 1000;/);
  assert.match(appsScriptBackend, /const SUPABASE_MASTER_UPSERT_FETCH_BATCH_SIZE = 1;/);
  assert.match(appsScriptBackend, /const SUPABASE_MASTER_UPSERT_MIN_SPLIT_SIZE = 100;/);
  const requestBuilder = appsScriptBackend.slice(
    appsScriptBackend.indexOf('function buildSupabaseUpsertRequests_'),
    appsScriptBackend.indexOf('function extractMissingSupabaseColumnNames_')
  );
  assert.match(requestBuilder, /isMasterInventoryTable_\(tableName\) \? SUPABASE_MASTER_UPSERT_CHUNK_SIZE : 1000/);
  assert.match(requestBuilder, /'57014': true/);
  assert.match(requestBuilder, /statement timeout/);
  const upsertExecutor = appsScriptBackend.slice(
    appsScriptBackend.indexOf('function executeSupabaseUpsert_'),
    appsScriptBackend.indexOf('function throwSupabaseUpsertFailures_')
  );
  assert.match(upsertExecutor, /SUPABASE_MASTER_UPSERT_FETCH_BATCH_SIZE/);
  assert.match(upsertExecutor, /executeSupabaseUpsertRequestWithRecovery_/);
  assert.match(appsScriptBackend, /Retrying as/);
});

test('Managers Historical Report browses immediately with secured server filtering and Drive-style drill-downs', () => {
  assert.match(html, /const MANAGER_HISTORICAL_REPORT_VIEW = 'historical-report'/);
  assert.match(html, /Historical Report/);
  assert.match(html, /search_historical_inventory_common_names/);
  assert.match(html, /get_historical_inventory_container_sizes/);
  assert.match(html, /get_historical_inventory_rows/);
  assert.match(html, /Search historical Common Names/);
  assert.match(html, /selectManagerHistoricalCommonName/);
  assert.match(html, /selectManagerHistoricalContSize/);
  assert.match(html, /Columns \(\$\{selected\.size\}\)/);
  assert.match(html, /function renderManagerHistoricalDriveChrome/);
  assert.match(html, /setManagerHistoricalDisplayMode\('\$\{mode\}'\)/);
  assert.match(html, /Load 100 More Rows/);
  assert.match(html, /loadManagerHistoricalCommonNames\(managersSearchTerm, true\)/);
  assert.match(html, /result_limit: 100/);
  assert.match(html, /Browse Common Name/);
  const historicalRenderer = html.slice(
    html.indexOf('function renderManagerHistoricalCommonNameCard'),
    html.indexOf('function getManagerAssignedItemsExportRows')
  );
  assert.match(historicalRenderer, /manager-historical-drive-card/);
  assert.match(historicalRenderer, /manager-historical-drive-crumb/);
  assert.match(historicalRenderer, /drive-grid-summary-sheet/);
  assert.match(historicalRenderer, /app-smart-card--inventory/);
  assert.doesNotMatch(historicalRenderer, /manager-module-grid/);
  assert.match(historicalReportMigration, /public\.ph_historical_inventory_dimensions/);
  assert.match(historicalReportMigration, /private\.can_manage_eval_assignments\(\)/);
  assert.match(historicalReportMigration, /HISTORICAL_REPORT_FORBIDDEN/);
  assert.match(historicalReportMigration, /allowed_columns constant text\[\]/);
  assert.match(historicalReportMigration, /cursor_report_date/);
  assert.match(historicalReportMigration, /order by r\.report_date desc, r\.unique_id desc/);
  assert.match(historicalReportBrowseMigration, /where safe_search = '' or strpos\(d\.commonname_key, safe_search\) > 0/);
  assert.match(historicalReportBrowseMigration, /private\.can_manage_eval_assignments\(\)/);
  assert.match(historicalReportBrowseMigration, /security invoker/);
  assert.match(historicalReportBrowseMigration, /revoke all on function public\.search_historical_inventory_common_names\(text, integer\) from public, anon/);
  for (const column of ['unique_id', 'file_id', 'item_key', 'row_hash', 'created_at', 'updated_at']) {
    assert.match(html, new RegExp(`key: '${column}'`));
    assert.match(historicalCoverageMigration, new RegExp(`'${column}'`));
  }
  assert.match(historicalCoverageMigration, /where lower\(coalesce\(f\.status, ''\)\) = 'row_indexed'[\s\S]*not exists/);
  assert.match(historicalCoverageMigration, /status = 'indexed'/);
  assert.match(historicalCoverageMigration, /security invoker/);
  assert.doesNotMatch(historicalCoverageMigration, /delete from public\.ph_drive_around_report_rows/i);
  for (const column of ['warehousei', 'plantgroupcode', 'ptronhand', 'holdstopbegindate', 'season_supply', 'locationnote', 'salesnote_1', 'ext_equiv_unit']) {
    assert.match(html, new RegExp(`key: '${column}'`));
    assert.match(historicalSourceColumnsMigration, new RegExp(`'${column}'`));
  }
  assert.match(appsScriptBackend, /DRIVE_AROUND_HISTORY_SOURCE_SCHEMA_VERSION = 1/);
  assert.match(appsScriptBackend, /buildDriveAroundHistoryReportValues_/);
  assert.match(appsScriptBackend, /source_schema_version: DRIVE_AROUND_HISTORY_SOURCE_SCHEMA_VERSION/);
  assert.match(historicalSourceColumnsMigration, /requeued_source_schema_version/);
  assert.doesNotMatch(historicalSourceColumnsMigration, /delete from public\.ph_drive_around_report_rows/i);
  assert.match(performanceWorkflow, /20260823013134_expand_historical_report_source_columns\.sql/);
  assert.match(performanceWorkflow, /historical_report_baseline\.sql/);
  assert.match(performanceWorkflow, /20260821202202_manager_historical_report\.sql/);
  const historyRowsRpc = historicalReportMigration.slice(
    historicalReportMigration.indexOf('create or replace function public.get_historical_inventory_rows'),
    historicalReportMigration.indexOf('revoke all on function public.search_historical_inventory_common_names')
  );
  assert.match(historyRowsRpc, /security invoker/);
  assert.doesNotMatch(historyRowsRpc, /security definer/);
});

test('weather and hold learning refreshes use bounded set-based database work', () => {
  assert.match(holdLearningRefreshMigration, /distinct_windows as materialized/);
  assert.match(holdLearningRefreshMigration, /weather_rollups as materialized/);
  assert.match(holdLearningRefreshMigration, /hold_learning_profile_refresh_stage/);
  assert.match(holdLearningRefreshMigration, /add primary key \(unique_id\)/);
  assert.equal((holdLearningRefreshMigration.match(/set statement_timeout to '60s'/g) || []).length, 2);
  assert.match(holdLearningRefreshMigration, /is distinct from/);
  assert.doesNotMatch(holdLearningRefreshMigration, /for\s+\w+\s+in/i);
  assert.match(holdLearningRefreshMigration, /grant execute on function public\.v2_refresh_hold_learning_weather_features\(integer\) to service_role/);
  assert.match(holdLearningRefreshMigration, /grant execute on function public\.v2_refresh_hold_learning_profiles\(\) to service_role/);
});

test('Drive Around history backfill is isolated to an overnight daily trigger', () => {
  assert.match(appsScriptBackend, /const DRIVE_AROUND_HISTORY_BACKFILL_HOUR = 2/);
  const scheduler = appsScriptBackend.slice(
    appsScriptBackend.indexOf('function scheduleDriveAroundHistoryBackfillTrigger_'),
    appsScriptBackend.indexOf('function startDriveAroundHistoryBackfill')
  );
  assert.match(scheduler, /\.everyDays\(1\)/);
  assert.match(scheduler, /\.atHour\(DRIVE_AROUND_HISTORY_BACKFILL_HOUR\)/);
  assert.doesNotMatch(scheduler, /\.everyMinutes\(/);
});

test('recoverable local request photo blobs remain visible as warnings without failing hosted health', () => {
  assert.match(html, /function reportSemanticHealthEvent\(eventName, area = 'app', code = '', metadata = \{\}, severity = 'error'\)/);
  assert.match(html, /LOCAL_REQUEST_BLOB_PENDING'[\s\S]*?\}, 'warning'\)/);
  assert.match(productionAuthHealthWorkflow, /production-auth-health/);
  assert.match(productionAuthHealthProbe, /sanitized_code'[\s\S]*neq\.LOCAL_REQUEST_BLOB_PENDING/);
});
