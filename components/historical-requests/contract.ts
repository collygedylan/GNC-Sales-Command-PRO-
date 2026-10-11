export type HistoricalRequestsOperation = 'customers' | 'consignees' | 'requests' | 'reps' | 'summary';

export type HistoricalRequestsQuery = {
  operation: HistoricalRequestsOperation;
  customerKey?: string;
  consigneeKey?: string;
  page?: number;
  pageSize?: number;
};

export type HistoricalRequestGroup = {
  key: string;
  label: string;
  requestCount: number;
  totalValue: number;
  unpricedCount: number;
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
};

export type HistoricalRequestsPage = {
  scope: 'all' | 'own';
  revision: string;
  generatedAt: string;
  page: number;
  pageSize: number;
  total: number;
  rows: Array<HistoricalRequestGroup | HistoricalRequestRow>;
  summary: { requestCount: number; totalValue: number; unpricedCount: number };
};

export type HistoricalRequestsBridge = {
  /** Must change on identity, role, account, or server-visible-scope changes. */
  scopeKey: string;
  revisionKey: string;
  read(query: HistoricalRequestsQuery, signal?: AbortSignal): Promise<HistoricalRequestsPage>;
};
