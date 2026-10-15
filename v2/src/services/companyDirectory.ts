import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../supabase/functions/_shared/database.types';
import { z } from 'zod';
export const TABLES = {
  contacts: 'ph_company_directory_contacts',
  blocks: 'ph_company_directory_blocks',
  beds: 'ph_company_directory_beds',
  codes: 'ph_company_directory_codes'
} as const;

export type Kind = 'contacts' | 'blocks' | 'codes';
export type DirectoryRow = Record<string, unknown> & { id: string; letter?: string };
export type DirectoryUser = { id: string; username: string; display_name: string | null; disabled_at: string | null; locked_until: string | null; must_change_password: boolean };

const nullableText = z.string().nullable();
const contactInput = z.object({ name: z.string().min(1), location: z.string().min(1),
  department: nullableText, extension: nullableText, cell_number: nullableText, home_number: nullableText }).strict();
const bedInput = z.object({ block_letter: z.string().regex(/^[A-L]$/), bed_identifier: z.string().min(1), capacity: z.number().positive() }).strict();
const codeInput = z.object({ code: z.string().min(1), description: z.string().min(1), department_reference: nullableText }).strict();
export async function saveDirectoryRecord(active: SupabaseClient<Database>, kind: Kind, input: unknown, id?: string) {
  if (kind === 'contacts') {
    const values = contactInput.parse(input);
    return id ? active.from(TABLES.contacts).update(values).eq('id', id).select('*').single()
      : active.from(TABLES.contacts).insert(values).select('*').single();
  }
  if (kind === 'blocks') {
    const values = bedInput.parse(input);
    return id ? active.from(TABLES.beds).update(values).eq('id', id).select('*').single()
      : active.from(TABLES.beds).insert(values).select('*').single();
  }
  const values = codeInput.parse(input);
  return id ? active.from(TABLES.codes).update(values).eq('id', id).select('*').single()
    : active.from(TABLES.codes).insert(values).select('*').single();
}


export type DirectorySnapshot = { rows: Record<Kind, DirectoryRow[]>; blocks: Array<{letter: string; name: string | null}> };
const dataTables = [TABLES.contacts, TABLES.beds, TABLES.codes] as const;
export async function readDirectorySnapshot(active: SupabaseClient<Database>, owner: string): Promise<DirectorySnapshot> {
  async function assertOwner() {
    const { data } = await active.auth.getSession();
    if (data.session?.user.id !== owner) throw new Error('Directory session changed.');
  }
  await assertOwner();
  const pages = await Promise.all(dataTables.map(async table => {
    const rows: DirectoryRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await active.from(table).select('*').order('id').range(offset, offset + 999);
      if (result.error) throw result.error;
      await assertOwner();
      rows.push(...(result.data || []));
      if ((result.data?.length || 0) < 1000) return rows;
    }
  }));
  const blocks = await active.from(TABLES.blocks).select('letter,name').order('letter');
  if (blocks.error) throw blocks.error;
  await assertOwner();
  return { rows: { contacts: pages[0], blocks: pages[1], codes: pages[2] }, blocks: blocks.data || [] };
}
export function removeDirectoryRecord(active: SupabaseClient<Database>, kind: Kind, id: string) {
  return active.from(kind === 'blocks' ? TABLES.beds : TABLES[kind]).delete().eq('id', id).select('id').maybeSingle();
}
export function updateDirectoryBlock(active: SupabaseClient<Database>, letter: string, name: string) {
  return active.from(TABLES.blocks).update({name}).eq('letter',letter);
}
export function removeDirectoryBlock(active: SupabaseClient<Database>, letter: string) {
  return active.from(TABLES.blocks).delete().eq('letter',letter).select('letter').maybeSingle();
}
export function addDirectoryBlock(active: SupabaseClient<Database>, letter: string) {
  return active.from(TABLES.blocks).insert({letter, name: 'Block '+letter}).select('letter,name').single();
}
export function readDirectoryProfile(active: SupabaseClient<Database>, id: string) {
  return active.from('profiles').select('id,username,display_name,disabled_at,locked_until,must_change_password').eq('id',id).maybeSingle();
}
export function subscribeDirectoryRevision(active: SupabaseClient<Database>, owner: string, changed: () => void) {
  if (!active.channel) return () => {};
  const sources = new Set(Object.values(TABLES));
  const channel=active.channel('company-directory:'+owner).on('postgres_changes', {
    event: 'UPDATE', schema: 'public', table: 'app_dataset_revisions'
  }, payload => { if ('key' in payload.new && sources.has(payload.new.key)) changed(); }).subscribe();
  return () => { void active.removeChannel(channel); };
}
