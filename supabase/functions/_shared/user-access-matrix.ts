import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";
import type { Database } from "./database.types.ts";
export function normalizeAccessMatrixUsername(value: unknown): string {
  const name=String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  return name==='nally_aguilar'?'nelly_aguilar':/^(?:chance_alldredge|alldredge_chance)(?:_south_tx)?$/.test(name)?'chance_alldredge':name;
}
export function accessMatrixAllows(matrix: Record<string, unknown> | null | undefined, permission: string): boolean {
  const value = permission.startsWith('view_')
    ? (matrix?.view_permissions as Record<string, unknown> | null | undefined)?.[permission] ?? matrix?.[permission]
    : matrix?.[permission];
  return /^(?:y|yes|true|1)$/i.test(String(value ?? ''));
}
export async function resolveUserAccessMatrix(client: Pick<SupabaseClient<Database>,'from'>, username: unknown): Promise<Record<string, unknown> | null> {
  const result=await client.from('user_access' as never).select('*').eq('username',normalizeAccessMatrixUsername(username)).maybeSingle();
  if(result.error)throw result.error;
  return result.data as Record<string, unknown> | null;
}
