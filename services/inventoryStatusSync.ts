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
const MAX_CONCURRENT_PAIR_READS = 4;
const MAX_QUEUED_PAIR_READS = 64;
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
  type State = { pair: Pair; rows: Map<string, Row>; generation: number; seeded: boolean; controller?: AbortController; retry?: ReturnType<typeof setTimeout> };
  type ReadJob = { key: string; pair: Pair; run(): Promise<void>; cancel(): void };
  let scope = options.getScope();
  let active = true;
  let sourceReady = true;
  let tokenCounter = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const pairs = new Map<string, State>();
  const queued = new Set<string>();
  let queuedOverflow = false;
  const recovery = new Set<string>();
  const readQueue: ReadJob[] = [];
  const queuedReads = new Set<string>();
  const activeReads = new Set<string>();
  const rerun = new Set<string>();
  let recoveryOverflow = false;
  const overlays = new Map<string, { patches: InventoryStatusPatch[]; confirmed: boolean }>();
  const mutate = options.mutate || swrMutate as unknown as Mutate;
  const cacheKey = (pair: Pair, identity = scope) => JSON.stringify(['inventory-status', identity, pair.itemcode, pair.locationcode]);
  const current = (identity: string) => active && identity === scope && identity === options.getScope();
  const canRead = () => active && sourceReady && !!scope;
  function queueRecovery(key: string) {
    if (recoveryOverflow) return;
    if (recovery.has(key)) return;
    if (recovery.size < MAX_QUEUED_PAIR_READS) recovery.add(key);
    else { recoveryOverflow = true; recovery.clear(); }
  }
  function clear() {
    if (debounce) clearTimeout(debounce);
    debounce = undefined;
    for (const state of pairs.values()) {
      state.controller?.abort();
      if (state.retry) clearTimeout(state.retry);
      void mutate(cacheKey(state.pair), undefined, { revalidate: false, rollbackOnError: false });
    }
    pairs.clear(); queued.clear(); queuedOverflow = false; recovery.clear(); cancelQueuedReads();
    queuedReads.clear(); rerun.clear(); recoveryOverflow = false; sourceReady = true; overlays.clear();
  }
  function ensureScope() {
    if (scope !== options.getScope()) { clear(); scope = options.getScope(); }
  }
  function stateFor(pair: Pair) {
    const key = pairKey(pair);
    if (!pairs.has(key)) pairs.set(key, { pair: { ...pair }, rows: new Map(), generation: 0, seeded: false });
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
    if (!canRead()) return;
    queued.add(pairKey(state.pair));
    if (!active || state.retry) return;
    state.retry = setTimeout(() => {
      state.retry = undefined;
      if (canRead()) void scheduleRefresh(state.pair);
    }, options.retryMs ?? 5000);
  }
  function pumpReads() {
    while (canRead() && activeReads.size < MAX_CONCURRENT_PAIR_READS && readQueue.length) {
      const job = readQueue.shift()!;
      queuedReads.delete(job.key);
      if (activeReads.has(job.key)) continue;
      activeReads.add(job.key);
      void job.run().finally(() => {
        activeReads.delete(job.key);
        const state = pairs.get(job.key);
        if (rerun.delete(job.key) && state?.seeded && canRead()) void scheduleRefresh(state.pair);
        pumpReads();
      });
    }
  }
  function cancelQueuedReads() {
    for (const job of readQueue) job.cancel();
    readQueue.length = 0;
    queuedReads.clear();
  }
  function scheduleRefresh(pair: Pair): Promise<Row[] | null> {
    ensureScope();
    if (!active || !scope) return Promise.resolve(null);
    const state = stateFor(pair), key = pairKey(pair), identity = scope;
    if (!sourceReady) {
      if (state.seeded) queueRecovery(key);
      return Promise.resolve(null);
    }
    if (pending(key)) { queued.add(key); return Promise.resolve(null); }
    if (queuedReads.has(key) || activeReads.has(key)) { rerun.add(key); return Promise.resolve(null); }
    if (readQueue.length >= MAX_QUEUED_PAIR_READS) return Promise.resolve(null);
    queued.delete(key);
    if (state.retry) clearTimeout(state.retry);
    state.retry = undefined;
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    const generation = ++state.generation;
    let accepted: Row[] | null = null;
    return new Promise(resolve => {
      queuedReads.add(key);
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve(accepted);
      };
      readQueue.push({ key, pair, cancel: finish, async run() {
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
        finish();
      } });
      pumpReads();
    });
  }
  const api = {
    seed(rows: Row[]) {
      ensureScope();
      for (const row of rows) {
        const pair = pairOf(row);
        if (rowId(row) && pair.itemcode && pair.locationcode) {
          const state = stateFor(pair);
          state.seeded = true;
          merge(state, [row]);
        }
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
        await Promise.all(affected.filter(pair => overlay.patches.some(patch => pairKey(patch) === pairKey(pair)) || queued.has(pairKey(pair))).map(scheduleRefresh));
      } else await Promise.all(affected.map(scheduleRefresh));
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
        if (queued.has(key) && !pending(key)) void scheduleRefresh(pair);
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
    revalidate: scheduleRefresh,
    handleUpdate(payload: { new?: unknown; old?: unknown }) {
      ensureScope();
      if (!active || !scope) return;
      for (const raw of [payload.old, payload.new]) {
        if (!raw || typeof raw !== 'object') continue;
        const pair = pairOf(raw as Row);
        const key = pairKey(pair), state = pairs.get(key);
        if (!pair.itemcode || !pair.locationcode || !state?.seeded) continue;
        if (!sourceReady) {
          queueRecovery(key);
        } else if (!queuedOverflow && !queued.has(key)) {
          if (queued.size < MAX_QUEUED_PAIR_READS) queued.add(key);
          else { queued.clear(); queuedOverflow = true; }
        }
      }
      if (!sourceReady || (!queued.size && !queuedOverflow)) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = undefined;
        if (!queuedOverflow) {
          for (const key of [...queued]) {
            const pairState = pairs.get(key);
            if (pairState?.seeded && !pending(key)) void scheduleRefresh(pairState.pair);
          }
        }
        queued.clear();
        queuedOverflow = false;
      }, options.debounceMs ?? 75);
    },
    setSourceReady(ready: boolean) {
      ensureScope();
      if (sourceReady === ready) return;
      sourceReady = ready;
      if (!ready) {
        if (debounce) clearTimeout(debounce);
        debounce = undefined;
        if (queuedOverflow) recoveryOverflow = true;
        for (const key of queued) {
          queueRecovery(key);
        }
        for (const key of rerun) {
          queueRecovery(key);
        }
        for (const overlay of overlays.values()) if (overlay.confirmed) for (const patch of overlay.patches) {
          const key = pairKey(patch);
          if (pairs.get(key)?.seeded) queueRecovery(key);
        }
        rerun.clear();
        queued.clear();
        queuedOverflow = false;
        cancelQueuedReads();
        for (const state of pairs.values()) {
          state.generation++;
          state.controller?.abort();
          if (state.retry) clearTimeout(state.retry);
          state.retry = undefined;
        }
        return;
      }
      if (recoveryOverflow) {
        recovery.clear();
        recoveryOverflow = false;
        return;
      }
      for (const key of recovery) if (pairs.get(key)?.seeded) queued.add(key);
      recovery.clear();
      if (!queued.size || !active) return;
      debounce = setTimeout(() => {
        debounce = undefined;
        for (const key of [...queued]) {
          const state = pairs.get(key);
          if (state?.seeded && !pending(key)) void scheduleRefresh(state.pair);
        }
        queued.clear();
      }, options.debounceMs ?? 75);
    },
    resume() {
      ensureScope(); active = true;
      pumpReads();
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
      queued.clear();
      queuedOverflow = false;
      cancelQueuedReads();
    },
    reset() { clear(); scope = options.getScope(); active = true; options.onDisplayChange(); },
  };
  return api;
}
