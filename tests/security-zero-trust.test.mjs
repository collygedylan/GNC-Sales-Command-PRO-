import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createAppsScriptSigningKeyReconciliationEnvelope, createSignedDeploymentHealthEnvelope, isSignedDeploymentHealthEnvelope } from '../scripts/apps-script-signing.mjs';
import yaml from 'js-yaml';
import { createAppsScriptPostVerifier, signAppsScriptAction, signAppsScriptCommand, signAppsScriptReconciliationCommand } from './helpers/zero-trust-apps-script.mjs';

const api = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../supabase/functions/_shared/app-auth.ts', import.meta.url), 'utf8');
const canonical = readFileSync(new URL('../supabase/functions/_shared/canonical-user-access.ts', import.meta.url), 'utf8');
const auraVoiceStore = readFileSync(new URL('../supabase/functions/_shared/aura-voice-store.ts', import.meta.url), 'utf8');
const auraRouter = readFileSync(new URL('../supabase/functions/aura-llm-router/index.ts', import.meta.url), 'utf8');
const auraOwnerMigration = readFileSync(new URL('../supabase/migrations/20261021133149_aura_dylan_owner_only_guard.sql', import.meta.url), 'utf8');

test('bounded report reads reuse only the request gate verified actor', () => {
  const start = api.indexOf('export async function handleManagerReportReadAction(');
  const end = api.indexOf('\ntype LivePilotFeatureKey', start);
  const report = api.slice(start, end);
  assert.match(report, /verifiedActor: Record<string, unknown> \| null = null/);
  assert.match(report, /const profile = verifiedActor \|\| await resolveActiveSessionProfile\(session\)/);
  assert.match(report, /if \(!session\) return errorResponse/);
  assert.match(report, /can_access_eval_reports_2 !== true/);
  const gate = api.indexOf('const context = await resolveZeroTrustRequestContext(session);', api.indexOf('if (action === "password_change")'));
  const route = api.indexOf('if (action === "report_read_v2") return await handleManagerReportReadAction', gate);
  assert.ok(gate > 0 && route > gate);
  assert.match(api.slice(gate, route), /activeProfileForRequest = context\.actor;/);
  assert.match(api.slice(route, route + 220), /canonicalAccessForRequest, activeProfileForRequest/);
});

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

test('AURA voice capabilities require canonical Dylan while signed deployment health stays separate', () => {
  assert.match(canonical, /export function isCanonicalAuraOwner\(username: unknown\)/);
  assert.match(auraVoiceStore, /if \(actor\.id !== expectedId \|\| !UUID\.test\(expectedId\) \|\| typeof actor\.username !== "string" \|\| !isCanonicalAuraOwner\(actor\.username\)/);
  assert.match(auraOwnerMigration, /AURA_OWNER_ACCESS_CONTRACT_MISMATCH/);
  assert.match(auraOwnerMigration, /AURA_OWNER_CONTEXT_CONTRACT_MISMATCH/);
  assert.match(auraOwnerMigration, /AURA_OWNER_INVENTORY_CONTRACT_MISMATCH/);
  assert.match(auraOwnerMigration, /AURA_OWNER_SOC_CONTRACT_MISMATCH/);
  assert.match(auraOwnerMigration, /AURA_OWNER_ACCESS_ASSERTION_FAILED/);
  assert.match(auraOwnerMigration, /AURA_OWNER_CONTEXT_ASSERTION_FAILED/);
  assert.match(auraOwnerMigration, /AURA_OWNER_INVENTORY_ASSERTION_FAILED/);
  assert.match(auraOwnerMigration, /AURA_OWNER_SOC_ASSERTION_FAILED/);
  assert.match(auraOwnerMigration, /AURA_ACCESS_RPC_GRANTS_CHANGED/);
  assert.match(auraOwnerMigration, /AURA_READ_RPC_GRANTS_CHANGED/);
  assert.match(auraOwnerMigration, /grant state is not modified|Keep the existing SECURITY DEFINER body/);
  assert.match(auraRouter, /pathname\.endsWith\("\/aura-llm-router\/health"\)\) return handleAuraProviderProbe\(request\)/);
  assert.match(auraVoiceStore, /export async function handleAuraProviderProbe/);
  assert.match(auraVoiceStore.slice(auraVoiceStore.indexOf('export async function handleAuraProviderProbe')), /SUPABASE_SERVICE_ROLE_KEY/);
});

test('the scoped release runner accepts and verifies the AURA owner migration', async () => {
  const { selectReleaseMigrations, migrationContractQuery } = await import('../scripts/apply-item-low-stock-migration.mjs');
  const name = '20261021133149_aura_dylan_owner_only_guard.sql';
  assert.deepEqual(selectReleaseMigrations(JSON.stringify([`supabase/migrations/${name}`])), [name]);
  const contract = migrationContractQuery(name);
  for (const rpc of ['aura_voice_access_v1', 'aura_voice_context_v1', 'aura_voice_inventory_read_v1', 'aura_voice_soc_read_v1']) assert.ok(contract.includes(rpc));
  assert.match(contract, /dylan_collyge/);
  assert.match(contract, /has_function_privilege/);
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

test('Apps Script signing-key reconciliation is restricted to authenticated deployment health', () => {
  const command = { contractVersion: 'apps-script-action-v1', action: 'deployment_health',
    payload: { type: 'deployment_health' }, actor: { system: 'apps-script-deployment-health' } };
  const ordinary = createAppsScriptPostVerifier();
  assert.equal(ordinary.authorize(signAppsScriptCommand(command)).type, 'deployment_health');
  assert.equal(ordinary.testState.propertyWrites.length, 0);
  assert.equal(ordinary.testState.adminCalls.length, 0);

  const candidate = 'candidate-service-role-key';
  const reconciler = createAppsScriptPostVerifier({ key: 'legacy-key', adminStatus: 200, adminBody: { users: [{ id: 'fixture' }] } });
  const reconciliationEnvelope = createAppsScriptSigningKeyReconciliationEnvelope(candidate);
  assert.deepEqual(Object.keys(reconciliationEnvelope).sort(), ['deliveryJson', 'reconcileSigningKey', 'serverAuthorization', 'signature', 'timestamp', 'type']);
  const reconciled = reconciler.authorize(reconciliationEnvelope);
  assert.equal(reconciled.type, 'deployment_health');
  assert.deepEqual(Array.from(reconciler.testState.propertyWrites, row => Array.from(row)), [['AGDATA_ACTION_SIGNING_KEY_V1', candidate]]);
  assert.equal(reconciler.testState.adminCalls.length, 1);
  const normalHealth = createSignedDeploymentHealthEnvelope(candidate);
  assert.equal(reconciler.authorize(normalHealth).type, 'deployment_health');
  assert.equal(isSignedDeploymentHealthEnvelope(normalHealth, candidate), true);
  assert.equal(isSignedDeploymentHealthEnvelope(reconciliationEnvelope, candidate), false);
  assert.match(reconciler.testState.adminCalls[0].url, /\/auth\/v1\/admin\/users\?page=1&per_page=1$/);
  assert.equal(reconciler.testState.adminCalls[0].options.method, 'get');
  assert.equal(reconciler.authorize(reconciliationEnvelope).type, 'deployment_health');
  assert.equal(reconciler.testState.propertyWrites.length, 1);
  assert.equal(reconciler.testState.adminCalls.length, 1);

  const missingAuthorization = { ...reconciliationEnvelope };
  delete missingAuthorization.serverAuthorization;
  const noAuthorization = createAppsScriptPostVerifier({ key: 'legacy-key' });
  assert.throws(() => noAuthorization.authorize(missingAuthorization), /APPS_SCRIPT_ACTION_SIGNATURE_INVALID/);
  assert.equal(noAuthorization.testState.propertyWrites.length, 0);

  const invalidAuthorization = { ...reconciliationEnvelope, serverAuthorization: 'different-key' };
  const wrongAuthorization = createAppsScriptPostVerifier({ key: 'legacy-key' });
  assert.throws(() => wrongAuthorization.authorize(invalidAuthorization), /APPS_SCRIPT_ACTION_SIGNATURE_INVALID/);
  assert.equal(wrongAuthorization.testState.propertyWrites.length, 0);

  const invalidCredential = createAppsScriptPostVerifier({ key: 'legacy-key', adminStatus: 401, adminBody: { users: [] } });
  assert.throws(() => invalidCredential.authorize(signAppsScriptReconciliationCommand(command, 'anon-key')),
    /APPS_SCRIPT_SIGNING_KEY_SERVICE_AUTH_REQUIRED/);
  assert.equal(invalidCredential.testState.propertyWrites.length, 0);

  const nonHealth = createAppsScriptPostVerifier({ key: 'legacy-key', adminStatus: 200, adminBody: { users: [] } });
  const mutation = { contractVersion: 'apps-script-action-v1', action: 'manual_run', payload: { type: 'manual_run' },
    actor: { id: '11111111-1111-4111-8111-111111111111', username: 'fixture_user', role: 'manager' } };
  assert.throws(() => nonHealth.authorize(signAppsScriptReconciliationCommand(mutation, candidate)),
    /APPS_SCRIPT_HEALTH_RECONCILIATION_FORBIDDEN/);
  assert.equal(nonHealth.testState.propertyWrites.length, 0);
  assert.equal(nonHealth.testState.adminCalls.length, 0);
});

test('manual Apps Script health diagnostic signs read-only health and emits only allowlisted fields', () => {
  const workflow = yaml.safeLoad(readFileSync(new URL('../.github/workflows/apps-script-database-diagnostic.yml', import.meta.url), 'utf8'));
  const dispatch = workflow.on.workflow_dispatch;
  assert.equal(dispatch.inputs.target.type, 'choice');
  assert.deepEqual(dispatch.inputs.target.options, ['database', 'apps-script']);
  const steps = workflow.jobs['diagnose-database'].steps;
  const databaseProbe = steps.find(step => step.run === 'node scripts/apply-item-low-stock-migration.mjs --diagnose');
  assert.equal(databaseProbe.if, "inputs.target == 'database'");
  const health = steps.find(step => step.name === 'Probe Apps Script signed deployment health');
  assert.equal(health.if, "inputs.target == 'apps-script'");
  assert.equal(health.env.APPS_SCRIPT_DEPLOYMENT_ID, '${{ secrets.APPS_SCRIPT_DEPLOYMENT_ID }}');
  assert.equal(health.env.SUPABASE_SERVICE_ROLE_KEY, '${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}');
  assert.match(health.run, /createSignedDeploymentHealthEnvelope\(key\)/);
  assert.match(health.run, /safeCodes\.has\(/);
  assert.match(health.run, /JSON\.stringify\(\{ status: response\.status, ok: response\.ok && payload\?\.ok === true,\s*errorCode, deployedCommit \}\)/);
  assert.doesNotMatch(health.run, /console\.log\(payload|console\.log\(text|console\.log\(body/);
  assert.doesNotMatch(health.run, /SUPABASE_DB_URL|\.rpc\(|\.from\(/);
});
