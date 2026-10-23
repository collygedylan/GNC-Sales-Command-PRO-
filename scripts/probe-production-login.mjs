import { readComposedAppSource } from './composed-app-source.mjs';

const source = readComposedAppSource();
const supabaseUrl = String(process.env.PRODUCTION_SUPABASE_URL
  || source.match(/const SUPABASE_URL = "([^"]+)"/)?.[1] || '').replace(/\/+$/, '');
const publishableKey = String(process.env.PRODUCTION_SUPABASE_PUBLISHABLE_KEY
  || source.match(/const SUPABASE_KEY = "([^"]+)"/)?.[1] || '').trim();
const serviceRoleKey = String(process.env.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY || '').trim();
const username = 'dylan_collyge';

if (!supabaseUrl || !publishableKey || !serviceRoleKey) throw new Error('production_login_smoke_configuration_missing');

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

async function appApi(body, headers = {}) {
  const response = await fetch(`${supabaseUrl}/functions/v1/app-api`, {
    method: 'POST',
    headers: { apikey: publishableKey, authorization: `Bearer ${publishableKey}`, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return { response, payload: await readJson(response) };
}

const credentialResponse = await fetch(`${supabaseUrl}/rest/v1/ph_app_users?select=password&username=eq.${encodeURIComponent(username)}&limit=1`, {
  headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
  signal: AbortSignal.timeout(15000),
});
const credentialRows = await readJson(credentialResponse);
const accessCode = String(Array.isArray(credentialRows) ? credentialRows[0]?.password || '' : '').trim();
if (!credentialResponse.ok || !accessCode) throw new Error(`production_login_smoke_credential_unavailable_http_${credentialResponse.status}`);

const login = await appApi({ action: 'login', username, password: accessCode });
if (login.response.status !== 200 || login.payload?.ok !== true || login.payload?.user?.username !== username || !login.payload?.session?.token) {
  throw new Error(`production_access_code_login_failed_http_${login.response.status}`);
}

const access = await appApi({ action: 'user_access', operation: 'resolve' }, { 'x-gnc-session': login.payload.session.token });
if (access.response.status !== 200 || access.payload?.ok === false) throw new Error(`production_user_access_failed_http_${access.response.status}`);

const authResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: publishableKey, 'content-type': 'application/json' },
  body: JSON.stringify({ email: `${username}@greenleafnursery.com`, password: accessCode }),
  signal: AbortSignal.timeout(15000),
});
const authPayload = await readJson(authResponse);
if (authResponse.status !== 200 || !authPayload?.access_token) throw new Error(`production_native_login_failed_http_${authResponse.status}`);

const bridge = await appApi({ action: 'native_session_bridge' }, { authorization: `Bearer ${authPayload.access_token}` });
if (bridge.response.status !== 200 || bridge.payload?.ok !== true || !bridge.payload?.session?.token) {
  throw new Error(`production_native_session_bridge_failed_http_${bridge.response.status}`);
}

console.log(JSON.stringify({ username, loginStatus: login.response.status, userAccessStatus: access.response.status,
  nativeLoginStatus: authResponse.status, nativeBridgeStatus: bridge.response.status }));
