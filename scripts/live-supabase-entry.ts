import * as supabaseBrowser from '@supabase/supabase-js';
import { createLegacyDatabaseBridge, databaseClient } from '../services/liveDatabase';

declare global {
  interface Window {
    supabase: Omit<typeof supabaseBrowser, 'createClient'> & { createClient: typeof databaseClient };
    GncDatabase: ReturnType<typeof createLegacyDatabaseBridge>;
    fetchWithTimeout: (url: string, init: RequestInit, timeout: number, label: string) => Promise<Response>;
  }
}
window.supabase = { ...supabaseBrowser, createClient: databaseClient };
window.GncDatabase = createLegacyDatabaseBridge((url, init, timeout, label) => window.fetchWithTimeout(url, init, timeout, label));
