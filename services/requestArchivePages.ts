export interface RequestArchivePage<Row = unknown> {
  rows: Row[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface RequestArchivePageRequest {
  offset: number;
  limit: number;
}

export type RequestArchivePageReader = (
  request: RequestArchivePageRequest,
  signal?: AbortSignal,
) => Promise<unknown>;

export interface RequestArchivePagesService<Row = unknown> {
  peek(scopeKey: string, offset: number, limit: number): RequestArchivePage<Row> | null;
  read(scopeKey: string, offset: number, limit: number, signal?: AbortSignal): Promise<RequestArchivePage<Row>>;
  invalidate(scopeKey?: string, offset?: number, limit?: number): void;
  clear(): void;
}

type CachedPage<Row> = {
  scopeKey: string;
  page: RequestArchivePage<Row>;
};

function archivePageKey(scopeKey: string, offset: number, limit: number): string {
  return JSON.stringify([scopeKey, offset, limit]);
}

function validatedRequest(scopeKey: string, offset: number, limit: number): RequestArchivePageRequest {
  if (typeof scopeKey !== 'string' || !scopeKey.trim()) throw new Error('An archived request identity scope is required.');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid archived request page offset.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid archived request page limit.');
  return { offset, limit };
}

function parseArchivePage<Row>(value: unknown, request: RequestArchivePageRequest): RequestArchivePage<Row> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid archived request page response.');
  const page = value as Record<string, unknown>;
  const offset = Number(page.offset);
  const limit = Number(page.limit);
  const total = Number(page.total);
  if (!Number.isSafeInteger(offset) || offset !== request.offset) throw new Error('Archived request page offset did not match the request.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid archived request page limit response.');
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid archived request total.');
  if (!Array.isArray(page.rows) || page.rows.length > limit) throw new Error('Invalid archived request page rows.');
  if (typeof page.hasMore !== 'boolean') throw new Error('Invalid archived request page continuation flag.');
  return { rows: page.rows as Row[], total, offset, limit, hasMore: page.hasMore };
}

function copyPage<Row>(page: RequestArchivePage<Row>): RequestArchivePage<Row> {
  return { ...page, rows: page.rows.slice() };
}

function abortError(): Error {
  const error = new Error('Archived request page read was cancelled.');
  error.name = 'AbortError';
  return error;
}

export function createRequestArchivePagesService<Row = unknown>(
  readPage: RequestArchivePageReader,
  options: { maxEntries?: number } = {},
): RequestArchivePagesService<Row> {
  if (typeof readPage !== 'function') throw new Error('An archived request page reader is required.');
  const maxEntries = Math.max(1, Math.min(64, Math.floor(Number(options.maxEntries) || 12)));
  const pages = new Map<string, CachedPage<Row>>();

  const touch = (key: string, entry: CachedPage<Row>) => {
    pages.delete(key);
    pages.set(key, entry);
  };

  return {
    peek(scopeKey, offset, limit) {
      const request = validatedRequest(scopeKey, offset, limit);
      const key = archivePageKey(scopeKey, request.offset, request.limit);
      const cached = pages.get(key);
      if (!cached) return null;
      touch(key, cached);
      return copyPage(cached.page);
    },
    async read(scopeKey, offset, limit, signal) {
      const request = validatedRequest(scopeKey, offset, limit);
      if (signal?.aborted) throw abortError();
      const raw = await readPage(request, signal);
      if (signal?.aborted) throw abortError();
      const page = parseArchivePage<Row>(raw, request);
      const key = archivePageKey(scopeKey, request.offset, request.limit);
      pages.delete(key);
      pages.set(key, { scopeKey, page });
      while (pages.size > maxEntries) pages.delete(pages.keys().next().value as string);
      return copyPage(page);
    },
    invalidate(scopeKey, offset, limit) {
      if (scopeKey === undefined) {
        pages.clear();
        return;
      }
      if (offset !== undefined && limit !== undefined) {
        pages.delete(archivePageKey(scopeKey, offset, limit));
        return;
      }
      for (const [key, entry] of pages) if (entry.scopeKey === scopeKey) pages.delete(key);
    },
    clear() {
      pages.clear();
    },
  };
}
