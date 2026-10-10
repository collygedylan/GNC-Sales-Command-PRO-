import { describe, expect, it, vi } from 'vitest';
import { createHistoricalRequestsBridge, historicalRequestsQuery, parseHistoricalRequestsPage } from '../services/historicalRequests';

const customerPage = {
  scope: 'all', revision: 'history-r7', generatedAt: '2026-10-10T12:00:00Z', page: 0, pageSize: 25, total: 1,
  rows: [{ key: 'cust:0001', label: 'North Nursery', requestCount: 3, totalValue: 1875, unpricedCount: 1 }],
  summary: { requestCount: 3, totalValue: 1875, unpricedCount: 1 },
};
const requestRow = {
  id: 'request-001', customerName: 'North Nursery', consigneeName: 'East Yard', salesrepUserId: null, salesrepName: 'Molly Dixon',
  itemcode: '00123', commonname: 'Red Maple ®', location: 'A.01', requestedAt: null, status: 'Completed', requestQty: 0,
  effectiveQty: 25, listPrice: null, totalValue: null, unresolvedReason: 'Current master list price is unavailable.',
};

describe('historical requests typed API boundary', () => {
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

  it('parses server scope, hierarchy values, revision and unresolved prices without trusting loose JSON', () => {
    expect(parseHistoricalRequestsPage(customerPage)).toEqual(customerPage);
    const parsed = parseHistoricalRequestsPage({ ...customerPage, rows: [requestRow], total: 1 });
    expect(parsed.rows[0]).toMatchObject({ itemcode: '00123', requestQty: 0, effectiveQty: 25, totalValue: null, unresolvedReason: expect.stringContaining('unavailable') });
    expect(() => parseHistoricalRequestsPage({ ...customerPage, scope: 'global' })).toThrow(/scope/);
    expect(() => parseHistoricalRequestsPage({ ...customerPage, rows: 'not-an-array' })).toThrow(/page rows/);
    expect(() => parseHistoricalRequestsPage({ ...customerPage, rows: [{ ...requestRow, totalValue: null, unresolvedReason: null }] })).toThrow(/explain/);
    expect(() => parseHistoricalRequestsPage({ ...customerPage, summary: { ...customerPage.summary, totalValue: '1875' } })).toThrow(/summary value/);
  });

  it('forwards only sanitized queries and abort signals; scope is separated by bridge key', async () => {
    const transport = vi.fn().mockResolvedValue(customerPage);
    const bridge = createHistoricalRequestsBridge({ scopeKey: 'profile-a:admin:all', revisionKey: 'r7', transport });
    const signal = new AbortController().signal;
    await bridge.read({ operation: 'customers', page: 0, pageSize: 25, actorId: 'forged' } as never, signal);
    expect(transport).toHaveBeenCalledWith({ operation: 'customers', page: 0, pageSize: 25 }, signal);
    const own = createHistoricalRequestsBridge({ scopeKey: 'profile-a:rep:own', revisionKey: 'r7', transport });
    expect(own.scopeKey).not.toBe(bridge.scopeKey);
  });

  it('rejects RPC failures and malformed envelopes instead of rendering cached financial data', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('HISTORY_FORBIDDEN'))
      .mockResolvedValueOnce({ ...customerPage, rows: 'not-an-array' });
    const bridge = createHistoricalRequestsBridge({ scopeKey: 'actor-own', revisionKey: 'r1', transport });
    await expect(bridge.read({ operation: 'customers' })).rejects.toThrow('HISTORY_FORBIDDEN');
    await expect(bridge.read({ operation: 'customers' })).rejects.toThrow(/page rows/);
  });

  it('explains authorization and import-in-progress failures without presenting an empty result', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('HISTORICAL_REQUESTS_FORBIDDEN'))
      .mockRejectedValueOnce(new Error('HISTORICAL_REQUESTS_SOURCE_REFRESH_REQUIRED'));
    const bridge = createHistoricalRequestsBridge({ scopeKey: 'actor-own', revisionKey: 'r1', transport });
    await expect(bridge.read({ operation: 'customers' })).rejects.toThrow(/not available to this account/);
    await expect(bridge.read({ operation: 'customers' })).rejects.toThrow(/data is updating/);
  });
});
