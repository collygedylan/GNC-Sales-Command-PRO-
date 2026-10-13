export type ReportSurface = 'eval1' | 'eval2' | 'ncr' | 'assigned-items' | 'season-priority' | 'approval';
export type ReportOperation = 'groups' | 'rows' | 'metadata' | 'detail';

/** Exact bounded projection returned by the server for Eval list pages. */
export type ServerListProjection = {
  unique_id: string;
  itemcode: string | null;
  commonname: string | null;
  contsize: string | null;
  locationcode: string | null;
  lotcode: string | null;
  season: string | null;
  priority: number | string | null;
  assignedto: string;
  assignedToUsers: string[];
  reportIds: string[];
  ptronhand: number | string | null;
  loc_on_hand?: number | null;
  loc_on_hand_itemcode?: string;
  loc_on_hand_locationcode?: string;
  loc_on_hand_revision?: string;
  ptravailable: number | string | null;
  s_lts: number | string | null;
  saleyear: string | null;
  genusname: string | null;
  last_updated: string | null;
  effectiveOwner: string | null;
};

export type EvalListRow = {
  unique_id?: string; UNIQUE_ID?: string; itemcode?: string; ITEMCODE?: string; commonname?: string; COMMONNAME?: string;
  contsize?: string; CONTSIZE?: string; assignedTo?: string; assigned_to?: string; ASSIGNEDTO?: string;
  reportIds?: string[]; reportRows?: InventoryDetailRow[]; locations?: string[]; blockalpha?: string; locationcode?: string;
  season?: string; status?: string; priority?: number | string; rowCount?: number;
};

export type InventoryDetailRow = {
  unique_id?: string; UNIQUE_ID?: string; id?: string; master_unique_id?: string; MASTER_UNIQUE_ID?: string;
  itemcode?: string; ITEMCODE?: string; commonname?: string; COMMONNAME?: string; contsize?: string; CONTSIZE?: string;
  locationcode?: string; LOCATIONCODE?: string; lotcode?: string; LOTCODE?: string; assignedto?: string; ASSIGNEDTO?: string;
  default_assignedto?: string; DEFAULT_ASSIGNEDTO?: string; default_revision?: number; DEFAULT_REVISION?: number;
  assignment_reason?: string; ASSIGNMENT_REASON?: string; review_required?: boolean; warehousei?: string; WAREHOUSEI?: string;
  source?: string; SOURCE?: string; genusname?: string; GENUSNAME?: string; ptravailable?: number | string; PTRAVAILABLE?: number | string;
  loc_on_hand?: number | null; LOC_ON_HAND?: number | null; loc_on_hand_itemcode?: string; LOC_ON_HAND_ITEMCODE?: string;
  loc_on_hand_locationcode?: string; LOC_ON_HAND_LOCATIONCODE?: string; loc_on_hand_revision?: string; LOC_ON_HAND_REVISION?: string;
  priority?: number | string; blockalpha?: string; assignedTo?: string; resolvedAssignedTo?: string[]; warehouseAssignedTo?: string[];
  sourceUid?: string; noteContext?: Record<string, string>; avg_order_qty?: number | string; low_stock_target?: number | string;
};

export type ReportGroupSummary = {
  key: string; itemCode?: string; itemcode?: string; commonName?: string; commonname?: string; contSize?: string; contsize?: string;
  reportIds?: string[]; reportRows?: InventoryDetailRow[]; rows?: EvalListRow[]; representativeRow?: EvalListRow;
  locations?: string[]; assignedToUsers?: string[]; rowCount?: number; [key: string]: string | number | boolean | string[] | InventoryDetailRow[] | EvalListRow[] | EvalListRow | undefined;
};

export type NcrGroupSummary = {
  key: string; itemCode?: string; itemcode?: string; commonName?: string; commonname?: string; rowCount?: number;
  locationcode?: string; assignedTo?: string; status?: string; rows?: InventoryDetailRow[];
};

export type ReportRow = EvalListRow | InventoryDetailRow | ReportGroupSummary | NcrGroupSummary;

export type ReportPageQuery = {
  surface: ReportSurface;
  operation: ReportOperation;
  filters: Record<string, unknown>;
  offset: number;
  limit: number;
  sourceRevision?: string;
};

export type ReportPage<Row extends ReportRow = ReportRow> = {
  rows: Row[];
  total: number | null;
  hasMore: boolean;
  sourceRevision: string;
  metadata?: Record<string, unknown>;
};

export type ReportPageTransport = (query: ReportPageQuery, signal?: AbortSignal) => Promise<unknown>;
export type ReportSessionConfig = {
  scopeKey: string;
  permissionVersion: string;
  transport: ReportPageTransport;
};

export type ReportSession = {
  readonly identityKey: string;
  /** Shared SWR storage travels with the authenticated session across separately bundled islands. */
  readonly swrCache: Map<string, unknown>;
  key(query: ReportPageQuery): string;
  peek(query: ReportPageQuery): ReportPage | undefined;
  pin(query: ReportPageQuery, pinned: boolean): void;
  read(query: ReportPageQuery, signal?: AbortSignal): Promise<ReportPage>;
  refresh(query: ReportPageQuery, signal?: AbortSignal): Promise<ReportPage>;
  invalidate(query?: ReportPageQuery): void;
  clear(): void;
};

export type ReportRowsMountOptions<Row extends ReportRow = ReportRow> = {
  session: ReportSession;
  query: ReportPageQuery;
  renderRow: (row: Row, index: number) => string;
  getScrollElement?: () => HTMLElement | null;
  estimateSize?: number;
  pageSize?: number;
  layout?: 'list' | 'grid' | 'table';
  emptyHtml?: string;
  tableHeaderHtml?: string;
  tableColSpan?: number;
  getKey?: (row: Row, index: number) => string;
  /** Pins every page to a parent cohort revision, such as rows inside a report group. */
  parentPinnedRevision?: string;
  onRevisionChanged?: (state: { expectedRevision: string; error: Error }) => void;
  onState?: (state: { page?: ReportPage<Row>; rows: Row[]; initialLoading: boolean; refreshing: boolean; error?: Error; total: number | null; sourceRevision: string }) => void;
  onRendered?: (host: HTMLElement, state: { rows: Row[]; total: number | null; sourceRevision: string }) => void;
};

export type ReportRowsMount = {
  update(options: Partial<ReportRowsMountOptions>): void;
  refresh(): void;
  destroy(): void;
};
