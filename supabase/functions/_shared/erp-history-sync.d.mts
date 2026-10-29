export interface SocHistorySyncResult {
  done: boolean;
  result: Record<string, unknown>;
}

export function runSocHistorySyncStep(options: {
  supabase: unknown;
  fetcher: typeof fetch;
  token: string;
  maxFilesPerSlice?: number;
}): Promise<SocHistorySyncResult>;

export const SOC_ORDER_HISTORY_FOLDER: string;
