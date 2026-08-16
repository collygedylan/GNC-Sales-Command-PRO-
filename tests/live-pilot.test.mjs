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
const liveShellBuild = read('scripts/build-live-shell.mjs');
const liveVendorBuild = read('scripts/vendor-live-assets.mjs');

test('release identifiers are synchronized', () => {
  const release = 'V2026.08.16.03';
  assert.match(html, new RegExp(release.replaceAll('.', '\\.')));
  assert.equal(manifest.version, release);
  assert.match(manifest.start_url, new RegExp(release.replaceAll('.', '\\.')));
  assert.match(serviceWorker, /APP_SHELL_BUILD = 'V2026\.08\.16\.03'/);
  assert.equal(packageJson.version, '2026.08.16.03');
});

test('verified Dylan sessions restore the saved theme before the app shell paints', () => {
  assert.match(html, /localStorage\.getItem\('gnc_verified_login_v1'\)/);
  assert.match(html, /verifiedUsername === 'dylan_collyge' && localStorage\.getItem\('gnc_explicit_logout_v1'\) !== '1'/);
  assert.match(html, /localStorage\.getItem\('gnc_ops_precision_preferences_v1'\)/);
  assert.match(html, /const prepaintTheme = cachedTheme === 'light' \? 'light' : 'dark'/);
  assert.match(html, /document\.documentElement\.dataset\.opsPrepaintTheme = prepaintTheme/);
  assert.match(html, /id="ops-theme-prepaint"[\s\S]*data-ops-prepaint-theme="dark"[\s\S]*background:#07120e !important/);
  assert.match(html, /data-ops-prepaint-theme="dark"[\s\S]*#home-dashboard-grid > div[\s\S]*background:#111c18 !important/);
  assert.match(html, /data-ops-prepaint-theme="dark"[\s\S]*#bottom-nav[\s\S]*background:#0b1c16 !important[\s\S]*color:#bfd3c9 !important/);
  assert.match(html, /data-ops-prepaint-theme="light"[\s\S]*background:#f3f7f5 !important/);
  assert.match(client, /function clearPrepaintTheme\(\)/);
  assert.match(client, /writeCachedPreferences\(state\.preferences, useDirtyCache\);[\s\S]*applyUiState\(\);[\s\S]*clearPrepaintTheme\(\)/);
  assert.match(html, /function clearPersistedLoginSession\(\)[\s\S]*removeAttribute\('data-ops-prepaint-theme'\)/);
  const logoutClear = html.slice(html.indexOf('function clearPersistedLoginSession'), html.indexOf('function primeOpsPilotAppearanceForVerifiedUser'));
  assert.doesNotMatch(logoutClear, /gnc_ops_precision_preferences_v1/);
  assert.equal(manifest.background_color, '#07874f');
});

test('verified login primes the saved appearance before Home is revealed', () => {
  assert.match(html, /function primeOpsPilotAppearanceForVerifiedUser\(username = ''\)/);
  assert.match(html, /normalizedUsername !== 'dylan_collyge'/);
  assert.match(html, /pilot\.primeCachedAppearance\(\{[\s\S]*activeView:/);
  assert.match(html, /persistVerifiedLoginRecord\(username[\s\S]*primeOpsPilotAppearanceForVerifiedUser\(normalizedUsername\)/);
  assert.match(client, /function primeCachedAppearance\(options = \{\}\)/);
  assert.match(client, /preferences: normalizePreferences\(cached \|\| DEFAULT_PREFERENCES\)/);
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

test('premium skin is global while Dylan controls remain drawer-only and server gated', () => {
  assert.match(html, /id="side-drawer"[\s\S]*id="ops-pilot-settings"[\s\S]*id="drawer-logout-btn"/);
  assert.match(html, /id="ops-pilot-settings" class="ops-pilot-settings hidden"/);
  assert.match(html, /ops-pilot-settings__eyebrow"><i class="ph-duotone ph-palette"><\/i> Appearance/);
  assert.ok(html.indexOf('<div class="drawer-header">Menu</div>') < html.indexOf('id="ops-pilot-settings"'));
  assert.ok(html.indexOf('id="ops-pilot-settings"') < html.indexOf('id="drawer-home-btn"'));
  assert.match(css, /body\.ops-pilot-active \.ops-pilot-segmented button[\s\S]*min-height: 44px !important/);
  assert.match(client, /body\.classList\.toggle\('ops-pilot-active', state\.eligible && !state\.provisional\)/);
  assert.match(client, /body\.classList\.add\('ops-precision-pilot', 'ag-premium-skin', 'premium-skin-v16'\)/);
  assert.match(html, /<body[^>]*ops-precision-pilot[^>]*ag-premium-skin[^>]*premium-skin-v16/);
  assert.match(client, /if \(!state\.eligible && !state\.provisional\) return 'light'/);
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
  assert.match(client, /panel\.classList\.toggle\('hidden', state\.provisional \|\| !state\.eligible \|\| \(!state\.flags\.preferences && !state\.flags\.card_grid\)\)/);
  assert.match(client, /themeGroup\.classList\.toggle\('hidden', !state\.flags\.preferences\)/);
  assert.match(client, /displayGroup\.classList\.toggle\('hidden', !state\.flags\.card_grid\)/);
  assert.match(edge, /flags\.preferences \|\| flags\.card_grid/);
  assert.match(edge, /monitoringEligible/);
});

test('Dylan receives the full dark Ops Precision composition by default', () => {
  assert.match(client, /DEFAULT_PREFERENCES = Object\.freeze\(\{ themeMode: 'dark'/);
  assert.match(client, /return mode === 'light' \? 'light' : 'dark'/);
  assert.match(edge, /theme_mode: "dark"/);
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

test('Dylan receives one menu-only Light and Dark selector with legacy System mapped to Dark', () => {
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
  const releaseCascadeIndex = css.indexOf('V2026.08.16.03 final cascade lock', keyboardCascadeIndex);
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
});

test('new inventory transactions are Reclass-only while audit history keeps legacy labels', () => {
  const actionBuilder = html.slice(html.indexOf('function buildArgosInventoryTransactionRailHtml'), html.indexOf('function normalizeArgosInventoryNumber'));
  const modalBuilder = html.slice(html.indexOf('function ensureArgosInventoryTransactionModal'), html.indexOf('function renderArgosInventoryTransactionSource'));
  const payloadBuilder = html.slice(html.indexOf('function buildArgosInventoryTransactionPayload'), html.indexOf('async function postArgosInventoryTransactionPayload'));
  assert.match(actionBuilder, /ARGOS_INVENTORY_TRANSACTION_ACTIONS = Object\.freeze\(\['reclass'\]\)/);
  assert.match(actionBuilder, /openArgosInventoryTransactionModal\('\$\{safeUid\}', 'reclass'/);
  assert.doesNotMatch(actionBuilder, /Open quantity transaction|Open transfer transaction|ALT\+Q|ALT\+T/);
  assert.doesNotMatch(modalBuilder, /data-argos-transaction-tab="(?:qty|transfer)"/);
  assert.match(payloadBuilder, /const transactionAction = 'reclass'/);
  assert.doesNotMatch(payloadBuilder, /transactionAction === '(?:qty|transfer)'/);
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

test('final responsive shell keeps every Home tile square, scrollable above navigation, and device-aware', () => {
  const finalCascadeIndex = css.lastIndexOf('V2026.08.15.12 final responsive and theme cascade');
  const legacyFixedGridIndex = css.lastIndexOf('height: min(760px, calc(100dvh - 284px)) !important');
  assert.ok(finalCascadeIndex > legacyFixedGridIndex, 'responsive cascade must override the legacy fixed-height Home grid');
  const finalCascade = css.slice(finalCascadeIndex);
  assert.match(finalCascade, /--ops-nav-clearance: calc\(var\(--footer-nav-reserve, 8\.75rem\) \+ env\(safe-area-inset-bottom\) \+ 24px\)/);
  assert.match(finalCascade, /current-view-home\.home-dashboard-mode[\s\S]*overflow-y: auto !important;[\s\S]*padding-bottom: var\(--ops-nav-clearance\) !important/);
  assert.match(finalCascade, /#view-home #home-dashboard-grid,[\s\S]*height: auto !important;[\s\S]*grid-auto-rows: max-content !important;[\s\S]*align-content: start !important/);
  assert.match(finalCascade, /#view-home #home-dashboard-grid > div,[\s\S]*height: auto !important;[\s\S]*aspect-ratio: 1 \/ 1 !important;[\s\S]*border-width: 2px !important/);
  assert.match(finalCascade, /viewport-phone #view-home #home-dashboard-grid,[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(finalCascade, /viewport-tablet\.viewport-portrait[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(finalCascade, /viewport-tablet\.viewport-landscape[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(finalCascade, /min-width: 1024px[\s\S]*max-height: 900px[\s\S]*repeat\(6, minmax\(0, 1fr\)\)/);
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
  assert.match(serviceWorker, /live-app-runtime-v2026081603\.min\.js/);
  assert.match(html, /assets\/vendor\/supabase-browser-2\.112\.3\.min\.js/);
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|unpkg\.com\/@phosphor-icons|cdn\.jsdelivr\.net\/npm\/@supabase/);
  assert.match(liveShellBuild, /deployedBytes > 1_500_000/);
  assert.match(liveVendorBuild, /@phosphor-icons/);
});

test('V15 Home uses one authorization-backed first-level module registry', () => {
  assert.match(html, /const HOME_MODULE_REGISTRY = Object\.freeze\(\[/);
  for (const view of ['drive', 'tasks', 'docks', 'request', 'communication', 'sales', 'crop-roll', 'take-back', 'reserves', 'sales-office', 'hours', 'advertisement']) {
    assert.match(html, new RegExp(`\\{ view: '${view}'`));
  }
  assert.match(html, /function ensureHomeModuleRegistry\(\)/);
  assert.match(html, /data-home-module-view=/);
  assert.match(html, /const isAllowed = canAccessView\(module\.view\)/);
  assert.match(html, /authorizedModuleCount/);
  assert.match(html, /renderedModuleCount/);
});

test('V15 Queue, Tasks, and Docks use compact single-row workflow controls', () => {
  assert.match(html, /id="request-filter-toolbar"[^>]*workflow-control-rail/);
  assert.match(html, /id="request-category-select"/);
  assert.match(html, /function getAuthorizedRequestCategories/);
  assert.match(html, /const filteredRequestItems = baseRequestItems/);
  assert.match(html, /id="dock-mode-select"/);
  assert.match(html, /buildDockModeFilterControlHtml/);
  assert.match(html, /id="docks-mode-toggle" class="hidden" aria-hidden="true"/);
  assert.ok(html.indexOf('id="team-selector"') < html.indexOf('id="task-crumb"'), 'Task controls must precede the breadcrumb');
  const finalCascade = css.slice(css.lastIndexOf('V2026.08.16.03 final cascade lock'));
  assert.match(finalCascade, /workflow-control-rail,[\s\S]*flex-flow: row nowrap !important/);
  assert.match(finalCascade, /#view-tasks \.task-controls-sticky[\s\S]*overflow-x: auto !important/);
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
  assert.match(css, /grid-template-columns: repeat\(var\(--home-fit-columns, 2\)/);
  assert.match(css, /current-view-home\.home-dashboard-mode #main-scroll-area[\s\S]*overflow-y: auto !important/);
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

test('V15 monitoring is authenticated for all users and remains anonymous', () => {
  assert.match(edge, /monitoringEligible/);
  assert.match(edge, /username !== LIVE_PILOT_USERNAME[\s\S]*eligible: false,[\s\S]*monitoringEligible/);
  assert.match(edge, /tracesSampleRate: 0\.1/);
  assert.match(client, /sessionId: createSessionId\(\)/);
  assert.match(client, /session_id: state\.sessionId/);
  assert.match(client, /const HEALTH_ASSERTIONS/);
  for (const assertion of ['chat_composer', 'home_modules', 'nav_theme', 'toolbar_row', 'drive_card_width']) {
    assert.match(client, new RegExp(assertion));
  }
  assert.doesNotMatch(client, /state\.cohortId|cohort_id:/);
  assert.match(client, /sendDefaultPii: false/);
  assert.match(client, /replaysSessionSampleRate: 0/);
  assert.match(html, /recordPerformance\('search',[\s\S]*cancelled: true/);
});
