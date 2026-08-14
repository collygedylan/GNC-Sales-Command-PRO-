export const APP_VERSION = 'V2026.08.13.v2.11';
export const SUPABASE_URL = 'https://kzrnyjsosryejjejliii.supabase.co';
export const APP_API_URL = `${SUPABASE_URL}/functions/v1/app-api`;
export const REQUEST_TABLE = 'ph_active_request';
export const REQUEST_LIVE_TABLE = 'ph_active_request_live_rows';

export type Session = {
  token: string;
  username: string;
  role?: string;
  displayName?: string;
};

export type RequestRow = Record<string, unknown> & {
  unique_id?: string | number;
  COMMONNAME?: string;
  commonname?: string;
  LOCATIONCODE?: string;
  locationcode?: string;
  LOTCODE?: string;
  lotcode?: string;
  CONTSIZE?: string;
  contsize?: string;
};

export type UploadResult = {
  publicUrl: string;
  bucketName: string;
  filePath: string;
};

const SESSION_KEY = 'gnc:v2:session';

export function readStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as Session : null;
  } catch {
    return null;
  }
}

export function storeSession(session: Session | null) {
  if (!session) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function login(username: string, password: string): Promise<Session> {
  const response = await fetch(APP_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'login', username, password })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.ok) throw new Error(json?.error || 'Login failed');
  return {
    token: json.sessionToken || json.token,
    username: json.username || username,
    role: json.role,
    displayName: json.displayName || json.fullName
  };
}

async function appApi<T>(session: Session, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(APP_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-gnc-session': session.token
    },
    body: JSON.stringify(payload)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.ok === false) throw new Error(json?.error || `Request failed (${response.status})`);
  return json as T;
}

export async function dbRows(session: Session, table: string, query: string): Promise<RequestRow[]> {
  const json = await appApi<{ data?: RequestRow[]; rows?: RequestRow[] }>(session, {
    action: 'db',
    table,
    method: 'GET',
    query
  });
  return Array.isArray(json.data) ? json.data : Array.isArray(json.rows) ? json.rows : [];
}

export async function patchRow(session: Session, table: string, uniqueId: string | number, body: Record<string, unknown>) {
  await appApi(session, {
    action: 'db',
    table,
    method: 'PATCH',
    query: `unique_id=eq.${encodeURIComponent(String(uniqueId))}`,
    body
  });
}

export async function fetchRequestRows(session: Session): Promise<RequestRow[]> {
  try {
    return await dbRows(session, REQUEST_LIVE_TABLE, 'select=*&order=unique_id.desc&limit=400');
  } catch {
    return await dbRows(session, REQUEST_TABLE, 'select=*&order=unique_id.desc&limit=400');
  }
}

export async function uploadRequestPhoto(session: Session, file: File, uniqueId: string | number): Promise<UploadResult> {
  const form = new FormData();
  const suffix = file.name.split('.').pop() || 'jpg';
  form.set('action', 'upload-photo');
  form.set('prefix', 'req-');
  form.set('fileName', `req-${uniqueId}-${Date.now()}.${suffix}`);
  form.set('file', file);
  const response = await fetch(APP_API_URL, {
    method: 'POST',
    headers: { 'x-gnc-session': session.token },
    body: form
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.ok) throw new Error(json?.error || 'Photo upload failed');
  return { publicUrl: json.publicUrl, bucketName: json.bucketName, filePath: json.filePath };
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
  const source = `${field(row, ['QUEUE_TYPE', 'queue_type', 'REQ_TYPE', 'req_type', 'TASK_TYPE', 'task_type'])} ${field(row, ['REQUEST_TYPE', 'request_type'])}`.toLowerCase();
  if (source.includes('sales')) return 'sales';
  if (source.includes('location')) return 'location';
  if (source.includes('recount')) return 'recount';
  if (source.includes('av')) return 'av';
  if (source.includes('shear')) return 'shear';
  return 'request';
}

export function demoRows(): RequestRow[] {
  return [
    {
      unique_id: 'demo-1',
      QUEUE_TYPE: 'request',
      ITEMCODE: '002180.070.1',
      COMMONNAME: 'Ever Red Japanese Maple',
      LOCATIONCODE: 'E.16.000',
      LOTCODE: '26.F1',
      CONTSIZE: '#7',
      COLOR: 'ORANGE',
      SRC: 'SH',
      REQUESTED_BY: 'Annette Hancock',
      CUSTOMER: 'Oakland Garden Center',
      REQ_STATUS: 'Pending',
      QTY: 14,
      PRI: 1,
      ON_HAND: 212,
      REVIEW: 0,
      AVAILABLE: 212,
      OPEN_STOCK: 987,
      ROW_NOTE: 'Confirm color and take clean tag photo.',
      REQ_SPEC: 'Full canopy',
      AV_NOTE: 'Needs front and tag photo'
    },
    {
      unique_id: 'demo-2',
      QUEUE_TYPE: 'request',
      ITEMCODE: '001360.050.1',
      COMMONNAME: 'Compact Andorra Juniper',
      LOCATIONCODE: 'K.03.000',
      LOTCODE: '27.U2',
      CONTSIZE: '#5',
      SRC: 'SH',
      REQUESTED_BY: 'JD Jones',
      CUSTOMER: 'Hold Check',
      REQ_STATUS: 'Pending',
      QTY: 0,
      PRI: '-',
      ON_HAND: 235,
      REVIEW: 0,
      AVAILABLE: 235,
      OPEN_STOCK: 235,
      ROW_NOTE: 'Hold check - leaf quality',
      REQ_SPEC: 'N/A',
      PICK_NOTE: 'Check both rows before completing'
    },
    {
      unique_id: 'demo-3',
      QUEUE_TYPE: 'request',
      ITEMCODE: '003746.030.1',
      COMMONNAME: 'Acoma Crapemyrtle',
      LOCATIONCODE: 'H.03.000',
      LOTCODE: '27.F1',
      CONTSIZE: '#3',
      COLOR: 'WHITE',
      SRC: 'LD',
      REQUESTED_BY: 'Kayla Knepp',
      CUSTOMER: 'Coastal Landscape',
      REQ_STATUS: 'Pending',
      QTY: 25,
      PRI: 2,
      ON_HAND: 94,
      REVIEW: 0,
      AVAILABLE: 94,
      OPEN_STOCK: 441,
      ROW_NOTE: 'Are these blooming?',
      REQ_SPEC: 'Photo and spec check',
      REQ_CALIPER: 'N/A',
      AV_NOTE: 'FULL'
    },
    {
      unique_id: 'demo-4',
      QUEUE_TYPE: 'sales',
      ITEMCODE: '004350.010.1',
      COMMONNAME: 'Big Blue Liriope',
      LOCATIONCODE: 'E.07.000',
      LOTCODE: '26.U2',
      CONTSIZE: '#1',
      COLOR: 'BLUE',
      SRC: 'LD',
      REQUESTED_BY: 'Alyssa Beitz',
      CUSTOMER: 'Season Sales Notes',
      REQ_STATUS: 'Pending',
      QTY: 531,
      PRI: 1,
      ON_HAND: 939,
      REVIEW: 0,
      AVAILABLE: 939,
      OPEN_STOCK: 1040,
      ROW_NOTE: 'Photo, spec, and PRI check'
    },
    {
      unique_id: 'demo-5',
      QUEUE_TYPE: 'location move',
      ITEMCODE: '003000.030.1',
      COMMONNAME: 'Green Sargent Juniper',
      LOCATIONCODE: 'C.05.000',
      LOTCODE: '27.F1',
      CONTSIZE: '#3',
      SRC: 'LD',
      REQUESTED_BY: 'Brian Hatfield',
      CUSTOMER: 'Move Queue',
      REQ_STATUS: 'Pending',
      QTY: 120,
      PRI: 1,
      ON_HAND: 120,
      REVIEW: 0,
      AVAILABLE: 120,
      OPEN_STOCK: 0,
      DESIGLOC: 'D.18.000',
      ROW_NOTE: 'Tap to enter picked up qty and TA'
    },
    {
      unique_id: 'demo-6',
      QUEUE_TYPE: 'recount',
      ITEMCODE: '001360.010.1',
      COMMONNAME: 'Blue Star Juniper',
      LOCATIONCODE: 'C.17.000',
      LOTCODE: '26.U2',
      CONTSIZE: '#1',
      SRC: 'LD',
      REQUESTED_BY: 'Dylan Collyge',
      CUSTOMER: 'Inventory Office',
      REQ_STATUS: 'Pending',
      QTY: 16,
      PRI: 1,
      ON_HAND: 9,
      REVIEW: 0,
      AVAILABLE: 16,
      OPEN_STOCK: 0,
      ROW_NOTE: 'RECOUNT REQUIRED: picked up 16 + TA 0 = 16 but PTR on hand was 9.'
    },
    {
      unique_id: 'demo-7',
      QUEUE_TYPE: 'av check',
      ITEMCODE: '004450.050.1',
      COMMONNAME: 'Maiden Grass',
      LOCATIONCODE: 'F.16.000',
      LOTCODE: '27.S1',
      CONTSIZE: '#5',
      SRC: 'LD',
      REQUESTED_BY: 'Kayla Knepp',
      CUSTOMER: 'AV Check',
      REQ_STATUS: 'Pending',
      QTY: 531,
      PRI: 1,
      ON_HAND: 531,
      REVIEW: 0,
      AVAILABLE: 531,
      OPEN_STOCK: 531,
      ROW_NOTE: 'Check them out',
      REQ_SPEC: '15-18 inch H'
    },
    {
      unique_id: 'demo-8',
      QUEUE_TYPE: 'shear list',
      ITEMCODE: '002134.011.1',
      COMMONNAME: 'Madame Rosy Trumpet Creeper',
      LOCATIONCODE: 'E.23.000',
      LOTCODE: '27.F1',
      CONTSIZE: '#1D',
      SRC: 'LD',
      REQUESTED_BY: 'Mitch Kaiser',
      CUSTOMER: 'Shear List',
      REQ_STATUS: 'Pending',
      QTY: 323,
      PRI: 1,
      ON_HAND: 323,
      REVIEW: 0,
      AVAILABLE: 323,
      OPEN_STOCK: 660,
      ROW_NOTE: 'Open the card to review shear instructions and mark the row done.'
    },
    {
      unique_id: 'demo-9',
      QUEUE_TYPE: 'request',
      ITEMCODE: '001973.020.1',
      COMMONNAME: 'Northwind Switch Grass',
      LOCATIONCODE: 'J.11.000',
      LOTCODE: '27.F1',
      CONTSIZE: '#2',
      COLOR: 'GREEN',
      SRC: 'LD',
      REQUESTED_BY: 'Wes Lugas',
      CUSTOMER: 'N/A',
      REQ_STATUS: 'Pending',
      QTY: 0,
      PRI: 1,
      ON_HAND: 322,
      REVIEW: 0,
      AVAILABLE: 322,
      OPEN_STOCK: 312,
      ROW_NOTE: 'Are these pluming',
      REQ_SPEC: '24-30 inch'
    },
    {
      unique_id: 'demo-10',
      QUEUE_TYPE: 'request',
      ITEMCODE: '002760.070.1',
      COMMONNAME: 'Crimson Queen Japanese Maple',
      LOCATIONCODE: 'E.18.000',
      LOTCODE: '26.F1',
      CONTSIZE: '#7',
      COLOR: 'RED',
      SRC: 'SH',
      REQUESTED_BY: 'Megan Kelly',
      CUSTOMER: 'Retail Hold',
      REQ_STATUS: 'Pending',
      QTY: 6,
      PRI: 2,
      ON_HAND: 88,
      REVIEW: 0,
      AVAILABLE: 88,
      OPEN_STOCK: 140,
      DESIGCUST: 'Retail Hold',
      ROW_NOTE: 'Do not copy designation to sibling rows.'
    }
  ];
}
