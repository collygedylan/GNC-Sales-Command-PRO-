export type HistoricalRequestsOperation = 'customers' | 'consignees' | 'requests' | 'reps' | 'folders' | 'months' | 'summary';
export type HistoricalRecordKind = 'all' | 'requests' | 'orders';
export type HistoricalArchiveKind = 'requests' | 'orders' | 'reserves' | 'drive';
export type HistoricalArchiveOperation = 'archive-folders' | 'archive-records' | 'archive-search';

export type HistoricalRequestsQuery = {
  operation: HistoricalRequestsOperation;
  customerKey?: string;
  consigneeKey?: string;
  repKey?: string;
  recordKind?: HistoricalRecordKind;
  view?: 'historical-requests' | 'request-history';
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

export type HistoricalRequestGroup = {
  key: string;
  label: string;
  requestCount: number;
  totalValue: number | null;
  unpricedCount: number | null;
  customerKey: string | null;
  consigneeKey: string | null;
  consigneeName: string | null;
  customerId?: string | null;
  consigneeId?: string | null;
};

export type HistoricalRequestRow = {
  id: string;
  customerName: string;
  consigneeName: string;
  salesrepUserId: string | null;
  salesrepName: string;
  itemcode: string;
  commonname: string;
  location: string;
  requestedAt: string | null;
  status: string;
  requestQty: number | null;
  effectiveQty: number | null;
  listPrice: number | null;
  totalValue: number | null;
  unresolvedReason: string | null;
  dock: string | null;
  spec: string;
  caliper: string;
  comments: string;
  photoNotes: string;
  photoLinks: Array<string | null>;
  photoDate?: string | null;
  sentAt: string | null;
  deliveryState: string;
};

export type HistoricalRequestsPage = {
  scope: 'all' | 'own';
  financials: boolean;
  recordKind: HistoricalRecordKind;
  ownRepKey: string;
  revision: string;
  generatedAt: string;
  page: number;
  pageSize: number;
  total: number;
  rows: Array<HistoricalRequestGroup | HistoricalRequestRow>;
  summary: { requestCount: number; totalValue: number | null; unpricedCount: number | null };
};

export type HistoricalArchiveQuery = {
  operation: HistoricalArchiveOperation;
  recordKind: HistoricalArchiveKind;
  path?: string[];
  query?: string;
  view?: 'historical-requests' | 'request-history';
  page?: number;
  pageSize?: number;
};

export type HistoricalArchiveFolder = {
  kind: 'folder';
  key: string;
  value: string;
  label: string;
  subtitle: string;
  recordCount: number;
  totalValue: number | null;
};

export type HistoricalArchiveRecord = {
  kind: 'record';
  id: string;
  title: string;
  subtitle: string;
  status: string;
  occurredAt: string | null;
  itemcode: string;
  commonname: string;
  contsize: string;
  locationcode: string;
  lotcode: string;
  quantity: number | null;
  unitListPrice: number | null;
  lineDollarValue: number | null;
  photoLinks: Array<string | null>;
  photoDate?: string | null;
  facts: Record<string, string | number | boolean | null>;
  notes: string[];
};

export function historicalPhotoDate(url: string, fallback?: string | null) {
  const source = `${url || ''} ${fallback || ''}`;
  const iso = source.match(/(?:^|[/_%-])(20\d{2})[-_/](\d{1,2})[-_/](\d{1,2})(?:[/_%-]|$)/i);
  if (iso) return `${String(iso[2]).padStart(2, '0')}/${String(iso[3]).padStart(2, '0')}/${iso[1].slice(-2)}`;
  const slash = source.match(/(?:^|[^\d])(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})(?=$|[^\d])/);
  if (slash) return `${String(slash[1]).padStart(2, '0')}/${String(slash[2]).padStart(2, '0')}/${slash[3].slice(-2)}`;
  const stamp = Date.parse(String(fallback || ''));
  if (!Number.isFinite(stamp)) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', year: '2-digit' }).format(new Date(stamp));
}

export type HistoricalArchivePage = {
  scope: 'all' | 'own';
  financials: boolean;
  recordKind: HistoricalArchiveKind;
  operation: HistoricalArchiveOperation;
  path: string[];
  depth: number;
  maxDepth: number;
  revision: string;
  generatedAt: string;
  page: number;
  pageSize: number;
  total: number;
  rows: Array<HistoricalArchiveFolder | HistoricalArchiveRecord>;
};

export type HistoricalRequestsBridge = {
  /** Must change on identity, role, account, or server-visible-scope changes. */
  scopeKey: string;
  /** Authenticated profile role; financial access is granted only to explicit admin roles. */
  role: string;
  revisionKey: string;
  read(query: HistoricalRequestsQuery, signal?: AbortSignal): Promise<HistoricalRequestsPage>;
  readArchive(query: HistoricalArchiveQuery, signal?: AbortSignal): Promise<HistoricalArchivePage>;
};

export function historicalRequestsRoleCanViewFinancials(role: unknown): boolean {
  if (typeof role !== 'string') return false;
  const normalizedRole = role.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return ['ADMIN', 'ADMINISTRATOR', 'SUPERADMIN'].includes(normalizedRole);
}
