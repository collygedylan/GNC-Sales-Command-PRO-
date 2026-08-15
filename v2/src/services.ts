import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { selectAndSortAvRows } from './avSort';
import { cacheInventoryPage, readCachedInventoryPage, savePreference as cachePreference } from './db';
import { loadRuntimeConfig } from './runtime';
import type {
  AvOptionRow,
  InventoryRow,
  PageResult,
  RequestRow as RequestRecord,
  UserPreferences,
  WorkflowRow
} from './types';

export const APP_VERSION = 'V2026.08.14.v2.16';
export const REQUEST_TABLE = 'ph_active_request';
export const REQUEST_LIVE_TABLE = REQUEST_TABLE;
export const INVENTORY_TABLE = 'ph_master_inventory';
export const SANDBOX_UPLOAD_BUCKET = 'sandbox-request-uploads';

export type RequestRow = RequestRecord;

export type Session = {
  token: string;
  username: string;
  role?: string;
  displayName?: string;
};

export type UploadResult = {
  publicUrl: string;
  bucketName: string;
  filePath: string;
};

type PageOptions = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  signal?: AbortSignal;
};

const SESSION_KEY = 'gnc:v2:sandbox-session';
const ALLOWED_TABLES = new Set([
  REQUEST_TABLE,
  INVENTORY_TABLE,
  'ph_cav_import',
  'ph_27f1_hl_po',
  'ph_dock_team_status',
  'sandbox_profiles',
  'sandbox_workflow_records',
  'sandbox_message_threads',
  'sandbox_messages',
  'sandbox_upload_jobs',
  'sandbox_event_log'
]);

let clientPromise: Promise<SupabaseClient> | null = null;

async function sandboxClient() {
  if (!clientPromise) {
    clientPromise = loadRuntimeConfig().then(config => createClient(config.supabaseUrl, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'x-gnc-app-shell': APP_VERSION } }
    }));
  }
  return clientPromise;
}

function assertAllowedTable(table: string) {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`Blocked sandbox table: ${table}`);
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

export function defaultSandboxSession(): Session {
  return {
    token: 'sandbox:dylan_collyge',
    username: 'dylan_collyge',
    role: 'manager',
    displayName: 'Dylan Collyge'
  };
}

export function readStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return defaultSandboxSession();
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.token?.startsWith('sandbox:') || !parsed.username) {
      localStorage.removeItem(SESSION_KEY);
      return defaultSandboxSession();
    }
    return parsed;
  } catch {
    return defaultSandboxSession();
  }
}

export function storeSession(session: Session | null) {
  if (!session) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function login(username: string, password: string): Promise<Session> {
  if (!password.trim()) throw new Error('Enter any sandbox passphrase to continue.');
  const normalized = normalizeUsername(username);
  const client = await sandboxClient();
  const { data, error } = await client
    .from('sandbox_profiles')
    .select('username,display_name,role')
    .eq('username', normalized)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('That sandbox tester account is not available.');
  const session = {
    token: `sandbox:${data.username}`,
    username: data.username,
    role: data.role,
    displayName: data.display_name
  };
  await recordSandboxEvent(session, 'tester_login', { username: data.username });
  return session;
}

export async function recordSandboxEvent(session: Session | null, eventType: string, payload: Record<string, unknown> = {}) {
  const client = await sandboxClient();
  const { error } = await client.from('sandbox_event_log').insert({
    event_type: eventType,
    actor_username: session?.username || 'anonymous_sandbox',
    entity_type: String(payload.entityType || 'v2_shell'),
    entity_id: payload.entityId ? String(payload.entityId) : null,
    payload: { ...payload, shell: APP_VERSION },
    created_at: new Date().toISOString()
  });
  if (error) console.warn('[v2 sandbox event]', error.message);
}

export async function dbRows(_session: Session, table: string, query: string): Promise<RequestRow[]> {
  assertAllowedTable(table);
  const client = await sandboxClient();
  const limitMatch = query.match(/(?:^|&)limit=(\d+)/i);
  const limit = Math.min(1000, Math.max(1, Number(limitMatch?.[1] || 400)));
  const { data, error } = await client.from(table).select('*').limit(limit);
  if (error) throw error;
  return (data || []) as RequestRow[];
}

const REQUEST_PATCH_KEYS: Record<string, string> = {
  REQ_QTY: 'req_qty',
  QTY: 'req_qty',
  RESERVE: 'req_reserve',
  REQ_RESERVE: 'req_reserve',
  ROW_NOTE: 'request_note',
  REQUEST_NOTE: 'request_note',
  REQ_SPEC: 'req_spec',
  REQ_CALIPER: 'req_caliper',
  LOC_MATCH: 'req_match',
  REQ_MATCH: 'req_match',
  AV_NOTE: 'av_note',
  PICK_NOTE: 'req_pic_note',
  REQ_PIC_NOTE: 'req_pic_note',
  REQ_STATUS: 'req_status',
  DATE_COMPLETED: 'date_completed',
  COMPLETED_BY_USERNAME: 'completed_by_username',
  COMPLETED_BY_DISPLAY: 'completed_by_display',
  COMPLETED_BY_EMAIL: 'completed_by_email',
  REQ_PHOTO_LINK: 'req_photo_link',
  REQ_PHOTO_NAME: 'req_photo_name',
  REQ_ARCHIVED: 'req_archived',
  REQ_COMMENTS: 'req_comments',
  DESIGCUST: 'desigcust',
  DESIGITEM: 'desigitem',
  DESIGLOC: 'desigloc'
};

function normalizedPatch(table: string, body: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    const normalized = table === REQUEST_TABLE
      ? REQUEST_PATCH_KEYS[key.toUpperCase()] || key.toLowerCase()
      : key.toLowerCase();
    output[normalized] = value;
  }
  return output;
}

export async function patchRow(session: Session, table: string, uniqueId: string | number, body: Record<string, unknown>) {
  assertAllowedTable(table);
  if (uniqueId === '' || uniqueId === null || uniqueId === undefined) throw new Error('Exact row id is required.');
  const patch = normalizedPatch(table, body);
  if (!Object.keys(patch).length) return;
  const client = await sandboxClient();
  const timestampPatch = table === INVENTORY_TABLE || table === 'ph_cav_import'
    ? { last_updated: new Date().toISOString() }
    : {};
  const { data, error } = await client
    .from(table)
    .update({ ...patch, ...timestampPatch })
    .eq('unique_id', String(uniqueId))
    .select('unique_id');
  if (error) throw error;
  if (!data?.length) throw new Error('Sandbox row was not found or is not writable.');
  await recordSandboxEvent(session, 'exact_row_update', {
    table,
    uniqueId: String(uniqueId),
    keys: Object.keys(patch)
  });
}

export async function fetchRequestRows(_session: Session, options: PageOptions = {}): Promise<RequestRow[]> {
  const client = await sandboxClient();
  const page = Math.max(0, options.page || 0);
  const pageSize = Math.min(1000, Math.max(25, options.pageSize || 400));
  let query = client
    .from(REQUEST_TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (options.search?.trim()) {
    const search = options.search.trim().replace(/[,%()]/g, ' ');
    query = query.or(`commonname.ilike.%${search}%,itemcode.ilike.%${search}%,locationcode.ilike.%${search}%`);
  }
  if (options.status && options.status !== 'all') query = query.eq('req_status', options.status);
  if (options.signal) query = query.abortSignal(options.signal);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as RequestRow[];
}

export async function fetchInventoryPage(options: PageOptions = {}): Promise<PageResult<InventoryRow>> {
  const page = Math.max(0, options.page || 0);
  const pageSize = Math.min(250, Math.max(25, options.pageSize || 100));
  try {
    const client = await sandboxClient();
    let query = client
      .from(INVENTORY_TABLE)
      .select('*', { count: 'exact' })
      .order('commonname', { ascending: true })
      .order('unique_id', { ascending: true })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (options.search?.trim()) {
      const search = options.search.trim().replace(/[,%()]/g, ' ');
      query = query.or(`commonname.ilike.%${search}%,itemcode.ilike.%${search}%,locationcode.ilike.%${search}%`);
    }
    if (options.signal) query = query.abortSignal(options.signal);
    const { data, error, count } = await query;
    if (error) throw error;
    const rows = (data || []) as InventoryRow[];
    await cacheInventoryPage(page, pageSize, rows);
    return { rows, page, pageSize, total: count || rows.length, source: 'sandbox' };
  } catch (error) {
    const rows = await readCachedInventoryPage(page, pageSize);
    if (!rows.length) throw error;
    return { rows, page, pageSize, total: rows.length, source: 'cache' };
  }
}

export async function fetchAvOptions(itemcode: unknown, selectedYear = 27, signal?: AbortSignal): Promise<AvOptionRow[]> {
  const normalized = String(itemcode || '').trim();
  if (!normalized) return [];
  const client = await sandboxClient();
  let query = client.from(INVENTORY_TABLE).select('*').eq('itemcode', normalized).limit(500);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  return selectAndSortAvRows((data || []) as InventoryRow[], normalized, selectedYear);
}

export async function fetchWorkflowRows(moduleKey: string, signal?: AbortSignal): Promise<WorkflowRow[]> {
  const client = await sandboxClient();
  let query = client
    .from('sandbox_workflow_records')
    .select('*')
    .eq('module_key', moduleKey)
    .order('updated_at', { ascending: false })
    .limit(500);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(row => {
    const payload = (row.payload || {}) as Record<string, unknown>;
    return {
    id: String(row.id),
    moduleKey: row.module_key,
    title: row.title,
    subtitle: row.subtitle,
    owner: row.assigned_to,
    status: row.status,
    count: Number(row.count_value || 0),
    itemcode: String(payload.itemcode || ''),
    locationcode: String(payload.locationcode || ''),
    lotcode: String(payload.lotcode || ''),
    detail: payload
  }});
}

export async function fetchMessageThreads(signal?: AbortSignal) {
  const client = await sandboxClient();
  let query = client.from('sandbox_message_threads').select('*').order('last_message_at', { ascending: false }).limit(100);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function fetchMessages(threadId: string, signal?: AbortSignal) {
  const client = await sandboxClient();
  let query = client.from('sandbox_messages').select('*').eq('thread_id', threadId).order('created_at', { ascending: true }).limit(500);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function saveUserPreferences(session: Session, preferences: UserPreferences) {
  const client = await sandboxClient();
  const row = {
    theme: preferences.theme,
    display_mode: preferences.displayMode,
    preferences: { requestColumns: preferences.requestColumns },
    updated_at: new Date().toISOString()
  };
  const { error } = await client.from('sandbox_profiles').update(row).eq('username', session.username);
  if (error) throw error;
  await cachePreference({ ...preferences, updatedAt: row.updated_at });
}

export async function uploadRequestPhoto(session: Session, file: File, uniqueId: string | number): Promise<UploadResult> {
  const client = await sandboxClient();
  const suffix = (file.name.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const filePath = `${session.username}/${String(uniqueId)}/req-${Date.now()}.${suffix}`;
  const jobId = crypto.randomUUID();
  await client.from('sandbox_upload_jobs').insert({
    id: jobId,
    request_id: String(uniqueId),
    inventory_unique_id: String(uniqueId),
    object_path: filePath,
    state: 'uploading',
    attempt_count: 1,
    metadata: { fileName: file.name, username: session.username },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  const { error: uploadError } = await client.storage.from(SANDBOX_UPLOAD_BUCKET).upload(filePath, file, {
    upsert: true,
    contentType: file.type || 'image/jpeg'
  });
  if (uploadError) {
    await client.from('sandbox_upload_jobs').update({ state: 'failed', error_message: uploadError.message, updated_at: new Date().toISOString() }).eq('id', jobId);
    throw uploadError;
  }
  const { data, error: signedError } = await client.storage.from(SANDBOX_UPLOAD_BUCKET).createSignedUrl(filePath, 60 * 60 * 24 * 7);
  if (signedError) throw signedError;
  await client.from('sandbox_upload_jobs').update({ state: 'uploaded', updated_at: new Date().toISOString() }).eq('id', jobId);
  await recordSandboxEvent(session, 'sandbox_photo_uploaded', { requestId: String(uniqueId), filePath });
  return { publicUrl: data.signedUrl, bucketName: SANDBOX_UPLOAD_BUCKET, filePath };
}

export function field(row: RequestRow | null | undefined, names: string[], fallback = ''): string {
  if (!row) return fallback;
  for (const name of names) {
    const direct = row[name];
    if (direct !== undefined && direct !== null && String(direct).trim() !== '') return String(direct);
    const lower = row[name.toLowerCase()];
    if (lower !== undefined && lower !== null && String(lower).trim() !== '') return String(lower);
  }
  return fallback;
}

export function numberField(row: RequestRow, names: string[], fallback = 0): number {
  const value = field(row, names, '');
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function uniqueId(row: RequestRow): string | number {
  return row.unique_id ?? field(row, ['UNIQUE_ID', 'id'], '');
}

export function isCompleted(row: RequestRow): boolean {
  const status = field(row, ['REQ_STATUS', 'req_status', 'STATUS']).toLowerCase();
  const completed = field(row, ['DATE_COMPLETED', 'date_completed', 'COMPLETED_AT', 'completed_at']);
  return Boolean(completed) || ['complete', 'completed', 'done', 'closed'].includes(status);
}

export function isArchived(row: RequestRow): boolean {
  return ['true', '1', 'yes'].includes(field(row, ['REQ_ARCHIVED', 'req_archived', 'ARCHIVED']).toLowerCase());
}

export function requestTab(row: RequestRow): string {
  const source = `${field(row, ['QUEUE_TYPE', 'queue_type', 'REQ_TYPE', 'req_type', 'TASK_TYPE', 'task_type', 'REQUEST_FOLDER', 'request_folder'])} ${field(row, ['REQUEST_TYPE', 'request_type'])}`.toLowerCase();
  if (source.includes('sales')) return 'sales';
  if (source.includes('location')) return 'location';
  if (source.includes('recount')) return 'recount';
  if (source.includes('av')) return 'av';
  if (source.includes('shear')) return 'shear';
  return 'request';
}

type DemoInventoryRow = RequestRow & InventoryRow;

const DEMO_PLANTS = [
  ['003746.030.1', 'Acoma Crapemyrtle', '#3'],
  ['004350.010.1', 'Big Blue Liriope', '#1'],
  ['001360.050.1', 'Compact Andorra Juniper', '#5'],
  ['002134.011.1', 'Madame Rosy Trumpet Creeper', '#1D'],
  ['001973.020.1', 'Blue Arrow Juniper', '#2'],
  ['004450.050.1', 'Maiden Grass', '#5'],
  ['010705.150.1', 'Colorama Scarlet Crapemyrtle Tree', '#15'],
  ['010370.250.1', 'Green Machine Redbud', '#25'],
  ['011732.021.1', 'Grey Guardian Juniper Wreath', '2DP'],
  ['003920.030.1', 'Little Lime Punch Hydrangea', '#3'],
] as const;

const DEMO_USERS = ['Kayla Knepp', 'Dylan Collyge', 'Brian Hatfield', 'Abbey Burka', 'JD Jones', 'Mitch Kaiser'];
const DEMO_CUSTOMERS = ['Coastal Landscape', 'Dothan Nurseries', 'Oakland Garden Center', 'South Nursery', 'Move Queue'];
const DEMO_QUEUES = ['request', 'sales', 'location', 'recount', 'av', 'shear'] as const;

function buildDemoRows(count = 5000): DemoInventoryRow[] {
  return Array.from({ length: count }, (_, index) => {
    const [itemcode, commonname, contsize] = DEMO_PLANTS[index % DEMO_PLANTS.length];
    const cycle = Math.floor(index / DEMO_PLANTS.length);
    const salesyear = 24 + (cycle % 7);
    const blockalpha = String.fromCharCode(65 + (cycle % 12));
    const blocknumber = 1 + (Math.floor(cycle / 12) % 30);
    const location = `${blockalpha}.${String(blocknumber).padStart(2, '0')}.${String(index % 40).padStart(3, '0')}`;
    const onHand = 18 + ((index * 17) % 950);
    const review = index % 13 === 0 ? 4 + (index % 21) : 0;
    const available = Math.max(0, onHand - review);
    const openStock = available + ((index * 29) % 780);
    const queueType = DEMO_QUEUES[index % DEMO_QUEUES.length];
    const status = index % 11 === 0 ? 'HOLD CHECK' : index % 7 === 0 ? 'REVIEW' : index % 5 === 0 ? 'REQUEST' : 'AVAILABLE';
    const uniqueId = `sandbox-${String(index + 1).padStart(5, '0')}`;

    return {
      unique_id: uniqueId,
      UNIQUE_ID: uniqueId,
      ITEMCODE: itemcode,
      itemcode,
      COMMONNAME: commonname,
      commonname,
      CONTSIZE: contsize,
      contsize,
      LOCATIONCODE: location,
      locationcode: location,
      LOTCODE: `${salesyear}.${index % 3 === 0 ? 'F1' : index % 3 === 1 ? 'U1' : 'S1'}`,
      lotcode: `${salesyear}.${index % 3 === 0 ? 'F1' : index % 3 === 1 ? 'U1' : 'S1'}`,
      SALESYEAR: salesyear,
      salesyear,
      BLOCKALPHA: blockalpha,
      blockalpha,
      BLOCKNUMBER: blocknumber,
      blocknumber,
      ONHAND: onHand,
      onhand: onHand,
      REVIEW: review,
      review,
      AVAILABLE: available,
      available,
      OPENSTOCK: openStock,
      openstock: openStock,
      QTY: index % 9 === 0 ? 12 : index % 5,
      PRI: index % 4 === 0 ? 1 : null,
      RESERVE: index % 8 === 0 ? 'YES' : 'NO',
      STATUS: status,
      status,
      QUEUE_TYPE: queueType,
      queue_type: queueType,
      SALESREP: DEMO_USERS[index % DEMO_USERS.length],
      salesrep: DEMO_USERS[index % DEMO_USERS.length],
      CUSTOMER: DEMO_CUSTOMERS[index % DEMO_CUSTOMERS.length],
      customer: DEMO_CUSTOMERS[index % DEMO_CUSTOMERS.length],
      ROW_NOTE: index % 6 === 0 ? 'Verify photo, specification, and location before Commit.' : '',
      AV_NOTE: index % 10 === 0 ? 'Check front, side, and tag condition.' : '',
      REQUIRED_SPEC: index % 4 === 0 ? 'Full canopy' : 'N/A',
      REQUIRED_CALIPER: index % 9 === 0 ? '1.5 in' : 'N/A',
    };
  });
}

const DEMO_ROWS = buildDemoRows();

export function demoRows(): RequestRow[] {
  return DEMO_ROWS;
}

export function demoAvOptions(itemcode: string, selectedYear = 27): AvOptionRow[] {
  return selectAndSortAvRows(DEMO_ROWS, itemcode, selectedYear).slice(0, 80);
}
