export interface SocHistorySyncResult {
  done: boolean;
  result: Record<string, unknown>;
}

export function runSocHistorySyncStep(options: {
  supabase: unknown;
  fetcher: typeof fetch;
  token: string;
  maxFilesPerSlice?: number;
  maxRowsPerFile?: number;
  rowsPerBatch?: number;
  filePartition?: { index: number; count: number };
  parseWorkbook?: (bytes: Uint8Array) => Promise<Array<{ name: string; rows: unknown[][] }>> | Array<{ name: string; rows: unknown[][] }>;
}): Promise<SocHistorySyncResult>;

export const SOC_ORDER_HISTORY_FOLDER: string;
