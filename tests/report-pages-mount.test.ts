// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearReportSessions, createReportSession, mountReportRows } from '../services/reportPages';
import type { ReportPageQuery } from '../components/report-pages/contract';
import { mountAssignedItems } from '../components/assigned-items/AssignedItems.jsx';

const query: ReportPageQuery = { surface: 'eval2', operation: 'rows', filters: { itemCode: 'A1' }, offset: 0, limit: 100 };
const hosts: HTMLElement[] = [];
function makeHost() {
  const scroll = document.createElement('div'), host = document.createElement('div');
  Object.defineProperty(scroll, 'clientHeight', { value: 800 });
  scroll.append(host); document.body.append(scroll); hosts.push(scroll); return { host, scroll };
}
afterEach(() => { hosts.splice(0).forEach(host => host.remove()); clearReportSessions(); });

describe('report page virtual mount', () => {
  it('paints cached rows before revalidation and does not refetch on same-query updates', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let finish!: (value: unknown) => void;
    const transport = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const session = createReportSession({ scopeKey: 'mount-account', permissionVersion: 'p1', transport });
    // Seed the previous visit's page with a completed read.
    const cachedSession = createReportSession({ scopeKey: 'mount-account', permissionVersion: 'p1', transport: async () => ({ rows: [{ id: 'r1', name: 'saved row' }], total: 1, hasMore: false, sourceRevision: 'old' }) });
    await cachedSession.read(query);
    const { host, scroll } = makeHost(), onState = vi.fn();
    let mount!: ReturnType<typeof mountReportRows>;
    await act(async () => {
      mount = mountReportRows(host, { session, query, getScrollElement: () => scroll,
        renderRow: row => `<article>${(row as { name: string }).name}</article>`, onState });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain('saved row');
    expect(transport).toHaveBeenCalledTimes(1);
    await act(async () => mount.update({ onState: vi.fn() }));
    expect(transport).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ rows: [{ id: 'r1', name: 'fresh row' }], total: 1, hasMore: false, sourceRevision: 'new' }); await Promise.resolve(); });
    expect(host.textContent).toContain('fresh row');
    await act(async () => mount.destroy());
  });

  it('aborts protected reads when a session is cleared', async () => {
    let seenSignal: AbortSignal | undefined;
    const session = createReportSession({ scopeKey: 'abort-account', permissionVersion: 'p1', transport: (_query, signal) => {
      seenSignal = signal;
      return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
    } });
    const read = session.refresh(query).catch(() => undefined);
    await Promise.resolve();
    session.clear();
    expect(seenSignal?.aborted).toBe(true);
    await read;
  });

  it('preserves cached rows when revalidation fails and exposes the error', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const seed = createReportSession({ scopeKey: 'stale-error-account', permissionVersion: 'p1', transport: async () => ({
      rows: [{ id:'cached', name:'Cached row' }], total:1, hasMore:false, sourceRevision:'r1'
    }) });
    await seed.read(query);
    const session = createReportSession({ scopeKey: 'stale-error-account', permissionVersion: 'p1', transport: async () => { throw new Error('Refresh unavailable'); } });
    const { host, scroll } = makeHost(), onState = vi.fn();
    let mount!: ReturnType<typeof mountReportRows>;
    await act(async () => {
      mount = mountReportRows(host, { session, query, getScrollElement:() => scroll, renderRow:row => `<article>${(row as { name:string }).name}</article>`, onState });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain('Cached row');
    expect(host.textContent).toContain('Refresh unavailable');
    expect(onState.mock.calls.some(([state]) => state.error?.message === 'Refresh unavailable')).toBe(true);
    await act(async () => mount.destroy());
  });

  it('renders the supplied empty state only after a verified empty page', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const session = createReportSession({ scopeKey:'empty-account', permissionVersion:'p1', transport:async () => ({
      rows:[], total:0, hasMore:false, sourceRevision:'empty-r1'
    }) });
    const { host, scroll } = makeHost();
    let mount!: ReturnType<typeof mountReportRows>;
    await act(async () => {
      mount = mountReportRows(host, { session, query, getScrollElement:() => scroll, emptyHtml:'<p>No results match.</p>', renderRow:() => '<article />' });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain('No results match.');
    await act(async () => mount.destroy());
  });

  it('renders virtualized table rows as real tbody rows and notifies after page replacement', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const session = createReportSession({ scopeKey: 'table-account', permissionVersion: 'p1', transport: async () => ({
      rows: [{ id: 'r1', commonname: 'Table row' }], total: 1, hasMore: false, sourceRevision: 'r1'
    }) });
    const { host, scroll } = makeHost(), onRendered = vi.fn();
    let mount!: ReturnType<typeof mountReportRows>;
    await act(async () => {
      mount = mountReportRows(host, { session, query, layout: 'table', tableHeaderHtml: '<tr><th>Name</th></tr>', tableColSpan: 1,
        getScrollElement: () => scroll, renderRow: () => '<tr data-source-row="true"><td>Table row</td></tr>', onRendered });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(host.querySelector('.drive-grid-table tbody tr[data-source-row="true"]')).not.toBeNull();
    expect(host.querySelector('.drive-grid-table tbody div')).toBeNull();
    expect(onRendered.mock.calls.length).toBeGreaterThan(1);
    await act(async () => mount.destroy());
  });

  it('keeps responsive report cards in measured grid bands', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const session = createReportSession({ scopeKey: 'grid-account', permissionVersion: 'p1', transport: async () => ({
      rows: [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }], total: 3, hasMore: false, sourceRevision: 'g1'
    }) });
    const { host, scroll } = makeHost();
    host.style.display = 'grid'; host.style.gridTemplateColumns = '1fr 1fr'; host.style.columnGap = '16px';
    let mount!: ReturnType<typeof mountReportRows>;
    await act(async () => {
      mount = mountReportRows(host, { session, query, pageSize: 25, layout: 'grid', getScrollElement: () => scroll,
        renderRow: row => `<article>${(row as { id: string }).id}</article>` });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const root = host.querySelector('[data-report-rows]') as HTMLElement;
    expect(root.style.gridColumn).toBe('1 / -1');
    const band = root.querySelector('[data-index] > div[data-report-row]')?.parentElement as HTMLElement | null;
    expect(band?.style.display).toBe('grid');
    expect(band?.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    expect(host.textContent).toContain('g1');
    await act(async () => mount.destroy());
  });

  it('restarts the active range from page zero after a source revision conflict', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let firstPageReads = 0;
    const transport = vi.fn(async () => {
      firstPageReads += 1;
      if (firstPageReads === 1) throw Object.assign(new Error('source changed'), { code: 'MANAGER_REPORT_SOURCE_REVISION_CHANGED' });
      return { rows: [{ id:'row-rev-2-0', name:'Page zero rev-2' }], total:1, hasMore:false, sourceRevision:'rev-2' };
    });
    const session = createReportSession({ scopeKey: 'revision-account', permissionVersion: 'p1', transport });
    const { host, scroll } = makeHost();
    let mount!: ReturnType<typeof mountReportRows>;
    await act(async () => {
      mount = mountReportRows(host, { session, query, pageSize:100, getScrollElement:() => scroll,
        renderRow: row => `<article>${(row as { name:string }).name}</article>` });
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(firstPageReads).toBeGreaterThanOrEqual(2);
    expect(firstPageReads).toBeLessThanOrEqual(3);
    expect(host.textContent).toContain('Page zero rev-2');
    await act(async () => mount.destroy());
  });

  it('restarts a mismatched visible page at page zero and reloads it at the new revision', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let pageZeroReads = 0;
    const transport = vi.fn(async (request: ReportPageQuery) => {
      if (request.offset === 0) {
        pageZeroReads += 1;
        return { rows: [{ id: `zero-${pageZeroReads}` }], total: 2, hasMore: true, sourceRevision: pageZeroReads === 1 ? 'old-rev' : 'new-rev' };
      }
      return { rows: [{ id: request.sourceRevision === 'new-rev' ? 'new-page-one' : 'old-page-one' }], total: 2, hasMore: false,
        sourceRevision: request.sourceRevision === 'old-rev' ? 'new-rev' : 'new-rev' };
    });
    const session = createReportSession({ scopeKey: 'range-revision-account', permissionVersion: 'p1', transport });
    const { host, scroll } = makeHost();
    scroll.getBoundingClientRect = () => ({ x:0, y:0, top:0, left:0, right:800, bottom:800, width:800, height:800, toJSON(){} });
    let mount!: ReturnType<typeof mountReportRows>;
    await act(async () => {
      mount = mountReportRows(host, { session, query, pageSize: 1, estimateSize: 100, getScrollElement: () => scroll,
        renderRow: row => `<article>${(row as { id: string }).id}</article>` });
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
      scroll.scrollTop = 1000;
      scroll.dispatchEvent(new Event('scroll'));
      await new Promise(resolve => setTimeout(resolve, 20));
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(pageZeroReads, JSON.stringify(transport.mock.calls.map(([request]) => request))).toBeGreaterThanOrEqual(2);
    expect(transport.mock.calls.some(([request]) => request.offset === 1 && request.sourceRevision === 'new-rev')).toBe(true);
    expect(host.textContent).toContain('new-page-one');
    await act(async () => mount.destroy());
  });

  it('keeps Assigned Items interactive renderers while loading bounded virtual pages', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const transport = vi.fn(async () => ({
      rows: [{ UNIQUE_ID: 'row-1', MASTER_UNIQUE_ID: 'row-1', ITEMCODE: 'A1', COMMONNAME: 'Paged orchid', CONTSIZE: '1 gal', ASSIGNEDTO: 'alex' }],
      total: 1, hasMore: false, sourceRevision: 'r1'
    }));
    const session = createReportSession({ scopeKey: 'assigned-account', permissionVersion: 'p1', transport });
    const { host, scroll } = makeHost();
    const pageStates: Array<{ rows: unknown[]; offset: number; state: { error?: unknown; isLoading?: boolean; isValidating?: boolean } }> = [];
    let mount!: ReturnType<typeof mountAssignedItems>;
    await act(async () => {
      mount = mountAssignedItems(host, { rows: [], totalRows: 1, scrollElement: scroll, columns: [['ASSIGNEDTO', 'Effective Worker'], ['COMMONNAME', 'Common Name'], ['ITEMCODE', 'Item Code']],
        canManageAssignments: false, snapshotCurrent: true, options: [], ownerDrafts: {}, selectedCodes: new Set(), pendingCodes: new Set(), lowStock: {},
        pageSource: { session, query, pageSize: 100, onPageState: (page, offset, state) => pageStates.push({ rows: page?.rows || [], offset, state }) } });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Paged orchid');
    expect(host.textContent).toContain('alex');
    expect(pageStates.some(({ rows, offset, state }) => offset === 0 && rows.length === 1 && 'isValidating' in state)).toBe(true);
    await act(async () => mount.destroy());
  });

  it('keeps nested rows on the parent revision and requests a parent refresh on conflict', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const pinnedQuery = { ...query, sourceRevision:'parent-r1' };
    const seed=createReportSession({scopeKey:'nested-account',permissionVersion:'p1',transport:async () => ({
      rows:[{id:'old',name:'Parent r1 row'}],total:1,hasMore:false,sourceRevision:'parent-r1'
    })});
    await seed.read(pinnedQuery);
    const transport=vi.fn(async (_request:ReportPageQuery) => ({rows:[{id:'new',name:'Wrong parent row'}],total:1,hasMore:false,sourceRevision:'parent-r2'}));
    const session=createReportSession({scopeKey:'nested-account',permissionVersion:'p1',transport});
    const {host,scroll}=makeHost(), onRevisionChanged=vi.fn(), onRendered=vi.fn();
    let mount!:ReturnType<typeof mountReportRows>;
    await act(async () => {
      mount=mountReportRows(host,{session,query:pinnedQuery,parentPinnedRevision:'parent-r1',onRevisionChanged,onRendered,
        getScrollElement:() => scroll,renderRow:row => `<article>${(row as {name:string}).name}</article>`});
      await new Promise(resolve => setTimeout(resolve,0));
    });
    expect(transport.mock.calls[0][0].sourceRevision).toBe('parent-r1');
    expect(onRevisionChanged).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Parent r1 row');
    expect(host.textContent).not.toContain('Wrong parent row');
    expect(onRendered.mock.calls.some(([,page]) => page.sourceRevision==='parent-r1')).toBe(true);
    await act(async () => mount.destroy());
  });
});
