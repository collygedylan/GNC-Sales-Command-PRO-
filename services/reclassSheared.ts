export const RECLASS_SHEARED_POLICY = 'reclass-action-workflow-v5-sheared-20261008' as const;

export interface ShearedProposal {
  action: 'sheared';
  quantity: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Client proposals contain quantity only. The database derives proposed desigitem. */
export function reclassShearedProposal(value: unknown): ShearedProposal {
  if (!record(value) || value.action !== 'sheared' || Object.keys(value).length !== 2
    || typeof value.quantity !== 'number' || !Number.isSafeInteger(value.quantity)
    || value.quantity < 1 || value.quantity > 2147483647) {
    throw new Error('DRIVE_RECLASS_V5_SHEARED_QUANTITY_INVALID');
  }
  return { action: 'sheared', quantity: value.quantity };
}

/** Validate the new boundary before serializing JSON; SQL validates legacy actions and current inventory. */
export function validateReclassShearedProposals(payload: Record<string, unknown>): void {
  if (payload.workflowPolicyVersion !== RECLASS_SHEARED_POLICY) return;
  if (!Array.isArray(payload.rowOverlays) || payload.rowOverlays.length > 1000) {
    throw new Error('DRIVE_RECLASS_V5_ROW_INVALID');
  }
  for (const overlay of payload.rowOverlays) {
    if (!record(overlay) || !Array.isArray(overlay.proposals)) throw new Error('DRIVE_RECLASS_V5_ROW_INVALID');
    for (const proposal of overlay.proposals) {
      if (!record(proposal)) throw new Error('DRIVE_RECLASS_V5_PROPOSAL_INVALID');
      if (proposal.action === 'sheared') reclassShearedProposal(proposal);
    }
  }
}
