import { createClient, type PostgrestSingleResponse, type SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js';
import type { Database } from '../supabase/functions/_shared/database.types';
import { createDatabaseRestBridge, type FetchWithTimeout } from './databaseRest';
import { confirmedDriveEvidence, driveEvidenceRevision, driveEvidenceColumns } from './driveEvidence';
import { requestRecipientDirectoryFromResult } from './requestRecipients';
import { reclassShearedProposal } from './reclassSheared';
import { confirmedReclassLiveEditsFromResult } from './reclassLiveEdits';
import { inquiryFieldEdits, validateReclassEditableFieldProposals } from './reclassEditableFields';
import { createInventoryReclassMovesService } from './reclassMoves';
import { mountCustomerRepMapping } from './customerRepMapping';
import { prefetchCustomerRepOptions } from './customerRepAssignments';
import { historicalRequestsQuery } from './historicalRequests';
import { createInventoryStatusSync } from './inventoryStatusSync';
import { createRequestArchivePagesService, type RequestArchivePageReader } from './requestArchivePages';
export { tableName, rpcName, validateQuery, tableRequest } from './databaseRest';
export const browserDatabaseTableAliases = Object.freeze({
  ph_active_suspend: 'ph_soc_master',
} as const);

type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'legacy_user_id' | 'username' | 'display_name' | 'role' | 'division' | 'language' | 'disabled_at' | 'locked_until' | 'must_change_password' | 'passkey_pilot'>;
export function databaseClient(url: string, key: string, options?: SupabaseClientOptions<'public'>) {
  return createClient<Database>(url, key, options);
}
export function createLegacyDatabaseBridge(fetcher: FetchWithTimeout) {
  return {
    ...createDatabaseRestBridge(fetcher, browserDatabaseTableAliases),
    confirmedDriveEvidence, driveEvidenceRevision, driveEvidenceColumns,
    requestRecipientDirectoryFromResult,
    reclassShearedProposal,
    confirmedReclassLiveEditsFromResult,
    createInventoryStatusSync,
    createRequestArchivePagesService(readPage: RequestArchivePageReader) {
      return createRequestArchivePagesService(readPage);
    },
    inquiryFieldEdits, validateReclassEditableFieldProposals,
    createInventoryReclassMovesService,
    mountCustomerRepMapping,
    prefetchCustomerRepOptions,
    async readHistoricalRequests(client: SupabaseClient<Database>, input: unknown, signal?: AbortSignal) {
      const query = historicalRequestsQuery(input);
      const args: Database['public']['Functions']['historical_requests_read_v1']['Args'] = { p_query: { ...query } };
      const request = client.rpc('historical_requests_read_v1', args);
      const { data, error } = await (signal ? request.abortSignal(signal) : request);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data;
    },
    readProfile(client: SupabaseClient<Database>, userId: string): PromiseLike<PostgrestSingleResponse<Profile | null>> {
      if (typeof userId !== 'string' || !userId) throw new Error('An authenticated user ID is required.');
      return client.from('profiles')
        .select('id,legacy_user_id,username,display_name,role,division,language,disabled_at,locked_until,must_change_password,passkey_pilot')
        .eq('id', userId).maybeSingle();
    },
  };
}
