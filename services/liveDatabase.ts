import { createClient, type PostgrestSingleResponse, type SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js';
import type { Database } from '../supabase/functions/_shared/database.types';
import { createDatabaseRestBridge, type FetchWithTimeout } from './databaseRest';
import { confirmedDriveEvidence, driveEvidenceRevision, driveEvidenceColumns } from './driveEvidence';
import { requestRecipientDirectoryFromResult } from './requestRecipients';
import { reclassShearedProposal } from './reclassSheared';
import { confirmedReclassLiveEditsFromResult } from './reclassLiveEdits';
import { inquiryFieldEdits, validateReclassEditableFieldProposals } from './reclassEditableFields';
export { tableName, rpcName, validateQuery, tableRequest } from './databaseRest';
type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'legacy_user_id' | 'username' | 'display_name' | 'role' | 'division' | 'language' | 'disabled_at' | 'locked_until' | 'must_change_password' | 'passkey_pilot'>;
export function databaseClient(url: string, key: string, options?: SupabaseClientOptions<'public'>) {
  return createClient<Database>(url, key, options);
}
export function createLegacyDatabaseBridge(fetcher: FetchWithTimeout) {
  return {
    ...createDatabaseRestBridge(fetcher),
    confirmedDriveEvidence, driveEvidenceRevision, driveEvidenceColumns,
    requestRecipientDirectoryFromResult,
    reclassShearedProposal,
    confirmedReclassLiveEditsFromResult,
    inquiryFieldEdits, validateReclassEditableFieldProposals,
    readProfile(client: SupabaseClient<Database>, userId: string): PromiseLike<PostgrestSingleResponse<Profile | null>> {
      if (typeof userId !== 'string' || !userId) throw new Error('An authenticated user ID is required.');
      return client.from('profiles')
        .select('id,legacy_user_id,username,display_name,role,division,language,disabled_at,locked_until,must_change_password,passkey_pilot')
        .eq('id', userId).maybeSingle();
    },
  };
}
