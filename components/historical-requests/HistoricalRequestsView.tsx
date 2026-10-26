import { useEffect, useMemo, useRef, useState } from 'react';
import { SWRConfig, type Cache, type State } from 'swr';
import { useRevisionedSnapshot } from '../../services/useRevisionedSnapshot';
import { readHistoricalReportingDirectory } from '../../services/historicalRequests';
import { HistoricalArchiveView } from './HistoricalArchiveView';
import type {
  HistoricalArchiveKind,
  HistoricalRequestGroup,
  HistoricalRequestRow,
  HistoricalRequestsBridge,
  HistoricalRequestsPage,
  HistoricalRequestsQuery,
} from './contract';
import { historicalPhotoDate, historicalRequestsRoleCanViewFinancials } from './contract';
import { historicalPhotoUrls } from './photoUrls';
export { historicalPhotoUrls } from './photoUrls';

const PAGE_SIZE = 25;
type Level = 'reps' | 'customers' | 'requests';
type PageResult = { data?: HistoricalRequestsPage; error?: Error; isLoading: boolean; retry(): void };

function keyFor(bridge: HistoricalRequestsBridge, query: HistoricalRequestsQuery) {
  return JSON.stringify([bridge.scopeKey, bridge.role, query.operation, query.repKey, query.recordKind, query.dateFrom, query.dateTo, query.customerKey || '', query.consigneeKey || '', query.page || 0, query.pageSize || PAGE_SIZE]);
}

function redactFinancials(page: HistoricalRequestsPage): HistoricalRequestsPage {
  return {
    ...page,
    financials: false,
    summary: { ...page.summary, totalValue: null, unpricedCount: null },
    rows: page.rows.map(row => 'requestCount' in row
      ? { ...row, totalValue: null, unpricedCount: null }
      : { ...row, listPrice: null, totalValue: null, unresolvedReason: null }),
  };
}

function usePage(bridge: HistoricalRequestsBridge, query: HistoricalRequestsQuery | null): PageResult {
  const controllers = useRef(new Map<string, AbortController>());
  const key = query ? keyFor(bridge, query) : null;
  const result = useRevisionedSnapshot<HistoricalRequestsPage>(key, bridge.revisionKey, async () => {
    if (!query) throw new Error('Historical requests query is unavailable.');
    const controller = new AbortController();
    if (key) {
      controllers.current.get(key)?.abort();
      controllers.current.set(key, controller);
    }
    try {
      const page = await bridge.read(query, controller.signal);
      return historicalRequestsRoleCanViewFinancials(bridge.role) ? page : redactFinancials(page);
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
    case 'current_catalog_list_price_unavailable_or_conflicting': return 'The active catalog has no usable base list price for this item code.';
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
  if (!page.financials || page.scope !== 'all' || page.summary.totalValue === null || page.summary.unpricedCount === null) return null;
  return <section className="historical-requests__summary" aria-label="Historical request totals">
    <div><span>Records</span><strong>{page.summary.requestCount.toLocaleString()}</strong></div>
    <div><span>Priced value</span><strong>{currency(page.summary.totalValue)}</strong></div>
    <div><span>Unresolved prices</span><strong>{page.summary.unpricedCount.toLocaleString()}</strong></div>
  </section>;
}

function ExecutiveReports({ bridge, recordKind, repKey, customerKey, dateFrom, dateTo, onDates, onScopeInvalid }:
  { bridge: HistoricalRequestsBridge; recordKind: 'requests' | 'orders'; repKey?: string; customerKey?: string;
    dateFrom: string; dateTo: string; onDates(from: string, to: string): void; onScopeInvalid(): void }) {
  const [grouping, setGrouping] = useState<'summary' | 'months' | 'reps' | 'customers'>('summary');
  const [reportRep, setReportRep] = useState('');
  const [reportCustomer, setReportCustomer] = useState('');
  const [reportPage, setReportPage] = useState(0);
  const [preset, setPreset] = useState('all');
  const [month, setMonth] = useState('');
  const validDates = !dateFrom || !dateTo || dateFrom <= dateTo;
  const selectedRep = reportRep === '__all__' ? undefined : reportRep || repKey;
  const selectedCustomer = reportCustomer === '__all__' ? undefined : reportCustomer || customerKey;
  const filters = { ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}),
    ...(selectedRep ? { repKey: selectedRep } : {}),
    ...(selectedCustomer ? { customerKey: selectedCustomer } : {}) };
  const report = usePage(bridge, validDates ? { operation: grouping, recordKind, ...filters, page: reportPage, pageSize: PAGE_SIZE } : null);
  const directoryState = useRevisionedSnapshot(
    JSON.stringify(['historical-reporting-directory', bridge.scopeKey, bridge.role, selectedRep || '']),
    bridge.revisionKey, () => readHistoricalReportingDirectory(bridge, selectedRep),
    { revalidateOnFocus: true, revalidateOnReconnect: true, dedupingInterval: 2000 },
  );
  const directory = directoryState.data || { reps: [], customers: [] };
  const directoryError = directoryState.error?.message || '';
  useEffect(() => {
    if ((directoryState.error as (Error & { status?: number }) | undefined)?.status === 403) onScopeInvalid();
  }, [directoryState.error, onScopeInvalid]);
  useEffect(() => { setReportPage(0); }, [grouping, recordKind, reportRep, reportCustomer, repKey, customerKey, dateFrom, dateTo]);
  useEffect(() => { setReportCustomer(''); }, [reportRep, repKey]);
  const ready = historicalRequestsRoleCanViewFinancials(bridge.role) && !report.error && report.data?.scope === 'all' && report.data.financials === true;
  useEffect(() => {
    if (report.data && (report.data.scope !== 'all' || !report.data.financials)) onScopeInvalid();
  }, [report.data?.scope, report.data?.financials]);
  const setPresetDates = (value: string) => {
    setPreset(value);
    if (value === 'all') onDates('', '');
    if (value === 'ytd') {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const part = (type: string) => parts.find(value => value.type === type)?.value || '';
      const today = `${part('year')}-${part('month')}-${part('day')}`;
      onDates(part('year') + '-01-01', today);
    }
  };
  const selectMonth = (value: string) => {
    setMonth(value);
    if (!/^\d{4}-\d{2}$/.test(value)) { onDates('', ''); return; }
    const [year, month] = value.split('-').map(Number);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    onDates(value + '-01', value + '-' + String(last).padStart(2, '0'));
  };
  return <section className="historical-requests__panel" aria-labelledby="executive-report-title">
    <h2 id="executive-report-title">Executive reporting</h2>
    <div className="historical-requests__report-filters">
      <label>Period<select value={preset} onChange={event => setPresetDates(event.target.value)}><option value="all">All dates</option><option value="month">Specific month</option><option value="range">Date range</option><option value="ytd">Year to date</option></select></label>
      {preset === 'month' && <label>Month<input type="month" value={month} onChange={event => selectMonth(event.target.value)} /></label>}
      {preset === 'range' && <><label>From date<input type="date" value={dateFrom} onChange={event => onDates(event.target.value, dateTo)} /></label><label>Through date<input type="date" value={dateTo} onChange={event => onDates(dateFrom, event.target.value)} /></label></>}
      <label>Reporting rep<select value={reportRep} onChange={event => setReportRep(event.target.value)}><option value="">{repKey ? 'Current rep' : 'All reps'}</option>{repKey && <option value="__all__">All reps</option>}{directory.reps.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}</select></label>
      <label>Reporting customer<select value={reportCustomer} onChange={event => setReportCustomer(event.target.value)}><option value="">{customerKey ? 'Current customer' : 'All customers'}</option>{customerKey && <option value="__all__">All customers</option>}{directory.customers.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}</select></label>
      <label>Group totals<select value={grouping} onChange={event => setGrouping(event.target.value as typeof grouping)}><option value="summary">Aggregate total</option><option value="months">Per month</option><option value="reps">Per rep</option><option value="customers">Per customer</option></select></label>
    </div>
    {!validDates && <p role="alert">The through date must be on or after the from date.</p>}
    {directoryError && <p role="alert">{directoryError}</p>}
    {report.isLoading && !report.data && <p role="status">Loading financial report…</p>}
    {report.error && <PageStatus state={report} empty="" onRetry={report.retry} />}
    {report.data && !report.error && !ready && <p role="alert">Financial reporting scope could not be confirmed.</p>}
    {ready && report.data && <SummaryCards page={report.data} />}
    {ready && grouping !== 'summary' && <div className="historical-requests__report-table"><table><caption>Filtered financial totals</caption><thead><tr><th>Group</th><th>Records</th><th>Priced value</th><th>Unresolved</th></tr></thead>
      <tbody>{report.data!.rows.filter(isGroup).map(row => <tr key={row.key}><th scope="row">{row.label}</th><td>{row.requestCount}</td><td>{row.totalValue === null ? 'Unavailable' : currency(row.totalValue)}</td><td>{row.unpricedCount ?? 'Unavailable'}</td></tr>)}</tbody></table></div>}
    {ready && report.data && report.data.total > report.data.pageSize && <Pager page={reportPage} pageSize={report.data.pageSize} total={report.data.total} onPage={setReportPage} />}
    <p className="historical-requests__pricing-note">Dates use the nursery’s Chicago calendar; the through date is inclusive. Value uses the active catalog item-code list price. Blank or zero quantity follows the existing 25-unit default.</p>
  </section>;
}

function RequestHistoryBrowser({ bridge }: { bridge: HistoricalRequestsBridge }) {
  const [level, setLevel] = useState<Level>('reps');
  const [rep, setRep] = useState<HistoricalRequestGroup | null>(null);
  const [folder, setFolder] = useState<HistoricalRequestGroup | null>(null);
  const recordKind = 'requests' as const;
  const [page, setPage] = useState(0);
  const [repPage, setRepPage] = useState(0);
  const [establishedScope, setEstablishedScope] = useState<HistoricalRequestsPage['scope'] | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reportScopeInvalid, setReportScopeInvalid] = useState(false);
  const dateFilters = { ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}) };
  const validDates = !dateFrom || !dateTo || dateFrom <= dateTo;
  // Keep the authorization probe active throughout the drill-down and revalidation.
  const reps = usePage(bridge, { operation: 'reps', recordKind, page: repPage, pageSize: PAGE_SIZE });
  const scope = reps.data?.scope;
  useEffect(() => {
    if (!reps.data || reps.error) return;
    if (establishedScope === null) setEstablishedScope(reps.data.scope);
    if (reps.data.scope === 'own' && (level === 'reps' || rep?.key !== reps.data.ownRepKey)) {
      const own = reps.data.rows.filter(isGroup).find(row => row.key === reps.data!.ownRepKey);
      if (own) { setRep(own); setFolder(null); setLevel('customers'); setPage(0); }
    }
  }, [reps.data, reps.error, level, rep?.key, establishedScope]);
  const folders = usePage(bridge, validDates && level === 'customers' && rep ? { operation: 'folders', repKey: rep.key, recordKind, ...dateFilters, page, pageSize: PAGE_SIZE } : null);
  const requests = usePage(bridge, validDates && level === 'requests' && rep && folder?.customerKey && folder?.consigneeKey ? {
    operation: 'requests', repKey: rep.key, customerKey: folder.customerKey, consigneeKey: folder.consigneeKey, recordKind, ...dateFilters, page, pageSize: PAGE_SIZE,
  } : null);
  const current = level === 'reps' ? reps : level === 'customers' ? folders : requests;
  const scopeGuardFailed = Boolean(reportScopeInvalid || reps.error || (scope && establishedScope && scope !== establishedScope)
    || (current.data && scope && (current.data.scope !== scope || current.data.financials !== reps.data?.financials))
    || (scope === 'own' && rep && rep.key !== reps.data?.ownRepKey));
  const currentCanDisplay = validDates && !scopeGuardFailed && !current.error && Boolean(reps.data)
    && current.data?.recordKind === recordKind;
  const rows = currentCanDisplay ? current.data?.rows || [] : [];
  const groups = rows.filter(isGroup);
  const requestRows = rows.filter((row): row is HistoricalRequestRow => !isGroup(row));
  const ownerMismatch = requestRows.some(row => rep?.key !== 'rep:' + (row.salesrepUserId || 'unassigned'));
  const financials = historicalRequestsRoleCanViewFinancials(bridge.role) && !scopeGuardFailed && !ownerMismatch && reps.data?.scope === 'all' && reps.data.financials === true;
  const recoverScope = () => {
    setReportScopeInvalid(false); setEstablishedScope(null); setRep(null); setFolder(null); setLevel('reps'); setPage(0); setRepPage(0); reps.retry();
  };
  const goBack = () => {
    setPage(0);
    if (level === 'requests') { setFolder(null); setLevel('customers'); }
    else if (scope === 'all') { setRep(null); setLevel('reps'); }
  };
  const selectGroup = (group: HistoricalRequestGroup) => {
    setPage(0);
    if (level === 'reps') { setRep(group); setFolder(null); setLevel('customers'); }
    else if (group.customerKey && group.consigneeKey) { setFolder(group); setLevel('requests'); }
  };
  const noun = 'requests';

  return <>
    {(level === 'requests' || level === 'customers' && scope === 'all') && <div className="historical-archive__local-back">
      <button className="historical-requests__back" type="button" onClick={goBack}>Back</button></div>}
    {(scopeGuardFailed || ownerMismatch) && <div className="historical-requests__state historical-requests__state--error" role="alert">
      {level === 'reps' ? 'Dashboard scope could not be confirmed.' : 'Data scope could not be confirmed.'}
      <button type="button" onClick={recoverScope}>{level === 'reps' ? 'Refresh dashboard' : 'Return to customers and refresh'}</button>
    </div>}
    {financials && <ExecutiveReports bridge={bridge} recordKind={recordKind} repKey={rep?.key} customerKey={folder?.customerKey || undefined}
      dateFrom={dateFrom} dateTo={dateTo} onDates={(from, to) => { setDateFrom(from); setDateTo(to); setPage(0); }}
      onScopeInvalid={() => { setReportScopeInvalid(true); reps.retry(); }} />}
    <section className="historical-requests__panel" aria-labelledby="historical-browse-title">
      <div className="historical-requests__section-heading"><h2 id="historical-browse-title">
        {level === 'reps' ? 'Sales Reps' : level === 'customers' ? 'Customers' : `${folder?.label || 'Customer'} · ${folder?.consigneeName || 'Consignee'} · Requests`}
      </h2><span>{currentCanDisplay ? current.data?.total.toLocaleString() : '—'} {level === 'reps' ? 'reps' : level === 'customers' ? 'folders' : noun}</span>
        {current.data && <button className="historical-requests__refresh" type="button" onClick={() => { reps.retry(); current.retry(); }}>Refresh</button>}</div>
      {financials && <p className="historical-requests__pricing-note">Value uses the active catalog item-code list price × request quantity. Blank or zero quantity defaults to 25. Unavailable prices are excluded from totals.</p>}
      {!scopeGuardFailed && !ownerMismatch && <PageStatus state={current} empty={level === 'reps' ? 'No sales reps found.' : level === 'customers' ? 'No customer folders found.' : `No ${noun} found for this customer and consignee.`} onRetry={current.retry} />}
      {currentCanDisplay && !ownerMismatch && groups.length > 0 && <div className="historical-requests__groups">{groups.map(group => <button className="historical-requests__group historical-requests__group-button" type="button" key={group.key} onClick={() => selectGroup(group)}>
        <span className="historical-requests__group-name">{group.label}</span><span>{group.requestCount.toLocaleString()} {noun}</span>
        {group.consigneeName && <small>{group.consigneeName}</small>}
        {(group.customerId || group.consigneeId) && <small>{group.customerId ? 'Customer ID ' + group.customerId : ''}{group.customerId && group.consigneeId ? ' · ' : ''}{group.consigneeId ? 'Consignee ID ' + group.consigneeId : ''}</small>}
        {financials && group.totalValue !== null && <strong>{currency(group.totalValue)}</strong>}
        {financials && group.unpricedCount !== null && group.unpricedCount > 0 && <small>{group.unpricedCount} unresolved price{group.unpricedCount === 1 ? '' : 's'}</small>}
        <span className="historical-requests__chevron" aria-hidden="true">›</span>
      </button>)}</div>}
      {currentCanDisplay && !ownerMismatch && requestRows.length > 0 && <div className="historical-requests__request-list">{requestRows.map(row => <article className="historical-requests__request" key={row.id}>
        <div className="historical-requests__request-heading"><strong>{row.commonname || row.itemcode || 'Request'}</strong><span>{row.status}</span></div>
        <div className="historical-requests__request-meta">{row.itemcode || '—'}{row.location ? ` · ${row.location}` : ''}{row.requestedAt ? ` · ${new Date(row.requestedAt).toLocaleDateString()}` : ''}</div>
        <div className="historical-requests__request-meta">{row.salesrepName || 'Unassigned'} · Qty {row.requestQty === null ? 'Unknown' : row.requestQty.toLocaleString()}{row.dock !== null ? ` · Dock ${row.dock || '(blank value)'}` : ''}</div>
        <dl className="historical-requests__facts"><div><dt>Spec</dt><dd>{row.spec || 'Not recorded'}</dd></div><div><dt>Caliper</dt><dd>{row.caliper || 'Not recorded'}</dd></div>
          <div><dt>Sent</dt><dd>{row.sentAt ? new Date(row.sentAt).toLocaleString() : 'Not recorded'}</dd></div><div><dt>Delivery</dt><dd>{row.deliveryState}</dd></div></dl>
        {row.comments && <p className="historical-requests__request-meta">{row.comments}</p>}{row.photoNotes && <p className="historical-requests__request-meta">{row.photoNotes}</p>}
        <div className="historical-requests__photos">{historicalPhotoUrls(row.photoLinks).map((url, index) => {
          const photoDate = historicalPhotoDate(url, row.photoDate || row.requestedAt);
          return <a className="historical-requests__photo photo-date-badge-host" key={url} href={url} target="_blank" rel="noopener noreferrer"><img src={url} loading="lazy" alt={`Request photo ${index + 1}`} />
            {photoDate && <span className="photo-thumb-date" data-photo-taken-date={photoDate}>{photoDate}</span>}</a>;
        })}</div>
        {financials && (row.totalValue === null ? <p className="historical-requests__unpriced">Unresolved value: {unresolvedValueMessage(row.unresolvedReason)}</p>
          : <p className="historical-requests__request-value">{currency(row.totalValue)} <span>at current price {row.listPrice === null ? '—' : currency(row.listPrice)}</span></p>)}
      </article>)}</div>}
      {currentCanDisplay && !ownerMismatch && current.data && current.data.total > current.data.pageSize && <Pager page={current.data.page} pageSize={current.data.pageSize} total={current.data.total} onPage={level === 'reps' ? setRepPage : setPage} />}
    </section>
  </>;
}

const ARCHIVE_TABS: Array<{ kind: HistoricalArchiveKind; label: string }> = [
  { kind: 'requests', label: 'Historical Requests' },
  { kind: 'orders', label: 'Historical SOC Open Orders' },
  { kind: 'reserves', label: 'Historical SOC Reserves' },
  { kind: 'drive', label: 'Historical Drive Around' },
];

function HistoricalRequestsApp({ bridge }: { bridge: HistoricalRequestsBridge }) {
  const [recordKind, setRecordKind] = useState<HistoricalArchiveKind>('requests');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim().length >= 2 ? searchDraft.trim() : ''), 250);
    return () => clearTimeout(timer);
  }, [searchDraft]);
  const selectTab = (kind: HistoricalArchiveKind) => { setRecordKind(kind); };
  return <main className="historical-requests historical-archive" aria-labelledby="historical-requests-title" data-archive-kind={recordKind}>
    <header className="historical-requests__header"><div>
      <p className="historical-requests__eyebrow">Unified historical archive</p><h1 id="historical-requests-title">Historical Requests</h1>
      <p className="historical-requests__description">Browse permanent Request, SOC, Reserve, and Drive Around snapshots.</p>
    </div></header>
    <nav className="historical-requests__tabs historical-archive__tabs" aria-label="Historical archive domains">
      {ARCHIVE_TABS.map(tab => <button type="button" key={tab.kind} data-archive-tab={tab.kind}
        aria-pressed={recordKind === tab.kind} onClick={() => selectTab(tab.kind)}>{tab.label}</button>)}
    </nav>
    <label className="historical-archive__search"><span>Search this archive</span><div>
      <input type="search" value={searchDraft} onChange={event => setSearchDraft(event.target.value)}
        placeholder="Plant name, ItemCode, customer, trip, file, or location" />
      {searchDraft && <button type="button" onClick={() => { setSearchDraft(''); setSearch(''); }}>Clear</button>}
    </div></label>
    {recordKind === 'requests' && !search ? <RequestHistoryBrowser bridge={bridge} />
      : <HistoricalArchiveView bridge={bridge} recordKind={recordKind} search={search} />}
  </main>;
}

export function HistoricalRequestsView({ bridge }: { bridge: HistoricalRequestsBridge }) {
  const identityKey = JSON.stringify([bridge.scopeKey, bridge.role]);
  const cache = useMemo(() => new Map<string, State<unknown, Error>>(), [identityKey]);
  return <SWRConfig key={identityKey} value={{ provider: () => cache as Cache<State<unknown, Error>> }}>
    <HistoricalRequestsApp key={identityKey} bridge={bridge} />
  </SWRConfig>;
}
