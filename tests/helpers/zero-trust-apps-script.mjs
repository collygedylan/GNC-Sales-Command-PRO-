import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../Code.gs', import.meta.url), 'utf8');

export function createAppsScriptPostVerifier({ key = 'test-service-role-key', activeProfile = {
  id: '11111111-1111-4111-8111-111111111111', username: 'fixture_user', role: 'MANAGER',
  disabled_at: null, locked_until: null, must_change_password: false
}, initialProperties = {}, adminStatus = 200, adminBody = { users: [] } } = {}) {
  const start = source.indexOf('function appsScriptActionConstantTimeEqual_(');
  const end = source.length;
  if (start < 0) throw new Error('APPS_SCRIPT_POST_VERIFIER_SOURCE_MISSING');
  const state = { properties: { ...initialProperties }, propertyWrites: [], adminCalls: [] };
  const context = vm.createContext({
    state,
    Date,
    JSON,
    String,
    Number,
    Object,
    Array,
    Math,
    SUPABASE_KEY: key,
    SUPABASE_URL: 'https://example.supabase.co',
    PropertiesService: { getScriptProperties: () => ({
      getProperty: name => state.properties[name] || null,
      setProperty: (name, value) => { state.properties[name] = value; state.propertyWrites.push([name, value]); },
    }) },
    UrlFetchApp: { fetch: (url, options) => {
      state.adminCalls.push({ url, options });
      return { getResponseCode: () => adminStatus, getContentText: () => JSON.stringify(adminBody) };
    } },
    getSupabaseHeadersForKey_: candidate => ({ apikey: candidate, Authorization: `Bearer ${candidate}` }),
    Utilities: {
      Charset: { UTF_8: 'utf8' },
      computeHmacSha256Signature: (message, secret) => [...createHmac('sha256', secret).update(message).digest()],
    },
    requestDeliveryBase64Url_: bytes => Buffer.from(bytes).toString('base64url'),
    requestDeliveryRest_: () => [activeProfile],
    callSupabaseRpc_: (_name, payload) => ({ profile: { id: payload.p_actor_profile_id, username: activeProfile.username },
      baseline: { role: 'manager' } }),
    verifyProductionScheduleImportCommand_: () => ({ ok: true }),
    verifyRuntimeWatchdogAlert_: () => ({ ok: true }),
    verifySignedRequestDelivery_: () => ({ ok: true }),
    verifyPhotoArchiveRequest_: () => ({ ok: true }),
  });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.authorize = authorizeAppsScriptPost_; globalThis.testState = state;', context);
  return context;
}

export function signAppsScriptCommand(command, key = 'test-service-role-key', now = Date.now()) {
  const timestamp = new Date(now).toISOString();
  const deliveryJson = JSON.stringify(command);
  const signature = createHmac('sha256', key).update(`${timestamp}.${deliveryJson}`).digest('base64url');
  return { type: 'apps_script_action_v1', timestamp, signature, deliveryJson };
}

export function signAppsScriptReconciliationCommand(command, key = 'candidate-service-role-key', now = Date.now(), serverAuthorization = key) {
  return { ...signAppsScriptCommand(command, key, now), reconcileSigningKey: true, serverAuthorization };
}

export function signAppsScriptAction(action, payload = {}, actor = { id: '11111111-1111-4111-8111-111111111111', username: 'fixture_user', role: 'MANAGER' }, key, now) {
  return signAppsScriptCommand({ contractVersion: 'apps-script-action-v1', action, payload, actor }, key, now);
}
