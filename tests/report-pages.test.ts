import { describe, expect, it, vi } from 'vitest';
import { clearReportSessions, createReportSession } from '../services/reportPages';
import type { ReportPageQuery } from '../components/report-pages/contract';

const query = (filters: Record<string, unknown> = {}, offset = 0): ReportPageQuery => ({
  surface: 'eval2', operation: 'groups', filters, offset, limit: 25
});

describe('report page sessions', () => {
  it('shares memory pages only within the same permission scope and keeps query dimensions in keys', async () => {
    clearReportSessions();
    const transport = vi.fn(async (value: ReportPageQuery) => ({ rows: [{ filter: value.filters.assignee }], total: 1, hasMore: false, sourceRevision: 'r1' }));
    const first = createReportSession({ scopeKey: 'account-a', permissionVersion: 'p1', transport });
    const revisit = createReportSession({ scopeKey: 'account-a', permissionVersion: 'p1', transport });
    const otherUser = createReportSession({ scopeKey: 'account-b', permissionVersion: 'p1', transport });
    expect(revisit.swrCache).toBe(first.swrCache);
    expect(otherUser.swrCache).not.toBe(first.swrCache);
    const original = await first.read(query({ assignee: 'alex' }));
    expect(revisit.peek(query({ assignee: 'alex' }))).toEqual(original);
    expect(first.key(query({ assignee: 'alex' }))).not.toBe(first.key(query({ assignee: 'sam' })));
    expect(otherUser.peek(query({ assignee: 'alex' }))).toBeUndefined();
    first.swrCache.set('swr-key', {});
    first.clear();
    expect(revisit.swrCache.size).toBe(0);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('revalidates stale pages and rejects unbounded or oversized page requests', async () => {
    clearReportSessions();
    const transport = vi.fn(async () => ({ rows: [], total: 0, hasMore: false, sourceRevision: 'r2' }));
    const session = createReportSession({ scopeKey: 'account-a', permissionVersion: 'p1', transport });
    await session.read(query());
    await session.refresh(query());
    expect(transport).toHaveBeenCalledTimes(2);
    expect(() => session.read({ ...query(), limit: 101 })).toThrow('between 1 and 100');
    expect(() => session.read({ ...query(), limit: 26 })).toThrow('must not exceed 25');
  });

  it('caps transport concurrency at two requests', async () => {
    clearReportSessions();
    let active = 0, maximum = 0;
    const transport = vi.fn(async (value: ReportPageQuery) => {
      active += 1; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, value.offset === 0 ? 10 : 0));
      active -= 1;
      return { rows: [{ offset: value.offset }], total: 100, hasMore: true, sourceRevision: 'r3' };
    });
    const session = createReportSession({ scopeKey: 'account-a', permissionVersion: 'p1', transport });
    await Promise.all([0, 25, 50, 75].map(offset => session.read(query({}, offset))));
    expect(maximum).toBe(2);
  });

  it('rejects queued reads immediately when their session is cleared', async () => {
    clearReportSessions();
    let started = 0;
    const session = createReportSession({ scopeKey: 'queue-clear', permissionVersion: 'p1', transport: async () => {
      started += 1;
      return new Promise(() => {});
    } });
    const pending = [0, 25, 50].map(offset => session.refresh(query({}, offset)).catch(error => error));
    await Promise.resolve();
    session.clear();
    const settled = await Promise.all(pending);
    expect(started).toBe(2);
    expect(settled.every(error => error?.name === 'AbortError')).toBe(true);
  });

  it('invalidates all inventory pages and rejects responses started before invalidation', async () => {
    clearReportSessions();
    let finish!: (value: unknown) => void;
    let call = 0;
    const session = createReportSession({ scopeKey: 'inventory-refresh', permissionVersion: 'p1', transport: async () => {
      call += 1;
      if (call === 1) return await new Promise(resolve => { finish = resolve; });
      return { rows: [{ fresh: true }], total: 1, hasMore: false, sourceRevision: 'r2' };
    } });
    const stale = session.refresh(query()).catch(error => error);
    await Promise.resolve();
    session.swrCache.set('swr', {});
    session.invalidateInventory();
    finish({ rows: [{ stale: true }], total: 1, hasMore: false, sourceRevision: 'r1' });
    expect((await stale).name).toBe('AbortError');
    expect(session.peek(query())).toBeUndefined();
    expect(session.swrCache.size).toBe(0);
    await expect(session.read(query())).resolves.toMatchObject({ rows: [{ fresh: true }], sourceRevision: 'r2' });
  });
});
