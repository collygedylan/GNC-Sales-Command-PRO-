import * as supabaseBrowser from '@supabase/supabase-js';
import { createLegacyDatabaseBridge, databaseClient } from '../services/liveDatabase';

declare global {
  interface Window {
    supabase: Omit<typeof supabaseBrowser, 'createClient'> & { createClient: typeof databaseClient };
    GncDatabase: ReturnType<typeof createLegacyDatabaseBridge>;
    fetchWithTimeout: (url: string, init: RequestInit, timeout: number, label: string) => Promise<Response>;
    AgMetricInventoryList?: {
      decodeCsvRows: (text: string, expectedColumns: readonly string[]) => unknown;
    };
  }
}
window.supabase = { ...supabaseBrowser, createClient: databaseClient };
window.GncDatabase = createLegacyDatabaseBridge(
  (url, init, timeout, label) => window.fetchWithTimeout(url, init, timeout, label),
  (text, expectedColumns) => {
    const decoder = window.AgMetricInventoryList?.decodeCsvRows;
    if (!decoder) throw new Error('Master inventory CSV decoder is unavailable.');
    return decoder(text, expectedColumns);
  },
);
