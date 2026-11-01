import * as supabaseBrowser from '@supabase/supabase-js';
import { createLegacyDatabaseBridge, databaseClient } from '../services/liveDatabase';

declare global {
  interface Window {
    supabase: Omit<typeof supabaseBrowser, 'createClient'> & { createClient: typeof databaseClient };
    GncDatabase: ReturnType<typeof createLegacyDatabaseBridge>;
    AgDataKernel?: { sync?: { waitForInteractiveOwnerWrites?: (url: string, init: RequestInit) => Promise<void> } };
    fetchWithTimeout: (url: string, init: RequestInit, timeout: number, label: string) => Promise<Response>;
    AgMetricInventoryList?: {
      decodeCsvRows: (text: string, expectedColumns: readonly string[]) => unknown;
    };
  }
}
window.supabase = { ...supabaseBrowser, createClient: databaseClient };
window.GncDatabase = createLegacyDatabaseBridge(
  async (url, init, timeout, label) => {
    await window.AgDataKernel?.sync?.waitForInteractiveOwnerWrites?.(url, init);
    const response = await window.fetchWithTimeout(url, init, timeout, label);
    await window.AgDataKernel?.sync?.waitForInteractiveOwnerWrites?.(url, init);
    return response;
  },
  (text, expectedColumns) => {
    const decoder = window.AgMetricInventoryList?.decodeCsvRows;
    if (!decoder) throw new Error('Master inventory CSV decoder is unavailable.');
    return decoder(text, expectedColumns);
  },
);
