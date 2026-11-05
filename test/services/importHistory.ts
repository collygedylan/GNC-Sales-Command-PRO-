export const importHistoryDatasets = ['drive', 'soc', 'reserves'] as const;
export type ImportHistoryDataset = typeof importHistoryDatasets[number];

export type ImportHistoryCursor = { reportDate: string; sequence: number };
export type ImportHistorySnapshot = {
  snapshotId: string;
  dataset: ImportHistoryDataset;
  displayLabel: string;
  reportDate: string;
  sequence: number;
  rowCount: number;
  columns: string[];
};
export type ImportHistoryFilePage = {
  files: ImportHistorySnapshot[];
  hasMore: boolean;
  nextCursor: ImportHistoryCursor | null;
};
export type ImportHistoryRow = { rowNumber: number; values: unknown[] };
export type ImportHistoryRowPage = {
  snapshotId: string;
  rows: ImportHistoryRow[];
  hasMore: boolean;
  nextRow: number | null;
};
export type ImportHistoryTransport = (
  rpcName: 'list_import_history_v1' | 'get_import_history_rows_v1',
  payload: Record<string, unknown>,
  signal: AbortSignal
) => Promise<unknown>;
export type ImportHistoryServiceConfig = {
  scopeKey: () => string;
  permissionVersion: () => string;
  transport: ImportHistoryTransport;
};

export const IMPORT_HISTORY_PAGE_SIZE = 50;
const SNAPSHOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sessions = new Map<string, ImportHistorySessionState>();
const MAX_CACHED_PAGES = 32;

type ImportHistorySessionState = {
  owner: string;
  generation: number;
  files: Map<string, ImportHistoryFilePage>;
  rows: Map<string, ImportHistoryRowPage>;
  inflight: Map<string, Promise<unknown>>;
  controllers: Set<AbortController>;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dataset(value: unknown): value is ImportHistoryDataset {
  return typeof value === 'string' && (importHistoryDatasets as readonly string[]).includes(value);
}

function parseCursor(value: unknown): ImportHistoryCursor | null {
  if (value === null) return null;
  if (!record(value) || !validDate(value.reportDate) || !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1) {
    throw new Error('Import history cursor is invalid.');
  }
  return { reportDate: value.reportDate, sequence: Number(value.sequence) };
}

function parseFilePage(value: unknown, expectedDataset: ImportHistoryDataset, limit: number): ImportHistoryFilePage {
  if (!record(value) || !Array.isArray(value.files) || value.files.length > limit || typeof value.hasMore !== 'boolean') {
    throw new Error('Import history snapshot list is invalid.');
  }
  const ids = new Set<string>();
  const files = value.files.map((entry): ImportHistorySnapshot => {
    if (!record(entry) || typeof entry.snapshotId !== 'string' || !SNAPSHOT_ID.test(entry.snapshotId)
      || entry.dataset !== expectedDataset || !validDate(entry.reportDate)
      || !Number.isSafeInteger(entry.sequence) || Number(entry.sequence) < 1
      || entry.displayLabel !== `${entry.reportDate} ${String(entry.sequence).padStart(2, '0')}`
      || !Number.isSafeInteger(entry.rowCount) || Number(entry.rowCount) < 0
      || !Array.isArray(entry.columns) || entry.columns.some(column => typeof column !== 'string')) {
      throw new Error('Import history snapshot metadata is invalid.');
    }
    if (ids.has(entry.snapshotId)) throw new Error('Import history snapshot list contains duplicate IDs.');
    ids.add(entry.snapshotId);
    return { snapshotId: entry.snapshotId, dataset: expectedDataset, displayLabel: entry.displayLabel,
      reportDate: entry.reportDate, sequence: Number(entry.sequence), rowCount: Number(entry.rowCount), columns: entry.columns.slice() };
  });
  const nextCursor = parseCursor(value.nextCursor);
  if (value.hasMore && (!files.length || !nextCursor)) throw new Error('Import history snapshot cursor is incomplete.');
  if (!value.hasMore && nextCursor !== null) throw new Error('Import history snapshot cursor should be empty.');
  return { files, hasMore: value.hasMore, nextCursor };
}

function parseRowPage(value: unknown, snapshotId: string, afterRow: number, limit: number, columnCount: number): ImportHistoryRowPage {
  if (!record(value) || value.snapshotId !== snapshotId || !Array.isArray(value.rows) || value.rows.length > limit
    || typeof value.hasMore !== 'boolean' || !(value.nextRow === null || Number.isSafeInteger(value.nextRow))) {
    throw new Error('Import history row page is invalid.');
  }
  let previous = afterRow;
  const rows = value.rows.map((entry): ImportHistoryRow => {
    if (!record(entry) || !Number.isSafeInteger(entry.rowNumber) || Number(entry.rowNumber) <= previous
      || !Array.isArray(entry.values) || entry.values.length !== columnCount) {
      throw new Error('Import history row is invalid.');
    }
    previous = Number(entry.rowNumber);
    return { rowNumber: previous, values: entry.values.slice() };
  });
  const nextRow = value.nextRow === null ? null : Number(value.nextRow);
  if (value.hasMore && (!rows.length || nextRow !== rows[rows.length - 1].rowNumber)) throw new Error('Import history row cursor is incomplete.');
  if (!value.hasMore && nextRow !== null) throw new Error('Import history row cursor should be empty.');
  return { snapshotId, rows, hasMore: value.hasMore, nextRow };
}

function abortError() {
  return Object.assign(new Error('Import history read was cancelled.'), { name: 'AbortError' });
}

function touchCache<T>(cache: Map<string, T>, key: string, value: T) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_CACHED_PAGES) cache.delete(cache.keys().next().value as string);
}

export function createImportHistoryService(config: ImportHistoryServiceConfig) {
  if (!config || typeof config.scopeKey !== 'function' || typeof config.permissionVersion !== 'function' || typeof config.transport !== 'function') {
    throw new TypeError('A scoped import history service is required.');
  }
  const owner = () => stable([String(config.scopeKey() || ''), String(config.permissionVersion() || '')]);
  const identity = owner();
  if (!String(config.scopeKey() || '').trim() || !String(config.permissionVersion() || '').trim()) {
    throw new Error('Import history requires an authorized session.');
  }
  let state = sessions.get(identity);
  if (!state) {
    state = { owner: identity, generation: 0, files: new Map(), rows: new Map(), inflight: new Map(), controllers: new Set() };
    sessions.set(identity, state);
  }
  const session = state;
  const invalidateStaleOwner = () => {
    if (sessions.get(identity) !== session) return;
    sessions.delete(identity);
    session.generation += 1;
    session.controllers.forEach(controller => controller.abort());
    session.controllers.clear(); session.inflight.clear(); session.files.clear(); session.rows.clear();
  };
  const assertCurrent = (generation: number) => {
    if (owner() !== identity) invalidateStaleOwner();
    if (sessions.get(identity) !== session || session.generation !== generation) throw abortError();
  };
  const request = <T>(key: string, cache: Map<string, T>, refresh: boolean, fetch: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    try {
      assertCurrent(session.generation);
    } catch (error) {
      return Promise.reject(error);
    }
    if (!refresh && cache.has(key)) {
      const cached = cache.get(key)!;
      touchCache(cache, key, cached);
      return Promise.resolve(cached);
    }
    const pending = session.inflight.get(key);
    if (pending) return pending as Promise<T>;
    const generation = session.generation, controller = new AbortController();
    session.controllers.add(controller);
    const task = fetch(controller.signal).then(value => {
      assertCurrent(generation);
      touchCache(cache, key, value);
      return value;
    }).finally(() => {
      session.controllers.delete(controller);
      if (session.inflight.get(key) === task) session.inflight.delete(key);
    });
    session.inflight.set(key, task);
    return task;
  };
  return {
    identity,
    listSnapshots(datasetValue: ImportHistoryDataset, cursor: ImportHistoryCursor | null = null, refresh = false) {
      if (!dataset(datasetValue)) return Promise.reject(new Error('Import history dataset is invalid.'));
      const key = stable(['files', datasetValue, cursor]);
      return request(key, session.files, refresh, async signal => parseFilePage(
        await config.transport('list_import_history_v1', {
          p_dataset: datasetValue, p_before_date: cursor?.reportDate ?? null,
          p_before_sequence: cursor?.sequence ?? null, p_limit: IMPORT_HISTORY_PAGE_SIZE
        }, signal), datasetValue, IMPORT_HISTORY_PAGE_SIZE));
    },
    readRows(snapshotId: string, columns: readonly string[], afterRow = 0, refresh = false) {
      const id = String(snapshotId || '').trim();
      if (!SNAPSHOT_ID.test(id) || !Array.isArray(columns) || !columns.length || columns.some(column => typeof column !== 'string')
        || !Number.isSafeInteger(afterRow) || afterRow < 0) return Promise.reject(new Error('Import history row cursor is invalid.'));
      const key = stable(['rows', id, afterRow]);
      return request(key, session.rows, refresh, async signal => parseRowPage(
        await config.transport('get_import_history_rows_v1', { p_snapshot_id: id, p_after_row: afterRow,
          p_limit: IMPORT_HISTORY_PAGE_SIZE }, signal), id, afterRow, IMPORT_HISTORY_PAGE_SIZE, columns.length));
    },
    prefetchSnapshotChoices() {
      return Promise.allSettled(importHistoryDatasets.map(value => this.listSnapshots(value)));
    },
    clear() {
      if (sessions.get(identity) === session) sessions.delete(identity);
      session.generation += 1;
      session.controllers.forEach(controller => controller.abort());
      session.controllers.clear(); session.inflight.clear(); session.files.clear(); session.rows.clear();
    }
  };
}

export function clearImportHistorySessions() {
  for (const session of sessions.values()) {
    session.generation += 1;
    session.controllers.forEach(controller => controller.abort());
    session.controllers.clear(); session.inflight.clear(); session.files.clear(); session.rows.clear();
  }
  sessions.clear();
}
