import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createAppsScriptPostVerifier, signAppsScriptAction, signAppsScriptCommand } from './helpers/zero-trust-apps-script.mjs';

const api = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../supabase/functions/_shared/app-auth.ts', import.meta.url), 'utf8');
const canonical = readFileSync(new URL('../supabase/functions/_shared/canonical-user-access.ts', import.meta.url), 'utf8');

test('all app-api actions except login and password reconciliation pass the verified active-profile gate', () => {
  const routerStart = api.indexOf('const contentType = String(req.headers.get("content-type")');
  const loginRoute = api.indexOf('if (action === "login") return await handleLogin(payload, req);', routerStart);
  const passwordRoute = api.indexOf('if (action === "password_change") return await handlePasswordChange', routerStart);
  const commonGate = api.indexOf('const context = await resolveZeroTrustRequestContext(session);', passwordRoute);
  const watchdogRoute = api.indexOf('if (action.startsWith("watchdog_"))', commonGate);
  assert.ok(routerStart >= 0 && loginRoute > routerStart && passwordRoute > loginRoute && commonGate > passwordRoute && watchdogRoute > commonGate);
  assert.match(api.slice(routerStart, watchdogRoute), /if \(contentType\.includes\("multipart\/form-data"\)\)[\s\S]*?resolveZeroTrustRequestContext\(session\)/);
  assert.match(api.slice(routerStart, watchdogRoute), /action === "login"[\s\S]*?return await handleLogin\(payload, req\)/);
  assert.match(api.slice(routerStart, watchdogRoute), /action === "password_change"[\s\S]*?readPasswordChangeSession\(req, session\)/);
});

test('the common actor context is server-resolved and rejects identity or canonical-access mismatches', () => {
  const start = api.indexOf('async function resolveZeroTrustRequestContext(');
  const end = api.indexOf('\nexport async function handleFieldCountAction', start);
  const source = api.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(source, /if \(!session\) throw[\s\S]*?status: 401/);
  assert.match(source, /session\.mustChangePassword/);
  assert.match(source, /resolveActiveSessionProfile\(session\)/);
  assert.match(source, /resolveCanonicalUserAccess\(supabase, String\(actor\.id \|\| ""\)\)/);
  assert.match(source, /profileUsername !== sessionUsername \|\| profileUsername !== access\.username/);
  assert.match(source, /canonicalRole: access\.canonicalRole/);
  assert.match(source, /role: access\.canonicalRole,[\s\S]*?displayRole: String\(actor\.role/);
  assert.match(canonical, /profile\?\.id !== actorProfileId/);
  assert.match(canonical, /const canonicalRole = String\(baseline\?\.role/);
});

test('signed app sessions reject malformed and expired expiry values', async () => {
  const start = auth.indexOf('async function verifyAppSessionToken(');
  const end = auth.indexOf('\ntype AccountClient', start);
  let source = auth.slice(start, end);
  assert.ok(start >= 0 && end > start);
  source = source.replace(': Promise<AppSessionClaims | null>', '').replace(/ as AppSessionClaims/g, '');
  const context = vm.createContext({
    Date,
    JSON,
    String,
    Number,
    TextDecoder,
    normalizeUsername: value => String(value || '').trim().toLowerCase().replace(/@.*$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
    decoder: new TextDecoder(),
    decodeBase64Url: value => new Uint8Array(Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    signPayload: async () => 'verified-signature',
  });
  vm.runInContext(`${source}; globalThis.verify = verifyAppSessionToken;`, context);
  const token = claims => `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.verified-signature`;
  assert.equal(await context.verify(token({ username: 'crew_member', exp: Math.floor(Date.now() / 1000) - 1 })), null);
  assert.equal(await context.verify(token({ username: 'crew_member', exp: 'not-a-number' })), null);
  const valid = await context.verify(token({ username: 'crew_member', exp: Math.floor(Date.now() / 1000) + 60, iat: 1 }));
  assert.equal(valid.username, 'crew_member');
});

test('the request context rejects missing or revoked users and replaces client role with canonical access', async () => {
  const start = api.indexOf('async function resolveZeroTrustRequestContext(');
  const end = api.indexOf('\nexport async function handleFieldCountAction', start);
  let source = api.slice(start, end);
  assert.ok(start >= 0 && end > start);
  source = source.replace('session: Awaited<ReturnType<typeof readSupabaseOrAppSessionFromRequest>>,', 'session,');
  const state = { revoked: false, accessFailure: false };
  const context = vm.createContext({
    normalizeUsername: value => String(value || '').trim().toLowerCase().replace(/@.*$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
    supabase: {},
    resolveActiveSessionProfile: async session => {
      if (state.revoked) throw new Error('profile_not_active');
      return { id: 'active-profile', username: 'dylan_collyge', display_name: 'Dylan Collyge', role: 'Admin' };
    },
    resolveCanonicalUserAccess: async (_db, actorId) => {
      assert.equal(actorId, 'active-profile');
      if (state.accessFailure) throw new Error('USER_ACCESS_ACTIVE_PROFILE_REQUIRED');
      return { username: 'dylan_collyge', canonicalRole: 'admin', permissions: { can_access_manager_tab: true } };
    },
  });
  vm.runInContext(`${source}; globalThis.resolve = resolveZeroTrustRequestContext;`, context);
  await assert.rejects(() => context.resolve(null), error => error.status === 401);
  state.revoked = true;
  await assert.rejects(() => context.resolve({ username: 'dylan_collyge', role: 'Admin' }), /profile_not_active/);
  state.revoked = false;
  state.accessFailure = true;
  await assert.rejects(() => context.resolve({ username: 'dylan_collyge', role: 'Admin' }), /USER_ACCESS_ACTIVE_PROFILE_REQUIRED/);
  state.accessFailure = false;
  const resolved = await context.resolve({ username: 'dylan_collyge', role: 'User', authUserId: 'client-controlled' });
  assert.equal(resolved.session.role, 'admin');
  assert.equal(resolved.session.canonicalRole, 'admin');
  assert.equal(resolved.session.displayRole, 'Admin');
  assert.equal(resolved.session.authUserId, 'active-profile');
  assert.equal(resolved.session.username, 'dylan_collyge');
});

test('Apps Script proxy payload replaces actor identity and preserves business username fields', () => {
  const start = api.indexOf('function sanitizeAppsScriptProxyPayload(');
  const end = api.indexOf('\nasync function handleAppsScriptAction', start);
  let source = api.slice(start, end);
  assert.ok(start >= 0 && end > start);
  source = source.replace('source: Record<string, unknown>, actor: Record<string, unknown>', 'source, actor');
  source = source.replace('const payload: Record<string, unknown> =', 'const payload =');
  const context = vm.createContext({
    normalizeUsername: value => String(value || '').trim().toLowerCase().replace(/@.*$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
    Object, String, Set,
  });
  vm.runInContext(`${source}; globalThis.sanitize = sanitizeAppsScriptProxyPayload;`, context);
  const safe = context.sanitize({ role: 'Admin', actorId: 'spoof', requestedBy: 'spoof', requestedByUsername: 'spoof', submittedByUsername: 'spoof', requestCreatedByUsername: 'spoof', username: 'target_rep' }, { username: 'Active.User', display_name: 'Active User' });
  assert.equal(safe.role, undefined);
  assert.equal(safe.actorId, undefined);
  assert.equal(safe.requestedBy, 'Active User');
  assert.equal(safe.requestedByUsername, 'active_user');
  assert.equal(safe.submittedByUsername, 'active_user');
  assert.equal(safe.requestCreatedByUsername, 'active_user');
  assert.equal(safe.username, 'target_rep');
});

test('login failures are rate-limited by keyed username and IP digests without affecting app sessions', () => {
  assert.match(api, /createAppRateLimitDigest\("username", normalizeUsername\(username\)\)/);
  assert.match(api, /createAppRateLimitDigest\("ip", getLoginClientAddress\(req\)\)/);
  assert.match(api, /updateLoginRateLimit\("check", normalizedInput, req\)/);
  assert.match(api, /updateLoginRateLimit\("failure", normalizedInput, req\)/);
  assert.match(api, /updateLoginRateLimit\("success", normalizedInput, req\)/);
  assert.match(api, /LOGIN_RATE_LIMITED/);
  assert.match(auth, /app-login-rate-v1\\u0000\$\{scope\}\\u0000\$\{value\}/);
  const migration = readFileSync(new URL('../supabase/migrations/20261021042013_app_login_rate_limit_v1.sql', import.meta.url), 'utf8');
  assert.match(migration, /failed_count\s*>\s*0/);
  assert.match(migration, /coalesce\(username_count,0\)>=10/);
  assert.match(migration, /coalesce\(ip_count,0\)>=40/);
  assert.match(migration, /interval '15 minutes'/);
  assert.match(migration, /grant execute on function private\.app_login_rate_limit_v1\(text,text,text\) to service_role/i);
  assert.match(migration, /create or replace function public\.app_login_rate_limit_v1/i);
  assert.match(migration, /select private\.app_login_rate_limit_v1/);
  assert.match(migration, /grant execute on function public\.app_login_rate_limit_v1\(text,text,text\) to service_role/i);
  assert.doesNotMatch(migration, /grant execute[^;]+ to (?:public|anon|authenticated)/i);
  assert.match(api, /"OPERATIONAL_FAILURE"/);
  assert.match(api, /eventType === "OPERATIONAL_FAILURE" \? "high"/);
});

test('Apps Script gateway signs only allowlisted actions using the active server actor', () => {
  const start = api.indexOf('async function handleAppsScriptAction(');
  const end = api.indexOf('\nasync function handleLogin', start);
  const source = api.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(source, /contractVersion: "apps-script-action-v1"/);
  assert.match(source, /actor: \{[\s\S]*?id: String\(actor\.id\)[\s\S]*?username: normalizeUsername\(String\(actor\.username[\s\S]*?role: access\.canonicalRole/);
  assert.match(source, /type: "apps_script_action_v1"/);
  assert.match(source, /signProductionScheduleCommand\(command, timestamp, PRODUCTION_SCHEDULE_SIGNING_SECRET\)/);
  const sanitizerStart = api.indexOf('function sanitizeAppsScriptProxyPayload(');
  assert.ok(sanitizerStart >= 0);
  assert.match(api.slice(sanitizerStart, api.indexOf('\nasync function handleAppsScriptAction', sanitizerStart)), /submittedbyusername/);
  assert.match(api.slice(sanitizerStart, api.indexOf('\nasync function handleAppsScriptAction', sanitizerStart)), /requestcreatedbyusername/);
  assert.match(api, /"inventory_transaction", "inventory_transaction_history"/);
  assert.match(api, /action === "drivearound_history_backfill" \|\| action === "deployment_health"/);
});

test('RLS lockdown removes anonymous mutation access and asserts the resulting boundary', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261021041910_zero_trust_rls_lockdown_v1.sql', import.meta.url), 'utf8');
  assert.match(migration, /alter table %I\.%I enable row level security/);
  assert.match(migration, /revoke %s on table %I\.%I from public,anon/);
  assert.match(migration, /revoke %s \(%I\) on table %I\.%I from public,anon/);
  assert.match(migration, /revoke execute on routine %s from public,anon/);
  assert.match(migration, /ZERO_TRUST_ANON_MUTATION_GRANT/);
  assert.match(migration, /ZERO_TRUST_ANON_MUTATION_RPC/);
  assert.match(migration, /grant %s on table %I\.%I to %I/);
  assert.match(migration, /grant execute on routine %s to %I/);
});

test('Apps Script doPost rejects unsigned requests and verifies the signed action contract', () => {
  const code = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
  assert.match(code, /authorizeAppsScriptPost_\(JSON\.parse\(e\.postData\.contents\)\)/);
  assert.match(code, /APPS_SCRIPT_POST_SIGNATURE_REQUIRED/);
  assert.match(code, /verifyAppsScriptActionEnvelope_/);
  assert.match(code, /Math\.abs\(Date\.now\(\) - timestampMs\) > 300000/);
  assert.match(code, /appsScriptActionConstantTimeEqual_/);
  const verifier = createAppsScriptPostVerifier();
  assert.throws(() => verifier.authorize({ type: 'email', emailType: 'new_request' }), /APPS_SCRIPT_POST_SIGNATURE_REQUIRED/);
  const signed = signAppsScriptAction('email', { type: 'email', emailType: 'new_request', requestedBy: 'spoofed', requestedByUsername: 'spoofed' });
  const authorized = verifier.authorize(signed);
  assert.equal(authorized.type, 'email');
  assert.equal(authorized.__verifiedAppActor.username, 'fixture_user');
  assert.equal(authorized.requestedBy, 'fixture_user');
  assert.equal(authorized.requestedByUsername, 'fixture_user');
  const tampered = { ...signed, signature: 'A'.repeat(signed.signature.length) };
  assert.throws(() => verifier.authorize(tampered), /APPS_SCRIPT_ACTION_SIGNATURE_INVALID/);
  assert.throws(() => verifier.authorize(signAppsScriptAction('manual_status', {}, undefined, undefined, Date.now() - 300001)), /APPS_SCRIPT_ACTION_SIGNATURE_EXPIRED/);
  assert.throws(() => verifier.authorize(signAppsScriptAction('drivearound_history_backfill', {})), /APPS_SCRIPT_ACTION_FORBIDDEN/);
  const health = signAppsScriptCommand({ contractVersion: 'apps-script-action-v1', action: 'deployment_health',
    payload: { type: 'deployment_health' }, actor: { system: 'apps-script-deployment-health' } });
  assert.equal(verifier.authorize(health).type, 'deployment_health');
  assert.equal(verifier.authorize({ type: 'request_delivery_event', timestamp: 'signed-by-dedicated-protocol' }).type, 'request_delivery_event');
});
