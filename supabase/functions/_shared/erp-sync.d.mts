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
  code?: string;
}

export function shouldIgnoreErpFile(name: unknown): boolean;
export function isLegacyRunScriptAction(action: unknown): boolean;
export function normalizeErpHeader(value: unknown): string;
export function validateErpSyncCommand(payload: unknown): ErpSyncCommandResult;
export function parseErpCsv(text: string): Record<string, string>[];
export function parseErpXlsx(bytes: ArrayBuffer | Uint8Array): Promise<Record<string, string>[]>;
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
  cursor?: Record<string, unknown>;
}): Promise<{ done: boolean; ok?: boolean; cursor: Record<string, unknown> }>;
