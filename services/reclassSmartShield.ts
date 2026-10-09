import { RECLASS_SHEARED_POLICY, validateReclassShearedProposals } from './reclassSheared.ts';

export const RECLASS_SMART_SHIELD_POLICY = 'reclass-action-workflow-v6-smart-shield-20261009' as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate untrusted V6 JSON before the fixed atomic RPC. SQL owns access and fanout. */
export function validateReclassSmartShieldProposals(payload: Record<string, unknown>): void {
  if (payload.workflowPolicyVersion !== RECLASS_SMART_SHIELD_POLICY) return;
  validateReclassShearedProposals({ ...payload, workflowPolicyVersion: RECLASS_SHEARED_POLICY });
  const rows = payload.rowOverlays;
  const transaction = payload.transaction;
  if (!Array.isArray(rows) || !record(transaction) || !Array.isArray(transaction.holdStopProposals)) {
    throw new Error('DRIVE_RECLASS_V6_SHAPE_INVALID');
  }
  const holds = transaction.holdStopProposals;
  if (holds.length > 1) throw new Error('DRIVE_RECLASS_V6_HOLD_PROPOSAL_INVALID');
  for (const hold of holds) {
    if (!record(hold) || Object.keys(hold).length !== 3
      || typeof hold.action !== 'string' || !['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship'].includes(hold.action)
      || typeof hold.sourceUid !== 'string' || !hold.sourceUid || hold.sourceUid.trim() !== hold.sourceUid
      || typeof hold.reason !== 'string' || hold.reason.length > 1000
      || (['hold', 'stop_ship'].includes(hold.action) && !hold.reason.trim())) {
      throw new Error('DRIVE_RECLASS_V6_HOLD_PROPOSAL_INVALID');
    }
    if (!rows.some(row => record(row) && row.unique_id === hold.sourceUid)) {
      throw new Error('DRIVE_RECLASS_V6_HOLD_SOURCE_INVALID');
    }
  }
  let moveUp = false;
  let hasHold = holds.length > 0;
  let hasPriority = false;
  for (const row of rows) {
    if (!record(row) || !Array.isArray(row.proposals)) throw new Error('DRIVE_RECLASS_V6_ROW_INVALID');
    const rowHasPriority = row.proposals.some(value => record(value) && value.action === 'priority_change');
    const rowHasHold = holds.some(value => record(value) && value.sourceUid === row.unique_id);
    if (rowHasPriority || rowHasHold) {
      const expected = row.expected;
      if (!record(expected) || ['priority', 'holdstopcode', 'holdstopreason'].some(key =>
        !Object.hasOwn(expected, key) || (expected[key] !== null && typeof expected[key] !== 'string'))) {
        throw new Error('DRIVE_RECLASS_V6_EXPECTED_FIELDS_INVALID');
      }
    }
    for (const proposal of row.proposals) {
      if (!record(proposal)) throw new Error('DRIVE_RECLASS_V6_PROPOSAL_INVALID');
      if (proposal.action === 'move_up') moveUp = true;
      if (proposal.applyHold === true || typeof proposal.holdReason === 'string' && Boolean(proposal.holdReason.trim())) hasHold = true;
      if (proposal.action === 'priority_change') {
        hasPriority = true;
        if (typeof proposal.priority !== 'string' || proposal.priority !== '' && !/^[1-9][0-9]?$/.test(proposal.priority)) {
          throw new Error('DRIVE_RECLASS_V6_PRIORITY_INVALID');
        }
      }
    }
  }
  if (moveUp && hasHold) throw new Error('DRIVE_RECLASS_V6_MOVE_UP_HOLD_CONFLICT');
  if (!hasPriority && !holds.length) throw new Error('DRIVE_RECLASS_V6_LIVE_ACTION_REQUIRED');
}
