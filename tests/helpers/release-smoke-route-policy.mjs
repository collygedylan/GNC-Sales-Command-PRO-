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


/** Only a recognized read cancelled by its actual lifecycle signal can be omitted from network failures. */
export function isProvenReleaseSmokeReadCancellation(resource, evidence = []) {
  if (resource.method !== 'POST' || resource.idempotencyKey || !['Load request cancelled', 'net::ERR_ABORTED'].includes(resource.failure)) return false;
  let url, body;
  try { url = new URL(resource.url); body = JSON.parse(resource.body); } catch { return false; }
  if (url.origin !== RELEASE_SMOKE_SUPABASE_ORIGIN || !body || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => allowed.includes(key));
  const paged = params => keys(params, ['limit', 'offset', 'projection', 'filters', 'anyOf', 'order'])
    && Number.isInteger(params.limit) && params.limit >= 1 && params.limit <= 500 && Number.isInteger(params.offset) && params.offset >= 0;
  const datasets = new Set(['request_queue', 'active_request', 'soc', 'suspend_tag', 'cav', 'reserves', 'sales_office',
    'dock_team', 'dock_item', 'dock_issue', 'dock_allocations', 'productivity_history', 'inventory_edits', 'shear']);
  let knownRead = url.pathname === '/rest/v1/rpc/get_my_dataset_revisions_v1'
    && Object.keys(body).join(',') === 'p_dataset_keys' && Array.isArray(body.p_dataset_keys);
  if (url.pathname === '/functions/v1/app-api') {
    knownRead = body.action === 'inventory_read' && keys(body, ['action', 'operation', 'params']) && (
      body.operation === 'source_freshness' && keys(body.params, [])
      || body.operation === 'master_page' && keys(body.params, ['dataset', 'projection', 'limit', 'offset', 'uniqueId', 'itemCode', 'locationCode'])
        && ['master', 'avOpen', 'lookup'].includes(body.params.dataset) && ['initial', 'browse', 'full'].includes(body.params.projection)
        && Number.isInteger(body.params.limit) && body.params.limit >= 1 && body.params.limit <= 500
        && Number.isInteger(body.params.offset) && body.params.offset >= 0
      || body.operation === 'master_identity_batch' && keys(body.params, ['queueIdentities']) && Array.isArray(body.params.queueIdentities))
      || body.action === 'dataset_read' && keys(body, ['action', 'dataset', 'params']) && datasets.has(body.dataset) && paged(body.params)
      // Mirror the fixture's existing, fully specified background read routes.
      // No wildcard list/get operation can classify an unknown action as safe.
      || ['eval_work', 'user_access'].includes(body.action)
        && body.operation === (body.action === 'eval_work' ? 'list' : 'resolve')
        && Object.keys(body).sort().join(',') === 'action,operation'
      || body.action === 'shear_location_work' && body.operation === 'list' && body.status === 'active'
        && Object.keys(body).sort().join(',') === 'action,operation,status'
      || ['sales_credit', 'request_history'].includes(body.action) && body.operation === 'compatibility'
        && Object.keys(body).sort().join(',') === 'action,operation,payload'
        && keys(body.payload, ['status', 'cursor', 'limit']) && Object.keys(body.payload).length === 3
        && body.payload.status === 'all' && body.payload.cursor === null && body.payload.limit === 100
      || body.action === 'navigation_preferences' && body.operation === 'get' && keys(body, ['action', 'operation', 'payload'])
        && Object.keys(body).length === 3 && keys(body.payload, [])
      || body.action === 'av_read' && ['reserves', 'notes', 'hot_prices', 'settings'].includes(body.dataset)
        && keys(body, ['action', 'dataset', 'query']) && (body.query === undefined || typeof body.query === 'string');
  }
  if (!knownRead) return false;
  const index = evidence.findIndex(entry => entry.url === resource.url && entry.method === resource.method && entry.body === resource.body
    && entry.signalAborted === true && entry.reasonName === 'AbortError'
    && (['suspend-fixture-request-view-transition', 'published-lkg-drive-transition'].includes(entry.context)
      || typeof entry.abortStack === 'string' && entry.abortStack.includes('live-sync-coordinator.js')
        && (entry.abortStack.includes('invalidateBackground')
          || entry.abortStack.includes('abortSupabaseReadsBeforeGeneration') && entry.abortStack.includes('onStageStart'))));
  if (index < 0) return false;
  evidence.splice(index, 1); // One observed aborted signal can explain only one failed fetch.
  return true;
}
