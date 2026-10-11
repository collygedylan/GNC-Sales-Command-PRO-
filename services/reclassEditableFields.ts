import type { Database } from '../supabase/functions/_shared/database.types.ts';
import { RECLASS_SHEARED_POLICY, validateReclassShearedProposals } from './reclassSheared.ts';
import { RECLASS_SMART_SHIELD_POLICY, validateReclassSmartShieldProposals } from './reclassSmartShield.ts';

export const RECLASS_EDITABLE_FIELDS_POLICY = 'reclass-action-workflow-v7-editable-fields-20261009' as const;
export const inquiryEditableFields = [
  'locationnote', 'locationptn1', 'desigitem', 'desigcust', 'desigloc',
  'pullerresponsibility', 'oversellpercentage', 'salesnote', 'suspend',
] as const satisfies readonly (keyof Database['public']['Tables']['ph_master_inventory']['Row'])[];
export type InquiryEditableField = typeof inquiryEditableFields[number];
export type InquiryFieldValues = Pick<Database['public']['Tables']['ph_master_inventory']['Row'], InquiryEditableField>;
export type InquiryFieldEdit = { field: Exclude<InquiryEditableField, 'suspend'>; expected: string | null; value: string | null }
  | { field: 'suspend'; expected: string | null; decision: 'yes' | 'no' };
export interface ConfirmedInquiryFields {
  unique_id: string;
  before: InquiryFieldValues;
  after: InquiryFieldValues;
  changedFields: InquiryEditableField[];
  stamps: { prisetby: string | null; priupdated: string | null; locationnotedate: string | null; evaldate: string };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function fieldName(value: unknown): value is InquiryEditableField {
  return typeof value === 'string' && inquiryEditableFields.some(field => field === value);
}
function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Both the JavaScript bridge and Edge validate the same fixed, database-typed field boundary. */
export function inquiryFieldEdits(value: unknown): InquiryFieldEdit[] {
  if (!Array.isArray(value) || value.length > inquiryEditableFields.length) throw new Error('DRIVE_RECLASS_V7_FIELDS_INVALID');
  const seen = new Set<string>();
  return value.map((entry): InquiryFieldEdit => {
    if (!record(entry) || !fieldName(entry.field) || seen.has(entry.field) || !nullableText(entry.expected)
      || typeof entry.expected === 'string' && entry.expected.length > 4000) throw new Error('DRIVE_RECLASS_V7_FIELD_INVALID');
    seen.add(entry.field);
    if (entry.field === 'suspend') {
      if (!exactKeys(entry, ['field', 'expected', 'decision']) || !['yes', 'no'].includes(String(entry.decision))) throw new Error('DRIVE_RECLASS_V7_SUSPEND_INVALID');
      return { field: 'suspend', expected: entry.expected, decision: entry.decision === 'yes' ? 'yes' : 'no' };
    }
    if (!exactKeys(entry, ['field', 'expected', 'value']) || !nullableText(entry.value)
      || typeof entry.value === 'string' && entry.value.length > 4000) throw new Error('DRIVE_RECLASS_V7_FIELD_INVALID');
    return { field: entry.field, expected: entry.expected, value: entry.value };
  });
}

export function validateReclassEditableFieldProposals(payload: Record<string, unknown>): void {
  if (payload.workflowPolicyVersion !== RECLASS_EDITABLE_FIELDS_POLICY) return;
  validateReclassShearedProposals({ ...payload, workflowPolicyVersion: RECLASS_SHEARED_POLICY });
  const transaction = payload.transaction;
  if (!record(transaction) || !Array.isArray(transaction.requestActions) || !Array.isArray(transaction.holdStopProposals)
    || !Array.isArray(payload.rowOverlays)) throw new Error('DRIVE_RECLASS_V7_SHAPE_INVALID');
  let hasFields = false;
  let hasTrio = transaction.holdStopProposals.length > 0;
  for (const row of payload.rowOverlays) {
    if (!record(row) || !Array.isArray(row.proposals)) throw new Error('DRIVE_RECLASS_V7_ROW_INVALID');
    const edits = inquiryFieldEdits(row.fieldEdits ?? []);
    hasFields ||= edits.length > 0;
    hasTrio ||= row.proposals.some(proposal => record(proposal) && proposal.action === 'priority_change');
    if (edits.some(edit => edit.field === 'desigitem') && row.proposals.some(proposal => record(proposal) && proposal.action === 'sheared')) {
      throw new Error('DRIVE_RECLASS_V7_DESIGNATION_PROPOSAL_CONFLICT');
    }
  }
  if (hasFields !== transaction.requestActions.includes('inventory_fields')) throw new Error('DRIVE_RECLASS_V7_ACTIONS_INVALID');
  if (hasTrio) validateReclassSmartShieldProposals({ ...payload, workflowPolicyVersion: RECLASS_SMART_SHIELD_POLICY });
}

function fieldValues(value: unknown): InquiryFieldValues {
  if (!record(value) || !exactKeys(value, inquiryEditableFields) || !inquiryEditableFields.every(field => nullableText(value[field]))) {
    throw new Error('RECLASS_INVENTORY_FIELDS_INVALID');
  }
  // Narrow each property individually; the generated schema remains the result contract.
  const text = (field: InquiryEditableField): string | null => {
    const entry = value[field];
    if (!nullableText(entry)) throw new Error('RECLASS_INVENTORY_FIELDS_INVALID');
    return entry;
  };
  return { locationnote: text('locationnote'), locationptn1: text('locationptn1'), desigitem: text('desigitem'),
    desigcust: text('desigcust'), desigloc: text('desigloc'), pullerresponsibility: text('pullerresponsibility'),
    oversellpercentage: text('oversellpercentage'), salesnote: text('salesnote'), suspend: text('suspend') };
}

export function confirmedInquiryFields(value: unknown, liveIds: ReadonlySet<string>): ConfirmedInquiryFields[] {
  if (!Array.isArray(value) || value.length > liveIds.size) throw new Error('RECLASS_INVENTORY_FIELDS_INVALID');
  const seen = new Set<string>();
  return value.map((entry): ConfirmedInquiryFields => {
    if (!record(entry) || !exactKeys(entry, ['unique_id', 'before', 'after', 'changedFields', 'stamps'])
      || typeof entry.unique_id !== 'string' || !liveIds.has(entry.unique_id) || seen.has(entry.unique_id)
      || !Array.isArray(entry.changedFields) || !entry.changedFields.every(fieldName)
      || new Set(entry.changedFields).size !== entry.changedFields.length || !record(entry.stamps)) throw new Error('RECLASS_INVENTORY_FIELDS_INVALID');
    seen.add(entry.unique_id);
    const stamps = entry.stamps;
    if (!exactKeys(stamps, ['prisetby', 'priupdated', 'locationnotedate', 'evaldate'])
      || !nullableText(stamps.prisetby) || !nullableText(stamps.priupdated) || !nullableText(stamps.locationnotedate)
      || typeof stamps.evaldate !== 'string' || !stamps.evaldate.trim()) throw new Error('RECLASS_INVENTORY_STAMPS_INVALID');
    const before = fieldValues(entry.before);
    const after = fieldValues(entry.after);
    const changedFields = entry.changedFields;
    if (inquiryEditableFields.some(field => (before[field] !== after[field]) !== changedFields.includes(field))) throw new Error('RECLASS_INVENTORY_CHANGES_INVALID');
    return { unique_id: entry.unique_id, before, after, changedFields,
      stamps: { prisetby: stamps.prisetby, priupdated: stamps.priupdated, locationnotedate: stamps.locationnotedate, evaldate: stamps.evaldate } };
  });
}
