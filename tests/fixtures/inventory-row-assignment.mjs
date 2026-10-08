export const INVENTORY_ROW_ASSIGNMENT_FIELDS = Object.freeze([
  'assigned_at', 'assignedto', 'assignment_reason', 'commonname', 'contsize', 'default_assignedto', 'default_revision',
  'genusname', 'itemcode', 'itemcode_normalized', 'locationcode', 'lotcode', 'master_unique_id', 'policy_revision',
  'present_in_drive', 'review_required', 'revision', 'source', 'source_revision', 'unique_id', 'updated_at', 'warehousei',
  'zone_override_active'
]);

const FIELD_SET = new Set(INVENTORY_ROW_ASSIGNMENT_FIELDS);

export function inventoryRowAssignmentFixture(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('INVENTORY_ROW_ASSIGNMENT_FIXTURE_OVERRIDES_INVALID');
  }
  const unknown = Object.keys(overrides).filter((key) => !FIELD_SET.has(key));
  if (unknown.length) throw new Error(`INVENTORY_ROW_ASSIGNMENT_FIXTURE_FIELDS_UNSUPPORTED:${unknown.join(',')}`);
  return {
    assigned_at: null,
    assignedto: null,
    assignment_reason: 'unassigned',
    commonname: null,
    contsize: null,
    default_assignedto: null,
    default_revision: 0,
    genusname: null,
    itemcode: null,
    itemcode_normalized: null,
    locationcode: null,
    lotcode: null,
    master_unique_id: '',
    policy_revision: 0,
    present_in_drive: false,
    review_required: false,
    revision: 0,
    source: null,
    source_revision: 0,
    unique_id: '',
    updated_at: '2026-01-01T00:00:00Z',
    warehousei: null,
    zone_override_active: false,
    ...overrides
  };
}
