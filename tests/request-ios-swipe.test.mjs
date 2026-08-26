import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/ops-precision-pilot.css', import.meta.url), 'utf8');
const capabilityMigration = readFileSync(new URL('../supabase/migrations/20260825222325_stabilize_request_capabilities.sql', import.meta.url), 'utf8');
const capabilityPolicyGrantMigration = readFileSync(new URL('../supabase/migrations/20260825223040_grant_request_policy_helper.sql', import.meta.url), 'utf8');
const chanceCapabilityMigration = readFileSync(new URL('../supabase/migrations/20260826133016_allow_chance_alldredge_request_create_own.sql', import.meta.url), 'utf8');

test('Request permissions come from one authenticated capability contract', () => {
  assert.match(capabilityMigration, /create or replace function public\.get_request_capabilities\(\)/);
  assert.match(capabilityMigration, /global_access := private\.can_manage_requests\(\)/);
  assert.match(capabilityMigration, /'can_take_photo', save_access/);
  assert.match(capabilityMigration, /'can_edit', save_access/);
  assert.match(capabilityMigration, /'can_complete', save_access/);
  assert.match(capabilityMigration, /'can_archive', global_access/);
  assert.match(capabilityMigration, /grant execute on function public\.get_request_capabilities\(\) to authenticated/);
  assert.doesNotMatch(html, /REQUEST_(?:GLOBAL_ACCESS_TOKENS|REP_ENABLED_TOKENS|ROW_ARCHIVE_USERS)/);
  assert.match(html, /supabaseRpc\('get_request_capabilities'/);
  assert.match(html, /REQUEST_CAPABILITY_CACHE_PREFIX = 'gnc_request_capabilities_v1:'/);
  assert.match(html, /REQUEST_CAPABILITY_LOAD_FAILED/);

  const finalizeLoginStart = html.indexOf('async function finalizeLogin');
  const finalizeLogin = html.slice(finalizeLoginStart, finalizeLoginStart + 18000);
  assert.ok(finalizeLogin.indexOf('await initializeRequestCapabilities') < finalizeLogin.indexOf('getRoleAccessState'));
  const permissionCode = html.slice(
    html.indexOf('function canCurrentUserArchiveRequestRows'),
    html.indexOf('function canCurrentUserArchiveRequestRow(item')
  );
  assert.match(permissionCode, /capabilities\.canArchive/);
});

test('Bloom Picker Request rep selector merges the configured roster with normalized REP profiles', () => {
  const roster = html.slice(
    html.indexOf('const salesRepList='),
    html.indexOf('const PRIVILEGED_MANAGER_USER_KEYS')
  );
  assert.match(roster, /"Chance Alldredge"/);
  assert.match(roster, /"Chris Farrow"/);

  const loader = html.slice(
    html.indexOf('async function ensureRequestRepUserOptionsReady'),
    html.indexOf('function resolveCanonicalRequestRepName')
  );
  assert.match(loader, /select=username,role&order=username\.asc&limit=1000/);
  assert.doesNotMatch(loader, /role=in\.\(REP,Rep,rep\)/);
  assert.match(loader, /map\(normalizeRequestRepUserOption\)\.filter\(Boolean\)/);
  assert.match(loader, /mergeRequestModalRepOptions\(REQUEST_MODAL_REP_OPTIONS, directoryRepOptions\)/);

  const roleNormalizer = html.slice(
    html.indexOf('function isRequestRepRoleValue'),
    html.indexOf('function resolveStaticRequestRepLabel')
  );
  assert.match(roleNormalizer, /normalizeRoleAccessToken\(role\) === 'REP'/);
});

test('Ben create-and-own access is enforced in both policies and the save RPC', () => {
  assert.match(capabilityMigration, /username_key = 'ben_brown' then 'own'/);
  assert.match(capabilityMigration, /general_create_access := private\.can_create_general_requests\(\) or username_key = 'ben_brown'/);
  assert.match(capabilityMigration, /av_create_access := private\.can_create_av_requests\(\) or username_key = 'ben_brown'/);
  assert.match(capabilityMigration, /create or replace function private\.can_work_request_identity/);
  assert.match(capabilityMigration, /request_created_by_username,[\s\S]*request_selected_rep_username,[\s\S]*requested_by/);
  assert.match(capabilityMigration, /create policy ph_active_request_authenticated_read[\s\S]*private\.can_work_request_identity/);
  assert.match(capabilityMigration, /create policy ph_active_request_general_insert[\s\S]*private\.can_work_request_identity/);
  assert.match(capabilityMigration, /create policy ph_active_request_general_update[\s\S]*private\.can_work_request_identity/);
  assert.match(capabilityMigration, /create policy ph_request_history_authenticated_read[\s\S]*private\.can_work_request_identity/);
  assert.match(capabilityPolicyGrantMigration, /grant execute on function private\.can_work_request_identity\(text, text, text\)[\s\S]*to authenticated/);
  assert.match(capabilityMigration, /create or replace function private\.stamp_request_batch_creator/);
  assert.match(capabilityMigration, /jsonb_build_object\('request_created_by_username', profile\.username\)/);
  assert.match(capabilityMigration, /create or replace function public\.create_request_batch[\s\S]*private\.stamp_request_batch_creator\(requests\)/);
  assert.match(capabilityMigration, /create or replace function public\.create_av_request_batch[\s\S]*private\.stamp_request_batch_creator\(requests\)/);
  assert.match(capabilityMigration, /message = 'REQUEST_ROW_FORBIDDEN'/);

  const normalize = (value) => String(value || '').trim().toLowerCase().split('@')[0].replace(/[^a-z0-9]+/g, '');
  const canBenWork = (row) => [row.creator, row.selectedRep, row.requestedBy].some((value) => normalize(value) === 'benbrown');
  assert.equal(canBenWork({ creator: 'Ben Brown', selectedRep: '', requestedBy: '' }), true);
  assert.equal(canBenWork({ creator: '', selectedRep: 'BEN_BROWN', requestedBy: '' }), true);
  assert.equal(canBenWork({ creator: '', selectedRep: '', requestedBy: 'ben.brown@greenleafnursery.com' }), true);
  assert.equal(canBenWork({ creator: 'kayla_knepp', selectedRep: 'jd_jones', requestedBy: 'Megan Kelly' }), false);
});

test('Chance receives create-and-own Request access without Manager or global scope', () => {
  assert.match(chanceCapabilityMigration, /not in \('ben_brown', 'chance_alldredge'\)/);
  assert.match(chanceCapabilityMigration, /lower\(btrim\(\(private\.current_active_profile\(\)\)\.username\)\) in[\s\S]*\('ben_brown', 'chance_alldredge'\)/);
  assert.match(chanceCapabilityMigration, /when username_key in \('ben_brown', 'chance_alldredge'\) then 'own'/);
  assert.match(chanceCapabilityMigration, /'can_create_general', general_create_access/);
  assert.match(chanceCapabilityMigration, /'can_create_av', av_create_access/);
  assert.match(chanceCapabilityMigration, /'can_archive', global_access/);
  assert.match(chanceCapabilityMigration, /if lower\(btrim\(coalesce\(profile\.username, ''\)\)\) in \('ben_brown', 'chance_alldredge'\)[\s\S]*message = 'REQUEST_ROW_FORBIDDEN'/);
  assert.match(chanceCapabilityMigration, /grant execute on function private\.can_work_request_identity\(text, text, text\)[\s\S]*to authenticated/);
});

test('Home and Request details always render a visible loading, stale, or retry state', () => {
  assert.match(html, /Loading Request access/);
  assert.match(html, /Using saved Request access/);
  assert.match(html, /Home could not load/);
  assert.match(html, /HOME_RENDER_EMPTY/);
  assert.match(html, /REQUEST_DETAIL_RENDER_FAILED/);
  assert.match(html, /retryRequestCapabilities\(\)/);
  assert.match(html, /retryActiveRequestDetail\(\)/);
});

test('the final mobile Request layer overrides legacy clipping and keeps touch actions reachable', () => {
  const finalAuthority = css.lastIndexOf('V2026.08.25.10 Request mobile authority');
  const legacyCompact = css.lastIndexOf('request detail viewport fit and collapsed-panel performance shell');
  assert.ok(finalAuthority > legacyCompact);
  const finalCss = css.slice(finalAuthority);
  assert.match(finalCss, /#main-scroll-area[\s\S]*overflow-y: auto !important/);
  assert.match(finalCss, /#det-request-content:not\(\.hidden\)[\s\S]*height: auto !important[\s\S]*overflow: visible !important/);
  assert.match(finalCss, /#req-input-container[\s\S]*display: grid !important/);
  assert.match(finalCss, /#det-request-content :is\(\.input-field, select, textarea\)[\s\S]*min-height: 48px !important[\s\S]*font-size: 16px !important/);
  assert.match(finalCss, /#request-photo-section[\s\S]*display: flex !important[\s\S]*overflow-x: auto !important/);
  assert.match(finalCss, /#req-save-action-wrap[\s\S]*position: fixed !important/);
  assert.match(finalCss, /request-av-note-sheet-open[\s\S]*overflow-y: auto !important[\s\S]*touch-action: pan-y !important/);
  assert.doesNotMatch(css, /height:\s*214px\s*!important/);
  assert.doesNotMatch(css, /height:\s*188px\s*!important/);
});

test('iOS Request rendering uses the swipe surface instead of disabling it', () => {
  const decorateCode = html.slice(
    html.indexOf('function decorateRequestRows'),
    html.indexOf('function refreshRequestViewAfterArchive')
  );
  assert.match(decorateCode, /request-swipe-enabled/);
  assert.doesNotMatch(decorateCode, /decorateIosPhoneRequestRemoveButtons\(container\)/);
  assert.doesNotMatch(decorateCode, /request-swipe-disabled/);
  assert.match(decorateCode, /touchend', handleRequestSwipeTouchEnd, \{ passive: false \}/);
  assert.match(decorateCode, /pointerup', handleRequestSwipeEnd, \{ passive: false \}/);
});

test('iOS Request swipe reveals a touch-sized Remove action', () => {
  assert.match(html, /body\.ios-device\.viewport-phone\.current-view-request #view-request \.request-swipe-row\{[\s\S]*overflow:hidden !important/);
  assert.match(html, /body\.ios-device\.viewport-phone\.current-view-request #view-request \.request-swipe-row\.swipe-open \.request-swipe-surface\{[\s\S]*translateX\(-88px\)/);
  assert.match(html, /body\.ios-device\.viewport-phone\.current-view-request #view-request \.request-swipe-action\{[\s\S]*display:flex !important[\s\S]*width:88px !important[\s\S]*min-height:44px !important/);
});
