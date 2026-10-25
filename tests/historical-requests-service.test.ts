import { describe, expect, it, vi } from 'vitest';
import { createHistoricalRequestsBridge, historicalArchiveQuery, historicalRequestsQuery,
  parseHistoricalArchivePage, parseHistoricalRequestsPage } from '../services/historicalRequests';

const customerPage = {
  scope: 'all', financials: true, recordKind: 'all', ownRepKey: 'rep:50000000-0000-4000-8000-000000000001', revision: 'history-r7', generatedAt: '2026-10-10T12:00:00Z', page: 0, pageSize: 25, total: 1,
  rows: [{ key: 'cust:0001', label: 'North Nursery', requestCount: 3, totalValue: 1875, unpricedCount: 1, customerKey: 'cust:0001', consigneeKey: null, consigneeName: null, customerId: '0001', consigneeId: null }],
  summary: { requestCount: 3, totalValue: 1875, unpricedCount: 1 },
};
const requestRow = {
  id: 'request-001', customerName: 'North Nursery', consigneeName: 'East Yard', salesrepUserId: null, salesrepName: 'Molly Dixon',
  itemcode: '00123', commonname: 'Red Maple ®', location: 'A.01', requestedAt: null, status: 'Completed', requestQty: 0,
  effectiveQty: 25, listPrice: null, totalValue: null, unresolvedReason: 'Current master list price is unavailable.',
  dock: null, spec: '', caliper: '', comments: '', photoNotes: '', photoLinks: [], sentAt: null, deliveryState: 'unknown',
};
const archiveQuery = { operation: 'archive-records' as const, recordKind: 'orders' as const, path: ['Customer', 'Yard', 'Trip 1'] };
const archivePage = {
  scope: 'all', financials: true, recordKind: 'orders', operation: 'archive-records', path: archiveQuery.path,
  depth: 3, maxDepth: 3, revision: 'orders:r1', generatedAt: '2026-10-10T12:00:00Z', page: 0, pageSize: 25, total: 1,
  rows: [{ kind: 'record', id: 'order-1', title: 'Red Maple', subtitle: 'Trip 1', status: 'Archived', occurredAt: '2026-10-10T12:00:00Z',
    itemcode: '00123', commonname: 'Red Maple', contsize: '10G', locationcode: 'A.01', lotcode: 'L1', quantity: -2,
    unitListPrice: 12.5, lineDollarValue: -25, photoLinks: ['https://example.invalid/photo.jpg'], facts: { Dock: '0' }, notes: ['Credit row'] }],
};

describe('historical requests typed API boundary', () => {
  it('accepts exact rep identities and Orders without accepting malformed identity or kind filters', () => {
    expect(historicalRequestsQuery({ operation: 'folders', repKey: customerPage.ownRepKey, recordKind: 'orders', view: 'request-history' }))
      .toEqual({ operation: 'folders', repKey: customerPage.ownRepKey, recordKind: 'orders', view: 'request-history' });
    for (const value of [{ repKey: 'Rep One' }, { repKey: '' }, { recordKind: 'pending' }, { view: 'sales-credit' }]) {
      expect(() => historicalRequestsQuery({ operation: 'folders', ...value })).toThrow();
    }
  });
  it('validates calendar dates, preserves inclusive range filters and rejects rolled-over or reversed dates', () => {
    expect(historicalRequestsQuery({ operation: 'months', dateFrom: '2024-02-29', dateTo: '2024-03-01' }))
      .toEqual({ operation: 'months', dateFrom: '2024-02-29', dateTo: '2024-03-01' });
    for (const value of [{ dateFrom: '2026-02-29' }, { dateTo: '2026-13-01' }, { dateFrom: '2026-1-01' }, { dateFrom: '2026-10-02', dateTo: '2026-10-01' }]) {
      expect(() => historicalRequestsQuery({ operation: 'months', ...value })).toThrow(/date/);
    }
  });
  it('requires redacted monetary fields for own scope and rejects forged scope/capability combinations', () => {
    const own = { ...customerPage, scope: 'own', financials: false,
      rows: customerPage.rows.map(row => ({ ...row, totalValue: null, unpricedCount: null })),
      summary: { requestCount: 3, totalValue: null, unpricedCount: null } };
    expect(parseHistoricalRequestsPage(own)).toEqual(own);
    expect(() => parseHistoricalRequestsPage({ ...own, summary: customerPage.summary })).toThrow(/not authorized/);
    expect(() => parseHistoricalRequestsPage({ ...own, rows: customerPage.rows })).toThrow(/not authorized/);
    expect(() => parseHistoricalRequestsPage({ ...own, financials: true })).toThrow(/financial scope/);
    expect(() => parseHistoricalRequestsPage({ ...customerPage, financials: false })).toThrow(/financial scope/);
    expect(() => parseHistoricalRequestsPage({ ...own, rows: [{ ...requestRow, listPrice: 4, totalValue: 100, unresolvedReason: null }] })).toThrow(/not authorized/);
  });
  it('sanitizes operations and bounded pagination into the fixed RPC query shape', () => {
    const signal = new AbortController().signal;
    expect(historicalRequestsQuery({ operation: 'requests', customerKey: 'c', consigneeKey: 'g', page: 2, pageSize: 50, signal, actorId: 'forged' }))
      .toEqual({ operation: 'requests', customerKey: 'c', consigneeKey: 'g', page: 2, pageSize: 50 });
    expect(() => historicalRequestsQuery({ operation: 'anything' })).toThrow(/operation/);
    expect(() => historicalRequestsQuery({ operation: ['customers'] })).toThrow(/operation/);
    expect(() => historicalRequestsQuery({ operation: 'customers', page: -1 })).toThrow(/page/);
    expect(() => historicalRequestsQuery({ operation: 'customers', pageSize: 101 })).toThrow(/page size/);
    expect(() => historicalRequestsQuery({ operation: 'requests', customerKey: 'c' })).toThrow(/consignee/);
  });

  it('sanitizes archive paths and parses signed historical records without leaking financials', () => {
    expect(historicalArchiveQuery({ ...archiveQuery, page: 0, pageSize: 25, actorId: 'forged' })).toEqual({ ...archiveQuery, page: 0, pageSize: 25 });
    expect(parseHistoricalArchivePage(archivePage, archiveQuery).rows[0]).toMatchObject({ quantity: -2, lineDollarValue: -25 });
    const ownPage = { ...archivePage, scope: 'own', financials: false,
      rows: archivePage.rows.map(row => ({ ...row, unitListPrice: null, lineDollarValue: null })) };
    expect(parseHistoricalArchivePage(ownPage, archiveQuery).financials).toBe(false);
    expect(() => parseHistoricalArchivePage({ ...ownPage, rows: archivePage.rows }, archiveQuery)).toThrow(/not authorized/);
    expect(() => historicalArchiveQuery({ operation: 'archive-records', recordKind: 'requests', path: [] })).toThrow(/protected Request/);
    expect(() => historicalArchiveQuery({ operation: 'archive-search', recordKind: 'drive', query: 'x' })).toThrow(/two search/);
  });

  it('parses server scope, hierarchy values, revision and unresolved prices without trusting loose JSON', () => {
    expect(parseHistoricalRequestsPage(customerPage)).toEqual(customerPage);
    const parsed = parseHistoricalRequestsPage({ ...customerPage, rows: [requestRow], total: 1 });
    expect(parsed.rows[0]).toMatchObject({ itemcode: '00123', requestQty: 0, effectiveQty: 25, totalValue: null, unresolvedReason: expect.stringContaining('unavailable') });
    expect(() => parseHistoricalRequestsPage({ ...customerPage, scope: 'global' })).toThrow(/scope/);
    expect(() => parseHistoricalRequestsPage({ ...customerPage, rows: 'not-an-array' })).toThrow(/page rows/);
    expect(() => parseHistoricalRequestsPage({ ...customerPage, rows: [{ ...requestRow, totalValue: null, unresolvedReason: null }] })).toThrow(/explain/);
    expect(() => parseHistoricalRequestsPage({ ...customerPage, summary: { ...customerPage.summary, totalValue: '1875' } })).toThrow(/summary value/);
  });

  it('retains external IDs for duplicate names and rejects malformed own identities', () => {
    const rows = [customerPage.rows[0], { ...customerPage.rows[0], key: 'cust:1', customerKey: 'cust:1', customerId: '1' }];
    const page = parseHistoricalRequestsPage({ ...customerPage, rows, total: 2 });
    expect(page.rows).toMatchObject([{ label: 'North Nursery', customerId: '0001' }, { label: 'North Nursery', customerId: '1' }]);
    expect(() => parseHistoricalRequestsPage({ ...customerPage, ownRepKey: 'rep:' + '-'.repeat(36) })).toThrow(/own rep key/);
  });

  it('forwards only sanitized queries and abort signals; scope is separated by bridge key', async () => {
    const transport = vi.fn().mockResolvedValue(customerPage);
    const bridge = createHistoricalRequestsBridge({ scopeKey: 'profile-a:admin:all', role: 'Admin', revisionKey: 'r7', transport });
    const signal = new AbortController().signal;
    await bridge.read({ operation: 'customers', page: 0, pageSize: 25, actorId: 'forged' } as never, signal);
    expect(transport).toHaveBeenCalledWith({ operation: 'customers', page: 0, pageSize: 25 }, signal);
    const own = createHistoricalRequestsBridge({ scopeKey: 'profile-a:rep:own', role: 'Sales Rep', revisionKey: 'r7', transport });
    expect(own.scopeKey).not.toBe(bridge.scopeKey);
  });

  it('forwards archive queries through the same protected transport boundary', async () => {
    const transport = vi.fn().mockResolvedValue(archivePage);
    const bridge = createHistoricalRequestsBridge({ scopeKey: 'profile-a:admin:all', role: 'Admin', revisionKey: 'r7', transport });
    const signal = new AbortController().signal;
    await bridge.readArchive({ ...archiveQuery, actorId: 'forged' } as never, signal);
    expect(transport).toHaveBeenCalledWith(archiveQuery, signal);
  });

  it('rejects RPC failures and malformed envelopes instead of rendering cached financial data', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('HISTORY_FORBIDDEN'))
      .mockResolvedValueOnce({ ...customerPage, rows: 'not-an-array' });
    const bridge = createHistoricalRequestsBridge({ scopeKey: 'actor-own', role: 'Sales Rep', revisionKey: 'r1', transport });
    await expect(bridge.read({ operation: 'customers' })).rejects.toThrow('HISTORY_FORBIDDEN');
    await expect(bridge.read({ operation: 'customers' })).rejects.toThrow(/page rows/);
  });

  it('explains authorization and import-in-progress failures without presenting an empty result', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('HISTORICAL_REQUESTS_FORBIDDEN'))
      .mockRejectedValueOnce(new Error('HISTORICAL_REQUESTS_SOURCE_REFRESH_REQUIRED'));
    const bridge = createHistoricalRequestsBridge({ scopeKey: 'actor-own', role: 'Sales Rep', revisionKey: 'r1', transport });
    await expect(bridge.read({ operation: 'customers' })).rejects.toThrow(/not available to this account/);
    await expect(bridge.read({ operation: 'customers' })).rejects.toThrow(/data is updating/);
  });

  it('redacts server-supplied financial fields for Eval and unknown roles before returning data to the cache', async () => {
    const transport = vi.fn().mockImplementation(async (query: { operation: string }) => query.operation === 'requests'
      ? { ...customerPage, rows: [{ ...requestRow, listPrice: 75, totalValue: 1875, unresolvedReason: null }], total: 1 }
      : { ...customerPage, rows: [{ ...customerPage.rows[0], totalValue: 1875, unpricedCount: 1 }] });
    const evalBridge = createHistoricalRequestsBridge({ scopeKey: 'eval-scope', role: 'Eval', revisionKey: 'r7', transport });
    const page = await evalBridge.read({ operation: 'customers' });
    expect(page.financials).toBe(false);
    expect(page.summary).toEqual({ requestCount: 3, totalValue: null, unpricedCount: null });
    expect(page.rows[0]).toMatchObject({ totalValue: null, unpricedCount: null });
    const requestPage = await evalBridge.read({ operation: 'requests', customerKey: 'cust:0001', consigneeKey: 'consignee:east' });
    expect(requestPage.rows[0]).toMatchObject({ requestQty: 0, totalValue: null, listPrice: null, unresolvedReason: null });

    const unknown = createHistoricalRequestsBridge({ scopeKey: 'unknown-scope', role: 'Auditor', revisionKey: 'r7', transport });
    expect((await unknown.read({ operation: 'customers' })).financials).toBe(false);
    expect(() => createHistoricalRequestsBridge({ scopeKey: 'missing-role', role: '', revisionKey: 'r7', transport })).toThrow(/signed-in/);
  });

  it('preserves all financial fields for explicit Admin, Administrator, and Super Admin roles', async () => {
    const transport = vi.fn().mockResolvedValue({ ...customerPage, rows: [{ ...customerPage.rows[0], totalValue: 1875, unpricedCount: 1 }] });
    for (const role of ['Admin', 'Administrator', 'Super Admin']) {
      const bridge = createHistoricalRequestsBridge({ scopeKey: `profile:${role}`, role, revisionKey: 'r7', transport });
      const page = await bridge.read({ operation: 'customers' });
      expect(bridge.role).toBe(role);
      expect(page.financials).toBe(true);
      expect(page.rows[0]).toMatchObject({ totalValue: 1875, unpricedCount: 1 });
    }
  });
});
