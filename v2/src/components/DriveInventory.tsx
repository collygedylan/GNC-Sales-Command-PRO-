import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Image as ImageIcon, Loader2, RefreshCw, Search } from 'lucide-react';
import { fetchInventoryPage } from '../services/api';
import { loadRuntimeConfig } from '../services/runtime';
import type { InventoryRow, PageResult } from '../types';

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const SEARCH_DEBOUNCE_MS = 250;

type Snapshot = {
  rows: InventoryRow[];
  nextPage: number;
  total: number;
  source: PageResult<InventoryRow>['source'];
  search: string;
};

export type DriveItemGroup = {
  key: string;
  itemcode: string;
  name: string;
  size: string;
  photo: string;
  available: number | null;
  onHand: number | null;
  rowCount: number;
  locations: Array<{ key: string; name: string; lot: string; available: number | null; onHand: number | null }>;
};

type QuantityAccumulator = { sum: number; count: number; incomplete: boolean };
type DriveLocationAccumulator = {
  key: string;
  name: string;
  lot: string;
  available: QuantityAccumulator;
  onHand: QuantityAccumulator;
};
type DriveGroupAccumulator = {
  key: string;
  itemcode: string;
  name: string;
  size: string;
  photo: string;
  rowCount: number;
  available: QuantityAccumulator;
  onHand: QuantityAccumulator;
  locations: Map<string, DriveLocationAccumulator>;
};

function value(row: InventoryRow, names: string[]) {
  for (const name of names) {
    const direct = row[name];
    const lower = row[name.toLowerCase()];
    const candidate = direct ?? lower;
    if (candidate !== null && candidate !== undefined && String(candidate).trim() !== '') return String(candidate).trim();
  }
  return '';
}

function quantity(row: InventoryRow, names: string[]): number | null {
  const raw = value(row, names);
  if (!raw) return null;
  const parsed = Number(raw.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function safeInventoryPhotoUrl(row: InventoryRow, trustedStorageHost = '') {
  const payload = row.source_payload && typeof row.source_payload === 'object' ? row.source_payload : {};
  const raw = value({ ...payload, ...row }, ['photo_url', 'photourl', 'photo_link', 'req_photo_link', 'image_url', 'imageurl', 'image', 'photo']);
  if (!raw) return '';
  try {
    const url = new URL(raw, window.location.origin);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    const sameOrigin = url.origin === window.location.origin;
    const trustedStorage = Boolean(trustedStorageHost && url.protocol === 'https:' && url.hostname.toLowerCase() === trustedStorageHost.toLowerCase());
    return sameOrigin || trustedStorage ? url.href : '';
  } catch {
    return '';
  }
}

export function aggregateDriveRows(rows: InventoryRow[], trustedStorageHost = ''): DriveItemGroup[] {
  const groups = new Map<string, DriveGroupAccumulator>();
  for (const row of rows) {
    const itemcode = value(row, ['itemcode', 'ITEMCODE']);
    const name = value(row, ['commonname', 'COMMONNAME']) || 'Unnamed item';
    const size = value(row, ['contsize', 'CONTSIZE']);
    const key = itemcode ? `${itemcode}|${size.toLowerCase()}` : `${name.toLowerCase()}|${size.toLowerCase()}`;
    let current = groups.get(key);
    if (!current) {
      current = {
        key,
        itemcode,
        name,
        size,
        photo: '',
        rowCount: 0,
        available: { sum: 0, count: 0, incomplete: false },
        onHand: { sum: 0, count: 0, incomplete: false },
        locations: new Map()
      };
      groups.set(key, current);
    }
    current.rowCount += 1;
    if (!current.photo) current.photo = safeInventoryPhotoUrl(row, trustedStorageHost);
    addQuantity(current.available, quantity(row, ['ptravailable', 'PTRAVAILABLE', 'available', 'AVAILABLE']));
    addQuantity(current.onHand, quantity(row, ['ptronhand', 'PTRONHAND', 'onhand', 'ONHAND', 'on_hand', 'ON_HAND']));
    const location = value(row, ['locationcode', 'LOCATIONCODE']) || 'Location not listed';
    const lot = value(row, ['lotcode', 'LOTCODE']);
    const locationKey = `${location}|${lot}`;
    let locationGroup = current.locations.get(locationKey);
    if (!locationGroup) {
      locationGroup = {
        key: locationKey,
        name: location,
        lot,
        available: { sum: 0, count: 0, incomplete: false },
        onHand: { sum: 0, count: 0, incomplete: false }
      };
      current.locations.set(locationKey, locationGroup);
    }
    addQuantity(locationGroup.available, quantity(row, ['ptravailable', 'PTRAVAILABLE', 'available', 'AVAILABLE']));
    addQuantity(locationGroup.onHand, quantity(row, ['ptronhand', 'PTRONHAND', 'onhand', 'ONHAND', 'on_hand', 'ON_HAND']));
  }
  return [...groups.values()].map(group => {
    return {
      key: group.key,
      itemcode: group.itemcode,
      name: group.name,
      size: group.size,
      photo: group.photo,
      available: accumulatedQuantity(group.available),
      onHand: accumulatedQuantity(group.onHand),
      rowCount: group.rowCount,
      locations: [...group.locations.values()].map(location => ({
        key: `${group.key}|${location.key}`,
        name: location.name,
        lot: location.lot,
        available: accumulatedQuantity(location.available),
        onHand: accumulatedQuantity(location.onHand)
      }))
    };
  });
}

function addQuantity(accumulator: QuantityAccumulator, quantityValue: number | null) {
  if (quantityValue === null) {
    accumulator.incomplete = true;
    return;
  }
  accumulator.count += 1;
  accumulator.sum += quantityValue;
}

function accumulatedQuantity(accumulator: QuantityAccumulator): number | null {
  return accumulator.count && !accumulator.incomplete ? accumulator.sum : null;
}

function displayQuantity(value: number | null) {
  return value === null ? '—' : new Intl.NumberFormat().format(value);
}

function mergeRows(existing: InventoryRow[], incoming: InventoryRow[]) {
  const merged = new Map<string, InventoryRow>();
  for (const row of [...existing, ...incoming]) {
    const id = value(row, ['unique_id', 'UNIQUE_ID']);
    const fallbackKey = `${value(row, ['itemcode', 'ITEMCODE'])}|${value(row, ['locationcode', 'LOCATIONCODE'])}|${value(row, ['lotcode', 'LOTCODE'])}`;
    merged.set(id || fallbackKey, row);
  }
  return [...merged.values()];
}

function DriveInventoryView({ onOpen }: { onOpen?: (row: InventoryRow) => void }) {
  const [search, setSearch] = useState('');
  const [settledSearch, setSettledSearch] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [trustedStorageHost, setTrustedStorageHost] = useState('');
  const pagingController = useRef<AbortController | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    pagingController.current?.abort();
    pagingController.current = null;
    const controller = new AbortController();
    const currentGeneration = ++generation.current;
    setLoading(true);
    setLoadingMore(false);
    setError('');
    fetchInventoryPage({ page: 0, pageSize: PAGE_SIZE, search: settledSearch, signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted || generation.current !== currentGeneration) return;
        const cachedRows = result.source === 'cache' ? filterCachedRows(result.rows, settledSearch) : result.rows;
        setSnapshot({
          rows: cachedRows,
          nextPage: 1,
          total: result.source === 'cache' ? cachedRows.length : result.total,
          source: result.source,
          search: settledSearch
        });
      })
      .catch(reason => {
        if (controller.signal.aborted || generation.current !== currentGeneration || isAbort(reason)) return;
        setError(reason instanceof Error ? reason.message : 'Inventory could not be loaded. Retry when the connection is available.');
      })
      .finally(() => {
        if (generation.current === currentGeneration) setLoading(false);
      });
    return () => controller.abort();
  }, [settledSearch, refreshKey]);

  useEffect(() => () => pagingController.current?.abort(), []);

  useEffect(() => {
    let current = true;
    void loadRuntimeConfig().then(config => {
      if (!current) return;
      try { setTrustedStorageHost(new URL(config.supabaseUrl).hostname); } catch { setTrustedStorageHost(''); }
    }).catch(() => { if (current) setTrustedStorageHost(''); });
    return () => { current = false; };
  }, []);

  const loadMore = useCallback(async () => {
    if (!snapshot || loading || loadingMore || snapshot.rows.length >= snapshot.total || snapshot.nextPage >= MAX_PAGES) return;
    const controller = new AbortController();
    pagingController.current = controller;
    const currentGeneration = generation.current;
    setLoadingMore(true);
    setError('');
    try {
      const result = await fetchInventoryPage({ page: snapshot.nextPage, pageSize: PAGE_SIZE, search: snapshot.search, signal: controller.signal });
      if (controller.signal.aborted || generation.current !== currentGeneration) return;
      setSnapshot(current => {
        if (!current || current.search !== snapshot.search) return current;
        return {
          rows: mergeRows(current.rows, result.rows),
          nextPage: snapshot.nextPage + 1,
          total: result.total,
          source: current.source === 'cache' || result.source === 'cache' ? 'cache' : 'sandbox',
          search: current.search
        };
      });
    } catch (reason) {
      if (!controller.signal.aborted && !isAbort(reason) && generation.current === currentGeneration) {
        setError(reason instanceof Error ? reason.message : 'More inventory could not be loaded. Existing rows are still available.');
      }
    } finally {
      if (pagingController.current === controller) pagingController.current = null;
      if (generation.current === currentGeneration) setLoadingMore(false);
    }
  }, [snapshot, loading, loadingMore]);

  const groups = useMemo(() => aggregateDriveRows(snapshot?.rows || [], trustedStorageHost), [snapshot?.rows, trustedStorageHost]);
  const hasMore = Boolean(snapshot && snapshot.rows.length < snapshot.total && snapshot.nextPage < MAX_PAGES);
  const stale = Boolean(snapshot && snapshot.search !== settledSearch);

  return (
    <section className="drive-inventory" aria-label="Drive Mode inventory">
      <div className="drive-toolbar">
        <label className="drive-search">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Search inventory</span>
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search item, location, or code" />
        </label>
        <button type="button" className="drive-refresh" onClick={() => setRefreshKey(key => key + 1)} disabled={loading} aria-label="Refresh inventory">
          <RefreshCw size={17} /> <span>Refresh</span>
        </button>
      </div>
      <div className="drive-result-status" aria-live="polite">
        {loading ? <span><Loader2 className="drive-spin" size={15} /> {snapshot ? 'Updating inventory…' : 'Loading sandbox inventory…'}</span> : null}
        {!loading && snapshot ? <span>{snapshot.source === 'cache' ? `Cached snapshot · ${snapshot.rows.length.toLocaleString()} rows` : `Sandbox inventory · ${snapshot.rows.length.toLocaleString()} of ${snapshot.total.toLocaleString()} rows`}</span> : null}
        {stale ? <span className="drive-stale">Showing previous complete results while search updates.</span> : null}
      </div>
      {error ? <div className="drive-error" role="alert"><AlertCircle size={17} /> <span>{error}</span><button type="button" onClick={() => setRefreshKey(key => key + 1)}>Retry</button></div> : null}
      {!loading && !snapshot?.rows.length && !error ? <p className="drive-empty">No sandbox inventory rows matched this search.</p> : null}
      <div className={`drive-item-list ${stale ? 'is-stale' : ''}`}>
        {groups.map(group => {
          const isExpanded = expanded.has(group.key);
          const totalIsComplete = Boolean(snapshot?.source === 'sandbox' && snapshot.rows.length >= snapshot.total);
          const quantityLabel = totalIsComplete ? '' : snapshot?.source === 'cache' ? ' cached' : ' loaded';
          return (
            <article className="drive-item-card" key={group.key}>
              <div className="drive-item-heading">
                {group.photo ? <img className="drive-item-photo" src={group.photo} alt={`${group.name} inventory`} loading="lazy" referrerPolicy="no-referrer" /> : <div className="drive-item-photo drive-item-no-photo" aria-label="No photo available"><ImageIcon size={22} /></div>}
                <div className="drive-item-copy">
                  <h2>{group.name}</h2>
                  <p>{[group.itemcode, group.size].filter(Boolean).join(' · ') || 'Item code not listed'}</p>
                  <small>{group.rowCount} {group.rowCount === 1 ? 'location row' : 'location rows'}{snapshot?.source === 'cache' ? ' in cached snapshot' : snapshot && snapshot.rows.length < snapshot.total ? ' in loaded results' : ''}</small>
                </div>
                <button type="button" className="drive-expand" aria-expanded={isExpanded} aria-label={`${isExpanded ? 'Hide' : 'Show'} ${group.name} locations`} onClick={() => setExpanded(current => {
                  const next = new Set(current);
                  if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                  return next;
                })}>{isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}</button>
              </div>
              <div className="drive-item-metrics">
                <div><span>Available{quantityLabel}</span><strong>{displayQuantity(group.available)}</strong></div>
                <div><span>On Hand{quantityLabel}</span><strong>{displayQuantity(group.onHand)}</strong></div>
              </div>
              {isExpanded ? <div className="drive-locations">
                {group.locations.map(location => <div className="drive-location-row" key={location.key}>
                  <span className="drive-location-name">{location.name}{location.lot ? <small>Lot {location.lot}</small> : null}</span>
                  <span><small>Available</small><strong>{displayQuantity(location.available)}</strong></span>
                  <span><small>On Hand</small><strong>{displayQuantity(location.onHand)}</strong></span>
                  {onOpen ? <button type="button" className="drive-row-open" onClick={() => {
                    const row = snapshot?.rows.find(candidate => value(candidate, ['locationcode', 'LOCATIONCODE']) === location.name && value(candidate, ['lotcode', 'LOTCODE']) === location.lot);
                    if (row) onOpen(row);
                  }}>Open row</button> : null}
                </div>)}
              </div> : null}
            </article>
          );
        })}
      </div>
      {hasMore ? <button type="button" className="drive-load-more" onClick={() => void loadMore()} disabled={loadingMore || loading}>
        {loadingMore ? <><Loader2 className="drive-spin" size={16} /> Loading rows…</> : `Load ${Math.min(PAGE_SIZE, snapshot!.total - snapshot!.rows.length)} more rows`}
      </button> : null}
      {snapshot && snapshot.nextPage >= MAX_PAGES && snapshot.rows.length < snapshot.total ? <p className="drive-bound-notice">Showing the first {snapshot.rows.length.toLocaleString()} matching rows. Narrow the search to browse more inventory.</p> : null}
    </section>
  );
}

export const DriveInventory = memo(DriveInventoryView);

function isAbort(reason: unknown) {
  return Boolean(reason && typeof reason === 'object' && 'name' in reason && reason.name === 'AbortError');
}

function filterCachedRows(rows: InventoryRow[], search: string) {
  const needle = search.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(row => [
    value(row, ['commonname', 'COMMONNAME']),
    value(row, ['itemcode', 'ITEMCODE']),
    value(row, ['locationcode', 'LOCATIONCODE'])
  ].join(' ').toLowerCase().includes(needle));
}
