export const RELEASE_SMOKE_SUPABASE_ORIGIN = 'https://kzrnyjsosryejjejliii.supabase.co';

const SUPABASE_METHODS = new Map([
  ['/functions/v1/app-api', new Set(['POST'])],
  ['/rest/v1/rpc/get_app_user_directory', new Set(['POST'])],
  ['/rest/v1/rpc/get_my_app_permissions_v1', new Set(['POST'])],
  ['/rest/v1/rpc/get_my_dataset_revisions_v1', new Set(['POST'])],
  ['/rest/v1/rpc/get_request_capabilities', new Set(['POST'])],
  ['/rest/v1/rpc/report_app_health_event', new Set(['POST'])],
  ['/rest/v1/ph_app_settings', new Set(['GET'])],
  ['/rest/v1/ph_chat_participants', new Set(['GET'])],
  ['/rest/v1/ph_customer_consignee_sales_reps', new Set(['GET'])],
  ['/rest/v1/ph_department_calendar_events', new Set(['GET'])],
]);

const headerValue = (headers, name) => Object.entries(headers || {})
  .find(([key]) => key.toLowerCase() === name)?.[1] || '';

/** Fail closed for unknown external routes; known API paths still use the spec's strict payload checks. */
export function classifyReleaseSmokeRoute({ method, url, origin, resourceType = '', headers = {}, fixtureImageUrls = new Set() }) {
  let parsed;
  try { parsed = new URL(url); } catch { return { allowed: false, reason: 'invalid-url' }; }
  const verb = String(method || '').toUpperCase();
  if (parsed.origin === origin) {
    if (['GET', 'HEAD'].includes(verb)) {
      if (/^\/(?:rest\/v1|functions\/v1|auth\/v1)(?:\/|$)/.test(parsed.pathname)) {
        return { allowed: false, reason: 'unknown-local-api-route' };
      }
      return { allowed: true, reason: 'local-site' };
    }
    if (verb === 'POST' && parsed.pathname === '/__fixture/access-refresh-transient-failure') return { allowed: true, reason: 'local-fixture' };
    return { allowed: false, reason: 'unknown-local-route' };
  }
  if (parsed.origin === RELEASE_SMOKE_SUPABASE_ORIGIN) {
    const methods = SUPABASE_METHODS.get(parsed.pathname);
    const requestedMethod = verb === 'OPTIONS' ? headerValue(headers, 'access-control-request-method').toUpperCase() : verb;
    if (methods?.has(requestedMethod)) return { allowed: true, reason: 'allowlisted-supabase-route' };
    return { allowed: false, reason: 'unknown-supabase-route' };
  }
  if (verb === 'GET' && resourceType === 'image' && fixtureImageUrls.has(parsed.href)) {
    return { allowed: true, reason: 'fixture-image' };
  }
  return { allowed: false, reason: 'external-route-blocked' };
}
