import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { SWRConfig, type Cache, type State } from 'swr';
import type {
  HistoricalRequestGroup,
  HistoricalRequestRow,
  HistoricalRequestsBridge,
  HistoricalRequestsPage,
  HistoricalRequestsQuery,
} from './contract';

const PAGE_SIZE = 25;
type Level = 'customers' | 'consignees' | 'requests';
type PageResult = { data?: HistoricalRequestsPage; error?: Error; isLoading: boolean; retry(): void };

function keyFor(bridge: HistoricalRequestsBridge, query: HistoricalRequestsQuery) {
  return JSON.stringify([bridge.scopeKey, bridge.revisionKey, query.operation, query.customerKey || '', query.consigneeKey || '', query.page || 0, query.pageSize || PAGE_SIZE]);
}

function usePage(bridge: HistoricalRequestsBridge, query: HistoricalRequestsQuery | null): PageResult {
  const controllers = useRef(new Map<string, AbortController>());
  const key = query ? keyFor(bridge, query) : null;
  const result = useSWR<HistoricalRequestsPage>(key, async () => {
    if (!query) throw new Error('Historical requests query is unavailable.');
    const controller = new AbortController();
    if (key) {
      controllers.current.get(key)?.abort();
      controllers.current.set(key, controller);
    }
    try {
      return await bridge.read(query, controller.signal);
    } finally {
      if (key && controllers.current.get(key) === controller) controllers.current.delete(key);
    }
  }, { keepPreviousData: false, revalidateOnFocus: true, revalidateOnReconnect: true, revalidateIfStale: true, refreshInterval: 30_000, dedupingInterval: 2_000 });

  useEffect(() => () => {
    if (!key) return;
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
  }, [key]);
  useEffect(() => () => {
    controllers.current.forEach(controller => controller.abort());
    controllers.current.clear();
  }, []);
  return { data: result.data, error: result.error, isLoading: result.isLoading, retry: () => { void result.mutate(); } };
}

function isGroup(row: HistoricalRequestGroup | HistoricalRequestRow): row is HistoricalRequestGroup {
  return 'requestCount' in row;
}

function currency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

function unresolvedValueMessage(reason: string | null) {
  switch (reason) {
    case 'invalid_request_quantity': return 'Request quantity is invalid; value cannot be calculated.';
    case 'current_master_row_unavailable': return 'Current inventory details are unavailable; value cannot be calculated.';
    case 'current_list_price_unavailable_or_invalid': return 'Current master list price is unavailable or invalid.';
    default: return 'Current request value could not be resolved.';
  }
}

function PageStatus({ state, empty, onRetry }: { state: PageResult; empty: string; onRetry(): void }) {
  if (state.isLoading && !state.data) return <div className="historical-requests__state" role="status">Loading historical requests…</div>;
  if (state.error) return <div className="historical-requests__state historical-requests__state--error" role="alert">
    <span>{state.error.message || 'Historical requests could not be loaded.'}</span>
    <button type="button" onClick={onRetry}>Retry</button>
  </div>;
  if (!state.data?.rows.length) return <div className="historical-requests__state" role="status">{empty}</div>;
  return null;
}

function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage(page: number): void }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return <nav className="historical-requests__pager" aria-label="Historical requests pages">
    <button type="button" disabled={page <= 0} onClick={() => onPage(page - 1)}>Previous</button>
    <span>Page {page + 1} of {pageCount} · {total.toLocaleString()} total</span>
    <button type="button" disabled={page + 1 >= pageCount} onClick={() => onPage(page + 1)}>Next</button>
  </nav>;
}

function SummaryCards({ page }: { page: HistoricalRequestsPage }) {
  return <section className="historical-requests__summary" aria-label="Historical request totals">
    <div><span>Requests</span><strong>{page.summary.requestCount.toLocaleString()}</strong></div>
    <div><span>Priced value</span><strong>{currency(page.summary.totalValue)}</strong></div>
    <div><span>Unresolved prices</span><strong>{page.summary.unpricedCount.toLocaleString()}</strong></div>
  </section>;
}

function HistoricalRequestsApp({ bridge }: { bridge: HistoricalRequestsBridge }) {
  const [level, setLevel] = useState<Level>('customers');
  const [customer, setCustomer] = useState<HistoricalRequestGroup | null>(null);
  const [consignee, setConsignee] = useState<HistoricalRequestGroup | null>(null);
  const [establishedScope, setEstablishedScope] = useState<HistoricalRequestsPage['scope'] | null>(null);
  const [customerPage, setCustomerPage] = useState(0);
  const [detailPage, setDetailPage] = useState(0);
  const [repPage, setRepPage] = useState(0);
  const customers = usePage(bridge, level === 'customers' ? { operation: 'customers', page: customerPage, pageSize: PAGE_SIZE } : null);
  const currentCustomerScope = level === 'customers' && customers.data && !customers.error
    ? customers.data.scope
    : establishedScope;
  useEffect(() => {
    if (level === 'customers' && customers.data && !customers.error) setEstablishedScope(customers.data.scope);
  }, [level, customers.data?.scope, customers.error]);
  const showDashboard = currentCustomerScope === 'all';
  // Keep the all-scope authorization probe alive while drilling into customer
  // details. Its scope can change after the customer page has been cached.
  const reps = usePage(bridge, showDashboard ? { operation: 'reps', page: repPage, pageSize: PAGE_SIZE } : null);
  const consignees = usePage(bridge, level === 'consignees' && customer ? {
    operation: 'consignees', customerKey: customer.key, page: detailPage, pageSize: PAGE_SIZE,
  } : null);
  const requests = usePage(bridge, level === 'requests' && customer && consignee ? {
    operation: 'requests', customerKey: customer.key, consigneeKey: consignee.key, page: detailPage, pageSize: PAGE_SIZE,
  } : null);
  const current = level === 'customers' ? customers : level === 'consignees' ? consignees : requests;
  const currentScopeMismatch = Boolean(current.data && currentCustomerScope && current.data.scope !== currentCustomerScope);
  const repsScopeMismatch = showDashboard && !!reps.data && reps.data.scope !== 'all';
  const allScopeProbeFailed = showDashboard && (Boolean(reps.error) || repsScopeMismatch);
  const scopeGuardFailed = allScopeProbeFailed || currentScopeMismatch;
  const currentCanDisplay = !current.error && !scopeGuardFailed
    && (!currentCustomerScope || current.data?.scope === currentCustomerScope);
  const currentRows = currentCanDisplay ? current.data?.rows || [] : [];
  const groups = currentRows.filter(isGroup);
  const requestRows = currentRows.filter((row): row is HistoricalRequestRow => !isGroup(row));
  const dashboardReady = showDashboard && reps.data?.scope === 'all';
  const displayedSummary = level === 'customers' && !customers.error && showDashboard && !scopeGuardFailed ? customers.data : null;
  const displayedReps = !reps.error && reps.data?.scope === 'all' ? reps.data : null;
  const currentTotal = currentCanDisplay ? current.data?.total.toLocaleString() : undefined;

  const recoverScope = () => {
    if (level !== 'customers') {
      setLevel('customers');
      setCustomer(null);
      setConsignee(null);
      setDetailPage(0);
    }
    customers.retry();
    if (showDashboard) reps.retry();
  };

  const goBack = () => {
    if (level === 'requests') { setLevel('consignees'); setConsignee(null); setDetailPage(0); }
    else if (level === 'consignees') { setLevel('customers'); setCustomer(null); setDetailPage(0); }
  };
  const selectCustomer = (group: HistoricalRequestGroup) => {
    if (customers.data) setEstablishedScope(customers.data.scope);
    setCustomer(group); setConsignee(null); setLevel('consignees'); setDetailPage(0);
  };
  const selectConsignee = (group: HistoricalRequestGroup) => { setConsignee(group); setLevel('requests'); setDetailPage(0); };

  return <main className="historical-requests" aria-labelledby="historical-requests-title">
    <header className="historical-requests__header">
      <div>
        <p className="historical-requests__eyebrow">Sales workspace</p>
        <h1 id="historical-requests-title">Historical Requests</h1>
        <p className="historical-requests__description">Browse customer requests and their recorded status.</p>
      </div>
      {level !== 'customers' && <button className="historical-requests__back" type="button" onClick={goBack}>Back</button>}
    </header>

    {scopeGuardFailed && <div className="historical-requests__state historical-requests__state--error" role="alert">
      {level === 'customers' ? 'Dashboard scope could not be confirmed.' : 'Data scope could not be confirmed.'}
      <button type="button" onClick={recoverScope}>{level === 'customers' ? 'Refresh dashboard' : 'Return to customers and refresh'}</button>
    </div>}
    {level === 'customers' && showDashboard && !allScopeProbeFailed && !dashboardReady && <div className="historical-requests__state" role="status">Loading dashboard…</div>}
    {level === 'customers' && displayedSummary && <SummaryCards page={displayedSummary} />}
    {level === 'customers' && dashboardReady && !scopeGuardFailed && displayedReps && <>
      <section className="historical-requests__panel" aria-labelledby="historical-reps-title">
        <div className="historical-requests__section-heading"><h2 id="historical-reps-title">Requests by sales rep</h2>
          {displayedReps && <span>{displayedReps.total.toLocaleString()} reps</span>}</div>
        {displayedReps.rows.length === 0
          ? <div className="historical-requests__state" role="status">No sales rep totals are available.</div>
          : <div className="historical-requests__groups">{displayedReps.rows.filter(isGroup).map(row => <div className="historical-requests__group" key={row.key}>
            <span className="historical-requests__group-name">{row.label}</span><span>{row.requestCount.toLocaleString()} requests</span>
            <strong>{currency(row.totalValue)}</strong>{row.unpricedCount > 0 && <small>{row.unpricedCount} unresolved price{row.unpricedCount === 1 ? '' : 's'}</small>}
          </div>)}</div>}
        {displayedReps && <Pager page={repPage} pageSize={displayedReps.pageSize} total={displayedReps.total} onPage={setRepPage} />}
      </section>
    </>}

    <section className="historical-requests__panel" aria-labelledby="historical-browse-title">
      <div className="historical-requests__section-heading"><h2 id="historical-browse-title">
        {level === 'customers' ? 'Customers' : level === 'consignees' ? `${customer?.label || 'Customer'} · Consignees` : `${consignee?.label || 'Consignee'} · Requests`}
      </h2><span>{currentTotal || '—'} {level === 'customers' ? 'customers' : level === 'consignees' ? 'consignees' : 'requests'}</span>
        {current.data && <button className="historical-requests__refresh" type="button" onClick={current.retry}>Refresh</button>}</div>
      {level === 'customers' && <p className="historical-requests__pricing-note">Value uses current master list price × request quantity. Blank or zero quantity defaults to 25. Unavailable or invalid prices are shown as unresolved and excluded from value totals.</p>}
      {!scopeGuardFailed && <PageStatus state={current} empty={level === 'customers' ? 'No customers found.' : level === 'consignees' ? 'No consignees found for this customer.' : 'No requests found for this consignee.'} onRetry={current.retry} />}
      {currentCanDisplay && groups.length > 0 && <div className="historical-requests__groups">{groups.map(group => <button className="historical-requests__group historical-requests__group-button" type="button" key={group.key}
        onClick={() => level === 'customers' ? selectCustomer(group) : selectConsignee(group)}>
        <span className="historical-requests__group-name">{group.label}</span><span>{group.requestCount.toLocaleString()} requests</span>
        <strong>{currency(group.totalValue)}</strong>{group.unpricedCount > 0 && <small>{group.unpricedCount} unresolved price{group.unpricedCount === 1 ? '' : 's'}</small>}
        <span className="historical-requests__chevron" aria-hidden="true">›</span>
      </button>)}</div>}
      {currentCanDisplay && requestRows.length > 0 && <div className="historical-requests__request-list">{requestRows.map(row => <article className="historical-requests__request" key={row.id}>
        <div className="historical-requests__request-heading"><strong>{row.commonname || row.itemcode || 'Request'}</strong><span>{row.status}</span></div>
        <div className="historical-requests__request-meta">{row.itemcode || '—'}{row.location ? ` · ${row.location}` : ''}{row.requestedAt ? ` · ${new Date(row.requestedAt).toLocaleDateString()}` : ''}</div>
        <div className="historical-requests__request-meta">{row.salesrepName || 'Unassigned'} · Qty {row.requestQty === null ? 'Unknown' : row.requestQty.toLocaleString()} (value qty {row.effectiveQty === null ? '—' : row.effectiveQty.toLocaleString()})</div>
        {row.totalValue === null ? <p className="historical-requests__unpriced">Unresolved value: {unresolvedValueMessage(row.unresolvedReason)}</p>
          : <p className="historical-requests__request-value">{currency(row.totalValue)} <span>at current price {row.listPrice === null ? '—' : currency(row.listPrice)}</span></p>}
      </article>)}</div>}
      {currentCanDisplay && current.data && current.data.total > current.data.pageSize && <Pager page={current.data.page} pageSize={current.data.pageSize} total={current.data.total} onPage={level === 'customers' ? setCustomerPage : setDetailPage} />}
      {dashboardReady && level !== 'customers' && !scopeGuardFailed && <div className="historical-requests__scope-note">Dashboard totals are available to authorized administrators only.</div>}
    </section>
  </main>;
}

export function HistoricalRequestsView({ bridge }: { bridge: HistoricalRequestsBridge }) {
  const cache = useMemo(() => new Map<string, State<unknown, Error>>(), [bridge.scopeKey]);
  return <SWRConfig key={bridge.scopeKey} value={{ provider: () => cache as Cache<State<unknown, Error>> }}>
    <HistoricalRequestsApp key={bridge.scopeKey} bridge={bridge} />
  </SWRConfig>;
}
