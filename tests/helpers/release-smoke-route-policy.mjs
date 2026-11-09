export function smartHoldDirectReadFixture(method, url) {
  const u=new URL(url),table=u.pathname.split('/').pop(),p=u.searchParams;
  const spec={ph_hold_stop_itemcode_summaries:['*',30,'unique_id.asc'],ph_hold_stop_itemcode_cycles:['*',1500,'episode_start_date.desc,unique_id.desc'],ph_hold_release_cycles:['*',1500,'hold_started_on.desc,unique_id.desc'],ph_hold_learning_profiles:['*',1500,'unique_id.asc'],ph_drive_around_report_rows_snapshot_v3039:['unique_id,file_id,file_name,report_date,itemcode,locationcode,lotcode,holdstopcode,holdstopreason,hold_reason_category,holdstopbegindate,hsreasonbegin,itemspec,locationnote',1500,'report_date.desc,unique_id.desc'],ph_weather_daily:['date,temperature_high_f,temperature_low_f',90,'date.desc'],ph_dock_trip_status:['tripnumber,dock_num,status',500,'tripnumber.asc']}[table];
  if(method!=='GET'||!spec)return null;
  const expected=['select','limit','offset','order',...(table==='ph_weather_daily'?['station_key']:table==='ph_dock_trip_status'?[]:['itemcode'])].sort().join(',');
  const offset=Number(p.get('offset')),limit=Number(p.get('limit')),expectedLimit=offset===0?Math.min(1000,spec[1]):spec[1]-1000;
  if([...p.keys()].sort().join(',')!==expected||p.get('select')!==spec[0]||p.get('order')!==spec[2]||![0,1000].includes(offset)||limit!==expectedLimit||offset>=spec[1])return null;
  if(table==='ph_weather_daily'&&p.get('station_key')!=='eq.park_hill_ok')return null;
  if(p.has('itemcode')){const match=p.get('itemcode').match(/^in\.\(([A-Za-z0-9._,-]+)\)$/);if(!match||match[1].split(',').length>30||match[1].split(',').some(c=>!c||c.length>80))return null;}
  return [];
}

export function poManagementDirectReadFixture(method, url) {
  const parsed = new URL(url), table = parsed.pathname.split('/').pop(), params = parsed.searchParams;
  if (method !== 'GET' || !['ph_view_po_27f1_hl','ph_view_po_27s1_hl'].includes(table)) return null;
  const select = 'id,run_id,row_index,itemcode,commonname,contsize,locationcode,priority,lotcode,holdstopcode,holdstopreason,total_quantity_ordered,ptronhand,total_ptronhand,lot_pend_rec,salesrepid,salesrepname,customername,consigneename,consigneestate,stopnumber,quantityordered,requestdate,stagename,step,dock,po_remain,built_at';
  if ([...params.keys()].sort().join(',') !== 'limit,offset,order,select'
      || params.get('select') !== select || params.get('order') !== 'row_index.asc'
      || params.get('limit') !== '1000' || !/^\d+$/.test(params.get('offset') || '')) return null;
  return [];
}

export const RELEASE_SMOKE_SUPABASE_ORIGIN = 'https://kzrnyjsosryejjejliii.supabase.co';
export const RELEASE_SMOKE_SITE_ORIGIN = 'http://127.0.0.1:43124';

// Nursery reads are on-demand. A mutation, unknown table or extra parameter must
// never be accepted by the read-only fixture contract.
export function nurseryCommandReadFixture(method, url, body) {
  const parsed=new URL(url);
  if(method!=='POST'||parsed.origin!==RELEASE_SMOKE_SUPABASE_ORIGIN||parsed.pathname!=='/rest/v1/rpc/nursery_command_v23127'||parsed.search)return null;
  if(!body||Object.keys(body).sort().join(',')!=='p_operation,p_payload,p_table'||body.p_operation!=='read')return null;
  if(!['ph_nursery_locations','ph_nursery_items_cpb','ph_nursery_water_rating','ph_scientific_evidence_log','ph_header_control','ph_prod_schedule_active','ph_dylan_decisions_store'].includes(body.p_table))return null;
  const payload=body.p_payload;
  if(!payload||Object.keys(payload).sort().join(',')!=='limit,offset'||payload.limit!==1000||!Number.isInteger(payload.offset)||payload.offset<0||payload.offset>200000)return null;
  return {rows:[]};
}

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
  ['/rest/v1/rpc/get_my_erp_sync_progress_v23116', new Set(['POST'])],
  ['/rest/v1/rpc/report_app_health_event', new Set(['POST'])],
  ['/rest/v1/ph_inventory_field_audits', new Set(['GET'])],
  ['/rest/v1/ph_app_settings', new Set(['GET'])],
  ['/rest/v1/ph_soc_master', new Set(['GET'])],
  ['/rest/v1/ph_reserves', new Set(['GET'])],
  ['/rest/v1/ph_cav_import', new Set(['GET'])],
  ['/rest/v1/ph_requests_pending', new Set(['GET'])],
  ['/rest/v1/ph_active_suspend', new Set(['GET'])],
  ['/rest/v1/ph_inventory_row_assignments', new Set(['GET'])],
  ['/rest/v1/user_access', new Set(['GET'])],
  ['/rest/v1/ph_master_inventory', new Set(['GET'])],
  ['/rest/v1/ph_location_sales_notes', new Set(['GET'])],
  ['/rest/v1/ph_chat_participants', new Set(['GET'])],
  ['/rest/v1/ph_customer_consignee_sales_reps', new Set(['GET'])],
  ['/rest/v1/ph_department_calendar_events', new Set(['GET'])],
]);

const headerValue = (headers, name) => Object.entries(headers || {})
  .find(([key]) => key.toLowerCase() === name)?.[1] || '';

/** Fail closed for unknown external routes; known API paths still use the spec's strict payload checks. */
export function isRequestBatchReceiptRead(method, url, body) {
  const parsed = new URL(url);
  return parsed.origin === RELEASE_SMOKE_SUPABASE_ORIGIN && parsed.pathname === '/rest/v1/rpc/get_my_request_batch_receipt_v23162' && !parsed.search
    && method === 'POST' && !!body && Object.keys(body).sort().join(',') === 'p_batch,p_ids'
    && typeof body.p_batch === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(body.p_batch)
    && Array.isArray(body.p_ids) && body.p_ids.length > 0 && body.p_ids.length <= 100
    && new Set(body.p_ids).size === body.p_ids.length && body.p_ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 200);
}

function classifyLocalReleaseSmokeRoute(parsed, verb) {
  if (['GET', 'HEAD'].includes(verb)) return /^\/(?:rest\/v1|functions\/v1|auth\/v1)(?:\/|$)/.test(parsed.pathname)
    ? { allowed: false, reason: 'unknown-local-api-route' } : { allowed: true, reason: 'local-site' };
  if (verb === 'POST' && parsed.pathname === '/__fixture/access-refresh-transient-failure') return { allowed: true, reason: 'local-fixture' };
  return { allowed: false, reason: 'unknown-local-route' };
}

function parseReleaseSmokeBody(body) {
  try { return typeof body === 'string' ? JSON.parse(body) : body; } catch { return null; }
}

function classifySupabaseReleaseSmokeRoute(parsed, verb, headers, body) {
  const requestedMethod = verb === 'OPTIONS' ? headerValue(headers, 'access-control-request-method').toUpperCase() : verb;
  if (parsed.pathname === '/rest/v1/rpc/get_my_request_batch_receipt_v23162') {
    if (verb === 'OPTIONS') return { allowed: requestedMethod === 'POST' && !parsed.search, reason: 'receipt-preflight' };
    const data = parseReleaseSmokeBody(body);
    return { allowed: !!data && isRequestBatchReceiptRead(verb, parsed.href, data), reason: data ? 'exact-batch-receipt' : 'invalid-receipt-read' };
  }
  if (parsed.pathname === '/rest/v1/rpc/nursery_command_v23127') {
    if (verb === 'OPTIONS') return { allowed: requestedMethod === 'POST' && !parsed.search, reason: 'nursery-rpc-preflight' };
    const payload = parseReleaseSmokeBody(body);
    return { allowed: !!payload && !!nurseryCommandReadFixture(verb, parsed.href, payload), reason: payload ? 'exact-nursery-read' : 'invalid-nursery-read' };
  }
  if (poManagementDirectReadFixture(requestedMethod, parsed.href)) return { allowed: true, reason: 'exact-po-management-read' };
  if (smartHoldDirectReadFixture(requestedMethod, parsed.href)) return { allowed: true, reason: 'exact-smart-hold-read' };
  if (parsed.pathname === '/rest/v1/ph_location_sales_notes' && (!['GET','OPTIONS'].includes(verb)
    || requestedMethod !== 'GET' || parsed.searchParams.get('select') !== '*' || parsed.searchParams.get('limit') !== '1000'
    || !/^eq\.[A-Za-z0-9._-]{1,80}$/.test(parsed.searchParams.get('itemcode') || '')
    || [...parsed.searchParams.keys()].sort().join(',') !== 'itemcode,limit,select')) return { allowed: false, reason: 'invalid-location-note-read' };
  if (parsed.pathname === '/rest/v1/user_access' && (!['GET','OPTIONS'].includes(verb) || requestedMethod !== 'GET' || parsed.searchParams.get('select') !== '*' || parsed.searchParams.get('order') !== 'username.asc' || parsed.searchParams.get('limit') !== '1000' || [...parsed.searchParams.keys()].sort().join(',') !== 'limit,order,select')) return { allowed: false, reason: 'invalid-user-access-read' };
  if (parsed.pathname === '/rest/v1/ph_inventory_field_audits' && (!['GET','OPTIONS'].includes(verb) || requestedMethod !== 'GET' || parsed.searchParams.get('select') !== '*' || parsed.searchParams.get('order') !== 'row_uid.asc' || parsed.searchParams.get('limit') !== '1000' || !/^\d+$/.test(parsed.searchParams.get('offset') || '') || [...parsed.searchParams.keys()].sort().join(',') !== 'limit,offset,order,select')) return { allowed: false, reason: 'invalid-field-audit-read' };
  return SUPABASE_METHODS.get(parsed.pathname)?.has(requestedMethod)
    ? { allowed: true, reason: 'allowlisted-supabase-route' }
    : { allowed: false, reason: 'unknown-supabase-route' };
}

export function classifyReleaseSmokeRoute({ method, url, origin, resourceType = '', headers = {}, body = null, fixtureImageUrls = new Set() }) {
  let parsed;
  try { parsed = new URL(url); } catch { return { allowed: false, reason: 'invalid-url' }; }
  const verb = String(method || '').toUpperCase();
  if (parsed.origin === origin) return classifyLocalReleaseSmokeRoute(parsed, verb);
  if (parsed.origin === RELEASE_SMOKE_SUPABASE_ORIGIN) return classifySupabaseReleaseSmokeRoute(parsed, verb, headers, body);
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
  const method = String(resource.method || '').toUpperCase();
  if (url.origin === RELEASE_SMOKE_SITE_ORIGIN) {
    return method === 'GET' && resource.resourceType === 'fetch' && !resource.body
      && url.pathname === '/version.json' && [...url.searchParams.keys()].join(',') === 't'
      && /^\d{10,16}$/.test(url.searchParams.get('t') || '');
  }
  if (url.origin !== RELEASE_SMOKE_SUPABASE_ORIGIN) return false;
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
  if (action === 'erp_sync' && operation === 'status' && Object.keys(body).sort().join(',') === 'action,operation') return true;
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
  if (body.action === 'smart_hold_context') {
    if (Object.keys(body).sort().join(',') !== 'action,itemcodes' || !Array.isArray(body.itemcodes) || body.itemcodes.length < 1 || body.itemcodes.length > 30 || body.itemcodes.some(code => typeof code !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(code))) return null;
    return { ok: true, history: [], summaries: [], cycles: [], releases: [], profiles: [], observations: [], weather: [], reasons: [], docks: [], partial: false };
  }
  if (body.action === 'manager_table_management'
      && Object.keys(body).sort().join(',') === 'action,operation,payload,table'
      && ['company-directory', 'inquiry-coverage'].includes(body.table)
      && body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)) {
    if (body.operation === 'users' && Object.keys(body.payload).length === 0) {
      return { ok: true, data: { ok: true, rows: [{ username: 'fixture_user', display_name: 'Fixture User', email: 'fixture@example.test', userrole: 'evaluator' }] } };
    }
    if (body.operation === 'read' && Object.keys(body.payload).sort().join(',') === 'page,pageSize,q'
        && body.payload.page === 0 && body.payload.pageSize === 100 && body.payload.q === '') {
      const row = body.table === 'company-directory'
        ? { id: '00000000-0000-4000-8000-000000000001', name: 'Fixture User', username: 'fixture_user', active: true, revision: '1' }
        : { id: '00000000-0000-4000-8000-000000000002', scope: 'location', location: 'A.01.000', primary_user: 'fixture_user', active: true, revision: '1' };
      return { ok: true, data: { ok: true, rows: [row], total: 1 } };
    }
    return null;
  }
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
  if (body.action === 'erp_sync' && body.operation === 'status' && Object.keys(body).sort().join(',') === 'action,operation') return {ok:true,data:{active:false,currentStage:'idle'}};
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

export function erpSyncProgressReadFixture(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) return null;
  return { active: false, status: 'idle', sourceProgress: {} };
}
