import useSWR, { SWRConfig, type Cache, type State } from 'swr';
import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useVirtualizer, type ReactVirtualizer } from '@tanstack/react-virtual';
import type { ReportPage, ReportPageQuery, ReportRow, ReportRowsMount, ReportRowsMountOptions, ReportSession, ReportSessionConfig } from '../components/report-pages/contract';

const MAX_PAGES_PER_SURFACE = 8;
const MAX_IN_FLIGHT = 2;
const sessions = new Map<string, SessionState>();
const EMPTY_SLOTS = new Map<number, SlotState>();

export function ReportPageSessionProvider({ session, children }: { session: ReportSession; children: ReactNode }) {
  const cacheProvider = useCallback(() => session.swrCache as Cache<State<unknown, Error>>, [session.swrCache]);
  return createElement(SWRConfig, { value: { provider: cacheProvider } }, children);
}

export function useReportPage<Row extends ReportRow = ReportRow>(session: ReportSession, query: ReportPageQuery, refreshKey = 0) {
  const key = session.key(query);
  const result = useSWR<ReportPage<Row>>(key, async () => await session.refresh(query) as ReportPage<Row>, {
    fallbackData: session.peek(query) as ReportPage<Row> | undefined, keepPreviousData: false, revalidateOnMount: false, revalidateIfStale: false, revalidateOnFocus: false,
    revalidateOnReconnect: true, refreshInterval: 0, dedupingInterval: 2000, shouldRetryOnError: false
  });
  const mutateRef = useRef(result.mutate); mutateRef.current = result.mutate;
  useEffect(() => { void mutateRef.current().catch(() => undefined); }, [key, refreshKey]);
  return result;
}

type SessionState = {
  scopeKey: string;
  cache: Map<string, State<unknown, Error>>;
  pages: Map<string, { surface: string; queryKey: string; page: ReportPage; savedAt: number }>;
  pinned: Set<string>;
  inflight: Map<string, Promise<ReportPage>>;
  controllers: Map<string, AbortController>;
  queue: Array<() => void>;
  active: number;
  generation: number;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function validateQuery(query: ReportPageQuery): ReportPageQuery {
  if (!query || !['eval1', 'eval2', 'ncr', 'assigned-items', 'season-priority', 'approval'].includes(query.surface)) throw new Error('Invalid report page surface.');
  if (!['groups', 'rows', 'metadata', 'detail'].includes(query.operation)) throw new Error('Invalid report page operation.');
  if (!Number.isSafeInteger(query.offset) || query.offset < 0) throw new Error('Invalid report page offset.');
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new Error('Report page limit must be between 1 and 100.');
  if (query.operation === 'groups' && query.limit > 25) throw new Error('Report group page limit must not exceed 25.');
  if (!query.filters || typeof query.filters !== 'object' || Array.isArray(query.filters)) throw new Error('Report page filters must be an object.');
  return query;
}

function normalize(value: unknown, query: ReportPageQuery): ReportPage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Report page response is invalid.');
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.rows)) throw new Error('Report page rows are invalid.');
  if (source.rows.length > query.limit || (source.hasMore === true && source.rows.length === 0)) throw new Error('Report page is incomplete or exceeds its requested bound.');
  if (source.offset !== undefined && source.offset !== query.offset) throw new Error('Report page offset does not match its request.');
  if (source.total !== null && (!Number.isSafeInteger(source.total) || Number(source.total) < 0)) throw new Error('Report page total is invalid.');
  if (typeof source.hasMore !== 'boolean' || typeof source.sourceRevision !== 'string') throw new Error('Report page metadata is invalid.');
  if (query.sourceRevision && source.sourceRevision !== query.sourceRevision) {
    throw Object.assign(new Error('Report source changed. Refresh the report.'), { code: 'MANAGER_REPORT_SOURCE_REVISION_CHANGED' });
  }
  if (source.metadata !== undefined && (!source.metadata || typeof source.metadata !== 'object' || Array.isArray(source.metadata))) throw new Error('Report page metadata is invalid.');
  return { rows: source.rows as ReportRow[], total: source.total as number | null, hasMore: source.hasMore, sourceRevision: source.sourceRevision,
    ...(source.metadata ? { metadata: source.metadata as Record<string, unknown> } : {}) };
}

function stateFor(identityKey: string): SessionState {
  let state = sessions.get(identityKey);
  if (!state) {
    state = { scopeKey: '', cache: new Map(), pages: new Map(), pinned: new Set(), inflight: new Map(), controllers: new Map(), queue: [], active: 0, generation: 0 };
    sessions.set(identityKey, state);
  }
  return state;
}

function schedule<T>(state: SessionState, task: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      const index = state.queue.indexOf(run);
      if (index >= 0) state.queue.splice(index, 1);
      settled = true;
      reject(Object.assign(new Error('Report read cancelled.'), { name: 'AbortError' }));
    };
    const run = () => {
      if (settled) return;
      if (signal.aborted) { abort(); return; }
      state.active += 1;
      task().then(value => { if (!settled) { settled = true; resolve(value); } }, error => { if (!settled) { settled = true; reject(error); } }).finally(() => {
        signal.removeEventListener('abort', abort);
        state.active -= 1;
        state.queue.shift()?.();
      });
    };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    if (state.active < MAX_IN_FLIGHT) run();
    else state.queue.push(run);
  });
}

function trimPages(state: SessionState, surface: string, incomingKey: string) {
  const keys = () => [...state.pages.entries()].filter(([, entry]) => entry.surface === surface).sort((a, b) => a[1].savedAt - b[1].savedAt);
  while (keys().length > MAX_PAGES_PER_SURFACE) {
    const entries = keys();
    const candidate = entries.find(([key]) => !state.pinned.has(key)) || entries.find(([key]) => key === incomingKey);
    if (!candidate) break;
    const [key] = candidate;
    state.pages.delete(key); state.cache.delete(key); state.pinned.delete(key);
  }
}

export function createReportSession(config: ReportSessionConfig): ReportSession {
  if (!config.scopeKey || !config.permissionVersion || typeof config.transport !== 'function') throw new Error('A scoped report session is required.');
  const identityKey = stable([config.scopeKey, config.permissionVersion]);
  for (const [priorKey, prior] of sessions) {
    if (prior.scopeKey !== config.scopeKey || priorKey === identityKey) continue;
    prior.controllers.forEach(controller => controller.abort());
    prior.pages.clear(); prior.cache.clear(); prior.pinned.clear(); prior.inflight.clear();
    sessions.delete(priorKey);
  }
  const state = stateFor(identityKey);
  state.scopeKey = config.scopeKey;
  const key = (query: ReportPageQuery) => stable(['report-page-v1', identityKey, validateQuery(query)]);
  const assertActive = () => { if (sessions.get(identityKey) !== state) throw Object.assign(new Error('Report session changed.'), { name: 'AbortError' }); };
  const refresh = (rawQuery: ReportPageQuery, signal?: AbortSignal) => {
    assertActive();
    const query = validateQuery(rawQuery), queryKey = key(query);
    if (signal?.aborted) return Promise.reject(Object.assign(new Error('Report read cancelled.'), { name: 'AbortError' }));
    const pending = state.inflight.get(queryKey);
    if (pending) return pending;
    const controller = new AbortController();
    const requestGeneration = state.generation;
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    state.controllers.set(queryKey, controller);
    const request = schedule(state, async () => {
      if (controller.signal.aborted) throw Object.assign(new Error('Report read cancelled.'), { name: 'AbortError' });
      return normalize(await config.transport(query, controller.signal), query);
    }, controller.signal).then(page => {
      if (controller.signal.aborted || sessions.get(identityKey) !== state || state.generation !== requestGeneration) throw Object.assign(new Error('Report read cancelled.'), { name: 'AbortError' });
      state.pages.set(queryKey, { surface: query.surface, queryKey, page, savedAt: Date.now() });
      trimPages(state, query.surface, queryKey);
      return page;
    }).finally(() => {
      signal?.removeEventListener('abort', abortFromCaller);
      if (state.controllers.get(queryKey) === controller) state.controllers.delete(queryKey);
      if (state.inflight.get(queryKey) === request) state.inflight.delete(queryKey);
    });
    state.inflight.set(queryKey, request);
    return request;
  };
  const read = (query: ReportPageQuery, signal?: AbortSignal) => {
    assertActive();
    const queryKey = key(query), cached = state.pages.get(queryKey);
    if (cached) {
      cached.savedAt = Date.now();
      state.pages.delete(queryKey); state.pages.set(queryKey, cached);
      return Promise.resolve(cached.page);
    }
    return refresh(query, signal);
  };
  const peek = (query: ReportPageQuery) => state.pages.get(key(query))?.page;
  return {
    identityKey,
    swrCache: state.cache as Map<string, unknown>,
    key,
    peek,
    pin(query, pinned) {
      const queryKey = key(query);
      if (!pinned) { state.pinned.delete(queryKey); return; }
      state.pinned.delete(queryKey); state.pinned.add(queryKey);
      const pinnedSurface = [...state.pinned].filter(candidate => state.pages.get(candidate)?.surface === query.surface);
      while (pinnedSurface.length > MAX_PAGES_PER_SURFACE) {
        const oldest = pinnedSurface.shift()!;
        state.pinned.delete(oldest); state.pages.delete(oldest); state.cache.delete(oldest);
      }
    },
    read,
    refresh,
    invalidate(query) {
      if (query) {
        const queryKey = key(query);
        state.pages.delete(queryKey); state.cache.delete(queryKey); state.inflight.delete(queryKey); state.pinned.delete(queryKey);
        state.controllers.get(queryKey)?.abort(); state.controllers.delete(queryKey);
      } else {
        state.generation += 1;
        state.pages.clear(); state.cache.clear(); state.inflight.clear(); state.pinned.clear();
        state.controllers.forEach(controller => controller.abort()); state.controllers.clear();
      }
    },
    invalidateInventory() {
      state.generation += 1;
      state.pages.clear(); state.cache.clear(); state.inflight.clear(); state.pinned.clear();
      state.controllers.forEach(controller => controller.abort()); state.controllers.clear();
    },
    clear() {
      state.pages.clear(); state.cache.clear(); state.inflight.clear(); state.pinned.clear();
      state.controllers.forEach(controller => controller.abort()); state.controllers.clear();
      if (sessions.get(identityKey) === state) sessions.delete(identityKey);
    }
  };
}

export function clearReportSessions(scopeKey?: string) {
  for (const [identityKey, state] of sessions) {
    if (scopeKey && state.scopeKey !== scopeKey) continue;
    state.pages.clear(); state.cache.clear(); state.pinned.clear(); state.inflight.clear();
    state.controllers.forEach(controller => controller.abort()); state.controllers.clear();
    sessions.delete(identityKey);
  }
}

type RowsProps = ReportRowsMountOptions & { generation: number };
type SlotState = { page?: ReportPage; error?: Error; loading: boolean; validating: boolean };
function ReportPageSlot({ session, query, onSlot, refreshKey }: { session: ReportSession; query: ReportPageQuery; onSlot(offset: number, state: SlotState): void; refreshKey: number }) {
  const { data, error, isLoading, isValidating } = useReportPage(session, query, refreshKey);
  useEffect(() => { onSlot(query.offset, { page: data, error, loading: isLoading, validating: isValidating }); }, [query.offset, data, error, isLoading, isValidating, onSlot]);
  return null;
}

function VirtualTableRow({ html, index, start, scrollMargin, virtualizer, onFocus, onBlur }: {
  html: string; index: number; start: number; scrollMargin: number; virtualizer: ReactVirtualizer<HTMLElement, Element>;
  onFocus(): void; onBlur(event: ReactFocusEvent<HTMLTableRowElement>): void;
}) {
  const rowRef = useRef<HTMLTableRowElement | null>(null);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const source = template.content.querySelector('tr');
    if (source) {
      [...row.attributes].forEach(attribute => { if (!['style', 'data-index', 'data-report-row'].includes(attribute.name)) row.removeAttribute(attribute.name); });
      [...source.attributes].forEach(attribute => row.setAttribute(attribute.name, attribute.value));
      row.innerHTML = source.innerHTML;
    } else row.innerHTML = html;
    row.dataset.index = String(index);
    row.dataset.reportRow = String(index);
    virtualizer.measureElement(row);
  }, [html, index, virtualizer]);
  return createElement('tr', { ref: rowRef, 'data-index': index, 'data-report-row': index, onFocusCapture: onFocus, onBlurCapture: onBlur,
    style: { position: 'absolute', top: 0, left: 0, width: '100%', display: 'table', tableLayout: 'fixed', transform: `translateY(${start - scrollMargin}px)` } });
}

function VirtualReportRows(props: RowsProps) {
  const queryKey = props.session.key(props.query), pageSize = Math.max(1, Math.min(100, props.pageSize || props.query.limit));
  const [collection, setCollection] = useState<{ key: string; slots: Map<number, SlotState>; total: number | null; revision: string }>(() => ({ key: queryKey, slots: new Map(), total: null, revision: '' }));
  const slots = collection.key === queryKey ? collection.slots : EMPTY_SLOTS;
  const pages = useMemo(() => new Map([...slots.entries()].filter(([, slot]) => slot.page).map(([offset, slot]) => [offset, slot.page!])), [slots]);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null), [scrollMargin, setScrollMargin] = useState(0);
  const [gridMetrics, setGridMetrics] = useState({ columns: 1, columnGap: 0, rowGap: 0 });
  const hostRef = useRef<HTMLDivElement | null>(null), onRenderedRef = useRef(props.onRendered);
  const restartRef = useRef('');
  onRenderedRef.current = props.onRendered;
  const onSlot = useCallback((offset: number, state: SlotState) => {
    setCollection(current => {
      let base = current.key === queryKey ? current.slots : new Map<number, SlotState>();
      const existingRevision = current.key === queryKey ? current.revision : '';
      const expectedRevision = props.parentPinnedRevision || existingRevision;
      if (state.page?.sourceRevision && expectedRevision && state.page.sourceRevision !== expectedRevision && (offset !== 0 || !!props.parentPinnedRevision)) {
        const prior = base.get(offset);
        if (prior?.error?.name === 'ReportRevisionChanged') return current;
        const mismatch = Object.assign(new Error('Report source changed. Refresh the report group before reopening its rows.'), { name: 'ReportRevisionChanged', code: 'MANAGER_REPORT_SOURCE_REVISION_CHANGED' });
        const next = new Map(base); next.set(offset, { page:prior?.page, error:mismatch, loading:false, validating:false });
        return { key:queryKey, slots:next, total:current.total, revision:existingRevision };
      }
      const revisionChanged = offset === 0 && !!state.page?.sourceRevision && !!existingRevision && state.page.sourceRevision !== existingRevision;
      if (revisionChanged) base = new Map();
      const prior = base.get(offset);
      if (current.key === queryKey && !revisionChanged && prior?.page === state.page && prior?.error === state.error && prior?.loading === state.loading && prior?.validating === state.validating) return current;
      const next = new Map(base); next.set(offset, state);
      return { key: queryKey, slots: next, total: state.page?.total ?? (revisionChanged ? null : current.total), revision: state.page?.sourceRevision || (revisionChanged ? '' : current.revision) };
    });
  }, [queryKey, props.parentPinnedRevision]);
  const snapshot = collection.key === queryKey ? collection : { total: null, revision: '' };
  const total = snapshot.total;
  const count = total ?? Math.max(pageSize, ...[...pages.keys()].map(offset => offset + (pages.get(offset)?.rows.length || 0)));
  const gridMode = props.layout === 'grid';
  useLayoutEffect(() => {
    if (!gridMode) return;
    const host = hostRef.current, parent = host?.parentElement;
    if (!parent) return;
    const measure = () => {
      const style = getComputedStyle(parent);
      const columns = Math.max(1, style.gridTemplateColumns.split(/\s+/).filter(Boolean).length);
      const gap = (value: string) => { const parsed = Number.parseFloat(value); return Number.isFinite(parsed) ? parsed : 0; };
      const next = { columns, columnGap: gap(style.columnGap), rowGap: gap(style.rowGap) };
      setGridMetrics(current => current.columns === next.columns && current.columnGap === next.columnGap && current.rowGap === next.rowGap ? current : next);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(parent); window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [gridMode, queryKey]);
  const virtualCount = gridMode ? Math.ceil(count / gridMetrics.columns) : count;
  const scrollElement = props.getScrollElement?.() || document.getElementById('main-scroll-area');
  const virtualizer = useVirtualizer({ count: virtualCount, getScrollElement: () => scrollElement, estimateSize: () => props.estimateSize || 140, overscan: gridMode ? 2 : 6, gap: gridMode ? gridMetrics.rowGap : 0, scrollMargin,
    rangeExtractor: range => {
      const indexes: number[] = [];
      for (let i = Math.max(0, range.startIndex - range.overscan); i <= Math.min(range.count - 1, range.endIndex + range.overscan); i += 1) indexes.push(i);
      if (focusedIndex !== null && focusedIndex >= 0 && focusedIndex < range.count && !indexes.includes(focusedIndex)) indexes.push(focusedIndex);
      return indexes.sort((a, b) => a - b);
    },
    getItemKey: index => {
      const itemIndex = gridMode ? index * gridMetrics.columns : index;
      const offset = Math.floor(itemIndex / pageSize) * pageSize, row = pages.get(offset)?.rows[itemIndex - offset] as ReportRow | undefined;
      const rowKey = row as (ReportRow & { id?: unknown; unique_id?: unknown; UNIQUE_ID?: unknown }) | undefined;
      return (row ? props.getKey?.(row, index) : undefined) || String(rowKey?.id ?? rowKey?.unique_id ?? rowKey?.UNIQUE_ID ?? index);
  } });
  const measuredItems = virtualizer.getVirtualItems();
  const estimate = props.estimateSize || 140;
  const fallbackStart = Math.max(0, Math.floor(Math.max(0, (scrollElement?.scrollTop || 0) - scrollMargin) / (estimate + (gridMode ? gridMetrics.rowGap : 0))));
  const fallbackVisible = Math.max(1, Math.ceil((scrollElement?.clientHeight || estimate) / estimate) + (gridMode ? 4 : 12));
  const virtualItems = measuredItems.length ? measuredItems : pages.get(0)?.rows.length ? Array.from({ length: Math.max(0, Math.min(virtualCount, fallbackStart + fallbackVisible) - fallbackStart) }, (_, relative) => {
    const index = fallbackStart + relative;
    return { index, key: String(index), start: index * estimate + index * (gridMode ? gridMetrics.rowGap : 0) };
  }) : [];
  const virtualSignature = virtualItems.map(item => item.index).join(',');
  const visibleOffsets = virtualItems.length ? [...new Set(virtualItems.flatMap(item => {
    if (!gridMode) return [Math.floor(item.index / pageSize) * pageSize];
    const first = item.index * gridMetrics.columns, last = Math.min(count - 1, first + gridMetrics.columns - 1);
    return [...new Set(Array.from({ length: Math.max(0, last - first + 1) }, (_, relative) => Math.floor((first + relative) / pageSize) * pageSize))];
  }))] : [0];
  const pageOffsets = visibleOffsets.slice(0, visibleOffsets.includes(0) ? MAX_PAGES_PER_SURFACE : MAX_PAGES_PER_SURFACE - 1);
  const pageQuery = (offset: number, sourceRevision = '') => {
    const { sourceRevision: _parentRevision, ...base } = props.query;
    const pinnedRevision = props.parentPinnedRevision || (offset > 0 ? sourceRevision : '');
    return { ...base, offset, limit: pageSize, ...(pinnedRevision ? { sourceRevision: pinnedRevision } : {}) };
  };
  useEffect(() => {
    pageOffsets.forEach(offset => props.session.pin(pageQuery(offset, snapshot.revision), true));
    for (const offset of pages.keys()) if (!pageOffsets.includes(offset)) props.session.pin(pageQuery(offset, pages.get(offset)?.sourceRevision || snapshot.revision), false);
    return () => pageOffsets.forEach(offset => props.session.pin(pageQuery(offset, snapshot.revision), false));
  }, [virtualSignature, queryKey, snapshot.revision]);
  useEffect(() => {
    setCollection(current => {
      const base = current.key === queryKey ? current.slots : new Map<number, SlotState>();
      const retained = new Map([...base.entries()].filter(([offset]) => offset === 0 || pageOffsets.includes(offset)));
      while (retained.size > MAX_PAGES_PER_SURFACE) { const key = [...retained.keys()].find(value => value !== 0 && !pageOffsets.includes(value)); if (key === undefined) break; retained.delete(key); }
      return retained.size === base.size && current.key === queryKey ? current : { key: queryKey, slots: retained, total: current.total, revision: current.revision };
    });
  }, [virtualSignature, queryKey]);
  useEffect(() => {
    const scroll = props.getScrollElement?.() || document.getElementById('main-scroll-area'), host = hostRef.current;
    if (!scroll || !host) return undefined;
    const update = () => setScrollMargin(Math.max(0, host.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop));
    update(); const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(scroll); observer?.observe(host); window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, [props.getScrollElement]);
  const allRows = useMemo(() => [...pages.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, value]) => value.rows), [pages]);
  const page = slots.get(0)?.page, error = [...slots.values()].find(slot => slot.error)?.error;
  const initialLoading = !page && !!slots.get(0)?.loading, refreshing = [...slots.values()].some(slot => slot.validating && !!slot.page);
  const revision = page?.sourceRevision || [...pages.values()][0]?.sourceRevision || '';
  useLayoutEffect(() => { if (hostRef.current) onRenderedRef.current?.(hostRef.current, { rows: allRows, total, sourceRevision: revision }); }, [virtualSignature, queryKey, pages, props.generation, total, revision]);
  const onStateRef = useRef(props.onState); onStateRef.current = props.onState;
  useEffect(() => { onStateRef.current?.({ page, rows: allRows, initialLoading, refreshing, ...(error ? { error } : {}), total, sourceRevision: revision }); }, [page, allRows, initialLoading, refreshing, error, total, revision]);
  useEffect(() => {
    const value = error as (Error & { code?: string; backendCode?: string; details?: { code?: string }; payload?: { code?: string } }) | undefined;
    const code = String(value?.code || value?.backendCode || value?.details?.code || value?.payload?.code || '');
    if (code !== 'MANAGER_REPORT_SOURCE_REVISION_CHANGED') return;
    const signature = `${queryKey}:${revision}:${code}`;
    if (restartRef.current === signature) return;
    restartRef.current = signature;
    if (props.parentPinnedRevision) {
      props.onRevisionChanged?.({ expectedRevision: props.parentPinnedRevision, error: value! });
      return;
    }
    const firstPageQuery = pageQuery(0);
    void props.session.refresh(firstPageQuery).then(freshPage => {
      onSlot(0, { page: freshPage, loading: false, validating: false });
    }).catch(() => undefined);
  }, [error, queryKey, revision, pageSize, props.query, props.session, onSlot, props.parentPinnedRevision, props.onRevisionChanged]);
  const renderLogicalRow = (index: number, key: React.Key, start: number, band?: number) => {
    const offset = Math.floor(index / pageSize) * pageSize, row = pages.get(offset)?.rows[index - offset];
    if (row === undefined) return createElement('div', { key, 'data-index': band ?? index, ref: band === undefined ? virtualizer.measureElement : undefined,
      style: band === undefined ? { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${start - scrollMargin}px)` }
        : { minWidth: 0 }, role: 'status' }, 'Loading…');
    return createElement('div', { key, 'data-report-row': index,
      style: band === undefined ? { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${start - scrollMargin}px)` } : { minWidth: 0 },
      onFocusCapture: () => setFocusedIndex(band ?? index), onBlurCapture: (event: ReactFocusEvent<HTMLDivElement>) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocusedIndex(null);
      }, dangerouslySetInnerHTML: { __html: props.renderRow(row, index) } });
  };
  const html = gridMode ? virtualItems.map(item => {
    const first = item.index * gridMetrics.columns, last = Math.min(count, first + gridMetrics.columns), children = [];
    for (let index = first; index < last; index += 1) children.push(renderLogicalRow(index, String(index), item.start, item.index));
    return createElement('div', { key: String(item.key), 'data-index': item.index, ref: virtualizer.measureElement,
      style: { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start - scrollMargin}px)`, display: 'grid', gridTemplateColumns: `repeat(${gridMetrics.columns}, minmax(0, 1fr))`, columnGap: `${gridMetrics.columnGap}px` } }, ...children);
  }) : virtualItems.map(item => {
    const offset = Math.floor(item.index / pageSize) * pageSize, row = pages.get(offset)?.rows[item.index - offset];
    if (row === undefined) return createElement('div', { key: item.key, 'data-index': item.index, ref: virtualizer.measureElement,
      style: { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start - scrollMargin}px)` }, role: 'status' }, 'Loading…');
    return createElement('div', { key: item.key, 'data-index': item.index, 'data-report-row': item.index, ref: virtualizer.measureElement,
      style: { position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start - scrollMargin}px)` },
      onFocusCapture: () => setFocusedIndex(item.index), onBlurCapture: (event: ReactFocusEvent<HTMLDivElement>) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocusedIndex(null);
      }, dangerouslySetInnerHTML: { __html: props.renderRow(row, item.index) } });
  });
  const tableRows = props.layout === 'table' ? virtualItems.map(item => {
    const offset = Math.floor(item.index / pageSize) * pageSize, row = pages.get(offset)?.rows[item.index - offset];
    if (row === undefined) return createElement('tr', { key: item.key, 'data-index': item.index, style: { position: 'absolute', top: 0, left: 0, width: '100%', display: 'table', tableLayout: 'fixed', transform: `translateY(${item.start - scrollMargin}px)` }, role: 'status' },
      createElement('td', { colSpan: props.tableColSpan || 1 }, 'Loading…'));
    return createElement(VirtualTableRow, { key: item.key, html: props.renderRow(row, item.index), index: item.index, start: item.start, scrollMargin,
      virtualizer, onFocus: () => setFocusedIndex(item.index), onBlur: (event: ReactFocusEvent<HTMLTableRowElement>) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocusedIndex(null);
      } });
  }) : [];
  const table = props.layout === 'table' ? createElement('table', { className: 'drive-grid-table' },
    createElement('thead', { dangerouslySetInnerHTML: { __html: props.tableHeaderHtml || '' } }),
    createElement('tbody', { style: { display: 'block', position: 'relative', height: `${virtualizer.getTotalSize()}px` } }, ...tableRows)) : null;
  const empty = snapshot.total === 0 && !!page && !error && props.emptyHtml
    ? createElement('div', { role: 'status', dangerouslySetInnerHTML: { __html: props.emptyHtml } }) : null;
  return createElement('div', { ref: hostRef, 'data-report-rows': props.query.surface, 'data-layout': props.layout || 'list', style: gridMode ? { gridColumn: '1 / -1', minWidth: 0, position: 'relative' } : undefined },
    ...pageOffsets.map(offset => createElement(ReportPageSlot, { key: offset, session: props.session,
      query: pageQuery(offset, snapshot.revision), onSlot, refreshKey: props.generation })),
    error && createElement('div', { role: 'status' }, error.message),
    empty || table || createElement('div', { style: { height: `${Math.max(virtualizer.getTotalSize(), pages.get(0)?.rows.length ? props.estimateSize || 140 : 0)}px`, position: 'relative' } }, ...html));
}

export function mountReportRows(host: HTMLElement, options: ReportRowsMountOptions): ReportRowsMount {
  if (!host) throw new TypeError('Report rows host is required.');
  const cacheProvider = () => options.session.swrCache as Cache<State<unknown, Error>>;
  let root: Root | null = createRoot(host), generation = 0, destroyed = false, current = options, queryKey = options.session.key(options.query);
  const render = () => { if (root && !destroyed) root.render(createElement(SWRConfig, { value: { provider: cacheProvider } }, createElement(VirtualReportRows, { ...current, generation }))); };
  render();
  return { update(next) { current = { ...current, ...next }; const nextKey = current.session.key(current.query); if (nextKey !== queryKey) { queryKey = nextKey; generation += 1; } render(); }, refresh() { generation += 1; render(); }, destroy() { if (destroyed) return; destroyed = true; root?.unmount(); root = null; host.replaceChildren(); } };
}

export type ReportPageMountConfig = { session: ReportSession; query: ReportPageQuery; renderRows: (page: ReportPage, stale: boolean) => void; onState?: (state: { loading: boolean; error?: Error }) => void };
function ReportPageObserver({ config }: { config: ReportPageMountConfig }) {
  const key = config.session.key(config.query);
  const { data, error, isLoading, isValidating } = useReportPage(config.session, config.query);
  const prior = useRef<{ key: string; page: ReportPage } | undefined>(undefined);
  const configRef = useRef(config); configRef.current = config;
  useEffect(() => { if (data) prior.current = { key, page: data }; }, [data, key]);
  useEffect(() => { configRef.current.onState?.({ loading: isLoading, ...(error ? { error } : {}) }); }, [isLoading, error]);
  useEffect(() => {
    const page = data || (prior.current?.key === key ? prior.current.page : undefined);
    if (page) configRef.current.renderRows(page, !!error || isValidating && !!prior.current && prior.current.key === key);
  }, [data, error, isValidating, key]);
  return null;
}

export function mountReportObserver(host: HTMLElement, config: ReportPageMountConfig): { update(config: ReportPageMountConfig): void; destroy(): void } {
  const cacheProvider = () => config.session.swrCache as Cache<State<unknown, Error>>;
  let root: Root | null = createRoot(host), current = config, destroyed = false;
  const render = () => { if (!root || destroyed) return; root.render(createElement(SWRConfig, { value: { provider: cacheProvider } }, createElement(ReportPageObserver, { config: current }))); };
  render();
  return { update(next) { current = next; render(); }, destroy() { if (destroyed) return; destroyed = true; root?.unmount(); root = null; } };
}

export const mountReportPages = mountReportObserver;
