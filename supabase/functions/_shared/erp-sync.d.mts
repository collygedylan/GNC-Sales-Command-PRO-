export interface ErpSyncStatus {
  active?: boolean;
  status?: string;
  stageIndex?: number;
  stageResults?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ErpSyncCommandResult {
  ok: boolean;
  operation?: string;
  commandId?: string;
  runId?: string;
  maxRowsPerSlice?: number;
  code?: string;
}

export interface ErpSyncContinuationState extends Record<string, unknown> {
  stageIndex?: number;
  maxRowsPerSlice?: number;
  fileContinuation?: Record<string, unknown>;
}

export function shouldIgnoreErpFile(name: unknown): boolean;
export function isLegacyRunScriptAction(action: unknown): boolean;
export function normalizeErpHeader(value: unknown): string;
export function validateErpSyncCommand(payload: unknown): ErpSyncCommandResult;
export function resolveErpRowsPerSlice(dataset: string, requestedRows?: number): number;
export function parseErpCsv(text: string): Record<string, string>[];
export function parseErpXlsx(bytes: ArrayBuffer | Uint8Array): Promise<Record<string, string>[]>;
export function parseErpXlsxSheets(bytes: ArrayBuffer | Uint8Array): Promise<Array<{ name: string; rows: unknown[][] }>>;
export function normalizeErpRows(rawRows: Record<string, unknown>[], dataset: string,
  columns: string[]): Promise<Array<Record<string, unknown>>>;
export const ERP_SYNC_STAGES: ReadonlyArray<{ key: string; dataset: string }>;
export function runErpSyncWorker(options: {
  supabase: unknown;
  env: (key: string) => string;
  fetcher?: typeof fetch;
  accessToken: string;
  status: (patch: Record<string, unknown>) => Promise<unknown>;
}): Promise<{ ok: boolean; stageResults: Array<Record<string, unknown>> }>;
export function runErpSyncWorkerStep(options: {
  supabase: unknown;
  env: (key: string) => string;
  fetcher?: typeof fetch;
  accessToken: string;
  status: (patch: Record<string, unknown>) => Promise<unknown>;
  cursor?: ErpSyncContinuationState;
  maxRowsPerSlice?: number;
}): Promise<{ done: boolean; ok?: boolean; cursor: ErpSyncContinuationState }>;
export function driveUrl(path: string, params?: Record<string, string | number | boolean>): URL;
export function driveJson(fetcher: typeof fetch, token: string, path: string,
  params?: Record<string, string | number | boolean>, method?: string, body?: unknown): Promise<Record<string, unknown>>;
export function listFiles(fetcher: typeof fetch, token: string, folderId: string, importableOnly?: boolean): Promise<Array<Record<string, unknown>>>;
export function prefetchErpFolders(fetcher: typeof fetch, token: string, folders: Record<string, unknown>,
  existing?: Record<string, unknown>): Promise<Record<string, unknown>>;
export function processedFolder(fetcher: typeof fetch, token: string, parentId: string, configuredId?: string): Promise<string>;
export function moveProcessed(fetcher: typeof fetch, token: string, file: { id: string }, parentId: string,
  configuredId?: string): Promise<void>;
export function sourceBytes(fetcher: typeof fetch, token: string, file: { id: string }): Promise<Uint8Array>;
export function sourceWorkbookBytes(fetcher: typeof fetch, token: string, file: { id: string; mimeType?: string }): Promise<Uint8Array>;
export function stageFileContinuation(options: {
  supabase: unknown; fetcher: typeof fetch; token: string; file: { id: string; name: string; modifiedTime?: string };
  dataset: string; stageKey: string; parentId: string; processedId: string; status: (patch: Record<string, unknown>) => Promise<unknown>;
  state: Record<string, unknown> | null; maxRowsPerSlice?: number; sliceStartMs?: number;
}): Promise<{ done: boolean; result?: Record<string, unknown>; state?: Record<string, unknown> }>;
