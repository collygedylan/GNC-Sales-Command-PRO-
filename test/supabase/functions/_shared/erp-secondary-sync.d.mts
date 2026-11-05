export type SecondaryErpStageKey = 'transactions_keyed' | 'stine_lumber' | 'pikes' | 'hl_po_parsed';
export type SecondaryErpFieldType = 'text' | 'number' | 'datetime';

export interface SecondaryErpStage {
  key: SecondaryErpStageKey;
  folder: string;
  processed: string;
  includeParent?: boolean;
}

export interface SecondaryWorkbookSheet {
  name: string;
  rows: unknown[][];
}

export interface SecondarySheet extends SecondaryWorkbookSheet {
  header: number;
  indexes: Record<string, number>;
}

export interface SecondaryErpFile {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  parents?: string[];
}

export interface SecondaryErpRowState extends Record<string, unknown> {
  digest?: string;
  batchId?: string;
  nextOffset?: number;
  nextPage?: number;
  rowCount?: number;
}

export interface SecondaryErpCursor extends Record<string, unknown> {
  coreComplete?: boolean;
  secondaryIndex?: number;
  secondaryFolders?: Record<string, { files: SecondaryErpFile[]; listDurationMs: number }>;
  secondaryFile?: SecondaryErpRowState & { file?: SecondaryErpFile };
  secondaryAttempted?: Record<string, string[]>;
  stageResults?: Array<Record<string, unknown>>;
}

export interface SecondaryWorkbookRowPage {
  rows: Array<Record<string, unknown>>;
  nextOffset: number;
  done: boolean;
}

export interface SecondaryErpStepResult {
  done: boolean;
  cursor: SecondaryErpCursor;
}

export const SECONDARY_ERP_STAGES: ReadonlyArray<Readonly<SecondaryErpStage>>;
export const TRANSACTION_COLUMNS: ReadonlyArray<Readonly<{
  header: string;
  key: string;
  type: SecondaryErpFieldType;
}>>;

export function readSecondarySheet(workbook: SecondaryWorkbookSheet[], sourceKey: string): SecondarySheet;
export function buildSecondaryRows(
  sheet: SecondarySheet,
  stage: SecondaryErpStage,
  file: SecondaryErpFile,
  state: SecondaryErpRowState,
  limit?: number,
  now?: () => number,
): Promise<SecondaryWorkbookRowPage>;
export function prefetchSecondaryFolders(
  fetcher: typeof fetch,
  token: string,
): Promise<Record<string, { files: SecondaryErpFile[]; listDurationMs: number }>>;
export function runSecondaryErpSyncStep(options: {
  supabase: unknown;
  fetcher?: typeof fetch;
  accessToken: string;
  env: (key: string) => string;
  status: (patch: Record<string, unknown>) => Promise<unknown>;
  cursor?: SecondaryErpCursor;
  parseWorkbook?: (bytes: Uint8Array) => Promise<SecondaryWorkbookSheet[]>;
}): Promise<SecondaryErpStepResult>;
