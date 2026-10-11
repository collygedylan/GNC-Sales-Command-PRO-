import type { Database } from '../supabase/functions/_shared/database.types';
import { confirmedDriveEvidence, driveEvidenceColumns, driveEvidenceRevision, type DriveEvidenceRow } from './driveEvidence';
import { confirmedInquiryFields, RECLASS_EDITABLE_FIELDS_POLICY, type ConfirmedInquiryFields } from './reclassEditableFields';

type MasterPriorityHoldFields = Pick<
  Database['public']['Tables']['ph_master_inventory']['Row'],
  'unique_id' | 'priority' | 'holdstopcode' | 'holdstopreason' | 'last_updated'
  | 'av_rule_last_clear_reason' | 'av_rule_last_cleared_at'
>;

export interface ConfirmedReclassLiveEdit {
  unique_id: MasterPriorityHoldFields['unique_id'];
  priority: MasterPriorityHoldFields['priority'];
  holdstopcode: MasterPriorityHoldFields['holdstopcode'];
  holdstopreason: MasterPriorityHoldFields['holdstopreason'];
  av_rule_last_clear_reason: MasterPriorityHoldFields['av_rule_last_clear_reason'];
  av_rule_last_cleared_at: MasterPriorityHoldFields['av_rule_last_cleared_at'];
  last_updated: string;
  evidence: DriveEvidenceRow;
}

export interface ConfirmedReclassLiveEdits {
  inventoryRevision: string;
  liveEdits: ConfirmedReclassLiveEdit[];
  inventoryFields?: ConfirmedInquiryFields[];
  workflowPolicyVersion?: typeof RECLASS_EDITABLE_FIELDS_POLICY;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function revisionString(value: unknown): string {
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw new Error('RECLASS_LIVE_EDIT_REVISION_INVALID');
}

/** Validate the server-confirmed live write before merging it into local inventory caches. */
export function confirmedReclassLiveEditsFromResult(value: unknown): ConfirmedReclassLiveEdits {
  if (!record(value) || !Array.isArray(value.liveEdits) || value.liveEdits.length > 10000) {
    throw new Error('RECLASS_LIVE_EDIT_RESULT_INVALID');
  }
  const inventoryRevision = revisionString(value.inventoryRevision);
  const seen = new Set<string>();
  const liveEdits = value.liveEdits.map((raw): ConfirmedReclassLiveEdit => {
    if (!record(raw)) throw new Error('RECLASS_LIVE_EDIT_ROW_INVALID');
    const allowedKeys = ['unique_id', 'priority', 'holdstopcode', 'holdstopreason', 'av_rule_last_clear_reason', 'av_rule_last_cleared_at', 'last_updated', 'evidence'];
    if (Object.keys(raw).length !== allowedKeys.length || Object.keys(raw).some(key => !allowedKeys.includes(key))) {
      throw new Error('RECLASS_LIVE_EDIT_ROW_INVALID');
    }
    const uniqueId = raw.unique_id;
    if (typeof uniqueId !== 'string' || !uniqueId || uniqueId.trim() !== uniqueId || seen.has(uniqueId)) {
      throw new Error('RECLASS_LIVE_EDIT_ROW_ID_INVALID');
    }
    seen.add(uniqueId);
    for (const key of ['priority', 'holdstopcode', 'holdstopreason', 'av_rule_last_clear_reason', 'av_rule_last_cleared_at'] as const) {
      if (raw[key] !== null && typeof raw[key] !== 'string') throw new Error('RECLASS_LIVE_EDIT_FIELD_INVALID');
    }
    if (typeof raw.last_updated !== 'string' || !raw.last_updated.trim() || !Number.isFinite(Date.parse(raw.last_updated))) {
      throw new Error('RECLASS_LIVE_EDIT_TIMESTAMP_INVALID');
    }
    if (!record(raw.evidence)
      || Object.keys(raw.evidence).length !== driveEvidenceColumns.length
      || Object.keys(raw.evidence).some(key => !driveEvidenceColumns.includes(key as typeof driveEvidenceColumns[number]))) {
      throw new Error('RECLASS_LIVE_EDIT_EVIDENCE_INVALID');
    }
    let evidence: DriveEvidenceRow;
    try {
      evidence = confirmedDriveEvidence({ ok: true, canonicalConfirmed: true, row: raw.evidence });
    } catch (error) {
      throw new Error('RECLASS_LIVE_EDIT_EVIDENCE_INVALID', { cause: error });
    }
    if (evidence.unique_id !== uniqueId
      || !driveEvidenceRevision(raw.last_updated)
      || driveEvidenceRevision(evidence.last_updated) !== driveEvidenceRevision(raw.last_updated)) {
      throw new Error('RECLASS_LIVE_EDIT_EVIDENCE_MISMATCH');
    }
    return {
      unique_id: uniqueId,
      priority: raw.priority as string | null,
      holdstopcode: raw.holdstopcode as string | null,
      holdstopreason: raw.holdstopreason as string | null,
      av_rule_last_clear_reason: raw.av_rule_last_clear_reason as string | null,
      av_rule_last_cleared_at: raw.av_rule_last_cleared_at as string | null,
      last_updated: raw.last_updated,
      evidence,
    };
  });
  if (value.workflowPolicyVersion === RECLASS_EDITABLE_FIELDS_POLICY) {
    return { inventoryRevision, liveEdits, workflowPolicyVersion: RECLASS_EDITABLE_FIELDS_POLICY,
      inventoryFields: confirmedInquiryFields(value.inventoryFields, seen) };
  }
  if (Object.hasOwn(value, 'inventoryFields')) throw new Error('RECLASS_INVENTORY_POLICY_INVALID');
  return { inventoryRevision, liveEdits };
}
