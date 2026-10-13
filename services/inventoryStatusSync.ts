import { mutate as swrMutate, type Key } from 'swr';
import { driveEvidenceRevision } from './driveEvidence';

export type InventoryStatusPair = { itemcode: string; locationcode: string };
export type InventoryStatusPatch = InventoryStatusPair & {
  unique_id: string;
  priority?: string | null;
  holdstopcode?: string | null;
  holdstopreason?: string | null;
};
export type InventoryStatusRow = Record<string, unknown>;
type Pair = InventoryStatusPair;
type Row = InventoryStatusRow;
type Mutate = (key: Key, data: unknown, options: { revalidate: boolean; rollbackOnError: boolean }) => Promise<unknown>;
export type InventoryStatusSyncOptions = {
  getScope(): string;
  mutate?: Mutate;
  fetchPair(pair: Pair, options: { signal: AbortSignal }): Promise<Row[]>;
  /** Only authoritative rows may enter durable inventory collections. */
  onRows(rows: Row[], pair: Pair): void;
  onDisplayChange(): void;
  onError?(error: unknown, pair?: Pair): void;
  debounceMs?: number;
  retryMs?: number;
};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const pairOf = (row: Row): Pair => ({ itemcode: text(row.itemcode ?? row.ITEMCODE), locationcode: text(row.locationcode ?? row.LOCATIONCODE) });
const pairKey = (pair: Pair) => JSON.stringify([pair.itemcode, pair.locationcode]);
const rowId = (row: Row) => text(row.unique_id ?? row.UNIQUE_ID);
const revision = (row: Row) => driveEvidenceRevision(row.last_updated ?? row.LAST_UPDATED);
const fields = ['priority', 'holdstopcode', 'holdstopreason'] as const;
const has = (row: object, key: string) => Object.prototype.hasOwnProperty.call(row, key);
function copyStatus(target: Row, source: Row): Row {
  const result = { ...target };
  for (const field of fields) {
    const upper = field.toUpperCase();
    if (has(source, field) || has(source, upper)) {
      const value = has(source, field) ? source[field] : source[upper];
      result[field] = result[upper] = value;
    }
  }
  return result;
}

/** Public SWR mutations bridge the legacy renderer without persisting optimistic values. */
export function createInventoryStatusSync(options: InventoryStatusSyncOptions) {
  type State = { pair: Pair; rows: Map<string, Row>; generation: number; controller?: AbortController; retry?: ReturnType<typeof setTimeout> };
  let scope = options.getScope();
  let active = true;
  let tokenCounter = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const pairs = new Map<string, State>();
  const queued = new Set<string>();
  const overlays = new Map<string, { patches: InventoryStatusPatch[]; confirmed: boolean }>();
  const mutate = options.mutate || swrMutate as unknown as Mutate;
  const cacheKey = (pair: Pair, identity = scope) => JSON.stringify(['inventory-status', identity, pair.itemcode, pair.locationcode]);
  const current = (identity: string) => active && identity === scope && identity === options.getScope();
  function clear() {
    if (debounce) clearTimeout(debounce);
    debounce = undefined;
    for (const state of pairs.values()) {
      state.controller?.abort();
      if (state.retry) clearTimeout(state.retry);
      void mutate(cacheKey(state.pair), undefined, { revalidate: false, rollbackOnError: false });
    }
    pairs.clear(); queued.clear(); overlays.clear();
  }
  function ensureScope() {
    if (scope !== options.getScope()) { clear(); scope = options.getScope(); }
  }
  function stateFor(pair: Pair) {
    const key = pairKey(pair);
    if (!pairs.has(key)) pairs.set(key, { pair: { ...pair }, rows: new Map(), generation: 0 });
    return pairs.get(key)!;
  }
  function pending(key: string) {
    return [...overlays.values()].some(value => !value.confirmed && value.patches.some(patch => pairKey(patch) === key));
  }
  function display(row: Row, key: string) {
    let result = row;
    for (const overlay of overlays.values()) for (const patch of overlay.patches) {
      if (pairKey(patch) === key && rowId(row) === patch.unique_id) result = copyStatus(result, patch);
    }
    return result;
  }
  const displayedRows = (state: State) => [...state.rows.values()].map(row => display(row, pairKey(state.pair)));
  function publish(state: State) {
    void mutate(cacheKey(state.pair), displayedRows(state), { revalidate: false, rollbackOnError: false }).catch(error => options.onError?.(error, state.pair));
  }
  function merge(state: State, rows: Row[]) {
    const accepted: Row[] = [];
    for (const row of rows) {
      if (!rowId(row) || pairKey(pairOf(row)) !== pairKey(state.pair)) continue;
      const previous = state.rows.get(rowId(row));
      if (previous && revision(previous) > revision(row)) continue;
      state.rows.set(rowId(row), row);
      accepted.push(row);
    }
    return accepted;
  }
  function retry(state: State) {
    queued.add(pairKey(state.pair));
    if (!active || state.retry) return;
    state.retry = setTimeout(() => {
      state.retry = undefined;
      void refresh(state.pair);
    }, options.retryMs ?? 5000);
  }
  async function refresh(pair: Pair): Promise<Row[] | null> {
    ensureScope();
    if (!active || !scope) return null;
    const state = stateFor(pair), key = pairKey(pair), identity = scope;
    if (pending(key)) { queued.add(key); return null; }
    queued.delete(key);
    if (state.retry) clearTimeout(state.retry);
    state.retry = undefined;
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    const generation = ++state.generation;
    let accepted: Row[] | null = null;
    try {
      // The legacy UI has no mounted useSWR hook. Supply the fetcher explicitly.
      await mutate(cacheKey(pair), async () => {
        const rows = await options.fetchPair(pair, { signal: controller.signal });
        if (!current(identity) || controller.signal.aborted || generation !== state.generation || pending(key)) return displayedRows(state);
        accepted = merge(state, rows);
        options.onRows(accepted, pair);
        // Retire only this pair: a cross-location edit may still need other reads.
        const acceptedIds = new Set(accepted.map(rowId));
        for (const [token, overlay] of overlays) if (overlay.confirmed) {
          overlay.patches = overlay.patches.filter(patch => pairKey(patch) !== key || !acceptedIds.has(patch.unique_id));
          if (!overlay.patches.length) overlays.delete(token);
        }
        if ([...overlays.values()].some(overlay => overlay.confirmed && overlay.patches.some(patch => pairKey(patch) === key))) retry(state);
        options.onDisplayChange();
        return displayedRows(state);
      }, { revalidate: false, rollbackOnError: false });
    } catch (error) {
      if (current(identity) && !controller.signal.aborted && generation === state.generation) {
        options.onError?.(error, pair);
        retry(state);
      }
    } finally {
      if (state.controller === controller) state.controller = undefined;
    }
    return accepted;
  }
  const api = {
    seed(rows: Row[]) {
      ensureScope();
      for (const row of rows) {
        const pair = pairOf(row);
        if (rowId(row) && pair.itemcode && pair.locationcode) merge(stateFor(pair), [row]);
      }
    },
    begin(patches: InventoryStatusPatch[]) {
      ensureScope();
      const valid = patches.filter(patch => rowId(patch) && patch.itemcode && patch.locationcode).map(patch => ({ ...patch }));
      const token = `inventory-status-${++tokenCounter}`;
      overlays.set(token, { patches: valid, confirmed: false });
      for (const pair of new Map(valid.map(patch => [pairKey(patch), pairOf(patch)])).values()) {
        const state = stateFor(pair);
        state.generation++;
        state.controller?.abort();
        publish(state);
      }
      options.onDisplayChange();
      return token;
    },
    async confirm(token: string, rows?: Row[]) {
      ensureScope();
      const overlay = overlays.get(token);
      if (!overlay) return false;
      overlay.confirmed = true;
      const affected = [...new Map(overlay.patches.map(patch => [pairKey(patch), pairOf(patch)])).values()];
      if (rows) {
        // Callers may supply only already validated receipts; reads use refresh().
        for (const [olderToken, older] of overlays) {
          if (olderToken === token) break;
          for (const patch of older.patches) for (const confirmedPatch of overlay.patches) {
            if (patch.unique_id !== confirmedPatch.unique_id || pairKey(patch) !== pairKey(confirmedPatch)
                || !rows.some(row => rowId(row) === patch.unique_id && revision(row) >= revision(stateFor(pairOf(patch)).rows.get(patch.unique_id) || {}))) continue;
            for (const field of fields) if (has(confirmedPatch, field)) delete patch[field];
          }
        }
        for (const pair of affected) {
          const state = stateFor(pair);
          const accepted = merge(state, rows);
          options.onRows(accepted, pair);
          const ids = new Set(accepted.map(rowId));
          overlay.patches = overlay.patches.filter(patch => pairKey(patch) !== pairKey(pair) || !ids.has(patch.unique_id));
        }
        if (!overlay.patches.length) overlays.delete(token);
        for (const pair of affected) publish(stateFor(pair));
        options.onDisplayChange();
        await Promise.all(affected.filter(pair => overlay.patches.some(patch => pairKey(patch) === pairKey(pair)) || queued.has(pairKey(pair))).map(refresh));
      } else await Promise.all(affected.map(refresh));
      return true;
    },
    async rollback(token: string) {
      ensureScope();
      const overlay = overlays.get(token);
      if (!overlay) return false;
      overlays.delete(token);
      const affected = [...new Map(overlay.patches.map(patch => [pairKey(patch), pairOf(patch)])).values()];
      for (const pair of affected) {
        publish(stateFor(pair));
        const key = pairKey(pair);
        if (queued.has(key) && !pending(key)) void refresh(pair);
      }
      options.onDisplayChange();
      return true;
    },
    getDisplayRow<T extends Row>(row: T): T {
      ensureScope();
      const key = pairKey(pairOf(row));
      const canonical = pairs.get(key)?.rows.get(rowId(row));
      // Preserve DOM identity and legacy aliases; only status fields are overlaid.
      const source = canonical && revision(canonical) >= revision(row) ? copyStatus(row, canonical) : row;
      return display(source, key) as T;
    },
    revalidate: refresh,
    handleUpdate(payload: { new?: unknown; old?: unknown }) {
      ensureScope();
      if (!active || !scope) return;
      for (const raw of [payload.old, payload.new]) {
        if (!raw || typeof raw !== 'object') continue;
        const pair = pairOf(raw as Row);
        if (pair.itemcode && pair.locationcode) { stateFor(pair); queued.add(pairKey(pair)); }
      }
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = undefined;
        for (const key of [...queued]) if (!pending(key)) void refresh(pairs.get(key)!.pair);
      }, options.debounceMs ?? 75);
    },
    resume() {
      ensureScope(); active = true;
      for (const state of pairs.values()) void refresh(state.pair);
    },
    suspend() {
      active = false;
      if (debounce) clearTimeout(debounce);
      debounce = undefined;
      for (const state of pairs.values()) {
        state.generation++;
        state.controller?.abort();
        if (state.retry) clearTimeout(state.retry);
        state.retry = undefined;
      }
    },
    reset() { clear(); scope = options.getScope(); active = true; options.onDisplayChange(); },
  };
  return api;
}
