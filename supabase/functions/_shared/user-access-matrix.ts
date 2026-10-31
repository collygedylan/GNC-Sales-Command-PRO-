import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";
import type { Database } from "./database.types.ts";
export function normalizeAccessMatrixUsername(value: unknown): string {
  const name=String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  return name==='nally_aguilar'?'nelly_aguilar':name;
}
export async function resolveUserAccessMatrix(client: Pick<SupabaseClient<Database>,'from'>, username: unknown): Promise<Record<string, unknown> | null> {
  const result=await client.from('user_access' as never).select('*').eq('username',normalizeAccessMatrixUsername(username)).maybeSingle();
  if(result.error)throw result.error;
  return result.data as Record<string, unknown> | null;
}
