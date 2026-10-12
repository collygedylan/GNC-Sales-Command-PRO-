export type HistoricalRequestsOperation = 'customers' | 'consignees' | 'requests' | 'reps' | 'folders' | 'months' | 'summary';
export type HistoricalRecordKind = 'all' | 'requests' | 'orders';

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

export type HistoricalRequestsBridge = {
  /** Must change on identity, role, account, or server-visible-scope changes. */
  scopeKey: string;
  revisionKey: string;
  read(query: HistoricalRequestsQuery, signal?: AbortSignal): Promise<HistoricalRequestsPage>;
};
