import type {
  HistoricalArchiveFolder,
  HistoricalArchiveOperation,
  HistoricalArchivePage,
  HistoricalArchiveQuery,
  HistoricalArchiveRecord,
  HistoricalRequestGroup,
  HistoricalRequestRow,
  HistoricalRequestsBridge,
  HistoricalRequestsOperation,
  HistoricalRequestsPage,
  HistoricalRequestsQuery,
  HistoricalRecordKind,
} from '../components/historical-requests/contract';
import { historicalRequestsRoleCanViewFinancials } from '../components/historical-requests/contract';

export type HistoricalRequestsTransport = (query: HistoricalRequestsQuery | HistoricalArchiveQuery, signal?: AbortSignal) => Promise<unknown>;

export function historicalRequestsQuery(value: unknown): HistoricalRequestsQuery {
  const input = object(value, 'query');
  const operation = input.operation;
  if (typeof operation !== 'string' || !['customers', 'consignees', 'requests', 'reps', 'folders', 'months', 'summary'].includes(operation)) throw new Error('Invalid historical requests operation.');
  const result: HistoricalRequestsQuery = { operation: operation as HistoricalRequestsOperation };
  if ('customerKey' in input) result.customerKey = string(input.customerKey, 'customer key', 300);
  if ('consigneeKey' in input) result.consigneeKey = string(input.consigneeKey, 'consignee key', 300);
  if ('repKey' in input) {
    result.repKey = string(input.repKey, 'rep key', 80);
    if (!/^rep:(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|unassigned)$/.test(result.repKey)) throw new Error('Invalid historical requests rep key.');
  }
  if ('recordKind' in input) {
    if (!['all', 'requests', 'orders'].includes(String(input.recordKind)) || typeof input.recordKind !== 'string') throw new Error('Invalid historical requests record kind.');
    result.recordKind = input.recordKind as HistoricalRecordKind;
  }
  if ('view' in input) {
    if (input.view !== 'historical-requests' && input.view !== 'request-history') throw new Error('Invalid historical requests view.');
    result.view = input.view;
  }
  for (const key of ['dateFrom', 'dateTo'] as const) {
    if (key in input) {
      const date = string(input[key], key, 10);
      const parsed = new Date(date + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Invalid historical requests date.');
      result[key] = date;
    }
  }
  if (result.dateFrom && result.dateTo && result.dateFrom > result.dateTo) throw new Error('Invalid historical requests date range.');
  if ('page' in input) result.page = natural(input.page, 'page number');
  if ('pageSize' in input) {
    result.pageSize = natural(input.pageSize, 'page size');
    if (result.pageSize < 1 || result.pageSize > 100) throw new Error('Invalid historical requests page size.');
  }
  if (result.operation === 'consignees' && !result.customerKey) throw new Error('Select a customer first.');
  if (result.operation === 'requests' && (!result.customerKey || !result.consigneeKey)) throw new Error('Select a customer and consignee first.');
  return result;
}

export function historicalArchiveQuery(value: unknown): HistoricalArchiveQuery {
  const input = object(value, 'archive query');
  const operation = input.operation;
  if (typeof operation !== 'string' || !['archive-folders', 'archive-records', 'archive-search'].includes(operation)) {
    throw new Error('Invalid historical archive operation.');
  }
  if (typeof input.recordKind !== 'string' || !['requests', 'orders', 'reserves', 'drive'].includes(input.recordKind)) {
    throw new Error('Invalid historical archive record kind.');
  }
  const result: HistoricalArchiveQuery = {
    operation: operation as HistoricalArchiveOperation,
    recordKind: input.recordKind as HistoricalArchiveQuery['recordKind'],
  };
  if ('path' in input) {
    if (!Array.isArray(input.path) || input.path.length > 5) throw new Error('Invalid historical archive path.');
    result.path = input.path.map((value) => {
      const pathPart = string(value, 'archive path', 500);
      if (!pathPart) throw new Error('Invalid historical archive path.');
      return pathPart;
    });
  }
  if (result.operation === 'archive-search') {
    const query = string(input.query, 'archive search', 100).trim();
    if (query.length < 2) throw new Error('Enter at least two search characters.');
    result.query = query;
  } else if ('query' in input) {
    throw new Error('Invalid historical archive search.');
  }
  if (result.recordKind === 'requests' && result.operation !== 'archive-search') {
    throw new Error('Request folders use the protected Request history reader.');
  }
  if ('view' in input) {
    if (input.view !== 'historical-requests' && input.view !== 'request-history') throw new Error('Invalid historical archive view.');
    result.view = input.view;
  }
  if ('page' in input) result.page = natural(input.page, 'archive page number');
  if ('pageSize' in input) {
    result.pageSize = natural(input.pageSize, 'archive page size');
    if (result.pageSize < 1 || result.pageSize > 100) throw new Error('Invalid historical archive page size.');
  }
  return result;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid historical requests ${label}.`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, max = 500): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid historical requests ${label}.`);
  return value;
}
function nullableString(value: unknown, label: string, max = 500): string | null {
  return value === null ? null : string(value, label, max);
}
function natural(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid historical requests ${label}.`);
  return value;
}
function money(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Invalid historical requests ${label}.`);
  }
  return value;
}
function privateMoney(value: unknown, label: string, financials: boolean, redactUnauthorized = false): number | null {
  if (!financials) {
    if (redactUnauthorized) return null;
    if (value !== null) throw new Error('Historical requests financial data is not authorized.');
    return null;
  }
  return money(value, label);
}

function nullableMoney(value: unknown, label: string): number | null {
  return value === null ? null : money(value, label);
}

function nullableFiniteNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Invalid historical requests ${label}.`);
  }
  return value;
}

function privateNullableMoney(value: unknown, label: string, financials: boolean, redactUnauthorized = false): number | null {
  if (!financials) {
    if (redactUnauthorized) return null;
    if (value !== null) throw new Error('Historical archive financial data is not authorized.');
    return null;
  }
  return nullableMoney(value, label);
}

function privateNullableFiniteNumber(value: unknown, label: string, financials: boolean, redactUnauthorized = false): number | null {
  if (!financials) {
    if (redactUnauthorized) return null;
    if (value !== null) throw new Error('Historical archive financial data is not authorized.');
    return null;
  }
  return nullableFiniteNumber(value, label);
}
function summary(value: unknown, financials: boolean, redactUnauthorized = false): HistoricalRequestsPage['summary'] {
  const row = object(value, 'summary');
  const result = {
    requestCount: natural(row.requestCount, 'summary count'),
    totalValue: privateMoney(row.totalValue, 'summary value', financials, redactUnauthorized),
    unpricedCount: financials ? natural(row.unpricedCount, 'unpriced count') : privateMoney(row.unpricedCount, 'unpriced count', false, redactUnauthorized),
  };
  if (result.unpricedCount !== null && result.unpricedCount > result.requestCount) throw new Error('Invalid historical requests summary counts.');
  return result;
}
function group(value: unknown, financials: boolean, redactUnauthorized = false): HistoricalRequestGroup {
  const row = object(value, 'group');
  const result = {
    key: string(row.key, 'group key', 300),
    label: string(row.label, 'group label'),
    requestCount: natural(row.requestCount, 'group count'),
    totalValue: privateMoney(row.totalValue, 'group value', financials, redactUnauthorized),
    unpricedCount: financials ? natural(row.unpricedCount, 'group unpriced count') : privateMoney(row.unpricedCount, 'group unpriced count', false, redactUnauthorized),
    customerKey: nullableString(row.customerKey, 'customer key', 300),
    consigneeKey: nullableString(row.consigneeKey, 'consignee key', 300),
    consigneeName: nullableString(row.consigneeName, 'consignee name'),
    customerId: row.customerId === undefined ? null : nullableString(row.customerId, 'customer ID', 200),
    consigneeId: row.consigneeId === undefined ? null : nullableString(row.consigneeId, 'consignee ID', 200),
  };
  if (result.unpricedCount !== null && result.unpricedCount > result.requestCount) throw new Error('Invalid historical requests group counts.');
  return result;
}
function request(value: unknown, financials: boolean, redactUnauthorized = false): HistoricalRequestRow {
  const row = object(value, 'request');
  const requestedAt = nullableString(row.requestedAt, 'request date', 80);
  if (requestedAt !== null && !Number.isFinite(Date.parse(requestedAt))) throw new Error('Invalid historical requests request date.');
  const salesrepUserId = nullableString(row.salesrepUserId, 'sales rep ID', 80);
  const requestQty = row.requestQty === null ? null : money(row.requestQty, 'requested quantity');
  const effectiveQty = row.effectiveQty === null ? null : money(row.effectiveQty, 'effective quantity');
  const listPrice = financials ? (row.listPrice === null ? null : money(row.listPrice, 'list price')) : privateMoney(row.listPrice, 'list price', false, redactUnauthorized);
  const totalValue = financials ? (row.totalValue === null ? null : money(row.totalValue, 'request value')) : privateMoney(row.totalValue, 'request value', false, redactUnauthorized);
  const unresolvedReason = financials ? nullableString(row.unresolvedReason, 'unresolved reason', 1000) : privateMoney(row.unresolvedReason, 'unresolved reason', false, redactUnauthorized) as null;
  if (financials && totalValue === null && !unresolvedReason?.trim()) throw new Error('Unpriced historical request must explain the unresolved value.');
  if (totalValue !== null && requestQty !== null && requestQty > 0 && effectiveQty !== requestQty) {
    throw new Error('Historical request effective quantity does not match its requested quantity.');
  }
  if (totalValue !== null && (requestQty === null || requestQty === 0) && effectiveQty !== 25) {
    throw new Error('Historical request default quantity must be 25.');
  }
  if (totalValue !== null && (unresolvedReason || effectiveQty === null || listPrice === null
      || Math.abs(totalValue - effectiveQty * listPrice) > Math.max(0.01, totalValue * 1e-10))) {
    throw new Error('Historical request value does not match its effective quantity and current list price.');
  }
  if (!Array.isArray(row.photoLinks) || row.photoLinks.length > 20) throw new Error('Invalid historical requests photos.');
  const sentAt = nullableString(row.sentAt, 'sent date', 80);
  if (sentAt !== null && !Number.isFinite(Date.parse(sentAt))) throw new Error('Invalid historical requests sent date.');
  return {
    id: string(row.id, 'request ID', 200),
    customerName: string(row.customerName, 'customer name'),
    consigneeName: string(row.consigneeName, 'consignee name'),
    salesrepUserId,
    salesrepName: string(row.salesrepName, 'sales rep name'),
    itemcode: string(row.itemcode, 'item code', 200),
    commonname: string(row.commonname, 'common name'),
    location: string(row.location, 'location', 200),
    requestedAt,
    status: string(row.status, 'status', 100),
    requestQty,
    effectiveQty,
    listPrice,
    totalValue,
    unresolvedReason,
    dock: nullableString(row.dock, 'dock', 200),
    spec: string(row.spec, 'spec', 10000),
    caliper: string(row.caliper, 'caliper', 1000),
    comments: string(row.comments, 'comments', 10000),
    photoNotes: string(row.photoNotes, 'photo notes', 10000),
    photoLinks: row.photoLinks.map(value => nullableString(value, 'photo link', 20000)),
    sentAt,
    deliveryState: string(row.deliveryState, 'delivery state', 100),
  };
}

export function parseHistoricalRequestsPage(value: unknown, operation?: HistoricalRequestsOperation, options?: { canViewFinancials?: boolean }): HistoricalRequestsPage {
  const data = object(value, 'response');
  if (data.scope !== 'all' && data.scope !== 'own') throw new Error('Invalid historical requests scope.');
  if (typeof data.financials !== 'boolean' || data.financials !== (data.scope === 'all')) throw new Error('Invalid historical requests financial scope.');
  const redactUnauthorized = options?.canViewFinancials === false;
  const financials = data.financials && options?.canViewFinancials !== false;
  if (!['all', 'requests', 'orders'].includes(String(data.recordKind))) throw new Error('Invalid historical requests record kind.');
  const ownRepKey = string(data.ownRepKey, 'own rep key', 80);
  if (!/^rep:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ownRepKey)) throw new Error('Invalid historical requests own rep key.');
  const revision = string(data.revision, 'revision', 500);
  if (!revision) throw new Error('Missing historical requests revision.');
  const generatedAt = string(data.generatedAt, 'generated time', 80);
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Invalid historical requests generated time.');
  if (!Array.isArray(data.rows) || data.rows.length > 100) throw new Error('Invalid historical requests page rows.');
  const page = natural(data.page, 'page number');
  const pageSize = natural(data.pageSize, 'page size');
  if (pageSize < 1 || pageSize > 100 || data.rows.length > pageSize) throw new Error('Invalid historical requests page size.');
  const total = natural(data.total, 'total rows');
  if (data.rows.length > total) throw new Error('Invalid historical requests page total.');
  const rows = data.rows.map((row) => {
    const candidate = object(row, 'row');
    if ('requestCount' in candidate) {
      if (operation === 'requests') throw new Error('Request page contains a group row.');
      return group(candidate, financials, redactUnauthorized);
    }
    if (operation && operation !== 'requests') throw new Error('Group page contains a request row.');
    return request(candidate, financials, redactUnauthorized);
  });
  const identities = rows.map(row => isGroupValue(row) ? `group:${row.key}` : `request:${row.id}`);
  if (new Set(identities).size !== identities.length) throw new Error('Historical requests page contains duplicate identities.');
  if (operation === 'summary' && rows.length) throw new Error('Summary response unexpectedly contains rows.');
  return {
    scope: data.scope,
    financials,
    recordKind: data.recordKind as HistoricalRecordKind,
    ownRepKey,
    revision,
    generatedAt,
    page,
    pageSize,
    total,
    rows,
    summary: summary(data.summary, financials, redactUnauthorized),
  };
}

function archiveFolder(value: unknown, financials: boolean, redactUnauthorized: boolean): HistoricalArchiveFolder {
  const row = object(value, 'archive folder');
  if (row.kind !== 'folder') throw new Error('Invalid historical archive folder.');
  return {
    kind: 'folder',
    key: string(row.key, 'archive folder key', 300),
    value: string(row.value, 'archive folder value', 500),
    label: string(row.label, 'archive folder label', 1000),
    subtitle: string(row.subtitle, 'archive folder subtitle', 1000),
    recordCount: natural(row.recordCount, 'archive folder count'),
    totalValue: privateNullableFiniteNumber(row.totalValue, 'archive folder value', financials, redactUnauthorized),
  };
}

function archiveRecord(value: unknown, financials: boolean, redactUnauthorized: boolean): HistoricalArchiveRecord {
  const row = object(value, 'archive record');
  if (row.kind !== 'record') throw new Error('Invalid historical archive record.');
  const occurredAt = nullableString(row.occurredAt, 'archive record date', 80);
  if (occurredAt !== null && !Number.isFinite(Date.parse(occurredAt))) throw new Error('Invalid historical archive record date.');
  if (!Array.isArray(row.photoLinks) || row.photoLinks.length > 20) throw new Error('Invalid historical archive photos.');
  if (!Array.isArray(row.notes) || row.notes.length > 20) throw new Error('Invalid historical archive notes.');
  const factsValue = object(row.facts, 'archive facts');
  if (Object.keys(factsValue).length > 30 || Object.values(factsValue).some(item => item !== null
      && typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean')) {
    throw new Error('Invalid historical archive facts.');
  }
  return {
    kind: 'record',
    id: string(row.id, 'archive record ID', 300),
    title: string(row.title, 'archive record title', 1000),
    subtitle: string(row.subtitle, 'archive record subtitle', 2000),
    status: string(row.status, 'archive record status', 300),
    occurredAt,
    itemcode: string(row.itemcode, 'archive item code', 200),
    commonname: string(row.commonname, 'archive common name', 1000),
    contsize: string(row.contsize, 'archive container size', 200),
    locationcode: string(row.locationcode, 'archive location', 200),
    lotcode: string(row.lotcode, 'archive lot', 200),
    quantity: nullableFiniteNumber(row.quantity, 'archive quantity'),
    unitListPrice: privateNullableFiniteNumber(row.unitListPrice, 'archive list price', financials, redactUnauthorized),
    lineDollarValue: privateNullableFiniteNumber(row.lineDollarValue, 'archive line value', financials, redactUnauthorized),
    photoLinks: row.photoLinks.map(item => nullableString(item, 'archive photo link', 20000)),
    facts: Object.fromEntries(Object.entries(factsValue).map(([key, item]) => [string(key, 'archive fact name', 100),
      typeof item === 'string' ? string(item, 'archive fact value', 10000) : item])) as HistoricalArchiveRecord['facts'],
    notes: row.notes.map(item => string(item, 'archive note', 10000)),
  };
}

export function parseHistoricalArchivePage(value: unknown, query: HistoricalArchiveQuery,
  options?: { canViewFinancials?: boolean }): HistoricalArchivePage {
  const data = object(value, 'archive response');
  if (data.scope !== 'all' && data.scope !== 'own') throw new Error('Invalid historical archive scope.');
  if (typeof data.financials !== 'boolean' || data.financials !== (data.scope === 'all')) {
    throw new Error('Invalid historical archive financial scope.');
  }
  if (data.recordKind !== query.recordKind || data.operation !== query.operation) {
    throw new Error('Historical archive response does not match its query.');
  }
  if (!Array.isArray(data.path) || data.path.length > 5 || data.path.some(item => typeof item !== 'string' || item.length > 500)) {
    throw new Error('Invalid historical archive response path.');
  }
  const depth = natural(data.depth, 'archive depth');
  const maxDepth = natural(data.maxDepth, 'archive maximum depth');
  if (depth !== data.path.length || maxDepth > 5 || depth > maxDepth) throw new Error('Invalid historical archive depth.');
  const revision = string(data.revision, 'archive revision', 500);
  if (!revision) throw new Error('Missing historical archive revision.');
  const generatedAt = string(data.generatedAt, 'archive generated time', 80);
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Invalid historical archive generated time.');
  if (!Array.isArray(data.rows) || data.rows.length > 100) throw new Error('Invalid historical archive rows.');
  const page = natural(data.page, 'archive page number');
  const pageSize = natural(data.pageSize, 'archive page size');
  const total = natural(data.total, 'archive total');
  if (pageSize < 1 || pageSize > 100 || data.rows.length > pageSize || data.rows.length > total) {
    throw new Error('Invalid historical archive pagination.');
  }
  const redactUnauthorized = options?.canViewFinancials === false;
  const financials = data.financials && options?.canViewFinancials !== false;
  const rows = data.rows.map(row => {
    const candidate = object(row, 'archive row');
    return candidate.kind === 'folder' ? archiveFolder(candidate, financials, redactUnauthorized)
      : archiveRecord(candidate, financials, redactUnauthorized);
  });
  const identities = rows.map(row => `${row.kind}:${row.kind === 'folder' ? row.key : row.id}`);
  if (new Set(identities).size !== identities.length) throw new Error('Historical archive page contains duplicate identities.');
  return { scope: data.scope, financials, recordKind: query.recordKind, operation: query.operation,
    path: data.path as string[], depth, maxDepth, revision, generatedAt, page, pageSize, total, rows };
}

function isGroupValue(row: HistoricalRequestGroup | HistoricalRequestRow): row is HistoricalRequestGroup {
  return 'requestCount' in row;
}

export async function readHistoricalReportingDirectory(bridge: HistoricalRequestsBridge, repKey?: string, signal?: AbortSignal) {
  async function readAll(operation: 'reps' | 'customers') {
    const rows: HistoricalRequestGroup[] = [];
    let revision = '';
    for (let page = 0; ; page++) {
      const data = await bridge.read({ operation, recordKind: 'all',
        ...(operation === 'customers' && repKey ? { repKey } : {}), page, pageSize: 100 }, signal);
      if (data.scope !== 'all' || !data.financials) {
        throw Object.assign(new Error('Reporting scope changed. Refresh the report.'), { status: 403 });
      }
      if (revision && revision !== data.revision) throw new Error('Reporting source data changed. Refresh the report.');
      revision = data.revision;
      rows.push(...data.rows.filter(isGroupValue));
      if (rows.length >= data.total) return rows;
      if (!data.rows.length || page >= 10000) throw new Error('The complete reporting directory could not be read.');
    }
  }
  const [reps, customers] = await Promise.all([readAll('reps'), readAll('customers')]);
  return { reps, customers };
}

export function createHistoricalRequestsBridge({
  scopeKey, revisionKey, role, transport,
}: { scopeKey: string; revisionKey: string; role: string; transport: HistoricalRequestsTransport }): HistoricalRequestsBridge {
  if (!scopeKey || !revisionKey || typeof role !== 'string' || !role.trim() || typeof transport !== 'function') throw new Error('A signed-in historical requests scope is required.');
  const canViewFinancials = historicalRequestsRoleCanViewFinancials(role);
  return {
    scopeKey,
    role,
    revisionKey,
    async read(query, signal) {
      const safeQuery = historicalRequestsQuery(query);
      let raw: unknown;
      try { raw = await transport(safeQuery, signal); }
      catch (error) {
        if (error instanceof Error && /HISTORICAL_REQUESTS_(?:AUTH_REQUIRED|FORBIDDEN|REP_FORBIDDEN|REPS_FORBIDDEN|FINANCIAL_FORBIDDEN)/.test(error.message)) {
          error.message = 'Historical Requests is not available to this account. Refresh your access or sign in again.';
        }
        if (error instanceof Error && error.message.includes('HISTORICAL_REQUESTS_SOURCE_REFRESH_REQUIRED')) {
          error.message = 'Request or inventory data is updating. Try again after the sync finishes.';
        }
        throw error;
      }
      return parseHistoricalRequestsPage(raw, safeQuery.operation, { canViewFinancials });
    },
    async readArchive(query, signal) {
      const safeQuery = historicalArchiveQuery(query);
      let raw: unknown;
      try { raw = await transport(safeQuery, signal); }
      catch (error) {
        if (error instanceof Error && /HISTORICAL_ARCHIVE_(?:AUTH_REQUIRED|FORBIDDEN)/.test(error.message)) {
          error.message = 'Historical Archive is not available to this account. Refresh your access or sign in again.';
        }
        throw error;
      }
      return parseHistoricalArchivePage(raw, safeQuery, { canViewFinancials });
    },
  };
}

export type { HistoricalArchiveOperation, HistoricalRequestsOperation };
