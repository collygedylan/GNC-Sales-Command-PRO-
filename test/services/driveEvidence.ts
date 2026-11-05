import type { Database } from '../supabase/functions/_shared/database.types';
import { contracts } from './database-contracts.generated';
import { matchesSchema, type Schema } from './database-contract-runtime';

type InventoryRow = Database['public']['Tables']['ph_master_inventory']['Row'];
export const driveEvidenceColumns = [
  'unique_id', 'itemcode', 'locationcode', 'lotcode', 'last_updated',
  'photo_link', 'photo_name', 'match', 'spec', 'caliper', 'initial_ptr', 'loc_match_qty',
  'ptravailable', 'av_note', 'pic_note', 'sales_note', 'date_completed', 'app_tab_assignment',
  'av_rule_av_note_updated_at', 'av_rule_bundle_updated_at', 'av_rule_caliper_updated_at',
  'av_rule_holdstop_snapshot', 'av_rule_last_clear_reason', 'av_rule_last_cleared_at',
  'av_rule_match_updated_at', 'av_rule_photo_updated_at', 'av_rule_priority_snapshot',
  'av_rule_spec_updated_at',
] as const satisfies readonly (keyof InventoryRow)[];
export type DriveEvidenceRow = Pick<InventoryRow, typeof driveEvidenceColumns[number]>;

function record(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}
function evidenceRow(input: unknown): input is DriveEvidenceRow {
  if (!record(input)) return false;
  const schema = contracts.tables.ph_master_inventory.row;
  if (typeof schema !== 'object' || !('object' in schema)) return false;
  const fields: Record<string, { schema: Schema }> = {};
  const values: Record<string, unknown> = {};
  for (const key of driveEvidenceColumns) {
    fields[key] = schema.object[key];
    values[key] = input[key];
  }
  return matchesSchema({ object: fields }, values);
}

// PostgreSQL revisions can differ within one millisecond. Retain microseconds
// when comparing acknowledgements and reads; Date.parse alone loses them.
export function driveEvidenceRevision(input: unknown): number {
  if (typeof input !== 'string') return 0;
  const parts = input.match(/^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.\d{1,6})?(?:Z|[+-]\d\d(?::?\d\d)?)$/);
  if (!parts) return 0;
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day
    || hour > 23 || minute > 59 || second > 59) return 0;
  const milliseconds = Date.parse(input.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
  const fraction = input.match(/\.(\d+)/)?.[1] || '';
  const microseconds = milliseconds * 1000 + Number(fraction.padEnd(6, '0').slice(3));
  return Number.isSafeInteger(microseconds) && microseconds > 0 ? microseconds : 0;
}

export function confirmedDriveEvidence(input: unknown): DriveEvidenceRow {
  if (!record(input) || input.ok !== true || input.canonicalConfirmed !== true
    || !evidenceRow(input.row) || !input.row.unique_id.trim() || !driveEvidenceRevision(input.row.last_updated)) {
    throw new Error('The saved Drive evidence could not be verified. Reopen the item before retrying.');
  }
  return input.row;
}
