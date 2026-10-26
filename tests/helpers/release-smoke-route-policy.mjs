export const RELEASE_SMOKE_SUPABASE_ORIGIN = 'https://kzrnyjsosryejjejliii.supabase.co';

export function isManualStatusAppsScriptProxyRead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).sort().join(',') !== 'action,payload' || body.action !== 'apps_script_action') return false;
  const wrapper = body.payload;
  if (!wrapper || typeof wrapper !== 'object' || Array.isArray(wrapper)
      || Object.keys(wrapper).sort().join(',') !== 'action,payload' || wrapper.action !== 'manual_status') return false;
  const payload = wrapper.payload;
  return !!payload && typeof payload === 'object' && !Array.isArray(payload)
    && Object.keys(payload).sort().join(',') === 'type' && payload.type === 'manual_status';
}

function isInventoryConsolidationSnapshotRead(body) {
  return !!body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).sort().join(',') === 'action,query'
    && body.action === 'inventory_consolidation'
    && body.query && typeof body.query === 'object' && !Array.isArray(body.query)
    && Object.keys(body.query).length === 0;
}

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


/** Ignore normal browser cancellation only for fixture routes with read/telemetry semantics.
 * The route handler still rejects unknown actions and unmocked mutations separately.
 * Request payload keys, pagination and lifecycle stack traces are not cancellation contracts.
 */
export function isProvenReleaseSmokeReadCancellation(resource) {
  if (!/(?:AbortError|ERR_ABORTED|\b(?:cancelled|canceled|aborted)\b)/i.test(String(resource.failure || ''))) return false;
  if (resource.idempotencyKey) return false;
  let url;
  try { url = new URL(resource.url); } catch { return false; }
  if (url.origin !== RELEASE_SMOKE_SUPABASE_ORIGIN) return false;
  const method = String(resource.method || '').toUpperCase();
  if (!SUPABASE_METHODS.get(url.pathname)?.has(method)) return false;
  if (['GET', 'HEAD'].includes(method)) return true;
  if (url.pathname === '/rest/v1/rpc/report_app_health_event') return true;
  if (url.pathname !== '/functions/v1/app-api') return method === 'POST';
  let body;
  try { body = JSON.parse(resource.body); } catch { return false; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const action = String(body.action || '');
  const operation = String(body.operation || '');
  // These semantic verbs classify a read, rather than a particular request shape.
  // A read action with an explicit write operation must still fail closed.
  const write = /(?:^|_)(?:create|update|delete|remove|insert|upsert|submit|apply|save|set|complete|close|send|enqueue|command|move|approve|deny|reclass)(?:_|$)/i;
  if (write.test(action) || write.test(operation)) return false;
  if (isInventoryConsolidationSnapshotRead(body)) return true;
  if (action === 'manual_sync_status' && !operation && Object.keys(body).length === 1) return true;
  if (action === 'customer-rep-map' && operation === 'preload') return true;
  if (action === 'suspend_tag' && operation === 'inbox') return true;
  return /(?:^|_)read(?:_v\d+)?$/i.test(action)
    || /^(?:get|list|read|resolve|lookup|search|fetch|metadata|capabilities|detail|rows|groups|compatibility)(?:_|$)/i.test(operation)
    || /^(?:health[-_]telemetry|telemetry|health)$/i.test(action);
}

/** Exact authenticated snapshot reads shared by startup fixtures. Unknown bodies
 * return null so the caller's existing rejection path remains authoritative. */
export function releaseSnapshotReadFixture(body, mappings = [], approvals = [], capabilities = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (isInventoryConsolidationSnapshotRead(body)) return {ok:true,data:{rows:[],currentSalesYear:null,generatedAt:null}};
  if (body.action === 'location_work' && body.operation === 'list' && body.status === 'all'
      && Object.keys(body).sort().join(',') === 'action,operation,status') return {ok:true,data:[]};
  if (body.action === 'reclass_recount' && body.operation === 'list'
      && Object.keys(body).sort().join(',') === 'action,operation') return {ok:true,data:[]};
  if (body.action === 'dataset_revisions' && Array.isArray(body.datasetKeys)
      && body.datasetKeys.length >= 1 && body.datasetKeys.length <= 2
      && body.datasetKeys.every(key => ['ph_master_inventory','ph_soc_master'].includes(key))
      && Object.keys(body).sort().join(',') === 'action,datasetKeys') {
    return {ok:true,data:{contractVersion:1,permissionVersion:'fixture-permissions-v1',sources:body.datasetKeys.map(key => ({key,revision:'1',state:'ready'}))}};
  }
  if (body.action === 'bunch_note_workflow' && ['queue','list_discrepancies'].includes(body.operation)
      && Object.keys(body).sort().join(',') === 'action,operation,payload'
      && body.payload && !Array.isArray(body.payload) && Object.keys(body.payload).sort().join(',') === 'filter,limit,offset'
      && body.payload.filter === 'mine' && body.payload.offset === 0 && body.payload.limit === 100) {
    return {ok:true,data:body.operation === 'queue'
      ? {cards:[],total:0,active_count:0,review_count:0,can_review:false,counters:[],assignee_options:[],unassigned_count:0}
      : {reviews:[],total:0,review_count:0,can_review:false,counters:[]}};
  }
  if (body.action === 'manual_sync_status' && Object.keys(body).join(',') === 'action') return {ok:true,data:{active:false,currentStage:'idle'}};
  if (body.action === 'request_work' && body.operation === 'capabilities' && Object.keys(body).sort().join(',') === 'action,operation' && capabilities) return {ok:true,data:capabilities};
  if (body.action === 'customer-rep-map' && body.operation === 'preload'
      && Object.keys(body).sort().join(',') === 'action,operation') {
    const reps = new Map();
    for (const row of mappings) {
      if (!reps.has(row.salesrepid)) reps.set(row.salesrepid,{salesrepid:row.salesrepid,salesrepname:row.salesrepname,rows:[]});
      reps.get(row.salesrepid).rows.push([row.customeridentityid,row.customername,row.consigneeid,row.consigneename]);
    }
    return {ok:true,reps:[...reps.values()],total:mappings.length,revision:'fixture-mapping-snapshot-r1'};
  }
  if (body.action === 'suspend_tag' && body.operation === 'inbox'
      && Object.keys(body).sort().join(',') === 'action,commandId,expectedVersion,operation,payload'
      && body.commandId === null && body.expectedVersion === null
      && body.payload && Object.keys(body.payload).length === 0 && !Array.isArray(body.payload)) {
    return {ok:true,data:{approvals}};
  }
  return null;
}
