// Compile-only contract probes. These functions are never invoked at runtime.
// An unused @ts-expect-error fails tsc if an untyped client weakens these gates.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../supabase/functions/_shared/database.types';
import type { Database as SandboxDatabase } from './sandbox.database.types';

export async function databaseTypeProof(production: SupabaseClient<Database>, sandbox: SupabaseClient<SandboxDatabase>) {
  // @ts-expect-error Missing relations must not become arbitrary string queries.
  production.from('ph_inventroy_typo');
  // @ts-expect-error RPC names must exist in the generated schema.
  production.rpc('aura_missing_operation', {});
  // @ts-expect-error RPC argument names are part of the generated contract.
  production.rpc('aura_resolve_season_v1', { wrong_actor: 'id' });
  // @ts-expect-error The sandbox quantity column is numeric.
  sandbox.from('ph_active_request').update({ req_qty: 'not a quantity' });
  const invalid = await production.from('ph_master_inventory').select('unique_id,missing_column');
  // @ts-expect-error SelectQueryError must not satisfy an application row DTO.
  const rows: Array<{ unique_id: string }> = invalid.data || [];
  return rows;
}
