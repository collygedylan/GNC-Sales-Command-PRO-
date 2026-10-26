import { useEffect, useMemo, useRef, useState } from 'react';
import { useRevisionedSnapshot } from '../../services/useRevisionedSnapshot';
import type {
  HistoricalArchiveFolder,
  HistoricalArchiveKind,
  HistoricalArchivePage,
  HistoricalArchiveQuery,
  HistoricalArchiveRecord,
  HistoricalRequestsBridge,
} from './contract';
import { historicalPhotoDate } from './contract';
import { historicalPhotoUrls } from './photoUrls';

const PAGE_SIZE = 25;
const DOMAIN_DEPTH: Record<Exclude<HistoricalArchiveKind, 'requests'>, number> = { orders: 3, reserves: 4, drive: 3 };
const DOMAIN_EMPTY: Record<HistoricalArchiveKind, string> = {
  requests: 'No completed requests match this search.',
  orders: 'No historical SOC orders were found.',
  reserves: 'No historical SOC reserves were found.',
  drive: 'No historical Drive Around records were found.',
};

type ArchiveResult = { data?: HistoricalArchivePage; error?: Error; isLoading: boolean; retry(): void };

function archiveKey(bridge: HistoricalRequestsBridge, query: HistoricalArchiveQuery) {
  return JSON.stringify([bridge.scopeKey, bridge.role, bridge.revisionKey, query.operation, query.recordKind,
    query.path || [], query.query || '', query.page || 0, query.pageSize || PAGE_SIZE]);
}

function useArchivePage(bridge: HistoricalRequestsBridge, query: HistoricalArchiveQuery): ArchiveResult {
  const controllers = useRef(new Map<string, AbortController>());
  const key = archiveKey(bridge, query);
  const result = useRevisionedSnapshot<HistoricalArchivePage>(key, bridge.revisionKey, async () => {
    controllers.current.get(key)?.abort();
    const controller = new AbortController();
    controllers.current.set(key, controller);
    try { return await bridge.readArchive(query, controller.signal); }
    finally { if (controllers.current.get(key) === controller) controllers.current.delete(key); }
  });
  useEffect(() => () => { controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); }, []);
  return { data: result.data, error: result.error, isLoading: result.isLoading, retry: () => { void result.mutate(); } };
}

function isFolder(row: HistoricalArchiveFolder | HistoricalArchiveRecord): row is HistoricalArchiveFolder {
  return row.kind === 'folder';
}

function currency(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function ArchivePager({ page, pageSize, total, onPage }:
  { page: number; pageSize: number; total: number; onPage(page: number): void }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return <nav className="historical-requests__pager" aria-label="Historical archive pages">
    <button type="button" disabled={page <= 0} onClick={() => onPage(page - 1)}>Previous</button>
    <span>Page {page + 1} of {pageCount}</span>
    <button type="button" disabled={page + 1 >= pageCount} onClick={() => onPage(page + 1)}>Next</button>
  </nav>;
}

function RecordCard({ row }: { row: HistoricalArchiveRecord }) {
  const facts = Object.entries(row.facts).filter(([, value]) => value !== null && value !== '');
  const photos = historicalPhotoUrls(row.photoLinks);
  return <article className="historical-requests__request historical-archive__record" data-archive-record={row.id}>
    <div className="historical-requests__request-heading"><strong>{row.title}</strong><span>{row.status}</span></div>
    <div className="historical-requests__request-meta">{row.itemcode || '—'}{row.contsize ? ` · ${row.contsize}` : ''}
      {row.locationcode ? ` · ${row.locationcode}` : ''}{row.lotcode ? ` · ${row.lotcode}` : ''}</div>
    <div className="historical-requests__request-meta">{row.subtitle}{row.occurredAt ? ` · ${new Date(row.occurredAt).toLocaleDateString()}` : ''}
      {row.quantity !== null ? ` · Qty ${row.quantity.toLocaleString()}` : ''}</div>
    {facts.length > 0 && <dl className="historical-requests__facts">{facts.map(([label, value]) =>
      <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl>}
    {row.notes.map((note, index) => <p className="historical-requests__request-meta" key={`${row.id}:note:${index}`}>{note}</p>)}
    {photos.length > 0 && <div className="historical-requests__photos">{photos.map((url, index) => {
      const photoDate = historicalPhotoDate(url, row.photoDate || row.occurredAt);
      return <a className="historical-requests__photo photo-date-badge-host" key={url} href={url} target="_blank" rel="noopener noreferrer"><img src={url} loading="lazy" alt={`Archive photo ${index + 1}`} />
        {photoDate && <span className="photo-thumb-date" data-photo-taken-date={photoDate}>{photoDate}</span>}</a>;
    })}</div>}
    {row.lineDollarValue !== null && <p className="historical-requests__request-value">{currency(row.lineDollarValue)}
      {row.unitListPrice !== null && <span> at {currency(row.unitListPrice)} each</span>}</p>}
  </article>;
}

export function HistoricalArchiveView({ bridge, recordKind, search }:
  { bridge: HistoricalRequestsBridge; recordKind: HistoricalArchiveKind; search: string }) {
  const [path, setPath] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const normalizedSearch = search.trim();
  const maxDepth = recordKind === 'requests' ? 0 : DOMAIN_DEPTH[recordKind];
  useEffect(() => { setPath([]); setLabels([]); setPage(0); }, [recordKind, normalizedSearch]);
  const query = useMemo<HistoricalArchiveQuery>(() => normalizedSearch.length >= 2
    ? { operation: 'archive-search', recordKind, query: normalizedSearch, page: 0, pageSize: PAGE_SIZE }
    : { operation: path.length < maxDepth ? 'archive-folders' : 'archive-records', recordKind, path, page, pageSize: PAGE_SIZE },
  [maxDepth, normalizedSearch, page, path, recordKind]);
  const state = useArchivePage(bridge, query);
  const folders = state.data?.rows.filter(isFolder) || [];
  const records = state.data?.rows.filter((row): row is HistoricalArchiveRecord => !isFolder(row)) || [];
  const selectFolder = (folder: HistoricalArchiveFolder) => {
    setPath(current => [...current, folder.value]);
    setLabels(current => [...current, folder.label]);
    setPage(0);
  };
  const goBack = () => {
    setPath(current => current.slice(0, -1));
    setLabels(current => current.slice(0, -1));
    setPage(0);
  };
  const hasData = Boolean(state.data?.rows.length);
  return <section className="historical-requests__panel historical-archive__panel" aria-labelledby="historical-archive-browse-title">
    <div className="historical-requests__section-heading"><div>
      <h2 id="historical-archive-browse-title">{normalizedSearch ? `Search results for “${normalizedSearch}”`
        : labels.length ? labels[labels.length - 1] : 'Archive folders'}</h2>
      {!normalizedSearch && labels.length > 0 && <div className="historical-archive__crumbs">{labels.join(' › ')}</div>}
    </div><div className="historical-archive__heading-actions">
      <span>{state.data ? state.data.total.toLocaleString() : '—'} {path.length < maxDepth && !normalizedSearch ? 'folders' : 'records'}</span>
      {!normalizedSearch && path.length > 0 && <button className="historical-requests__back" type="button" onClick={goBack}>Back</button>}
      {state.data && <button className="historical-requests__refresh" type="button" onClick={state.retry}>Refresh</button>}
    </div></div>
    {state.isLoading && !state.data && <div className="historical-requests__state" role="status">Loading historical archive…</div>}
    {state.error && !state.data && <div className="historical-requests__state historical-requests__state--error" role="alert">
      <span>{state.error.message || 'Historical Archive could not be loaded.'}</span><button type="button" onClick={state.retry}>Retry</button></div>}
    {state.error && state.data && <div className="historical-requests__scope-note" role="status">Showing the last loaded archive while refresh retries.</div>}
    {!state.isLoading && !state.error && !hasData && <div className="historical-requests__state" role="status">{DOMAIN_EMPTY[recordKind]}</div>}
    {folders.length > 0 && <div className="historical-requests__groups">{folders.map(folder =>
      <button className="historical-requests__group historical-requests__group-button" type="button" key={folder.key}
        data-archive-folder={folder.key} onClick={() => selectFolder(folder)}>
        <span className="historical-requests__group-name">{folder.label}</span><span>{folder.recordCount.toLocaleString()} records</span>
        <small>{folder.subtitle}</small>{folder.totalValue !== null && <strong>{currency(folder.totalValue)}</strong>}
        <span className="historical-requests__chevron" aria-hidden="true">›</span>
      </button>)}</div>}
    {records.length > 0 && <div className="historical-requests__request-list">{records.map(row => <RecordCard row={row} key={row.id} />)}</div>}
    {state.data && state.data.total > state.data.pageSize && !normalizedSearch &&
      <ArchivePager page={state.data.page} pageSize={state.data.pageSize} total={state.data.total} onPage={setPage} />}
  </section>;
}
